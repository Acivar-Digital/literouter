"""
main.py — FastAPI server for LiteRouter v2.2

Three routing pathways (configured in .env):
  anthropic + anthropic  → Native Anthropic SDK
  anthropic + openrouter → Anthropic format → OpenRouter /messages
  openai    + openrouter → OpenAI format → OpenRouter /chat/completions
"""

import asyncio
import codecs
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from src.config import (
    get_config,
    is_anthropic_provider,
    is_gemini_provider,
    is_openrouter_provider,
)
from src.gemini import build_gemini_request_body, transform_gemini_response
from src.metrics import get_metrics
from src.rate_limiter import get_rate_limiter
from src.redis_client import get_redis_client
from src.redis_client import redis_available as check_redis
from src.router import get_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

config = get_config()
router = get_router()
rate_limiter = get_rate_limiter()
metrics = get_metrics()
# ── Helpers ────────────────────────────────────────────────────────────────────


def _check_auth(authorization: str | None) -> bool:
    if not config.auth_key:
        return True
    if not authorization:
        return False
    token = authorization[7:].strip() if authorization.startswith("Bearer ") else ""
    return token == config.auth_key


def _get_routing(raw_model: str = "") -> tuple:
    """Return (template_mode, provider_name, provider_config) from requested model or .env settings."""
    provider_name = ""
    # Check for specific models before general provider splitting
    if raw_model:
        model_lower = raw_model.lower()
        if "nemo" in model_lower:
            provider_name = "openrouter"
        elif "nvidia" in model_lower or "gpt-oss" in model_lower:
            provider_name = "nvidia"

    if not provider_name:
        if raw_model and "/" in raw_model:
            provider_name = raw_model.split("/", 1)[0]
        elif raw_model:
            provider_name = raw_model
        else:
            provider_name = config.provider

    provider = config.providers.get(provider_name)
    if not provider:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown provider '{provider_name}'. Available: {list(config.providers.keys())}",
        )
    if not provider.api_keys:
        raise HTTPException(
            status_code=503,
            detail=f"Provider '{provider_name}' has no API keys configured.",
        )
    template = config.template
    if is_anthropic_provider(provider):
        template = "anthropic"
    return template, provider_name, provider



# ── App ────────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    from src.db_logger import init_db
    init_db()
    logger.info(
        "LiteRouter v2.2 starting — template=%s, provider=%s, port=%d",
        config.template, config.provider, config.port,
    )
    yield
    logger.info("LiteRouter shutting down")


app = FastAPI(title="LiteRouter", version="2.2.0", lifespan=lifespan)


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "message": exc.detail,
                "type": "invalid_request_error",
                "code": exc.status_code,
            }
        },
    )


_provider_locks: dict[str, asyncio.Lock] = {}


# ── Request Processing ────────────────────────────────────────────────────────


def _extract_tool_call_deltas(line: str) -> list[dict]:
    """Extract tool_call delta chunks from a raw SSE data line.
    
    Returns a list of tool_call delta dicts (with index, id, function.name, function.arguments)
    or an empty list if the line doesn't contain tool_calls.
    """
    if not line.startswith("data: ") or "[DONE]" in line:
        return []
    try:
        data = json.loads(line[6:].strip())
        results = []
        for choice in data.get("choices", []):
            delta = choice.get("delta", {})
            for tc in delta.get("tool_calls", []):
                results.append(tc)
        return results
    except Exception:
        return []


