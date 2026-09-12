# LiteRouter Fusion Multi-Tier Setup & Sticky Fallback Architecture

LiteRouter Fusion (`v4.0`) encompasses two high-availability resilience architectures:
1. **Google Native Flash & Flash-Lite Fusion (`gemini-flash`, `gemini-flash-lite`)**: High-performance, zero-disk-I/O descending fallback cascades specifically designed for Google Generative Language REST / `@ai-sdk/google` endpoints.
2. **OpenAI-Compatible Virtual Presets (`quad`, `pydn`, `fast`, `deep`)**: Cross-provider sticky fallback engine with TTL-based position caching across OpenAI, Anthropic, OpenRouter, NVIDIA, and DeepSeek backends.

---

## 1. Google Native Flash & Flash-Lite Fusion (`gemini-flash`, `gemini-flash-lite`)

### 1.1 Architecture & Concept
When client requests target the Google Native endpoint using model alias `gemini-flash` or `gemini-flash-lite` (or prefixed with `google/`) with directive key `lr-gg-gg-gc-no`, LiteRouter activates the Native Fusion cascade for that specific chain.

#### Endpoint & Directive Specification:
- **Endpoints**:
  - Unary: `POST /v1beta/models/<chain>:generateContent`
  - Streaming: `POST /v1beta/models/<chain>:streamGenerateContent?alt=sse`
- **Directive Key**: `lr-gg-gg-gc-no` (Google Native Dumb Forwarder, wire `gg`, endpoint `gc`).
  - Pass via `Authorization: Bearer lr-gg-gg-gc-no` or query parameter `?key=lr-gg-gg-gc-no`.
- **Supported Client SDKs**: `@ai-sdk/google` or standard Gemini SDKs configured with:
  ```ts
  const google = createGoogleGenerativeAI({
    baseURL: "http://localhost:7766/v1beta",
    apiKey: "lr-gg-gg-gc-no",
  });
  ```
- **Bare & Prefixed Model Naming**:
  Both bare model names and `google/` prefixes are fully supported and automatically normalized by `normalizeGoogleNativeModel()`:
  - `gemini-flash` or `google/gemini-flash`
  - `gemini-flash-lite` or `google/gemini-flash-lite`

#### Native Chains & Tier Cascades:
The cascades step down through generational model tiers:

1. **`gemini-flash` Chain**:
   - Tier 1: `gemini-3.8-flash`
   - Tier 2: `gemini-3.7-flash`
   - Tier 3: `gemini-3.6-flash`
   - Tier 4: `gemini-3.5-flash`
   ```
   gemini-3.8-flash (Tier 1) ──[404 or all keys 429/5xx]──► gemini-3.7-flash (Tier 2)
                                                                    │
                                                      [404 or all keys 429/5xx]
                                                                    ▼
   gemini-3.5-flash (Tier 4) ◄──[404 or all keys 429/5xx]── gemini-3.6-flash (Tier 3)
   ```

2. **`gemini-flash-lite` Chain**:
   - Tier 1: `gemini-3.5-flash-lite`
   - Tier 2: `gemini-3.1-flash-lite`
   ```
   gemini-3.5-flash-lite (Tier 1) ──[404 or all keys 429/5xx]──► gemini-3.1-flash-lite (Tier 2)
   ```

### 1.2 Declarative Configuration (`config/fusion.json`)
Native chains are declared declaratively under the top-level `"native_chains"` object in `config/fusion.json`:
```json
{
  "native_chains": {
    "gemini-flash": [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash"
    ],
    "gemini-flash-lite": [
      "gemini-3.5-flash-lite",
      "gemini-3.1-flash-lite"
    ]
  }
}
```
If `config/fusion.json` is missing or omits a chain, LiteRouter provides hardcoded fallback constants (`DEFAULT_FLASH_CHAIN` and `DEFAULT_FLASH_LITE_CHAIN`) in `src/handlers/google_native.ts`.

### 1.3 Zero Disk I/O On Hot Path
- **Boot-Time Ingestion**: Chains are parsed and cached in memory via `loadAndCacheNativeChains()` during gateway boot (`src/index.ts`).
- **Zero Disk Reads**: Inbound requests never touch the filesystem; `getNativeChain("gemini-flash")` and `getNativeChain("gemini-flash-lite")` read exclusively from the in-memory cache `cachedNativeChains`.
- **Hot Reloading**: The cache is cleanly refreshed on `POST /reset` via `resetAllState()` / `resetNativeChainsCache()`.

### 1.4 Dual-Rotation Engine & State Machine

The cascade combines **tier fallback** with **inner key pool rotation**:

