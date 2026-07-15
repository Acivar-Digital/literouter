# LiteRouter Setup Guide

For step-by-step workflows, see **`setup_checklist.md`** — it contains executable checklists for Add Model, Delete Model, Add Provider, Delete Provider. This document covers technical details and scripts.

---

## 1. Model Registry Technical Details

`models.json` is the **lean routing registry** (ID → upstream). Rich per-model metadata lives in `models/<provider>/` as one JSON file per model, sourced from OpenRouter's public catalog.

### Directory Layout
```
models.json                     # routing registry
models/
  openrouter/                  # OpenRouter model details
  nvidia/                      # Nvidia model details  
  zen/                         # Zen model details
```

---

## 2. Scripts Reference

| Script | Purpose |
|--------|---------|
| `scripts/gather_model_details.py` | Pulls OpenRouter catalog, populates `models/<provider>/` and syncs real context/max_output into `models.json` |
| `scripts/health_check_models.py` | Probes every model, reports alive vs dead (ERROR, 429, 200) |

Both run with `uv run python scripts/<script>.py`.

---

## 3. ID Normalization Rules (ORG_MAP)

OpenRouter's catalog uses different naming than our `system_id`s. Normalization happens in `gather_model_details.py`:

| Our org | OpenRouter org |
|---------|---------------|
| `meta` | `meta-llama` |
| `minimaxai` | `minimax` |
| `deepseek-ai` | `deepseek` |
| `stepfun-ai` | `stepfun` |

**`zen/deepseek*` special case:** mapped to OpenRouter's `deepseek/...` catalog entry.  
**Google is skipped** entirely (manual configuration).

---

## 4. Fusion Model Configuration (In-Process)

Fusion models are "virtual" models with priority-based fallback chains. If primary returns `429` or `5xx`, it tries the next model. The fusion runtime is built into the Bun process — no separate service.

### Fusion.json Format

| Field | Description |
|-------|-------------|
| `chain` | Ordered list of model `system_id`s to try. Iterates top→bottom. |
| `upstream` | Used to determine route type: includes `/v1beta` → Google native route; otherwise → OpenAI-compat. The actual URL is not used for forwarding (calls internal handlers). |

### Fusion Internals
- **Circuit breaker**: 65s cooldown per model (in-memory map, `circuitOpenUntil`)
- **Sticky fallback**: 300s (5 min) — once the chain falls back to a lower model, subsequent requests start there instead of the top, giving the primary real cooldown time
- **Identity**: Response header `X-Literouter-Model` identifies which upstream served

---

## 5. Google SDK Routes

**Three distinct paths through the gateway:**

| Gateway Route | Protocol | Upstream Target | Auth |
|---------------|----------|-----------------|------|
| `/v1beta/...` | Google native REST | `generativelanguage.googleapis.com/v1beta/models/{model}:{action}` | `?key={API_KEY}` query param |
| `/v1/chat/completions` (Google models) | OpenAI-compat | `generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `Authorization: Bearer {key}` |

Key insight: Google's OpenAI-compatibility endpoint lives at `/v1beta/openai/` on Google's side. So OpenAI-compat requests for Google models still flow through Google's `/v1beta/` namespace — just a different path within it.

---

## 6. Key Rotation Mechanics (Single Implementation)

### Quota Mechanism: ZSET+Lua Atomic Rolling Window

The Bun process uses a Redis Lua script for atomic true-rolling rate limiting:

```lua
-- QUOTA_CHECK_SCRIPT (src/index.ts)
ZREMRANGEBYSCORE key '-inf' now-60       -- purge events >60s old
ZRANGEBYSCORE key now-60 now              -- count remaining members
-- count RPM = #members
-- count TPM = sum of token values extracted from member strings
-- if RPM < max AND (TPM + estimated) <= max_tpm:
ZADD key now "{timestamp}-{random}:{tokens}"
EXPIRE key 120                            -- generous TTL for clock skew
-- else: reject (return {0, current_rpm, current_tpm})
```

Member format `{timestamp}-{random}:{tokens}` uses `Date.now()` + random suffix to prevent ZSET member collisions.

### Key Selection Algorithm
1. Round-robin start from `_next_index[provider]`
2. Skip keys in cooldown (Redis `EXISTS cooldown:{provider}:{hash}:{model}`)
3. Skip keys that haven't waited `MIN_DELAY_MS` (`{PROV}_MIN_DELAY_MS` env override, fallback `LITEROUTER_ROTATE_DELAY_MS`)
4. Check `rolling:{provider}:{hash}:{model}` ZSET quota via atomic Lua
5. If all keys fail steps 2-4, try LRU candidate (relaxes min-delay constraint, retries quota)
6. If LRU also fails → throw `NoDeploymentsAvailable`
7. On success → advance `_next_index`, update `_last_used`

### Max Attempts Per Request
`LITEROUTER_MAX_ATTEMPTS` (default **3**) caps how many keys get tried per request. Only that many keys go into cooldown on failure — the rest stay available for other requests. Set in `.env`:
```env
LITEROUTER_MAX_ATTEMPTS=3
```

### Per-Provider Rotate Delay
Override key rotation delay per provider via `{PROV}_MIN_DELAY_MS` in `.env`:
```env
GOOGLE_MIN_DELAY_MS=0        # no wait between Google key retries
NVIDIA_MIN_DELAY_MS=5000     # 5s between Nvidia key retries
```
Falls back to `LITEROUTER_ROTATE_DELAY_MS` (default 10,000ms).

### Backoff Behavior: Top-Level vs Fusion Chain

| Context | All Keys Exhausted | Behavior |
|---------|-------------------|----------|
| **Top-level request** (direct model call) | Tries all keys + 10s delay between retries | Backs off **65s → 90s → 120s** |
| **Fusion chain** (pydantic/google, etc.) | Tries up to `LITEROUTER_MAX_ATTEMPTS` keys, **no delay** | Returns **429 immediately** → chain advances to next model |

### Cooldown States

| Redis Key Pattern | TTL | Trigger |
|-------------------|-----|---------|
| `cooldown:{provider}:{hash}:{model}` — `rate_limited` | **65s** | `429` or `rate_limit` upstream |
| `cooldown:{provider}:{hash}:{model}` — `timed_out` | **10s** | `timeout`, `503`, `504` |
| `cooldown:{provider}:{hash}:{model}` — `quarantined` | **604,800s (7 days)** | `401`, `403`, `auth`, `permission_denied` |
| `cooldown:{provider}:{hash}:{model}` — `error_{type}` | **30s** | any other error |

---

## 7. Dead-Model Detection (MANDATORY PROCESS)

**Never auto-remove models.** Always follow this process:

1. Run `uv run python scripts/health_check_models.py`
2. Classify results:
   - `ERROR` → broken/gone (fatal)
   - `429` → alive but rate-limited
   - `200` → alive
3. **Report `ERROR` and `429` models to user** (grouped by failure type)
4. **Wait for explicit approval** before editing `models.json`
5. After approval: remove from `models.json` AND delete corresponding `models/<provider>/<file>.json`

> The user double-checks all removal decisions. Surfacing the list is the deliverable; deletion is only on approval.