def _fix_streaming_line(line: str, is_responses: bool = False, responses_item_id: str = "") -> str | None:
    """Sanitize a single complete SSE line for reasoning models to satisfy strict Zod schemas.
    
    Returns None to signal 'skip this line entirely' (is_responses mode, no translatable content).
    Returns "" for empty lines (SSE event delimiters that MUST be preserved).
    """
    if not line.startswith("data: "):
        if is_responses and line.startswith(":"):
            return None
        return line
    if "[DONE]" in line:
        if is_responses:
            return None
        return line

    try:
        data_content = line[6:].strip()
        if not data_content:
            return line
        data = json.loads(data_content)
        
        # 1. Extract reasoning if content is empty/missing
        choices = data.get("choices", [])
        for choice in choices:
            delta = choice.get("delta", {})
            content = delta.get("content")
            if content is None or content == "":
                reasoning = delta.get("reasoning") or delta.get("reasoning_content") or ""
                if not reasoning and "reasoning_details" in delta:
                    details = delta["reasoning_details"]
                    if isinstance(details, list):
                        reasoning = "".join(d.get("text", "") for d in details if isinstance(d, dict))
                if reasoning:
                    delta["content"] = reasoning
            
            msg = choice.get("message", {})
            msg_content = msg.get("content")
            if msg_content is None or msg_content == "":
                msg_reasoning = msg.get("reasoning") or msg.get("reasoning_content") or ""
                if msg_reasoning:
                    msg["content"] = msg_reasoning

        if is_responses:
            for choice in choices:
                delta = choice.get("delta", {})
                content = delta.get("content", "")
                if content:
                    event_data = json.dumps({
                        'type': 'response.output_text.delta',
                        'item_id': responses_item_id or f'msg-{data.get("id", "unknown")}',
                        'output_index': 0,
                        'content_index': 0,
                        'delta': content,
                    })
                    return f"event: response.output_text.delta\ndata: {event_data}\n"
            return None

        # 2. Sanitize: Rebuild standard OpenAI chunk structure to satisfy strict Zod schemas
        clean_choices = []
        for choice in choices:
            clean_choice = {
                "index": choice.get("index", 0),
                "finish_reason": choice.get("finish_reason")
            }
            
            # Sanitize delta
            if "delta" in choice:
                delta = choice["delta"]
                clean_delta = {}
                if "role" in delta:
                    clean_delta["role"] = delta["role"]
                if "content" in delta:
                    clean_delta["content"] = delta["content"] or ""
                elif "role" in delta or "tool_calls" in delta or "function_call" in delta:
                    # Standard OpenAI delta requires content to be present as string
                    clean_delta["content"] = ""
                if "tool_calls" in delta:
                    clean_delta["tool_calls"] = delta["tool_calls"]
                if "function_call" in delta:
                    clean_delta["function_call"] = delta["function_call"]
                clean_choice["delta"] = clean_delta
                
            # Sanitize message (non-streaming compatibility)
            if "message" in choice:
                msg = choice["message"]
                clean_msg = {}
                if "role" in msg:
                    clean_msg["role"] = msg["role"]
                if "content" in msg:
                    clean_msg["content"] = msg["content"] or ""
                if "tool_calls" in msg:
                    clean_msg["tool_calls"] = msg["tool_calls"]
                if "function_call" in msg:
                    clean_msg["function_call"] = msg["function_call"]
                clean_choice["message"] = clean_msg
                
            clean_choices.append(clean_choice)
            
        clean_data = {
            "id": data.get("id", f"chatcmpl-{int(time.time())}"),
            "object": data.get("object", "chat.completion.chunk"),
            "created": data.get("created", int(time.time())),
            "model": data.get("model", "default"),
            "choices": clean_choices
        }
        if "usage" in data:
            clean_data["usage"] = data["usage"]
            
        return f"data: {json.dumps(clean_data)}"
    except Exception:
        return line


