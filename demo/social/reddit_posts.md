# LiteRouter Reddit Launch Posts

This file contains three community-tailored launch posts for LiteRouter. Each is written for a specific subreddit's audience and includes anticipated Q&A.

---

## Post 1: r/programming

**Title:** Show: LiteRouter — A Bun/TypeScript gateway that solves 429 stalls, key waste, and reasoning-token bleed with Redis Lua ZSET rotation

**Body:**

I'm posting this because I kept hitting the same three walls while running AI coding agents across multiple providers, and none of the existing open-source tools solved all three in a single process. LiteRouter is what I built to fix it.

https://github.com/Acivar-Digital/literouter

### The three problems, concretely

1. **429 stalls freeze the agent loop.** Every time a provider key hits a rate limit, the client (OpenCode, Claude Code, Cursor, etc.) backs off for 65 seconds. Your terminal hangs. Your CI script freezes. Nobody talks during that time. Most proxies (including LiteLLM) just `sleep(backoff)` on the client side.

2. **Key pools waste.** With multiple keys per provider — teams, org accounts, rotation — some keys burn through quota while others sit idle. Basic round-robin doesn't account for per-key health, and without atomic operations, concurrent requests cause thundering-herd exhaustion.

3. **Reasoning tokens bleed cost.** Models like DeepSeek-R1, Gemini 2.5 Pro, and others emit `<thinking>` blocks — sometimes 50,000+ tokens. These get injected into every subsequent turn. You pay for the same reasoning repeatedly because the history keeps growing.

### How LiteRouter solves them

**Atomic rolling-window key rotation.** The entire key-selection logic runs in a single Redis Lua script (`EVAL`). It does `ZRANGEBYSCORE` on a 60-second sliding-window ZSET, checks the member count against quota, picks the next healthy key, inserts the timestamp, and applies cooldown state — all atomically. Zero race conditions. When a key hits 429, LiteRouter rotates to the next key in **2,000ms** (not 65s). No Python GIL, no multi-step read-modify-write race.

The Redis schema is simple:
```
rolling:{provider}:{hash}:{model}     — ZSET, 60s sliding window
cooldown:{provider}:{hash}:{model}    — hash, per-key cooldown state
```

**Google thought signature preservation.** When Gemini emits a `thought_signature` token in a tool-use response, LiteRouter captures it and reinjects it into the next assistant message referencing that tool call. Google's own SDK does not do this. Running OpenCode or Claude Code with Gemini 2.5 Pro in an agentic loop, you hit `"Invalid tool call signature"` on the 2nd+ tool call. LiteRouter fixes it.

**Historical reasoning stripping.** `stripReasoningParameters()` in `src/transformers/thinking.ts` removes `thinking`, `thought`, `reasoning_content` from **past** turns in the conversation history while preserving the current response. Saves 50–70% on prompt token costs. Also strips Gemma-breaking `thinkingConfig` and `presence_penalty` fields from payloads.

**Fusion fallback chains.** Define virtual model chains in `fusion.json`. If the primary returns 429/5xx, LiteRouter routes to the next automatically. 65s circuit breaker + 300s (5-min) sticky fallback prevents flapping. `X-Literouter-Model` header tells you which upstream served.

### Technical details

- **Runtime:** Bun 1.2+, single TypeScript process. No Python, no sidecar containers.
- **Transport:** HTTP/2 + HTTP/1.1 ALPN via Bun's native TLS.
- **Config:** `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS` env-var discovery. Adding a provider = zero code changes, just a restart.
- **Daemon management:** `tmux` session with PID tracking, survives SSH disconnects.

### Quick start (30 seconds)

```bash
git clone https://github.com/Acivar-Digital/literouter.git && cd literouter
bun install
cp .env.example .env
# Edit .env with your provider keys
./scripts/start.sh
curl -s http://localhost:7766/health
```

### Honest tradeoffs

- **Requires Redis/Valkey.** The gateway exits(1) on connection failure — no in-memory fallback. Redis is the real architecture.
- **Bun only.** We chose Bun 1.2+ specifically for its native HTTP/2 + TLS ALPN. No Node/Express path.
- **Single maintainer.** This is a one-person project. MIT-licensed. If you need enterprise support, fork it.

### Anticipating questions

