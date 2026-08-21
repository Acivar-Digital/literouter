Short answer: **No — this is not production-ready for Claude Code**, especially if Claude Code is allowed to run tools, edit files, or execute shell commands.

It is a promising **happy-path Anthropic → OpenAI → Anthropic adapter**, but it has several gaps that can cause:

- invalid OpenAI requests,
- invalid Anthropic SSE events,
- silent loss of Anthropic semantics,
- truncated tool calls being reported as complete,
- broken streaming on provider quirks,
- secret leakage in logs,
- misleading success when upstream failed.

For a simple text-only chat demo, it may work.  
For **Claude Code as an agent**, I would not put this into production without a serious hardening pass.

One important caveat: the pasted file contains many odd spacing artifacts such as `"text "`, `"tool_calls "`, `& &`, `str ing`, `reasoning Tokens`, etc. If those are not just formatting artifacts and exist in the real source, those alone are **P0 blockers**.

---

## 1. Have we missed one-to-one mappings back and forth?

Yes. There are several important Anthropic ↔ OpenAI mappings that are missing, incomplete, or unsafe.

---

# A. Request mapping gaps: Anthropic → OpenAI

## 1. Unknown fields are passed through

Here:

```ts
const KNOWN_ANTHROPIC_KEYS = new Set([
  "model", "messages", "system", "max_tokens", "stream", "temperature",
  "top_p", "top_k", "stop_sequences", "metadata", "tools", "tool_choice", "thinking",
]);

for (const [key, value] of Object.entries(req)) {
  if (!KNOWN_ANTHROPIC_KEYS.has(key) && value !== undefined) {
    result[key] = value;
  }
}
```

This forwards **every unknown Anthropic request field** to the OpenAI-compatible endpoint.

That is dangerous.

Anthropic-specific fields like:

- `thinking`
- `anthropic_version`
- `anthropic_beta`
- `cache_control`
- `mcp_servers`
- `container`
- `service_tier`
- custom Claude Code fields
- future Anthropic fields

may be rejected or misinterpreted by an OpenAI-compatible server.

For production, the adapter should use a **whitelist**, not a blacklist.

Recommended:

```ts
const ALLOWED_OPENAI_REQUEST_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "stream_options",
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "stop",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "user",
  "metadata",
]);
```

Everything else should be dropped or explicitly rejected.

---

## 2. `thinking` is not handled safely

The request type includes:

```ts
readonly thinking?: unknown;
```

But `translateAnthropicToOpenAI()` does not map it.

If Claude Code sends:

```json
{
  "thinking": {
    "type": "enabled",
    "budget_tokens": 10000
  }
}
```

the current adapter silently drops it.

That is a semantic loss.

Worse, in the assistant history translation here:

```ts
function extractThinkingOrText(block: AnthropicContentBlock): string {
  if (block.type === "thinking") {
    return block.thinking || block.text || "";
  }

  if (block.type === "text" && block.text) {
    return block.text;
  }

  return "";
}
```

previous `thinking` blocks are merged into normal assistant text.

That is not ideal.

Internal reasoning can become visible assistant content, which may:

- leak chain-of-thought,
- confuse the model,
- change tool behavior,
- break the expected Anthropic conversation shape.

For production, choose one explicit policy:

### Option A — safest

If the target model does not support Anthropic-style thinking:

```ts
if (request.thinking?.type === "enabled") {
  return createAnthropicErrorResponse(
    400,
    "Extended thinking is not supported by this provider.",
    "invalid_request_error"
  );
}
```

Then drop thinking blocks from history.

### Option B — provider-specific reasoning

If the target OpenAI-compatible model supports something like:

```json
{
  "reasoning_content": "..."
}
```

or DeepSeek/Qwen-style reasoning fields, then build a provider-specific mapping.

But do not silently merge thinking into visible content.

---

## 3. `redacted_thinking` is dropped

The type includes:

```ts
"redacted_thinking"
```

But I do not see handling for it.

Anthropic `redacted_thinking` blocks are not reproducible by an OpenAI-compatible model.

You should not fake them.

Recommended behavior:

- drop them from history if the client can tolerate it, or
- reject the request if the client requires them.

Do not silently convert them to empty text without policy.

---

## 4. `system` mapping is lossy

Current logic:

```ts
function extractSystemString(system: unknown): string | null {
  if (typeof system === "string") return system;

  if (Array.isArray(system)) {
    return system
      .filter(...)
      .map((b) => b.text)
      .join("\n");
  }

  return null;
}
```

This is okay for basic text.

But Anthropic system blocks can include:

```json
{
  "type": "text",
  "text": "...",
  "cache_control": { "type": "ephemeral" }
}
```

The adapter drops:

- `cache_control`,
- block boundaries,
- possible future block metadata.

For Claude Code, prompt caching can matter a lot for cost and latency.

If the upstream OpenAI-compatible provider does not support Anthropic prompt caching, that is fine, but the loss should be explicit and observable.

Recommended:

- strip `cache_control` recursively,
- log a metric: `anthropic_cache_control_dropped_total`,
- optionally return a warning header if you control the client.

