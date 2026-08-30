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

## 2. Health, Diagnostic & Reset Endpoints

### 1. Health Probe (`GET /health`)
```bash
curl -sk https://localhost:7766/health
# Returns HTTP 200 OK:
# {"status":"healthy","uptime":120.45,"timestamp":"2026-08-17T13:30:00.000Z"}
```

### 2. Diagnostic Doctor (`bun run scripts/doctor.ts`)
Run the comprehensive diagnostic suite to inspect local configurations, JSON schemas, server status, and probe live upstream API keys:
```bash
bun run scripts/doctor.ts
```
**Doctor Capabilities & Execution Flow:**
- **Local Files & JSON Schema Validation**: Asserts presence and valid JSON syntax for `config/providers.json`, `config/fusion.json`, and `config/models.json`.
- **Key Pool Audit**: Validates `.env` and `.env.local`, warning on placeholder or corrupted keys (`changeme`, `todo`, `< 5` chars).
- **Local Server Ping**: Probes local LiteRouter `/health` endpoint (`https` then `http`).
- **Live Upstream Key Authentication Probes (FYI-only)**:
  - **Google Gemini**: Probes `gemini-3.1-flash-lite` via `generateContent`.
  - **NVIDIA NIM**: Probes `meta/llama-3.1-8b-instruct` via `/v1/chat/completions`.
  - **OpenRouter**: Probes `openrouter/free:nitro` via `/api/v1/chat/completions`.
  - **Zen**: Probes `zen/hy3-free` via `/v1/chat/completions`.
- **TLS Verification**: Automatically binds `mkcert` root CA (`~/.local/share/opencode2/mkcert/rootCA.pem` or `SSL_CERT_FILE`) into `NODE_EXTRA_CA_CERTS`.
- **Safe 1s Pacing**: Enforces a 1-second sequential delay between probes to prevent triggering upstream rate limits during diagnosis.
- **Non-Blocking Diagnostics**: Runs purely for operator inspection without altering in-memory quotas, setting cooldowns, or gating gateway boot.

### 3. Hard Flush / Key Unfreeze (`POST /reset`)
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

### Pattern 9: Network & Transport Layer Failures & HTTP/2 Zombie Session Purge (TCP RST, `ECONNRESET`, GOAWAY, `ConnectTimeout`)
- **Symptom**: Outbound upstream connection fails prior to or during stream establishment due to network hiccups, TCP reset (`ECONNRESET` / `ReadError`), HTTP/2 GOAWAY frame from edge load balancers (`RemoteProtocolError`), or connect timeouts (`ConnectTimeout` / `ConnectError`).
- **Handling**:
  1. `Http2SessionPool` (`src/network/h2_pool.ts`) maintains permanent `error`, `frameError`, and `close` lifecycle listeners. Any broken, half-closed, or reset socket is instantly purged and destroyed from `this.sessions`, preventing key failover loops from reusing poisoned sockets across key rotation attempts.
  2. `fetchWithTtftGuard` in `src/network/fetcher.ts` intercepts pre-stream transport exceptions (unless caused by downstream client abort) and wraps them into `NoResponseError("Network transport failure: ...")`. Upstream execution loops catch `NoResponseError`, report failure on the current key, and rotate in-flight to the next pooled active key (up to 3 attempts) with a brief 2s transport cooldown, seamlessly recovering downstream traffic without bubbling transport drops up to the client.

### Pattern 10: Mid-Stream In-Band Server Errors (`Server error mid-response. The response above may be incomplete.` / Socket Drops)
- **Symptom**: Upstream provider emits an in-band SSE error payload mid-stream (e.g. `data: {"error": {"message": "Server error mid-response..."}}`) or drops the TCP socket during token generation.
- **Handling**: `isInBandErrorChunk` in `src/network/fetcher.ts` detects server error payloads and suppresses them from leaking to the downstream client. `createResilientStream` invokes `retryProvider`, which isolates the failing key (10s), rotates to the next active key in the pool, re-fetches the request, and transparently streams the response into the open client connection without terminating the IDE/agent session.

### Pattern 11: Rapid Context Window Bloat in OpenCode (300K+ Tokens)
- **Symptom**: Multi-turn sessions in OpenCode2 rapidly consume massive token counts, causing latency degradation or context length exhaustion.
- **Cause**: OpenCode2 beta captures streaming `delta.reasoning` SSE chunks and saves them in SQLite history, re-sending full thinking traces in every subsequent prompt.
- **Handling / Solution**: LiteRouter automatically identifies OpenCode (`isOpenCodeClient`) and strips `delta.reasoning` / `delta.reasoning_content` from SSE streams in flight. If thinking chunks are explicitly desired, append the `ts` nuance to the directive (e.g. `lr-or-oa-ch-ts`). For other clients, reasoning chunks are preserved unmodified by default.

### Pattern 12: OpenCode2 CLI Broken Binary or Missing Executable Post-Update
- **Symptom**: Running `opencode2` fails with command not found, permission denied, or broken symlink errors after npm install/update.
- **Cause**: Upstream `@opencode-ai/cli` creates platform binaries or Windows `.exe` aliases that may lose executable bits or break symlinks in NVM directories.
- **Handling / Solution**: Run `bash scripts/opencode2_autopatch.sh` (or invoke `opencode2` directly, as `/home/yapilwsl/.local/bin/opencode2` executes the self-healing check automatically on every launch). The script verifies paths, syncs binary aliases, generates `.bak` backups, ensures tool message string serialization, verifies network error traps, and restores `chmod +x` permissions in <5ms.

### Pattern 13: Tool Message Array Format Error or Silent Subagent Completion
- **Symptom**: Upstream model rejects `role: "tool"` turns with HTTP 400 (`content must be string`), or a spawned subagent exits with empty success status upon encountering a network hiccup or empty SSE stream.
- **Cause**: Array-based tool response payloads in multi-turn agent history or unhandled `network_error` events in streaming sessions.
- **Handling / Solution**: `scripts/opencode2_autopatch.sh` automatically patches tool message format normalization (ensuring `role: "tool"` content arrays are flattened to strings) and validates network error handling to ensure subagent transport failures fail loudly rather than silently terminating.

### Pattern 14: `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR` or TLS Alert 120 in Node / OpenCode Clients
- **Symptom**: Node.js clients, OpenCode2, or Claude Code fail connecting to `https://localhost:7766` with `UNKNOWN_CERTIFICATE_VERIFICATION_ERROR: unknown certificate verification error` or `SSL alert 120: tlsv1 alert no application protocol`.
- **Cause**: Node's `fetch` (undici) connects with `http/1.1` ALPN by default and requires the local `mkcert` development root CA in its trust store.
- **Handling / Solution**:
  1. Ensure Bun runtime is on **v1.4.0+** (`bun --version`), which natively supports simultaneous `h2` and `http/1.1` TLS ALPN negotiation on port 7766.
  2. Ensure `export NODE_EXTRA_CA_CERTS="${HOME}/.local/share/opencode2/mkcert/rootCA.pem"` is set in your shell profile or wrapper launcher (`~/.local/bin/opencode2`).
  3. If OpenCode was running prior to the TLS/cert refresh, kill any stale background daemon: `pkill -f 'opencode2 serve'`.
