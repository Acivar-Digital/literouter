# 📋 OpenCode Execution Plan: Chinese Model Output Type Normalization (`cn` Nuance)

> **Document Status**: Production Specification (Standalone)
> **Bead**: `literouter-pjdr`
> **Date**: 2026-09-10

---

## 1. 🔍 Problem Statement & Empirical Evidence

### 1.1 The Problem (One Sentence)
Chinese open-weight models (`inclusionai/ling-3.0-flash-fin:free`, `thinkingmachines/inkling:free`, Dots, Qwen, DeepSeek) on OpenRouter/Novita break OpenCode 2 and Pydantic AI because LiteRouter's existing transformers make three incorrect assumptions about how these models emit output.

### 1.2 Empirical Evidence (Live Probe Results)

A diagnostic probe was run against `inclusionai/ling-3.0-flash-fin:free` via OpenRouter (Novita backend). These are the verified, reproducible findings:

#### Finding A: Ling Emits Native OpenAI `tool_calls` — Not XML
```json
{
  "role": "assistant",
  "content": "Let me check the current weather in Tokyo for you!",
  "tool_calls": [
    {
      "type": "function",
      "index": 0,
      "id": "call_8db5b95dfb474069b22bf428",
      "function": {
        "name": "get_weather",
        "arguments": "{\"location\": \"Tokyo\"}"
      }
    }
  ]
}
```
Ling does NOT emit `<arg_key>`, `<tool_call>`, or `<function=...>` XML tags. It uses standard OpenAI `tool_calls`. This means LiteRouter's XML-first parser (`parseLingXml`) finds nothing, returns `toolCalls: []`, and then **overwrites the model's valid native `tool_calls` with `undefined`**.

The downstream client (OpenCode 2) receives a response with text content but no tool calls. The turn ends on `finish_reason: "stop"` instead of `"tool_calls"`. OpenCode 2 halts and prompts the user to type "continue".

**Current buggy code in `transformLingResponse` (ling.ts:799-822)**:
```typescript
const { cleanText, toolCalls, reasoningContent } = parseLingXml(rawText);
// ...
tool_calls: toolCalls.length > 0 ? (toolCalls as OpenAIToolCall[]) : undefined,
// ^^^ Ling sent native tool_calls, but parseLingXml found 0 XML tool calls,
//     so this overwrites choice.message.tool_calls with undefined.
```

