# Plan: Client-Disconnect Propagation (`AbortSignal`) + Blueprint Review

**Status**: 📋 Plan (awaiting approval — no code changed yet)
**Author**: opencode session
**Date**: 2026-07-17
**Baseline commit**: `5e2f632`

---

## 1. Review of the 4-point "bare-metal optimizations" blueprint

A user pasted four advanced optimizations that (unlike the earlier framework
blueprint) are genuinely philosophy-aligned: no plugins, no frameworks, no vendor
lock-in. Verdict per item, grounded in the actual code:

| # | Item | Verdict | Evidence / Rationale |
|---|------|---------|----------------------|
| 2 | **Client Disconnect Propagation** (`req.signal` → upstream `fetch`) | **IMPLEMENT** (clear win) | Upstream `fetch` currently uses a *server-side* timeout signal only — `signal: AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS)` at `src/index.ts:715` and `:879`. `req.signal` (the client's disconnect) is **never** passed. So when a user hits "Stop", the upstream keeps generating until the server timeout fires — wasting tokens and holding memory. This is a real, cheap, safe fix. |
| 1 | **Request Hedging** (race Provider A vs B on slow TTFB) | **DEFER** (costs money) | Legit for tail-latency, but hedging fires a *duplicate* generation — you pay for 2 token streams whenever A is merely slow. Our existing fusion failover (`executeFusion` + circuit breaker) already covers the *error* case (429/5xx). Hedging only helps "stuck-but-not-erroring", which is rarer and already bounded by `LITEROUTER_HTTP_TIMEOUT_MS`. Not a yes-man adoption; revisit only if p99 TTFB is a measured problem. |
| 3 | **Redis Pub/Sub for circuit sync** (multi-core) | **DEFER** (premature / YAGNI) | Correct observation: the in-memory `circuitOpenUntil` Map (`src/index.ts:496`) is per-process. But the deployment is a **single Bun process** on 7766 (tmux `literouter` / `scripts/start.sh`); there are no replicas. The Redis cooldown keys (`cooldown:<provider>:<key>:<model>`, `src/index.ts:362`) are already shared, so quota consistency survives. Pub/Sub is real only when horizontal scaling exists. Revisit on multi-instance. |
| 4 | **Unix Domain Socket (UDS) over TCP** | **DEFER** (conditional) | Valid micro-opt *only* if a local reverse proxy (nginx/caddy/haproxy) sits in front. No proxy is configured in `docs/` or `scripts/start.sh`. More importantly, OpenCode CLI and pydantic-ai hit `:7766` over TCP directly (per `AGENTS.md` + `openCode_sync_mandatory` memory) — binding to a UDS would **break those external TCP clients**. Not applicable to current topology. |

**Summary**: Only item #2 is a clear, unconditional win. #1/#3/#4 are sound but premature or topology-dependent — implementing them now would be speculative (violates YAGNI / Ockham's Razor per `AGENTS.md`). This plan covers **#2 only**.

---

## 2. Plan — Implement Client-Disconnect Propagation (item #2)

### 2.1 Goal
When the client disconnects (cancels generation), the upstream provider's
`fetch` is aborted immediately, so no further tokens are generated or billed.

### 2.2 Approach
Compose the incoming client `AbortSignal` with the existing server-side timeout
using `AbortSignal.any([req.signal, AbortSignal.timeout(T)])`. This preserves
the current timeout safety net AND adds client-disconnect cancellation. `AbortSignal.any`
is available in Bun 1.3.13 (verified: `typeof AbortSignal.any === "function"`).

### 2.3 Implementation steps (all in `src/index.ts`, no new deps)

1. **Add a helper** near the timeout constant (`src/index.ts:151`):
   ```ts
   function upstreamSignal(clientSignal?: AbortSignal): AbortSignal {
     if (!clientSignal) return AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS);
     return AbortSignal.any([
       clientSignal,
       AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS),
     ]);
   }
   ```

2. **Thread an optional `signal?: AbortSignal` param** through the three layers:
   - `executeOpenAICompat(...)` — add after `reqId?` (`src/index.ts:662`).
   - `executeGoogleNative(...)` — add after `reqId?` (`src/index.ts:820`).
   - `executeFusion(...)` — add after `reqId?` (`src/index.ts:975`).

3. **Use the helper at the two upstream `fetch` sites**:
   - `src/index.ts:715` → `signal: upstreamSignal(signal),`
   - `src/index.ts:879` → `signal: upstreamSignal(signal),`

4. **Pass the client signal at every call site** (all have `req` in scope at the
   top handler `src/index.ts:1051`):
   - `executeFusion` calls at `:1077` and `:1099` → add `req.signal`.
   - Inside `executeFusion`, forward to its child calls at `:996` and `:1007` → add `signal`.
   - Direct `executeOpenAICompat` at `:1088` → add `req.signal`.
   - Direct `executeGoogleNative` at `:1110` → add `req.signal`.

### 2.4 Streaming behaviour (important)
Both streaming paths already use `resp.body!.pipeThrough(transform)`
(`src/index.ts:754` and `:927`). When `req.signal` aborts the upstream
`fetch`, `resp.body` is cancelled, which propagates through the
`TransformStream` and closes the client connection. **No manual read-loop
change is required** — the composed signal at the `fetch` is sufficient to
achieve the blueprint's stated goal (stop draining credits mid-stream).

### 2.5 Edge cases / fail-loud
- If `req.signal` is already aborted on entry (client gone before fetch), the
  fetch aborts instantly — correct (saves upstream tokens). This is fail-fast,
  not fail-silent.
- An aborted fetch throws `AbortError`. Existing try/catch around the fetch
  will handle it; no new error-handling branches needed (avoid speculative
  catch-all per `AGENTS.md` "Negative Logic").

### 2.6 Verification plan (per `AGENTS.md` Self-Review)
1. `bun test` — unit suite (TS logic in `tests/unit/`) must pass, exit 0.
2. `uv run ruff check .` — Python test files clean (no new .py).
3. **Manual abort test** (the real proof): start gateway (`bash scripts/start.sh`),
   fire a streaming request with a slow upstream, then close the client mid-stream
   (e.g. `curl ... | head -c 200; kill`). Confirm upstream generation stops
   (observe token-billing / gateway logs show connection drop) rather than
   continuing to `LITEROUTER_HTTP_TIMEOUT_MS`.
4. `bun run src/index.ts` smoke: a normal full completion still streams to `[DONE]`
   unchanged (signal only fires on disconnect).

### 2.7 Rollout
- This is **< 50 lines, no new deps, no schema change** → below the
  `AGENTS.md` approval-gate threshold. Fast-path / self-approve once the user
  signals go.
- Commit message: `feat(gateway): propagate client AbortSignal to upstream fetch`.
- Track via a beads issue (create → implement → close).
- **Not** a graveyard entry — #2 is implemented, not canned.

---

## 3. Deferred items (do NOT implement now — record only)

- **#1 Hedging**: revisit only if p99 TTFB is a measured production problem.
  Would require a dual-fetch race + `AbortController` cancel of the loser, and
  a token-budget guard to cap duplicate-generation cost.
- **#3 Pub/Sub circuit sync**: revisit when LiteRouter runs as ≥2 instances.
  Keep the local `Map` for hot-path reads; publish trip events to a
  `CIRCUIT_TRIPPED` Redis channel; subscribe in each instance.
- **#4 UDS**: revisit only if a local reverse proxy is introduced in front of
  7766. Must remain TCP-listening for direct OpenCode/pydantic-ai clients.
