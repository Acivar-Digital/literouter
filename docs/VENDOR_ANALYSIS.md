# Vendor Repo Read — Adopt vs Follow Matrix

**Date**: 2026-07-17
**Cloned to**: `arthityap/vendor/` (shallow) — portkey, bifrost, relayplane, agentgateway
**Method**: 4 parallel `explore` subagents (orchestrator pattern), each read thoroughly, returned file:line evidence.
**Baseline**: LiteRouter (`src/index.ts`) already does SSE streaming (`pipeThrough`), Redis-backed key rotation + quota (`QUOTA_CHECK_SCRIPT`), a circuit breaker (`circuitOpenUntil` Map + Redis cooldown keys at `:362-482`), and request normalization (`cleanGemmaPayload`, `translateGoogleThinking`, `cleanHeaders`). Plan `docs/PLAN_abort_signal_propagation.md` covers client-disconnect via `AbortSignal.any([req.signal, timeout])`.

---

## 0. Language reality-check (verified from manifests, not assumed)

| Repo | Blueprint said | User said | **Actual (verified)** |
|------|---------------|-----------|----------------------|
| portkey | TS | Bun | **TypeScript/Node** (`package.json`) — adopt-able |
| bifrost | Go | Bun | **Go** (`go.mod` in `cli/ core/ transports/ framework/`; only `ui/` is `package.json`) — **NOT Bun**; read-only |
| relayplane | Node | Bun | **TypeScript/Node** (`package.json`) — adopt-able |
| agentgateway | Go/C++ | Rust | **Rust + Go hybrid** (`crates/` Rust, `go.mod`/`controller/` Go) — read-only |

**Correction to the user's "first three are buns / last is rust":** only portkey + relayplane are TS. bifrost is Go. agentgateway is Rust**+**Go. The earlier blueprint (bifrost=Go, Envoy=Go/C++) was closer to truth than the user's assertion.

---

## 1. ADOPT (port into our Bun/TS stack)

### 1.1 relayplane — Cost tracking  ★ the one genuinely new, valuable item
- `estimateCost(model, inputTokens, outputTokens, cacheCreation?, cacheRead?)` + static `MODEL_PRICING` table — `src/telemetry.ts:132-201`.
- Anthropic prompt-cache pricing handled (creation ×1.25, read ×0.1). **No remote pricing API.**
- Computed **post-response** from the `usage` block (streaming: parse SSE `message_start`/`message_delta`/`usage` to recover token counts).
- **Caveat**: relayplane's actual cost DB is the closed-source `@relayplane/ledger` (SQLite); the OSS repo only has a minimal file-based `cost-ledger.ts`. Also their pricing table is **duplicated 3× inconsistently** (`telemetry.ts`, `budget.ts`, `server.ts`) — consolidate to one.
- **Action**: port `estimateCost` + ONE consolidated `MODEL_PRICING` table + per-API-key / per-workspace cost rows into our Redis (or SQLite). This is the single adoptable feature LiteRouter lacks entirely (we track RPM/TPM quota, not `$`).