---

## 5. Document blocks are not mapped

The content block type includes:

```ts
"document"
```

But user content translation only handles:

```ts
"text"
"image"
"tool_result"
```

If Claude Code sends a PDF/document block, it is silently dropped.

That is dangerous for coding agents.

Example:

```json
{
  "type": "document",
  "source": {
    "type": "base64",
    "media_type": "application/pdf",
    "data": "..."
  }
}
```

Current behavior: model never sees the document.

Recommended:

- reject document blocks with a clear Anthropic error, or
- extract text server-side and convert to text, or
- map to a provider-specific file/document API if supported.

Do not silently drop.

---

## 6. Tool result content is lossy

Current logic:

```ts
function formatToolResultContent(content: unknown, isError?: boolean): string {
  ...
}
```

This converts tool result content to a string.

That is often necessary because OpenAI tool messages are usually string content.

But there are edge cases.

### Problem 1: tool result images

If a tool result contains:

```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/png",
    "data": "..."
  }
}
```

current code will likely `JSON.stringify()` it, producing a giant base64 blob inside the tool message.

That can:

- blow up token usage,
- exceed request limits,
- confuse the model,
- leak binary data as text.

Recommended:

- reject tool result images if unsupported, or
- convert to a placeholder:

```json
"[Unsupported tool result image omitted]"
```

or, if the provider supports multimodal tool messages, map properly.

---

### Problem 2: `is_error` is only represented by an `"Error: "` prefix

Current:

```ts
return isError ? `Error: ${resultText}` : resultText;
```

This may work sometimes, but it is lossy.

OpenAI tool messages do not have a standard `is_error` boolean.

For production, consider a structured convention:

```json
{
  "is_error": true,
  "content": "original tool output"
}
```

Then serialize as JSON string.

Example:

```ts
if (isError) {
  return JSON.stringify({
    is_error: true,
    content: resultText,
  });
}
```

This gives the model a stronger signal.

---

## 7. Tool result IDs can become invalid

Current:

```ts
tool_call_id: block.tool_use_id ?? block.id ?? "call_unknown",
```

If multiple tool results lack valid IDs, you can emit multiple OpenAI tool messages with:

```json
"tool_call_id": "call_unknown"
```

That can produce invalid conversations.

Recommended:

- validate that every `tool_result` references a previous assistant `tool_use` ID,
- if missing, reject or synthesize a stable ID only if you can also repair the assistant side.

---

## 8. Anthropic built-in tools may pass through unchanged

Tool translation only handles tools shaped like:

```ts
{
  name: string;
  input_schema: unknown;
}
```

Here:

```ts
function isAnthropicTool(tool: unknown): tool is {
  name: string;
  description?: string;
  input_schema: unknown;
} {
  ...
  return typeof t.name === "string" && "input_schema" in t;
}
```

If Anthropic/Claude Code sends a built-in or special tool such as:

- computer use tools,
- text editor tools,
- bash tools,
- web search tools,
- MCP-style tools,
- custom beta tools,

and they do not match that shape, this happens:

```ts
return tool;
```

The tool is passed through unchanged to OpenAI.

That will often cause a 400.

Recommended:

```ts
function translateSingleTool(tool: unknown) {
  if (isAnthropicFunctionTool(tool)) {
    return convertToOpenAIFunctionTool(tool);
  }

  throw new UnsupportedToolError(tool);
}
```

Then return a clean Anthropic error:

```json
{
  "type": "error",
  "error": {
    "type": "invalid_request_error",
    "message": "Tool type is not supported by this OpenAI-compatible provider."
  }
}
```

---

## 9. `tool_choice` mapping is mostly okay but incomplete

This mapping is reasonable:

```ts
auto -> auto
any -> required
none -> none
tool -> function
```

But production needs more validation.

You should validate:

- `tool_choice.name` exists in `tools`,
- provider supports `required`,
- provider supports `parallel_tool_calls`,
- provider supports named function choice.

Also, this only handles `disable_parallel_tool_use` if `tool_choice` is an object:

```ts
if (typeof req.tool_choice === "object" && req.tool_choice !== null) {
  const tc = req.tool_choice as Record<string, unknown>;
  if (tc.disable_parallel_tool_use) {
    result.parallel_tool_calls = false;
  }
}
```

If the client expresses parallel-tool restrictions elsewhere, you may miss it.

---

## 10. `max_tokens` mapping may break some providers

Current:

```ts
if (req.max_tokens !== undefined) {
  result.max_tokens = req.max_tokens;
  result.max_completion_tokens = req.max_tokens;
}
```

Some OpenAI-compatible providers accept only one of:

- `max_tokens`,
- `max_completion_tokens`,
- `max_output_tokens`.

Sending both may cause:

```json
{
  "error": {
    "message": "Unsupported parameter: max_tokens"
  }
}
```

Recommended:

Make this provider-specific.

Example capability config:

```ts
const providerCapabilities = {
  maxTokensField: "max_completion_tokens", // or "max_tokens"
  supportsStreamOptions: false,
  supportsParallelToolCalls: false,
  supportsDataUrlImages: true,
  supportsRemoteImageUrls: true,
};
```

