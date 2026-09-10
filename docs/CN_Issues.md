# 📋 OpenCode Execution Plan: Chinese Model Normalization (`cn` Nuance)

> **Document Status**: Production Specification (Standalone)  
> **Target Path**: `docs/CN_Issues.md`  
> **Bead**: `literouter-pjdr`  
> **Date**: 2026-09-10  

---

## 1. 🔍 Empirical Evidence & Root Cause Analysis

### 1.1 Finding A: OpenRouter Natively Supports Multi-Turn Tool Calling for Ling 3.0
On 2026-09-10, an empirical probe was executed directly against OpenRouter (`https://openrouter.ai/api/v1/chat/completions`) using model `inclusionai/ling-3.0-flash-fin:free`.

**Turn 1 (Tool Invocation Request)**:
- Payload: `messages: [{ role: "user", content: "Check weather in Tokyo" }]`, `tools: [get_weather]`.
- Upstream HTTP Status: **`200 OK`**.
- Response:
```json
{
  "choices": [
    {
      "finish_reason": "tool_calls",
      "message": {
        "role": "assistant",
        "content": null,
        "tool_calls": [
          {
            "id": "call_ce1eaf7ecbac429a9f375328",
            "type": "function",
            "function": {
              "name": "get_weather",
              "arguments": "{\"location\": \"Tokyo\"}"
            }
          }
        ]
      }
    }
  ]
}
```

**Turn 2 (Tool Output Feeding)**:
- Payload: Turn 1 User Message + Turn 1 Assistant Message (with `tool_calls`) + Tool Observation Message (`role: "tool"`, `tool_call_id: "call_ce1eaf7ecbac429a9f375328"`, `content: "{\"temp\": \"15C\"}"`).
- Upstream HTTP Status: **`200 OK`**.
- Response:
```json
{
  "choices": [
    {
      "finish_reason": "stop",
      "message": {
        "role": "assistant",
        "content": "The current weather in **Tokyo** is **15°C**. 🌤️"
      }
    }
  ]
}
```
**Empirical Fact**: OpenRouter/Novita natively supports standard OpenAI `tools`, `tool_calls`, and multi-turn `role: "tool"` execution history for Ling 3.0. Zero XML is required.

---

### 1.2 Finding B: Upstream Rejects `response_format` with HTTP 400
When sending structured JSON requests with `response_format: {"type": "json_object"}` to `inclusionai/ling-3.0-flash-fin:free` on OpenRouter:
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
Without `response_format`, Ling emits valid JSON wrapped in markdown fences:
````
```json
{"status": "ok", "data": 123}
```
````
In Pydantic AI, `json.loads()` fails on leading backticks: `JSONDecodeError: Expecting value: line 1 column 1 (char 0)`.

---

### 1.3 Finding C: The Historical Origin of LiteRouter's Tool Hijacking
In Git commit `f822c57` (2026-08-30), OpenRouter rejected `tools` for Ling. LiteRouter implemented an XML polyfill in `src/transformers/ling.ts` with this explicit comment in the test suite:
```typescript
// 1. Root tools and tool_choice must be stripped to avoid upstream 400
expect((transformed as Record<string, unknown>).tools).toBeUndefined();
expect((transformed as Record<string, unknown>).tool_choice).toBeUndefined();
```

LiteRouter hardwired an automatic trigger in `src/transformers/payload.ts` (lines 333–338):
```typescript
const isLing =
  nuances.includes("lg") ||
  (Boolean(payload.model && payload.model.toLowerCase().includes("ling")) && !nuances.includes("tc") && !nuances.includes("no"));

if (isLing) {
  currentPayload = transformLingRequest(currentPayload);
}
```

Whenever `model` includes `"ling"`, LiteRouter automatically:
1. **Deletes `tools` and `tool_choice`** from the outbound request (`ling.ts:202-203`).
2. **Rewrites `role: "tool"` into `role: "user"`** with content `<tool_response id="...">` (`ling.ts:116-121`).
3. **Injects an XML prompt** into the system message: `To invoke a tool, output: <tool_call>...` (`ling.ts:181-184`).

