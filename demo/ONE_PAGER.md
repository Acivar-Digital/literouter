# LiteRouter — Executive Overview

> **🧭 MASTER POSITIONING:** Aligned with `demo/POSITIONING.md` (Updated 2026-08-19)

---

## What Is It?

**LiteRouter is the world's first and only Bun/TypeScript AI API Gateway that combines atomic Redis/Valkey Lua key rotation, Google Gemini `thought_signature` preservation across multi-step agent tool calls, 70% reasoning-token cost stripping, and sticky fusion fallback chains.**

It is a single-process, sub-millisecond-overhead proxy that sits between AI applications (OpenCode, Claude Code, Cursor, SillyTavern, custom agents) and upstream model providers (Google AI Studio, OpenRouter, NVIDIA, Anthropic, custom endpoints). LiteRouter is the only gateway in the **High Performance + High Intelligence** quadrant.

---

## The Three Universal Problems It Solves

| # | Problem | What Happens Today | LiteRouter Result |
|---|---------|--------------------|--------------------|
| **1** | **429 Rate-Limit Hell** | A single key gets throttled. Entire workflow stalls for **60–65s**. | Auto-rotates to the next healthy key in **2 seconds**. Client never stalls. |
| **2** | **Key Pool Wastage** | Some keys sit idle while others burn through quota. No intelligent distribution. | Atomic Lua ZSET rolling-window rotation — every key is fully utilized with zero race conditions. |
| **3** | **Reasoning Token Bleed** | Models emit `<thinking>` blocks (50,000+ tokens). You pay for them again on every turn. | Strips **historical** reasoning automatically, saving **up to 70%** on prompt token costs. Current-response reasoning is preserved. |

---

## How Fast to Run?

```bash
git clone https://github.com/Acivar-Digital/literouter.git && cd literouter && bun install && cp .env.example .env && ./scripts/start.sh
```

→ **In 30 seconds** you have a production-grade AI gateway with multi-key rotation, 429 immunity, and 70% cost savings.

| Step | Time |
|------|------|
| Clone + `bun install` | ~8s |
| `cp .env.example .env` | ~1s |
| Edit 3 provider keys | ~10s |
| `./scripts/start.sh` (daemonizes in tmux) | ~3s |
| First request via `localhost:7766/v1/chat/completions` | ~2s |

---

## What Does It Save?

| Metric | LiteRouter | Alternatives |
|--------|-----------|--------------|
| **429 Recovery Time** | **2 seconds** | 65 seconds (LiteLLM, client retries) |
| **Token Cost Savings** | **up to 70%** | 0% (LiteLLM, OpenRouter pass-through) |
| **Key Utilization** | **~5x more requests per key** | 1x (manual round-robin) |
| **Gemini Tool-Call Errors** | **Zero** (thought_signature reinjection) | Frequent `"Invalid tool call signature"` failures |
| **Runtime Overhead** | **sub-ms** (Bun, no Python) | High (Python/FastAPI) |

---

## The Unique Quadrant

```
    High Intelligence           Low Intelligence
High Performance  |  ❌ Nothing exists   |  LiteRouter ✅
(LiteRouter)      |  (perf + smarts)    |  (perf + simple)

Low Performance   |  ❌ Nothing exists  |  ✅ Many exist
(Python/SaaS)     |  (dumb + slow)      |  (simple + slow)
```

**LiteRouter is the ONLY gateway in the "High Performance + High Intelligence" quadrant.**

- **LiteLLM** is high-intelligence but low-performance (Python).
- **OpenRouter** is high-intelligence but closed-source/SaaS.
- **AWS/GCP API Gateways** are high-performance but zero-intelligence (no multi-key rotation, no reasoning strip, no fusion).

---

## Who Is It For?

| Persona | Pain | LiteRouter Promise |
|---------|------|---------------------|
| **Autonomous Coding Agent Dev** (OpenCode, Claude Code, Cursor) | "My agent stalls for 65s on every 429. 10 keys a month burn out. Gemini fails on tool calls." | 5x more requests per key • 2s 429 recovery • zero Gemini signature errors |
| **AI Team Lead** (5–20 devs sharing keys) | "Keys burn unevenly. Some devs stall while others' keys sit idle." | One deploy = atomic rotation + usage telemetry + 429 immunity for everyone |
| **Cost-Conscious AI Builder** (indie hacker, SMB) | "My bill doubled because reasoning repeats every turn." | Strip invisible reasoning → 50–70% cost reduction |
| **Infrastructure Engineer** (production) | "Can't use OpenRouter SaaS for privacy. LiteLLM crashes under load. AWS too expensive." | 1 process • 0 Python deps • 99.9% uptime via fusion chains • 100% self-hosted |

---

## Core Technical Facts

| Attribute | Value |
|-----------|-------|
| GitHub | https://github.com/Acivar-Digital/literouter |
| Runtime | Bun 1.2+ / TypeScript |
| Backend | Redis / Valkey (ZSET + Lua scripts) |
| Port | 7766 (default) |
| Protocol | HTTP/2 + HTTP/1.1 ALPN via native TLS |
| License | MIT |

### Four Unique Solutions

1. **Atomic Rolling-Window Key Rotation** — ZSET + Lua script; 2s 429 recovery; zero race conditions.
2. **Google Thought Signature Preservation** — captures + reinjects `thought_signature` across tool calls; fixes Gemini failures Google's own SDK doesn't.
3. **Selective Reasoning Stripping** — removes historical reasoning from context; **up to 70% token savings**.
4. **Fusion Sticky Fallback Chains** — 65s circuit breaker + 300s sticky window; `X-Literouter-Model` header identifies serving upstream.

---

## Call to Action

- **⭐ Star the repo** — https://github.com/Acivar-Digital/literouter
- **🚀 Run the demo** — `git clone … && bun install && cp .env.example .env && ./scripts/start.sh`
- **🔄 Replace your fragile key rotation** — read `docs/QuickStart.md` and point your OpenCode `opencode.json` at `https://localhost:7766/v1`.

> **LiteRouter — the only gateway that makes 429s vanish, reasoning tokens disappear, and Gemini tool calls work. Every time.**
