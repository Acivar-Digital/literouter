# 🪦 Architecture Graveyard - Rejected Proposals & Anti-Patterns

This document records architectural patterns and feature requests that have been **formally evaluated and rejected** for LiteRouter core. 

The purpose of this graveyard is to prevent architectural regressions, avoid unnecessary bikeshedding, and maintain LiteRouter's laser focus on **sub-millisecond throughput, zero-dependency simplicity, and rock-solid multi-key rotation**.

---

## 🚫 Rejected Architectural Patterns

### 1. Database ORMs & SQL Storage (Prisma, Drizzle, PostgreSQL, SQLite)
* **Why it was proposed**: Storing prompt logs, token accounting, and user management in a relational database.
* **Why it is REJECTED**:
  * **Latency**: SQL queries and disk write operations introduce latency jitter into fast LLM streaming pipelines.
  * **Maintenance & Fragility**: Database migrations, schema versioning, and connection pool management add significant operational overhead.
  * **Privacy & Security**: Storing prompt payloads on disk creates unnecessary compliance (GDPR/HIPAA) and security liabilities.
  * **LiteRouter Standard**: Valkey/Redis ephemeral in-memory ZSET + Lua scripts provide sub-millisecond atomic key rotation and quota enforcement without disk bottlenecks.

---

### 2. Embedded Web Dashboards (React, Next.js, Vue)
* **Why it was proposed**: Bundling a web UI admin panel inside LiteRouter to manage keys and view charts.
* **Why it is REJECTED**:
  * **Bloat & Attack Surface**: Web UIs require hundreds of frontend dependencies, HTML/JS asset serving, and session/cookie management, introducing unnecessary security attack surfaces into a security-critical API proxy.
  * **LiteRouter Standard**: Headless API design. Status and key diagnostics are handled via `bun run scripts/doctor.ts`, `/health`, and standard terminal tooling (`tmux`).

---

### 3. Edge Serverless Rewrites (Cloudflare Workers, Vercel Edge)
* **Why it was proposed**: Porting LiteRouter to run entirely inside Cloudflare Workers or serverless edge functions.
* **Why it is REJECTED**:
  * **Execution Limits**: Edge runtimes impose strict CPU time limits, memory caps, and non-standard connection behaviors that interfere with long-lived SSE streams and multi-model sticky fallback retries.
  * **LiteRouter Standard**: Dedicated Bun runtime on VPS, Bare Metal, or Docker for consistent raw I/O throughput and unthrottled streaming.

---

### 4. Modality-Specific Payload Parsers (Custom Handlers for Images, Audio, Video)
* **Why it was proposed**: Building bespoke validation handlers and schemas for `/v1/images/*`, `/v1/audio/*`, and `/v1/embeddings`.
* **Why it is REJECTED**:
  * **High Maintenance Churn**: Every time an upstream provider adds a parameter or tweaks a schema, bespoke parsers break and require gateway updates.
  * **LiteRouter Standard**: **Intelligent Transparent Forwarding**. LiteRouter injects healthy rotated credentials and proxies standard HTTP `/v1/*` requests directly to upstream providers with zero serialization latency.

---

## 📜 Principle of Deterministic Minimalism (YAGNI)

If a proposed feature can be accomplished outside the core proxy gateway (e.g., via client-side libraries, standard reverse proxies like Nginx/Caddy, or user AI assistants), it will **not** be merged into LiteRouter core.
