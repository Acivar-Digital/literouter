---
name: literouter-troubleshooting
description: Guide for understanding LiteRouter architecture, ACP protocol translation, key rotation, and how to troubleshoot stream or Zod validation errors. Trigger when debugging LiteRouter proxy errors, editing main.py, or modifying stream pipelines.
---

# LiteRouter Architecture & Troubleshooting Guide

LiteRouter acts as a high-performance proxy translating modern AI SDK requests (like the Agentic Communication Protocol / OpenCode) into standard upstream provider calls (OpenRouter, Nvidia, Anthropic).

## ⚠️ 1. THE MANDATORY SDK REQUIREMENT: `@ai-sdk/openai-compatible` ⚠️

**DO NOT use `@ai-sdk/openai` in your OpenCode configuration (`opencode.json`) for LiteRouter endpoints. You MUST use `@ai-sdk/openai-compatible` instead.**

### The Protocol Mismatch Root Cause
1. **The Endpoint Mismatch**: `@ai-sdk/openai` uses the modern `/v1/responses` (Agentic Communication Protocol / ACP) endpoint by default. However, upstream providers like OpenRouter and Nvidia only accept standard OpenAI ChatCompletions (`/v1/chat/completions`).
2. **Fragile Protocol Translation**: LiteRouter contains an endpoint mapping layer to translate `/v1/responses` ↔ `/v1/chat/completions`, but this translation layer is extremely fragile and prone to failure:
   - **Tool Call Failures**: Upstream models (like `owl-alpha`) emitting `finish_reason: "tool_calls"` had their structured tool outputs dropped or malformed by the ACP translator, leading to client-side `ZodValidationError` errors ("expected object, received undefined").
   - **Stream Corruption**: Attempting to inject missing ACP structures/tokens into the SSE stream often broke the `\n\n` event delimiters, resulting in consecutive events fusing and throwing JSON Parse errors.
3. **The Simple Solution**: By switching the provider npm package in `opencode.json` to `@ai-sdk/openai-compatible`, the client communicates natively via standard `/v1/chat/completions`. LiteRouter then behaves as a pure rotating proxy (only swapping authorization headers and forwarding bytes), completely bypassing the fragile protocol translation code.

---

## 2. Key Architecture & Flow
- **Entrypoints (`src/main.py`)**: 
  - `/v1/chat/completions` (Standard OpenAI)
  - `/v1/responses` (ACP Protocol used by modern agents - **avoid where possible by using the compatible SDK**)
- **Routing Logic (`config.py` & `main.py`)**: Checks the requested `model` string to determine the provider (e.g., `nemo` -> Nvidia, others -> OpenRouter).
- **Concurrency & Key Rotation**: Uses `KeyRotator` to cycle through available API keys per provider. **CRITICAL**: Each provider uses an isolated `asyncio.Lock` (`self.locks = defaultdict(asyncio.Lock)`) to ensure that rate-limit delays or upstream hangs in one provider (e.g., OpenRouter) do not stall queues for another (e.g., Nvidia).
- **Sanitization**: Standardizes `input_text` blocks to standard `text` blocks.

---

## 3. Streaming & The ACP Protocol (`/v1/responses`)
If you MUST use `/v1/responses`, the ACP protocol requires a highly specific lifecycle for Server-Sent Events (SSE). It expects the full structural tree to be built event by event.

### The ACP Event Lifecycle (Mandatory Order)
1. `response.created`: Signals the response has started.
2. `response.output_item.added`: Announces the parent message block with a consistent `item_id`.
3. `response.content_part.added`: Announces the text part inside the parent message.
4. `response.output_text.delta`: Streams the actual token content using the consistent `item_id`.
5. `response.output_text.done`: Finalizes the text part with the fully accumulated text.
6. `response.content_part.done`: Finalizes the content part.
7. `response.output_item.done`: Finalizes the message block.
8. `response.completed`: Closes the overall stream.

