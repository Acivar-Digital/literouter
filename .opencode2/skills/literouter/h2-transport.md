# LiteRouter H2 Transport (Inbound ALPN + Outbound Pool)

Outbound HTTP/2 multiplexing path: gateway-edge pacer → H2-pooled upstream
stream. Inbound dual-protocol server: one TLS port serves both H2 and H1
clients via ALPN. All symbols grounded in `src/` reads.

Ingress flow: handler calls `acquireProviderPacer` (`src/handlers/openai_compat.ts:628`)
→ `getPacerForProvider` (`src/network/pacer.ts:251`) → `pacer.acquire`
(`src/handlers/openai_compat.ts:581,644`) → `fetchWithTtftGuard`
(`src/handlers/openai_compat.ts:312,585`, defined `src/network/fetcher.ts:547`)
→ `executeH2Fetch` (`src/network/fetcher.ts:407`) → `getHttp2Pool()`
(`src/network/fetcher.ts:417`) → `acquireSession`
(`src/network/h2_pool.ts:62`) → multiplexed stream (`session.request`,
`src/network/fetcher.ts:438`) with `attachStreamGuard`
(`src/network/fetcher.ts:443`, defined `src/network/h2_pool.ts:125`).

## 1. Inbound: dual-ALPN server, one port

- TLS-gated H2 server: `if (tls && env.LITEROUTER_HTTP2)` (`src/index.ts:578`)
  → `http2.createSecureServer` (`src/index.ts:579`).
- `allowHTTP1: true` (`src/index.ts:583`) + `ALPNProtocols: ["h2", "http/1.1"]`
  (`src/index.ts:584`): binary-multiplexed H2 clients and Node H1-TLS clients
  share port 7766; TLS negotiates the wire.
- No certs → `Bun.serve` H1 fallback (`src/index.ts:677-685`).
- Inbound H1 clients (OpenCode2/Claude Code via Node `fetch`) are H1-only;
  dual-ALPN stays — H2 gain is upstream-only today
  (`docs/GRAVEYARD/HTTP2_AUDIT_2026-09-10.md:17`).
- Client aborts propagate via `AbortController` (`src/index.ts:590-603`);
  downstream lifecycle traps live in `http2-lifecycle-stream-isolation.md`.

## 2. Outbound pool lifecycle (`src/network/h2_pool.ts`)

- `Http2SessionPool` (`src/network/h2_pool.ts:25`); singleton `getHttp2Pool`
  (`src/network/h2_pool.ts:351`); per-pool-key session lists (`:26`) with
  single-flight connect locks `connectionLocks` (`:27`).
- `PooledSession` tracks `activeStreams` (`:9`), `isDraining` (`:11`),
  `createdAt`/`ageTimer`/`drainTimer` (`:12-14`).
- Defaults: `maxStreamsPerSession` 80 (`:35`), `sessionsPerOrigin` 1 (`:36`),
  `maxSessionAgeMs` 180000 (`:37`), `drainTimeoutMs` 30000 (`:38`),
  `connectTimeoutMs` 10000 (`:39`).
- `acquireSession` (`:62`): reuse healthy non-draining session under the
  stream cap (`:74-77`) → join in-flight single-flight connect (`:81-94`) →
  new session under `sessionsPerOrigin` (`:97-110`) → emergency overflow
  session when all are maxed (`:114-119`, `activeStreams++` at `:117`).
- `attachStreamGuard` (`:125`): `close`/`error`/`frameError`/`finish`
  (`:133-136`) + conditional `aborted` (`:138-140`) each release exactly once
  via `releaseStream` (`:130`).
- `releaseStream` (`:143`): decrements (`:148`); draining session at zero
  streams is destroyed immediately (`:150-152`).
- `startDraining` (`:206`): marks `isDraining` (`:208`), clears age timer
  (`:209-212`); zero-stream sessions destroyed at once (`:213-216`), else
  re-checked after `drainTimeoutMs` (`:217-225`).
- Proactive rotation: `ageTimer` with ±15s jitter fires `startDraining`
  (`:263-269`, timer at `:266`); staggered rotation avoids simultaneous
  pool drains (anti-429-pinning aging).
- `GOAWAY` → `startDraining`, sessions kept for in-flight releases
  (`:302-305`); runtime `error`/`frameError` purges zombies (`:272-280`);
  `close` destroys (`:300`); connect timeout rejects (`:291-295`).