async def _process_request(body: dict, provider_name: str, template: str, provider, req_id: str, is_responses: bool = False):
    """Forward a single request to the upstream provider."""
    should_stream = body.get("stream", False)
    use_anthropic = template == "anthropic"
    use_gemini = is_gemini_provider(provider)

    min_delay_ms = config.provider_min_delays.get(provider_name, config.rotate_delay_ms)
    
    # Get or create lock for this specific provider
    if provider_name not in _provider_locks:
        _provider_locks[provider_name] = asyncio.Lock()
    provider_lock = _provider_locks[provider_name]

    async with provider_lock:
        # Rate limit check
        rl = rate_limiter.can_call(provider_name, min_delay_ms)
        wait_ms = 0
        if not rl["ready"]:
            wait_ms = rl["wait_ms"]
            metrics.increment_rate_limit_wait()
            metrics.add_rate_limit_wait_ms(wait_ms)

        # Get next API key
        key = router.get_next_key(provider_name, provider.api_keys)
        if not key:
            raise HTTPException(status_code=503, detail=f"[{provider_name}] No available API keys.")
        logger.info("[%s] Using rotated key: %s...", provider_name, key[:15])

        metrics.increment_request()
        metrics.increment_key_usage(key)

    # Sleep outside the lock
    if wait_ms > 0:
        logger.info("[RateLimiter] %s waiting %dms (outside lock)", provider_name, wait_ms)
        await asyncio.sleep(wait_ms / 1000.0)

    start_time = time.time()

    # Apply extra model params from config (temperature, etc.)
    # but NEVER overwrite the model — the client knows what it asked for
    model_config = config.model_params.get(provider_name)
    if model_config:
        for k, v in model_config.items():
            if k != "model" and k not in body:
                body[k] = v

    # Normalize max_output_tokens → max_tokens for upstream providers.
    # OpenCode (ACP/Responses API) sends "max_output_tokens" but upstream
    # ChatCompletions providers (OpenRouter, Nvidia) only understand "max_tokens".
    # Without this conversion, the upstream ignores the limit and uses its own
    # tiny default, causing truncated responses.
    if "max_output_tokens" in body and "max_tokens" not in body:
        body["max_tokens"] = body.pop("max_output_tokens")
    if "max_tokens" not in body:
        body["max_tokens"] = 1_000_000

    # Strip provider prefix from model ID if it starts with any known provider name
    raw_model = body.get("model", "")
    if "/" in raw_model:
        prefix = raw_model.split("/", 1)[0]
        if prefix in config.providers or prefix == "openrouter" or prefix == "nvidia":
            body["model"] = raw_model.split("/", 1)[1]

    # Build request based on template + provider
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = body

    if use_gemini:
        # Gemini pathway
        if should_stream:
            target_url = f"{provider.base_url}/models/{body['model']}:streamGenerateContent"
        else:
            target_url = f"{provider.base_url}/models/{body['model']}:generateContent"
        payload = build_gemini_request_body(body)
        del headers["Authorization"]

    elif use_anthropic:
        # Anthropic template → /messages endpoint (transform to Anthropic Messages format)
        target_url = f"{provider.base_url}/messages"
        from src.anthropic import build_anthropic_request_body
        payload = build_anthropic_request_body(body)
        if is_anthropic_provider(provider):
            # Native Anthropic: use x-api-key header
            headers["x-api-key"] = key
            headers["anthropic-version"] = "2023-06-01"
            del headers["Authorization"]

    else:
        # OpenAI template → /chat/completions endpoint
        target_url = f"{provider.base_url}/chat/completions"

    # Dispatch
    from src.db_logger import log_leg
    log_leg(req_id, 2, "OUTGOING", "literouter", "upstream", url=target_url, body=payload)
    if should_stream:
        return await _stream_request(
            target_url, payload, headers, key, provider_name,
            use_gemini, use_anthropic, start_time, req_id, is_responses=is_responses,
        )
    return await _buffered_request(
        target_url, payload, headers, key, provider_name,
        use_gemini, use_anthropic, start_time, req_id,
    )


async def _buffered_request(
    target_url, payload, headers, key, provider_name,
    use_gemini, use_anthropic, start_time, req_id,
):
    """Non-streaming: buffer full response, transform, return JSON."""
    from src.db_logger import log_leg
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=120.0)) as client:
            if use_gemini:
                resp = await client.post(target_url, json=payload, params={"key": key})
            else:
                resp = await client.post(target_url, json=payload, headers=headers)

            rate_limiter.mark_call(provider_name)

            if resp.status_code in (429, 401, 403):
                router.report_error(provider_name, key, resp.status_code)

            if not resp.is_success:
                err_text = resp.text
                log_leg(req_id, 3, "INCOMING", "upstream", "literouter", status_code=resp.status_code, body={"error": err_text})
                logger.warning("[%s] upstream %d: %s | Payload sent: %s", provider_name, resp.status_code, err_text, payload)
                metrics.increment_error()
                metrics.increment_error_by_status(resp.status_code)
                return JSONResponse(
                    status_code=resp.status_code,
                    content={"error": {"message": err_text[:200], "type": "upstream_error", "code": resp.status_code}},
                )

            metrics.increment_success()
            latency_ms = int((time.time() - start_time) * 1000)
            metrics.add_latency(latency_ms)
            logger.info("[%s] success status=%d latency=%dms", provider_name, resp.status_code, latency_ms)

            data = resp.json()
            log_leg(req_id, 3, "INCOMING", "upstream", "literouter", status_code=resp.status_code, body=data)
            if use_gemini:
                data = transform_gemini_response(data)
            # Fix null content for reasoning models (OpenCode can't parse null content)
            for choice in data.get("choices", []):
                msg = choice.get("message", {})
                msg_content = msg.get("content")
                if not msg_content:
                    msg_reasoning = msg.get("reasoning") or msg.get("reasoning_content") or ""
                    if msg_reasoning:
                        msg["content"] = msg_reasoning
            return JSONResponse(content=data)

    except httpx.TimeoutException:
        log_leg(req_id, 3, "INCOMING", "upstream", "literouter", status_code=504, body={"error": "timeout"})
        logger.error("[%s] request timed out", provider_name)
        metrics.increment_error()
        return JSONResponse(status_code=504, content={"error": {"message": "Upstream timeout.", "type": "upstream_error"}})
    except httpx.ConnectError as exc:
        log_leg(req_id, 3, "INCOMING", "upstream", "literouter", status_code=502, body={"error": f"connection refused: {exc}"})
        logger.error("[%s] connection refused: %s", provider_name, exc)
        metrics.increment_error()
        return JSONResponse(status_code=502, content={"error": {"message": "Upstream connection refused.", "type": "upstream_error"}})
    except Exception as exc:
        log_leg(req_id, 3, "INCOMING", "upstream", "literouter", status_code=500, body={"error": str(exc)})
        logger.error("[%s] unexpected error: %s", provider_name, exc)
        metrics.increment_error()
        return JSONResponse(status_code=500, content={"error": {"message": "Internal server error.", "type": "internal_error"}})


