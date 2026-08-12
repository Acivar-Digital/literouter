# LiteRouter — Open-Source AI Gateway & LLM API Proxy

> **LiteRouter** is a high-performance, self-hosted open-source AI API Gateway and LLM proxy router powered by Bun and TypeScript. It sits between modern AI applications (such as OpenCode, SillyTavern, Cherry Studio, or custom LLM apps) and upstream model providers (Google AI Studio, OpenRouter, Nvidia, Anthropic).
> 
> Unlike Python-heavy proxies, LiteRouter delivers sub-millisecond routing overhead with atomic Redis/Valkey Lua key rotation, automatic 429/timeout cooldowns, payload reasoning sanitization, and sticky virtual model failover chains.

---

## What is LiteRouter?

**LiteRouter** acts as an intelligent middleware between modern AI applications (such as OpenCode, SillyTavern, Cherry Studio, or custom LLM apps) and upstream AI model providers (Google AI Studio, OpenRouter, Nvidia, Anthropic, and custom endpoints).

### Why LiteRouter?
1. **Multi-Provider API Key Rotation**: Distributes requests across multiple API keys using atomic Redis ZSET + Lua rolling windows with automatic key cooldown, quarantine, and rate limiting.
2. **Unified Routing**: Native support for OpenAI-compatible endpoints (`/v1/chat/completions`), Google native REST endpoints (`/v1beta/...`), and virtual Fusion groups in a single Bun process.
3. **Fusion Fallback Chains**: Define model fallback priorities. If a primary model returns `429` or `5xx`, LiteRouter seamlessly routes requests to the next model with sticky fallback caching.
4. **Payload Normalization & Sanitization**: Automatically collapses reasoning blocks into `<thought>` tags, normalizes LaTeX formatting, and strips vendor-breaking fields like `thinkingConfig`.

---

## Comparison: LiteRouter vs. Alternatives

| Feature | LiteRouter | LiteLLM | OpenRouter |
| :--- | :--- | :--- | :--- |
| **Category** | Open-Source AI Gateway | Open-Source AI Gateway | Hosted AI Aggregator SaaS |
| **Runtime & Performance** | Bun / TypeScript (Sub-ms overhead) | Python / FastAPI | Closed Source |
| **OpenAI-Compatible API** | ✅ Standard `/v1/chat/completions` | ✅ Standard `/v1/chat/completions` | ✅ Standard `/v1/chat/completions` |
| **Google Native REST Route** | ✅ Direct `/v1beta/...` passthrough | ❌ Requires translation | ❌ N/A |
| **Key Rotation & Cooldown** | ✅ Atomic Redis Lua ZSET | ✅ Basic proxy rotation | ❌ N/A (Pay-per-token) |
| **Virtual Fusion Fallbacks** | ✅ Sticky 5-min failover chains | ✅ Fallback list | ❌ Static routing |
| **Self-Hostable** | ✅ 100% Free & Open Source | ✅ Open Source | ❌ Proprietary SaaS |

---

## Routes

| Route | Protocol | Target | Auth |
|-------|----------|--------|------|
| `/v1/chat/completions` | OpenAI-compat | Provider upstream (Google: `/v1beta/openai/chat/completions`) | `Authorization: Bearer {key}` |
| `/v1beta/...` | Google native REST | `generativelanguage.googleapis.com/v1beta/models/{model}:{action}` | `?key={API_KEY}` query param |
| Fusion groups | Virtual chain | In-process — iterates model chain calling either route above | Internal |

## Fusion Groups (In-Process)

Fusion groups define "virtual" models with priority-based fallback chains. If the primary model returns a `429` or `5xx`, Fusion automatically falls back to the next model in the chain.

- **Circuit Breaker**: 65s per-model cooldown — skips a model that recently errored.
- **Sticky Fallback**: 300s (5 min) — once the chain falls back, subsequent requests start there instead of the top.
- **Identity**: Response header `X-Literouter-Model` identifies which upstream served.

```bash
curl -X POST http://localhost:$PORT/v1/chat/completions \
  -H "Authorization: Bearer {{API_KEY}}" \
  -d '{"model": "pydantic/google", "messages": [{"role": "user", "content": "Hello"}]}'
```

Fusion groups are defined in `fusion.json` and reference existing models from `models.json`.

## Features

- **Single process** — Bun/TypeScript, no Python or sidecar dependencies
- **Multi-provider** — Google AI Studio, OpenRouter, Nvidia, Anthropic through a single endpoint
- **Three route types** — OpenAI-compat (`/v1/chat/completions`), Google native (`/v1beta/...`), Fusion groups (virtual chains)
- **Atomic rate limiting** — ZSET+Lua rolling 60s windows via Redis/Valkey (true rolling, no minute-edge bursts)
- **Per-request backoff** — 65s → 90s → 120s when all keys exhausted for a provider
- **Automatic cooldown** — Per-key, per-model cooldown states (429: 65s, timeout: 10s, quarantine: 7d)
- **Reasoning normalization** — Collapses reasoning content into `<thought>` tags
- **Payload sanitization** — Strips Gemma-breaking `thinkingConfig`, normalizes LaTeX symbols
- **Streaming** — Full SSE support on all pathways
- **Key rotation** — Comma-separated API keys in `.env`, rotated automatically per-provider
- **OpenCode integration** — Drop-in replacement for direct provider endpoints

