# Payload Wire & Scrubbing Matrix (`oa` vs `oo`)

Scrubbing is decided by the **payload (wire) segment** of the directive key,
not by provider (`zn`) or endpoint (`rs`). Wire routes to a handler; the
handler decides whether history is normalized or passed through untouched.

Directive shape: `lr-<provider>-<payload>-<endpoint>-<nuances>`
(see `troubleshoot.md` § directive format, `openrouter-handling-spec.md:297`).

## 1. Wire → Handler Routing

| Wire | Handler | File | Scrub? |
|---|---|---|---|
| `oa` (OpenAI compat) | `executeDirectRequest` | `src/handlers/openai_compat.ts:857` | **YES — unconditional outbound scrub** |
| `oo` (OpenAI Original / native Responses) | `handleOpenAiOriginal` via `dispatchResponsesRoute` | `src/handlers/openai_original.ts:975`, `src/index.ts:337` | **NO — byte passthrough** |
| `ao` (Anthropic→OpenAI cross-wire) | same `oa` compat path, `targetWire="ao"` | `src/handlers/openai_compat.ts:872` | YES + extra param strip (default on) |
| `cl` / `gg` | anthropic / gcp compat handlers | `src/handlers/anthropic_compat.ts`, `src/handlers/gcp_compat.ts` | own adapter rules, not covered here |

Endpoint (`ch` vs `rs`) does **not** change this. `src/index.ts:285`
`validateEndpointMatch` enforces `-rs-` keys → `POST /v1/responses` and
`-ch-` keys → `POST /v1/chat/completions` (mismatch = HTTP 400). So
`lr-zn-oa-rs-no` must be called on `/v1/responses` even though its wire is
`oa` — the compat handler still runs the `oa` scrub path, then
`transformOpenAiToResponses` converts `messages[]` → Responses `input`.

## 2. What `oa` Scrubs

`src/handlers/openai_compat.ts:872` → `sanitizeAndTransformPayload()` →
`src/transformers/payload.ts:290` `transformMessages()` calls
`scrubReasoningFromMessages()` **unconditionally** (no nuance/env gate).

Stripped per message (`src/transformers/opencode_adapter.ts:7`
`REASONING_KEYS`, `:437` `scrubReasoningFromMessage`):
`reasoning`, `reasoning_content`, `reasoning_details`, `thought`,
`thinking`, `<think>` blocks, array parts with `type: reasoning`.
Also `stripClientMetadata` / `normalizeToolContent` on `role: tool`.

Downstream: `src/transformers/responses.ts:304` forwards only
`response.output_text.delta` as `chat.completion.chunk`; reasoning items are
dropped, surfaced only as `usage.completion_tokens_details.reasoning_tokens`
(`src/transformers/responses.ts:261`). Net effect: **stateless, cheap,
no CoT replay**.

## 3. What `oo` Preserves

`src/handlers/openai_original.ts:1001` parses the body for logging only;
`src/handlers/openai_original.ts:1037` forwards the original `bodyText`
verbatim. Streaming `src/handlers/openai_original.ts:454` `pumpStream()` is a
byte pump — no `filterReasoningFromChunk`, no
`createOpenCodeReasoningFilterStreamTransformer` call site exists in
`src/handlers/`. Encrypted `reasoning` items, `previous_response_id`,
`function_call_output` all survive. Net effect: **stateful CoT replay
works, token bloat is the client's problem**.

Client plugin `.opencode2/plugins/collapse-reasoning.ts` hooks
`session.hook("context")` on `messages[]` only — native Responses `input[]`
bypasses it (see `opencode2-reasoning-scrubber.md` §3).

## 4. Overrides (both wires)

- Nuances (`src/transformers/thinking.ts:96` `shouldStripReasoning`,
  `src/transformers/opencode_adapter.ts:25` `isOpenCodeClient`):
  `ts` = keep thinking (disables strip), `sb` = force strip for any client.
- Param strip only (not history): `LITEROUTER_STRIP_REASONING` (default
  `false`), `LITEROUTER_AO_STRIP_REASONING` (default `true`),
  `LITEROUTER_ENABLE_SCRUBBING` (default `false`) — defaults in
  `src/config/schema.ts:127`, `src/config/env.ts:9`. History scrub in §2
  ignores these flags.
- Inbound live-stream filter (`createOpenCodeReasoningFilterStreamTransformer`,
  `src/transformers/opencode_adapter.ts:277`) is defined but has **zero call
  sites** in current handlers — documented design in
  `opencode2-streaming-troubleshooting.md` §3, not active code. Do not cite it
  as runtime behavior.

## 5. Which Key To Use (Zen)

| Key | Wire → Endpoint | Use when |
|---|---|---|
| `lr-zn-oa-rs-no` | `oa` → `rs` | legacy chat-compat clients, single-turn, want token savings; accept tool-loop amnesia |
| `lr-zn-oo-rs-no` | `oo` → `rs` | agentic harnesses (OpenCode), multi-step tool loops, reasoning models; accept bloat |

Detail: `zen-provider.md` §5. Translation mechanics: SKILL.md items 25–26.
Bloat rationale: `opencode2-reasoning-scrubber.md` §§1–2.
Adapter flowchart: `opencode2-streaming-troubleshooting.md` §3.
Env flags: `setup.md` (`LITEROUTER_AO_STRIP_REASONING` row).
Directive errors: `troubleshoot.md` (format + `scrubUnsupportedParameters`).
Wire labels in logs: `logger.md:44` (`oa→OpenAI`, `rs→Responses`).
Architecture boundary: `docs/ARCHITECTURE.md`, `docs/Fix_Streaming_01.md`
(two-leg streaming), `docs/Routing_Logic_FINAL.md` (routing).
Code: `src/transformers/payload.ts`, `src/transformers/opencode_adapter.ts`,
`src/transformers/thinking.ts`, `src/handlers/openai_compat.ts`,
`src/handlers/openai_original.ts`, `src/index.ts` (`validateEndpointMatch`,
`dispatchResponsesRoute`).
