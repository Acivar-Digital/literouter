# Changelog

All notable changes to LiteRouter will be documented in this file.

## [3.3.9] — 2026-08-08

### Added / Fixed
- **Historical Assistant Reasoning Sanitization & Context Bloat Prevention** — Added `sanitizeHistoricalMessages` in `src/transformers/payload.ts` and integrated it into `src/handlers/openai_compat.ts`. Before upstream dispatch, prior assistant turns have volatile reasoning fields (`reasoning_content`, `reasoningContent`, `thought`, `thought_summary`) stripped to prevent cumulative context bloat and token cost spikes during multi-turn agent sessions.
- **Universal Assistant Content Normalization** — Updated `sanitizeHistoricalMessages` so that any `role: "assistant"` message with `content: null` or `content: undefined` normalizes to `content: ""` (empty string), preventing `400 Bad Request` schema rejections from strict upstream providers (Anthropic, DeepSeek, OpenRouter) on empty assistant turns or tool-calling turns.
- **Configurable Environment Toggle** — Added `LITEROUTER_STRIP_REASONING` in `src/config/env.ts` (defaults to `true`), supporting flexible boolean string parsing (`"false"`, `"0"`, `"no"`, `"off"` to disable).
- **Unit Test Coverage** — Added comprehensive unit tests in `tests/unit/core/gateway.test.ts` covering assistant reasoning stripping, null content normalization (with and without tool calls), and toggle bypass.

## [3.3.8] — 2026-08-01

### Added / Fixed
- **0-Token Content Token Inspection & Immediate Resend** — Updated `fetchWithFirstByteTimeout` in `src/network/fetcher.ts` to hold HTTP 200 OK headers and inspect incoming SSE chunks for actual content tokens (`delta.content`, `delta.reasoning_content`, `delta.thought`, `delta.tool_calls`, or Gemini `parts[].text`). If an upstream stream returns 0 content tokens (e.g. metadata-only chunks `{"role":"assistant","content":""}`) within `LITEROUTER_NO_RESPONSE_TIMEOUT` (5s), it throws `NoResponseError("upstream sent 0 content tokens")` **before** flushing HTTP headers to downstream.
- **Idle Stream Detection & Immediate Resend** — Extended `fetchWithFirstByteTimeout` to monitor the upstream stream for idle timeouts after the first content token arrives. If no chunk is received within `LITEROUTER_STREAM_IDLE_TIMEOUT_MS` (default 30s), throws `NoResponseError` — same retry path as 0-token ghosting (immediate key rotation, 0ms delay, no cooldown).
- **Immediate 0ms Key Resend on Ghosting** — Caught `NoResponseError` in `src/handlers/openai_compat.ts` and `src/handlers/google_native.ts` now triggers an immediate `continue` in the retry loop with **0ms delay**, instantly resending the request to Key #2 without locking or placing Key #1 in Valkey cooldown.
- **Disambiguated Key Logging** — Updated key logging format across all handlers from `activeKey.substring(0, 6)...` to `...${activeKey.slice(-6)}`, ensuring rotated keys in the pool are immediately distinguishable in terminal logs.
- **Removed Transformer-Level Idle Timeout** — Removed idle timeout handling from `createStreamTransformer` in `src/transformers/payload.ts` and the inline idle timer in `src/handlers/google_native.ts`. Idle timeout is now handled entirely at the `fetchWithFirstByteTimeout` level in `src/network/fetcher.ts`.

## [3.3.7] — 2026-07-31