#### Finding B: Ling Wraps JSON in Markdown Fences
When asked for structured JSON output without explicit anti-fence instructions:
````
```json
{
  "name": "John Doe",
  "age": 30
}
```
````
Pydantic AI calls `json.loads(response.content)`. The leading `` ```json `` causes `JSONDecodeError: Expecting value: line 1 column 1 (char 0)`.

When explicitly instructed "no markdown, raw JSON only", Ling complies and emits pure `{"name": "John Doe", "age": 30}`. But Pydantic AI and many OpenAI-SDK consumers send `response_format: {"type": "json_object"}` instead of prompt-level instructions — and rely on the provider to enforce it.

#### Finding C: Novita Rejects `response_format` with HTTP 400
```json
{
  "error": {
    "message": "Provider returned error",
    "code": 400,
    "metadata": {
      "raw": "{\"code\":400,\"reason\":\"INVALID_REQUEST_BODY\",\"message\":\"model: inclusionai/ling-3.0-flash-fin does not support feature: structured-outputs\"}"
    }
  }
}
```
When a client sends `response_format: {"type": "json_object"}`, Novita immediately returns HTTP 400. LiteRouter currently passes `response_format` through to the upstream provider without checking whether the provider supports it.

#### Finding D: Ling Emits Reasoning via `delta.reasoning`, Not `<think>` Tags
Thinking content arrives in the `reasoning` and `reasoning_details` response fields — NOT in `<think>` tags embedded in `content`. This means LiteRouter's existing thinking-tag extraction logic is irrelevant for Ling 3.0.

#### Finding E: Streaming SSE Works Correctly for Tool Calls
In SSE streaming mode, Ling emits a 3-phase sequence:
1. `delta.reasoning` frames (thinking)
2. `delta.content` frames (conversational preamble)
3. `delta.tool_calls` frames (native function calls, streamed progressively)
4. `finish_reason: "tool_calls"`

LiteRouter's `createLingStreamTransformer` passes `delta.tool_calls` through intact (ling.ts lines 754-758). **The streaming path is NOT broken for tool calls.** The bug is exclusively in the non-streaming aggregation path (`transformLingResponse`).

### 1.3 Summary: Three Bugs, Three Fixes Needed

| Bug | Where It Breaks | Who It Affects | Root Cause |
|-----|-----------------|----------------|------------|
| **A. Native tool calls wiped** | `transformLingResponse` (ling.ts:799-822) | OpenCode 2 (non-streaming tool-call aggregation) | `parseLingXml` returns empty `toolCalls`, overwrites `choice.message.tool_calls` with `undefined` |
| **B. JSON wrapped in markdown fences** | `message.content` in non-streaming responses | Pydantic AI (`json.loads` fails on backticks) | No fence-stripping logic exists in LiteRouter |
| **C. `response_format` causes HTTP 400** | Outbound payload to Novita/OpenRouter | All clients sending `response_format: {"type": "json_object"}` | LiteRouter passes `response_format` through without checking provider capabilities |

---

## 2. 🎯 Scope & Architectural Decision: The `cn` Nuance Code

### 2.1 Objective
Create a single new nuance code `cn` ("Chinese model normalization") that an operator applies to any directive key to enable all three fixes simultaneously. One code, one key, done.

### 2.2 Why a New Nuance Code

LiteRouter currently has nuance codes `lg` (Ling XML parser), `tc` (Dots tool compaction), and `dp` (Dots XML polyfill). None of these solve the three bugs identified above:
- `lg` activates `parseLingXml`, which is the code that **causes** Bug A.
- `tc` and `dp` handle Dots-specific XML dialects, irrelevant for models that emit native `tool_calls`.
- No existing nuance strips `response_format` or markdown fences.

Asking operators to combine `lg`, `tc`, and `dp` per model is error-prone and doesn't actually fix the bugs — those codes were written for older model output formats.

### 2.3 What `cn` Does

When `cn` is present in a directive key (e.g., `lr-or-oa-ch-cn`), LiteRouter activates three behaviors:

| Behavior | Trigger Condition | Scope |
|----------|-------------------|-------|
| **A. Preserve Native Tool Calls** | `cn` nuance active AND upstream response contains `choice.message.tool_calls` | Non-streaming responses only (streaming already passes through `delta.tool_calls` correctly — see Finding E) |
| **B. Strip Markdown Fences from JSON** | `cn` nuance active AND the **original client request** contained `response_format: {"type": "json_object"}` | Non-streaming responses only (see §2.5 for rationale) |
| **C. Strip `response_format` from upstream payload** | `cn` nuance active | Outbound request transformation |

### 2.4 What `cn` Does NOT Do
- It does NOT activate XML tool-call parsing (that is `tc`/`lg`/`dp`).
- It does NOT strip reasoning content (that is `sb`).
- It does NOT preserve thinking (that is `ts`).
- It is composable: `lr-or-oa-ch-cn+ts` enables Chinese normalization AND thinking preservation.

### 2.5 Why Fence Stripping is Non-Streaming Only

1. The empirical probe confirmed Ling emits **native `delta.tool_calls`** in SSE streaming. The streaming tool-call pathway works. The "continue" loop in OpenCode 2 is caused by Bug A (non-streaming tool-call wipe), not streaming fences.
2. The markdown fence problem affects **Pydantic AI** (Python, non-streaming `httpx` calls), not OpenCode 2 (which uses streaming SSE and tool calling, not raw JSON parsing of `message.content`).
3. Building a streaming fence-suppression state machine (buffering opening ` ```json ` tokens across chunk boundaries, deciding whether to emit or elide, handling nested fences in code blocks) is high-risk engineering for a problem that does not currently manifest in streaming.
4. If streaming fence stripping becomes necessary in the future, it can be added as a separate enhancement. YAGNI applies.

