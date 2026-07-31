# LiteRouter Technical Configuration Reference & Setup Guide

This document is the definitive technical configuration manual and setup guide for **LiteRouter**, the high-performance Bun/TypeScript AI gateway running on port `7766`.

---

## 1. Complete Environment Variables Reference (`src/config/env.ts`)

LiteRouter is configured via environment variables. Below is the comprehensive breakdown of all core gateway options, Redis options, API key configurations, and provider base URLs.

### Gateway Core Controls

| Variable | Default Value | Data Type | Code Specification & Description |
|----------|---------------|-----------|----------------------------------|
| `LITEROUTER_PORT` | `7766` | `number` | `parseInt(Bun.env.LITEROUTER_PORT \|\| "7766", 10)`<br>HTTP listening port for the Bun gateway server. |
| `LITEROUTER_AUTH_KEY` | `""` (disabled) | `string` | `Bun.env.LITEROUTER_AUTH_KEY \|\| ""` <br>Bearer authentication secret. When non-empty, requests must provide matching token via `Authorization: Bearer <key>`, `x-goog-api-key: <key>`, or `?key=<key>` query parameter. |
| `LITEROUTER_ROTATE_DELAY_MS` | `10000` | `number` | `parseInt(Bun.env.LITEROUTER_ROTATE_DELAY_MS \|\| "10000", 10)`<br>Base delay in milliseconds between key rotations upon error or rate limit. Enforces minimum floor `MIN_ROTATE_DELAY_MS` (2000ms). Can be overridden per provider via `{PROVIDER}_MIN_DELAY_MS` (e.g. `GOOGLE_MIN_DELAY_MS`). |
| `LITEROUTER_HTTP_TIMEOUT` | `300` | `number` | `parseInt(Bun.env.LITEROUTER_HTTP_TIMEOUT \|\| "300", 10) * 1000`<br>Upstream total HTTP request timeout in **seconds** (converted to milliseconds: `300,000ms`). |
| `LITEROUTER_NO_RESPONSE_TIMEOUT` | `5` | `number` | `parseInt(Bun.env.LITEROUTER_NO_RESPONSE_TIMEOUT \|\| "5", 10) * 1000`<br>First-byte / initial response header timeout in **seconds** (converted to milliseconds: `5,000ms`). If upstream sends zero bytes within this window, `fetchWithFirstByteTimeout` throws `NoResponseError` for fast key rotation without placing the key on cooldown. |
| `LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS` | `1000` | `number` | `parseInt(Bun.env.LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS \|\| Bun.env.LITEROUTER_NO_RESPONSE_RETRY_DELAY \|\| "1000", 10)`<br>Delay in milliseconds before retrying with a rotated key after a `NoResponseError` (ghosted request). |
| `LITEROUTER_COLLAPSE_REASONING` | `false` | `boolean` | `(Bun.env.LITEROUTER_COLLAPSE_REASONING \|\| "false").toLowerCase() === "true"`<br>When enabled (`true`), transforms upstream thinking/reasoning outputs (`reasoning_content`, `thought`, `thought_summary`) into inline `<thought>...</thought>` blocks within standard text content. |
| `LITEROUTER_MAX_ATTEMPTS` | `3` | `number` | `parseInt(Bun.env.LITEROUTER_MAX_ATTEMPTS \|\| "3", 10)`<br>Maximum number of key failover attempts per request per model. Clamped to `min(num_configured_keys, LITEROUTER_MAX_ATTEMPTS)`. |

### Redis / Valkey State Backend

| Variable | Default Value | Data Type | Code Specification & Description |
|----------|---------------|-----------|----------------------------------|
| `REDIS_HOST` | `127.0.0.1` | `string` | `Bun.env.REDIS_HOST \|\| "127.0.0.1"`<br>Redis / Valkey host address for sliding-window quota tracking and key cooldown storage. |
| `REDIS_PORT` | `6379` | `number` | `parseInt(Bun.env.REDIS_PORT \|\| "6379", 10)`<br>Redis / Valkey port. |
| `REDIS_PASSWORD` | `undefined` | `string \| undefined` | `Bun.env.REDIS_PASSWORD \|\| undefined`<br>Authentication password for Redis / Valkey instance. |
| `REDIS_DB` | `0` | `number` | `parseInt(Bun.env.REDIS_DB \|\| "0", 10)`<br>Redis database index (0-15). |

