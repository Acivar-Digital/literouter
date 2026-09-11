# LiteRouter v4.0 — High-Performance Self-Contained AI Gateway & LLM Proxy

> 🤖 **Zero-Friction Autonomous AI Installation**: Give this command to your AI Coding Assistant (Cursor, OpenCode, Claude Code, Windsurf, Copilot, ChatGPT):
> ```text
> Please read https://raw.githubusercontent.com/Acivar-Digital/literouter/main/INSTALL.md and autonomously set up, configure, and launch LiteRouter on my machine.
> ```

> **LiteRouter v4.0** is the world's first and only **100% self-contained** Bun/TypeScript AI API Gateway with **zero external database dependencies** (no Redis, no Valkey, no Docker, no Python sidecars). It delivers **sub-millisecond routing overhead**, native in-memory token bucket rate limiting, event-driven key cooldowns, and revolutionary **Directive Key Architecture**.
> 
> It sits between modern AI developer tools (OpenCode, Claude Code, Cursor, SillyTavern, custom LLM agents) and upstream model providers (Google AI Studio, OpenRouter, NVIDIA NIM, Zen, Anthropic, GCP Vertex AI).

---

## ⚡ v4 Superpowers (Why LiteRouter?)

Every AI developer hits invisible walls: rate limit 429 stalls, API key exhaustion, token cost blowouts, and silent model degradation. LiteRouter solves all of them out of the box in a single Bun process:

### 1. 🔑 Directive Key Architecture (The Token IS the Router)
Forget editing bloated YAML routing configs or restarting servers. LiteRouter uses client-side **Directive Keys** formatted as `lr-<provider>-<wire>-<endpoint>-<nuance>`:
- `lr-zn-oa-ch-no`: Routes OpenAI chat completions to **Zen Free** with agentic attribution.
- `lr-or-ao-ch-dp`: Cross-wires Anthropic client payloads to **OpenRouter**, stripping `<think>` tags and normalizing tool calls.
- `lr-nv-oa-ch-ts`: Routes to **NVIDIA NIM** while preserving deep-thinking tokens (`ts`).
- `lr-gg-gg-gc-no`: Direct Google REST passthrough with Native Flash Cascade failover.

Your client requests dictate upstream targets, wire formats, streaming nuances, and sanitizers instantly on a per-request basis.

### 2. 🛡️ 60-Second Model Evaluation Gauntlet (Zero-Docker Benchmark)
Evaluate any model's real-world agentic and frontend fitness in under 60 seconds with **zero Docker containers, zero headless browsers, and zero heavy dependencies**:
```bash
bun run eval/eval.ts <model_name>
```
> *"All models are wrong, but some are useful."* — **George E. P. Box**  
> *"So use our eval, we will tell you what is wrong."* — **Francis Yap**

- **⚡ Speed Pillar (`eval/speed.ts`)**: Measures Time to First Token (TTFT), streaming throughput (tokens/sec), and slot headroom.
- **💻 5-Stage Agentic Coding Pillar (`eval/code.ts`)**: Evaluates 12k context hydration, strict Pydantic 2.0 schema validation, 3-turn multi-step state loops, surgical `str_replace` patching, AST poison shields, and test tampering vetoes.
- **🌐 5-Stage Web Generation Pillar (`eval/web.ts`)**: Audits semantic DOM landmarks, mobile Tailwind responsive grid collapse, React state hooks, syntax hygiene, and WCAG accessibility standards.
- Outputs an actionable Markdown report card in `eval/reports/` classifying models into **Orchestrator**, **General Coder**, or **Explorer** roles.

### 3. 💸 70% Reasoning Token Cost Stripping
Modern reasoning models emit thousands of `<think>` / `reasoning_content` tokens per turn. In multi-turn agent conversations, re-sending accumulated historical reasoning burns up to 70% of context and budget. LiteRouter **automatically scrubs past thinking blocks** from conversation history while leaving the current turn's thinking intact—slashing prompt token costs and preventing runaway context loops.

