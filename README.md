# LiteRouter — Open-Source AI Gateway & LLM API Proxy

> 🤖 **Zero-Friction Autonomous AI Installation**: Give this command to your AI Coding Assistant (Cursor, OpenCode, Claude Code, Windsurf, Copilot, ChatGPT):
> ```text
> Please read https://raw.githubusercontent.com/Acivar-Digital/literouter/main/INSTALL.md and autonomously set up, configure, and launch LiteRouter on my machine.
> ```

> **LiteRouter** is the world's first and only Bun/TypeScript AI API Gateway that combines **atomic Redis/Valkey Lua key rotation**, **Google Gemini `thought_signature` preservation** across multi-step agent tool calls, **70% reasoning-token cost stripping**, and **sticky fusion fallback chains** — solving the three problems every AI power user faces: 429 throttling, API key exhaustion, and bleeding money on reasoning tokens nobody asked for.
> 
> It sits between modern AI applications (OpenCode, Claude Code, Cursor, SillyTavern, Cherry Studio, custom LLM apps) and upstream model providers (Google AI Studio, OpenRouter, NVIDIA, Anthropic). Unlike Python-heavy proxies, LiteRouter delivers **sub-millisecond** routing overhead with a single Bun process — no Python sidecars, no SaaS markup.

> [!NOTE]
> ### Why LiteRouter?
>
> Every AI developer hits three invisible walls. LiteRouter is the **only** gateway in the "High Performance + High Intelligence" quadrant that solves all three:
>
> - **⏱ 429 stalls** — keys get throttled; you wait 65s. LiteRouter recovers in **2 seconds**.
> - **🔑 Key pool wastage** — manual round-robin causes race conditions. LiteRouter uses **atomic Lua ZSET rotation** — zero boundary bursts.
> - **🧠 Reasoning token bleed** — `<thinking>` blocks inflate every turn. LiteRouter strips historical reasoning, saving **up to 70%** on token costs.
>
> **→ Deploy in 30 seconds:** `git clone … && bun install && cp .env.example .env && ./scripts/start.sh`
> **→ Full truth source:** see [`demo/POSITIONING.md`](demo/POSITIONING.md)

---

## What is LiteRouter?

**LiteRouter** acts as an intelligent middleware between modern AI applications (such as OpenCode, SillyTavern, Cherry Studio, or custom LLM apps) and upstream AI model providers (Google AI Studio, OpenRouter, Nvidia, Anthropic, and custom endpoints).

### Why LiteRouter?
1. **Multi-Provider API Key Rotation**: Distributes requests across multiple API keys using atomic Redis ZSET + Lua rolling windows with automatic key cooldown, quarantine, and rate limiting.
2. **Google Thought Signature Preservation**: Automatically stores and reinjects Google Gemini `thought_signature` tokens across multi-step agent tool calls, fixing signature validation errors.
3. **Historical Reasoning Context Stripping (Save $$$)**: Strips past reasoning blocks (`reasoning_content`, `thought`, `thought_summary`) from historical context turns before calling providers — saving up to 70% in prompt token costs and eliminating LLM reasoning loops.
4. **Unified Routing**: Native support for OpenAI-compatible endpoints (`/v1/chat/completions`), Google native REST endpoints (`/v1beta/...`), and virtual Fusion groups in a single Bun process.
5. **Fusion Fallback Chains**: Define model fallback priorities. If a primary model returns `429` or `5xx`, LiteRouter seamlessly routes requests to the next model with sticky fallback caching.
6. **Model-Specific Payload Sanitization**: Strips Gemma-breaking fields (`thinkingConfig`, `presence_penalty`, `logit_bias`) and normalizes raw reasoning streams into unified `<thought>` tags.
7. **Ghost & Idle Upstream Detection**: Automatically detects stalled upstream calls and rotates keys instantly without penalizing provider health.

---

## Comparison: LiteRouter vs. Alternatives

| Feature | LiteRouter | LiteLLM | OpenRouter |
| :--- | :--- | :--- | :--- |
| **Category** | Open-Source AI Gateway | Open-Source AI Gateway | Hosted AI Aggregator SaaS |
| **Runtime & Performance** | Bun / TypeScript (Sub-ms overhead) | Python / FastAPI | Closed Source |
| **Google Thought Signature Preservation** | ✅ Automatic store & reinject | ❌ Manual / Unhandled | ❌ N/A |
| **History Reasoning Stripping (Cost Saving)** | ✅ Automatic (Save $$$) | ❌ Retains full context | ❌ Retains full context |
| **OpenAI-Compatible API** | ✅ Standard `/v1/chat/completions` | ✅ Standard `/v1/chat/completions` | ✅ Standard `/v1/chat/completions` |
| **Google Native REST Route** | ✅ Direct `/v1beta/...` passthrough | ❌ Requires translation | ❌ N/A |
| **Key Rotation & Cooldown** | ✅ Atomic Redis Lua ZSET | ✅ Basic proxy rotation | ❌ N/A (Pay-per-token) |
| **Virtual Fusion Fallbacks** | ✅ Sticky 5-min failover chains | ✅ Fallback list | ❌ Static routing |
| **Self-Hostable** | ✅ 100% Free & Open Source | ✅ Open Source | ❌ Proprietary SaaS |

