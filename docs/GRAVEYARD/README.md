# 🪦 LiteRouter Architecture Graveyard

This directory contains design documents, architectural plans, and deprecated implementation specs that have been shelved or canned.

## Shelved Ideas

### 1. [LITEROUTER_STREAMING.md](LITEROUTER_STREAMING.md) — Reasoning-Collapsing Workaround
* **Status**: 🪦 **Canned**
* **Context**: This document detailed a complex client-side/proxy-side workaround designed to translate and intercept reasoning/thinking tokens (like those from Gemma-4) and collapse them into the default `content` field.
* **Why it was discarded**: The translation layer proved to be fragile, over-engineered, and prone to stream/SSE corruption. Instead, the system was simplified to pass reasoning tokens through natively, rendering this workaround obsolete.

### 2. Redis Integration & Backend Dependency
* **Status**: 🪦 **Replaced by Valkey**
* **Context**: LiteRouter originally relied on direct Redis integration and configuration (`REDIS_HOST`, `REDIS_PASSWORD`, etc.) for persistence, metrics, and key rotation state.
* **Why it was discarded**: To maintain strict independence and adhere to open-source software principles, direct dependency on Redis has been deprecated in favor of **Valkey** (the fully open-source key-value database fork). The codebase preserves protocol-level compatibility for seamless migration.