async def _stream_request(
    target_url, payload, headers, key, provider_name,
    use_gemini, use_anthropic, start_time, req_id, is_responses: bool = False,
):
    """Streaming: return StreamingResponse with transformed chunks."""
    from src.db_logger import log_leg

    async def _upstream_stream():
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(connect=30.0, read=120.0, write=30.0, pool=120.0)) as client:
                if use_gemini:
                    stream_cm = client.stream("POST", target_url, json=payload, params={"key": key})
                else:
                    stream_cm = client.stream("POST", target_url, json=payload, headers=headers)
                async with stream_cm as resp:
                    rate_limiter.mark_call(provider_name)
                    if resp.status_code in (429, 401, 403):
                        router.report_error(provider_name, key, resp.status_code)
                    if not resp.is_success:
                        err_body = await resp.aread()
                        err_text = err_body.decode("utf-8", errors="replace")
                        log_leg(req_id, 3, "INCOMING", "upstream", "literouter", status_code=resp.status_code, body={"error": err_text})
                        logger.warning("[%s] stream upstream %d: %s | Payload sent: %s", provider_name, resp.status_code, err_text, payload)
                        metrics.increment_error()
                        metrics.increment_error_by_status(resp.status_code)
                        err_payload = json.dumps({"error": {"message": err_text[:200], "type": "upstream_error"}})
                        yield f"data: {err_payload}\n\n".encode("utf-8")
                        return
                    # Log leg 3 successfully starting
                    log_leg(req_id, 3, "INCOMING", "upstream", "literouter", status_code=resp.status_code, body={"status": "streaming starting"})
                    
                    if is_responses:
                        resp_id = f"resp-{req_id}"
                        item_id = f"msg-{req_id}"
                        created_data = json.dumps({'type': 'response.created', 'response': {'id': resp_id, 'object': 'response', 'status': 'in_progress', 'output': []}})
                        yield f"event: response.created\ndata: {created_data}\n\n".encode("utf-8")
                        item_added = json.dumps({'type': 'response.output_item.added', 'output_index': 0, 'item': {'type': 'message', 'id': item_id, 'status': 'in_progress', 'role': 'assistant', 'content': []}})
                        yield f"event: response.output_item.added\ndata: {item_added}\n\n".encode("utf-8")
                        part_added = json.dumps({'type': 'response.content_part.added', 'item_id': item_id, 'output_index': 0, 'content_index': 0, 'part': {'type': 'output_text', 'text': ''}})
                        yield f"event: response.content_part.added\ndata: {part_added}\n\n".encode("utf-8")
                        accumulated_text = []
                        accumulated_tool_calls = {}  # id -> {name, arguments}

                    # Fix null content in streaming chunks for reasoning models using incremental decoder and line buffer
                    decoder = codecs.getincrementaldecoder("utf-8")()
                    buffer = ""
                    async for chunk in resp.aiter_bytes():
                        buffer += decoder.decode(chunk)
                        while "\n" in buffer:
                            line, buffer = buffer.split("\n", 1)
                            # Extract tool_call deltas from raw line BEFORE _fix_streaming_line
                            # (which returns None for tool-call-only chunks in responses mode)
                            if is_responses:
                                for tc in _extract_tool_call_deltas(line):
                                    idx = tc.get("index", 0)
                                    if idx not in accumulated_tool_calls:
                                        accumulated_tool_calls[idx] = {"id": "", "name": "", "arguments": ""}
                                    if "id" in tc:
                                        accumulated_tool_calls[idx]["id"] = tc["id"]
                                    fn = tc.get("function", {})
                                    if "name" in fn:
                                        accumulated_tool_calls[idx]["name"] += fn["name"]
                                    if "arguments" in fn:
                                        accumulated_tool_calls[idx]["arguments"] += fn["arguments"]
                            processed = _fix_streaming_line(line, is_responses, responses_item_id=item_id if is_responses else "")
                            if processed is not None:
                                yield (processed + "\n").encode("utf-8")
                                if is_responses and '"delta"' in processed:
                                    try:
                                        evt = json.loads(processed.split("data: ", 1)[1])
                                        accumulated_text.append(evt.get("delta", ""))
                                    except Exception:
                                        pass
                    if buffer:
                        if is_responses:
                            for tc in _extract_tool_call_deltas(buffer):
                                idx = tc.get("index", 0)
                                if idx not in accumulated_tool_calls:
                                    accumulated_tool_calls[idx] = {"id": "", "name": "", "arguments": ""}
                                if "id" in tc:
                                    accumulated_tool_calls[idx]["id"] = tc["id"]
                                fn = tc.get("function", {})
                                if "name" in fn:
                                    accumulated_tool_calls[idx]["name"] += fn["name"]
                                if "arguments" in fn:
                                    accumulated_tool_calls[idx]["arguments"] += fn["arguments"]
                        processed = _fix_streaming_line(buffer, is_responses, responses_item_id=item_id if is_responses else "")
                        if processed is not None:
                            yield processed.encode("utf-8")
                            if is_responses and '"delta"' in processed:
                                try:
                                    evt = json.loads(processed.split("data: ", 1)[1])
                                    accumulated_text.append(evt.get("delta", ""))
                                except Exception:
                                    pass

                    if is_responses:
                        full_text = "".join(accumulated_text)
                        text_done = json.dumps({'type': 'response.output_text.done', 'item_id': item_id, 'output_index': 0, 'content_index': 0, 'text': full_text})
                        yield f"event: response.output_text.done\ndata: {text_done}\n\n".encode("utf-8")
                        part_done = json.dumps({'type': 'response.content_part.done', 'item_id': item_id, 'output_index': 0, 'content_index': 0, 'part': {'type': 'output_text', 'text': full_text}})
                        yield f"event: response.content_part.done\ndata: {part_done}\n\n".encode("utf-8")
                        item_done = json.dumps({'type': 'response.output_item.done', 'output_index': 0, 'item': {'type': 'message', 'id': item_id, 'status': 'completed', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': full_text}]}})
                        yield f"event: response.output_item.done\ndata: {item_done}\n\n".encode("utf-8")

                        # Emit accumulated tool calls as ACP function_call output items
                        output_items = [{'type': 'message', 'id': item_id, 'status': 'completed', 'role': 'assistant', 'content': [{'type': 'output_text', 'text': full_text}]}]
                        for idx in sorted(accumulated_tool_calls.keys()):
                            tc = accumulated_tool_calls[idx]
                            call_id = tc["id"] or f"call_{idx}"
                            fc_item_id = f"fc-{req_id}-{idx}"
                            fc_item = {'type': 'function_call', 'id': fc_item_id, 'call_id': call_id, 'name': tc['name'], 'arguments': tc['arguments'], 'status': 'completed'}
                            # Announce the function_call item
                            fc_added = json.dumps({'type': 'response.output_item.added', 'output_index': idx + 1, 'item': fc_item})
                            yield f"event: response.output_item.added\ndata: {fc_added}\n\n".encode("utf-8")
                            fc_done = json.dumps({'type': 'response.output_item.done', 'output_index': idx + 1, 'item': fc_item})
                            yield f"event: response.output_item.done\ndata: {fc_done}\n\n".encode("utf-8")
                            output_items.append(fc_item)
                            logger.info("[%s] Emitting ACP function_call: %s(%s...)", provider_name, tc['name'], tc['arguments'][:50])

                        completed_data = json.dumps({'type': 'response.completed', 'response': {'id': resp_id, 'object': 'response', 'status': 'completed', 'output': output_items}})
                        yield f"event: response.completed\ndata: {completed_data}\n\n".encode("utf-8")
            metrics.increment_success()
            latency_ms = int((time.time() - start_time) * 1000)
            metrics.add_latency(latency_ms)
            logger.info("[%s] stream success latency=%dms", provider_name, latency_ms)
        except httpx.TimeoutException:
            logger.error("[%s] stream timed out", provider_name)
            metrics.increment_error()
            err_payload = json.dumps({"error": {"message": "Upstream timeout.", "type": "upstream_error"}})
            yield f"data: {err_payload}\n\n".encode("utf-8")
        except httpx.ConnectError as exc:
            logger.error("[%s] stream connection refused: %s", provider_name, exc)
            metrics.increment_error()
            err_payload = json.dumps({"error": {"message": "Upstream connection refused.", "type": "upstream_error"}})
            yield f"data: {err_payload}\n\n".encode("utf-8")
        except Exception as exc:
            logger.error("[%s] stream unexpected error: %s", provider_name, exc)
            metrics.increment_error()
            err_payload = json.dumps({"error": {"message": "Internal server error.", "type": "internal_error"}})
            yield f"data: {err_payload}\n\n".encode("utf-8")

    return StreamingResponse(_upstream_stream(), media_type="text/event-stream")


async def _stream_anthropic(resp):
    """Convert Anthropic SSE → OpenAI-compatible SSE chunks."""
    text_parts = []
    model = "anthropic"
    message_id = ""
    finish_reason = "stop"
    usage = {}
    buf = b""
    async for raw in resp.aiter_bytes():
        buf += raw
        while b"\n\n" in buf:
            event_text, buf = buf.split(b"\n\n", 1)
            event_text = event_text.decode("utf-8", errors="replace")
            event_type = ""
            data_line = ""
            for line in event_text.strip().split("\n"):
                if line.startswith("event:"):
                    event_type = line[len("event:"):].strip()
                elif line.startswith("data:"):
                    data_line = line[len("data:"):].strip()
            if not data_line:
                continue
            try:
                data = json.loads(data_line)
            except json.JSONDecodeError:
                continue

            if event_type == "message_start":
                msg = data.get("message", {})
                model = msg.get("model", "anthropic")
                message_id = msg.get("id", "")
                chunk = {
                    "id": message_id or f"chatcmpl-{int(time.time())}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}],
                }
                yield f"data: {json.dumps(chunk)}\n\n".encode()

            elif event_type == "content_block_delta":
                text = data.get("delta", {}).get("text", "")
                if text:
                    text_parts.append(text)
                    chunk = {
                        "id": message_id or f"chatcmpl-{int(time.time())}",
                        "object": "chat.completion.chunk",
                        "created": int(time.time()),
                        "model": model,
                        "choices": [{"index": 0, "delta": {"content": text}, "finish_reason": None}],
                    }
                    yield f"data: {json.dumps(chunk)}\n\n".encode()

            elif event_type == "message_delta":
                stop_reason = data.get("delta", {}).get("stop_reason", "")
                if stop_reason:
                    finish_reason = {"end_turn": "stop", "max_tokens": "length", "stop_sequence": "stop", "tool_use": "tool_calls"}.get(stop_reason, "stop")
                usage = data.get("usage", {})

            elif event_type == "message_stop":
                openai_usage = {}
                if usage:
                    out_t = usage.get("output_tokens", 0)
                    in_t = usage.get("input_tokens", 0)
                    openai_usage = {"prompt_tokens": in_t, "completion_tokens": out_t, "total_tokens": in_t + out_t}
                final = {
                    "id": message_id or f"chatcmpl-{int(time.time())}",
                    "object": "chat.completion.chunk",
                    "created": int(time.time()),
                    "model": model,
                    "choices": [{"index": 0, "delta": {}, "finish_reason": finish_reason}],
                }
                if openai_usage:
                    final["usage"] = openai_usage
                yield f"data: {json.dumps(final)}\n\n".encode()
                yield b"data: [DONE]\n\n"

    yield b"data: [DONE]\n\n"


# ── Endpoints ──────────────────────────────────────────────────────────────────


@app.post("/v1/chat/completions")
@app.post("/v1/responses")
async def chat_completions(request: Request, authorization: str | None = Header(None)):
    if not _check_auth(authorization):
        return JSONResponse(status_code=401, content={"error": {"message": "Invalid API key", "type": "invalid_request_error"}})

    raw_body = await request.body()

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": {"message": "Invalid JSON body", "type": "invalid_request_error"}})

    if "input" in body and "messages" not in body:
        body["messages"] = body["input"]

    # ── ACP → ChatCompletions message sanitization ────────────────────────────
    # ACP input arrays can contain items that are NOT valid ChatCompletions
    # messages. Specifically:
    #   - {type: "function_call", call_id, name, arguments}  → no "role" key
    #   - {type: "function_call_output", call_id, output}    → no "role" key
    # Upstream providers reject these with 400 Bad Request.
    # We convert them to proper OpenAI tool_calls / tool-role messages.
    if "messages" in body and isinstance(body["messages"], list):
        sanitized_messages = []
        for msg in body["messages"]:
            if not isinstance(msg, dict):
                sanitized_messages.append(msg)
                continue

            msg_type = msg.get("type", "")

            if msg_type == "function_call":
                # Convert ACP function_call → assistant message with tool_calls
                tool_call = {
                    "id": msg.get("call_id", f"call_{uuid.uuid4().hex[:8]}"),
                    "type": "function",
                    "function": {
                        "name": msg.get("name", "unknown"),
                        "arguments": msg.get("arguments", "{}"),
                    },
                }
                sanitized_messages.append({
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [tool_call],
                })
                logger.info("[Sanitizer] Converted function_call '%s' to assistant tool_calls", msg.get("name"))
                continue

            if msg_type == "function_call_output":
                # Convert ACP function_call_output → tool-role message
                sanitized_messages.append({
                    "role": "tool",
                    "tool_call_id": msg.get("call_id", ""),
                    "content": msg.get("output", ""),
                })
                logger.info("[Sanitizer] Converted function_call_output to tool message")
                continue

            # Standard message — sanitize content block types
            if isinstance(msg.get("content"), list):
                for block in msg["content"]:
                    if isinstance(block, dict) and block.get("type") in ("input_text", "output_text"):
                        block_type = block.get("type")
                        block["type"] = "text"
                        logger.info("[Sanitizer] Replaced %s block with standard text", block_type)

            sanitized_messages.append(msg)

        body["messages"] = sanitized_messages

    # Sanitize tools schema if necessary (e.g. OpenAI format vs SDK raw format)
    if "tools" in body and isinstance(body["tools"], list):
        sanitized_tools = []
        for tool in body["tools"]:
            if isinstance(tool, dict):
                # If the tool has type=function but does not have the 'function' object (OpenAI format requirement)
                if tool.get("type") == "function" and "function" not in tool:
                    # Move name, description, parameters to the 'function' nested dictionary
                    fn_data = {}
                    for k in ["name", "description", "parameters"]:
                        if k in tool:
                            fn_data[k] = tool[k]
                    sanitized_tools.append({
                        "type": "function",
                        "function": fn_data
                    })
                else:
                    sanitized_tools.append(tool)
        body["tools"] = sanitized_tools

    raw_model: str = body.get("model", "")

    # Health check shortcut
    if not body.get("messages") and not body.get("prompt"):
        return JSONResponse(
            status_code=200,
            content={
                "id": "health-check", "object": "chat.completion",
                "created": int(time.time()), "model": raw_model or "default",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
            },
        )

    req_id = f"req-{uuid.uuid4().hex[:8]}"
    from src.db_logger import log_leg
    log_leg(req_id, 1, "INCOMING", "opencode", "literouter", url=request.url.path, body=body)
    logger.info("[%s] INCOMING REQUEST | Path: %s | Model: %s | Body: %s", req_id, request.url.path, raw_model, json.dumps(body))

    template, provider_name, provider = _get_routing(raw_model)
    is_responses = request.url.path == "/v1/responses"
    try:
        response = await _process_request(body, provider_name, template, provider, req_id, is_responses=is_responses)
        if isinstance(response, JSONResponse):
            # Read bytes of response for logging
            resp_content = response.body.decode("utf-8", errors="replace")
            try:
                resp_json = json.loads(resp_content)
            except Exception:
                resp_json = {"raw": resp_content}
            log_leg(req_id, 4, "OUTGOING", "literouter", "opencode", status_code=response.status_code, body=resp_json)
            logger.info("[%s] OUTGOING RESPONSE | Status: %d | Body: %s", req_id, response.status_code, resp_content)
        else:
            log_leg(req_id, 4, "OUTGOING", "literouter", "opencode", status_code=200, body={"status": "streaming started"})
            logger.info("[%s] OUTGOING RESPONSE | Started Stream Response", req_id)
        return response
    except Exception as exc:
        log_leg(req_id, 4, "OUTGOING", "literouter", "opencode", status_code=500, body={"error": str(exc)})
        logger.error("[%s] OUTGOING RESPONSE ERROR | %s", req_id, exc, exc_info=True)
        raise exc


@app.get("/health")
@app.get("/")
async def health():
    return JSONResponse(content={
        "status": "ok",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "config": {
            "port": config.port, "host": config.host,
            "authEnabled": bool(config.auth_key),
            "template": config.template,
            "provider": config.provider,
            "providers": {
                name: {
                    "baseUrl": p.base_url, "keys": len(p.api_keys),
                    "model": config.model_params.get(name, {}).get("model", "not configured"),
                    "minDelayMs": config.provider_min_delays.get(name, config.rotate_delay_ms),
                }
                for name, p in config.providers.items()
            },
        },
        "router": router.get_router_status(config.providers),
        "queue": {"length": 0, "isProcessing": any(lock.locked() for lock in _provider_locks.values()), "rotateDelayMs": config.rotate_delay_ms},
        "rateLimiter": {"providerStatus": rate_limiter.get_status(), "defaultMinDelayMs": config.rotate_delay_ms},
        "metrics": metrics.get_metrics(),
        "redis": {"connected": check_redis(), "info": _redis_info_safe()},
    })


@app.get("/metrics")
async def detailed_metrics():
    return JSONResponse(content=metrics.get_metrics())


# ── Provider Model Availability ────────────────────────────────────────────────

OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"


@app.get("/v1/models")
async def list_models(authorization: str | None = Header(None)):
    if not _check_auth(authorization):
        return JSONResponse(status_code=401, content={"error": {"message": "Invalid API key", "type": "invalid_request_error"}})

    result = {}
    for name, provider in config.providers.items():
        if is_openrouter_provider(provider):
            result[name] = await _fetch_openrouter_models(provider)
        elif is_anthropic_provider(provider):
            result[name] = {
                "configured": True,
                "model": config.model_params.get(name, {}).get("model", "not set"),
                "supported_models": ["claude-sonnet-4-6", "claude-opus-4-6", "claude-haiku-4-5"],
            }
        else:
            result[name] = await _fetch_provider_models(name, provider)
    return JSONResponse(content={"status": "ok", "providers": result})


async def _fetch_openrouter_models(provider):
    keys = provider.api_keys
    if not keys:
        return {"error": "No API keys available"}
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(OPENROUTER_MODELS_URL, headers={"Authorization": f"Bearer {keys[0]}"})
        if resp.status_code == 200:
            models = resp.json().get("data", [])
            return {
                "count": len(models),
                "models": [{"id": m.get("id", ""), "context_length": m.get("context_length", 0), "pricing": m.get("pricing", {})} for m in models],
            }
        return {"error": f"OpenRouter returned {resp.status_code}", "detail": resp.text[:200]}
    except Exception as exc:
        return {"error": str(exc)}


async def _fetch_provider_models(name: str, provider) -> dict:
    """Fetch models from any OpenAI-compatible provider (Nvidia, etc.)."""
    keys = provider.api_keys
    models_url = f"{provider.base_url}/models"
    headers = {}
    if keys:
        headers["Authorization"] = f"Bearer {keys[0]}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(models_url, headers=headers)
        if resp.status_code == 200:
            body = resp.json()
            raw = body.get("data") if isinstance(body, dict) else body
            if isinstance(raw, list):
                models = [{"id": m.get("id", "")} for m in raw]
                return {"configured": True, "count": len(models), "models": models}
            return {"configured": True, "model": config.model_params.get(name, {}).get("model", "not set")}
        return {"configured": True, "error": f"API returned {resp.status_code}"}
    except Exception as exc:
        return {"configured": True, "error": str(exc)}


def _redis_info_safe() -> dict:
    if not check_redis():
        return {}
    try:
        client = get_redis_client()
        if client is None:
            return {}
        info = client.info()
        return {
            "redis_version": info.get("redis_version", "unknown"),
            "connected_clients": info.get("connected_clients", 0),
            "used_memory_human": info.get("used_memory_human", "unknown"),
            "uptime_in_seconds": info.get("uptime_in_seconds", 0),
        }
    except Exception:
        return {}