### 4. 🚀 HTTP/2 ALPN Multiplexing & Synthetic Heartbeats
- Built-in binary HTTP/2 multiplexing via Bun TLS with sub-millisecond connection pooling (`h2_pool`).
- **Synthetic SSE Heartbeats**: Emits synthetic keepalive comments during deep-thinking phases to prevent client disconnects and proxy timeouts.

### 5. 🌊 Google Native Flash Cascades & Thought Signature Preservation
- **Flash Fallback Cascades**: Automatic sticky failover chains across Gemini model tiers (`3.8 ➔ 3.7 ➔ 3.6 ➔ 3.5`) on 429 rate limits or upstream hiccups.
- **Thought Signature Preservation**: Automatically captures and re-injects Google Gemini `thought_signature` tokens across multi-step agent tool calls, eliminating signature validation crashes.

### 6. 🌙 Midnight UTC Daily Limit Shield
- Intelligently detects provider daily free-tier quota exhaustion (`FreeUsageLimitError`, 429 with daily reset headers) and parks exhausted keys in a decoupled conserve engine until **00:00:00 UTC**.
- Key cooldowns are event-driven and non-blocking: burst RPM limits release in seconds, while daily quota limits sleep until midnight without locking your healthy keys.

---

## 📊 Comparison: LiteRouter v4 vs. Alternatives

| Feature | LiteRouter v4.0 | LiteLLM | OpenRouter | Portkey |
| :--- | :--- | :--- | :--- | :--- |
| **Architecture** | **100% In-Memory Bun / TS** | Python / FastAPI | Closed-Source SaaS | Node.js / SaaS |
| **External Database** | **Zero (No Redis, No Postgres)** | Redis / PostgreSQL | Hosted (Proprietary) | Redis / Postgres |
| **Routing Overhead** | **Sub-millisecond (<1ms)** | 15–40ms | Network roundtrip | 20–50ms |
| **Directive Keys** | ✅ Yes (`lr-<provider>-...`) | ❌ Static YAML | ❌ URL params | ❌ Config headers |
| **Built-in 60s Eval Gauntlet**| ✅ Speed, Code, Web (Zero-Docker)| ❌ External (Evalverse)| ❌ None | ❌ None |
| **Reasoning Stripping (70% $$)**| ✅ Automated history scrubbing | ❌ Full context kept | ❌ Full context kept | ❌ Full context kept |
| **Google Thought Signatures** | ✅ Auto-store & re-inject | ❌ Manual handling | ❌ N/A | ❌ Not supported |
| **HTTP/2 ALPN + Heartbeats** | ✅ Native multiplexing | ❌ HTTP/1.1 default | ❌ Gateway dependent| ⚠️ Partial |
| **Midnight UTC Key Conserve** | ✅ Auto-parks to 00:00 UTC | ❌ Fixed cooldown | ❌ N/A | ❌ Manual rules |
| **Self-Hostable** | ✅ 100% Free & Open Source | ✅ Open Source | ❌ Closed SaaS | ⚠️ Commercial core |

---

## 🚀 30-Second Quick Start

LiteRouter requires **only Bun 1.2+**. No Docker, no Redis, no background databases.

### 1. Clone & Install
```bash
git clone https://github.com/Acivar-Digital/literouter.git
cd literouter
bun install
```

### 2. Configure Environment
```bash
cp .env.example .env.local
```
Edit `.env.local` with your preferred provider keys:
```env
LITEROUTER_PORT=7766
LITEROUTER_AUTH_KEY=sk-lr-my-secret-key

# Upstream API Key Pools (comma-separated for automatic rotation)
OPENROUTER_API_KEYS=sk-or-key1,sk-or-key2
NVIDIA_API_KEYS=nvapi-key1,nvapi-key2
GOOGLE_API_KEYS=AIzaSyKey1,AIzaSyKey2
ZEN_API_KEYS=zen-key1
```

### 3. Launch Gateway
```bash
bash scripts/start.sh
```
LiteRouter starts as a resilient background daemon managed via `tmux`.

