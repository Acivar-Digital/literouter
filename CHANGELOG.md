# Changelog

All notable changes to LiteRouter will be documented in this file.

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