Then translate accordingly.

---

## 11. `stream_options.include_usage` is forced

Current:

```ts
if (req.stream) {
  result.stream_options = { include_usage: true };
}
```

Many OpenAI-compatible servers do not support `stream_options`.

This can turn a normal streaming request into a 400.

Recommended:

Only include it if the provider supports it.

```ts
if (req.stream && provider.supportsStreamOptions) {
  result.stream_options = { include_usage: true };
}
```

If usage is unavailable, estimate tokens or report usage as unknown.

---

## 12. `top_k` is dropped silently

Anthropic supports:

```json
{
  "top_k": 40
}
```

OpenAI usually does not.

Current code knows `top_k` but does not map it.

That may be fine, but it should be explicit.

Recommended:

- drop silently if provider does not support it,
- map if provider supports `top_k`,
- log metric: `unsupported_parameter_dropped{param="top_k"}`.

---

## 13. Model mapping is missing

Current code passes the Anthropic request model straight through:

```ts
model: req.model
```

Claude Code may send something like:

```text
claude-sonnet-4-5
claude-opus-4-1
claude-3-5-sonnet-latest
```

Your OpenAI-compatible Chinese model probably expects a different model ID.

You need a model alias table.

Example:

```ts
const MODEL_MAP: Record<string, string> = {
  "claude-sonnet-4-5": "your-model-v1",
  "claude-3-5-sonnet-latest": "your-model-v1",
  "claude-opus-4-1": "your-model-v1",
};
```

Also validate unknown models:

```ts
const upstreamModel = MODEL_MAP[req.model];

if (!upstreamModel) {
  return createAnthropicErrorResponse(
    400,
    `Model ${req.model} is not supported by this gateway.`,
    "invalid_request_error"
  );
}
```

Without this, you will get confusing upstream 400/404 errors.

---

# B. Response mapping gaps: OpenAI → Anthropic

## 1. Empty choices produce an empty Anthropic message

Current:

```ts
const choices = (openAiRes.choices as Array<...>) || [];
const firstChoice = choices[0];
```

If `choices` is empty, the translator returns:

```json
{
  "type": "message",
  "role": "assistant",
  "content": [],
  "stop_reason": "end_turn"
}
```

That may be technically parseable, but it can confuse clients.

Recommended:

If there are no choices:

- return an Anthropic error, or
- return a synthetic empty text block:

```json
{
  "type": "text",
  "text": ""
}
```

Do not silently pretend success unless you know the client tolerates it.

---

## 2. OpenAI `message.content` may be an array

Current code only handles string content:

```ts
if (msg?.content && typeof msg.content === "string" && msg.content.length > 0) {
  contentBlocks.push({ type: "text", text: msg.content });
}
```

Some OpenAI-compatible providers return:

```json
{
  "message": {
    "content": [
      { "type": "text", "text": "..." }
    ]
  }
}
```

If that happens, the current adapter drops the content.

Recommended:

Normalize OpenAI content:

```ts
function extractOpenAIText(content: unknown): string {
  if (typeof content === "string") return content;

  if (Array.isArray(content)) {
    return content
      .filter(part => part?.type === "text" && typeof part.text === "string")
      .map(part => part.text)
      .join("");
  }

  return "";
}
```

---

## 3. `finish_reason: "length"` with tool calls is dangerous

Current:

```ts
export function mapOpenAIToAnthropicStopReason(
  finishReason?: string | null,
  hasToolUse = false
): string {
  if (hasToolUse || finishReason === "tool_calls" || finishReason === "function_call") {
    return "tool_use";
  }

  if (finishReason === "length") {
    return "max_tokens";
  }

  ...
}
```

Because `hasToolUse` is checked first, this can happen:

- upstream stops due to token limit,
- tool call arguments are truncated,
- adapter still returns `stop_reason: "tool_use"`.

Claude Code may then believe the tool call is complete.

That is unsafe.

Recommended:

If `finish_reason === "length"`, prefer:

```ts
return "max_tokens";
```

Even if tool calls exist.

Better:

- validate tool call JSON,
- if JSON is incomplete, drop the tool use block or return an error,
- do not emit `stop_reason: "tool_use"` for truncated tool calls.

This is one of the most important production safety fixes.

---

## 4. Invalid tool-call arguments are wrapped loosely

Current:

```ts
try {
  parsedInput = JSON.parse(tc.function.arguments);
} catch {
  parsedInput = { raw: tc.function.arguments };
}
```

This prevents crashes, but it can pass invalid tool input to Claude Code.

If a tool expects:

```json
{
  "command": "ls"
}
```

and receives:

```json
{
  "raw": "{\"command\":\"ls\""
}
```

that is a broken tool call.

Recommended:

For production agents, be stricter.

Options:

### Option A — reject incomplete tool calls

If `finish_reason === "length"` and tool JSON is invalid:

```json
{
  "stop_reason": "max_tokens",
  "content": []
}
```

or return an error.

### Option B — buffer streaming tool calls

Do not stream tool arguments directly. Accumulate them, validate final JSON, then emit the Anthropic `tool_use` block.

