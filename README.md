# LiteRouter

**A Python + Redis API key load balancer for LLM providers.**

LiteRouter sits between your application and LLM providers (OpenRouter, Gemini, Anthropic, and others), distributing requests across multiple API keys using intelligent round-robin routing with automatic cooldown, quarantine, and rate limiting.

## Features

- **Provider-centric routing** — Route requests to specific providers (OpenRouter, Gemini, etc.) with key-level load balancing
- **Redis-backed state** — All routing state persisted in Redis for crash recovery and multi-instance coordination
- **Sequential processing** — Built-in request queue ensures ordered, non-overlapping key operations
- **Smart round-robin** — Deterministic key selection with persistent counter across restarts (atomic Redis INCR)
- **Automatic cooldown** — Keys that hit rate limits enter exponential backoff cooldown (60s → 120s → … → 1h max)
- **Quarantine system** — Keys with auth failures (401/403) are permanently quarantined
- **Rate limiting** — Per-provider rate limits with configurable minimum delay; atomic Lua script when Redis is available, in-memory fallback when not
- **Streaming support** — Full SSE streaming pass-through for OpenRouter and Gemini
- **Anthropic support** — Automatic detection and response normalization for Anthropic models routed through OpenRouter
- **Gemini support** — First-class support for Google Gemini with request/response transformation
- **Built-in metrics** — Request counts, error rates, latency tracking, and key health dashboards
- **PID file management** — Start/stop/restart/status scripts with process tracking

## Quick Start

### Prerequisites

- Python 3.11+
- Redis server (local or remote)
- Multiple API keys for your LLM provider(s)

### Installation

```bash
# Clone the repository
git clone https://github.com/Acivar-Digital/literouter.git
cd literouter

# Install dependencies
uv sync

# Copy and configure environment
cp .env.example .env
```

### Configuration

Edit `.env` with your settings:

```env
# Server
LITEROUTER_HOST=0.0.0.0
LITEROUTER_PORT=7766
LITEROUTER_AUTH_KEY=sk-lr-your-auth-key
LITEROUTER_ROTATE_DELAY_MS=2000

# Redis
REDIS_HOST=10.32.34.243
REDIS_PORT=12000
REDIS_DB=0
REDIS_PASSWORD=your-redis-password

# OpenRouter
OPENROUTER_BASE_URL=https://openrouter.ai/api
OPENROUTER_API_KEYS=sk-or-key1,sk-or-key2,sk-or-key3
OPENROUTER_MIN_DELAY_MS=3000
OPENROUTER_MODEL=owl-alpha
OPENROUTER_TEMPERATURE=0.0

# Anthropic (via OpenRouter)
# Use model names like "anthropic/claude-sonnet-4-6" or "claude-sonnet-4-6"
# The Anthropic response transformer kicks in automatically for claude* models
```

### Running

```bash
# Start the server (daemonizes with PID tracking)
./scripts/start.sh

# Check status
./scripts/status.sh

# Restart gracefully
./scripts/restart.sh

# Stop
./scripts/stop.sh
```

Or run directly:

```bash
uv run uvicorn src.main:app --host 0.0.0.0 --port 7766
```

## Usage

### cURL

```bash
# Route a chat completion through OpenRouter
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-lr-your-auth-key" \
  -d '{
    "model": "openrouter/owl-alpha",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Route through Anthropic (via OpenRouter)
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-lr-your-auth-key" \
  -d '{
    "model": "anthropic/claude-sonnet-4-6",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Streaming request
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-lr-your-auth-key" \
  -d '{
    "model": "openrouter/owl-alpha",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

### Python SDK

```python
import httpx

async with httpx.AsyncClient() as client:
    response = await client.post(
        "http://localhost:7766/v1/chat/completions",
        headers={"Authorization": "Bearer sk-lr-your-auth-key"},
        json={
            "model": "openrouter/owl-alpha",
            "messages": [{"role": "user", "content": "Explain quantum computing"}]
        }
    )
    print(response.json())
```

### Health & Metrics

```bash
# Health check with full status (config, router, rate limiter, metrics, Redis)
curl http://localhost:7766/health

