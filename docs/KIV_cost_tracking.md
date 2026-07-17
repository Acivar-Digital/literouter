# KIV — Cost Tracking (future consideration)

**Status**: 🔭 KIV (Keep In View) — NOT implemented
**Source**: `relayplane` vendor repo (`arthityap/vendor/relayplane`, read 2026-07-17)
**Captured**: 2026-07-17
**Related**: `docs/VENDOR_ANALYSIS.md` (adopt/follow matrix)

---

## Why this is worth keeping in view

LiteRouter today tracks **RPM/TPM quota** per key/provider (Redis `QUOTA_CHECK_SCRIPT`,
`MODEL_LIMITS`/`PROVIDER_LIMITS` in `src/lib.ts`). It has **zero `$ cost` visibility** —
we know a key is busy, but not how many dollars each request/key/workspace burns.

`relayplane`'s OSS proxy contains the exact piece we lack: a **per-request cost
estimator** driven by the provider's `usage` block. The math is portable; their
storage backend is not.

## What to adopt (if/when we build it)

1. **`estimateCost(model, inputTokens, outputTokens, cacheCreation?, cacheRead?)`**
   — from `relayplane/src/telemetry.ts:132-201`. Pure function, no I/O.
   Handles Anthropic prompt-cache pricing (creation ×1.25, read ×0.1). No remote
   pricing API.
2. **A single consolidated `MODEL_PRICING` table** (USD per 1M tokens).
   ⚠️ `relayplane` ships **three inconsistent copies** (`telemetry.ts:132`,
   `budget.ts:17`, `server.ts:1361` — e.g. Opus input `5.0` vs `15.0`).
   Consolidate to ONE source of truth if we port.
3. **Compute post-response from `usage`** — for streaming, parse SSE
   `message_start` / `message_delta` / `usage` to recover token counts, then `estimateCost`.
4. **Store in our own Redis** (or SQLite) keyed by API key / workspace / day.
   Do **NOT** depend on `@relayplane/ledger` (closed-source SQLite) or any
   `@relayplane/*` npm package (the "intelligence" lives there, not in OSS).

## Why deferred (not now)

- Out of scope for the current hardening pass (#1 client-disconnect was the immediate win).
- Requires a pricing table we'd have to maintain (drift risk).
- No user-facing demand yet — it's an observability nice-to-have, not a bug.

## Trigger to promote from KIV → build

When someone asks "how much is key X costing us" or we need per-workspace
spend caps — pull this doc, port `estimateCost` + one pricing table into Redis,
wire it into both execute fns post-response.
