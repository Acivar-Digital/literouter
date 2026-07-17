# 🪦 Vendor Gateway Ideas — Already-Right / Not Relevant

**Status**: 🪦 **Canned (already-right or not-applicable)**
**Captured**: 2026-07-17
**Source**: Read of 4 cloned vendor gateways in `arthityap/vendor/` — full matrix in `docs/VENDOR_ANALYSIS.md`.
**Why this file exists**: A user asked whether to adopt patterns from Portkey / Bifrost / RelayPlane / AgentGateway. After thorough read (4 parallel subagents), the conclusion is that **every idea here is either something LiteRouter already does correctly, or is inapplicable to a Bun/TypeScript single-process proxy.** Recorded so it is NOT re-litigated.

---

## Verdict by repo

### A. Portkey gateway (`portkey`, TypeScript/Hono) — already AHEAD
* **Status**: 🪦 **Canned — we already do it better**
* **Context**: Portkey's OSS gateway delegates client-abort, rate-limit, circuit-breaker, and cost-tracking to its **hosted SaaS control plane** (the OSS tree has no `signal` on its upstream `fetch` — `handlerUtils.ts:181`; only a timeout `AbortController` — `retryHandler.ts:10`).
* **Why canned**: LiteRouter already implements all four **in-repo** (AbortSignal plan `#1`, Redis quota, circuit breaker, request normalization). Adopting Portkey would be a downgrade (lock-in to their cloud) or a pointless rewrite. Its streaming/`pipeThrough` approach merely *confirms* what we already do.

### B. Bifrost (`bifrost`, **Go** — not Bun/TypeScript) — not applicable
* **Status**: 🪦 **Canned — wrong language, optional pattern only**
* **Context**: Despite a claim that "the first three are Bun," Bifrost is **Go** (`go.mod` in `cli/ core/ transports/ framework/`; only `ui/` is `package.json`). Its "adaptive" LB is enterprise-only; OSS default is **static weighted-random** (`keyselectors/weightedrandom.go`).
* **Why canned**: Go code cannot drop into our Bun/TS stack. The only portable idea — a pluggable `KeySelector` (weighted-random default) + a `KeyPoolFilter` veto hook for circuit suppression — is an **optional future refactor** of key rotation, not urgent. Our Redis quota + round-robin works.

### C. RelayPlane (`relayplane`, TypeScript/Node) — cost math ADOPTED to KIV
* **Status**: 🪦 **Canned here; cost math moved to KIV**
* **Context**: RelayPlane's real gem is `estimateCost()` + a static `MODEL_PRICING` table (`telemetry.ts:132`), computed post-response from `usage`. Its actual cost DB is the closed-source `@relayplane/ledger`.
* **Why canned (not adopted inline)**: The adoptable *math* is captured in **`docs/KIV_cost_tracking.md`** for future build. The rest (smart routing heuristic, external `@relayplane/*` deps) is either already-covered or a vendor lock-in. Nothing else from RelayPlane belongs in the gateway today.

### D. AgentGateway (`agentgateway`, **Rust + Go** hybrid) — validates #1, otherwise already-right
* **Status**: 🪦 **Canned — confirms existing design**
* **Context**: Client-disconnect in AgentGateway is **implicit via Rust `Drop` / hyper `RST_STREAM`** — no explicit `AbortSignal` (`crates/agentgateway/src/proxy/gateway.rs:892`, `httpproxy.rs:2492`). They also swallow downstream-connection errors as non-fatal (`should_ignore_downstream_connection_error`, `gateway.rs:1616`).
* **Why canned**: This **validates** our Plan `#1` (`AbortSignal.any([req.signal, timeout])`) — the correct Bun translation of their Drop mechanism. No new code needed; the lesson ("ignore client-disconnect write errors") is already folded into `#1`'s catch-block guard. Zero-buffer streaming (their `resp.map(transform)`) matches our `pipeThrough`.

---

## Net

| Repo | Language (verified) | Disposition |
|-------|--------------------|--------------|
| Portkey | TS | Already ahead — canned |
| Bifrost | **Go** | Not applicable (wrong lang) — canned; optional KeySelector refactor only |
| RelayPlane | TS | Cost math → `docs/KIV_cost_tracking.md` |
| AgentGateway | Rust+Go | Validates `#1` — canned (already-right) |

**Do not re-litigate these.** LiteRouter's bare-metal, transparent, fail-loud design is correct; the mature vendors either confirm it or can't be ported.
