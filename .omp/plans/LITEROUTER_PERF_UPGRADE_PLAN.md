# LiteRouter Performance & Reliability Upgrade Plan

## Context
LiteRouter v4.1 is the default production routing engine for multi-provider LLM requests across OpenCode 2, Antigravity IDE, Oh My Pi, and Pydantic AI. An architectural performance and reliability audit identified key bottlenecks:
1. Redundant key pool reloading on every single request (`initializeKeyPools` inside `handleAppRequest`).
2. Per-request instantiation of `FusionEngine`, recreating the sticky position cache and causing redundant fallback probing.
3. Megabyte-scale trace string sanitization across large prompt/context payloads running unconstrained regexes.
4. Legacy dead-weight context pruning and LaTeX normalization running inside proxy payload transformers instead of letting clients manage state.
5. Upstream stream stalls and 0-token ghost responses caused by client request histories terminating with a model/assistant turn.
6. SSE stream overhead from redundant JSON parsing and re-serialization when reasoning scrubbing is inactive.
7. Dynamic inline imports (`require('./zen')`) on the request path.

This plan addresses all items: implementing recommended optimizations 1, 2, 3, and 6; removing dead-weight 4; re-engineering 5 to insert a synthetic user turn (`"ok go on"`) when conversations end on an assistant/model message; and hoisting dynamic imports in 7.

---

## Approach

### Phase 1: Inbound Trailing Assistant Auto-Healing (Re-engineered 5)
When downstream AI agents (Antigravity, Cursor, Oh My Pi, OpenCode) send conversation histories ending on `role: "assistant"` or `role: "model"`, upstream providers (Gemini, OpenRouter, vLLM, reasoning models) either reject the request with HTTP 400 or emit an immediate EOS `[DONE]` token with 0 content tokens, triggering gateway stream timeouts.

- **Target**: `src/transformers/opencode_adapter.ts` and `src/transformers/payload.ts`.
- **Implementation**:
  - Add `ensureTerminalUserTurn(messages: OpenAIMessage[]): OpenAIMessage[]`.
  - Check the last non-null element of `messages`. If `last.role === "assistant"` or `last.role === "model"`, append `{ role: "user", content: "ok go on" }`.
  - Wire into `sanitizeAndTransformPayload` in `src/transformers/payload.ts` and `translateMessagesToOpenAI` in `src/transformers/anthropic_openai_xwire.ts`.
  - Add targeted unit tests in `tests/unit/trailing_assistant.test.ts`.

### Phase 2: Purge Dead-Weight Context Pruning & LaTeX Normalization (Removal of 4)
LiteRouter v4.1 operates as a dumb, high-throughput forwarder. Clients (Oh My Pi, OpenCode, Pydantic) manage token limits and context pruning. Proxy-level regex LaTeX normalization corrupts programming code containing `\times`, `\rightarrow`, or regex patterns.

- **Target**: `src/transformers/payload.ts`, `src/transformers/context_pruner.ts`.
- **Implementation**:
  - Remove `applyLatexNormalization` from `transformMessages` in `src/transformers/payload.ts`. (Retain an empty export or mark deprecated if imported by legacy tests, then update tests).
  - Stop importing and executing proactive payload pruning.
  - Delete `src/transformers/context_pruner.ts` or replace its contents with a minimal shim if legacy compat handlers reference its token estimation helpers. Specifically: export `estimateTextTokens` and `estimateAnthropicTokens` from a dedicated lightweight token utility, and prune out unused 350-line message mutation code.
  - Update `tests/unit/context_pruner.test.ts` to reflect the clean forwarder contract.

### Phase 3: Cold-Boot Key Pool Architecture (1)
`initializeKeyPools` currently runs on every incoming request inside `handleAppRequest` (`src/index.ts:536`) and `openai_original.ts:141`. This re-reads `process.env` and resets `KeyPool` maps under concurrent load.

- **Target**: `src/index.ts`, `src/handlers/openai_original.ts`.
- **Implementation**:
  - Remove `initializeKeyPools()` call from `handleAppRequest` (`src/index.ts:536`).
  - Keep `initializeKeyPools()` strictly at cold boot (`src/index.ts:60`, `init()` / startup) and inside admin `/reset` and `/admin/pool/reset` handlers.
  - Remove redundant `initializeKeyPools()` inside `openai_original.ts:141`.
  - Verify that key rotation across concurrent requests operates purely in-memory via `globalKeyPool.selectNextKey()` without lockups or env re-reads.

### Phase 4: Singleton FusionEngine with In-Memory StickyPositionCache (2)
Currently, `executeFusionFlow` (`src/handlers/openai_compat.ts:1092`) instantiates a `new FusionEngine(fusionCfg)` on every request, creating a fresh `StickyPositionCache` each time. This drops fallback tier state and forces redundant fallback probing.

