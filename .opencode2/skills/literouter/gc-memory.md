# LiteRouter GC & Memory (lazy-load)

No explicit GC. Zero `Bun.gc()` calls, no GC flags in `scripts/start.sh:51`.
Bun/JSC automatic GC + bounded app-level state. Read only on memory-leak /
uptime / restart questions.

## 1. Bounded state (where "GC" lives)

| State | Bound / cleanup | Source |
|---|---|---|
| Trace ring (RAM) | 100 traces / 32MB / 64KB per leg, oldest-evicted on push | `src/telemetry/ring_buffer.ts:19-21,86-97` |
| Trace writer (SQLite) | Flush 30s / 100 traces / 16MB; prune rows >30d on boot | `src/telemetry/trace_writer.ts:6-9,97,179-189` |
| Pacer queue | `max_queue_depth: 500`; abort dequeues via `AbortSignal` | `src/network/pacer.ts:111-113,161-170` |
| Cooldowns | No timers; lazy-expiry on read; `clearAll()` on `/reset` | `src/network/cooldown.ts:161-171` |
| H2 sessions | Rotate at 180s + jitter; 30s drain; purge on error/GOAWAY/close | `src/network/h2_pool.ts:37,206-226,271-305` |
| Fusion sticky | 5-min TTL, lazy delete on read | `src/fusion/sticky.ts:10,34-35` |
| Streams | `AbortSignal.timeout` merge; `safeEnqueue`/`safeClose` guards | `src/network/fetcher.ts:99-104,114-160` |

## 2. Manual reset (in-process "GC")

`POST /reset` → `handleHardReset()` clears cooldowns, pools, pacers,
breakers, trace buffer, H2 pool (`src/index.ts:81-115`). Cannot rebind
port — needs `bash scripts/restart.sh` for host/port/cert changes.

## 3. Periodic restart? No

Long-running by design. Log rotation only (`scripts/prune-logs.sh`, 30d).
Restart only for port/cert changes or suspected leak (check `/health`
`h2_outbound` + `queueDepth` first).