**Q: Why not just use LiteLLM?**
LiteLLM is Python/FastAPI. Its key rotation is basic round-robin — no Lua atomicity means concurrent requests can race and exhaust keys simultaneously. It passes reasoning content through (no 50–70% token savings). It doesn't handle Google `thought_signature` injection. It has basic fallback lists but no sticky 5-minute caching. LiteRouter's differentiation is the **atomic Lua ZSET** + **thought signature preservation** + **historical reasoning strip** + **sticky fusion fallback** — none of which exist in LiteLLM.

**Q: Is this production-ready?**
It's running as a daemon with tmux, health probes, per-key cooldowns (rate_limited: 65s, timed_out: 10s, quarantined: 7d), ghost/idle upstream detection, and per-request backoff (65s → 90s → 120s as key pools exhaust). If you need formal SLA, it's MIT-licensed — you own the operation.

**Q: What providers are supported?**
Google AI Studio, OpenRouter, NVIDIA NIM, Anthropic, and any OpenAI-compatible provider (DeepSeek, Groq, Together, Ollama, etc.) via `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS` env discovery. New providers = zero code changes.

**Q: How does the Lua rotation actually work?**
A single `EVAL` script on the Valkey side handles: ZSET timestamp insertion + `ZCOUNT` for the 60s sliding window + `HGET` for cooldown state + `HSET` to apply cooldown + key selection. All in one atomic operation. Two concurrent requests cannot both select the same "next healthy key."

---

## Post 2: r/machinelearning

**Title:** Show: LiteRouter — Self-hosted AI gateway that cuts 429 stalls, reasoning-token waste, and Gemini tool-call failures

**Body:**

If you run AI agents (OpenCode, Claude Code, Cursor) or deploy LLM-powered applications across multiple providers, you've probably hit the same three pain points that cost me real money:

1. **429 rate limit stalls.** Your agent loop freezes for 65 seconds every time a key gets throttled. In a long autonomous coding session, that's minutes of dead time.
2. **API key waste.** You have 3 OpenRouter keys, 2 NVIDIA keys, 2 Google keys. Some burn through quota, others sit idle. No intelligent distribution.
3. **Reasoning token bleed.** Gemini 2.5 Pro, DeepSeek-R1, and similar reasoning models emit `<thinking>` blocks — sometimes 50,000+ tokens. These accumulate in multi-turn context. You're paying for the same reasoning tokens again and again.

LiteRouter is a self-hosted AI gateway I built to solve all three. It's a single Bun/TypeScript process backed by Redis/Valkey.

https://github.com/Acivar-Digital/literouter

### How it saves money and fixes reliability

**Atomic key rotation with 2s failover.** Instead of waiting 65 seconds on a rate-limited key, LiteRouter uses a Redis Lua script to atomically rotate to the next healthy key in **2,000ms**. The Lua script (`EVAL`) does key selection, quota check, and cooldown application in one atomic round-trip — no race conditions across concurrent requests. Backloads degrade gracefully: 65s → 90s → 120s as your entire key pool exhausts.

**Up to 70% savings on reasoning tokens.** The reasoning stripper (`src/transformers/thinking.ts`) removes `thinking`, `reasoning_content`, and `thought` blocks from **historical** turns in your conversation history — but keeps the current response's reasoning intact. For 10+ turn agent conversations, this consistently saves 50–70% on prompt token costs. No other open-source gateway does this selectively.

**Fixes Gemini tool-call signature errors.** Google Gemini 2.5 Pro emits `thought_signature` tokens during tool use. If they're not reinjected correctly on the next turn, you get `"Invalid tool call signature"` and the agent loop breaks. LiteRouter captures and reinjects these automatically. Google's own SDK doesn't handle this — I discovered this the hard way while running OpenCode against Gemini.

**Fusion fallback chains.** If your primary model returns 429 or 5xx, LiteRouter routes to the next model in your chain automatically. 65s circuit breaker per model, 300s (5-min) sticky fallback to prevent flapping. The `X-Literouter-Model` header tells you which upstream served.

### Supported providers

Google AI Studio, OpenRouter, NVIDIA (NIM), Anthropic, and any OpenAI-compatible endpoint (DeepSeek, Groq, Together, Ollama, etc.).

### Quick start

```bash
git clone https://github.com/Acivar-Digital/literouter.git && cd literouter
bun install
cp .env.example .env   # Add your keys: GOOGLE_API_KEYS, OPENROUTER_API_KEYS, NVIDIA_API_KEYS, etc.
./scripts/start.sh
curl -s http://localhost:7766/health
```

Run the diagnostic doctor to validate your keys before going live:

```bash
bun run scripts/doctor.ts
```

