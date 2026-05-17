# LiteRouter

**A Python + Redis API key load balancer for LLM providers.**

LiteRouter sits between your application and LLM providers (OpenRouter, Gemini, and others), distributing requests across multiple API keys using intelligent round-robin routing with automatic cooldown, quarantine, and rate limiting.

## Features

- **Provider-centric routing** — Route requests to specific providers (OpenRouter, Gemini, etc.) with key-level load balancing
- **Redis-backed state** — All routing state persisted in Redis for crash recovery and multi-instance coordination
- **Sequential processing** — Built-in request queue ensures ordered, non-overlapping key operations
- **Smart round-robin** — Deterministic key selection with persistent counter across restarts
- **Automatic cooldown** — Keys that hit rate limits enter a configurable cooldown period before rejoining the pool
- **Quarantine system** — Keys with repeated failures are temporarily quarantined to prevent cascading errors
- **Rate limiting** — Per-key and global rate limits with configurable windows and burst allowances
- **Gemini support** — First-class support for Google Gemini alongside OpenRouter
- **Built-in metrics** — Request counts, error rates, latency tracking, and key health dashboards
- **CLI diagnostics** — `doctor` command for comprehensive system health checks

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
REDIS_URL=redis://localhost:6379/0
REDIS_TOKEN_URL=redis://localhost:6379/1

# OpenRouter
OPENROUTER_KEYS=key1,key2,key3
OPENROUTER_MODELS=openai/gpt-4o,anthropic/claude-3.5-sonnet

# Gemini
GEMINI_KEYS=key1,key2
GEMINI_MODELS=gemini-2.5-pro,gemini-2.0-flash

# Routing
COOLDOWN_SECONDS=60
QUARANTINE_THRESHOLD=3
QUARANTINE_DURATION=300
RATE_LIMIT_RPM=60
RATE_LIMIT_WINDOW=60
```

### Running

```bash
# Start the server
uv run uvicorn src.main:app --host 0.0.0.0 --port 8000

# Run diagnostics
uv run python -m src.doctor
```

## Usage

### cURL

```bash
# Route a chat completion through OpenRouter
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openrouter",
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'

# Route through Gemini
curl -X POST http://localhost:8000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "gemini",
    "model": "gemini-2.5-pro",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Python SDK

```python
import httpx

async with httpx.AsyncClient() as client:
    response = await client.post(
        "http://localhost:8000/v1/chat/completions",
        json={
            "provider": "openrouter",
            "model": "anthropic/claude-3.5-sonnet",
            "messages": [{"role": "user", "content": "Explain quantum computing"}]
        }
    )
    print(response.json())
```

### Metrics Endpoint

```bash
# Get routing metrics
curl http://localhost:8000/metrics

# Get key health status
curl http://localhost:8000/health
```

## Configuration Reference

| Variable | Type | Default | Description |
|---|---|---|---|
| `REDIS_URL` | string | `redis://localhost:6379/0` | Redis connection URL for routing state |
| `REDIS_TOKEN_URL` | string | `redis://localhost:6379/1` | Redis connection URL for token/key storage |
| `OPENROUTER_KEYS` | comma-separated | — | List of OpenRouter API keys |
| `OPENROUTER_MODELS` | comma-separated | — | List of available OpenRouter models |
| `GEMINI_KEYS` | comma-separated | — | List of Gemini API keys |
| `GEMINI_MODELS` | comma-separated | — | List of available Gemini models |
| `COOLDOWN_SECONDS` | int | `60` | Seconds a key stays in cooldown after rate limit |
| `QUARANTINE_THRESHOLD` | int | `3` | Consecutive failures before quarantine |
| `QUARANTINE_DURATION` | int | `300` | Seconds a key stays quarantined |
| `RATE_LIMIT_RPM` | int | `60` | Maximum requests per minute per key |
| `RATE_LIMIT_WINDOW` | int | `60` | Rate limit window in seconds |
| `LOG_LEVEL` | string | `INFO` | Logging level (DEBUG, INFO, WARNING, ERROR) |
| `HOST` | string | `0.0.0.0` | Server bind address |
| `PORT` | int | `8000` | Server port |

## Project Structure

```
literouter/
├── src/
│   ├── __init__.py          # Package initialization
│   ├── main.py              # FastAPI application entry point
│   ├── config.py            # Environment configuration loader
│   ├── models.py            # Pydantic request/response models
│   ├── router.py            # Core routing logic and round-robin
│   ├── redis_client.py      # Redis connection management
│   ├── queue.py             # Sequential request queue
│   ├── rate_limiter.py      # Per-key and global rate limiting
│   ├── metrics.py           # Request metrics and health tracking
│   ├── doctor.py            # CLI diagnostics and health checks
│   ├── gemini.py            # Gemini provider adapter
│   └── embed_cache.py       # Embedding cache (optional)
├── tests/
│   └── test_router.py       # Router unit tests
├── scripts/
│   └── setup.sh             # Environment setup script
├── docs/
│   ├── ARCHITECTURE.md      # System architecture documentation
│   └── ROUTING.md           # Routing algorithm documentation
├── .env.example             # Environment template
├── pyproject.toml           # Python project configuration
├── uv.lock                  # Dependency lock file
└── README.md                # This file
```

## Redis Key Schema

| Key Pattern | Type | Description | TTL |
|---|---|---|---|
| `lr:rr:{provider}` | STRING | Current round-robin index | None |
| `lr:cooldown:{provider}:{key_idx}` | STRING | Cooldown expiration timestamp | Dynamic |
| `lr:quarantine:{provider}:{key_idx}` | STRING | Quarantine expiration timestamp | Dynamic |
| `lr:failures:{provider}:{key_idx}` | STRING | Consecutive failure count | None |
| `lr:ratelimit:{provider}:{key_idx}` | HASH | Rate limit counters (window, count) | Dynamic |
| `lr:metrics:requests` | STRING | Total request count | None |
| `lr:metrics:errors` | STRING | Total error count | None |
| `lr:metrics:latency` | STRING | Rolling average latency | None |
| `lr:queue` | LIST | Pending request queue | None |

## Multi-Instance Deployment

LiteRouter supports horizontal scaling across multiple instances:

1. **Shared Redis** — All instances connect to the same Redis server for coordinated state
2. **Atomic operations** — Round-robin increments use Redis `INCR` for atomicity
3. **Distributed cooldown** — Cooldown and quarantine states are Redis-backed, visible to all instances
4. **Queue coordination** — Sequential queue is managed via Redis lists with `BLPOP`/`RPOP`

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│ Instance 1  │    │ Instance 2  │    │ Instance 3  │
│ :8000       │    │ :8000       │    │ :8000       │
└──────┬──────┘    └──────┬──────┘    └──────┬──────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                   ┌──────▼──────┐
                   │    Redis    │
                   │  :6379/0,1  │
                   └─────────────┘
```

## License

MIT License — see LICENSE file for details.