### 2.6 Directive Key Examples

| Use Case | Directive Key | What Happens |
|----------|---------------|--------------|
| **OpenCode 2 + Ling (tool calling)** | `lr-or-oa-ch-cn` | Preserves native tool calls. Strips `response_format`. No XML parsing needed. |
| **Pydantic AI + Ling (JSON output)** | `lr-or-oa-ch-cn` | Strips `response_format` upstream. Unwraps markdown fences from `message.content`. |
| **OpenCode 2 + Dots (XML tool calling)** | `lr-or-oa-ch-cn+tc` | `cn` preserves native tools + strips `response_format`. `tc` handles XML tool-call parsing for models that emit XML instead of native tools. |
| **OpenCode 2 + Ling + keep thinking** | `lr-or-oa-ch-cn+ts` | `cn` + `ts` preserves thinking content alongside Chinese normalization. |

### 2.7 Why One Code Instead of Three Separate Codes
- Operators should not need to memorize which subset of {fence-strip, tool-preserve, response-format-strip} applies to which Chinese model.
- All three behaviors are **always safe** to enable together: preserving existing native tool calls never hurts; stripping `response_format` is harmless if the provider already ignores it; fence stripping only activates when the client actually requested JSON.

---

## 3. Target Files & AST Pre-Check

### 3.1 Target Files

| File | Role | What Changes |
|------|------|--------------|
| `src/directive/parser.ts` | Nuance code parsing | Add `cn` to `VALID_NUANCES` (line ~85) |
| `src/config/schema.ts` | Zod config validation | Add `cn` to `NuanceCodeSchema` (line ~34) |
| `src/transformers/ling.ts` | Ling/Chinese model transforms | Bug fix in `transformLingResponse`, add `stripJsonFences` + `extractFirstJsonBlock` utilities |
| `src/transformers/payload.ts` | Outbound payload sanitization | Strip `response_format` when `cn` nuance is active |
| `src/handlers/openai_compat.ts` | Central handler | Wire `isChinese` detection alongside existing `isLing`/`isXmlTranslationActive` |

### 3.2 AST Pre-Check Requirements (Read Before Editing)
- **`transformLingResponse` (ling.ts:799-822)**: Verify the exact line where `tool_calls: toolCalls.length > 0 ? ... : undefined` overwrites native tool calls.
- **`transformLingRequest` (ling.ts:~195-210)**: Verify it already deletes `tools` and `tool_choice`. Confirm it does NOT touch `response_format` (empirically confirmed: it does not).
- **`VALID_NUANCES` (parser.ts:85-94)**: Verify the exact array to confirm `cn` does not already exist.
- **`NuanceCodeSchema` (schema.ts:34-42)**: Verify the exact Zod union. Note: the existing `lg` code has a split-brain bug where `parser.ts` accepts it but `schema.ts` rejects it. `cn` must be added to BOTH files.
- **`scrubUnsupportedParameters` (payload.ts)**: Verify `response_format` is not in the current delete list (empirically confirmed: it is not).

### 3.3 Validation Tools
- `bun run typecheck` (`tsc --noEmit`) — zero type errors gate.
- `node node_modules/clean_ts/dist/cli.js validate <file>` — AST anti-slop, cognitive complexity < 6.
- `bun test` — unit tests.
- Live probe script at `/tmp/probe_ling.ts` — integration verification against running gateway.

---

## 4. 🛡️ Pre-Mortem & Threat Model