```
[Inbound Request: gemini-flash or gemini-flash-lite]
   │
   ▼
[Snapshot startTier = getNativeTierIndex(chainKey)]
   │
   ▼
[Tier Loop: cycleStep = 0 .. totalTiers - 1]
   │  tierIdx = (startTier + cycleStep) % totalTiers
   │  model = chain[tierIdx]
   │
   ├──► [Inner Key Loop: attempt = 1 .. poolSize(gg)]
   │        │
   │        ├─► Upstream 200/2xx:
   │        │     - Pin pointer: setNativeTierIndex(chainKey, tierIdx) ("stay there")
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

#### Key Mechanics & State Isolation:
1. **Isolated Persistent Tier Pointers ("Stay There" Semantics)**:
   - Module-level state `nativeTierIndices = new Map<string, number>()` tracks each chain's current active tier **independently**.
   - **Full State Isolation**: Because each chain key is tracked separately in `nativeTierIndices`:
     - A fallback on `gemini-flash-lite` (e.g. from Tier 1 `gemini-3.5-flash-lite` to Tier 2 `gemini-3.1-flash-lite`) updates only `nativeTierIndices.get("gemini-flash-lite")`. It has **zero effect** on `gemini-flash`, which remains pinned at its own independent tier index.
     - Conversely, a cascade on `gemini-flash` never mutates or shifts the tier index of `gemini-flash-lite`.
   - Subsequent requests for each chain begin directly at that chain's pinned winning tier index.
   - Resets all indices to `0` upon `POST /reset` via `resetNativeTierIndices()`.
2. **Concurrency Snapshot Pinning**:
   - To prevent race conditions and skipped tiers under concurrent load, each request captures an atomic snapshot `const startTier = getNativeTierIndex(chainKey)`.
   - Iteration strictly evaluates `(startTier + cycleStep) % totalTiers`, ensuring that even if another concurrent request mutates the pointer mid-flight, every individual request deterministically traverses all unique tiers of that chain exactly once.
3. **Prefix Normalization**:
   - Inbound model paths such as `/v1beta/models/google/gemini-flash` or `/v1beta/models/google/gemini-flash-lite` automatically strip the `google/` prefix to resolve against canonical `native_chains`.
4. **Inner Key Rotation**:
   - For a given tier, the forwarder attempts all active keys in the `gg` pool before cascading to the next model tier on 429/5xx errors.

### 1.5 Error Cascades & Safeguards
- **HTTP 404 Fast-Advance**: If Google returns 404 (e.g. `gemini-3.8-flash` or unreleased lite tiers), LiteRouter does **not** retry other keys in the pool. It immediately steps to the next tier on attempt 1 with 0 extra keys burned.
- **HTTP 429 / 5xx / Network Drops**: Triggers key rotation across the Google key pool. If all keys fail, the tier cascades to the next model in the chain.
- **Deterministic Errors (400, 401, 403)**: Non-recoverable client issues bypass cascade and return directly downstream.
- **1-Cycle Safeguard**: The loop is strictly capped at `totalTiers` (4 for `gemini-flash`, 2 for `gemini-flash-lite`). If all tiers in the chain are exhausted, it terminates with HTTP 503 `{"error": {"message": "All Google native fusion tiers exhausted", "type": "service_unavailable"}}`.
- **Pre-Stream vs Mid-Stream Safety**: Cascades apply strictly before stream initiation. If upstream drops the connection after headers or bytes are sent downstream, the stream closes cleanly without attempting a cascade into an active downstream body.

### 1.5b v4 Engine Mapping (`NativeCascadeStrategy`)

Under the `v4` engine (`LITEROUTER_ENGINE=v4`, default is `legacy` — see
`directive-grammar.md` §11), the same cascade is decided by
`classifyFailure` (`src/engine/strategies/native_cascade.ts:82-95`):

- `404` on a chained model → `advance_target` (tier index pinned forward,
  zero extra keys burned — same fast-advance as §1.5).
- `429` / `500–504` → `retry_same_target` (key rotation first, cascade
  only after pool exhaustion).
- Anything else (400 / 401 / 403 and deterministics) → `fail_fast`
  (pass through downstream, no cascade).

### 1.6 Telemetry & Headers
- **Downstream Headers**:
  - `x-literouter-model: <active_tier_model>` (e.g. `gemini-3.7-flash` or `gemini-3.1-flash-lite`)
  - `x-literouter-tier: <tier_number>` (e.g. `2`)
- **Hop-by-Hop & Compression Header Stripping**:
  - Downstream headers strip `content-encoding`, `content-length`, and `transfer-encoding` to prevent gzip decompression mismatch or chunk framing issues in `@ai-sdk/google`.
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
- **Sticky Locking**: If a request succeeds on a fallback tier (Priority > 1), in-memory `StickyPositionCache` (`src/fusion/sticky.ts`) records the winning tier for that `${preset}:${model}`.
- **In-Memory Zero-Disk Operation**: Sticky state and tier indices live entirely in process memory (via in-memory `StickyPositionCache` and `nativeTierIndices` map, with zero Redis/Valkey dependencies and zero disk I/O), guaranteeing sub-millisecond route resolution on hot paths.
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
