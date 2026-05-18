# LiteRouter

**A Python + Redis API key load balancer for LLM providers.**

LiteRouter sits between your application and LLM providers, distributing requests across multiple API keys using round-robin routing with automatic cooldown, quarantine, and rate limiting.

## Three Routing Pathways

Pick one in `.env`:

| # | Template    | Provider    | Use Case                                      |
|---|-------------|-------------|-----------------------------------------------|
| 1 | `anthropic` | `anthropic` | Native Anthropic SDK → `api.anthropic.com`    |
| 2 | `anthropic` | `openrouter`| Anthropic format → OpenRouter `/messages`     |
| 3 | `openai`    | `openrouter`| OpenAI format → OpenRouter `/chat/completions`|

```env
# .env — pick your pathway
LITEROUTER_TEMPLATE=anthropic
LITEROUTER_PROVIDER=openrouter
```

**That's it.** No auto-detection, no per-model magic. You choose the template, you choose the provider.

## Features

- **Three clean pathways** — Anthropic SDK, Anthropic-via-OpenRouter, OpenAI-via-OpenRouter
- **Redis-backed round-robin** — Atomic key rotation with persistent counter
- **Automatic cooldown** — Exponential backoff (60s → 120s → … → 1h max) on 429s
- **Quarantine** — Permanent quarantine for auth failures (401/403)
- **Rate limiting** — Per-provider pacing with Lua script (Redis) or in-memory fallback
- **Streaming** — Full SSE support on all pathways, including Anthropic SSE → OpenAI chunk conversion
- **Model availability** — `GET /v1/models` queries OpenRouter's live model list
- **Key rotation** — All API keys in `.env`, comma-separated, rotated automatically

## Quick Start

### Prerequisites
- Python 3.11+
- Redis server
- API key(s) for your chosen provider

### Installation
```bash
git clone https://github.com/Acivar-Digital/literouter.git
cd literouter
uv sync
cp .env.example .env
```

### Configuration
Edit `.env`:
```env
# Server
LITEROUTER_PORT=7766
LITEROUTER_AUTH_KEY=sk-lr-your-auth-key

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# Pathway: pick template + provider
LITEROUTER_TEMPLATE=anthropic
LITEROUTER_PROVIDER=openrouter

# Provider keys (comma-separated for rotation)
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEYS=sk-or-key1,sk-or-key2,sk-or-key3
OPENROUTER_MODEL=openrouter/owl-alpha
OPENROUTER_MIN_DELAY_MS=3000
```

### Running
```bash
./scripts/start.sh     # Start (daemonizes, writes PID file)
./scripts/status.sh    # Check if running
./scripts/restart.sh   # Graceful restart
./scripts/stop.sh      # Stop
```

## Usage

### Non-streaming
```bash
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-lr-your-auth-key" \
  -d '{
    "model": "openrouter/owl-alpha",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Streaming
```bash
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer sk-lr-your-auth-key" \
  -d '{
    "model": "openrouter/owl-alpha",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

### Model Availability
```bash
curl http://localhost:7766/v1/models \
  -H "Authorization: Bearer sk-lr-your-auth-key"
```

### Health
```bash
curl http://localhost:7766/health
```

## Configuration Reference

| Variable | Description |
|---|---|
| `LITEROUTER_TEMPLATE` | `anthropic` or `openai` |
| `LITEROUTER_PROVIDER` | `openrouter` or `anthropic` |
| `LITEROUTER_AUTH_KEY` | Bearer token for client auth |
| `{PROVIDER}_BASE_URL` | Upstream API base URL |
| `{PROVIDER}_API_KEYS` | Comma-separated API keys for rotation |
| `{PROVIDER}_MODEL` | Default model (use full ID like `openrouter/owl-alpha`) |
| `{PROVIDER}_MIN_DELAY_MS` | Minimum delay between calls to this provider |

## Project Structure

```
literouter/
├── src/
│   ├── main.py              # FastAPI app, routing, streaming
│   ├── config.py            # .env config loader, pathway validation
│   ├── router.py            # Round-robin key router (Redis + memory)
│   ├── rate_limiter.py      # Per-provider rate limiter (Lua + memory)
│   ├── metrics.py           # Request metrics
│   ├── anthropic.py         # Anthropic request builder + response transformer
│   ├── gemini.py            # Gemini request/response adapter
│   └── redis_client.py      # Redis connection layer
├── tests/                   # 9 test files, ~90 test cases
├── scripts/                 # start/stop/restart/status.sh
├── .env                     # Your secrets (gitignored)
├── .env.example             # Template with all options
└── CHANGELOG.md
```

## Redis Key Schema

| Pattern | Description |
|---|---|
| `literouter:counter:{provider}` | Atomic round-robin counter |
| `literouter:cooldown:{provider}:{sha}` | Cooldown expiry (TTL: 1h) |
| `literouter:quarantine:{provider}` | Quarantined key hashes (SET) |
| `literouter:ratelimit:{provider}` | Last call timestamp (ms) |

## License

MIT
