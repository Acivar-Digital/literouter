# Changelog

All notable changes to LiteRouter will be documented in this file.

## [Unreleased]

### Added
- **Streaming support** — Full SSE streaming pass-through for both OpenRouter and Gemini providers
- **Anthropic response transformer** (`src/anthropic.py`) — Converts Anthropic Messages API responses to OpenAI `chat.completion` format
- **PID file management** — `scripts/start.sh`, `scripts/stop.sh`, `scripts/restart.sh`, `scripts/status.sh` now track the server process via `.literouter.pid`
- **In-memory rate limiter fallback** — When Redis is unavailable, rate limiting still works in-process instead of allowing all calls through
- **Lua script atomic rate limiting** — Pre-registered Redis Lua script for atomic check-and-set of per-provider call pacing
- **Test suite** — Full test coverage across config, router, rate limiter, Anthropic transform, streaming, model handling, embed cache, and integration tests

### Changed
- **Router counter** — Uses atomic `INCR` instead of separate GET + INCR, eliminating a race condition
- **Rate limiter** — No longer returns `ready=True` when Redis is down; falls back to in-memory tracking
- **start.sh** — Now daemonizes with `&`, writes PID file, and verifies startup
- **restart.sh** — Complete rewrite: graceful stop with 5s timeout → force kill → start → verify
- **.env.example** — Fixed `OPENROUTER_BASE_URL` (removed trailing `/v1`), updated model name to `owl-alpha`

### Fixed
- **Model name prefix stripping** — Provider prefixes (e.g. `openrouter/`, `anthropic/`) are now stripped before sending to upstream
- **Memory counter drift** — In-memory fallback counter now increments by actual offset instead of wrapping with modulo