This probes each key against real provider endpoints and classifies them: PASS, RATE_LIMITED (auto cooldown), or FAIL (auto-excluded from rotation).

### Honest limitations

- **Not a cost-comparison tool.** The savings numbers (50–70%) come from stripping reasoning from history. Your mileage depends on conversation length and model choice.
- **Requires Redis/Valkey.** This is a hard dependency, not optional. The gateway exits if Redis is unreachable.
- **No provider abstraction.** LiteRouter routes your real keys to real upstreams. It doesn't resell or mark up tokens.

### Anticipating questions

**Q: Why not use LiteLLM or OpenRouter?**
LiteLLM passes reasoning content through and has no Lua-based atomic rotation. OpenRouter is a SaaS aggregator — you pay their markup per token, and you can't rotate your own key pools through it. LiteRouter is self-hosted: you use your own keys, your own provider accounts, with no middleman. OpenRouter also doesn't give you multi-key rotation across your own pool.

**Q: Is it production-ready?**
It's running as a daemon with tmux, health probes, per-key cooldowns (rate_limited: 65s, timed_out: 10s, quarantined: 7d), ghost/idle upstream detection, and per-request backoff (65s → 90s → 120s). MIT-licensed. You operate it yourself.

**Q: What providers are supported?**
Google AI Studio, OpenRouter, NVIDIA, Anthropic, and any OpenAI-compatible provider via `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS` env discovery. Adding a provider requires zero code changes — just edit `.env` and restart.

**Q: How does the Lua rotation work?**
Valkey stores `rolling:{provider}:{hash}:{model}` (ZSET, 60s sliding window) and `cooldown:{provider}:{hash}:{model}` (hash, per-key state). A single `EVAL` script does ZSET insertion + quota `ZCOUNT` + cooldown `HGET` + state `HSET` — all atomically. Two concurrent requests cannot both exhaust the same key.

**Q: The 70% savings claim — what does that actually mean?**
If you're running a 15-turn agent conversation where each turn includes 8,000 reasoning tokens from Gemini 2.5 Pro, that's 120,000 tokens of reasoning injected into history that you're paying for but never acting on. LiteRouter strips those historical blocks. The 70% figure is on prompt token costs only — not output tokens. Your actual savings depend on conversation depth and reasoning intensity.

---

## Post 3: r/selfhosted

**Title:** Show: LiteRouter — Self-hosted AI gateway for OpenCode/Claude Code with atomic key rotation, Redis Lua ZSET, and 70% reasoning-token savings

**Body:**

I've been running multiple LLM providers (Google AI Studio, OpenRouter, NVIDIA) for autonomous coding with OpenCode, and I kept hitting the same problems that ate time and money:

- My agent loop would freeze for 65 seconds every time a provider key hit a rate limit
- Keys were being wasted — some burned through quota while others sat idle
- Gemini 2.5 Pro kept failing on multi-step tool calls with signature errors
- My API bills ballooned because reasoning tokens (`<thinking>` blocks, 50k+ tokens) got repeated in every turn's context

So I built LiteRouter: a single-process, self-hosted AI gateway written in Bun/TypeScript with Redis/Valkey.

https://github.com/Acivar-Digital/literouter · License: MIT

### What it does

**Atomic key rotation (2s failover, not 65s).** All key selection, quota checking, and cooldown state happens in a single Redis Lua script. Zero race conditions. When a key hits 429, LiteRouter picks the next healthy key in 2,000ms. Backoffs degrade gracefully: 65s → 90s → 120s.

**Reasoning token stripping (50–70% savings).** Removes `thinking`, `reasoning_content`, and `thought` blocks from **historical** conversation turns while preserving the current response. Also strips Gemma-breaking fields (`thinkingConfig`, `presence_penalty`, `logit_bias`).

**Google thought signature injection.** Captures and reinjects `thought_signature` tokens across tool calls — fixes the `"Invalid tool call signature"` errors that Google's own SDK doesn't handle.

**Fusion fallback chains.** Virtual model chains with 65s circuit breaker + 300s sticky fallback. Auto-routes to next provider on 429/5xx.

### Architecture (single process, minimal footprint)

```
Literouter/
├── src/index.ts              # Bun server: routing, ZSET+Lua quota, fusion, streaming
├── models.json               # Model routing registry
├── fusion.json               # Fusion group definitions (priority chains)
├── scripts/                  # start.sh / stop.sh / restart.sh (tmux daemon)
├── .env.example              # Template with all options
└── CHANGELOG.md
```

