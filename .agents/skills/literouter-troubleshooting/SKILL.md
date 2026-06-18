---
name: literouter-troubleshooting
description: Guide for understanding LiteRouter architecture, ACP protocol translation, key rotation, and how to troubleshoot stream or Zod validation errors. Trigger when debugging LiteRouter proxy errors, editing main.py, or modifying stream pipelines.
---

# LiteRouter Architecture & Troubleshooting Guide

LiteRouter acts as a high-performance proxy translating modern AI SDK requests (like the Agentic Communication Protocol / OpenCode) into standard upstream provider calls (OpenRouter, Nvidia, Anthropic).

## 1. Key Architecture & Flow
- **Entrypoints (`src/main.py`)**: 
  - `/v1/chat/completions` (Standard OpenAI)
  - `/v1/responses` (ACP Protocol used by modern agents)
- **Routing Logic (`config.py` & `main.py`)**: Checks the requested `model` string to determine the provider (e.g., `nemo` -> Nvidia, others -> OpenRouter).
- **Concurrency & Key Rotation**: Uses `KeyRotator` to cycle through available API keys per provider. **CRITICAL**: Each provider uses an isolated `asyncio.Lock` (`self.locks = defaultdict(asyncio.Lock)`) to ensure that rate-limit delays or upstream hangs in one provider (e.g., OpenRouter) do not stall queues for another (e.g., Nvidia).
- **Sanitization**: Standardizes `input_text` blocks to standard `text` blocks.

## 2. Streaming & The ACP Protocol (`/v1/responses`)
The ACP protocol requires a highly specific lifecycle for Server-Sent Events (SSE). It expects the full structural tree to be built event by event.

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

## 3. Common Failure Modes & Where to Check

### Error: `AI_TypeValidationError` or `ZodValidationError`
- **Cause**: The stream yielded an event that does not match the strict schema.
- **Where to look**: Check the uvicorn server logs (`tail -n 50 logs/literouter.log` or your task log) for Python exceptions.
- **Known Trap (Shadowed Imports)**: If a python exception occurs during the stream (e.g., `UnboundLocalError`), check if you placed an `import json` inside an error block of the generator function. Python scoping rules treat `import X` inside a function as making `X` local to the *entire* function scope, breaking execution in the happy path before the import is reached.

### Error: `"text part ... not found"`
- **Cause**: The server sent `response.output_text.delta` events without first announcing the item and content part.
- **Fix**: Ensure the generator yields `output_item.added` and `content_part.added` immediately after `response.created`.

### Error: `JSON Parse error: Unable to parse JSON string`
- **Cause**: The SSE delimiters (`\n\n`) were lost, causing consecutive `data: {...}` blocks to fuse together.
- **Fix**: Ensure the generator isn't doing truthiness checks like `if processed:` that accidentally drop `""` (empty strings). Check `if processed is not None:`.

### Error: Upstream `400 Bad Request` / `"Provider returned error"` on multi-turn
- **Cause**: ACP (Responses API) input arrays can contain `function_call` and `function_call_output` items that are **not** valid ChatCompletions messages — they have `type` and `call_id` fields but **no `role` key**. Upstream providers (OpenRouter, Nvidia) reject these with 400.
- **Example malformed items**:
  ```json
  {"type": "function_call", "call_id": "call_123", "name": "bash", "arguments": "..."}
  {"type": "function_call_output", "call_id": "call_123", "output": "..."}
  ```
- **Fix**: The sanitizer in `src/main.py` converts these to proper OpenAI format:
  - `function_call` → `{"role": "assistant", "content": null, "tool_calls": [...]}`
  - `function_call_output` → `{"role": "tool", "tool_call_id": "...", "content": "..."}`
- **Where to look**: Check `logs/literouter_logs.db` → `request_legs` table. Query for `status_code = 400` and inspect the outgoing body (leg 2) for messages without a `role` field.

## 4. Debugging Toolkit
- **Logs**: `logs/literouter.log` (if running via `nohup`) or the active uvicorn task log.
- **Test `/v1/responses` directly**:
  ```bash
  curl -s -N http://localhost:7766/v1/responses \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer <your-key>" \
    -d '{"model": "openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", "input": [{"role": "user", "content": [{"type": "text", "text": "hi"}]}], "stream": true}'
  ```

## 5. Routing New Models (e.g., OpenRouter)
When you need to add a new model (like `openrouter/owl-alpha` or any other OpenRouter model) so that it routes through LiteRouter in OpenCode:
1. Open the OpenCode configuration at `~/.config/opencode/opencode.json`.
2. Locate the provider block for either `literouter` or `openrouter` (both map to `http://localhost:7766/v1` via `@ai-sdk/openai`).
3. Add the precise upstream model ID into the `models` dictionary.
   ```json
   "openrouter": {
       "npm": "@ai-sdk/openai",
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
