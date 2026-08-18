# LiteRouter Comprehensive Diagnostics & Troubleshooting Guide (v3.1 / v3.2)

This operational guide provides diagnostic procedures, error patterns, log indicators, and recovery workflows for the **LiteRouter** Bun/TypeScript AI Gateway.

---

## 1. Live Terminal & Log Inspection

### Viewing Gateway Output
Attach to the background daemon via `tmux`:
```bash
tmux attach -t literouter
```
Detach anytime using `Ctrl+B`, then `D`.

### Structured Log Markers (`logs/gateway.log`)
- 🔵 `[INBOUND]` — Inbound downstream HTTP request with detected directive key.
- 🟢 `[SERVED]` — Successfully proxied response with latency and status code.
- 🔄 `[ROTATE]` — Key failover advancing to the next active key index.
- ⚠️ `[LIMIT]` — Upstream provider rate limit (HTTP 429) placing key in cooldown.
- 🔴 `[EXHAUSTED]` — All configured API keys for a provider are cooling down.
- 🟡 `[GHOST]` — Upstream first-byte TTFT timeout (5s ghosting guard triggered).
- 🚀 `[BOOT]` — Gateway startup banner and key pool initialization.
- 💥 `[ERROR]` — Gateway route dispatch error or unexpected exception.

---

## 2. Health & Reset Endpoints

### 1. Health Probe (`GET /health`)
```bash
curl -sk https://localhost:7766/health
# Returns HTTP 200 OK:
# {"status":"healthy","uptime":120.45,"timestamp":"2026-08-17T13:30:00.000Z"}
```

### 2. Hard Flush / Key Unfreeze (`POST /reset`)
To immediately clear all in-memory cooldowns and reload API key pools from disk without restarting the process:
```bash
curl -sk -X POST https://localhost:7766/reset
# Returns HTTP 200 OK:
# {"status":"ok","message":"Hard reset successful. Cooldowns and key pools reloaded.","timestamp":"..."}
```

---

## 3. Common Error Patterns & Resolutions

### Pattern 1: `HTTP 401 Unauthorized: Invalid API key directive`
- **Symptom**: Requests fail immediately with `invalid_api_key` error.
- **Cause**: Client passed a malformed key directive.
- **Fix**: Directives must follow either the 5-token format `lr-<provider>-<payload>-<completions>-<nuances>` (e.g. `lr-nv-oa-ch-no`, `lr-or-cl-ms-dp`) or fusion format `lr-fse-<preset>`.

### Pattern 2: `HTTP 429 Too Many Requests: All API keys are cooling down`
- **Symptom**: All keys for a provider are cooling down after repeated upstream rate limits.
- **Fix**: Run `curl -sk -X POST https://localhost:7766/reset` to unfreeze keys, or add additional keys to `.env.local`.

### Pattern 3: `HTTP 400 Bad Request: Validation: Unsupported parameter(s): prompt_cache_key`
- **Symptom**: Upstream provider (e.g. NVIDIA NIM) rejects client-specific cache parameters.
- **Fix**: Handled automatically in `src/transformers/payload.ts` via `scrubUnsupportedParameters`, which strips `prompt_cache_key`, `prompt_cache_retrieval`, and `prompt_cache_reset` prior to upstream dispatch.

### Pattern 4: Upstream Ghosting / Silent Hang (`NoResponseError`)
- **Symptom**: Upstream provider accepts TCP handshake but stalls without emitting tokens.
- **Fix**: `fetchWithTtftGuard` triggers an abort after 5000ms and immediately rotates to Key #2 with zero cooldown penalty.

### Pattern 5: Anthropic Tool Format Errors on OpenRouter (`Unknown server-tool shorthand`)
- **Symptom**: Calling `/v1/messages` with `@ai-sdk/anthropic` returns 400 on OpenRouter.
- **Fix**: Handled in `src/handlers/anthropic_compat.ts` by preserving native Anthropic tool schemas (`{ name, description, input_schema }`) without wrapping in `{ type: "function", ... }`.

### Pattern 6: `Error: Decode error (200 POST /v1/messages)` / Mid-Stream Connection Cut
- **Symptom**: Client receives HTTP 200 but fails with a JSON/SSE decode error during long reasoning or thinking pauses (e.g. `dots-studio/dots-3-note-preview:free`).
- **Cause**: Bun's native HTTP server defaulting to a 10s socket idle timeout (`[Bun.serve]: request timed out after 10 seconds`).
- **Fix**: Set `LITEROUTER_IDLE_TIMEOUT=60` in `.env` and pass `idleTimeout: env.LITEROUTER_IDLE_TIMEOUT_SEC` in `Bun.serve({ ... })` in `src/index.ts`. Ensure `KEEPALIVE_INTERVAL_MS` is actively emitting SSE `: keep-alive\n\n` comments.

### Pattern 7: `Decompression error: ZlibError` in Claude Code / Bun Clients
- **Symptom**: Claude Code CLI or Bun-compiled clients throw `Decompression error: ZlibError` to stderr during streaming SSE or tool calling.
- **Cause**: Bun's native `fetch()` sends `Accept-Encoding: gzip, deflate, br` and encounters parser errors on empty/flush chunked gzip frames in SSE streams.
- **Fix**: LiteRouter enforces `Accept-Encoding: identity` on all upstream requests in `fetchWithTtftGuard` and sanitizes downstream response headers via `sanitizeDownstreamHeaders()` (stripping `content-encoding`, `transfer-encoding`, etc.).

### Pattern 8: In-Flight Error Classification & Upstream Key Failover
- **Symptom**: Upstream provider returns HTTP 400 "Provider returned error", HTTP 429 rate limit/quota error, HTTP 401/403 bad key, or HTTP 5xx server error.
- **Handling**: Handled automatically in `src/network/classifier.ts` via `classifyUpstreamError`:
  - **Retryable 400**: Retries in-flight up to 3 times (0s quarantine).
  - **HTTP 429 Quota / Credit Exhaustion**: Retries next key, quarantines exhausted key for 7 days (`604,800s`).
  - **HTTP 429 Rate Limit**: Retries next key, quarantines using parsed `Retry-After` / `x-ratelimit-reset`.
  - **HTTP 401 / 403 Auth Error**: Retries next key, quarantines bad key for 7 days (`604,800s`).
  - **HTTP 5xx Server Error**: Retries next key, quarantines key for 10s.
  - **Client Errors (400 Context Length, 404, Safety)**: Fails fast immediately with 0s quarantine to return the actionable error directly to the caller.

### Pattern 9: Network & Transport Layer Failures (Pre-Stream Socket Errors, TCP RST, GOAWAY, `ConnectTimeout`)
- **Symptom**: Outbound upstream connection fails prior to stream establishment due to network hiccups, TCP reset (`ECONNRESET` / `ReadError`), HTTP/2 GOAWAY frame from edge load balancers (`RemoteProtocolError`), or connect timeouts (`ConnectTimeout` / `ConnectError`).
- **Handling**: `fetchWithTtftGuard` in `src/network/fetcher.ts` intercepts pre-stream transport exceptions (unless caused by downstream client abort) and wraps them into `NoResponseError("Network transport failure: ...")`. Upstream execution loops catch `NoResponseError`, report failure on the current key, and rotate in-flight to the next pooled active key (up to 3 attempts) with 0s cooldown, preventing unhandled transport drops from bubbling up to the client.