### Fixed
- **First-Chunk Verification for Streaming Responses** — Fixed an issue where upstream providers (such as OpenRouter free tier models) return 200 OK HTTP headers but fail to send any body chunks within the timeout window. `fetchWithFirstByteTimeout` in `src/network/fetcher.ts` now waits for the first actual body chunk before resolving 200 OK. If upstream returns 200 OK headers but zero body bytes within `LITEROUTER_NO_RESPONSE_TIMEOUT` (5s), it throws `NoResponseError`, triggering key rotation and failover before headers are sent to downstream clients.
- **Mid-Stream Inter-Chunk Idle Timeout** — Added `LITEROUTER_STREAM_IDLE_TIMEOUT_MS` (default 30s) in `src/config/env.ts` and updated stream transformers (`src/transformers/payload.ts` & `src/handlers/google_native.ts`). If an upstream stream stalls mid-generation without emitting a chunk for 30s, LiteRouter terminates the stream cleanly with `data: [DONE]\n\n` instead of hanging client sockets indefinitely or injecting malformed error payloads.
- **SSE Keep-Alive Comments** — Added periodic `:\n\n` keep-alive comment injection into both stream transformers (`payload.ts` and `google_native.ts`) every 15 seconds. This prevents downstream SSE clients (e.g. openCode) from triggering their own idle timeouts during slow upstream responses where tokens arrive infrequently.

## [3.3.6] — 2026-07-29

### Fixed
- **Automatic Valkey/Redis State Flush on Gateway Boot** — Updated `router.connect()` in `src/index.ts` to automatically execute `await this.redis.flushAll()` during startup. This ensures that starting or restarting the gateway via `bun run src/index.ts`, `scripts/start.sh`, or `scripts/restart.sh` always flushes residual key rate-limits, cooldown ZSETs, and 7-day 403 quarantine states, resetting all provider API keys for fresh execution.

## [3.3.5] — 2026-07-27

### Added
- **Google Models Added & Updated** — Tested Google API keys against candidate Gemini 2.5 and 3.x Flash models. Added/updated supported models in `models.json`:
  - `google/gemini-2.5-flash` (`upstream_id: gemini-2.5-flash`)
  - `google/gemini-2.5-flash-lite` (`upstream_id: gemini-2.5-flash-lite`)
  - `google/gemini-3-flash` (`upstream_id: gemini-3-flash-preview`)
  - `google/gemini-3-flash-preview` (`upstream_id: gemini-3-flash-preview`)
  - `google/gemini-3.5-flash` (`upstream_id: gemini-3.5-flash`)
  - `google/gemini-3.5-flash-lite` (`upstream_id: gemini-3.5-flash-lite`)
  - `google/gemini-3.6-flash` (`upstream_id: gemini-3.6-flash`)
### Changed
- **`pydantic/google` Fusion Chain Updated** — Removed Gemma models and updated `fusion.json` to chain 7 Gemini models starting with `google/gemini-3.5-flash-lite` and `google/gemini-3.1-flash-lite` as primary workhorses:
  1. `google/gemini-3.5-flash-lite`
  2. `google/gemini-3.1-flash-lite`
  3. `google/gemini-3.6-flash`
  4. `google/gemini-3.5-flash`
  5. `google/gemini-3-flash-preview`
  6. `google/gemini-2.5-flash`
  7. `google/gemini-2.5-flash-lite`
