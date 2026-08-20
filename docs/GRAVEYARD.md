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

### 5. Serving LiteRouter over IPv6 / Upstream IPv6 Priority
* **Why it was proposed**: Binding LiteRouter to IPv6 addresses (`::` or `::1`) or routing upstream API calls over IPv6 under the assumption of better performance.
* **Why it is REJECTED (DO NOT ASK AGAIN / PERMANENTLY SHELVED)**:
  * **0% Performance Gain**: Loopback routing latency (<0.1ms) is identical between IPv4 and IPv6. Over 99% of proxy latency is upstream TTFT and token streaming over TLS, where IP version makes zero difference.
  * **Dual-Stack DNS & Happy Eyeballs Latency Penalty**: Resolving dual-stack `localhost` (trying `::1` before `127.0.0.1`) introduces connection fallback delays (+300ms to +2000ms) or outright `ECONNREFUSED` / `ETIMEDOUT` in Node.js/Python client runtimes.
  * **WSL2 / Container Virtual Switch Fragility**: WSL2 NAT switches and Docker bridge networks frequently drop external IPv6 packets silently while advertising IPv6 capability, creating severe connection stalls.
  * **PMTU Blackholing**: Broken Path MTU Discovery on cloud/residential IPv6 routes causes long-lived SSE streaming responses to stall mid-transfer.
  * **LiteRouter Standard**: Explicit numeric IPv4 (`127.0.0.1:7766` / `0.0.0.0:7766`). Keep external IPv6 disabled in WSL2 environments while preserving local loopback. See `docs/IPV6_ISSUES.md`.

---

### 6. Static Upstream `/etc/hosts` Mapping & Forward Proxy Chaining
* **Why it was proposed**: Hardcoding upstream vendor hostnames (e.g. `openrouter.ai`, `api.groq.com`, `integrate.api.nvidia.com`) directly to static IPs in `/etc/hosts` to eliminate DNS lookups, or inserting intermediate forward proxies (e.g. Squid/Privoxy).
* **Why it is REJECTED (DO NOT ASK AGAIN / PERMANENTLY SHELVED)**:
  * **Catastrophic Outages via Anycast CDN Rotation**: Upstream LLM providers sit behind dynamic Anycast CDNs (Cloudflare, AWS CloudFront, Fastly) with short TTLs (60–300s). Cloudflare regularly rotates edge IPs for DDoS mitigation and node rebalancing. Static `/etc/hosts` pins lead to immediate silent blackholing (`ETIMEDOUT` / `ECONNREFUSED`).
  * **TLS / SNI Certificate Mismatches**: Direct-to-IP routing often hits edge nodes not provisioned with the vendor's active TLS certificates, causing fatal SSL handshake rejections (`CERT_HAS_EXPIRED` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`).
  * **0 ms Latency Saving via Keep-Alive**: Bun and LiteRouter maintain long-lived HTTP/2 and HTTP/1.1 TCP keep-alive socket pools. DNS resolution only occurs once on cold start; subsequent requests reuse warm connections with 0 ms DNS overhead.
  * **Forward Proxy Chunk Buffering**: Intermediate forward proxies inspect/buffer HTTP chunks, which degrades or breaks real-time Token-by-Token SSE streaming.
  * **LiteRouter Standard**: Rely on Anycast DNS resolvers (`1.1.1.1`, `8.8.8.8` in `/etc/resolv.conf`) and standard socket keep-alive pooling. Never hardcode vendor CDN IPs in `/etc/hosts`.

---

## 📜 Principle of Deterministic Minimalism (YAGNI)

If a proposed feature can be accomplished outside the core proxy gateway (e.g., via client-side libraries, standard reverse proxies like Nginx/Caddy, or user AI assistants), it will **not** be merged into LiteRouter core.
