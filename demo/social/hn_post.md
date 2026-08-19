# Show HN: LiteRouter — A Bun/TypeScript AI Gateway That Solves 429 Stalls, Key Waste, and Reasoning-Token Bleed

**GitHub:** https://github.com/Acivar-Digital/literouter
**License:** MIT
**Runtime:** Bun 1.2+ / TypeScript (single process, no Python)
**Backend:** Redis / Valkey (ZSET + Lua atomic scripts)

---

## The Problem I Kept Hitting

Every AI developer running agents across multiple providers eventually hits the same three walls. I built LiteRouter because I was hitting all three simultaneously while running OpenCode against Google, OpenRouter, and NVIDIA:

1. **429 stalls.** A rate-limited key freezes the entire agent loop for 65 seconds while the client sidebacks off. Your IDE hangs. Your automation script freezes. Nobody is talking during that time.
2. **Key pool waste.** With multiple API keys across providers, some keys burn through quota while others sit idle. No intelligent distribution — just manual round-robin or provider-side rate limits that don't account for key health.
3. **Reasoning token bleed.** Models like DeepSeek-R1, Gemini 2.5 Pro, and others emit `<thinking>` blocks — sometimes 50,000+ tokens. These get injected into every subsequent turn's context. You pay for the same reasoning tokens again and again.

Existing open-source gateways don't solve all three. LiteLLM (Python) lacks atomic rotation — concurrent requests cause thundering-herd exhaustion. SaaS gateways (OpenRouter) abstract multi-key pools away from you. AWS/GCP API Gateways are fast but zero-intelligence.

## The Architecture

LiteRouter is a single Bun process that sits between your AI client (OpenCode, Claude Code, Cursor, custom apps) and upstream providers. It uses Redis/Valkey Sorted Sets with Lua scripts for atomicity, and Bun's native HTTP/2 + HTTP/1.1 ALPN negotiation for transport.

Here is how each problem gets solved at the implementation level:

### 1. Atomic Rolling-Window Key Rotation (Redis Lua ZSET)

The core rotation logic lives in `src/index.ts` and uses a Redis `EVAL` script that does **three things atomically**:

- Inserts a timestamped member into a `rolling:{provider}:{hash}:{model}` ZSET (60-second sliding window)
- Checks the member count against per-model quota
- On 429: applies a per-key cooldown to `cooldown:{provider}:{hash}:{model}` (rate_limited: 65s, timed_out: 10s, quarantined: 7d)

Because this is a single Lua script execution on the Valkey side, there are **zero race conditions**. Two concurrent requests cannot both pick the same "next healthy key" and exhaust it simultaneously.

**The payoff:** when a key hits 429, LiteRouter rotates to the next key in **2,000ms** (not 65 seconds). The client never stalls. The full backoff sequence degrades gracefully: 65s → 90s → 120s as key pools exhaust.

### 2. Google Thought Signature Preservation

When Google Gemini emits a `thought_signature` token in a tool-use response, the signature is captured and **reinjected** into the next assistant message referencing that tool call. This lives in `src/transformers/thinking.ts`.

Why this matters: if you're running OpenCode or Claude Code with Gemini 2.5 Pro in an agentic loop, multi-step tool calls fail with `"Invalid tool call signature"` — Google's own SDK does not handle this automatically. LiteRouter fixes it transparently.

### 3. Selective Reasoning Stripping (Save 50–70% in Token Costs)

`stripReasoningParameters()` and `shouldStripReasoning()` in `src/transformers/thinking.ts` handle two cases:

- **Outgoing payload sanitization:** removes `thinking`, `thinkingConfig`, `reasoning_effort`, `budget_tokens` from the request when the target model doesn't support them (also strips Gemma-breaking `thinkingConfig` from payloads).
- **Historical reasoning removal:** strips reasoning content from **past** turns in the conversation history while **preserving** the current response's reasoning. This is where the 50–70% savings come from — multi-turn agent logs no longer balloon with repeated `<thinking>` blocks.