### API Keys & Provider Overrides

| Variable | Default Value | Description |
|----------|---------------|-------------|
| `GOOGLE_API_KEYS` | `""` | Comma-separated list of Google Gemini API keys. Processed by `staticValidateKeys`. |
| `NVIDIA_API_KEYS` | `""` | Comma-separated list of NVIDIA Build API keys. Processed by `staticValidateKeys`. |
| `OPENROUTER_API_KEYS` | `""` | Comma-separated list of OpenRouter API keys. Processed by `staticValidateKeys`. |
| `ZEN_API_KEYS` | `""` | Comma-separated list of Zen API keys. Processed by `staticValidateKeys`. |
| `{PROVIDER}_MIN_DELAY_MS` | `LITEROUTER_ROTATE_DELAY_MS` | Per-provider override for key rotation delay (e.g. `GOOGLE_MIN_DELAY_MS=0`, `NVIDIA_MIN_DELAY_MS=5000`). Enforces minimum `MIN_ROTATE_DELAY_MS` (2000ms). |

---

## 2. Gate 1 Static Key Validation Rules (`staticValidateKeys`)

API keys supplied via environment variables (`GOOGLE_API_KEYS`, `NVIDIA_API_KEYS`, etc.) are filtered at startup by `staticValidateKeys(provider, keysStr)` in `src/config/env.ts`.

```typescript
export function staticValidateKeys(provider: string, keysStr: string): string[] {
  if (!keysStr) return [];
  const rawKeys = keysStr.split(",").map((k) => k.trim()).filter(Boolean);
  const placeholders = ["changeme", "placeholder", "your_key", "todo", "xxxx"];
  const validKeys: string[] = [];

  for (const key of rawKeys) {
    const lower = key.toLowerCase();
    const isPlaceholder = placeholders.some((p) => lower.includes(p));
    const hasBrackets = key.includes("<") || key.includes(">");
    const tooShort = key.length < 30;

    if (isPlaceholder || hasBrackets || tooShort) {
      console.warn(`[${provider}] Gate 1 Static Validator: Discarded invalid key.`);
    } else {
      validKeys.push(key);
    }
  }
  return validKeys;
}
```

### Discard Rules Summary
1. **Placeholder match**: Discards keys containing (case-insensitive): `"changeme"`, `"placeholder"`, `"your_key"`, `"todo"`, `"xxxx"`.
2. **Bracket characters**: Discards keys containing `<` or `>`.
3. **Minimum Length**: Discards keys shorter than **30 characters** (`key.length < 30`).
4. **Warning Emission**: Emits `[<PROVIDER>] Gate 1 Static Validator: Discarded invalid key.` to log output for each discarded key.

---

## 3. Provider Endpoint Mappings (`PROVIDER_API_URLS`)

Upstream base URLs for each supported provider are defined in `src/config/env.ts` under `PROVIDER_API_URLS`.

```typescript
export const ZEN_BASE_URL = Bun.env.ZEN_BASE_URL || "https://opencode.ai/zen/v1";

export const PROVIDER_API_URLS: Record<string, string> = {
  nvidia:
    (Bun.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1") +
    "/chat/completions",
  openrouter:
    (Bun.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1") +
    "/chat/completions",
  google: (() => {
    const g = Bun.env.GOOGLE_BASE_URL;
    if (g) {
      const base = g.endsWith("/openai")
        ? g
        : g.endsWith("/v1beta")
          ? `${g}/openai`
          : g;
      return base.endsWith("/chat/completions")
        ? base
        : `${base}/chat/completions`;
    }
    return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  })(),
  zen: `${ZEN_BASE_URL}/chat/completions`,
};
```

### Endpoint Breakdown