- **Target**: `src/handlers/openai_compat.ts`, `src/index.ts`.
- **Implementation**:
  - Introduce module-scoped cached `FusionEngine` instance in `src/handlers/openai_compat.ts`:
    `let cachedFusionEngine: FusionEngine | null = null;`
  - In `executeFusionFlow`:
    `if (!cachedFusionEngine) cachedFusionEngine = new FusionEngine(loadFusionConfig());`
  - Export `resetCachedFusionEngine(): void` and call it inside `resetProvidersRegistryCache()` / `/reset` in `src/index.ts`.
  - This preserves `StickyPositionCache` across requests while guaranteeing clean invalidation when config changes or admin `/reset` is invoked.

### Phase 5: Trace Payload Truncation & Memory Safety (3)
Trace recordings currently pass entire multi-megabyte payloads to `sanitizeBody` and `traceWriter`, running CPU-expensive regex secret replacements on massive string payloads.

- **Target**: `src/telemetry/sanitize.ts`, `src/engine/dispatch.ts`, `src/telemetry/trace_writer.ts`.
- **Implementation**:
  - In `src/telemetry/sanitize.ts`, update `sanitizeBody(body: unknown, maxBytes = MAX_LEG_BYTES): string`.
  - Before applying `SECRET_REGEX`, truncate stringified text to `maxBytes` (64KB, matching `MAX_LEG_BYTES` from `src/telemetry/ring_buffer.ts`).
  - Append `... [TRUNCATED FOR TRACE]` if truncated.
  - Error responses to the client remain untruncated; only trace database logs are bounded.
  - In `src/telemetry/trace_writer.ts`: use `estimateTraceSize(trace)` rather than full stringification during batch queue size calculation.

### Phase 6: Direct SSE Chunk Streaming & Fast-Path Bypass (6)
When reasoning scrubbing is inactive (which is the case when nuances include `ts` or `LITEROUTER_ENABLE_SCRUBBING=false` for non-oa wires), SSE chunks are currently decoded, regex-checked, parsed into JSON, and re-stringified.

- **Target**: `src/transformers/openai_chat.ts`.
- **Implementation**:
  - In `handleLine`: if `shouldScrubReasoning(directive)` is `false` and no custom nuances require line rewriting (such as `ts` thought signatures), stream raw SSE chunks directly to `controller.enqueue(encoder.encode(line + "\n"))` after marking TTFT and recording tokens.
  - Avoid `JSON.parse` and `JSON.stringify` on lines that do not need mutation.

### Phase 7: Hoist Dynamic Module Requires (7)
`src/engine/dispatch.ts:663` calls `const { accumulateZenStreamToCompletion, accumulateZenResponsesStream } = require("./zen");` inside the hot request path.

- **Target**: `src/engine/dispatch.ts`.
- **Implementation**:
  - Hoist `accumulateZenStreamToCompletion` and `accumulateZenResponsesStream` to top-level ES `import { ... } from "./zen";`.
  - Eliminate dynamic Node `require()` overhead in the Bun runtime.

---

## Critical Files & Anchors
- `src/transformers/payload.ts`: message transformation pipeline; remove LaTeX normalization; wire trailing assistant normalization.
- `src/transformers/anthropic_openai_xwire.ts`: translate Anthropic message histories to OpenAI wires; enforce terminal user turn.
- `src/index.ts`: gateway ingress; strip per-request `initializeKeyPools` from `handleAppRequest`; add fusion cache invalidation to `/reset`.
- `src/handlers/openai_compat.ts`: export singleton `FusionEngine` with persistent `StickyPositionCache`.
- `src/telemetry/sanitize.ts`: truncate trace leg strings to 64KB prior to regex scrubbing.
- `src/transformers/openai_chat.ts`: fast-path raw SSE passthrough when scrubbing is inactive.
- `src/engine/dispatch.ts`: hoist `./zen` import; record bounded traces.

---

## Verification
1. **Trailing Assistant Test**:
   - Send payload with `messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }]`.
   - Verify transformed payload has 3 messages ending with `{ role: "user", content: "ok go on" }`.
2. **LaTeX Preservation Test**:
   - Send payload containing `\times` and `\rightarrow` in code snippets.
   - Verify strings are NOT mutated into Unicode `×` or `→`.
3. **Key Pool & Fusion Cache Test**:
   - Exercise multiple consecutive requests through `/v1/chat/completions` and fusion presets (`lr-fse-*`).
   - Verify `StickyPositionCache` retains tier rankings across requests.
   - Verify `/reset` clears caches cleanly.
4. **Trace Bounding Test**:
   - Send 500KB prompt. Verify trace record in `traceBuffer` and SQLite is capped at ≤64KB per leg.
5. **Quality Gates**:
   - Run `bun run typecheck` (zero TypeScript errors).
   - Run `bun run test` (all unit/domain tests pass).