### 1.2 portkey — Streaming + normalization confirmation (already done)
- Streaming is zero-buffer: `new Response(response.body, response)` for binary/passthrough (`streamHandler.ts:288-298`), and `TransformStream` + per-SSE-frame buffer (not whole-response) for transformed streams (`streamHandler.ts:139-209, 318-320`). **This validates our `pipeThrough` approach — no change needed.**
- `readAWSStream` (`streamHandler.ts:61-137`) reassembles AWS Bedrock binary framing. ADOPT **only if** we add Bedrock (we don't today).
- Recursive router + declarative provider normalization layer is first-class — but we already do equivalent work in `cleanGemmaPayload`/`translateGoogleThinking`.

### 1.3 What portkey does NOT give us (we're ahead)
- **Client-abort propagation: ABSENT.** Upstream `fetch` in `constructRequest` (`handlerUtils.ts:181-185`) has **no `signal`**; the only `AbortController` is for the timeout (`retryHandler.ts:10-15`). So Portkey OSS cannot cancel an upstream on client-disconnect — **our planned `AbortSignal.any` makes us strictly better.**
- Rate-limit / quota / circuit-breaker / cost: all delegated to Portkey's **hosted control plane** (injected via `c.set(...)`, not in OSS tree). We already implement all four in-repo.

---

## 2. FOLLOW (architecture/patterns only — Go/Rust can't be ported)

### 2.1 agentgateway (Rust+Go) — Client-disconnect ★ validates Plan #2
- Mechanism is **implicit**: a hyper server; when the downstream socket closes, the response-body future is **dropped**, and hyper sends **RST_STREAM** (HTTP/2) or closes the TCP socket (HTTP/1.1). No explicit `AbortSignal`/cancel-token in the hot path (`crates/agentgateway/src/proxy/gateway.rs:892-908`, `httpproxy.rs:2492, 655`).
- **Verdict: our `AbortSignal.any([req.signal, timeout])` passed into upstream `fetch({signal})` is the correct Bun translation** of their Rust-Drop mechanism. Bun can't rely on "drop the future cancels TCP," so we must wire `req.signal` explicitly. Same end-state: client drops → signal fires → upstream TCP closed.
- **Bonus lesson** (`gateway.rs:1616-1624` `should_ignore_downstream_connection_error`): treat a client-disconnect write error on the response path as **non-fatal** — don't log it as a 500/server error. We should apply this when client vanishes mid-SSE.

### 2.2 bifrost (Go) — Pluggable key selection + veto hook
- OSS default LB is **static weighted-random** (`core/keyselectors/weightedrandom.go`), NOT adaptive (adaptive is enterprise-only schema). Selector is pluggable (`core/bifrost.go:242,263`).
- There's a **`KeyPoolFilter` veto seam** (`core/schemas/bifrost.go:18-20`, invoked `bifrost.go:6573,6592`) where a health/circuit filter drops keys pre-selection.
- Cluster state: in-memory KV + `SyncDelegate` gossip (last-write-wins) (`framework/kvstore/kvstore.go`) — no Redis in OSS. **Our deferred Redis-Pub/Sub plan already covers multi-instance.**
- **FOLLOW (optional refactor)**: model our key selection as a pluggable `KeySelector` (default weighted-random on static `weight`) + a `KeyPoolFilter`-style veto so the circuit breaker can suppress keys. Not urgent — our Redis quota + round-robin works.

### 2.3 Universal (all four): zero-buffer streaming is the right call
Every mature proxy pipes the upstream body straight through (portkey `Response(body)`, agentgateway `resp.map(transform)`, bifrost/relayplane same). **Confirms our `pipeThrough` design.**

---

## 3. Recommended next actions

| Action | Source | Priority | Status |
|--------|--------|----------|--------|
| Implement Plan #2 (client-disconnect `AbortSignal`) | agentgateway validates it | **Now** | Planned in `docs/PLAN_abort_signal_propagation.md` |
| Apply "ignore downstream conn error" lesson to SSE path | agentgateway | Now (part of #2) | — |
| **Add cost tracking** (`estimateCost` + `MODEL_PRICING` → Redis) | relayplane | **New feature, propose** | Not yet built |
| Refactor key selection to pluggable `KeySelector` + veto | bifrost | Optional / later | Deferred |
| Multi-instance state sync via Redis Pub/Sub | bifrost pattern + our need | Deferred (single instance today) | Deferred |

**Bottom line**: of the four, only **relayplane's cost math** is a net-new adoptable feature (LiteRouter has no `$` tracking). **portkey** confirms we're already doing streaming/normalization right and are *ahead* on abort/quota/circuit/cost. **agentgateway** validates Plan #2. **bifrost** offers an optional key-selection refactor. No repo justifies a rewrite.
