# LiteRouter — Quick-Start Cheat Sheet

> Fast reference for installing, configuring, and running LiteRouter.
> Aligned with `demo/POSITIONING.md`.

---

## One-Liner Install

```bash
git clone https://github.com/Acivar-Digital/literouter.git && cd literouter && bun install && cp .env.example .env && ./scripts/start.sh
```

---

## Prerequisites

| Tool | Version | Required? |
|------|---------|-----------|
| Bun | 1.2+ | ✅ YES |
| Redis / Valkey | any | ✅ YES (gateway exits(1) on connection failure) |
| TLS certs (mkcert) | — | ⚠️ Optional (HTTPS/HTTP2); falls back to HTTP/1.1 plaintext |

---

## `.env` Quick Reference

```env
# ── Server ──
LITEROUTER_PORT=7766
LITEROUTER_AUTH_KEY=YOUR_LITEROUTER_BEARER_KEY     # sent as Authorization: Bearer …

# ── Redis (REQUIRED) ──
REDIS_HOST=localhost
REDIS_PORT=6379
# REDIS_PASSWORD=...   # only if your Redis requires auth

# ── Default routing ──
LITEROUTER_TEMPLATE=openai
LITEROUTER_PROVIDER=openrouter

# ── Provider: OpenRouter ──
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_API_KEYS=key1,key2,key3                 # comma-separated for rotation
OPENROUTER_MIN_DELAY_MS=3000

# ── Provider: NVIDIA ──
NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1
NVIDIA_API_KEYS=key1,key2
NVIDIA_MIN_DELAY_MS=3000

# ── Provider: Anthropic (optional) ──
# ANTHROPIC_BASE_URL=https://api.anthropic.com
# ANTHROPIC_API_KEYS=sk-ant-...
```

**Naming convention:** `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS` + `{PROVIDER}_MIN_DELAY_MS`. The config scanner auto-discovers any provider matching this pattern. Restart to pick up new providers.

---

## Top 5 Commands

| # | Command | What It Does |
|---|---------|--------------|
| 1 | `./scripts/start.sh` | Start LiteRouter (daemonizes in tmux; writes PID file) |
| 2 | `./scripts/restart.sh` | Restart (flushes Valkey, re-reads `.env`) |
| 3 | `./scripts/stop.sh` | Stop the daemon |
| 4 | `bun run scripts/doctor.ts` | Pre-flight: validates Redis + probes every API key (`PASS` / `RATE_LIMITED` / `FAIL`) |
| 5 | `tmux attach -t literouter` | View live runtime logs (Ctrl+B then D to detach) |

---

## Port & Endpoints

**Default port:** `7766`

| Endpoint | Protocol | Target | Auth |
|----------|----------|--------|------|
| `/v1/chat/completions` | HTTP/2 or HTTP/1.1 (ALPN) | Provider upstream (Google: `/v1beta/openai/chat/completions`) | `Authorization: Bearer {key}` |
| `/v1/models` | HTTP/2 or HTTP/1.1 (ALPN) | Aggregates all registered models from `models.json` + `fusion.json` | `Authorization: Bearer {key}` |
| `/v1beta/...` | HTTP/2 or HTTP/1.1 (ALPN) | `generativelanguage.googleapis.com/v1beta/models/{model}:{action}` | `?key={API_KEY}` query param |
| `/health` | HTTP/2 or HTTP/1.1 (ALPN) | Service + provider status probe | None |
| Fusion groups | HTTP/2 or HTTP/1.1 (ALPN) | Virtual chain (in-process); iterates model chain | Internal |

**TLS:** If `certs/localhost.pem` + `certs/localhost-key.pem` exist → HTTPS+HTTP2. Otherwise → plaintext HTTP/1.1.

---

## Quick Test

```bash
curl -X POST https://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer $LITEROUTER_AUTH_KEY" \
  -H "Content-Type: application/json" \
  --cacert certs/localhost.pem \
  -d '{"model": "openrouter/deepseek-chat", "messages": [{"role": "user", "content": "Hello!"}]}'
```

Check health:
```bash
curl https://localhost:7766/health --cacert certs/localhost.pem
```

**Routing by prefix:** `opencode run -m openrouter/…` → OpenRouter key pool. `opencode run -m nvidia/…` → NVIDIA key pool.

---

## FAQ

**Q: Why Redis/Valkey — is in-memory rotation supported?**
A: Redis is **required**. The gateway exits(1) if it cannot connect. In-memory mode is not the primary design — atomic Lua ZSET rotation is the real architecture. No in-memory fallback exists.

**Q: How fast does 429 recovery happen?**
A: **2 seconds**, not 65. LiteRouter rotates to the next healthy key in a Lua ZSET rolling-window. The client never stalls.

**Q: Can I use this with OpenCode / Claude Code / Cursor?**
A: Yes — drop-in proxy. In `opencode.json`, use the `@ai-sdk/openai-compatible` SDK with `baseURL: https://localhost:7766/v1`. Do **not** use `@ai-sdk/openai` (it hits `/v1/responses` which upstreams don't accept).

**Q: Does LiteRouter strip reasoning tokens?**
A: Yes. It strips **<thinking>** / `reasoning_content` from historical context turns while preserving the **current** response's reasoning. Saves up to 70% on prompt token costs.

**Q: Does it fix Gemini tool-call signature errors?**
A: Yes. LiteRouter captures Google's `thought_signature` token from a tool-use response and reinjects it into the next assistant message — preventing `"Invalid tool call signature"` failures. Google's own SDK does not do this.

**Q: What are Fusion fallback chains?**
A: Define virtual models in `fusion.json`. If the primary model returns 429/5xx, LiteRouter routes to the next model automatically. Fallback **sticks** for 300s (5 min) to prevent flapping. A `X-Literouter-Model` header tells you which upstream actually served the request.

**Q: Is it open source? Can I self-host?**
A: Yes — MIT license, 100% self-hosted, no SaaS markup, no vendor lock-in.

---

## See Also

| Doc | What's Inside |
|-----|---------------|
| `demo/POSITIONING.md` | Master truth source — all marketing claims must align |
| `docs/ARCHITECTURE.md` | Full architecture, folder maps, design decisions |
| `INSTALL.md` | Step-by-step autonomous install guide for AI coding assistants |
| `docs/Upgrade_http2.md` | TLS cert setup via mkcert for HTTPS/HTTP2 |
| `KIV.md` | Deferred/experimental features |
| `GRAVEYARD.md` | Rejected architecture decisions (why no Python ORMs, no admin GUI, etc.) |