| # | Failure Scenario | Root Cause | Mitigation | Severity |
|---|-----------------|------------|------------|----------|
| 1 | **Conversational text destroyed by fence stripper** | Fence stripper activates on a non-JSON response (e.g., user asked for prose, not JSON) | Fence stripping ONLY activates when the original client request contained `response_format: {"type": "json_object"}`. LiteRouter must stash this flag BEFORE stripping `response_format` from the upstream payload. If `clientRequestedJson` is false, content passes through unchanged. | **Critical** |
| 2 | **Native tool calls still wiped** | `parseLingXml` returns empty `toolCalls`, code overwrites `choice.message.tool_calls` | Check `choice.message.tool_calls?.length > 0` FIRST. Only fall back to `parseLingXml` if native tool calls are absent. | **Critical** |
| 3 | **Model ignores JSON intent without `response_format`** | After stripping `response_format`, model emits conversational text instead of JSON | This is a model quality problem, not a gateway problem. The fence stripper will find no `{...}` block and pass the text through unchanged. Pydantic AI will throw `UnexpectedModelBehavior`, which is the correct error signal. LiteRouter must NOT fabricate JSON. | **Accepted risk** — fail loud |
| 4 | **OpenRouter 403 on free-tier models** | Missing agentic harness headers | Already mitigated: `config/providers.json` includes `HTTP-Referer: https://opencode.ai`, `X-Title: OpenCode`, `User-Agent: OpenCode/1.18.29`. No change needed. | **Already solved** |
| 5 | **Key quarantine cascade from model quirks** | LiteRouter treats malformed model output as upstream 5xx, quarantining healthy keys | Model output quirks (fences, XML in content) arrive as HTTP 200 responses. They never trigger key quarantine. The fix is in the transformer layer, not the cooldown layer. | **No action needed** |
| 6 | **`cn` nuance rejected by config-file Zod validation** | `NuanceCodeSchema` in `schema.ts` does not include `cn` | Must add `cn` to both `parser.ts:VALID_NUANCES` AND `schema.ts:NuanceCodeSchema`. | **Phase 1 deliverable** |
| 7 | **Multiple JSON blocks in response** | Model emits scratchpad `{...}` then final `{...}` | A naive `indexOf("{")` + `lastIndexOf("}")` would merge both blocks into one invalid payload | Must use a brace-depth-counting parser that extracts the FIRST complete top-level `{...}` block |

---

## 5. 🛠️ Step-by-Step Implementation

### Phase 1: Register the `cn` Nuance Code

**Files**: `src/directive/parser.ts`, `src/config/schema.ts`

**Action**:
1. Add `"cn"` to the `VALID_NUANCES` array in `src/directive/parser.ts` (line ~85).
2. Add `"cn"` to the `NuanceCodeSchema` Zod union in `src/config/schema.ts` (line ~34).
3. Add detection logic in `src/handlers/openai_compat.ts` alongside existing `isLing` / `isXmlTranslationActive`:
   ```typescript
   const isChinese = directive.nuances.includes("cn");
   ```

**Validation**:
- `bun run typecheck` passes.
- Existing unit tests pass (`bun test`).
- A directive key `lr-or-oa-ch-cn` parses successfully.
- A directive key `lr-or-oa-ch-cn+ts` parses successfully (compound nuance).

🛑 **Context Lock**: `bd update literouter-pjdr` to record Phase 1 completion.

---

### Phase 2: Fix the Native Tool-Call Wipe Bug in `transformLingResponse`

**File**: `src/transformers/ling.ts`

**Action**:
In `transformLingResponse` (lines 799-822), change the tool_calls assignment logic:

**Current (buggy)**:
```typescript
const { cleanText, toolCalls, reasoningContent } = parseLingXml(rawText);
// ...
tool_calls: toolCalls.length > 0 ? (toolCalls as OpenAIToolCall[]) : undefined,
```

