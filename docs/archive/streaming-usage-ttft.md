# IMPL: Streaming `usage` + TTFT Extraction (Proxy-Layer Observability)

**Status**: 📋 **Design ready — implementation deferred** (user wants further discussion)
**Captured**: 2026-07-17
**Source**: Adoption of idea #3 from the "proxy-layer" review (the only in-scope, non-buffering, cheap win among that batch).
**Bead**: `literouter-7cb`

---

## Goal
Add honest observability (token usage + Time-To-First-Token) for **every** request — streaming or not — without breaking the transparent passthrough. Extraction is inline in the existing `TransformStream`; no buffering, no latency tax, no change to the bytes delivered to the client, no quota-enforcement change.

## Why
- Streaming requests currently record only `"(stream)"` in the trace (`src/index.ts:764`) — actual `usage` is lost.
- Non-streaming requests already parse the full body (`:780`) but do not extract/store `usage`.
- Quota buckets use the request-side `estimatedTokens` *estimate* (`src/index.ts:701`); actuals are pure observability and must NOT feed enforcement yet (cost/pricing is separate KIV: `docs/KIV_cost_tracking.md`).

## Expected Behavior
1. **Streaming usage**: as SSE chunks pass through `createReasoningTransform` (`:555`), when a chunk carries `usage` (OpenAI-compat final event) or `usageMetadata` (Google native), extract `prompt_tokens` / `completion_tokens` / `total_tokens`.
2. **TTFT**: timestamp of the *first enqueued byte* minus request start → recorded per request.
3. **Sinking**: write to the trace record (replacing `"(stream)"`), `logState`, and increment Redis counters keyed by `upstream_model` + active key (observability only).
4. **Non-streaming**: extract `usage` from the already-parsed body (`:780`) the same way.
5. **`include_usage` injection**: for OpenAI-compat streaming, set `reqJson.stream_options = { ...(reqJson.stream_options||{}), include_usage: true }` so providers emit the final usage chunk (otherwise most omit it). Benign request-side normalization, consistent with passthrough philosophy.

## Non-Goals (explicitly out of scope)
- No `$` cost computation (no pricing table — `KIV_cost_tracking.md`).
- No quota enforcement from actuals (still uses `estimatedTokens` estimate).
- No response alteration — bytes to client stay identical.
- No buffering of the stream.

## Implementation Sketch (code anchors)
- **Transform builder** `createReasoningTransform(collapseReasoning, ...)` (starts ~`:545`):
  - Accept a `metrics` out-param (mutable object) + `requestStart` (ms) + `reqId`/`provider`/`upstream_model`/`activeKey` for logging.
  - In `transform()`: on first `data:` chunk, set `metrics.ttftMs = Date.now() - requestStart`.
  - On parsed `json.usage` / `json.usageMetadata`, copy token counts into `metrics.usage`.
  - In `flush()`: call `logState(...)` + `router.recordUsage(...)` (fire-and-forget Redis) using `metrics`.
- **OpenAI-compat handler** (`executeOpenAICompat`, ~`:675`): inject `include_usage` before `fetch` (`:725`) when `isStream`; pass `metrics`/`requestStart` into transform; at `:768` pipe as today.
- **Google native handler** (~`:860-948`): mirror — capture `usageMetadata` and feed the same `metrics`/`logState` path at `:948`.
- **Redis**: add `recordUsage(upstreamModel, key, usage)` to the router (increment `lit:usage:{upstreamModel}` hash: `prompt`/`completion` counters; optional per-key breakdown). Non-blocking.

## Verification
- `bun build src/index.ts --target=bun` → exit 0 (typecheck).
- `bun test` → all pass.
- Manual: stream a chat completion with `stream_options.include_usage:true`; confirm log line shows `usage` + `ttftMs` and trace record no longer says `"(stream)"`.
- Confirm client still receives identical SSE (no extra/changed chunks).

## Discussion open items (user requested)
- Redis key shape / retention for usage counters.
- Whether to also surface TTFT/usage on the response via a trailing header (e.g. `X-Literouter-Usage`) — would be a response-side addition, needs care vs transparent-passthrough principle.
- Whether actuals should *later* inform TPM quota (currently only `max_tpm` is defined, enforcement uses estimates).
