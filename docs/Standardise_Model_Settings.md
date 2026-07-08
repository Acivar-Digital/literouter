# Implementation Plan: Standardizing Model Settings

## 1. Objective
Unify the model registry across both LiteRouter implementations. Currently, the TypeScript proxy uses a dynamic `models.json` file, while the Python proxy relies on a hardcoded `MODEL_REGISTRY` in `src/config.py`. 

The goal is to make `models.json` the **single source of truth** for all deployments.

## 2. Current State Analysis
| Feature | TypeScript Proxy (`ts-src`) | Python Proxy (`src`) |
|---------|---------------------------|----------------------|
| **Storage** | `models.json` (Root) | `src/config.py` (Hardcoded) |
| **Loading** | Dynamic at startup | Static import |
| **Schema** | Array of objects | Dictionary of objects |
| **URL Logic** | Generated via `BASE_URLS` lookup | Explicitly defined per model |
| **Model Count** | 45 (as of Jul 2026) | 10 (manually maintained) |

### Schema Mismatch

| Field | `models.json` (array entry) | `MODEL_REGISTRY` (dict entry) |
|-------|---------------------------|-------------------------------|
| Key | `system_id` (field) | dict key itself |
| Model ID | `upstream_id` | `upstream_model` |
| URL | **missing** (derived at load from `BASE_URLS[provider]`) | `api_url` (explicit per entry) |
| Extra fields | `context`, `max_output` | — |

### Model Drift (Root Cause)

The hardcoded registry has **10 models**, `models.json` has **45**. Every time a model is added to `models.json` for the TS proxy, the Python proxy must be manually updated in `config.py` or it won't route to that model. This has already caused drift:
- All 35 Nvidia/OpenRouter/Zen models from `models.json` are missing from the hardcoded registry
- Old aliases (`freetier/`, bare `gemma-4-31b-it`) exist in hardcoded registry but not in `models.json`
- `mcpmart/` prefixed models existed in `models.json` but are not a configured provider (removed)

## 3. Proposed Changes

### Phase 1: Python Registry Refactor (`src/config.py`)

#### 1. Implement JSON Model Loader

Replace the hardcoded 50-line dict with a function that reads `models.json` at import time:

```python
PROVIDER_API_URLS = {
    "nvidia": "https://integrate.api.nvidia.com/v1/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    "google": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "zen": "{ZEN_BASE_URL}/chat/completions",
}

def _load_model_registry() -> dict:
    models_path = Path(__file__).resolve().parent.parent / "models.json"
    with open(models_path) as f:
        models_list = json.load(f)

    registry = {}
    for m in models_list:
        provider = m.get("provider", "").lower()
        api_url = PROVIDER_API_URLS.get(provider)
        if not api_url:
            continue  # skip unknown providers (e.g. mcpmart)

        registry[m["system_id"]] = {
            "provider": provider,
            "upstream_model": m["upstream_id"],
            "api_url": api_url,
        }
    return registry

MODEL_REGISTRY = _load_model_registry()
```

**Key behaviors:**
- Unknown providers (no `api_url` mapping) are silently skipped — no crash
- The `zen` provider's `api_url` retains the `{ZEN_BASE_URL}` placeholder, resolved at request time in `main.py:416`
- Module-level loading (no lifecycle change needed)
- Fails loudly if `models.json` is missing or malformed

#### 2. Add Backward-Compatible Aliases

Old client model IDs that changed in `models.json` must still resolve:

| Deprecated ID | Canonical ID |
|---------------|-------------|
| `freetier/gemma-4-31b-it` | `google/gemma-4-31b-it` |
| `gemma-4-31b-it` | `google/gemma-4-31b-it` |
| `freetier/gemma-4-26b-a4b-it` | `google/gemma-4-26b-a4b-it` |
| `gemma-4-26b-a4b-it` | `google/gemma-4-26b-a4b-it` |
| `gemini-3.1-flash-lite` | `google/gemini-3.1-flash-lite` |

These are added as **references to the same dict object** (not copies) so there's zero memory overhead.