**Fixed**:
```typescript
// 1. Check if upstream already provided native tool_calls
const nativeToolCalls = choice.message.tool_calls;
const hasNativeTools = Array.isArray(nativeToolCalls) && nativeToolCalls.length > 0;

// 2. Only parse XML from content if no native tool_calls exist
const { cleanText, toolCalls: xmlToolCalls, reasoningContent } = parseLingXml(rawText);

// 3. Native tool_calls take priority; XML parsing is fallback only
const finalToolCalls = hasNativeTools
  ? nativeToolCalls
  : (xmlToolCalls.length > 0 ? xmlToolCalls : undefined);
const finalFinishReason = finalToolCalls
  ? "tool_calls"
  : (choice.finish_reason || "stop");
```

**Why this is safe**:
- If the model emits native `tool_calls` (Ling 3.0 on Novita/OpenRouter does), they are preserved.
- If the model emits XML tool calls in `content` (older Ling/GLM formats), `parseLingXml` extracts them as before.
- If the model emits both (unlikely but possible), native takes priority because they are already in the correct OpenAI format.

**Validation**:
- Unit test: Pass a response with native `tool_calls` into `transformLingResponse`. Assert they are preserved in the output.
- Unit test: Pass a response with XML tool calls in `content` (no native `tool_calls`). Assert they are parsed and emitted.
- Unit test: Pass a response with BOTH. Assert native wins.

🛑 **Context Lock**: `bd update literouter-pjdr` to record Phase 2 completion.

---

### Phase 3: Conditional JSON Fence Stripper (Non-Streaming Only)

**File**: `src/transformers/ling.ts`

**Action**:
Add two exported utility functions:

1. **`stripJsonFences(text: string): string`**
   - If `text` contains `` ```json `` (with optional whitespace/newlines before/after), remove the opening fence line and the closing `` ``` ``.
   - If `text` contains `` ``` `` (no language tag), same treatment.
   - Return the interior text, trimmed.
   - If no fences found, return text unchanged.

2. **`extractFirstJsonBlock(text: string): string`**
   - Walk the string character by character.
   - Track whether currently inside a JSON string literal (between unescaped `"` characters) to handle escaped braces like `\"{}\"`.
   - When `{` is encountered outside a string, start counting brace depth.
   - When brace depth returns to 0, extract from the opening `{` to the closing `}` (inclusive).
   - Return the first complete top-level JSON block.
   - If no complete block found, return the original text unchanged (fail-through, do not fabricate).

**Activation condition** (critical):
These functions are called ONLY when:
```typescript
const clientRequestedJson = originalRequest?.response_format?.type === "json_object";
```
The `clientRequestedJson` flag must be determined and stashed BEFORE `response_format` is stripped from the upstream payload (see Phase 4). If `clientRequestedJson` is false, the content passes through unchanged — conversational responses are never mutated.

**Why brace-depth counting instead of `indexOf`/`lastIndexOf`**:
- `indexOf("{")` + `lastIndexOf("}")` merges multiple JSON blocks into one invalid block.
- Brace-depth counting correctly isolates the first complete `{...}` structure.
- String-awareness handles escaped braces inside JSON string values.

**Streaming scope**: These functions are NOT wired into `createLingStreamTransformer`. Streaming is out of scope. The streaming path already correctly passes through native `delta.tool_calls` (see §1.2 Finding E).

**Validation**:
- Unit test: `` ```json\n{"status": "ok"}\n``` `` → `{"status": "ok"}`.
- Unit test: ``好的，这是结果：\n```json\n{"data": 1}\n``` `` → `{"data": 1}`.
- Unit test: `{"status": "ok"}` (no fences) → `{"status": "ok"}` (passthrough).
- Unit test: `Here is some explanation about JSON` (no JSON block, `clientRequestedJson=true`) → original text returned unchanged (fail-through).
- Unit test: Two JSON blocks `{"a":1} {"b":2}` → `{"a":1}` (first block only).
- Unit test: Nested braces `{"code": "if (x) { return; }"}` → correctly returns the full object.

🛑 **Context Lock**: `bd update literouter-pjdr` to record Phase 3 completion.