- **Check Status**: `bash scripts/status.sh`
- **View Live Logs**: `tmux attach -t literouter` *(Press Ctrl+B then D to detach)*
- **Stop Gateway**: `bash scripts/stop.sh`
- **Restart Gateway**: `bash scripts/restart.sh`

---

## 🌐 Endpoints & Protocols

| Endpoint | Method | Supported Directives / Usage | Protocol |
|---|---|---|---|
| `/v1/chat/completions` | `POST` | Standard OpenAI Chat (`lr-*-oa-ch-*`, `lr-*-ao-ch-*`) | HTTP/2 or HTTP/1.1 |
| `/v1/messages` | `POST` | Anthropic Messages API (`lr-*-cl-ms-*`) for Claude Code | HTTP/2 or HTTP/1.1 |
| `/v1/responses` | `POST` | OpenAI Responses API (`lr-*-oo-rs-*`) for ACP agents | HTTP/2 or HTTP/1.1 |
| `/v1beta/models/*` | `POST` | Direct Google Gemini REST (`lr-gg-gg-gc-no`) | HTTP/2 or HTTP/1.1 |
| `/v1/models` | `GET` | Dynamic model discovery and registered fusion chains | HTTP/2 or HTTP/1.1 |
| `/health` | `GET` | Auth-free health probe, active key counts, and circuit breaker stats | HTTP/2 or HTTP/1.1 |
| `/reset` | `POST` | Auth-free hot reload of provider headers and key pools | HTTP/2 or HTTP/1.1 |

> **Transport**: When certificates (`certs/localhost.pem`, `certs/localhost-key.pem`) exist, LiteRouter negotiates **HTTP/2 ALPN over HTTPS** on port 7766. Without certs, it operates over high-speed HTTP/1.1. Run `bash scripts/setup_certs.sh` to generate local TLS certificates with `mkcert`.

---

## 🔑 Directive Key Anatomy

Directive keys pass through the standard `Authorization: Bearer <KEY>` header.

Format: `lr-<provider>-<wire>-<endpoint>-<nuance>`

```text
lr - zn - oa - ch - no
│    │    │    │    └── Nuance: "no" (none), "dp" (dots/XML tools), "ts" (keep thinking)
│    │    │    └─────── Endpoint: "ch" (chat), "ms" (messages), "rs" (responses), "gc" (generateContent)
│    │    └──────────── Wire Format: "oa" (OpenAI), "cl" (Anthropic), "oo" (Responses native), "ao" (Anthropic->OpenAI)
│    └───────────────── Provider: "zn" (Zen), "or" (OpenRouter), "nv" (Nvidia), "gg" (Google), "an" (Anthropic)
└────────────────────── LiteRouter Prefix
```

### Top Directive Keys

| Directive Key | Target Client / Workflow | Wire & Gateway Behavior |
|---|---|---|
| `lr-zn-oa-ch-no` | OpenCode 2 (Zen Free) | OpenAI Chat Completions ➔ Zen with OpenCode headers & key rotation |
| `lr-zn-oo-rs-no` | OpenCode 2 (Zen Responses) | Native Responses API passthrough (`POST /v1/responses`) |
| `lr-or-oa-ch-no` | OpenCode / Cursor (OpenRouter) | Standard OpenAI Chat with agentic attribution headers |
| `lr-nv-oa-ch-ts` | OpenCode 2 (NVIDIA NIM) | NIM Chat with thinking chunks preserved (`ts`) |
| `lr-or-cl-ms-no` | Claude Code (via OpenRouter) | Anthropic Messages API passthrough to OpenRouter |
| `lr-an-cl-ms-no` | Claude Code (Direct Anthropic) | Direct Anthropic Messages API with key rotation |
| `lr-gg-gg-gc-no` | Google Native (`@ai-sdk/google`)| Direct Google REST forwarder + Native Google Fusion cascades |
| `lr-nv-oa-ch-no` | Pydantic AI / Python SDK | High-throughput HTTP/2 binary multiplexed chat completions |
| `lr-or-ao-ch-dp` | Dots / Open-Weights XML Tools | Anthropic-to-OpenAI cross-wire with XML tool & thinking extraction |