- **Runtime:** Bun 1.2+ (TypeScript, single process)
- **Backend:** Redis / Valkey (required — exits if unreachable)
- **Port:** 7766 (default)
- **Protocol:** HTTP/2 + HTTP/1.1 ALPN via Bun native TLS
- **Daemon:** tmux session management with PID tracking

### Quick start (30 seconds)

```bash
# Prerequisites: Bun 1.2+ and Redis/Valkey running
curl -fsSL https://bun.sh/install | bash

git clone https://github.com/Acivar-Digital/literouter.git && cd literouter
bun install
cp .env.example .env

# Edit .env: set LITEROUTER_AUTH_KEY, REDIS_HOST, and your provider keys
# Providers are discovered automatically via {PROVIDER}_BASE_URL + {PROVIDER}_API_KEYS

./scripts/start.sh
curl -s http://localhost:7766/health
```

For HTTPS with HTTP/2, generate localhost TLS certs:

```bash
./scripts/setup_certs.sh   # Uses mkcert
./scripts/restart.sh
```

### Docker option

```bash
docker run -d --name valkey -p 6379:6379 valkey/valkey:alpine
git clone https://github.com/Acivar-Digital/literouter.git && cd literouter
bun install && cp .env.example .env
# Edit .env with your keys
./scripts/start.sh
```

### Health and diagnostics

```bash
# Live health probe
curl -s http://localhost:7766/health
# Returns: per-provider key counts, health scores, active cooldowns, Redis status

# Pre-flight key validation
bun run scripts/doctor.ts
# Probes each API key against real provider endpoints, classifies as PASS / RATE_LIMITED / FAIL

# Management
tmux attach -t literouter   # View logs (Ctrl+B, D to detach)
./scripts/stop.sh
./scripts/restart.sh
```

### Honest tradeoffs

- **Redis is mandatory.** No in-memory fallback. If Redis goes down, the gateway exits(1). This is by design — the Lua ZSET atomicity requires a real backing store.
- **Bun-only.** No Node.js/Express path. Bun's native HTTP/2 + TLS ALPN was a hard requirement for the transport layer.
- **Single maintainer.** This is a personal project. Issues are welcome but responses may be slow.
- **Not a provider.** LiteRouter routes your real keys to real upstreams. It doesn't resell or abstract tokens.

### Anticipating questions

**Q: Why not LiteLLM?**
LiteLLM is Python/FastAPI — higher overhead, and its key rotation is basic round-robin without atomicity. Under concurrent load, multiple Python processes can race on the same key. LiteRouter pushes the entire key-selection + quota-check + cooldown logic into a single Lua `EVAL` script on the Valkey side. No race window exists. LiteLLM also passes reasoning content through (no 50–70% savings) and doesn't handle Google `thought_signature` injection.

**Q: Is it production-ready?**
The gateway runs as a tmux daemon, exposes `/health` for monitoring, and has per-key cooldowns (rate_limited: 65s, timed_out: 10s, quarantined: 7d). It survives SSH disconnects, handles client disconnects gracefully, and degrades backoff gracefully (65s → 90s → 120s as pools exhaust). MIT-licensed — you own the ops.

**Q: What providers are supported?**
Google AI Studio, OpenRouter, NVIDIA, Anthropic, and any OpenAI-compatible provider (DeepSeek, Groq, Together, Ollama, etc.). Add new providers by setting `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS` in `.env` and restarting — zero code changes.

**Q: How does the Lua rotation work?**
Valkey stores two key patterns:
- `rolling:{provider}:{hash}:{model}` — ZSET with timestamped members, queried via `ZCOUNT` for the 60-second sliding window
- `cooldown:{provider}:{hash}:{model}` — hash of per-key cooldown state

The Lua script (`EVAL`) chains these operations atomically: `ZADD` the new request → `ZCOUNT` the window → `HGET` cooldown state → `HSET` if 429/timeout → select next healthy key. The client gets the rotated key in a single round-trip.

**Q: What's the resource footprint?**
Single Bun process. Memory usage is typically under 100MB at idle. Redis/Valkey is the only external dependency. No Python, no Docker sidecars, no Node.js.

**Q: Can I run it behind a reverse proxy?**
Yes. The gateway serves HTTP/2 + HTTP/1.1 ALPN when TLS certs are present (`certs/localhost.pem`, `certs/localhost-key.pem`). Behind Caddy/Nginx/Caddy, you can terminate TLS at the proxy and forward to `http://localhost:7766`. The `Authorization: Bearer` header is preserved.