---

### Phase 4: Strip `response_format` from Upstream Payload

**File**: `src/transformers/payload.ts`

**Action**:
In the payload transformation pipeline (either in `sanitizeAndTransformPayload` or in a new function called when `cn` nuance is active):
1. **Determine and stash the `clientRequestedJson` flag** BEFORE stripping: `const clientRequestedJson = payload.response_format?.type === "json_object"`.
2. **Delete `response_format`** from the outbound payload.
3. **Thread `clientRequestedJson`** back to the handler so the non-streaming path can conditionally activate fence stripping (Phase 3).

**How to thread the flag**: Either:
- (A) Add `clientRequestedJson` to the handler context object that already flows from `openai_compat.ts` to transformers. This is the cleaner approach.
- (B) Stash on an underscore-prefixed metadata field `payload._clientRequestedJson` (less clean, works).

**Validation**:
- Unit test: Payload with `response_format: {"type": "json_object"}` → outbound payload has no `response_format` field, `clientRequestedJson` is `true`.
- Unit test: Payload without `response_format` → no change, `clientRequestedJson` is `false`.

🛑 **Context Lock**: `bd update literouter-pjdr` to record Phase 4 completion.

---

### Phase 5: Wire `cn` into the Handler

**File**: `src/handlers/openai_compat.ts`

**Action**:
In `handleOpenAICompat`, after the existing `isLing` / `isXmlTranslationActive` detection (lines ~391-397):

```typescript
const isChinese = directive.nuances.includes("cn");
```

**Non-streaming path** (around lines 399-414):
- If `isChinese` OR `isLing`, apply the fixed `transformLingResponse` (Phase 2 — this fix benefits both `cn` and `lg` users).
- If `isChinese` AND `clientRequestedJson`, apply `stripJsonFences` then `extractFirstJsonBlock` to `message.content` (Phase 3).

**Streaming path** (around lines 610-616):
- If `isChinese`, pipe through `createLingStreamTransformer()`. The stream transformer already passes through native `delta.tool_calls`.

**Payload path** (before upstream dispatch):
- If `isChinese`, strip `response_format` from outbound payload (Phase 4).

**Interaction with existing codes**:
- `cn` is a superset that fixes bugs in the `lg`/`isLing` pathway.
- Phase 2 (tool-call fix) applies to both `cn` AND `lg` — it is a bug fix, not a feature gate.
- `cn` adds fence stripping and `response_format` stripping that `lg` lacks.
- `lg` continues to work for backward compatibility. Long-term, it can be deprecated in favor of `cn`.

**Validation**:
- Integration test: Send a request with directive `lr-or-oa-ch-cn` and model `inclusionai/ling-3.0-flash-fin:free` with `tools` defined. Verify native tool calls arrive intact in the response.
- Integration test: Send a non-streaming request with directive `lr-or-oa-ch-cn` and `response_format: {"type": "json_object"}`. Verify no HTTP 400 upstream, and response content is clean JSON without fences.
- Integration test: Send a streaming request. Verify SSE chunks contain `delta.tool_calls` when the model calls tools.

🛑 **Context Lock**: `bd update literouter-pjdr` to record Phase 5 completion.

---

## 6. 🔄 The OpenCode Test & Resolution Protocol

### 6.1 Test Execution Order
1. `bun run typecheck` — zero type errors.
2. `node node_modules/clean_ts/dist/cli.js validate src/transformers/ling.ts` — AST hygiene.
3. `node node_modules/clean_ts/dist/cli.js validate src/transformers/payload.ts` — AST hygiene.
4. `node node_modules/clean_ts/dist/cli.js validate src/handlers/openai_compat.ts` — AST hygiene.
5. `bun test` — all unit tests pass.
6. Live probe: `/tmp/probe_ling.ts` against running LiteRouter with `lr-or-oa-ch-cn`.

