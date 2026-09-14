# Upgrade v3 changelog (merged from 3_2 + http2)

Historical archive consolidating architectural upgrades from v3.2 (engine logic, resilience, FSE) and native Bun HTTP/2 dual-protocol support.

### 1. Engine & Protocol Translation (v3.2)
- **`providers.json` Explicit Path Mapping**: Zero string concatenation or endpoint guessing. Two-letter codes (`ch`, `ms`, `ob`, `gc`, `im`, `em`, `md`) map directly to provider endpoint paths across OpenRouter (`or`), NVIDIA (`nv`), Zen (`zn`), Google (`gg`), and Anthropic (`an`).
- **Rate Limiting Stack**: Deterministic pacing via `RequestPacer` (`min_delay_ms` per provider/model) replaces retired client-side sliding-window counters (`zdist.ts`).
- **Smart Cooldowns**: Reason-aware quarantine TTLs upon upstream errors (`5xx` -> 10s transient quarantine; `429` -> dynamic `Retry-After` parsing; `400/404` -> 0s bypass client error).
- **Fusion Sticky Engine (FSE)**: Triggered by `lr-fse-<preset>`. On primary failure, pins sticky tier for 300s (`FUSION_STICKY_TTL_MS = 300000ms`); automatically recovers to Tier 1 when primary passes health probes.

### 2. Native HTTP/2 & Dual-Protocol Wire Architecture (`Upgrade_http2`)
- **Native Bun Dual-ALPN Binding**: Serves `h2` and `http/1.1` concurrently on port 7766 via Bun's native `uWebSockets` engine, eliminating third-party Python proxies (Granian removed).
- **`mkcert` Local Root CA**: Script (`scripts/setup_certs.sh`) provisions local trusted certificates in `certs/localhost.pem` and `certs/localhost-key.pem` to prevent self-signed TLS errors in client test harnesses and OpenCode.
- **ALPN Protocol Negotiation**: Automatically detects certs at boot: binds TLS ALPN (`h2, http/1.1`) when present, falling back cleanly to plaintext HTTP/1.1 if absent.
- **RST_STREAM & Abort Propagation**: Downstream client disconnects and `RST_STREAM` frames bind directly to `req.signal`, firing upstream `AbortController.abort()` to terminate in-flight generation and conserve upstream provider quota.
- **Full Observability**: Logs inbound protocol (`[H2]` vs `[H1.1]`) at ingress and real negotiated upstream protocol at TTFT (`[Upstream: HTTP/2]`), with TLS/protocol status exposed in `/health`.