# Detailed metrics
curl http://localhost:7766/metrics
```

## Configuration Reference

| Variable | Type | Default | Description |
|---|---|---|---|
| `LITEROUTER_HOST` | string | `0.0.0.0` | Server bind address |
| `LITEROUTER_PORT` | int | `7766` | Server port |
| `LITEROUTER_AUTH_KEY` | string | — | Bearer token required for requests |
| `LITEROUTER_ROTATE_DELAY_MS` | int | `2000` | Default minimum delay between calls per provider |
| `REDIS_HOST` | string | — | Redis server hostname |
| `REDIS_PORT` | int | — | Redis server port |
| `REDIS_DB` | int | `0` | Redis database number |
| `REDIS_PASSWORD` | string | — | Redis password |
| `{PROVIDER}_BASE_URL` | string | — | Upstream API base URL |
| `{PROVIDER}_API_KEYS` | comma-separated | — | API keys for round-robin rotation |
| `{PROVIDER}_MODEL` | string | — | Default model for the provider |
| `{PROVIDER}_MIN_DELAY_MS` | int | — | Per-provider minimum delay between calls |
| `{PROVIDER}_TEMPERATURE` | float | `0.0` | Default temperature |

## Provider Detection

LiteRouter auto-detects provider types based on configuration:

- **OpenRouter** — Detected when `openrouter.ai` is in the base URL
- **Gemini** — Detected when `generativelanguage.googleapis.com` is in the base URL
- **Anthropic** — Detected when the model name starts with `anthropic/` or `claude-`, or contains `claude`

When an Anthropic model is detected through OpenRouter, the response is automatically transformed from Anthropic's Messages API format to OpenAI's `chat.completion` format.

## Project Structure

```
literouter/
├── src/
│   ├── __init__.py          # Package initialization
│   ├── main.py              # FastAPI application entry point
│   ├── config.py            # Environment configuration loader
│   ├── router.py            # Core routing logic and round-robin
│   ├── redis_client.py      # Redis connection management
│   ├── rate_limiter.py      # Per-provider rate limiting (Lua + in-memory fallback)
│   ├── metrics.py           # Request metrics and health tracking
│   ├── anthropic.py         # Anthropic → OpenAI response transformer
│   └── gemini.py            # Gemini request/response adapter
├── tests/
│   ├── conftest.py          # Shared test fixtures
│   ├── test_anthropic.py    # Anthropic transformer tests
│   ├── test_config.py       # Configuration loader tests
│   ├── test_embed_cache.py  # Embedding cache tests
│   ├── test_integration.py  # Integration tests
│   ├── test_model_handling.py  # Model name handling tests
│   ├── test_rate_limiter.py # Rate limiter tests
│   ├── test_router.py       # Router unit tests
│   └── test_streaming.py    # Streaming tests
├── scripts/
│   ├── start.sh             # Start server with PID tracking
│   ├── stop.sh              # Stop server gracefully
│   ├── restart.sh           # Restart with graceful shutdown
│   └── status.sh            # Check if server is running
├── .env.example             # Environment template
├── .literouter.pid          # Auto-generated PID file
├── pyproject.toml           # Python project configuration
├── uv.lock                  # Dependency lock file
├── CHANGELOG.md             # Version history
└── README.md                # This file
```

## Redis Key Schema

| Key Pattern | Type | Description |
|---|---|---|
| `literouter:counter:{provider}` | STRING | Atomic round-robin counter |
| `literouter:cooldown:{provider}:{sha}` | STRING | Cooldown expiry timestamp (TTL: 1h) |
| `literouter:quarantine:{provider}` | SET | Quarantined key hashes |
| `literouter:ratelimit:{provider}` | STRING | Last call timestamp (ms) |

## Multi-Instance Deployment

LiteRouter supports horizontal scaling across multiple instances:

1. **Shared Redis** — All instances connect to the same Redis server for coordinated state
2. **Atomic operations** — Round-robin increments use Redis `INCR` for atomicity
3. **Distributed cooldown** — Cooldown and quarantine states are Redis-backed, visible to all instances
4. **Lua script rate limiting** — Atomic check-and-set via pre-registered Lua script

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Instance 1  │    │ Instance 2  │    │ Instance 3  │
│ :7766       │    │ :7766       │    │ :7766       │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                   ┌──────▼──────┐
                   │    Redis    │
                   │  :12000     │
                   └─────────────┘
```

## License

MIT License — see LICENSE file for details.
