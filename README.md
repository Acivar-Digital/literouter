# LiteRouter

**A high-performance Python + Redis proxy and API key load balancer for LLM providers.**

LiteRouter sits between your modern AI applications (like OpenCode, utilizing the Agentic Communication Protocol / ACP) and standard LLM upstream providers (OpenRouter, Nvidia, Anthropic). It acts as an intelligent middleware to:
1. **Translate Protocols**: Sanitizes and converts complex client-side multi-turn ACP requests (e.g., `input_text`, `function_call` items without roles) into valid ChatCompletions or Anthropic formats.
2. **Distribute Load**: Distributes requests across multiple API keys using round-robin routing with automatic cooldown, quarantine, and per-provider rate limiting.
3. **Troubleshoot & Validate**: Serves as the primary debugging surface for Zod schema validation errors, SSE stream dropouts, and upstream 400 Bad Requests.

*(If you are an AI Agent debugging LiteRouter, **you must read `.agents/skills/literouter-troubleshooting/SKILL.md`** first to understand the ACP event lifecycle and how to troubleshoot 400/JSON parsing errors.)*

## Multi-Provider Routing

LiteRouter routes requests to different upstream providers based on the **model prefix** in the request:

| Model Prefix | Provider | Upstream API |
|---|---|---|
| `openrouter/` | OpenRouter | `https://openrouter.ai/api/v1/chat/completions` |
| `nvidia/` | Nvidia | `https://integrate.api.nvidia.com/v1/chat/completions` |
| `anthropic/` | Anthropic | `https://api.anthropic.com/messages` |

**One endpoint, multiple providers.** Each provider has its own pool of API keys with independent rotation, health tracking, and rate limiting.

```bash
# OpenRouter request (rotates through OpenRouter keys)
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-your-auth-key" \
  -d '{"model": "openrouter/owl-alpha", "messages": [{"role": "user", "content": "Hello"}]}'

# Nvidia request (rotates through Nvidia keys)
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-your-auth-key" \
  -d '{"model": "nvidia/openai/gpt-oss-120b", "messages": [{"role": "user", "content": "Hello"}]}'
```

The provider prefix is automatically stripped before forwarding to the upstream API (e.g., `nvidia/openai/gpt-oss-120b` → `openai/gpt-oss-120b`).

## Features

- **Multi-provider** — OpenRouter, Nvidia, Anthropic (and more) through a single endpoint
- **Model-based routing** — Provider selected automatically from the model prefix
- **Redis-backed round-robin** — Atomic key rotation with persistent counter
- **Automatic cooldown** — Exponential backoff (60s → 120s → … → 1h max) on 429s
- **Quarantine** — Permanent quarantine for auth failures (401/403)
- **Rate limiting** — Per-provider pacing with Lua script (Redis) or in-memory fallback
- **Streaming** — Full SSE support on all pathways, including Anthropic SSE → OpenAI chunk conversion
- **Model availability** — `GET /v1/models` queries OpenRouter's live model list
- **Key rotation** — All API keys in `.env`, comma-separated, rotated automatically per-provider
- **OpenCode integration** — Works as a drop-in replacement for direct provider endpoints

## Quick Start

### Prerequisites
- Python 3.11+
- Redis server (optional — falls back to in-memory)
- API key(s) for your chosen provider(s)

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

# Redis (optional — leave REDIS_HOST empty to use in-memory mode)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# Default template + provider (used when model has no prefix)
LITEROUTER_TEMPLATE=openai
LITEROUTER_PROVIDER=openrouter

# ── Provider: OpenRouter ──
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEYS=sk-or-key1,sk-or-key2,sk-or-key3
OPENROUTER_MIN_DELAY_MS=3000

# ── Provider: Nvidia ──
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_API_KEYS=nvapi-key1,nvapi-key2,nvapi-key3
NVIDIA_MIN_DELAY_MS=3000

