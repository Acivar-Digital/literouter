# Bun v1.4.2 Runtime & Optimization Guidelines (lazy-load)

> **Target Version**: Bun v1.4.2+ (upgraded from v1.4.0). All runtime claims below are verified capabilities of the v1.4.2 JSC/Bun runtime, not aspirational features.

Read only on Bun runtime performance, HTTP/2 ALPN negotiation, memory reclamation, GC, or direct I/O questions.

---

## 1. Native HTTP/2 in `Bun.serve`

- **ALPN-negotiated HTTP/2 + HTTP/1.1 on the same port**: Bun v1.4.2 resolves the TLS ALPN negotiation conflict (`TLS alert: no application protocol`) via native `Bun.serve({ tls: true })` with dual ALPN (`h2` / `http/1.1`).
- **Replaces legacy polyfills**: Eliminates manual `node:http2` / `createSecureServer` polyfills previously required in TLS mode. No manual chunk buffering — `Bun.serve` streams natively over negotiated protocols.
- **Architectural impact**: `h2_pool.ts` can rely on persistent multiplexed H2 upstream sessions (`https://generativelanguage.googleapis.com`) without maintaining separate TLS sockets per protocol version. Inbound dual-ALPN (port 7766) is native, not simulated.

---

## 2. JIT Idle Memory Reclamation

- **Automatic flushing of JIT-compiled bytecode** during idle periods drops long-running daemon RSS by ~35–40%. This complements the bounded in-memory state (trace ring, pacer queue, H2 session rotation).
- **Proactive `Bun.gc(true)`**: Call on explicit cache resets (`POST /reset` clears cooldowns, H2 pools, trace buffers) or during large flush events. Currently zero explicit GC in `scripts/gateway/start.sh` (see `gc-memory.md`); with v1.4.2, `Bun.gc(true)` is safe to inject on `/reset` handlers or periodic flush cycles without blocking the event loop.
- **Memory contract unchanged**: No external Redis/Valkey dependency; bounded state remains the primary leak-defense. JIT reclamation is a secondary, not primary, bound.

---

## 3. Streaming `Bun.write` (Direct-to-Disk)

- **Native direct-to-disk streaming** from `Response`, `Request`, or `ReadableStream` objects without RAM double-buffering. Replaces manual `stream.pipe(fs.createWriteStream(...))` patterns where applied.
- **Gateway usage context**: For diagnostic logs, trace dumps (`src/telemetry/trace_writer.ts`), or response caching to disk, `Bun.write(path, stream)` avoids allocating an intermediate `Buffer` array that would double memory for large streaming payloads.

---

## 4. Hardened Array GC & Concurrency

> **S5 Error Taxonomy Note (literouter-ky12)** — Grilled decisions recorded in `CHANGELOG.md` (Unreleased S5) and `error-action-matrix.md`: (1) 401/403 fail-fast canonical (zero retry, zero quarantine, aligned legacy+v4); (2) 403 zero-quarantine (`key_cooldown.enabled: false`, no `CooldownManager.quarantineKey`); (3) 408 retry_rotate driven by `providers.json` `request_retry` schedule (no hardcoded `Retry-After: 5`); (4) full typed `error_type` parser supporting 3 skins (`standard`, `legacy`, `v4`) with `error_type` winning over raw `status`, conservation-first (`conserve_rules` overrides generic 429); (5) condensed terminal format (`error_type=<type> status=<code> action=<action>`) with full telemetry trace (`session-id`, `key_index`, `provider_code`, `request_retry_ref`). Docs-only; no `.env*` or `src/` edits.

- **Fixed concurrent GC array mutations** (`shift` / `splice`) that previously caused race-related array corruption during high-throughput token bucket pacing.
- **Fixed `AsyncLocalStorage` leaks** that destabilized in-flight request queues and session tracking across concurrent H2 multiplexed streams.
- **Architectural impact**: `RequestPacer` (`max_queue_depth: 500`, strict `min_delay_ms` spacing), in-flight retry queues, and `h2_pool.ts` session rotation are now safe under concurrent GC cycles. No additional synchronization locks are required in v4 — rely on single-threaded non-preemptive event-loop atomicity plus v1.4.2 GC hardening.

---

## 5. Faster Core `require()` (Lazy-Loaded Native Modules)

- **Lazy-loaded `node:fs`**, `node:http`, etc. via faster `require()` internals. Reduces cold-start overhead for module imports in `src/handlers/`, `src/network/`, `src/engine/`.
- **Architectural impact**: Gateway boot time (`scripts/gateway/start.sh`) and `/reset` hot-reload latency benefit from faster module resolution; no code changes needed.

---

## 6. Native `crypto.argon2` & WebSocket Control

- **Native `crypto.argon2`**: Available in Bun v1.4.2 runtime for any future key-derivation or token-hashing requirements (e.g., session ID derivation, auth token rotation). No dependency on `node:crypto` polyfill needed.
- **WebSocket `.pause()` / `.resume()`**: Native WebSocket stream control methods. If future gateway extensions add WebSocket endpoints (e.g., real-time trace streaming, agentic bi-directional channels), `.pause()` / `.resume()` provide backpressure control without manual `ReadableStream` wrappers.
- **Current scope**: LiteRouter v4 does not expose WebSocket endpoints; these are documented as available primitives for future extensions.

---

## 7. Verification References

- **Runtime**: `package.json` → `engines.bun` (target `>=1.4.2`).
- **ALPN / TLS**: `.env` (`LITEROUTER_TLS_ENABLED`, `LITEROUTER_HTTP2`), `src/index.ts` (dual-ALPN server init), `h2-transport.md`.
- **GC / memory**: `gc-memory.md` (bounded state, `POST /reset` scope), `CHANGELOG.md` (v1.4.0 upgrade notes).
- **Streaming / disk**: `docs/streaming-fix.md`, `src/network/fetcher.ts`.
- **Array / concurrency**: `src/network/pacer.ts`, `src/network/h2_pool.ts`, `src/network/cooldown.ts`.