---

### 1.4 Finding D: Why OpenCode 2 Flashes `user <> o <tool_calls>` and Freezes
Because LiteRouter deleted the `tools` array:
1. Ling receives no tools and tries to follow the injected XML system prompt.
2. Ling outputs raw text inside `delta.content`: `<tool_call>...` or `<tool_calls>...`.
3. OpenCode 2 receives this as text tokens and streams them to the terminal:
   - The fake `user` message created from `<tool_response>` prints `user`.
   - The assistant text prints `<tool_calls>`.
   - The terminal flashes `user <> o <tool_calls>`.
4. LiteRouter's streaming regex buffer (`createLingStreamTransformer`) attempts to parse the XML, but on malformed tags or early stream termination, `hasEmittedToolCalls` is `false`.
5. LiteRouter emits `finish_reason: "stop"`.
6. OpenCode 2 receives `finish_reason: "stop"` with **zero valid tool calls**. OpenCode 2 assumes the assistant finished talking, closes the agent loop, drops to the prompt, and forces the operator to type `"continue"`.

---

### 1.5 Finding E: Proven Production Solution in `baziforecaster`
In `baziforecaster/infrastructure/generators/branches/stages.py` (lines 330–346), 17,600 batch cells were processed successfully with Ling 3.0 at 380 tokens/sec using this exact 16-line post-processing logic:
```python
def _extract_json_block(text: str) -> str:
    stripped = text.strip()
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start != -1 and end != -1 and end > start:
        return stripped[start : end + 1]
    return stripped

def _strip_json_fences(text: str) -> str:
    t = text.strip()
    if t.startswith("```"):
        nl = t.find("\n")
        t = t[nl + 1 :] if nl != -1 else t.lstrip("`").lstrip("json").strip()
        if t.endswith("```"):
            t = t.removesuffix("```").strip()
    return t.strip()