# ── Provider: Anthropic (optional) ──
# ANTHROPIC_BASE_URL=https://api.anthropic.com
# ANTHROPIC_API_KEYS=sk-ant-key1,sk-ant-key2
# ANTHROPIC_MODEL=claude-sonnet-4-6
```

Add as many providers as you want — just follow the `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS` naming convention. The config scanner picks them up automatically.

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
    "model": "nvidia/openai/gpt-oss-120b",
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

Returns per-provider stats: key counts, health scores, active cooldowns, rotation counter position, and Redis connection status.

## OpenCode Integration

> [!WARNING]
> **CRITICAL SDK REQUIREMENT**: You MUST use `@ai-sdk/openai-compatible` instead of `@ai-sdk/openai` in your `opencode.json` configuration. 
> 
> *Why?* `@ai-sdk/openai` requests the `/v1/responses` endpoint (Agentic Communication Protocol/ACP format) by default. Upstream providers like OpenRouter and Nvidia only accept standard OpenAI `/v1/chat/completions`. Translating between these formats in flight is highly fragile, causing tool-call failures (Zod validation errors) and SSE stream corruption. Using `@ai-sdk/openai-compatible` forces the client to use `/v1/chat/completions` natively, bypassing all translation logic.

Point any OpenCode provider at LiteRouter to get automatic key rotation:

```json
{
  "provider": {
    "openrouter": {
      "npm": "@ai-sdk/openai-compatible",
      "baseURL": "http://localhost:7766/v1",
      "apiKey": "sk-lr-your-auth-key",
      "models": {}
    },
    "nvidia": {
      "npm": "@ai-sdk/openai-compatible",
      "baseURL": "http://localhost:7766/v1",
      "apiKey": "sk-lr-your-auth-key",
      "models": {}
    }
  }
}
```

Both providers point to the same LiteRouter endpoint. Routing is determined by the model prefix:
- `opencode run -m openrouter/owl-alpha "..."` → OpenRouter key pool
- `opencode run -m nvidia/openai/gpt-oss-120b "..."` → Nvidia key pool

## Configuration Reference

| Variable | Description |
|---|---|
| `LITEROUTER_PORT` | Server port (default: `7766`) |
| `LITEROUTER_AUTH_KEY` | Bearer token for client auth |
| `LITEROUTER_TEMPLATE` | Default template: `anthropic` or `openai` |
| `LITEROUTER_PROVIDER` | Default provider (used when model has no prefix) |
| `LITEROUTER_ROTATE_DELAY_MS` | Default min delay between calls (ms) |
| `{PROVIDER}_BASE_URL` | Upstream API base URL |
| `{PROVIDER}_API_KEYS` | Comma-separated API keys for rotation |
| `{PROVIDER}_MIN_DELAY_MS` | Min delay between calls to this provider (ms) |
| `{PROVIDER}_MODEL` | Default model for this provider (optional) |
| `{PROVIDER}_TEMPERATURE` | Default temperature for this provider (optional) |

## Project Structure

```
literouter/
├── src/
│   ├── main.py              # FastAPI app, routing, streaming
│   ├── config.py            # .env config loader, provider scanning
│   ├── router.py            # Round-robin key router (Redis + memory)
│   ├── rate_limiter.py      # Per-provider rate limiter (Lua + memory)
│   ├── metrics.py           # Request metrics
│   ├── anthropic.py         # Anthropic request builder + response transformer
│   ├── gemini.py            # Gemini request/response adapter
│   ├── queue.py             # Redis-backed request queue
│   ├── embed_cache.py       # Embedding + query result cache
│   ├── redis_client.py      # Redis connection layer
│   └── doctor.py            # CLI health check utility
├── tests/                   # 10 test files, ~90 test cases
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
| `literouter:metrics:*` | Request/error/latency counters |
| `literouter:queue` | Pending request queue (LIST) |
| `literouter:processing` | In-progress jobs (ZSET) |

Redis is optional. When unavailable, all state falls back to in-memory.

## License

MIT