This is safer for Claude Code.

---

## 5. Usage mapping is incomplete

Current usage mapping:

```ts
input_tokens = prompt_tokens or input_tokens
output_tokens = completion_tokens or output_tokens
cache_read_input_tokens = prompt_tokens_details.cached_tokens
```

This is a good start.

But Anthropic usage can include more:

- `cache_creation_input_tokens`
- `cache_read_input_tokens`
- possible thinking/reasoning token details
- service tier or inference geo fields in newer APIs

If Claude Code or your monitoring relies on usage, incomplete usage can cause bad context management or inaccurate cost tracking.

Recommended:

Return a more complete Anthropic usage object:

```ts
{
  input_tokens,
  output_tokens,
  cache_read_input_tokens,
  cache_creation_input_tokens: 0,
}
```

If the upstream provides reasoning tokens, map them only if Anthropic schema supports it.

Also, if usage is missing, log a warning:

```text
usage_missing provider=... model=... stream=true
```

---

# C. Streaming mapping gaps

This is the riskiest area.

---

## 1. SSE parsing is too fragile

Current:

```ts
const lines = buffer.split("\n");
```

and:

```ts
if (!line.startsWith("data: ")) {
  return;
}
```

Problems:

- Some providers use `\r\n`.
- Some providers use `data:{...}` without a space.
- Some providers send SSE comments:

```text
: keep-alive
```

- Some providers send `event:` lines.
- Some providers send error events.
- Some providers send blank lines.
- Some providers send multiline SSE events.

Recommended parser behavior:

```ts
buffer += decoder.decode(chunk, { stream: true });
buffer = buffer.replace(/\r\n/g, "\n");

const lines = buffer.split("\n");
buffer = lines.pop() ?? "";

for (const rawLine of lines) {
  const line = rawLine.trim();

  if (!line) continue;
  if (line.startsWith(":")) continue;

  if (line.startsWith("data:")) {
    const data = line.slice(5).trim();
    processLine(data, controller);
  }
}
```

Also handle:

```ts
event: error
data: {"error": ...}
```

---

## 2. Stream can end without `message_start`

In `flush()`:

```ts
if (!state.messageDeltaSent) {
  ...
}
controller.enqueue(encoder.encode('event: message_stop...'));
```

But if no message was ever started, this can emit:

```text
event: message_delta
event: message_stop
```

without:

```text
event: message_start
```

That is invalid.

Recommended:

In `flush()`:

```ts
if (!state.msgStartSent) {
  ensureMessageStart({}, model, state, controller, encoder);
}
```

Or return an error if the upstream body was empty.

---

## 3. Stream errors are hidden

If the upstream returns HTTP 200 but the stream contains:

```json
{
  "error": {
    "message": "upstream failed"
  }
}
```

the current transformer may ignore it and eventually emit:

```text
event: message_stop
```

That makes the request look successful.

Recommended:

Detect OpenAI error objects:

```ts
if (parsed.error) {
  emitAnthropicStreamError(controller, parsed.error);
  return;
}
```

Emit:

```text
event: error
data: {
  "type": "error",
  "error": {
    "type": "api_error",
    "message": "..."
  }
}
```

Then stop cleanly.

---

## 4. Tool-call streaming state can emit deltas for closed blocks

Current tool state tracks:

```ts
activeToolMap
openBlockIndices
currentBlockType
```

But there is a subtle issue.

When a tool block is closed, `activeToolMap` still contains the tool.

If later argument fragments arrive for that tool index, this code may emit:

```text
event: content_block_delta
```

for a block that has already been closed.

That is invalid Anthropic streaming.

Recommended:

Use one of these safer strategies.

### Safer strategy A — buffer tool calls

For Claude Code, this is the safest.

Do not emit tool-use deltas immediately.

Instead:

1. Accumulate OpenAI tool-call fragments.
2. When stream finishes or tool call is known complete:
   - validate JSON,
   - emit `content_block_start`,
   - emit `input_json_delta`,
   - emit `content_block_stop`.

This reduces streaming granularity but greatly improves safety.

### Safer strategy B — keep tool blocks open

Maintain a proper block registry and do not close tool blocks until `finish_reason`.

But this is harder to get right.

For production Claude Code, I prefer buffering tool calls.

---

## 5. Tool-call IDs can be emitted too early

Current:

```ts
const toolId = tc.id || `call_${Math.random()...}`;
```

If the first tool delta has no ID, you generate a random ID.

If the real OpenAI ID arrives later, you cannot change the already-emitted Anthropic `tool_use` ID.

That can break tool result linkage.

Recommended:

Delay `content_block_start` until both:

- tool ID,
- tool name

are known.

If the provider cannot provide them reliably, buffer the whole tool call.

---

## 6. JSON escaping is unsafe in manually built SSE events

Current code uses template strings:

```ts
`...{"id":"${msgId}",...}`
```

and:

```ts
`..."id":"${toolId}","name":"${toolName}"...`
```

If `model`, `toolId`, or `toolName` contains:

- `"`,
- `\`,
- newline,
- control characters,

the emitted JSON can become invalid.

Recommended:

Never manually interpolate into JSON.

Use a helper:

```ts
function sseEvent(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
```

Then:

```ts
controller.enqueue(
  sseEvent("message_start", {
    type: "message_start",
    message: {
      id: msgId,
      type: "message",
      role: "assistant",
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: state.accumulatedInputTokens,
        output_tokens: 0,
      },
    },
  })
);
```

This is a P0 streaming fix.

---

## 7. `message_start` usage is often wrong

Current:

```ts
"usage":{"input_tokens":${state.accumulatedInputTokens},"output_tokens":0}
```

But OpenAI-compatible streaming usually provides usage only at the end.

So `message_start` often emits:

```json
"input_tokens": 0
```

This may not break the client, but it makes usage inaccurate.

Recommended:

- accept that input usage may be late,
- document the limitation,
- if possible, emit a corrected final usage event if Anthropic schema allows,
- otherwise log and expose usage in metrics.

Do not silently trust zero usage.

---

## 8. Truncated stream looks like success

If the upstream disconnects halfway, the transformer `flush()` may still emit:

```text
event: message_delta
event: message_stop
```

That can make Claude Code think the response completed.

Recommended:

Track whether a valid `finish_reason` was seen.

If not:

```ts
state.incomplete = true;
```

Then in flush:

```ts
if (!state.sawFinishReason) {
  emitAnthropicStreamError(controller, {
    type: "api_error",
    message: "Upstream stream ended without finish_reason.",
  });
  return;
}
```

For an agent, this matters a lot.

---

# D. Error mapping gaps

## 1. Upstream error types are not normalized

Current:

```ts
const errType = typeof errObj.type === "string" ? errObj.type : "api_error";
return createAnthropicErrorResponse(openAiRes.status, errMsg, errType);
```

OpenAI-compatible providers may return types like:

- `invalid_request_error`
- `authentication_error`
- `rate_limit_error`
- `server_error`
- `insufficient_quota`
- `context_length_exceeded`
- custom provider strings

Anthropic expects a more specific error shape.

Recommended mapping:

| Upstream status / type | Anthropic type |
|---|---|
| 400 invalid request | `invalid_request_error` |
| 401 | `authentication_error` |
| 403 | `permission_error` |
| 404 | `not_found_error` |
| 413 | `invalid_request_error` or `request_too_large` if supported |
| 429 | `rate_limit_error` |
| 500 | `api_error` |
| 503/529 | `overloaded_error` or `api_error` |
| context length | `invalid_request_error` with clear message |

Also propagate safe headers:

- `Retry-After`
- rate-limit headers, if appropriate.

---

## 2. Streaming HTTP 200 errors are not mapped

Already mentioned, but worth repeating:

If upstream returns 200 and then an error event/data, the adapter must emit an Anthropic `error` event.

Do not end with normal `message_stop`.

---

# E. Conversation-state mapping gaps

## 1. Consecutive same-role messages are not normalized

Anthropic conversations may contain consecutive user or assistant messages depending on history/repair.

Some OpenAI-compatible providers expect alternating roles.

Current adapter does not merge or normalize.

Recommended:

```ts
user, user -> merge into one user message
assistant, assistant -> merge into one assistant message
```

Or reject if semantically unsafe.

---

## 2. Orphan tool messages can be produced

If a `tool_result` appears without a previous assistant `tool_use`, current code can emit:

```json
{
  "role": "tool",
  "tool_call_id": "..."
}
```

OpenAI may reject that.

Recommended:

Validate the tool-call graph:

- every `tool_result.tool_use_id` must match a previous assistant `tool_use.id`,
- every assistant `tool_use` should have a corresponding tool result before continuing, if required by the provider.

If invalid:

- repair if safe,
- otherwise reject with a clear error.

---

## 3. Empty messages can be dropped or malformed

If a user message contains only unsupported blocks, current translation may push no user message.

That can change the conversation structure.

Recommended:

If a message becomes empty after translation:

- return an error, or
- insert placeholder text:

```text
[Unsupported content omitted]
```

Do not silently drop whole turns.

---

# 2. Have we considered edge cases?

Partially, but not enough for production.

Here are the major edge cases that need handling.

---

## Edge case 1: Truncated tool JSON

Already discussed, but this is critical.

If OpenAI returns:

```json
{
  "finish_reason": "length",
  "tool_calls": [
    {
      "function": {
        "name": "run_command",
        "arguments": "{\"command\":\"rm -rf /tmp/te"
      }
    }
  ]
}
```

current logic may still produce:

```json
"stop_reason": "tool_use"
```

That can cause Claude Code to execute incomplete or wrong tool input.

Required fix:

```ts
if (finishReason === "length") {
  return "max_tokens";
}
```

And validate tool JSON before exposing tool use.

---

## Edge case 2: Provider does not support `stream_options`

Current code always sends:

```json
"stream_options": {
  "include_usage": true
}
```

This can cause 400s.

Required fix:

Capability-gate it.

---

## Edge case 3: Provider does not support both `max_tokens` and `max_completion_tokens`

Required fix:

Use provider capability config.

---

## Edge case 4: Provider returns SSE without a space after `data:`

Current parser expects:

```text
data: {...}
```

Some providers send:

```text
data:{...}
```

Required fix:

Support both.

---

## Edge case 5: Provider returns `\r\n`

Required fix:

Normalize line endings.

---

## Edge case 6: Provider returns empty stream

Current flush may emit invalid final events.

Required fix:

Emit error or synthesize valid empty message.

---

## Edge case 7: Provider returns JSON error with HTTP 200

Required fix:

Detect and map to Anthropic error.

---

## Edge case 8: Client aborts mid-stream

The code has some abort handling in direct path, but the conversion stream should also handle aborts cleanly.

Required behavior:

- do not log aborted requests as successful,
- do not emit misleading `message_stop`,
- close stream gracefully.

---

## Edge case 9: Large base64 images

The adapter does not check image size.

Large images can:

- exceed upstream body limits,
- blow up tokens,
- cause timeouts.

Required fix:

- enforce max base64 size,
- enforce max image count,
- return Anthropic `invalid_request_error` if too large.

---

## Edge case 10: Image URL SSRF / data exfiltration

If users can provide image URLs, the upstream may fetch them.

This can become an SSRF or data-exfiltration vector if the provider fetches arbitrary URLs.

Required fix:

- allowlist domains,
- block localhost/internal/private IPs,
- optionally proxy and scan images.

---

## Edge case 11: Tool names or IDs contain special characters

Manual JSON template strings can break.

Required fix:

Use `JSON.stringify()` for all SSE payloads.

---

## Edge case 12: Multiple tool calls with missing indices

Current code defaults missing tool index to `0`:

```ts
const tcIdx = typeof tc.index === "number" ? tc.index : 0;
```

If provider omits indices for multiple tool calls, they can collide.

Required fix:

- require index,
- or buffer and infer safely,
- or reject malformed tool-call streams.

---

## Edge case 13: OpenAI returns content as an array

Already covered.

Required fix:

Normalize.

---

## Edge case 14: Non-stream response is not JSON

Current:

```ts
const json = await openAiRes.json();
```

If body is not JSON, this throws.

Required fix:

```ts
try {
  const json = await openAiRes.json();
} catch {
  return createAnthropicErrorResponse(502, "Upstream returned non-JSON response.", "api_error");
}
```

---

## Edge case 15: Model returns no content and no tool calls

Required fix:

Return valid empty Anthropic message or explicit error.

Do not leave client guessing.

---

# 3. What else have we not considered?

Beyond field mapping, there are several production-level concerns.

---

## 1. Claude Code is an agent, not just a chat client

Claude Code can use tools to modify files and execute commands.

That means translation bugs are not just cosmetic.

A bad tool-call mapping can cause:

- wrong shell commands,
- destructive file edits,
- leaked secrets,
- repeated retries,
- runaway cost,
- security incidents.

So the correctness bar is much higher than for normal chat.

---

## 2. Tool-call safety requires sandboxing

Even if the adapter is perfect, the target model may still produce dangerous tool calls.

You need:

- sandboxed execution,
- command allowlists,
- file path restrictions,
- human approval for destructive operations,
- max execution time,
- max spend,
- audit logs.

The conversion layer alone does not make this safe.

---

## 3. Secret leakage in logs

Current code appears to log the raw directive/key:

```ts
logInbound({
  ...
  directiveStr: rawKey,
  ...
});
```

If `rawKey` contains credentials or routing secrets, this is a serious issue.

Required fix:

Never log full credentials.

Log only:

```ts
keyFingerprint: sha256(rawKey).slice(0, 8)
```

or:

```ts
keySuffix: last 4 chars
```

Also ensure request/response bodies are not logged by default.

---

## 4. Incoming `Authorization` header is not deleted

You delete:

```ts
cleanHeaders.delete("x-api-key");
```

But you should also delete:

```ts
cleanHeaders.delete("authorization");
```

Otherwise the client’s original Authorization header may be forwarded unintentionally.

Recommended:

```ts
const cleanHeaders = new Headers(req.headers);