```

---

## 2. 🎯 The Architectural Solution: `cn` Nuance Code

Instead of stacking complex regex parsers or streaming state machines, LiteRouter introduces the **`cn`** ("Chinese Model Normalization") nuance code.

### 2.1 The Contract of `cn`
When `cn` is present in a directive key (e.g. `lr-or-oa-ch-cn`):

| Component | Behavior Under `cn` | Purpose |
|---|---|---|
| **Outbound Tools** | **Pass untouched.** Bypasses `transformLingRequest`. Native `tools` and `tool_choice` flow directly to OpenRouter. | Restores native OpenAI tool calling for OpenCode 2. |
| **Outbound Messages** | **Pass untouched.** Does not convert `role: "tool"` to fake `user` messages. | Preserves valid OpenAI message history. |
| **Outbound `response_format`** | **Strip from payload.** Deletes `response_format: {"type": "json_object"}` before dispatching to upstream. | Prevents Novita HTTP 400 error. |
| **Non-Streaming Response** | If client requested JSON, run `_strip_json_fences` + `_extract_json_block` on `message.content`. | Delivers clean JSON to Pydantic AI without backticks. |
| **Non-Streaming Tool Calls** | Preserve `choice.message.tool_calls` if present. Never overwrite with `undefined`. | Fixes tool-wipe bug in `transformLingResponse`. |
| **Streaming SSE** | **Pure Passthrough.** Native `delta.tool_calls` flow directly to OpenCode 2. No XML regex interception, zero buffering. | Zero TUI text leak, zero `"continue"` loops. |

---

## 3. 🛠️ Implementation Steps

### Phase 1: Nuance Code Registration
**Files**: `src/directive/parser.ts`, `src/config/schema.ts`

1. In `src/directive/parser.ts` line ~85:
   Add `"cn"` to `VALID_NUANCES`:
   ```typescript
   export const VALID_NUANCES = ["no", "dp", "ts", "gm", "g3", "sb", "tc", "lg", "cn"] as const;
   ```

2. In `src/config/schema.ts` line ~34:
   Add `"cn"` to `NuanceCodeSchema`:
   ```typescript
   export const NuanceCodeSchema = z.enum(["no", "dp", "ts", "gm", "g3", "sb", "tc", "lg", "cn"]);
   ```

---

### Phase 2: Request-Side Tool Passthrough & `response_format` Stripping
**File**: `src/transformers/payload.ts`

1. **Bypass Tool Hijacking when `cn` is active**:
   In `src/transformers/payload.ts` (lines 333–338), update `isLing`:
   ```typescript
   const isLing =
     (nuances.includes("lg") ||
       (Boolean(payload.model && payload.model.toLowerCase().includes("ling")) && !nuances.includes("tc") && !nuances.includes("no"))) &&
     !nuances.includes("cn"); // <--- cn BYPASSES XML TOOL HIJACKING
   ```

2. **Strip `response_format` when `cn` is active**:
   In `sanitizeAndTransformPayload()`:
   ```typescript
   let clientRequestedJson = false;
   if (nuances.includes("cn") && transformed.response_format) {
     const rf = transformed.response_format as { type?: string };
     if (rf.type === "json_object") {
       clientRequestedJson = true;
     }
     delete transformed.response_format;
   }
   ```
   Expose `clientRequestedJson` via context or metadata on `transformed` so the response handler knows the client requested structured output.

---

### Phase 3: Response-Side Native Tool Preservation & Fence Stripping
**Files**: `src/transformers/ling.ts`, `src/handlers/openai_compat.ts`

1. **Fix Native Tool Preservation Bug in `transformLingResponse`** (`src/transformers/ling.ts` lines 810–825):
   ```typescript
   // Check if upstream already provided native tool_calls
   const nativeToolCalls = choice.message.tool_calls;
   const hasNativeTools = Array.isArray(nativeToolCalls) && nativeToolCalls.length > 0;

   const { cleanText, toolCalls: xmlToolCalls, reasoningContent } = parseLingXml(rawText);

   const finalToolCalls = hasNativeTools
     ? nativeToolCalls
     : (xmlToolCalls.length > 0 ? (xmlToolCalls as OpenAIToolCall[]) : undefined);

   const finalFinishReason = finalToolCalls
     ? "tool_calls"
     : (choice.finish_reason || "stop");
   ```

2. **Add Lean Markdown Fence Stripper** (`src/transformers/ling.ts`):
   ```typescript
   export function stripJsonFencesAndExtract(text: string): string {
     let t = text.trim();
     if (t.startsWith("```")) {
       const nl = t.indexOf("\n");
       t = nl !== -1 ? t.slice(nl + 1) : t.replace(/^```(?:json)?/i, "").trim();
       if (t.endsWith("```")) {
         t = t.slice(0, -3).trim();
       }
     }
     const start = t.indexOf("{");
     const end = t.lastIndexOf("}");
     if (start !== -1 && end !== -1 && end > start) {
       return t.slice(start, end + 1);
     }
     return t.trim();
   }
   ```

3. **Wire into Non-Streaming Response Handler** (`src/handlers/openai_compat.ts`):
   When `directive.nuances.includes("cn")`:
   - If `clientRequestedJson` is `true` and `choice.message.content` is a string:
     ```typescript
     choice.message.content = stripJsonFencesAndExtract(choice.message.content);
     ```

4. **Streaming SSE Route** (`src/handlers/openai_compat.ts` lines 610–616):
   When `directive.nuances.includes("cn")`:
   - **Do NOT** pipe through `createLingStreamTransformer()`.
   - Native SSE chunks (`delta.tool_calls`, `delta.content`, `delta.reasoning_content`) stream directly to OpenCode 2.

---

## 4. 🧪 Verification & Acceptance Criteria

### 4.1 Unit Test Suite (`tests/unit/cn_nuance.test.ts`)
1. **Directive Parsing**: Verify `lr-or-oa-ch-cn` and `lr-or-oa-ch-cn+ts` parse valid directives with `nuances: ["cn"]`.
2. **Payload Bypass**: Verify `sanitizeAndTransformPayload` with model `inclusionai/ling-3.0-flash-fin:free` and nuance `cn` leaves `tools`, `tool_choice`, and `messages` 100% untouched.
3. **`response_format` Stripping**: Verify `response_format: {"type": "json_object"}` is deleted from outbound payload when nuance `cn` is set.
4. **Fence Stripping**:
   - ` ```json\n{"a": 1}\n``` ` $\to$ `{"a": 1}`
   - `Here is the data: ```json\n{"a": 1}\n``` Hope this helps!` $\to$ `{"a": 1}`
   - `{"a": 1}` (raw JSON) $\to$ `{"a": 1}`
   - `Just normal text` $\to$ `Just normal text` (unchanged)
5. **Tool Preservation**: Verify `transformLingResponse` with existing `tool_calls` preserves them and maintains `finish_reason: "tool_calls"`.

### 4.2 Integration Smoke Tests (Live Gateway)
1. **OpenCode 2 Agentic Tool Run**:
   - Directive: `lr-or-oa-ch-cn`
   - Model: `inclusionai/ling-3.0-flash-fin:free`
   - Action: Read file, edit file.
   - **Acceptance**: Zero `user <> o <tool_calls>` text on TUI; zero `"continue"` prompts; tools execute autonomously.
2. **Pydantic AI Structured Output Run**:
   - Directive: `lr-or-oa-ch-cn`
   - Client sends `response_format: {"type": "json_object"}`.
   - **Acceptance**: Upstream returns HTTP 200 (no 400 rejection); downstream receives parsed Pydantic object without `JSONDecodeError`.

---

## 5. 🛡️ Pre-Mortem & Risk Register

| Risk | Cause | Mitigation |
|---|---|---|
| **Conversational prose corrupted by fence stripper** | Fence stripper runs on regular chat turns | Fence stripper **only runs when `clientRequestedJson === true`**. Normal conversational turns are never touched. |
| **Model emits no JSON when `response_format` is stripped** | Model ignores prompt instructions | `stripJsonFencesAndExtract` returns original text if `{` / `}` are absent. Downstream Pydantic fails loudly with schema validation error rather than gateway masking it. |
| **Old models actually requiring XML break** | Legacy Ling or Dots models without native tool support | Nuances `lg` and `tc` remain intact for legacy models. `cn` is dedicated to native-capable models. |
| **TUI streaming latency regression** | Unnecessary buffering | In `cn` streaming, `createLingStreamTransformer` is bypassed completely. SSE frames are forwarded with 0ms buffering. |

---

## 6. 🔬 Live Empirical Gateway Verification: `lr-or-oa-ch-no`

> **Execution Date**: 2026-09-10  
> **Target Gateway**: LiteRouter on `http://localhost:7766/v1/chat/completions`  
> **Directive Key**: `lr-or-oa-ch-no`  
> **Model**: `inclusionai/ling-3.0-flash-fin:free` (OpenRouter / Novita backend)  
> **Raw Telemetry Artefact**: `/tmp/ling_no_streaming_probe_results.json`  