### Phase 2: Safety Verification (No Changes to `src/main.py` or `src/router.py`)

**Critical finding**: The key rotation system, cooldown logic, failover loops, and timeout handling are **completely unaffected** by this change. Here's why:

| Component | Dependency on MODEL_REGISTRY | Risk |
|-----------|------------------------------|------|
| `router.py` — key rotation | Uses provider name only | **None** — provider string is unchanged |
| `router.py` — cooldown TTLs | Independent dicts | **None** |
| `main.py` — Google REST route | `meta["provider"]`, `meta["upstream_model"]` | **None** — same fields, same values |
| `main.py` — OpenAI route | `meta["provider"]`, `meta["upstream_model"]`, `meta["api_url"]` | **None** — same shape as before |
| `main.py` — failover loop | Only reads provider name | **None** |
| `main.py` — httpx timeout | Independent | **None** |

The router operates on its own `keys` dict keyed by provider name, which comes from `config.py` env var parsing (GOOGLE_API_KEYS, NVIDIA_API_KEYS, etc.) — not from MODEL_REGISTRY.

#### Single Point of Failure: `api_url` Derivation

If the `PROVIDER_API_URLS` mapping has a wrong URL for a provider, the OpenAI chat completions route (`main.py:436`) sends requests to the wrong upstream. Each provider URL must match the corresponding `_BASE_URL` in `.env`:

| Provider | `PROVIDER_API_URLS` | `.env` `_BASE_URL` |
|----------|---------------------|-------------------|
| google | `.../v1beta/openai/chat/completions` | `GOOGLE_BASE_URL` (separate endpoint) |
| nvidia | `https://integrate.api.nvidia.com/v1/chat/completions` | `NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1` |
| openrouter | `https://openrouter.ai/api/v1/chat/completions` | `OPENROUTER_BASE_URL=https://openrouter.ai/api/v1` |
| zen | `{ZEN_BASE_URL}/chat/completions` | `ZEN_BASE_URL=https://opencode.ai/zen/v1` |

**Google REST route** (`main.py:345`) hardcodes its own URL — it's immune to `api_url` changes.

### Phase 3: Verification

1. **Startup Check**: Server starts without error, all 45 models from `models.json` appear in registry
2. **Consistency Check**: Same model ID works on both port `7766` and `7767`
3. **Backward Compat**: Old model IDs (`freetier/gemma-4-31b-it`, bare names) still resolve
4. **Rotation Test**: Run test script sending requests, verify key rotation still works across all keys

### Phase 4: Side Effects & Cleanup

- `mcpmart` models are removed from `models.json` (not a configured provider)
- `mcpmart` base URL removed from `ts-src/src/index.ts`
- `admin/studio/upload/config.py` has a stale copy of MODEL_REGISTRY — not imported by anything (admin studio imports `src.config` directly), but should be updated for consistency if that deployment is active

## 4. Expected Outcome
- **Zero-Code Model Updates**: Adding or removing models will only require editing `models.json`.
- **Elimination of Drift**: No more discrepancies between what the TS and Python proxies "know" about the available models.
- **Simplified Onboarding**: New providers can be added by updating `.env` and `models.json` without modifying Python source code.
- **47 Models Available**: The Python proxy now routes all models that `models.json` defines, up from 10.

## 5. Rollback Plan
If the dynamic loading causes startup failures:
1. Revert `src/config.py` to the previous hardcoded `MODEL_REGISTRY`.
2. Fix the JSON parsing logic.

## 6. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `api_url` derivation wrong for a provider | Low (fixed mapping) | All models for that provider fail to route | Visual verify each URL before deploy |
| `models.json` missing/malformed at startup | Low (not changed frequently) | Server doesn't start | Git tracks it; rollback is 1 commit |
| Backward alias clobbers a models.json entry | Very Low (no overlap) | That model resolves to wrong config | Name collision check in code |
| `admin/studio/upload/` drifts | Medium | That deployment is unaffected (imports src.config) | Documented but out of scope |