---

## 🧪 60-Second Model Evaluation Gauntlet

Run empirical benchmarks against any model with one command:

```bash
# Full Gauntlet: Speed + Coding + Web Generation
bun run eval/eval.ts deepseek-ai/deepseek-r1

# Targeted Runs
bun run eval/eval.ts meta-llama/llama-3.3-70b-instruct --suites speed,code
bun run eval/speed.ts mistralai/mistral-large-2411
bun run eval/code.ts qwen/qwen-2.5-coder-32b-instruct --stage 4
bun run eval/web.ts google/gemini-2.5-flash --stage 2
```

Results and detailed telemetry are automatically formatted and saved to `eval/reports/`.

---

## 🛠️ Diagnostics & Health Probes

### 1. Pre-Flight Doctor (`scripts/doctor.ts`)
Probe all configured upstream provider API keys concurrently to verify authentication and quota status:
```bash
bun run scripts/doctor.ts
```
Outputs live status (`PASS`, `RATE_LIMITED`, or `FAIL`) for every key across Google, NVIDIA, OpenRouter, and Zen.

### 2. Live Health Endpoint
```bash
curl -sk http://localhost:7766/health
```
```json
{
  "status": "healthy",
  "version": "4.0.0",
  "uptime_seconds": 3600,
  "circuit_breakers": { "open_circuits": 0 },
  "key_pools": {
    "openrouter": { "total": 3, "active": 3, "cooldown": 0 },
    "nvidia": { "total": 2, "active": 2, "cooldown": 0 }
  }
}
```

---

## 🔌 Client Integrations

### OpenCode 2 (`~/.config/opencode2/opencode.json`)
```json
{
  "provider": {
    "literouter": {
      "npm": "@ai-sdk/openai-compatible",
      "baseURL": "http://localhost:7766/v1",
      "apiKey": "lr-or-oa-ch-no",
      "models": {}
    }
  }
}
```

### Claude Code CLI
```bash
export ANTHROPIC_BASE_URL="http://localhost:7766"
export ANTHROPIC_API_KEY="lr-or-cl-ms-no"
claude
```

### Python (OpenAI SDK)
```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:7766/v1",
    api_key="lr-nv-oa-ch-no"
)

response = client.chat.completions.create(
    model="nvidia/llama-3.1-nemotron-70b-instruct",
    messages=[{"role": "user", "content": "Explain quantum computing in 2 sentences."}]
)
print(response.choices[0].message.content)
```

---

## 📁 Repository Structure

```
literouter/
├── src/
│   ├── index.ts               # Core Bun gateway server & router
│   ├── directive/             # Directive key parser & wire dispatcher
│   ├── handlers/              # OpenAI, Anthropic, Google native handlers
│   ├── network/               # HTTP/2 connection pool & token bucket pacer
│   ├── pools/                 # In-memory key pools & rotation engine
│   └── transform/             # Reasoning scrubbers & XML tool extractors
├── eval/
│   ├── eval.ts                # Master 60-second evaluation orchestrator
│   ├── speed.ts               # TTFT & tokens/sec speed benchmark
│   ├── code.ts                # 5-stage agentic coding benchmark
│   ├── web.ts                 # 5-stage frontend DOM/React benchmark
│   └── reports/               # Auto-generated model report cards
├── config/
│   ├── providers.json         # Upstream provider headers & endpoints
│   └── fusion.json            # Fusion fallback chains & presets
├── scripts/
│   ├── start.sh               # Background tmux daemon launcher
│   ├── stop.sh                # Graceful gateway shutdown
│   ├── restart.sh             # Zero-downtime gateway restart
│   ├── doctor.ts              # Upstream API key diagnostic probe
│   └── setup_certs.sh         # Local TLS certificate generator
├── .env.example               # Configuration template
└── CHANGELOG.md               # Version history
```

---

## 📜 License

MIT License. Built with ❤️ by the Acivar Digital team for the AI builder community.