### 6.1 Test Methodology
A multi-turn streaming agentic session was simulated end-to-end through the running LiteRouter proxy on port 7766 to determine whether native OpenAI tool calling and streaming output work out-of-the-box without gateway hangs, premature closures, or XML leaks.

### 6.2 Empirical Results Summary

| Metric / Check | Turn 1 (Tool Call Generation) | Turn 2 (Tool Output Consumption) | Status |
|---|---|---|---|
| **HTTP Status** | `200 OK` | `200 OK` | ✅ PASS |
| **Time to First Token (TTFT)** | 981 ms | 709 ms | ✅ PASS (Fast) |
| **Total Duration** | 1,071 ms | 1,188 ms | ✅ PASS (No Stalls) |
| **Stream Events (SSE Chunks)** | 13 events / 11 raw chunks | 83 events | ✅ PASS |
| **Stream Hang / Stall Observed?** | ❌ **None** (0ms stall) | ❌ **None** (0ms stall) | ✅ PASS |
| **Tool Call Mechanism** | Native OpenAI `delta.tool_calls` | N/A (Summary generation) | ✅ PASS |
| **XML Leaks in `delta.content`?** | ❌ **Zero** (`<tool_call>`, `<tool_calls>`, `<invoke>` absent) | ❌ **Zero** | ✅ PASS |
| **Terminal `finish_reason`** | **`"tool_calls"`** | **`"stop"`** | ✅ PASS |

