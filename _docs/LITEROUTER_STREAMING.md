# LiteRouter Streaming Architecture

## Overview

LiteRouter is a **transparent streaming proxy** for `/v1/chat/completions`. It forwards SSE chunks from upstream providers to clients with per-chunk sanitization.

```
Client ←──SSE──→ LiteRouter ←──SSE──→ Upstream Provider
         (transformed)          (raw bytes)
```

## Stream Entry Point

`_stream_request()` in `src/main.py:426-561` returns a FastAPI `StreamingResponse` wrapping an async generator.

```python
return StreamingResponse(_upstream_stream(), media_type="text/event-stream")
```

## Chunk Processing Pipeline

### 1. Byte Iteration

`resp.aiter_bytes()` yields raw bytes from httpx as they arrive from upstream. No full-response buffering.

### 2. UTF-8 Line Buffering

```python
decoder = codecs.getincrementaldecoder("utf-8")()
buffer = ""
async for chunk in resp.aiter_bytes():
    buffer += decoder.decode(chunk)
    while "\n" in buffer:
        line, buffer = buffer.split("\n", 1)
        ...
```

- Incremental decoder handles multi-byte chars split across chunks
- Line buffer accumulates partial lines until `\n` arrives
- After stream ends, any remaining buffer content is flushed

### 3. Per-Line Transformation (`_fix_streaming_line()` — `src/main.py:143-253`)

Each line is parsed, potentially transformed, and re-serialized:

1. **Skip non-data lines** (comments starting with `:`) in responses mode
2. **Pass through `[DONE]`** in non-responses mode
3. **Extract reasoning content** when `content` is empty
4. **Rebuild clean OpenAI chunks** to satisfy strict Zod schemas

Returns `None` to skip a line entirely, `""` to preserve SSE delimiters.

### 4. Yield to Client

```python
if processed is not None:
    yield (processed + "\n").encode("utf-8")
```

## Reasoning/Thinking Content Handling

**Location:** `src/main.py:164-183`

When `delta.content` is `None` or `""`, reasoning is extracted and placed into `content`:

```python
reasoning = delta.get("reasoning") or delta.get("reasoning_content") or ""
if not reasoning and "reasoning_details" in delta:
    details = delta["reasoning_details"]
    if isinstance(details, list):
        reasoning = "".join(d.get("text", "") for d in details if isinstance(d, dict))
if reasoning:
    delta["content"] = reasoning
```

### Three Reasoning Formats Supported

| Field | Type | Behavior |
|-------|------|----------|
| `delta.reasoning` | string | Used directly |
| `delta.reasoning_content` | string | Used directly |
| `delta.reasoning_details` | `[{text: "..."}]` | Concatenated into single string |

### Implications for Heavy-Thinking Models

Models that emit many thinking tokens (e.g., Gemma-4 with reasoning enabled) will have their reasoning forwarded as regular `content` in the stream. The client sees thinking tokens as normal streamed text — no separate reasoning channel.

Same logic applies to non-streaming path (`src/main.py:399-406`).

## Stream Error Handling

### Before Stream Starts

```python
if resp.status_code in (429, 401, 403):
    router.report_error(provider_name, key, resp.status_code)
if not resp.is_success:
    err_payload = json.dumps({"error": {"message": err_text[:200], "type": "upstream_error"}})
    yield f"data: {err_payload}\n\n".encode("utf-8")
    return
```

### Mid-Stream Errors

| Error | Event Yawned | Generator |
|-------|-------------|-----------|
| `httpx.TimeoutException` | `data: {"error": "Upstream timeout."}` | Exits |
| `httpx.ConnectError` | `data: {"error": "Upstream connection refused."}` | Exits |
| Generic `Exception` | `data: {"error": "Internal server error."}` | Exits |

**No explicit `[DONE]` on error** — client detects stream end by connection closing.

### Key Rotation on Error

- **429** → exponential backoff cooldown (60s → 120s → ... → 1h max)
- **403** → 10min base cooldown, exponential to 1h max
- **401** → permanent quarantine

## Timeouts

| Timeout | Value | Purpose |
|---------|-------|---------|
| `connect` | 60s | TCP connection establishment |
| `read` | 300s | Time between bytes from upstream |
| `write` | 60s | Time to send request body |
| `pool` | 300s | Connection pool acquisition |

New `httpx.AsyncClient` created per request — no cross-request connection pooling.

## Backpressure

No explicit backpressure mechanism. Relies on Python asyncio generator natural backpressure: `yield` blocks until the client consumes the previous chunk.

## ACP/Responses Mode (`/v1/responses`)

### Synthetic Start Events

Before any upstream data, three events are emitted:

1. `response.created` — response object exists
2. `response.output_item.added` — message block starting
3. `response.content_part.added` — text part starting

### Synthetic End Events

After stream completes:

1. `response.output_text.done` — full accumulated text
2. `response.content_part.done` — content part finished
3. `response.output_item.done` — message block finished
4. `response.completed` — entire response complete

### Tool Call Handling in ACP Mode

Tool call deltas are **accumulated but NOT forwarded** to the client. This is a workaround for OpenCode's `@ai-sdk/openai` SDK rejecting `function_call` items with `ZodValidationError`.

## Non-Streaming Path

When `stream: false`, `_buffered_request()` (`src/main.py:360-424`) buffers the full upstream response, applies the same reasoning extraction, and returns a complete JSON response.

## Configuration Reference

| Env Var | Default | Purpose |
|---------|---------|---------|
| `{PREFIX}_MIN_DELAY_MS` | 2000ms | Minimum time between requests to a provider |
| `LITEROUTER_ROTATE_DELAY_MS` | 2000ms | Fallback for providers without explicit delay |

## File Map

| File | Role |
|------|------|
| `src/main.py:143-253` | `_fix_streaming_line()` — per-chunk sanitization |
| `src/main.py:426-561` | `_stream_request()` — streaming proxy core |
| `src/main.py:360-424` | `_buffered_request()` — non-streaming path |
| `src/main.py:564-641` | `_stream_anthropic()` — Anthropic SSE converter (unused/legacy) |
| `src/config.py:50` | `_MIN_KEY_LENGTH` — API key intake gate (currently 10) |
| `src/router.py` | Key rotation, cooldown, quarantine |
| `src/rate_limiter.py` | Per-provider rate limiting |
