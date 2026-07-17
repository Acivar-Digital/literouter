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

### 4. Redis Integration & Backend Dependency
* **Status**: 🪦 **Replaced by Valkey**
* **Context**: LiteRouter originally relied on direct Redis integration and configuration (`REDIS_HOST`, `REDIS_PASSWORD`, etc.) for persistence, metrics, and key rotation state.
* **Why it was discarded**: To maintain strict independence and adhere to open-source software principles, direct dependency on Redis has been deprecated in favor of **Valkey** (the fully open-source key-value database fork). The codebase preserves protocol-level compatibility for seamless migration.
