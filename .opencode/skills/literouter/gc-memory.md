# LiteRouter GC & Memory (lazy-load)

No explicit GC by default. Zero `Bun.gc()` calls in `scripts/gateway/start.sh` (the only `Bun.gc(true)` in the repo is the flush handler at `src/index.ts:108-109`). With Bun v1.4.2+, JIT idle memory reclamation (~35–40% RSS drop) and safe `Bun.gc(true)` on flush events (`/reset`) are available (see SKILL.md §16.5). Read only on memory-leak / uptime / restart questions.

## 1. Bounded state (where "GC" lives)

| State | Bound / cleanup | Source |
|---|---|---|
| Trace ring (RAM) | 100 traces / 32MB / 64KB per leg, oldest-evicted on push | `src/telemetry/ring_buffer.ts:19-21,86-97` |
| Trace writer (SQLite) | Flush 30s / 100 traces / 16MB; prune rows >30d on boot | `src/telemetry/trace_writer.ts:6-9,97,179-189` |
| Pacer queue | `max_queue_depth: 500`; abort dequeues via `AbortSignal` | `src/network/pacer.ts:111-113,140-148,161-170,301` |
| Cooldowns | No timers; lazy-expiry on read; `clearAll()` on `/reset` | `src/network/cooldown.ts:161-171` |
| H2 sessions | Rotate at 180s + jitter; 30s drain; purge on error/GOAWAY/close | `src/network/h2_pool.ts:37-38,206-226,262-268,271-305` |
| Fusion sticky | 5-min TTL, lazy delete on read | `src/fusion/sticky.ts:10,34-35` |
| Streams | `AbortSignal.timeout` merge; `safeEnqueue`/`safeClose` guards; idle timeout `LITEROUTER_STREAM_IDLE_TIMEOUT_MS` (schema default `120000` ms = 2 mins, `src/config/schema.ts:205`; tracked `.env:16` sets the non-`_MS` alias `LITEROUTER_STREAM_IDLE_TIMEOUT=180` s → `180000` ms, `src/config/env.ts:50-53`; module fallback `STREAM_IDLE_TIMEOUT_MS = 120000`, `src/network/fetcher.ts:62`, consumed at `src/network/fetcher.ts:1034`) | `src/network/fetcher.ts:107-113,122-140,142-168,1034` |

## 2. Manual reset (in-process "GC")

`POST /reset` → `handleHardReset()` clears cooldowns, pools, pacers,
breakers, trace buffer, H2 pool (`src/index.ts:81-115`). Cannot rebind
port — needs `bash scripts/gateway/restart.sh` for host/port/cert changes.

## 3. Periodic restart? No

Long-running by design. Log rotation only (`scripts/gateway/prune-logs.sh`, keeps
30d — `scripts/gateway/prune-logs.sh:2,12`).
Restart only for port/cert changes or suspected leak (check `/health`
`h2_outbound` + `queueDepth` first).
