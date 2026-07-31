# LiteRouter Comprehensive Troubleshooting & Diagnostics Guide

This operational playbook provides detailed diagnostic procedures, error pattern analysis, state inspection techniques, and health checks for the **LiteRouter** API Gateway on Bun/TypeScript.

---

## Table of Contents

1. [Gateway Health & Live Probes](#1-gateway-health--live-probes)
2. [Diagnosing Redis/Valkey Connectivity](#2-diagnosing-redisvalkey-connectivity)
3. [429 Rate Limit Cooldowns & Key Exhaustion](#3-429-rate-limit-cooldowns--key-exhaustion)
4. [First-Byte Ghosting Retries (`NoResponseError`)](#4-first-byte-ghosting-retries-noresponseerror)
5. [Auth Quarantine Debugging (7-Day TTL)](#5-auth-quarantine-debugging-7-day-ttl)
6. [Inspecting Request Traces in `logs/traces/<reqId>.json`](#6-inspecting-request-traces-in-logstracesreqidjson)
7. [Cyclomatic Complexity & Code Quality (`bun run complexity`)](#7-cyclomatic-complexity--code-quality-bun-run-complexity)
8. [Common Error Patterns & Edge Cases](#8-common-error-patterns--edge-cases)

---

## 1. Gateway Health & Live Probes

### Live Output & Terminal Logs
Attach to the running Bun gateway process log via `tmux`:
```bash
tmux attach -t literouter
```
All model registrations, key rotation events, upstream status codes, TTFT, and backoff warnings stream to stdout using structured emoji markers:
- 🔵 `[REQ]` - Inbound downstream request
- 🟢 `[SERVED]` - Successfully proxied response
- 🔄 `[ROTATE]` - Failover advancing to next key or model
- ⚠️ `[LIMIT]` - Upstream provider rate limit / error
- 🔴 `[EXHAUSTED]` - All keys or attempts exhausted
- 🟡 `[NO_RESPONSE]` - Upstream first-byte ghosting retry
- 🚀 `[BOOT]` - Gateway startup marker
- 💥 `[ERROR]` - System level failure
- 🔗 `[FUSION]` - Fusion chain routing event
- 📝 `[TRACE]` - Trace archive event

### Health Check Endpoint (`GET /health`)
The gateway exposes a lightweight HTTP probe returning status `200 OK`:
```bash
curl -i http://localhost:7766/health
# Response: HTTP/1.1 200 OK -> {"status":"ok"}
```

### Live API Key Validation Probe (`bun run scripts/doctor.ts`)
Run the FYI key health probe script to validate all configured API keys (`GOOGLE_API_KEYS`, `NVIDIA_API_KEYS`, `OPENROUTER_API_KEYS`, `ZEN_API_KEYS`) directly against upstream endpoints:
```bash
bun run scripts/doctor.ts
```
**Probe Mechanics:**
- Probes all keys in `.env` sequentially with a 2s delay between requests to avoid artificial rate-limiting.
- **Classification:**
  - `200 OK`: Key is healthy (`✅`).
  - `429`: Key is rate-limited but operational (`⚠️`).
  - `401/403`: Unauthorized or revoked key (`❌`).
  - Connection Error: Network glitch (`⚠️`).
- **FYI-Only Policy:** Boot is **NOT** gated by `doctor.ts`. Failed keys in `doctor.ts` output warn operators without halting gateway startup.

---

## 2. Diagnosing Redis/Valkey Connectivity

LiteRouter requires Redis / Valkey for sliding-window token/request tracking and multi-key cooldown management. **Redis is a mandatory dependency; no in-memory fallback exists.**

### Redis Connection Configuration
Configured via environment variables in `.env`:
- `REDIS_HOST` (default: `127.0.0.1`)
- `REDIS_PORT` (default: `6379`)
- `REDIS_PASSWORD` (default: undefined)
- `REDIS_DB` (default: `0`)

### Hard Exit on Connection Failure
If Redis is unreachable at boot or disconnects during runtime:
```
💥 [2026-07-31-15:00:00:000] Redis error: Connection refused — exiting (no fallback)
```
The gateway calls `process.exit(1)` immediately.

### Flush at Gateway Boot
When `router.connect()` runs at boot:
1. Executes `FLUSHALL` to purge stale keys and reset sliding-window counters.
2. Loads the atomic Lua quota checking script via `this.redis.script("LOAD", QUOTA_CHECK_SCRIPT)`.

### Lua Script (`QUOTA_CHECK_SCRIPT`) Details
The sliding-window quota is computed atomically in Redis via Lua:
- **ZSET Key Format:** `rolling:{provider}:{keyHash}:{modelName}`
- **ZSET Eviction:** Purges records older than 60s (`ZREMRANGEBYSCORE key -inf now-60`).
- **Member Format:** `<timestamp>-<randomStr>:<estimatedTokens>`
- **Quota Calculation:**
  - `current_rpm`: Count of ZSET members in `[now - 60, now]`.
  - `current_tpm`: Sum of token counts extracted from member string suffix.
- **Decision Logic:** If `current_rpm >= max_rpm` OR `(current_tpm + estimatedTokens) > max_tpm`, returns `{0, current_rpm, current_tpm}` (quota exceeded). Otherwise adds member, sets 120s TTL (`EXPIRE`), and returns `{1, current_rpm, current_tpm}`.
- **Lua Fallback:** Executed via `EVALSHA` first. If Redis returns `NOSCRIPT`, the router catches the exception and falls back to raw `EVAL`.

### Diagnostic Commands (Redis CLI)
```bash
# Test Redis connectivity
redis-cli ping

# List all active rolling windows
redis-cli KEYS 'rolling:*'

# Inspect sliding-window members for a specific key/model
redis-cli ZRANGEBYSCORE rolling:google:a1b2c3d4e5f67890:gemini-3.1-flash-lite 0 +inf WITHSCORES

# Check current RPM (ZSET cardinality)
redis-cli ZCARD rolling:google:a1b2c3d4e5f67890:gemini-3.1-flash-lite

# Force reset a rolling window
redis-cli DEL rolling:google:a1b2c3d4e5f67890:gemini-3.1-flash-lite
```

---

## 3. 429 Rate Limit Cooldowns & Key Exhaustion

When an upstream provider returns HTTP 429 or quota error text, the active API key is placed into Redis cooldown.

### Cooldown Key Specification
- **Redis Key Pattern:** `cooldown:{provider}:{keyHash}:{modelName}`
- **Value:** `rate_limited`
- **TTL Calculation:**
  - **Standard 429 Minimum TTL:** **65 seconds**.
  - **Provider Minimum Overrides:** For `google` and `nvidia`, error TTLs are enforced to be at least **65s** (`Math.max(ttl, 65)`).
  - **Header / Body Overrides:** If `retry-after` header or body parameters (`quotaResetDelay`, `retryDelay`) specify a larger delay, `parseResetDelay()` uses that value (clamped between 5s and 7200s, maxed with 65s for 429s).

### Cooldown State Summary

| State Value | Cause | Default TTL | Description |
|-------------|-------|-------------|-------------|
| `rate_limited` | Upstream 429 / quota error | **65s** (min) | Temporary backoff; key skipped during rotation |
| `timed_out` | 500, 502, 503, 504, connection timeout | **10s** | Short retry delay for transient network issues |
| `quarantined` | 401, 403, auth, permission_denied | **604800s** (7 days) | Revoked/invalid key isolated from pool |
| `error_<status>` | Other status codes | **30s** | Generic error fallback |

### Key Rotation & Attempt Limits
- Defined by `LITEROUTER_MAX_ATTEMPTS` (default: `3`).
- For a given request, the gateway attempts up to `min(numKeys, LITEROUTER_MAX_ATTEMPTS)` keys.
- If all available keys are in cooldown or quota-exhausted, the request fails with:
  - `HTTP 429`: `{"error": "All keys for {provider} are in cooldown..."}`
  - `HTTP 502`: `{"error": "Failover loop exhausted"}`

### Debugging Rate Limits & Cooldowns
```bash
# Find all keys currently in cooldown
redis-cli KEYS 'cooldown:*'

# Check specific cooldown status and remaining TTL
redis-cli GET cooldown:nvidia:a1b2c3d4e5f67890:deepseek-ai/deepseek-v4-pro
redis-cli TTL cooldown:nvidia:a1b2c3d4e5f67890:deepseek-ai/deepseek-v4-pro

# Clear a specific cooldown (unblock a key manually)
redis-cli DEL cooldown:nvidia:a1b2c3d4e5f67890:deepseek-ai/deepseek-v4-pro

# Clear ALL active cooldowns across all providers
redis-cli --eval "return redis.call('del', unpack(redis.call('keys', 'cooldown:*')))"
```

---

## 4. First-Byte Ghosting Retries (`NoResponseError`)

"First-byte ghosting" occurs when an upstream HTTP connection connects successfully but sends zero response bytes (no status headers or body chunks) before timing out.

### Technical Implementation (`src/network/fetcher.ts`)
First-byte timeouts are handled via `fetchWithFirstByteTimeout()`:
1. `firstByte` timer (`LITEROUTER_NO_RESPONSE_TIMEOUT_MS`) starts immediately before calling `fetch()`.
2. If HTTP response headers arrive before the timer fires, `clearTimeout(firstByte)` is called and the `Response` is returned.
3. If the timer fires before any response bytes arrive, `ctrl.abort()` triggers. The handler catches the abort, validates that total request timeout didn't abort, and throws `NoResponseError`.

### Key Environment Variables
- `LITEROUTER_NO_RESPONSE_TIMEOUT`: First-byte timeout in seconds (default: `5` -> `5000ms`).
- `LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS` (or `LITEROUTER_NO_RESPONSE_RETRY_DELAY`): Wait delay before trying next key after ghosting (default: `1000ms`).
- `LITEROUTER_HTTP_TIMEOUT`: Total HTTP timeout in seconds (default: `300` -> `300000ms`).

### Ghosting Rotation Policy (No Cooldown Penalty)
- **Crucial Rule:** First-byte ghosting is treated as a transient network connection stall, **NOT** an API key failure.
- When `NoResponseError` is caught in `executeOpenAICompat`:
  1. **No Redis cooldown is placed on the key.**
  2. Gateway logs: `🟡 [NO_RESPONSE <reqId>] key=... sent nothing within 5000ms, rotating key (no cooldown)`.
  3. Gateway records trace: `{ status: "no-response", body: "upstream sent no bytes" }`.
  4. Gateway waits `LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS` (1000ms) and rotates to the next available key.
  5. If all `maxAttempts` keys ghost, logs `🔴 [NO_RESPONSE <reqId>] all X keys ghosted, stopping (no cooldown)` and exits loop.

### Troubleshooting Missing First-Bytes
1. **Symptom:** Client requests hang for ~5s and then succeed on a rotated key, or fail after `maxAttempts * 5s`.
2. **Diagnosis:** Check stdout logs for `[NO_RESPONSE]` markers or inspect `logs/traces/<reqId>.json` for `"upstream": {"status": "no-response"}`.
3. **Adjustment:** If upstream model cold-starts exceed 5 seconds, increase `LITEROUTER_NO_RESPONSE_TIMEOUT` in `.env`:
   ```bash
   LITEROUTER_NO_RESPONSE_TIMEOUT=10
   ```

---

## 5. Auth Quarantine Debugging (7-Day TTL)

When an API key returns HTTP `401 Unauthorized` or HTTP `403 Forbidden` from an upstream provider, it indicates key revocation, invalid credentials, or project permissions errors.

### 7-Day Quarantine Mechanism
- **Trigger Errors:** Status codes `401`, `403`, or error strings containing `auth` or `permission_denied`.
- **Redis State:** `cooldown:{provider}:{keyHash}:{modelName}` = `quarantined`
- **Quarantine TTL:** **604800 seconds (7 days)**.
- **Impact:** The quarantined key is immediately excluded from `router.getAvailableKey()` candidate selection for that model and provider for 7 days.

### Quarantined Key Inspection & Recovery
1. **Identify Quarantined Keys:**
   ```bash
   redis-cli KEYS 'cooldown:*' | xargs -I {} sh -c 'echo "{}: $(redis-cli GET {})"' | grep quarantined
   ```
2. **Inspect Remaining TTL:**
   ```bash
   redis-cli TTL cooldown:google:a1b2c3d4e5f67890:gemini-3.1-flash-lite
   # Output: (integer) 604120 (seconds remaining)
   ```
3. **Un-quarantine a Key (After updating `.env` or fixing permissions):**
   ```bash
   redis-cli DEL cooldown:google:a1b2c3d4e5f67890:gemini-3.1-flash-lite
   ```
4. **Verify Key Health:**
   ```bash
   bun run scripts/doctor.ts
   ```

---

## 6. Inspecting Request Traces in `logs/traces/<reqId>.json`

LiteRouter includes an automatic request/response trace archive for debugging downstream inputs and upstream raw payloads.

### Lifecycle & Storage
- **Directory:** `logs/traces/` (located under workspace root).
- **Permissions:** File mode `0o600` (read/write by owner only).
- **Archive Reset:** Purged and recreated at gateway boot via `clearTraces()`.
- **File Naming:** `logs/traces/<reqId>.json` (where `<reqId>` is the UUID assigned to the request).

### Trace Structure (`recordTrace`)
Each trace JSON contains:
```json
{
  "reqId": "c4b1a8d0-7e3f-4a1b-8c9d-0e1f2a3b4c5d",
  "model": "google/gemini-3.1-flash-lite",
  "provider": "google",
  "status": 200,
  "ts": "2026-07-31T15:20:00.123Z",
  "downstream": {
    "model": "google/gemini-3.1-flash-lite",
    "messages": [
      { "role": "user", "content": "Hello world" }
    ],
    "stream": true
  },
  "upstream": {
    "status": 200,
    "body": "(stream)"
  }
}
```
*Note: For non-streaming requests or errors, `"upstream"` contains the parsed JSON object or error text.*

### Trace Commands
```bash
# List recent request traces (sorted by time)
ls -lt logs/traces/ | head -n 15

# View full trace for a specific request ID
cat logs/traces/<reqId>.json | jq .

# Search traces for specific status errors (e.g. status 429)
grep -l '"status": 429' logs/traces/*.json | xargs -n 1 jq '{reqId, model, status, upstream}'

# Find traces with first-byte no-response errors
grep -l 'no-response' logs/traces/*.json
```

---

## 7. Cyclomatic Complexity & Code Quality (`bun run complexity`)

To maintain high code quality and prevent logic nesting bugs in gateway handlers, LiteRouter includes cyclomatic complexity analysis.

### Command Execution
```bash
bun run complexity
```
*(Executes `bun run scripts/complexity.ts` targeting `src/` directory)*

### Score & Threshold Interpretation

| Score Range | Status Indicator | Action Required |
|-------------|------------------|-----------------|
| `<= 10` | `✅` | Code is clean and maintainable |
| `11 - 15` | `⚠️ (MODERATE)` | Consider refactoring if expanding logic |
| `> 15` | `🚨 (HIGH)` | Refactoring required before PR approval |

### Sample Output
```
==================================================
 Cyclomatic Complexity & Maintainability Report (src)
==================================================

📄 File: src/handlers/openai_compat.ts
   Maintainability Index: 68.45 / 100
   Functions & Complexity:
     - executeOpenAICompat: 18 🚨 (HIGH)
     - processOpenAIError: 7 ✅
     - processOpenAISuccess: 4 ✅
```

---

## 8. Common Error Patterns & Edge Cases

### 401 Unauthorized (`LITEROUTER_AUTH_KEY`)
- **Symptom:** Downstream request returns `401 Unauthorized`.
- **Cause:** Request header (`Authorization: Bearer ...`), `x-goog-api-key`, or query parameter (`?key=...`) does not match `LITEROUTER_AUTH_KEY` configured in `.env`.
- **Fix:** If `LITEROUTER_AUTH_KEY` is set in `.env`, ensure the client sends matching bearer auth. If left blank, auth validation is disabled.

### Antigravity Engine (`antigravity-preview-05-2026`) / HTTP 400
- **Symptom:** HTTP 400 error `Cannot text generation` or `Invalid action`.
- **Cause:** `antigravity-preview-05-2026` is an **Agent Execution Engine**, not a standard completion model. Calling it via `:generateContent` or `/v1/chat/completions` fails.
- **Fix:** Route via Google Interactions API (`POST /v1beta/interactions` or `/v1/interactions`), handled by `executeGoogleInteractions` in `src/handlers/google_native.ts`.

### Gemma Engine Crash / HTTP 400
- **Symptom:** Google upstream returns 400 error for Gemma model calls.
- **Cause:** Upstream Gemma endpoint rejects unsupported parameters (`presence_penalty`, `frequency_penalty`, `logit_bias`, `thinkingConfig`, `thinking`).
- **Fix:** LiteRouter automatically strips these fields via `cleanGemmaPayload()` in `src/transformers/payload.ts`. The Google native endpoint is handled by `executeGoogleNative` in `src/handlers/google_native.ts`. Verify model name in `models.json` includes `"gemma"`.

### Fusion Chain & Sticky Fallback Summary
- **Circuit Breaker TTL:** 65 seconds (`CIRCUIT_TTL`). Opens upstream circuit on 429 or 5xx errors.
- **Sticky Fallback TTL:** 300 seconds (`STICKY_TTL`). Holds traffic at highest successful fallback position in chain to prevent bouncing back to failed backends.