| Provider | Environment Override | Resolved Full Upstream Endpoint |
|----------|----------------------|---------------------------------|
| `nvidia` | `NVIDIA_BASE_URL` | `${NVIDIA_BASE_URL \|\| "https://integrate.api.nvidia.com/v1"}/chat/completions` |
| `openrouter` | `OPENROUTER_BASE_URL` | `${OPENROUTER_BASE_URL \|\| "https://openrouter.ai/api/v1"}/chat/completions` |
| `google` | `GOOGLE_BASE_URL` | Auto-normalized `GOOGLE_BASE_URL` or default `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` |
| `zen` | `ZEN_BASE_URL` | `${ZEN_BASE_URL \|\| "https://opencode.ai/zen/v1"}/chat/completions` |

---

## 4. Redis Lua Quota Evaluation (`QUOTA_CHECK_SCRIPT`) & Sliding Window

LiteRouter enforces strict token-per-minute (TPM) and request-per-minute (RPM) limits via an atomic Redis Lua script operating over a Redis **Sorted Set (ZSET)**.

### Lua Script Source (`src/index.ts`)

```lua
local key = KEYS[1]
local now = tonumber(ARGV[1])
local max_rpm = tonumber(ARGV[2])
local max_tpm = tonumber(ARGV[3])
local estimated_tokens = tonumber(ARGV[4])
local member_string = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - 60)
local members = redis.call('ZRANGEBYSCORE', key, now - 60, now)

local current_rpm = #members
local current_tpm = 0

for i=1, #members do
    local mem = members[i]
    local colon_idx = string.find(mem, ":")
    if colon_idx then
        local tokens = tonumber(string.sub(mem, colon_idx + 1))
        if tokens then
            current_tpm = current_tpm + tokens
        end
    end
end

if current_rpm >= max_rpm or (current_tpm + estimated_tokens) > max_tpm then
    return {0, current_rpm, current_tpm}
else
    redis.call('ZADD', key, now, member_string)
    redis.call('EXPIRE', key, 120)
    return {1, current_rpm, current_tpm}
end
```

### Mechanics & Data Layout

1. **Key Naming Convention**: `rolling:{provider}:{keyHash}:{modelName}`
2. **Score**: Unix timestamp in seconds (`Date.now() / 1000`).
3. **Member Value Format**: `{timestamp_ms}-{random_hash}:{estimated_tokens}` (e.g. `1711900000123-ab4f9z:1542`).
4. **Window Mechanics**:
   - `ZREMRANGEBYSCORE key -inf (now - 60)` purges all entries older than 60 seconds.
   - `ZRANGEBYSCORE key (now - 60) now` fetches all request events in the rolling 60-second window.
   - `current_rpm` is computed as `#members`.
   - `current_tpm` is computed by parsing the token suffix (`:tokens`) of each member string.
5. **Quota Check Logic**:
   - Rejects if `current_rpm >= max_rpm` OR `(current_tpm + estimatedTokens) > max_tpm`, returning `{0, current_rpm, current_tpm}`.
   - If quota is available, adds member via `ZADD`, sets key TTL to 120 seconds (`EXPIRE`), and returns `{1, current_rpm, current_tpm}`.

---

## 5. Add Model Workflow

1. **Edit `models.json`** — Add entry with `system_id`, `provider`, `upstream_id`, `context`, `max_output`.
2. **Run `gather_model_details.py`** (optional) — Fetches real `context`/`max_output` from OpenRouter catalog and creates detail file in `models/<provider>/`.
3. **Sync `opencode.json`** — Add model under `provider.literouter.models` in `~/.config/opencode/opencode.json`.
4. **Update `CHANGELOG.md`** — Add entry under current version.
5. **Restart gateway** — `bash scripts/restart.sh`.
6. **Test** — `curl` the model endpoint.

---

## 6. Model Registry Architecture

`models.json` is the **lean routing registry** (ID → upstream). Rich per-model metadata lives in `models/<provider>/` as one JSON file per model, sourced from OpenRouter's public catalog.

```
models.json                     # routing registry
models/
  openrouter/                  # OpenRouter model details
  nvidia/                      # Nvidia model details
  zen/                         # Zen model details
```

---

## 7. Scripts Reference

| Script | Command | Purpose |
|--------|---------|---------|
| `scripts/gather_model_details.py` | `uv run python scripts/gather_model_details.py` | Pulls OpenRouter catalog, populates `models/<provider>/`, and syncs real context/max_output into `models.json`. |
| `scripts/health_check_models.py` | `uv run python scripts/health_check_models.py` | Probes every model, reports alive vs dead (ERROR, 429, 200). |
| `scripts/doctor.ts` | `bun run scripts/doctor.ts` | Performs system & key health checks. |

