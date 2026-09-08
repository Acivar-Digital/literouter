# LiteRouter Fusion Multi-Tier Setup & Sticky Fallback Architecture

## 1. Overview & Architecture

LiteRouter Fusion (`v3.1`) is a high-availability multi-tier model routing and sticky fallback subsystem. It allows client applications to send requests tagged with a Fusion preset directive key (e.g., `lr-fse-quad`, `lr-fse-pydn`, `lr-fse-fast`, `lr-fse-deep`), whereupon the gateway executes a deterministic multi-tier fallback chain across different upstream providers and models.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Inbound Client Request                          │
│          (Authorization: Bearer lr-fse-quad, model: claude-3.7)        │
└────────────────────────────────---┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        FusionEngine & Sticky Cache                     │
│         - Checks StickyPositionCache (TTL = 300,000ms / 5 min)         │
│         - Reorders or keeps tier priority (Priority 1 -> 2 -> 3)       │
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

---

## 2. Sticky Fallback Caching Mechanism

When an upstream tier fails due to transient rate limits (429), capacity overload, or server errors (5xx), LiteRouter falls back to subsequent tiers defined in the preset. 

To prevent thrashing and maintain routing stability for successful recovery paths:
- **Sticky Locking**: If a request succeeds on a fallback tier (Priority > 1), LiteRouter records the successful tier in `StickyPositionCache` (`src/fusion/sticky.ts`) for that specific preset and model combination.
- **TTL Expiry**: The sticky position remains active for **300,000 ms (5 minutes)** by default (`FUSION_STICKY_TTL_MS`), during which subsequent requests for the model under that preset bypass Tier 1 and immediately target the successful fallback tier.
- **Auto-Healing**: When a primary tier (Priority 1) succeeds again, `handleTierSuccess` automatically clears the sticky position, restoring the primary tier as the top priority.

---

## 3. Configuration Files: `config/fusion.json` & Legacy Root `fusion.json`

LiteRouter reads preset configurations from `config/fusion.json` (validated against `config/fusion.schema.json`). A legacy root `fusion.json` is also maintained for backwards compatibility.

### Schema Structure (`config/fusion.json`)
```json
{
  "$schema": "./fusion.schema.json",
  "version": "3.1",
  "presets": {
    "quad": {
      "strategy": "sticky_fallback",
      "timeout_ms": 30000,
      "models": {
        "anthropic/claude-3.7-sonnet": {
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

---

## 4. Presets (`quad`, `pydn`, `fast`, `deep`)

LiteRouter ships with four canonical Fusion presets:

1. **`quad` (`lr-fse-quad`)**:
   - **Strategy**: Multi-provider high-availability balancing.
   - **Timeout**: 30,000 ms.
   - **Target Models**: Claude 3.7 Sonnet, DeepSeek R1, Gemini 2.5 Pro routed across OpenRouter, NVIDIA, and Google native endpoints.

2. **`pydn` (`lr-fse-pydn`)**:
   - **Strategy**: Developer/Pydantic-optimized reasoning fallback.
   - **Timeout**: 25,000 ms.
   - **Target Models**: DeepSeek Reasoner and Claude 3.7 Sonnet across DeepSeek direct, NVIDIA, and Anthropic directives.

3. **`fast` (`lr-fse-fast`)**:
   - **Strategy**: Low-latency flash model fallback.
   - **Timeout**: 15,000 ms.
   - **Target Models**: Gemini 3.1 Flash Lite, Groq Llama 3, and lightweight open models.

4. **`deep` (`lr-fse-deep`)**:
   - **Strategy**: Deep reasoning and extended context fallback.
   - **Timeout**: 60,000 ms.
   - **Target Models**: DeepSeek R1 and large frontier reasoning models with extended TTFT and streaming idle windows.

---

## 5. Runtime Execution Flow & Codebase Files

Fusion request handling spans three core modules:

1. **`src/handlers/openai_compat.ts`**:
   - Intercepts inbound requests carrying a fusion directive token (`directive.type === "fusion"`).
   - Loads the Fusion configuration and instantiates `FusionEngine`.
   - Obtains the ordered execution tiers via `engine.createExecutionPlan(presetName, modelName)`.
   - Iterates through each tier sequentially, executing the request using the tier's specific directive key and upstream model identifier.
   - Invokes `engine.handleTierSuccess(...)` or `engine.handleTierFailure(...)` based on upstream outcome.

2. **`src/fusion/engine.ts`**:
   - Houses `FusionEngine`.
   - Resolves presets and model tier arrays sorted by priority.
   - Integrates `StickyPositionCache` to reorder tiers when a sticky position is active (`sortTiersWithSticky`).

3. **`src/fusion/sticky.ts`**:
   - Houses `StickyPositionCache`.
   - Manages an in-memory `Map<string, StickyPosition>` keyed by `${preset}:${model}`.
   - Enforces TTL checks (`expiresAt`) and provides cleanup methods (`clearStickyTier`, `clearAll`).

---

## 6. Linking Tiers via Directive Keys

Each tier in a Fusion model configuration defines an explicit `apikey` field containing a LiteRouter directive key (e.g., `lr-or-cl-ms-no`, `lr-nv-oa-ch-ts`). 

When LiteRouter executes a tier:
- The directive key is parsed into its provider, wire payload, completion endpoint, and nuance flags.
- Upstream credentials, headers, and protocol transformations are dynamically resolved according to that tier's directive key contract, allowing seamless fallback across completely disparate upstream protocol formats (e.g., Anthropic Messages vs OpenAI Chat Completions vs Google Generative Language).