### 6.2 Failure Protocol
If any test fails:
1. **HALT** — do not guess-and-patch.
2. Spawn a subagent to run AST analysis on the failing function.
3. Subagent reports the structural root cause.
4. Apply the fix based on confirmed AST diagnosis.
5. Re-run the full test suite from step 1.

### 6.3 Unit Test File
Create `test/cn-nuance.test.ts` with the following test groups:
- `describe("transformLingResponse — native tool call preservation")`
- `describe("transformLingResponse — XML fallback parsing")`
- `describe("stripJsonFences")`
- `describe("extractFirstJsonBlock")`
- `describe("payload response_format stripping")`
- `describe("cn nuance directive parsing")`

---

## 7. 🚀 Deployment, Testing & Rollback Strategy

### 7.1 Pre-Flight
- `bun run scripts/doctor.ts` — confirm OpenRouter keys healthy.
- `curl -sk https://localhost:7766/health` — gateway responding.

### 7.2 Cutover
1. `bash scripts/restart.sh` — reload gateway with new code.
2. **OpenCode 2 smoke test**: Use `lr-or-oa-ch-cn` as directive, model `inclusionai/ling-3.0-flash-fin:free`. Execute a multi-step agentic task requiring tool calls (e.g., read a file, then edit it). Success = zero "continue" prompts, tools execute natively.
3. **Pydantic AI smoke test**: Run a Python script using Pydantic AI with `output_type=SomeModel` against LiteRouter with `lr-or-oa-ch-cn`. Success = valid Pydantic model returned, zero `JSONDecodeError`.

### 7.3 Rollback
```bash
git checkout HEAD~1 -- src/transformers/ling.ts src/transformers/payload.ts src/handlers/openai_compat.ts src/directive/parser.ts src/config/schema.ts
bash scripts/restart.sh
```

### 7.4 Deployment Testing (Anti-Bloat)
If deployment tests fail and trigger a `test > fix > repeat` loop:
1. **Step 1 (AST Diagnosis)**: Run AST analysis to structurally map the root cause.
2. **Step 2 (Subagent Execution)**: Spawn subagents to implement and verify the fix in isolation.
This prevents context bloat in the main execution thread.

🛑 **Final Context Lock**: `bd close literouter-pjdr --reason "Completed cn nuance: Chinese model output normalization"` and push.

---

## 8. Documentation Updates Required

After implementation, update these files:

| File | Update |
|------|--------|
| `.opencode2/skills/literouter/directive-grammar.md` §5 | Add `cn` to nuance table: "Chinese model normalization: preserves native tool_calls, strips response_format upstream, unwraps markdown JSON fences (non-streaming)." |
| `.opencode2/skills/literouter/SKILL.md` §4 | Add `lr-or-oa-ch-cn` to the Top-10 Keys table. |
| `CHANGELOG.md` | Add entry under current version. |

---

## 9. What This Plan Explicitly Does NOT Cover (YAGNI)

| Out-of-Scope Item | Why |
|-------------------|-----|
| Streaming markdown fence stripping | Ling emits native `tool_calls` in streaming. Fence stripping is only needed for non-streaming JSON mode (Pydantic AI). No evidence of streaming fence issues. |
| Dots XML tool-call parsing fixes | Dots uses `tc`/`dp` nuance and `createDotsStreamTransformer`. Dots problems are a separate bead. `cn` can be composed with `tc` (`cn+tc`) if both are needed. |
| Assistant prefill / `</think>\n{` injection | Aggregators (Zen, OpenRouter) return HTTP 400 on trailing assistant messages. |
| Model-specific prompt engineering | LiteRouter is a protocol adapter, not a prompt optimizer. If Ling ignores JSON instructions, that is a model limitation, not a gateway bug. |
| Inkling 403 whitelist header fix | Already solved by existing `config/providers.json` headers (`HTTP-Referer: https://opencode.ai`, `X-Title: OpenCode`, `User-Agent: OpenCode/1.18.29`). No change needed. |
