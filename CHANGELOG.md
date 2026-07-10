# Changelog

All notable changes to LiteRouter will be documented in this file.

## [2.9.3] — 2026-07-10

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