## Quick Start

### Prerequisites
- [Bun](https://bun.sh) 1.2+
- Redis / Valkey server (REQUIRED — the gateway exits(1) on a connection error; there is no in-memory fallback)
- API key(s) for your chosen provider(s)

### Installation
```bash
git clone https://github.com/Acivar-Digital/literouter.git
cd literouter
bun install
cp .env.example .env
```

### Configuration
Edit `.env`:
```env
# Server
LITEROUTER_PORT=7766
LITEROUTER_AUTH_KEY={{API_KEY}}

# Redis (REQUIRED — the gateway fails loud if Redis/Valkey is unreachable)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=your-redis-password

# Default template + provider (used when model has no prefix)
LITEROUTER_TEMPLATE=openai
LITEROUTER_PROVIDER=openrouter

# ── Provider: OpenRouter ──
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEYS={{API_KEY_1}},{{API_KEY_2}},{{API_KEY_3}}
OPENROUTER_MIN_DELAY_MS=3000

# ── Provider: Nvidia ──
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_API_KEYS={{API_KEY_1}},{{API_KEY_2}},{{API_KEY_3}}
NVIDIA_MIN_DELAY_MS=3000

# ── Provider: Anthropic (optional) ──
# ANTHROPIC_BASE_URL=https://api.anthropic.com
# ANTHROPIC_API_KEYS=sk-ant-key1,sk-ant-key2
# ANTHROPIC_MODEL=claude-sonnet-4-6
```

Add as many providers as you want — just follow the `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS` naming convention. The config scanner picks them up automatically.

### Running
```bash
./scripts/start.sh     # Start (daemonizes in tmux, writes PID file)
./scripts/stop.sh      # Stop
./scripts/restart.sh   # Restart (flushes Valkey, re-reads config)

tmux attach -t literouter   # View runtime logs
```

## Usage

### Non-streaming
```bash
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {{API_KEY}}" \
  -d '{
    "model": "openrouter/owl-alpha",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Streaming
```bash
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {{API_KEY}}" \
  -d '{
    "model": "nvidia/openai/gpt-oss-120b",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

### Model Availability
```bash
curl http://localhost:7766/v1/models \
  -H "Authorization: Bearer {{API_KEY}}"
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
      "apiKey": "{{API_KEY}}",
      "models": {}
    },
    "nvidia": {
      "npm": "@ai-sdk/openai-compatible",
      "baseURL": "http://localhost:7766/v1",
      "apiKey": "{{API_KEY}}",
      "models": {}
    }
  }
}
```

Both providers point to the same LiteRouter endpoint. Routing is determined by the model prefix:
- `opencode run -m openrouter/owl-alpha "..."` → OpenRouter key pool
- `opencode run -m nvidia/openai/gpt-oss-120b "..."` → Nvidia key pool

## Local vs VPS Configuration (Do Not Assume)

> [!IMPORTANT]
> **DO NOT ASSUME DIRECTIVE**: Before starting or testing any configuration changes, you **MUST** verify which LiteRouter target is active. 
> 
> Check your global configuration at `~/.config/opencode/opencode.json` (specifically the `baseURL` under `provider.literouter.options`):
> - If `baseURL` points to `localhost` (e.g. `http://localhost:7766/v1`), your requests route to your **local** LiteRouter instance.
> - If `baseURL` points to the VPS IP (e.g. `http://10.32.34.243:7766/v1`), requests route to the **VPS** LiteRouter instance.
> 
> **Never assume that updates to your local `.env` will take effect on the VPS.** If OpenCode is configured to point to the VPS:
> 1. You must apply/sync configuration changes (such as API keys or new providers like `zen`) directly on the VPS instance.
> 2. You must monitor/verify VPS logs instead of local ones.
> 3. Verify the deployment target explicitly before declaring success.

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
│   └── index.ts             # Bun server: routing, ZSET+Lua quota, fusion, streaming
├── models.json              # Model routing registry (system_id → upstream)
├── fusion.json              # Fusion group definitions (priority chains)
├── models/                  # Per-model metadata (from OpenRouter catalog)
│   ├── google/
│   ├── openrouter/
│   ├── nvidia/
│   └── zen/
├── scripts/                 # start.sh / stop.sh / restart.sh
├── tests/                   # Test matrix files
├── .env                     # Secrets (gitignored)
├── .env.example             # Template with all options
└── CHANGELOG.md
```

## Redis Key Schema

| Pattern | Description |
|---|---|
| `rolling:{provider}:{hash}:{model}` | ZSET — atomic rolling 60s quota window (Lua) |
| `cooldown:{provider}:{hash}:{model}` | Per-key, per-model cooldown state (rate_limited: 65s, timed_out: 10s, quarantined: 7d) |

Redis/Valkey is REQUIRED. When unavailable, the gateway exits(1) on the connection error (no in-memory fallback).

## License

MIT