- **Updated Skill Playbook & Docs** — Documented Antigravity Agent (`antigravity-preview-05-2026`) distinction vs standard completion models (Antigravity is an Agent execution harness requiring Google's `/v1beta/interactions` API rather than text `:generateContent` endpoints). Updated `.opencode/skills/literouter-playbook/SKILL.md`, `troubleshoot.md`, and `setup.md`.

## [3.3.4] — 2026-07-24

### Added
- **Model `openrouter/inclusionai/ling-3.0-flash:free`** — Added Inclusion AI `ling-3.0-flash:free` to the OpenRouter provider registry (`models.json`) with `context: 200000`, `max_output: 65536`. Synced to `opencode.json` under `provider.literouter.models`.

### Fixed
- **Gateway Retry Logic (Max Attempts & Round Backoff)** — Fixed a critical infinite loop and busy-wait bug during rate limit failovers (issue literouter-p1h):
  - Removed an incorrect `attempt < maxAttempts` condition inside the "All keys exhausted" handler that was swallowing the error and causing a ~24s busy-wait instead of executing the intended round backoff ladder (e.g. 65s wait for quota limits).
  - Added an `allKeysExhausted` state tracker to the round loop. If a request hits `LITEROUTER_MAX_ATTEMPTS` but doesn't actually exhaust all available keys, the gateway now correctly breaks the round loop and fails the request instantly with HTTP 429 ("Max attempts exhausted"), preventing infinite downstream request spam.
  - **Enforced `MIN_ROTATE_DELAY_MS` between rotation attempts**: Added missing delay logic at the end of the attempt loop to ensure `getProviderDelayMs` (with its 2s hard floor) is respected between rotating keys on sequential 429s/500s. Previously, keys were rotated instantly, leading to provider burst-firing.

## [3.3.3] — 2026-07-21

### Added
- **Model `openrouter/poolside/laguna-s-2.1:free`** — Added Poolside `laguna-s-2.1:free` to the OpenRouter provider registry with `context: 200000`, `max_output: 65535`. Synced to `opencode.json` under `provider.literouter.models`.
- **502 transient retry** — When an upstream returns HTTP 502 (bad gateway / proxy-layer hiccup), the same key is retried once with a 1.5s delay and no cooldown, following the G3 grace-retry pattern. A 502 means the proxy/load-balancer rejected the request before the model saw it — rotating keys doesn't help (they all hit the same edge). If the retry also 502s, it falls through to normal error handling (cooldown + rotation). See `src/index.ts` line 942.

## [3.3.2] — 2026-07-20

### Added
- **Silent-upstream (no-response ghost) detection** — New `fetchWithFirstByteTimeout` + `NoResponseError` in `executeOpenAICompat` (all non-Google OpenAI-compat providers: OpenRouter/NVIDIA/Zen). If an upstream sends **zero bytes/headers within 5s** (`LITEROUTER_NO_RESPONSE_TIMEOUT`, default 5s), the request is aborted and the key rotates to the next one after a `LITEROUTER_NO_RESPONSE_RETRY_DELAY` (default 5000ms) wait. Crucially this is **NOT a cooldown** — the provider gave no backoff signal (no status, no Retry-After), so the key is not penalized. Covers the NVIDIA edge case where the first request is black-holed but an immediate retry on another key succeeds. If all keys ghost, the loop falls through to the existing 300s generic timeout → 502. Google-native (`executeGoogleNative`) is intentionally excluded.

### Changed
- `executeOpenAICompat` upstream `fetch` now routes through `fetchWithFirstByteTimeout` instead of a bare `fetch`.

## [3.3.1] — 2026-07-17

### Added
- **Model `nvidia/thinkingmachines/inkling`** — Added Thinking Machines `inkling` to the NVIDIA provider registry (`models.json`) with `upstream_id: thinkingmachines/inkling`. Synced to `opencode.json` under `provider.literouter.models`. `context` (1048576) sourced from OpenRouter catalog via `gather_model_details.py`; `max_output` remains a manual placeholder (OpenRouter returns `max_completion_tokens: None` for this model).
- **Model `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`** — Added NVIDIA `nemotron-3-ultra-550b-a55b:free` to the **OpenRouter** provider registry (`models.json`, `provider: openrouter`) — OpenRouter-hosted, NOT NVIDIA-direct. Synced to `opencode.json` under `provider.literouter.models` (`context: 256000`, `max_output: 65536`).
- **Standardized model-settings extraction** — Deleted redundant `scripts/sync_model_context.py`. `scripts/gather_model_details.py` is now the single extraction pipeline: it fetches the OpenRouter catalog (`/api/v1/models`, keyless), applies the `:free`/`-free` suffix strip + `ORG_MAP` org-remap, matches every non-google provider (incl. nvidia), and writes `context`/`max_output` back into `models.json`. OpenRouter is the canonical source; Hugging Face and NVIDIA-native APIs were evaluated and rejected (they don't expose these fields reliably).

### Removed
- **Legacy gateway route `/v1beta/openai/chat/completions`** — redundant alias of `/v1/chat/completions` (both dispatched to `executeOpenAICompat`); no client or integration test targeted it (OpenCode uses the native `/v1beta/models/{model}:{action}` path, pydantic-ai uses `/v1`). `/v1/chat/completions` is now the sole OpenAI-compat entry point. The *upstream* Google OpenAI-compat endpoint (`PROVIDER_API_URLS.google`) is unchanged and remains the forward target for Google-via-`/v1` requests.

## [3.3.0] — 2026-07-17

### Added
- **Streaming `usage` + TTFT extraction (observability)** — The streaming `TransformStream` now peeks at each SSE chunk (inline, no buffering) and extracts token `usage` (`usage` for OpenAI-compat, `usageMetadata` for Google-native), plus Time-To-First-Token (request-start → first byte). For OpenAI-compat streaming we now inject `stream_options.include_usage: true` so providers actually emit the final usage chunk. Extracted usage is sunk to logs (`[USAGE]` / `[TTFT]`) and accumulated per provider+model in Redis (`usage:{provider}:{model}`, 30d retention) via `router.recordUsage`. Non-streaming responses are extracted the same way. **No response bytes are altered and no quota-enforcement change occurs** — this is observability only.
- **Smart cooldown (reason-aware backoff)** — Derived from a cross-repo study of three rotation gateways (design: `docs/IMPL_smart_cooldown.md`):
  - **G1 — honour upstream reset delay**: `reportError` now accepts a `ttlOverride`; the `>=400` handler parses `Retry-After` and Google `quotaResetDelay`/`retryDelay` to set a precise cooldown (clamped 5–7200s) instead of a fixed constant.
  - **G2 — reason-aware outer backoff**: the all-keys-exhausted backoff ladder is chosen by failure class — quota (429) uses `[65s, 90s, 120s]`, transient (5xx/timeout) uses a shorter `[8s, 15s, 30s]`.
  - **G3 — grace retry**: when an upstream says "retry in ≤2s", the **same** key is retried once after a short buffer instead of burning a rotation (distinct from the client-abort 499 no-op).
  - **G4 — 5xx TTL alignment**: `500`/`502` now share the 10s transient cooldown previously reserved for `503`/`504`/`timeout` (was 30s default).

### Safety (provider firewall / Google 15rpm protection)
- **Hard 2s floor on key-attempt delay** — `getProviderDelayMs` / `getMinDelayMs` now enforce `MIN_ROTATE_DELAY_MS = 2000`; a `GOOGLE_MIN_DELAY_MS=0` (or `LITEROUTER_ROTATE_DELAY_MS=0`) can no longer zero the gap between retries, so we never burst-fire a provider endpoint (firewall ban risk). Default gap remains 10s.
- **Rate-limit (429) cooldown floored at 65s** — `reportError` now clamps a 429 `ttlOverride` to `max(parsedReset, 65)`. A Google key that hits the 15rpm limit is therefore NEVER re-hit sooner than 65s, so the rolling quota window can decay instead of being re-fed and blocked forever. Longer upstream `Retry-After` values are still honoured.
- **Flat 65s floor on ANY Google error** — `reportError` now enforces `max(ttl, 65)` whenever `provider === "google"`, covering 5xx/timeout/transient errors too (Google is strict: 15rpm/model, per-key pools, and a 5xx often precedes a rate-limit block). Non-Google providers keep their existing tiered TTLs.
- **G3 grace-retry scoped to non-429** — the same-key retry-on-`reset<=2s` now explicitly excludes `429` (and only fires when `reset <= 2s`, with a `max(reset,2)s + 1.5s` wait), so a rate-limited key always rotates. (Previously the 5s clamp made G3 a no-op; it is now functional but rate-limit-safe.)

### Changed
- `createStreamTransformer` now accepts an optional `StreamMeta` for observability sinks.
- `reportError` signature gained an optional `ttlOverride?: number | null` (backward compatible).
- `parseResetDelay` now returns the RAW reset value (callers clamp); the 5–7200s safety clamp moved into `reportError` and the 2s floor into the grace-retry wait.

## [3.2.0] — 2026-07-17

### Added
- **Client-disconnect propagation** — Upstream `fetch` now composes the incoming client `AbortSignal` with the server-side HTTP timeout via `upstreamSignal()` (`src/index.ts`). When a user hits "Stop" or closes the connection, the upstream generation is **cancelled immediately** instead of burning tokens until the timeout fires. Algorithm: `AbortSignal.any([req.signal, AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS)])`, threaded through `executeFusion` → `executeOpenAICompat` / `executeGoogleNative` → both upstream `fetch` sites.
- **User-abort = no-op (decision A)** — When `signal?.aborted` is true in the execute `catch` blocks, the error is treated as a non-fatal client disconnect: `router.reportError` / circuit-breaker cooldown is **skipped** and a `499 Client Closed` is returned. A healthy upstream is never penalized for an impatient user. Validated against Envoy/AgentGateway's implicit Rust `Drop` / `RST_STREAM` mechanism (our `AbortSignal` is the correct Bun translation).

### Changed
- `executeOpenAICompat`, `executeGoogleNative`, and `executeFusion` gained an optional `signal?: AbortSignal` parameter (defaulting to the timeout-only signal when absent, so existing call paths are unchanged).

## [3.1.0] — 2026-07-16

### Added
- **Emoji state logging** — Terminal logs now carry intuitive per-state emoji prefixes for faster visual scanning (🔵 inbound request, 🔄 rotate/backoff, ⚠️ provider limit, 🔴 system limit exhausted, 🟢 served, 🔗 fusion, 🚀 boot, 📝 trace, 💥 error). Existing text tags (`[REQ]`, `[PROVIDER_LIMIT]`, `[FUSION]`, etc.) are preserved for grep-ability.
- **Request trace archive** — Every request is assigned a `crypto.randomUUID()` `reqId` threaded through all handlers and the fusion chain. Raw **downstream** (request body sent upstream) and **upstream** (provider response) payloads are matched by `reqId` and written to `logs/traces/<reqId>.json` for post-crash investigation. Writes are non-blocking (fire-and-forget, `0600` perms) to avoid I/O lag on the request path; there is no in-memory buffer (files are the sole archive). The `logs/traces/` directory is cleared at every boot via `clearTraces()`, mirroring the Valkey flush.

## [3.0.0] — 2026-07-16

### Architecture — Single Bun Process (BREAKING)

LiteRouter has been consolidated from three processes (Python `:7766` + TypeScript `:7767` + Fusion sidecar `:7768`) into a **single Bun/TypeScript process** on port `:7766`. This eliminates the Python gateway, the fusion sidecar, and all inter-process coordination.

### Added
- **In-process fusion runtime** — Fusion groups now run inside the main Bun process instead of a separate sidecar. Circuit breaker (65s), sticky fallback (300s), and `X-Literouter-Model` response header preserved.
- **ZSET+Lua atomic quota** — True rolling 60s windows via Redis/Valkey Lua script (no minute-edge bursts). Member format `{timestamp}-{random}:{tokens}` prevents collisions.
- **Per-request backoff** — When all keys for a provider are exhausted, backs off 65s → 90s → 120s before returning 429.
- **Google native route** — `/v1beta/models/{model}:{action}` with query-param auth.
- **Reasoning normalization** — `LITEROUTER_COLLAPSE_REASONING` env flag collapses `reasoning_content`, `reasoningContent`, `thought` into `<thought>` tags.
- **LaTeX symbol cleaning** — Normalizes `\rightarrow`, `\to`, `\times` → Unicode on all responses.
- **Gemma payload scrubbing** — Recursively strips `thinkingConfig`/`thinking_config` from Gemma requests.
- **Verbose request logging** — Every request logs `[REQ]`, `[GOOGLE] Served`, `[FUSION]` with model, provider, key prefix, and upstream details.

### Changed
- **scripts/start.sh** — Single `bun run ts-src/src/index.ts` instead of 3-process launch. Port reads from `LITEROUTER_PORT` env var (default `7766`).
- **scripts/stop.sh** — Single-process teardown. No more separate Python/fusion sidecar cleanup.
- **scripts/restart.sh** — Simplified to stop + flush + start.
- **Port** — Server now runs on `:7766` by default (was `:7767` for TS proxy).
- **Logging** — All runtime logs stream to the single `literouter` tmux session.

### Removed
- **Python gateway** (`src/main.py`, `src/config.py`, `src/router.py`, `src/rate_limiter.py`, `src/metrics.py`, `src/anthropic.py`, `src/gemini.py`, `src/queue.py`, `src/embed_cache.py`, `src/redis_client.py`, `src/doctor.py`) — All Python source files removed.
- **Fusion sidecar** (`fusion.py`) — Fusion is now in-process.
- **Python dependencies** (`uv.lock`, `pyproject.toml` deps) — No longer needed.
- **status.sh** — No longer relevant (single-process health checked via `/health`).

### Fixed
- **Fusion fallthrough fix** — `fromFusion` check added after inner loop (not just catch block). When individual keys return 429 (not "all keys exhausted"), fusion chain falls through immediately without trying more keys across rounds. Stopped extra key burns.
- **Real RPM counter in logs** — `getAvailableKey` now returns `currentRpm` from the Lua script's ZSET count. Success logs show `rpm X/15` (per-key, starts at 1). `[PROVIDER_LIMIT]` logs show the same.
- **Verbose logging restored** — `attempt X/Y`, `[PROVIDER_LIMIT]`, `[SYSTEM_LIMIT]` logs all active on both native and OpenAI-compat routes.
- **Native route transparent pass-through** — `cleanGemmaPayload` removed from native route (`/v1beta/`). OpenAI-compat route (`/v1/`) still scrubs `thinkingConfig`. Native route now passes request body unchanged to Google.
- **Standardized key rotation delay to 10s** — Removed `GOOGLE_MIN_DELAY_MS=2000` override. All providers now use `LITEROUTER_ROTATE_DELAY_MS=10000`.
- **Telemetry sanitization** — Removed raw request body dumps from native logging. Logs now only capture metadata.
- **Port consistency** — `start.sh` now reads port from `.env` `LITEROUTER_PORT` instead of hardcoding.

## [3.1.0] — 2026-07-16

### Added
- **Thought signature support** — Google's OpenAI-compat endpoint requires `thought_signature` in `tool_calls[0].extra_content.google.thought_signature` for function calling. Proxy extracts it from Google's response (both streaming SSE and non-streaming), stores in-memory keyed by tool_call ID, and re-injects on the next request. Both `/v1beta/` (native) and `/v1/` (OpenAI-compat) routes support tool calls with Google models. Fully transparent — no client-side changes.
- **Expanded Gemma payload sanitization** — `cleanGemmaPayload` now also strips `presence_penalty`, `frequency_penalty`, `logit_bias`, `user`, `seed`, `logprobs`, `top_logprobs` (prevents Google 500 Internal Error on Gemma 4 models via OpenAI-compat route).
- **Gemini flash integration tests** — 5 tests covering native pass-through, OpenAI-compat pass-through, tool calls via native route (Pydantic AI Google SDK), and tool calls via OpenAI-compat route (Pydantic AI OpenAI SDK).

### Fixed
- **Verbose logging cleaned** — Removed `body=${errSnippet}` from `[PROVIDER_LIMIT]` log lines (no more request/response body dumping).
- **conftest.py** — Stripped broken Python gateway singleton reset fixture (modules no longer exist in Bun-only architecture).

## [2.9.3] — 2026-07-10

### Added
- **setup_checklist.md** — New executable checklist document with task-item workflows for Add Model, Delete Model, Add Provider, Delete Provider operations. Includes explicit approval gates, file naming patterns, and verification criteria.

### Changed
- **setup.md** — Simplified to technical reference; checklists moved to setup_checklist.md for executable workflows.

### Removed
- **admin/studio/** — Deleted redundant outsource pipeline staging folder (contained stale model reference for dead `laguna-xs.2:free`)

## [2.9.2] — 2026-07-08

### Added
- **Fusion Sidecar Service** — Introduced `fusion.py` (port `7768`), a lightweight proxy that implements priority-based model fallback chains. It enables "virtual" models (e.g., `local/google`) that automatically fail over from primary to secondary models upon `429` or `5xx` errors from the main gateway.

### Fixed
- **Longrunning Mode (Sticky Fallback)** — Verified implementation of the sticky fallback mechanism in `fusion.py` to ensure priority chains correctly "stick" to successful models for 5 minutes, preventing wasteful retries of rate-limited primaries.
- **Gemma Payload Sanitization** — Fixed engine crashes for Gemma models when using the OpenAI compatibility route (`/v1/chat/completions`) by applying `_clean_gemma_payload` to strip prohibited `thinkingConfig` fields.

## [2.9.1] — 2026-07-08

## [2.9.0] — 2026-07-08

### Fixed
- **Atomic Quota Management** — Replaced "Check-then-Act" rolling window with an atomic Redis Lua script. This eliminates race conditions where multiple concurrent requests could bypass rate limits (boundary bursting).
- **Router Hardening** — Added `NoScriptError` handling for Lua scripts to ensure the proxy recovers automatically after Redis restarts.
- **Key Rotation Fixes** — Implemented cascade protection in `report_error` and integrated `REDIS_DB` configuration for better database isolation.

## [2.8.0] — 2026-06-21

### Added
- **Do Not Assume Directive** — Added explicit documentation of local vs VPS configuration logic and the active target verification.
- **Housekeeping** — Cleaned up untracked test scripts (`test_curl_rotation.py`).

## [2.7.0] — 2026-06-20

### Added
- **Zen Models Configuration** — Added tracking and metadata for Zen models (`big-pickle`, `deepseek-v4-flash-free`, `mimo-v2.5-free`, `qwen3.6-plus-free`, `minimax-m3-free`, `nemotron-3-ultra-free`, `north-mini-code-free`) in `models.json`.

### Fixed
- **Configuration Fixes** — Fixed trailing commas in `opencode.json` configuration and added `User-Agent: LiteRouter/2.2` header to `src/doctor.py` to prevent validation rejections.

## [2.6.0] — 2026-06-18

### Added
- **Mandatory `@ai-sdk/openai-compatible` SDK Integration** — Established the requirement to configure OpenCode with the compatible SDK. This forces the client to hit standard `/v1/chat/completions` natively rather than the ACP `/v1/responses` endpoint, making the proxy robust by omitting complex in-flight protocol translation.

### Fixed
- **Multi-turn tool calling 400 errors** — Fixed an issue where upstream providers (OpenRouter, Nvidia) returned 400 Bad Request on multi-turn conversations. This was caused by ACP `function_call` and `function_call_output` items lacking a `role` field. The sanitizer now properly converts these to the standard OpenAI `tool_calls` format.
- **Tool call streaming fixes** — Resolved `ZodValidationError: expected object, received undefined` and SSE stream corruption by bypassing protocol translation entirely for tool-calling models via the compatible SDK.
- **Uvicorn read timeout** — Increased upstream read timeout limit to 300s to support slow/complex reasoning models.


## [2.5.0] — 2026-06-18

### Architecture — Multi-Provider Routing

LiteRouter now supports **multiple upstream providers** through a single endpoint. Requests are routed based on the model prefix:

| Prefix | Provider | Upstream |
|--------|----------|----------|
| `openrouter/` | OpenRouter | `openrouter.ai/api/v1` |
| `nvidia/` | Nvidia | `integrate.api.nvidia.com/v1` |
| `anthropic/` | Anthropic | `api.anthropic.com` |

Each provider has its own independent key pool, rotation counter, health tracking, and rate limiting.

### Added
- **Multi-provider support** — Add as many providers as you want via `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS` in `.env`
- **Model prefix stripping** — Provider prefix (e.g., `nvidia/`) is automatically stripped before forwarding to the upstream API
- **Nvidia provider** — Pre-configured Nvidia integration with 6 API keys
- **OpenCode integration docs** — README updated with `opencode.json` configuration example

### Changed
- **Model passthrough** — Client's model ID is never overwritten by config defaults (previously `OPENROUTER_MODEL` would override the request)
- **Extra params injection** — Config-level `temperature` etc. only apply if the client didn't already set them
- **start.sh** — Uses `nohup` + `disown` for proper daemon persistence
- **Streaming error responses** — Use proper JSON serialization instead of string concatenation

### Removed
- **Debug logs** — Removed noisy `[debug] RAW BODY`, `[debug] OUTBOUND PAYLOAD`, `[debug] TRANSFORMED ANTHROPIC PAYLOAD` log lines that leaked request content

## [2.4.0] — 2026-06-13

### Added
- **`/v1/responses` endpoint** — Added support mapping to `chat_completions` for newer OpenCode compatibility.
- **OpenCode Format Mapping** — Translated `"input"` field to `"messages"` on input, and mapped `"input_text"` content block type to `"text"` for Anthropic Messages compatibility.
- **TUI Integration** — Configured global `opencode.json` with `openrouter/owl-alpha` as `Owl-Alpha (Literouter)`.

## [2.3.0] — 2026-06-13

### Added
- **Project Initialization** — Synced optional and dev dependencies via `uv sync --all-extras`.
- **VPS Redis Verification** — Successfully verified connectivity and authentication with Redis Enterprise running in Docker on the remote VPS (10.32.34.243:12000).

## [2.2.0] — 2026-05-18

### Architecture — Clean Template + Provider Selection

Replaced the complex auto-detection system with three explicit pathways configured in `.env`:

| Template   | Provider   | Endpoint                              |
|------------|------------|---------------------------------------|
| `anthropic`| `anthropic`| Native Anthropic SDK → `/messages`    |
| `anthropic`| `openrouter`| Anthropic format → OR `/messages`   |
| `openai`   | `openrouter`| OpenAI format → OR `/chat/completions`|

Configure via:
```env
LITEROUTER_TEMPLATE=anthropic   # or openai
LITEROUTER_PROVIDER=openrouter  # or anthropic
```

### Added
- **`/v1/models` endpoint** — Queries OpenRouter's live model list (356+ models with context lengths and pricing)
- **Anthropic streaming** — Full SSE conversion from Anthropic event stream → OpenAI chunk format
- **`build_anthropic_request_body()`** — Converts OpenAI chat format → Anthropic Messages API format (system extraction, tool_calls mapping)
- **In-memory rate limiter fallback** — Works when Redis is down instead of allowing all calls
- **Lua script atomic rate limiting** — Pre-registered Redis Lua script for atomic check-and-set
- **PID file management** — `start.sh`, `stop.sh`, `restart.sh`, `status.sh` with `.literouter.pid` tracking
- **Test suite** — 9 test files covering config, router, rate limiter, Anthropic, streaming, models, embed cache, integration

### Changed
- **Router counter** — Atomic `INCR` instead of separate GET + INCR (race condition fix)
- **Rate limiter** — Falls back to in-memory when Redis is down (was: always ready=true)
- **Config scanner** — Skips providers with empty API keys (prevents phantom providers from shell env pollution)
- **Redis default host** — Changed from hardcoded `10.32.34.243` to `localhost`
- **OpenRouter base URL** — Restored to `https://openrouter.ai/api/v1` (was incorrectly changed to `/api`)

### Fixed
- **Model name prefix stripping** — OpenRouter keeps full `provider/model` format; Anthropic strips prefix
- **Memory counter drift** — In-memory fallback counter increments by actual offset
- **Anthropic transformer** — Handles string content (not just arrays), None usage values, preserves reasoning_tokens
- **`is_anthropic_model()`** — No longer matches `claudex` (requires `claude-` with hyphen)
- **Shell env pollution** — VS Code/Claude Code `ANTHROPIC_*` env vars no longer create phantom providers

## [2.1.0] — 2026-05-18

### Added
- Initial Anthropic response transformer
- Streaming support (SSE pass-through)
- Model name prefix stripping