### 4. Fusion Fallback Chains (Sticky Virtual Model Routing)

Defined in `fusion.json` and orchestrated in `src/index.ts`. If the primary model returns 429 or 5xx, LiteRouter routes to the next model in the chain automatically. Two mechanisms prevent flapping:

- **Circuit breaker:** 65s cooldown per model after an error
- **Sticky fallback:** 300s (5 min) window — once the chain falls back, subsequent requests start from the fallback, not the top

The response header `X-Literouter-Model` tells your client which upstream actually served the request.

## Quick Start (30 Seconds)

```bash
git clone https://github.com/Acivar-Digital/literouter.git && cd literouter
bun install
cp .env.example .env
# Edit .env with your provider keys (Google, OpenRouter, NVIDIA, Anthropic, or custom)
./scripts/start.sh
```

LiteRouter daemonizes in a `tmux` session named `literouter`. Health probe:

```bash
curl -s http://localhost:7766/health
```

Returns per-provider stats: key counts, health scores, active cooldowns, rotation counter position, and Redis connection status.

## Honest Tradeoffs

- **Requires Redis/Valkey:** the gateway exits(1) on connection failure. There is no in-memory fallback. Redis is the real architecture, not an option.
- **Bun ecosystem maturity:** we depend on Bun 1.2+. Node.js/Express was not chosen — Bun's native TLS + HTTP/2 ALPN was a hard requirement.
- **Not a provider:** LiteRouter is a proxy, not a model endpoint. It routes to your provider credentials; it doesn't abstract them away.

## Links

- GitHub: https://github.com/Acivar-Digital/literouter
- Docs: https://github.com/Acivar-Digital/literouter/blob/main/demo/POSITIONING.md
- Quick start: https://github.com/Acivar-Digital/literouter/blob/main/docs/INSTALL.md

---

## Anticipating Likely Questions

**Q: Why not LiteLLM?**

LiteLLM is a fine project, but it solves different problems. It's Python/FastAPI (higher overhead), uses basic round-robin key rotation (no Lua atomicity — concurrent requests can race), passes reasoning content through (no 50–70% savings), and has no Google `thought_signature` injection. LiteRouter's differentiation is the **atomic Lua ZSET** + **Google thought signature preservation** + **reasoning strip from history** + **sticky fusion fallback** — none of which exist in LiteLLM.

**Q: Is it production-ready?**

Yes — it's running as a daemon with tmux process management, health probes, per-key cooldowns (rate_limited: 65s, timed_out: 10s, quarantined: 7d), ghost/idle upstream detection, and per-request backoff (65s → 90s → 120s). It's designed for self-hosted deployment behind a single process. If you need enterprise support, it's MIT-licensed — fork and operate it yourself.

**Q: What providers are supported?**

Google AI Studio, OpenRouter, NVIDIA (NIM), Anthropic, and any OpenAI-compatible provider (DeepSeek, Groq, Together, Ollama, etc.) via dynamic `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS` env discovery. Adding a provider requires zero code changes — just a restart.

**Q: How does the Lua rotation work?**

Valkey stores two key patterns:
- `rolling:{provider}:{hash}:{model}` — a ZSET with timestamped members, queried with `ZCOUNT` for the 60-second sliding window
- `cooldown:{provider}:{hash}:{model}` — a hash of per-key cooldown state (65s rate-limit, 10s timeout, 7d quarantine)

The Lua script (`ZRANGEBYSCORE` + `ZCARD` + `HGET` + `ZADD` + `HSET` + `ZREM` chained atomically) selects the next healthy key in a single `EVAL` round-trip. No race window exists between read and write.

**Q: How does it compare to OpenRouter as a SaaS?**

OpenRouter is a hosted aggregator — you pay their markup. LiteRouter is self-hosted: you use your own keys, your own provider accounts, with no middleman mark-up. OpenRouter also doesn't give you multi-key atomic rotation across your own pool — you're on a single OpenRouter account.