---

## 8. ID Normalization Rules (`ORG_MAP`)

OpenRouter's catalog uses different organization prefixing than LiteRouter `system_id`s. Normalization is handled in `gather_model_details.py`:

| LiteRouter Org Prefix | OpenRouter Catalog Org |
|-----------------------|-----------------------|
| `meta` | `meta-llama` |
| `minimaxai` | `minimax` |
| `deepseek-ai` | `deepseek` |
| `stepfun-ai` | `stepfun` |

- **`zen/deepseek*` special case**: mapped to OpenRouter's `deepseek/...` catalog entry.
- **Google models**: skipped from OpenRouter normalization (configured manually).

---

## 9. Fusion Model Architecture & Configuration

Fusion models are virtual routing endpoints configured in `fusion.json` with fallback chains.

### `fusion.json` Schema Example

```json
{
  "google/fusion-flash": {
    "description": "Google Flash primary with fallback chain",
    "upstream": "google/gemini-2.5-flash",
    "chain": [
      "google/gemini-2.5-flash",
      "google/gemini-3.5-flash"
    ]
  }
}
```

### Fusion State Management (`src/index.ts`)
- **Circuit Breaker (`circuitOpenUntil`)**: Opens 65-second cooldown per failed model upon `429` or `5xx` response.
- **Sticky Fallback (`stickyPosition`)**: 300-second (5 minute) memory window. Once a chain falls back to a secondary model, subsequent requests for that fusion group start at the fallback index to give the primary model recovery time.
- **Header Tracking**: Returned response header `X-Literouter-Model` indicates which model in the chain actually fulfilled the request.

---

## 10. Key Rotation & Cooldown Mechanics

### Key Selection Algorithm (`ModelFirstRouter.getAvailableKey`)
1. Round-robin start from `nextIndex.get(provider)`.
2. Skip keys currently in cooldown (Redis key `cooldown:{provider}:{keyHash}:{modelName}`).
3. Skip keys that have not waited `getMinDelayMs(provider)` (checks `{PROVIDER}_MIN_DELAY_MS`, default `LITEROUTER_ROTATE_DELAY_MS`, minimum 2000ms).
4. Evaluate ZSET quota via Redis Lua script (`QUOTA_CHECK_SCRIPT`).
5. If all keys fail steps 2-4, attempt LRU candidate (relaxes min-delay check while maintaining quota & cooldown checks).
6. On success: update last-used timestamp and advance `nextIndex`.
7. On total failure: throws `All keys for {provider} are in cooldown or have exhausted quota`.

### Redis Cooldown States & TTL Matrix

When an upstream error occurs, `router.reportError()` sets a key in Redis at `cooldown:{provider}:{keyHash}:{modelName}`:

| Error Type / Trigger | Redis Cooldown State | Default TTL | Notes |
|----------------------|----------------------|-------------|-------|
| `429`, `rate_limit`, or body containing `exhausted quota` / `cooldown` | `rate_limited` | **65s** | Extended to `max(reset_delay, 65s)` if `retry-after` provided. Forced minimum 65s for `google` & `nvidia`. |
| `timeout`, `500`, `502`, `503`, `504` | `timed_out` | **10s** | Short retry window. |
| `401`, `403`, `auth`, `permission_denied` | `quarantined` | **604,800s (7 days)** | Quarantines invalid or unauthorized keys. |
| Other errors | `error_{type}` | **30s** | Standard error cooldown. |

---

## 11. Dead-Model Detection Procedure

**Never auto-remove models without verification.**

1. Execute health probe: `uv run python scripts/health_check_models.py`.
2. Categorize results:
   - `ERROR`: Model endpoint broken or unavailable.
   - `429`: Alive but rate-limited.
   - `200`: Fully operational.
3. Report `ERROR` and `429` models to user grouped by failure type.
4. **Await explicit approval** before modifying `models.json`.
5. Upon approval: remove from `models.json` and delete associated detail file in `models/<provider>/<file>.json`.