cleanHeaders.delete("authorization");
cleanHeaders.delete("x-api-key");
cleanHeaders.delete("anthropic-version");
cleanHeaders.delete("anthropic-beta");
cleanHeaders.delete("content-length");

cleanHeaders.set("Content-Type", "application/json");
```

---

## 5. Provider capability matrix is missing

You need a formal capability matrix per provider/model.

Example:

```ts
interface ProviderCapabilities {
  supportsTools: boolean;
  supportsParallelToolCalls: boolean;
  supportsStreamOptions: boolean;
  supportsVision: boolean;
  supportsDataUrlImages: boolean;
  supportsRemoteImageUrls: boolean;
  supportsDocuments: boolean;
  supportsReasoning: boolean;
  maxTokensField: "max_tokens" | "max_completion_tokens" | "max_output_tokens";
  supportsUsageInStream: boolean;
  supportsToolChoiceRequired: boolean;
  supportsNamedToolChoice: boolean;
  maxImageCount: number;
  maxBase64ImageBytes: number;
  maxContextTokens: number;
  maxOutputTokens: number;
}
```

Without this, you will keep hitting provider-specific failures in production.

---

## 6. Prompt caching semantics are lost

Claude Code may send `cache_control` heavily.

If your upstream does not support Anthropic prompt caching, cost may be much higher than expected.

You should:

- strip cache_control cleanly,
- measure token usage,
- warn operators,
- possibly implement your own semantic cache if appropriate.

---

## 7. Extended thinking policy is missing

This deserves its own product decision.

You need to answer:

- Does Claude Code require thinking?
- Does the target model support reasoning?
- Should thinking be disabled?
- Should thinking requests be rejected?
- Should reasoning be mapped to provider-specific fields?
- Should thinking blocks be dropped from history?

Do not leave this implicit.

---

## 8. Token counting and context management

Claude Code may rely on token accounting.

If your adapter returns missing or zero usage, Claude Code may:

- mismanage context,
- exceed limits,
- truncate poorly,
- retry unnecessarily.

If Claude Code calls auxiliary endpoints such as:

- `/v1/models`
- `/v1/messages/count_tokens`
- beta endpoints

you need to support or safely stub them.

If unsupported, return clean errors.

---

## 9. Retries can corrupt streams

Your codebase has retry/circuit-breaker/pacer infrastructure.

That is good.

But for streaming adapters, retries are dangerous.

If the upstream fails after partial tokens have already been transformed and sent downstream, you cannot simply retry and continue as if nothing happened.

Possible issues:

- duplicate text,
- reset block indices,
- inconsistent usage,
- invalid SSE sequence.

Required policy:

- disable retries after first content token, or
- reset adapter state completely and only retry if nothing was emitted, or
- return an error instead of retrying mid-stream.

---

## 10. Observability is incomplete

For production, add metrics:

```text
anthropic_requests_total
anthropic_requests_failed_total
openai_requests_total
openai_requests_failed_total
stream_parse_error_total
unsupported_content_block_total
unsupported_tool_total
tool_call_truncated_total
tool_call_invalid_json_total
usage_missing_total
model_mapping_miss_total
provider_error_total{status}
ttft_ms
total_duration_ms
tokens_input
tokens_output
```

Also log structured events without secrets.

---

## 11. Legal / policy / data privacy

You mentioned the model is a Chinese model distilled from Anthropic.

From a production governance perspective, consider:

- Does sending code/data to this endpoint violate your company policy?
- Does the model provider retain prompts?
- Where is data processed?
- Does distillation from Anthropic create licensing or ToS risk?
- Are you allowed to present the model as Claude-compatible?

This is not a code issue, but it is a production issue.

---

# Recommended solution

I would not patch this ad hoc. I would restructure the adapter into a strict gateway.

---

## Phase 0 — Immediate blockers

Fix these before anything else.

### P0-1: Fix syntax/format artifacts

If these are real:

```ts
"text "
"tool_calls "
& &
str ing
reasoning Tokens
```

fix them immediately.

Run:

```bash
tsc --noEmit
eslint
prettier
```

Add CI.

---

### P0-2: Stop passing unknown request fields

Use a whitelist.

Do not forward arbitrary Anthropic fields to OpenAI.

---

### P0-3: Validate inbound Anthropic request

Use a runtime schema validator such as Zod.

Validate:

- `model`
- `messages`
- `max_tokens`
- `stream`
- `system`
- `tools`
- `tool_choice`
- content block types

Reject unsupported request shapes with clean Anthropic errors.

---

### P0-4: Add model aliasing

Do not pass Claude model names directly unless the upstream truly understands them.

---

### P0-5: Make SSE emission JSON-safe

Replace all template-string JSON with `JSON.stringify()`.

Example:

```ts
function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
```

---

### P0-6: Make SSE parsing robust

Support:

- `data: {...}`
- `data:{...}`
- `\n`
- `\r\n`
- blank lines
- comment lines
- error events

---

### P0-7: Do not report truncated tool calls as complete

If:

```text
finish_reason === "length"
```

then stop reason should generally be:

```text
max_tokens
```

Do not emit `tool_use` unless tool call is complete and valid.

---

### P0-8: Handle empty streams and missing finish reason

If stream ends without valid finish reason, emit an error event instead of normal `message_stop`.

---

### P0-9: Redact secrets from logs

Do not log:

- raw keys,
- Authorization headers,
- full request bodies,
- full response bodies.

---

### P0-10: Delete incoming Authorization header

Before creating synthetic OpenAI request:

```ts
cleanHeaders.delete("authorization");
cleanHeaders.delete("x-api-key");
```

---

## Phase 1 — Production hardening

### P1-1: Introduce provider capabilities

Create a config object per provider/model.

Example:

```ts
const capabilities = {
  supportsStreamOptions: false,
  supportsParallelToolCalls: false,
  maxTokensField: "max_completion_tokens",
  supportsVision: true,
  supportsDataUrlImages: false,
  supportsRemoteImageUrls: true,
};
```

Then adapt translation dynamically.

---

### P1-2: Define unsupported-feature policy

For each unsupported feature, decide:

- reject,
- degrade,
- drop,
- warn.

Example:

```ts
thinking -> reject
document -> reject
tool_result image -> reject or placeholder
cache_control -> drop + metric
top_k -> drop + metric
```

Do not silently drop semantically important fields.

---

### P1-3: Normalize conversation state

Before translation:

- merge consecutive same-role messages if required,
- validate tool_use/tool_result pairing,
- remove orphan tool results,
- ensure no empty messages,
- ensure first message role is acceptable to provider.

---

### P1-4: Buffer tool calls for safety

For Claude Code, I strongly recommend buffering tool-call arguments.

Flow:

1. Receive OpenAI tool-call deltas.
2. Accumulate by tool index.
3. Wait until finish.
4. Parse final JSON.
5. If valid:
   - emit Anthropic tool_use blocks.
6. If invalid:
   - do not emit tool_use,
   - emit `stop_reason: max_tokens` or error.

This loses some streaming granularity but greatly increases safety.

---

### P1-5: Improve error mapping

Map upstream errors to Anthropic error types.

Also propagate:

- `Retry-After`,
- provider request ID,
- safe rate-limit headers.

---

### P1-6: Add usage fallbacks

If upstream usage is missing:

- log,
- estimate with tokenizer if available,
- avoid silently reporting zero.

---

### P1-7: Add request/response conformance tests

Create golden tests for:

- simple text non-stream,
- simple text stream,
- tool call non-stream,
- tool call stream,
- parallel tool calls,
- tool result,
- tool result error,
- image input,
- unsupported document input,
- empty stream,
- upstream 400,
- upstream 429,
- upstream 500,
- stream error after HTTP 200,
- client abort,
- truncated tool JSON,
- model aliasing,
- missing usage.

---

## Phase 2 — Claude Code-specific acceptance tests

Run Claude Code against the gateway in a sandbox.

Test real tasks:

1. Read a file.
2. Edit a file.
3. Run a harmless shell command.
4. Handle a failing command.
5. Handle large repository context.
6. Handle prompt caching headers.
7. Handle aborted requests.
8. Handle rate limits.
9. Handle tool result errors.
10. Handle context overflow.

Measure:

- task success rate,
- invalid tool calls,
- retries,
- cost,
- latency,
- stream errors,
- context truncation behavior.

Do not enable destructive tools until this passes.

---

# Production go/no-go recommendation

## Current state

I would rate this as:

**Prototype / alpha adapter**

It is not safe for production Claude Code.

---

## Allowed after P0 fixes?

Only for:

- internal testing,
- non-destructive tools,
- sandboxed environment,
- low traffic,
- human-reviewed usage.

---

## Allowed for production Claude Code?

Not yet.

Minimum requirements before production:

- P0 fixes complete,
- P1 fixes complete,
- tool-call buffering/validation implemented,
- streaming error handling implemented,
- provider capability matrix implemented,
- secret redaction implemented,
- Claude Code integration tests pass,
- sandboxed agent evaluation passes,
- cost/usage telemetry verified.

---

# Minimal production-safe behavior policy

If I were designing this gateway, the default policy would be:

```text
Supported:
- text user/assistant messages
- system text
- OpenAI-style function tools
- tool_result text
- streaming text
- non-stream responses
- model aliasing
- strict error mapping

