# 🪦 LiteRouter Architecture Graveyard

This directory contains design documents, architectural plans, and deprecated implementation specs that have been shelved or canned.

## Shelved Ideas

### 1. [LITEROUTER_STREAMING.md](LITEROUTER_STREAMING.md) — Reasoning-Collapsing Workaround
* **Status**: 🪦 **Canned**
* **Context**: This document detailed a complex client-side/proxy-side workaround designed to translate and intercept reasoning/thinking tokens (like those from Gemma-4) and collapse them into the default `content` field.
* **Why it was discarded**: The translation layer proved to be fragile, over-engineered, and prone to stream/SSE corruption. Instead, the system was simplified to pass reasoning tokens through natively, rendering this workaround obsolete.

### 2. [JSON_CLEANER.md](JSON_CLEANER.md) — OpenRouter-style JSON Repair Pass
* **Status**: 🪦 **Canned**
* **Context**: A user asked whether LiteRouter should replicate OpenRouter's `openrouter/cleaner` (a post-processing model that repairs malformed/unparseable JSON from model responses).
* **Why it was discarded**: The gateway is a transparent router — `response_format` passes through to upstreams which enforce JSON themselves. A silent repair pass violates the fail-loud principle (masks upstream bugs) and adds a per-response latency/cost tax. The optional client-opt-in flag (`x-literouter-clean-json`) was also rejected to keep the gateway transparent.

### 3. [ANYIO.md](ANYIO.md) — Python async abstraction
* **Status**: 🪦 **Canned**
* **Context**: A user asked whether LiteRouter should adopt anyio (a Python asyncio/trio portability layer).
* **Why it was discarded**: The gateway is Bun/TypeScript, not Python — anyio has no surface there. The remaining Python is thin pytest/administrative glue already covered by `pytest-asyncio` + `httpx`; anyio only arrives transitively via pydantic-ai. No code needs asyncio/trio portability, so promoting it would be speculative (YAGNI).

### 4. [SUPERSIZE_BLUEPRINT.md](SUPERSIZE_BLUEPRINT.md) — "Supersize Your Bun Router" framework/plugin blueprint
* **Status**: 🪦 **Canned (mostly) / Deferred (one item)**
* **Context**: A user pasted a generic LLM blueprint recommending Bungate/Elysia/Hono, Unkey, rate-limit/idempotency/proxy plugins, and three "architectural upgrades" (streaming, circuit breaker, smart key prioritization).
* **Why it was discarded**: Most of it is already implemented (native SSE streaming, Redis-backed circuit breaker + cooldowns, Redis quota limits). The framework/plugin recommendations are a pointless rewrite or external vendor lock-in that contradicts the transparent-router / fail-loud / YAGNI principles. Only `x-ratelimit-remaining` parsing is deferred as optional polish.

### 5. [VENDOR_IDEAS_DEFERRED.md](VENDOR_IDEAS_DEFERRED.md) — Portkey / Bifrost / RelayPlane / AgentGateway
* **Status**: 🪦 **Canned (already-right or not-applicable)**
* **Context**: A user asked whether to adopt patterns from 4 vendor gateways (read from `arthityap/vendor/`, 2026-07-17).
* **Why it was discarded**: Full matrix in `docs/VENDOR_ANALYSIS.md`. Portkey delegates abort/quota/circuit/cost to its hosted SaaS — we already do all four in-repo (ahead). Bifrost is **Go** (not Bun/TS) — not portable. RelayPlane's cost math is captured separately in `docs/KIV_cost_tracking.md`. AgentGateway (Rust+Go) validates our Plan #1 and is otherwise already-right. Nothing to adopt.

### 6. Redis Integration & Backend Dependency
* **Status**: 🪦 **Replaced by Valkey**
* **Context**: LiteRouter originally relied on direct Redis integration and configuration (`REDIS_HOST`, `REDIS_PASSWORD`, etc.) for persistence, metrics, and key rotation state.
* **Why it was discarded**: To maintain strict independence and adhere to open-source software principles, direct dependency on Redis has been deprecated in favor of **Valkey** (the fully open-source key-value database fork). The codebase preserves protocol-level compatibility for seamless migration.