### 6.3 Detailed Turn-by-Turn Trace

#### Turn 1: Tool Invocation (`read_file`)
- **Client Prompt**: `"Please read the file /etc/hosts to check configured hostnames."` with tool `read_file(path: string)`.
- **Stream Behavior**:
  - SSE Frame 1: `delta: {"role": "assistant", "content": ""}`
  - SSE Frames 2-6: Natural text prefix: `"I'll read the /etc/hosts file for you right away."`
  - SSE Frames 7-10: Native OpenAI `tool_calls` chunks:
    ```json
    {
      "index": 0,
      "id": "call_2cdcec094b9d4503bef5e28d",
      "type": "function",
      "name": "read_file",
      "arguments": "{\"path\": \"/etc/hosts\"}"
    }
    ```
  - SSE Frame 11: `{"finish_reason": "tool_calls"}`
  - SSE Frame 12: `data: [DONE]`
- **TUI Impact**: In OpenCode 2, this triggers the autonomous tool execution loop immediately. The UI renders the tool widget `⚡ read_file(path: "/etc/hosts")`. OpenCode never prompts the user with `"continue"`.

#### Turn 2: Tool Output Ingestion & Markdown Table Synthesis
- **Client Payload**: Turn 1 history + assistant tool call + tool observation (`role: "tool"`, `tool_call_id: "call_2cdcec094b9d4503bef5e28d"`, `content: "127.0.0.1 localhost\n::1 localhost\n192.168.1.1 gateway"`).
- **Stream Behavior**:
  - Assistant accepted tool history cleanly (no schema rejection).
  - Streamed 83 SSE chunks assembling a complete Markdown summary table (519 characters) categorizing IPv4, IPv6 localhost, and gateway entries.
  - Final chunk: `{"finish_reason": "stop"}` followed by `data: [DONE]`.

### 6.4 Why `lr-or-oa-ch-no` Requires Zero Code Changes
In `src/transformers/payload.ts`:
```typescript
const isLing =
  nuances.includes("lg") ||
  (Boolean(payload.model && payload.model.toLowerCase().includes("ling")) && 
   !nuances.includes("tc") && 
   !nuances.includes("no"));

if (isLing) {
  currentPayload = transformLingRequest(currentPayload);
}
```
And in `src/handlers/openai_compat.ts`:
```typescript
const isLing =
  directive.nuances.includes("lg") ||
  (Boolean(activePayload.model && activePayload.model.toLowerCase().includes("ling")) &&
    !directive.nuances.includes("tc") &&
    !directive.nuances.includes("no"));

if (isResponses) {
  resilientStream = resilientStream.pipeThrough(createResponsesStreamTransformer(activePayload.model));
} else if (isLing) {
  resilientStream = resilientStream.pipeThrough(createLingStreamTransformer());
}
```

When using `lr-or-oa-ch-no`:
1. `!nuances.includes("no")` evaluates to `false`.
2. `transformLingRequest` is **completely bypassed**. Tools are never deleted; fake user messages are never injected.
3. `createLingStreamTransformer` is **completely bypassed**. LiteRouter acts as a zero-overhead raw byte SSE proxy.
4. OpenRouter/Novita streams native OpenAI `delta.tool_calls` directly to OpenCode 2 with 0ms buffering.

### 6.5 Runbook for Future Ling Invocations
If Ling is used and an issue occurs:
1. **OpenCode 2 Agentic Tool Calling**: Use directive key `lr-or-oa-ch-no`. Verified working end-to-end with zero hangs and native tool execution.
2. **Pydantic AI Batch Processing**: Keep handling clean fences in Python downstream (as in `baziforecaster/infrastructure/generators/branches/stages.py`), requesting text rather than `output_type=Model` to avoid Novita's `response_format` HTTP 400 rejection.
3. **If Future Code Normalization is Desired**: Refer to Sections 2 and 3 above to bake `cn` directly into LiteRouter so `-no` is not mandatory.

