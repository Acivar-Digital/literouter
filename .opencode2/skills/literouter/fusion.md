# LiteRouter Fusion Multi-Tier Setup & Sticky Fallback Architecture

LiteRouter Fusion (`v3.1`) encompasses two high-availability resilience architectures:
1. **Google Native Flash Fusion (`gemini-flash`)**: High-performance, zero-disk-I/O descending fallback cascade specifically designed for Google Generative Language REST / `@ai-sdk/google` endpoints.
2. **OpenAI-Compatible Virtual Presets (`quad`, `pydn`, `fast`, `deep`)**: Cross-provider sticky fallback engine with TTL-based position caching across OpenAI, Anthropic, OpenRouter, NVIDIA, and DeepSeek backends.

---

## 1. Google Native Flash Fusion (`gemini-flash`)

### 1.1 Architecture & Concept
When client requests target the Google Native endpoint (`/v1beta/models/*:generateContent` or `/v1beta/models/*:streamGenerateContent`) using model alias `gemini-flash` with directive key `lr-gg-gg-gc-no`, LiteRouter activates the Native Fusion cascade.

The cascade steps down through generational Flash tiers:
```
gemini-3.8-flash (Tier 1) ──[404 or all keys 429/5xx]──► gemini-3.7-flash (Tier 2)
                                                                 │
                                                   [404 or all keys 429/5xx]
                                                                 ▼
gemini-3.5-flash (Tier 4) ◄──[404 or all keys 429/5xx]── gemini-3.6-flash (Tier 3)
```

### 1.2 Declarative Configuration (`config/fusion.json`)
Native chains are declared under the top-level `"native_chains"` object in `config/fusion.json`:
```json
{
  "native_chains": {
    "gemini-flash": [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash"
    ]
  }
}
```

### 1.3 Zero Disk I/O On Hot Path
- **Boot-Time Ingestion**: Chains are parsed and cached in memory via `loadAndCacheNativeChains()` during gateway boot (`src/index.ts`).
- **Zero Disk Reads**: Inbound requests never touch the filesystem; `getNativeChain("gemini-flash")` reads exclusively from the in-memory cache.
- **Hot Reloading**: The cache is cleanly refreshed on `POST /reset` via `resetAllState()` / `resetNativeChainsCache()`.

### 1.4 Dual-Rotation Engine & State Machine

The cascade combines **tier fallback** with **inner key pool rotation**:

```
[Inbound Request: gemini-flash]
   │
   ▼
[Snapshot startTier = currentFlashTierIndex]
   │
   ▼
[Tier Loop: cycleStep = 0 .. totalTiers - 1]
   │  tierIdx = (startTier + cycleStep) % totalTiers
   │  model = chain[tierIdx]
   │
   ├──► [Inner Key Loop: attempt = 1 .. poolSize(gg)]
   │        │
   │        ├─► Upstream 200/2xx:
   │        │     - Pin pointer: currentFlashTierIndex = tierIdx ("stay there")
   │        │     - Inject telemetry headers: x-literouter-model, x-literouter-tier
   │        │     - Return Response (200 OK)
   │        │
   │        ├─► Upstream 404 (model unreleased / missing):
   │        │     - Fast-advance immediately to next tier on attempt 1
   │        │     - Burn 0 extra keys
   │        │     - Break key loop -> next cycleStep
   │        │
   │        ├─► Upstream 429 / 5xx / Network Drop:
   │        │     - Rotate to next Google API key in pool
   │        │     - If all keys in pool exhausted -> cascade to next tier
   │        │
   │        └─► Upstream 400 / 401 / 403 (deterministic client error):
   │              - Pass through downstream immediately without cascading
   │
   ▼
[1-Cycle Exhaustion (All tiers failed)]:
   - Returns HTTP 503 {"error": {"message": "All Google native fusion tiers exhausted", "type": "service_unavailable"}}
```

#### Key Mechanics:
1. **Persistent Tier Ring Pointer ("Stay There" Semantics)**:
   - Module-level state `currentFlashTierIndex` records the last working tier.
   - If Tier 1 fails and Tier 2 succeeds, `currentFlashTierIndex` updates to `1` (Tier 2). Subsequent requests begin directly at Tier 2, avoiding repetitive failed attempts against an unavailable tier.
   - Resets to `0` upon `POST /reset`.
2. **Concurrency Pinning**:
   - To prevent race conditions and skipped tiers under concurrent load, each request takes a local snapshot `const startTier = currentFlashTierIndex`.
   - Iteration uses `(startTier + cycleStep) % totalTiers`, ensuring that even if another concurrent request mutates the global pointer mid-flight, every individual request deterministically traverses all unique tiers exactly once.
3. **Inner Key Rotation**:
   - For a given tier, the forwarder attempts all active keys in the `gg` pool before cascading to the next model tier on 429/5xx errors.

### 1.5 Error Cascades & Safeguards
- **HTTP 404 Fast-Advance**: If Google returns 404 (e.g. `gemini-3.8-flash` not yet public or removed), LiteRouter does **not** retry other keys. It immediately steps to the next tier on attempt 1 with 0 extra keys burned.
- **HTTP 429 / 5xx / Network Drops**: Triggers key rotation across the Google key pool. If all keys fail, the tier cascades.
- **Deterministic Errors (400, 401, 403)**: Non-recoverable client issues bypass cascade and return directly downstream.
- **1-Cycle Safeguard**: The loop is strictly capped at `totalTiers` (max 4 attempts). If all tiers are exhausted, it terminates with HTTP 503 `{"error": {"message": "All Google native fusion tiers exhausted", "type": "service_unavailable"}}`.
- **Pre-Stream vs Mid-Stream Safety**: Cascades apply strictly before stream initiation. If upstream drops the connection after headers or bytes are sent to downstream, the stream closes cleanly without attempting a cascade into an active downstream body.