- H2 failure falls back to HTTP/1.1 fetch inside `fetchWithTtftGuard`
  (`src/network/fetcher.ts:571-590`); H2 connect timeout and purge lines in
  `error-action-matrix.md` row 8.

## 3. Per-key isolation rationale (anti-429-pinning)

- Pool key is `origin#provider:keyIndex` (`src/network/fetcher.ts:413-416`);
  each upstream key gets its own session set.
- Rationale is anti-429-pinning + quarantine/GOAWAY blast radius, NOT
  500-teardown: a `500` is a per-stream `:status`; the stream closes via
  `attachStreamGuard`/`releaseStream` while the session stays healthy; purge
  only on session faults (`src/network/h2_pool.ts:272-280`)
  (`docs/GRAVEYARD/HTTP2_AUDIT_2026-09-10.md:18`).
- Audit verdict: for a vendor REST proxy the current H2 setup is optimal
  (`docs/GRAVEYARD/HTTP2_AUDIT_2026-09-10.md:8-13`); this file covers the
  transport mechanics, the audit file owns the parked discussion.

## 4. H2 + SSE yes / gRPC / H3 / WS no

- Yes: SSE rides multiplexed H2 streams; `: keep-alive` frames every
  `KEEPALIVE_INTERVAL_MS` 15000 (`src/network/fetcher.ts:64,109,186`);
  H2-first with H1 fallback (`src/network/fetcher.ts:565-590`).
- No gRPC/protobuf: fusion chains are in-process JSON; upstreams
  (OpenRouter/NVIDIA/Google/Zen) are REST-only; zero `grpc`/`http3`/
  `websocket` hits in `src/`
  (`docs/GRAVEYARD/HTTP2_AUDIT_2026-09-10.md:12-13`).
- No HTTP/3 QUIC, no WebSockets — no lossy-edge or bidirectional use-case
  (`docs/GRAVEYARD/HTTP2_AUDIT_2026-09-10.md:13`).

## 5. Tuning knobs

| Knob | Default | Source |
|---|---|---|
| `LITEROUTER_HTTP2` (inbound H2 server on/off) | `"true"` | `src/config/env.ts:8` |
| `LITEROUTER_H2_OUTBOUND` (H2-first outbound on/off) | `"true"` | `src/config/env.ts:28` |
| `maxStreamsPerSession` | `80` | `src/network/h2_pool.ts:35` |
| `sessionsPerOrigin` | `1` | `src/network/h2_pool.ts:36` |
| `maxSessionAgeMs` (rotation age, ±15s jitter) | `180000` | `src/network/h2_pool.ts:37,264-265` |
| `drainTimeoutMs` | `30000` | `src/network/h2_pool.ts:38` |
| `connectTimeoutMs` | `10000` | `src/network/h2_pool.ts:39` |
| Pacer `minIntervalMs` per provider (`gc` 2000ms via `GCP_MIN_DELAY_MS`, others 200ms) | — | `src/config/env.ts:34-38`, `src/network/pacer.ts:228-246,261` |
| Pacer registry (one pipe per provider, shared by all keys) | — | `src/network/pacer.ts:248-249,251` |

Set `LITEROUTER_H2_OUTBOUND=false` to force plain HTTP/1.1 outbound
(`src/network/fetcher.ts:565`); mocked `fetch` in unit tests also bypasses
H2 (`src/network/fetcher.ts:565`, `isFetchMocked` at `:541-543`).

## 6. `/health` H2 stats

- `handleHealthCheck` reports `h2_outbound: getHttp2Pool().getSessionStats()`
  (`src/index.ts:126-144`, stats at `:132`, key at `:139`).
- Per-key stats: `sessionCount` / `activeSessions` / `totalActiveStreams`
  (`src/network/h2_pool.ts:156-186`); prefix match on `poolKey#`
  (`:163`) aggregates one origin's per-key sessions.

## 7. GOAWAY / drain behavior

- Upstream `GOAWAY` marks the session draining but keeps it pooled until
  in-flight streams release (`src/network/h2_pool.ts:302-305` via
  `startDraining` at `:206`).
- Draining sessions take no new streams (`src/network/h2_pool.ts:74,86,97`);
  destroyed when streams hit zero or the drain timer re-fires
  (`:213-225`); `destroySession` uses graceful `close()` while streams are
  active, `destroy()` otherwise (`:320-328`).
- `getSessionStats` excludes draining/closed sessions from `activeSessions`
  (`:165,181`).