Not supported unless explicitly enabled:
- images
- documents
- thinking
- redacted_thinking
- built-in Anthropic tools
- prompt caching semantics
- arbitrary unknown fields
```

For unsupported features, return clear errors instead of silently dropping them.

---

# Final answer

### 1. Have we missed one-to-one mapping, back and forth?

Yes. Major gaps include:

- thinking / redacted_thinking,
- documents,
- tool result images,
- cache_control,
- built-in tools,
- model aliasing,
- provider-specific max token fields,
- stream_options compatibility,
- empty choices,
- array OpenAI content,
- truncated tool calls,
- incomplete streaming usage,
- SSE error events.

---

### 2. Have we considered edge cases?

Partially, but not enough.

Critical missing edge cases:

- truncated tool JSON,
- empty streams,
- malformed SSE,
- HTTP 200 stream errors,
- missing finish_reason,
- orphan tool messages,
- unsupported content blocks,
- large images,
- provider-specific parameter rejection,
- client aborts,
- retry after partial stream.

---

### 3. What else have we not considered?

Production concerns beyond translation:

- secret leakage in logs,
- Authorization header forwarding,
- Claude Code tool-execution safety,
- sandboxing,
- prompt injection,
- cost explosion from lost caching,
- provider capability matrix,
- legal/data privacy issues,
- observability,
- conformance testing,
- retries corrupting streams.

---

## Bottom line

**No, it is not ready for production.**

The solution is to turn this from a happy-path translator into a **strict, capability-aware Anthropic-to-OpenAI gateway** with:

1. runtime validation,
2. explicit unsupported-feature handling,
3. JSON-safe streaming,
4. robust SSE parsing,
5. tool-call buffering/validation,
6. provider capability config,
7. secret-safe logging,
8. extensive Claude Code sandbox tests.