### 1.6 Telemetry & Headers
- **Downstream Headers**:
  - `x-literouter-model: <active_tier_model>` (e.g. `gemini-3.7-flash`)
  - `x-literouter-tier: <tier_number>` (e.g. `2`)
- **Upstream Harness Attribution**:
  - Injects `User-Agent: OpenCode/1.18.29`
  - Injects `HTTP-Referer: https://opencode.ai`
  - Injects `X-Title: OpenCode`
- **Live Terminal Logging**:
  - `🔗 [FUSION req_id]` (`EMOJI.fusion`) on tier advance and successful tier delivery.
  - `🔴 [EXHAUSTED req_id]` (`EMOJI.exhausted`) when all tiers fail.

---

## 2. OpenAI-Compatible Virtual Presets (`quad`, `pydn`, `fast`, `deep`)

### 2.1 Overview & Architecture
Client applications targeting `/v1/chat/completions` pass a Fusion preset directive key in the `Authorization` header (`lr-fse-<preset>`).

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Inbound Client Request                          │
│        (Authorization: Bearer lr-fse-quad, model: claude-3.7-sonnet)   │
└────────────────────────────────---┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        FusionEngine & Sticky Cache                     │
│         - Checks StickyPositionCache (TTL = 300,000ms / 5 min)         │
│         - Reorders tier priority (Priority 1 -> 2 -> 3)                │
└────────────────────────────────---┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                      Execution Plan Generation                         │
│       - Tier 1: Primary provider/model + directive key (e.g. lr-or-cl) │
│       - Tier 2: Fallback provider/model + directive key (e.g. lr-an-cl)│
└────────────────────────────────---┬────────────────────────────────────┘
                                    │
    ┌───────────────────────────────┴───────────────────────────────┐
    │                                                               │
    ▼ (Success)                                                     ▼ (Failure: 429/5xx)
┌──────────────────────────────┐                ┌───────────────────────────────────┐
│  handleTierSuccess           │                │  handleTierFailure                │
│  - If Tier 1: clear sticky   │                │  - If sticky matches failed tier: │
│  - If Tier >1: lock sticky   │                │    clear sticky                   │
│    (300s TTL cache)          │                │  - Fall through to next tier      │
└──────────────────────────────┘                └───────────────────────────────────┘
```

### 2.2 Sticky Fallback Caching Mechanism
When an upstream tier fails due to transient rate limits (429), capacity overload, or server errors (5xx), LiteRouter falls back to subsequent tiers defined in the preset:
- **Sticky Locking**: If a request succeeds on a fallback tier (Priority > 1), `StickyPositionCache` (`src/fusion/sticky.ts`) records the winning tier for that `${preset}:${model}`.
- **TTL Expiry**: The sticky position remains active for **300,000 ms (5 minutes)** by default (`FUSION_STICKY_TTL_MS`), routing subsequent requests straight to the successful fallback tier.
- **Auto-Healing**: When Tier 1 succeeds again, `handleTierSuccess` clears the sticky position, reinstating Tier 1 as primary.

### 2.3 Preset Registry (`config/fusion.json`)
The presets and model tiers are defined in `config/fusion.json` (validated against `config/fusion.schema.json`):

```json
{
  "$schema": "./fusion.schema.json",
  "version": "3.1",
  "presets": {
    "quad": {
      "strategy": "sticky_fallback",
      "timeout_ms": 30000,
      "models": {
        "claude-3-7-sonnet": {
          "tiers": [
            {
              "priority": 1,
              "apikey": "lr-or-cl-ms-no",
              "model": "anthropic/claude-3.7-sonnet"
            },
            {
              "priority": 2,
              "apikey": "lr-an-cl-ms-no",
              "model": "claude-3-7-sonnet-20250219"
            }
          ]
        }
      }
    }
  }
}
```

### 2.4 Canonical Presets

1. **`quad` (`lr-fse-quad`)**:
   - **Strategy**: Multi-provider high-availability balancing across frontier models.
   - **Timeout**: 30,000 ms.
   - **Target Models**: Claude 3.7 Sonnet, DeepSeek R1, Gemini 2.5 Pro.
2. **`pydn` (`lr-fse-pydn`)**:
   - **Strategy**: Reasoning and code generation fallback.
   - **Timeout**: 25,000 ms.
   - **Target Models**: DeepSeek Reasoner and Claude 3.7 Sonnet across DeepSeek direct, NVIDIA, and Anthropic directives.
3. **`fast` (`lr-fse-fast`)**:
   - **Strategy**: Low-latency flash model fallback.
   - **Timeout**: 15,000 ms.
   - **Target Models**: Gemini 3.1 Flash Lite, Groq Llama 3.3 70B, and lightweight open models.
4. **`deep` (`lr-fse-deep`)**:
   - **Strategy**: Extended thinking and large-context fallback.
   - **Timeout**: 45,000 ms.
   - **Target Models**: DeepSeek R1 across NVIDIA, DeepSeek direct, and OpenRouter with relaxed TTFT and idle timers.

---

## 3. Configuration & Model Registries

- **Virtual Presets & Native Chains**: Stored in `config/fusion.json`.
- **Model Metadata & Capabilities**: Stored in `config/models.json` (root `models.json` is deprecated and deleted).
- **Providers & Attribution**: Stored in `config/providers.json`.

All configuration files are validated against their respective schemas on startup and hot-reloaded via `POST /reset`.