---

## Routes

| Route | Protocol | Target | Auth |
|-------|----------|--------|------|
| `/v1/chat/completions` | HTTP/2 or HTTP/1.1 (ALPN) | Provider upstream (Google: `/v1beta/openai/chat/completions`) | `Authorization: Bearer {key}` |
| `/v1/models` | HTTP/2 or HTTP/1.1 (ALPN) | Aggregates all registered models from `models.json` & `fusion.json` | `Authorization: Bearer {key}` |
| `/v1beta/...` | HTTP/2 or HTTP/1.1 (ALPN) | `generativelanguage.googleapis.com/v1beta/models/{model}:{action}` | `?key={API_KEY}` query param |
| `/health` | HTTP/2 or HTTP/1.1 (ALPN) | Service & provider status probe | None |
| Fusion groups | HTTP/2 or HTTP/1.1 (ALPN) | Virtual chain (in-process) — iterates model chain calling either route above | Internal |

> **Transport**: LiteRouter natively supports HTTP/2 + HTTP/1.1 ALPN negotiation via Bun's built-in TLS. When local certificates (`certs/localhost.pem`, `certs/localhost-key.pem`) are present, the gateway serves HTTPS on port 7766 with automatic HTTP/2 negotiation. Without certificates, it falls back to plaintext HTTP/1.1. See [docs/Upgrade_http2.md](docs/Upgrade_http2.md) for setup.

---

## 🏛️ Architectural Philosophy: Intelligent Transparent Pass-Through

LiteRouter is intentionally designed as an **ultra-lean, high-throughput streaming proxy**:
- **Why we don't build custom parsers for `/v1/images`, `/v1/audio`, or `/v1/embeddings`**: LiteRouter acts as an intelligent transparent forwarder. It injects healthy rotated API credentials and pipes HTTP payloads directly to upstream providers with zero serialization latency and zero maintenance churn.
- **Looking for experimental or deferred features?** Check 👉 [**`KIV.md`**](KIV.md) (Keep-In-View) for features like native Anthropic Messages API, along with an AI builder prompt for contributors.
- **Wondering why certain features aren't supported?** Check 👉 [**`GRAVEYARD.md`**](GRAVEYARD.md) (Architecture Graveyard) explaining why database ORMs, bloated web admin GUIs, and serverless edge rewrites were explicitly rejected to preserve sub-millisecond Bun+Valkey performance.

## Fusion Groups (In-Process)

Fusion groups define "virtual" models with priority-based fallback chains. If the primary model returns a `429` or `5xx`, Fusion automatically falls back to the next model in the chain.

- **Circuit Breaker**: 65s per-model cooldown — skips a model that recently errored.
- **Sticky Fallback**: 300s (5 min) — once the chain falls back, subsequent requests start there instead of the top.
- **Identity**: Response header `X-Literouter-Model` identifies which upstream served.

```bash
curl -X POST https://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer {{API_KEY}}" \
  --cacert certs/localhost.pem \
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
./scripts/setup_certs.sh   # (optional) Issue localhost TLS certs via mkcert for HTTPS
./scripts/start.sh        # Start (daemonizes in tmux, writes PID file)
./scripts/stop.sh         # Stop
./scripts/restart.sh      # Restart (flushes Valkey, re-reads config)

tmux attach -t literouter   # View runtime logs (Press Ctrl+B then D to detach)
```

If `certs/localhost.pem` and `certs/localhost-key.pem` exist, LiteRouter serves HTTPS with HTTP/2 + HTTP/1.1 ALPN on port 7766. Otherwise it runs plaintext HTTP/1.1.

---

## Operations, Diagnostics & Process Management

LiteRouter includes built-in tools for live API key diagnostics (`doctor.ts`) and daemon process control (`tmux`).

### 1. Diagnostic Key Doctor (`doctor.ts`)
Before or after starting LiteRouter, run the pre-flight doctor script to validate all configured API keys against real provider endpoints and check your Redis/Valkey connection:

```bash
bun run scripts/doctor.ts
```

What `doctor.ts` checks:
- **Redis Health**: Verifies connection, latency, and Lua script engine readiness.
- **Key Probing**: Probes each API key in parallel against its provider API.
- **Status Classification**:
  - `PASS`: Key is active and authorized.
  - `RATE_LIMITED`: Key hit a provider 429 limit (placed on automatic cooldown).
  - `FAIL`: Key is revoked/invalid (automatically excluded from rotation).

---

### 2. Tmux Background Management
LiteRouter uses `tmux` to run as a resilient background daemon. This allows the service to survive terminal closures and SSH disconnects.

- **Start Daemon**: `./scripts/start.sh` (launches background session `literouter`)
- **View Live Logs**:
  ```bash
  tmux attach -t literouter
  ```
  *(To detach from the log view without stopping LiteRouter, press `Ctrl+B` then `D`)*
- **Stop Daemon**: `./scripts/stop.sh`
- **Restart Daemon**: `./scripts/restart.sh` (re-scans `.env` for new keys/providers)

---

## How to Add New Providers & Models (Zero-Code Extension)

LiteRouter dynamically discovers providers using environment variable patterns. **No TypeScript code modifications are required.**

### Adding any OpenAI-Compatible Provider (e.g., DeepSeek, Groq, Together, Cerebras, Ollama)

1. Open `.env` and add the provider configuration using the pattern `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS`:

```env
# ── Provider: DeepSeek ──
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_API_KEYS=sk-ds-key1,sk-ds-key2,sk-ds-key3
DEEPSEEK_MIN_DELAY_MS=1000

# ── Provider: Groq ──
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_API_KEYS=gsk_key1,gsk_key2
GROQ_MIN_DELAY_MS=2000

# ── Provider: Local Ollama ──
OLLAMA_BASE_URL=http://localhost:11434/v1
OLLAMA_API_KEYS=ollama-local-key
```

2. Restart LiteRouter to pick up the new configuration:
```bash
./scripts/restart.sh
```

3. Route requests to your new provider using the `{provider}/{model}` prefix:
```bash
curl -X POST https://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer $LITEROUTER_AUTH_KEY" \
  -H "Content-Type: application/json" \
  --cacert certs/localhost.pem \
  -d '{
    "model": "deepseek/deepseek-chat",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Usage

### Non-streaming
```bash
curl -X POST https://localhost:7766/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {{API_KEY}}" \
  --cacert certs/localhost.pem \
  -d '{
    "model": "openrouter/owl-alpha",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

### Streaming
```bash
curl -X POST https://localhost:7766/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {{API_KEY}}" \
  --cacert certs/localhost.pem \
  -d '{
    "model": "nvidia/openai/gpt-oss-120b",
    "messages": [{"role": "user", "content": "Tell me a story"}],
    "stream": true
  }'
```

### Model Availability
```bash
curl https://localhost:7766/v1/models \
  -H "Authorization: Bearer {{API_KEY}}" \
  --cacert certs/localhost.pem
```

### Health
```bash
curl https://localhost:7766/health --cacert certs/localhost.pem
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
      "baseURL": "https://localhost:7766/v1",
      "apiKey": "{{API_KEY}}",
      "models": {}
    },
    "nvidia": {
      "npm": "@ai-sdk/openai-compatible",
      "baseURL": "https://localhost:7766/v1",
      "apiKey": "{{API_KEY}}",
      "models": {}
    }
  }
}
```

Both providers point to the same LiteRouter endpoint. Routing is determined by the model prefix:
- `opencode run -m openrouter/owl-alpha "..."` → OpenRouter key pool
- `opencode run -m nvidia/openai/gpt-oss-120b "..."` → Nvidia key pool

## Deployment Targets

> [!IMPORTANT]
> **DO NOT ASSUME DIRECTIVE**: Before starting or testing any configuration changes, you **MUST** verify which LiteRouter target is active.
>
> Check your OpenCode configuration at `~/.config/opencode/opencode.json` (or `~/.config/opencode2/config.json` for OpenCode 2). The `baseURL` under the provider options determines the routing target:
> - If `baseURL` points to `localhost` (e.g. `https://localhost:7766/v1`), your requests route to your **local** LiteRouter instance.
> - If `baseURL` points to a remote IP, requests route to that **remote** LiteRouter instance.
>
> **Never assume that updates to your local `.env` will take effect on a remote instance.** If OpenCode is configured to point to a remote host:
> 1. You must apply/sync configuration changes (such as API keys) directly on that instance.
> 2. You must monitor/verify that instance's logs instead of local ones.
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
