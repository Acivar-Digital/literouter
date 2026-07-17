# 🪦 "Supersize Your Bun Router" Blueprint

**Status**: 🪦 **Canned (mostly) / Deferred (one item)**

## Context

A user pasted a generic LLM-generated blueprint titled "supersize your Bun API
router into a production API Gateway." It recommended frameworks (Bungate,
ElysiaJS, Hono), plugins (Unkey, elysia-rate-limit, @hono-rate-limiter,
idempot-js, rehydra/proxy), and three "architectural upgrades" (native
streaming, circuit breaker, smart key prioritization).

The blueprint was evaluated against the actual LiteRouter codebase
(`src/index.ts`, `src/lib.ts`). Conclusion: **most of it is already
implemented**, and the remainder is either a pointless rewrite or external
dependencies that conflict with the repo's design principles (transparent
router, fail-loud, no vendor lock-in, YAGNI — see AGENTS.md).

## Verdict by item

| Item | Verdict | Evidence |
|------|---------|----------|
| Native streaming / zero buffering | **Already done** | SSE chunk streaming via `decoder.decode(chunk, {stream:true})` + `controller.enqueue` — `src/index.ts:544`, `612-629`, `921-923`. Never buffers full JSON. |
| Circuit breaker | **Already done** | `circuitOpenUntil` Map + `CIRCUIT_TTL` — `src/index.ts:496-509`; per-key Redis cooldown on 429/5xx via `reportError` — `src/index.ts:362-482`, `732-739`. |
| Rate limits in Redis | **Already done** | Redis-backed quota script `QUOTA_CHECK_SCRIPT`, RPM/TPM per model/provider — `src/index.ts:303-430`; `getModelLimits` — `src/lib.ts:25`. |
| Bungate / ElysiaJS / Hono | **Canned** | Gateway is a purpose-built `Bun.serve` router (`src/index.ts`) with custom `/v1`, `/v1beta`, fusion logic. Swapping frameworks = full rewrite of working code for zero benefit. Bungate also appears obscure/unverified. |
| Unkey | **Canned** | Wrong use case — Unkey manages keys *issued to your users*; LiteRouter rotates *upstream provider* keys (Google/NVIDIA/OpenRouter/Zen). External SaaS = vendor lock-in. |
| elysia-rate-limit / @hono-rate-limiter | **Canned** | Framework-coupled; Redis rate limiting already exists. Moot unless a framework is adopted (it won't be). |
| idempot-js | **Canned** | LLM streaming cannot be safely replayed (a generated token stream can't be "undone"). Fusion already does failover on 429/5xx. |
| rehydra/proxy | **Canned** | Appears unverified/hallucinated; "PII anonymization" contradicts the transparent-router + fail-loud principles (content is not intercepted). |
| Smart key prioritization (x-ratelimit parsing, inflight tracking) | **Deferred** | Partially present (Redis quota + cooldown). No `x-ratelimit-remaining` parsing or active-inflight counter. Only genuinely novel idea, but speculative optimization, not a burning need. Revisit only if quota thrashing is observed in production. |

## Decision

- **Do not** adopt any framework or plugin from the blueprint. The gateway
  already implements all three "architectural upgrades."
- **Do not** introduce external key-management or proxy SaaS dependencies.
- **Defer** `x-ratelimit-remaining` parsing / inflight concurrency tracking as
  optional future polish, gated on a real observed need.

## Rejected Options

- Rewriting `src/index.ts` on Elysia/Hono/Bungate — rejected (pointless churn,
  violates "don't rewrite working code").
- Adding Unkey or rehydra — rejected (vendor lock-in / wrong abstraction /
  contradicts transparent-router design).
- Adding idempot-js — rejected (incompatible with streaming LLM responses).