### Streaming Pipeline Rules
- **Line-Buffering Only**: We stream bytes from the upstream provider and use `codecs.getincrementaldecoder("utf-8")()` to buffer by `\n`. We **never** perform string replacements directly on arbitrary byte chunks, as chunks can split valid JSON or UTF-8 characters.
- **Empty Line Preservation**: SSE events are delimited by `\n\n`. We must **never** suppress empty strings (`""`) in our streaming generators because that deletes the SSE delimiters, causing consecutive events to concatenate (e.g. `data: {...}data: {...}`) and triggering catastrophic `JSON parse errors` on the client.
- **Explicit Skips**: The sanitizer function `_fix_streaming_line` returns `None` to explicitly signal "skip this line entirely", and `""` to signal "preserve this empty line delimiter".
- **Self-Terminating Events**: When yielding translated ACP events, ensure the string ends with `\n\n` (e.g. `yield f"event: response.output_text.delta\ndata: {data}\n\n"`) to guarantee clean separation.

---

## 4. Failed Workaround Approaches & Why They Failed
During the attempt to make `/v1/responses` translation work with `owl-alpha`'s tool calls, the following workarounds were tried and abandoned:
1. **ACP function_call emission**: We accumulated tool call deltas and emitted them as `response.output_item.added` / `response.output_item.done` with `type: "function_call"`. While this worked in curl tests, OpenCode's client-side SDK rejected it with `ZodValidationError` ("expected object, received undefined"). **Reason for Failure**: Strict Zod schema constraints in the SDK were not satisfied by the translated payload.
2. **Tagged string delta parsing**: Attempted to prefix tool deltas with `__TOOL_CALL_DELTA__:` in the stream parser. **Reason for Failure**: Splitting multi-line outputs on `\n` broke the `\n\n` delimiter structure of the SSE stream, leading to JSON Parse errors because of fused packets.
3. **Protocol translation in general**: Trying to parse and rebuild state streams in flight is a losing battle because any difference in stream sequence or formatting triggers client-side validation errors.

---

## 5. Common Failure Modes & Where to Check

### Error: `AI_TypeValidationError` or `ZodValidationError`
- **Cause**: The stream yielded an event that does not match the strict schema.
- **Fix**: Use `@ai-sdk/openai-compatible` in OpenCode so the client uses standard chat completions instead of the ACP endpoint.

### Error: `"text part ... not found"`
- **Cause**: The server sent `response.output_text.delta` events without first announcing the item and content part.
- **Fix**: Ensure the generator yields `output_item.added` and `content_part.added` immediately after `response.created`.

### Error: `JSON Parse error: Unable to parse JSON string`
- **Cause**: The SSE delimiters (`\n\n`) were lost, causing consecutive `data: {...}` blocks to fuse together.
- **Fix**: Ensure the generator isn't doing truthiness checks like `if processed:` that accidentally drop `""` (empty strings). Check `if processed is not None:`.

### Error: Upstream `400 Bad Request` / `"Provider returned error"` on multi-turn
- **Cause**: ACP (Responses API) input arrays can contain `function_call` and `function_call_output` items that are **not** valid ChatCompletions messages — they have `type` and `call_id` fields but **no `role` key**. Upstream providers (OpenRouter, Nvidia) reject these with 400.
- **Fix**: The sanitizer in `src/main.py` converts these to proper OpenAI format, but the real fix is using `@ai-sdk/openai-compatible`.

---

## 6. Debugging Toolkit
- **Logs**: `logs/literouter.log` (if running via `nohup`) or the active uvicorn task log.
- **Test `/v1/responses` directly**:
  ```bash
  curl -s -N http://localhost:7766/v1/responses \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <your-key>" \
    -d '{"model": "openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "input": [{"role": "user", "content": [{"type": "text", "text": "hi"}]}], "stream": true}'
  ```

---

## 7. Routing New Models (e.g., OpenRouter)
When you need to add a new model (like `openrouter/owl-alpha` or any other OpenRouter model) so that it routes through LiteRouter in OpenCode:
1. Open the OpenCode configuration at `~/.config/opencode/opencode.json`.
2. Locate the provider block for either `literouter` or `openrouter` (both map to `http://localhost:7766/v1` via `@ai-sdk/openai-compatible`).
3. Add the precise upstream model ID into the `models` dictionary.
   ```json
   "openrouter": {
       "npm": "@ai-sdk/openai-compatible",
       "options": {
           "baseURL": "http://localhost:7766/v1",
           "apiKey": "sk-lr-8f2a9e3b1c4d7e5f"
       },
       "models": {
           "openrouter/owl-alpha": {
               "name": "Owl Alpha"
           }
       }
   }
   ```
4. LiteRouter's internal `_get_routing()` logic will check if the model name contains routing hints (like `nemo` -> Nvidia) and otherwise defaults to OpenRouter.
