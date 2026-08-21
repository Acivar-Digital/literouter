from __future__ import annotations

import asyncio
import datetime
import json
import time
import uuid
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import FastAPI, Header, Query, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from .config import JournalEntry, MockControlConfig

app = FastAPI(title="LiteRouter HTTP/2 Mock Upstream Provider")

# In-memory journal and global control state
_journal: List[JournalEntry] = []
_control_config = MockControlConfig()
_last_request_timestamp: Optional[float] = None
_lock = asyncio.Lock()
_sequence_index = 0


def _get_provider_key(headers: Dict[str, str]) -> Optional[str]:
    for key_header in ("authorization", "x-api-key", "api-key"):
        val = headers.get(key_header)
        if val:
            return val[7:].strip() if val.lower().startswith("bearer ") else val.strip()
    return None


def _build_openai_chat_response(
    model: str = "gpt-4o", content: str = "Mock response from Upstream"
) -> Dict[str, Any]:
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": content,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 8,
            "total_tokens": 18,
        },
    }


def _build_anthropic_response(
    model: str = "claude-3-5-sonnet", content: str = "Mock response from Anthropic"
) -> Dict[str, Any]:
    return {
        "id": f"msg_{uuid.uuid4().hex[:12]}",
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": [
            {
                "type": "text",
                "text": content,
            }
        ],
        "stop_reason": "end_turn",
        "stop_sequence": None,
        "usage": {
            "input_tokens": 12,
            "output_tokens": 9,
        },
    }


def _build_error_response(status_code: int, message: str = "Mock upstream error") -> Dict[str, Any]:
    err_type = "invalid_request_error"
    if status_code == 429:
        err_type = "insufficient_quota"
    elif status_code >= 500:
        err_type = "server_error"
    return {
        "error": {
            "message": message,
            "type": err_type,
            "param": None,
            "code": str(status_code),
        }
    }


def _make_openai_chunk(
    cmpl_id: str, created: int, model: str, delta: Dict[str, Any], finish_reason: Optional[str] = None
) -> str:
    chunk = {
        "id": cmpl_id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
    }
    return f"data: {json.dumps(chunk)}\n\n"


async def _yield_openai_chunks(
    words: List[str], cmpl_id: str, created: int, model: str, delay_ms: int, hang: bool
) -> AsyncGenerator[str, None]:
    for i, word in enumerate(words):
        if hang and i >= 2:
            return
        if delay_ms > 0:
            await asyncio.sleep(delay_ms / 1000.0)
        yield _make_openai_chunk(cmpl_id, created, model, {"content": word})


async def _generate_openai_sse(
    model: str = "gpt-4o",
    num_chunks: int = 6,
    delay_ms: int = 10,
    hang_mid_stream: bool = False,
) -> AsyncGenerator[str, None]:
    cmpl_id = f"chatcmpl-{uuid.uuid4().hex[:12]}"
    created = int(time.time())
    yield _make_openai_chunk(cmpl_id, created, model, {"role": "assistant", "content": ""})

    all_words = ["Mock", " upstream", " streaming", " token", " chunk", " response"]
    selected = all_words[: min(num_chunks, len(all_words))]
    async for chunk in _yield_openai_chunks(selected, cmpl_id, created, model, delay_ms, hang_mid_stream):
        yield chunk

    if not hang_mid_stream:
        yield _make_openai_chunk(cmpl_id, created, model, {}, "stop")
        yield "data: [DONE]\n\n"


async def _yield_anthropic_chunks(
    words: List[str], delay_ms: int, hang: bool
) -> AsyncGenerator[str, None]:
    for i, word in enumerate(words):
        if hang and i >= 2:
            return
        if delay_ms > 0:
            await asyncio.sleep(delay_ms / 1000.0)
        delta_payload = {"type": "content_block_delta", "index": 0, "delta": {"type": "text_delta", "text": word}}
        yield f"event: content_block_delta\ndata: {json.dumps(delta_payload)}\n\n"


async def _generate_anthropic_sse(
    model: str = "claude-3-5-sonnet",
    num_chunks: int = 5,
    delay_ms: int = 10,
    hang_mid_stream: bool = False,
) -> AsyncGenerator[str, None]:
    msg_id = f"msg_{uuid.uuid4().hex[:12]}"
    start_payload = {
        "type": "message_start",
        "message": {
            "id": msg_id,
            "type": "message",
            "role": "assistant",
            "model": model,
            "content": [],
            "stop_reason": None,
            "stop_sequence": None,
            "usage": {"input_tokens": 12, "output_tokens": 1},
        },
    }
    yield f"event: message_start\ndata: {json.dumps(start_payload)}\n\n"
    block_start = {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}
    yield f"event: content_block_start\ndata: {json.dumps(block_start)}\n\n"

    all_words = ["Mock", " response", " from", " Anthropic", " stream"]
    selected = all_words[: min(num_chunks, len(all_words))]
    async for chunk in _yield_anthropic_chunks(selected, delay_ms, hang_mid_stream):
        yield chunk

    if not hang_mid_stream:
        yield f"event: content_block_stop\ndata: {json.dumps({'type': 'content_block_stop', 'index': 0})}\n\n"
        yield f"event: message_stop\ndata: {json.dumps({'type': 'message_stop'})}\n\n"


@app.get("/health")
@app.get("/healthz")
@app.get("/ping")
async def health_check() -> Dict[str, str]:
    return {"status": "ok", "uptime_utc": datetime.datetime.now(datetime.timezone.utc).isoformat()}


@app.post("/mock/control")
@app.post("/control")
async def update_control_config(config: MockControlConfig) -> Dict[str, Any]:
    global _control_config
    async with _lock:
        _control_config = config
    return {"status": "updated", "config": _control_config.model_dump()}


@app.get("/mock/control")
@app.get("/control")
async def get_control_config() -> Dict[str, Any]:
    return _control_config.model_dump()


@app.get("/mock/journal")
@app.get("/mock/logs")
@app.get("/logs")
async def get_journal(limit: Optional[int] = Query(None, description="Max entries to return")) -> Dict[str, Any]:
    async with _lock:
        entries = [e.model_dump() for e in _journal]
    if limit is not None:
        entries = entries[-limit:]
    return {"total": len(entries), "entries": entries}


@app.post("/mock/reset")
@app.post("/mock/journal/reset")
@app.post("/reset")
async def reset_journal_and_control(
    keep_journal: bool = Query(False, description="Whether to keep journal entries")
) -> Dict[str, Any]:
    global _journal, _control_config, _last_request_timestamp, _sequence_index
    async with _lock:
        if not keep_journal:
            _journal.clear()
            _last_request_timestamp = None
        _control_config = MockControlConfig()
        _sequence_index = 0
    return {"status": "reset", "total": len(_journal)}


def _evaluate_server_error_mode(mode: str) -> Optional[int]:
    if not mode.startswith("server_error"):
        return None
    parts = mode.split(":")
    return int(parts[1]) if len(parts) > 1 else 500


def _evaluate_mode_status(mode: str) -> tuple[Optional[int], bool, bool]:
    """Return (status_code, ghost_flag, hang_mid_stream) from mode string."""
    if mode == "rate_limit":
        return 429, False, False
    err_code = _evaluate_server_error_mode(mode)
    if err_code is not None:
        return err_code, False, False
    if mode == "ghost":
        return None, True, False
    if mode == "hang_mid_stream":
        return None, False, True
    return None, False, False


def _get_active_configured_mode(provider_key: Optional[str]) -> Optional[str]:
    global _sequence_index
    if provider_key and provider_key in _control_config.key_modes:
        return _control_config.key_modes[provider_key]
    if _control_config.sequence:
        mode = _control_config.sequence[_sequence_index % len(_control_config.sequence)]
        _sequence_index += 1
        return mode
    return None


async def _record_request_journal(
    request: Request,
    path: str,
    headers: Dict[str, str],
    query: Dict[str, Any],
    body_data: Any,
    provider_key: Optional[str],
) -> Optional[str]:
    """Records entry into in-memory journal and returns effective mode if configured."""
    global _last_request_timestamp
    now = time.time()
    async with _lock:
        delta_ms = round((now - _last_request_timestamp) * 1000.0, 2) if _last_request_timestamp is not None else 0.0
        _last_request_timestamp = now

        entry = JournalEntry(
            id=str(uuid.uuid4()),
            timestamp=now,
            iso_time=datetime.datetime.now(datetime.timezone.utc).isoformat(),
            arrival_delta_ms=delta_ms,
            method=request.method,
            path=f"/{path}",
            query_params=query,
            headers=headers,
            body=body_data,
            client_host=request.client.host if request.client else None,
            provider_key=provider_key,
        )
        _journal.append(entry)
        return _get_active_configured_mode(provider_key)


async def _handle_ghost_response(mode: str) -> Response:
    if mode == "drop":
        return Response(status_code=502, content=b"")
    await asyncio.sleep(3600)
    return Response(status_code=504, content=b"Gateway Timeout")


def _resolve_stream_flag(x_stream: Optional[bool], cfg_stream: Optional[bool], body: Any) -> bool:
    if x_stream is not None:
        return x_stream
    if cfg_stream is not None:
        return cfg_stream
    if isinstance(body, dict):
        return bool(body.get("stream", False))
    return False


def _resolve_ghost_flag(
    ghost_from_mode: bool, x_ghost: Optional[str], q_ghost: Optional[bool], cfg_ghost: bool
) -> bool:
    if ghost_from_mode:
        return True
    if x_ghost is not None:
        return x_ghost.lower() in ("1", "true", "yes")
    if q_ghost is not None:
        return q_ghost
    return cfg_ghost


def _resolve_latency(x_lat: Optional[int], q_lat: Optional[int], cfg_lat: int) -> int:
    if x_lat is not None:
        return x_lat
    if q_lat is not None:
        return q_lat
    return cfg_lat


def _resolve_status(
    status_from_mode: Optional[int], x_status: Optional[int], q_status: Optional[int], cfg_status: int
) -> int:
    if status_from_mode is not None:
        return status_from_mode
    if x_status is not None:
        return x_status
    if q_status is not None:
        return q_status
    return cfg_status


def _build_response_headers(x_rl: Optional[int], cfg_rl: Optional[int], base_headers: Dict[str, str]) -> Dict[str, str]:
    res_headers = dict(base_headers)
    rl_val = x_rl if x_rl is not None else cfg_rl
    if rl_val is not None:
        res_headers["retry-after"] = str(rl_val)
        res_headers["x-ratelimit-reset"] = str(rl_val)
    return res_headers


async def _extract_json_body(request: Request) -> Any:
    try:
        raw_body = await request.body()
        if raw_body:
            return json.loads(raw_body.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    return None


def _stream_response(
    is_anthropic: bool, model_name: str, hang_mid_stream: bool, res_headers: Dict[str, str]
) -> Response:
    res_headers.update({"Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Connection": "keep-alive"})
    chunks_count = _control_config.stream_chunks_count
    chunk_delay = _control_config.stream_chunk_delay_ms
    gen = (
        _generate_anthropic_sse(model_name, chunks_count, chunk_delay, hang_mid_stream)
        if is_anthropic
        else _generate_openai_sse(model_name, chunks_count, chunk_delay, hang_mid_stream)
    )
    return StreamingResponse(gen, status_code=200, headers=res_headers, media_type="text/event-stream")


def _standard_response(is_anthropic: bool, model_name: str, res_headers: Dict[str, str]) -> Response:
    if _control_config.response_body is not None:
        return JSONResponse(status_code=200, content=_control_config.response_body, headers=res_headers)
    content = _build_anthropic_response(model_name) if is_anthropic else _build_openai_chat_response(model_name)
    return JSONResponse(status_code=200, content=content, headers=res_headers)


def _dispatch_success_response(
    path: str,
    req_headers: Dict[str, str],
    body_data: Any,
    x_mock_stream: Optional[bool],
    hang_mid_stream: bool,
    res_headers: Dict[str, str],
) -> Response:
    is_stream = _resolve_stream_flag(x_mock_stream, _control_config.stream, body_data)
    model_name = str(body_data.get("model", "gpt-4o")) if isinstance(body_data, dict) else "gpt-4o"
    is_anthropic = "messages" in path and ("anthropic" in path or "x-api-key" in req_headers)
    if is_stream:
        return _stream_response(is_anthropic, model_name, hang_mid_stream, res_headers)
    return _standard_response(is_anthropic, model_name, res_headers)


def _resolve_routing_directives(
    effective_mode: Optional[str],
    x_mock_status_code: Optional[int],
    status_code_query: Optional[int],
    x_mock_ghost: Optional[str],
    ghost_query: Optional[bool],
) -> tuple[int, bool, bool]:
    status_from_mode, ghost_from_mode, hang_mid_stream = _evaluate_mode_status(effective_mode or "")
    effective_status = _resolve_status(
        status_from_mode, x_mock_status_code, status_code_query, _control_config.status_code
    )
    is_ghost = _resolve_ghost_flag(ghost_from_mode, x_mock_ghost, ghost_query, _control_config.ghost)
    return effective_status, is_ghost, hang_mid_stream


async def _apply_latency(x_mock_latency_ms: Optional[int], latency_ms_query: Optional[int]) -> None:
    effective_latency = _resolve_latency(x_mock_latency_ms, latency_ms_query, _control_config.latency_ms)
    if effective_latency > 0:
        await asyncio.sleep(effective_latency / 1000.0)


def _dispatch_error_response(effective_status: int, res_headers: Dict[str, str]) -> Response:
    err_payload = _control_config.response_body or _build_error_response(
        effective_status, message=f"Mock error {effective_status} generated by upstream mock"
    )
    return JSONResponse(status_code=effective_status, content=err_payload, headers=res_headers)


@app.api_route(
    "/{path:path}",
    methods=["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
)
async def mock_upstream_router(
    path: str,
    request: Request,
    x_mock_latency_ms: Optional[int] = Header(None, alias="x-mock-latency-ms"),
    x_mock_status_code: Optional[int] = Header(None, alias="x-mock-status-code"),
    x_mock_ghost: Optional[str] = Header(None, alias="x-mock-ghost"),
    x_mock_ghost_mode: Optional[str] = Header(None, alias="x-mock-ghost-mode"),
    x_mock_rate_limit_reset: Optional[int] = Header(None, alias="x-mock-rate-limit-reset"),
    x_mock_stream: Optional[bool] = Header(None, alias="x-mock-stream"),
    x_mock_mode: Optional[str] = Header(None, alias="x-mock-mode"),
    latency_ms_query: Optional[int] = Query(None, alias="mock_latency_ms"),
    status_code_query: Optional[int] = Query(None, alias="mock_status_code"),
    ghost_query: Optional[bool] = Query(None, alias="mock_ghost"),
) -> Response:
    req_headers, req_query = dict(request.headers), dict(request.query_params)
    body_data = await _extract_json_body(request)
    provider_key = _get_provider_key(req_headers)
    active_mode = await _record_request_journal(request, path, req_headers, req_query, body_data, provider_key)

    effective_status, is_ghost, hang_mid_stream = _resolve_routing_directives(
        x_mock_mode or active_mode, x_mock_status_code, status_code_query, x_mock_ghost, ghost_query
    )
    if is_ghost:
        return await _handle_ghost_response(x_mock_ghost_mode or _control_config.ghost_mode)

    await _apply_latency(x_mock_latency_ms, latency_ms_query)
    res_headers = _build_response_headers(
        x_mock_rate_limit_reset, _control_config.rate_limit_reset_sec, _control_config.custom_headers
    )
    if effective_status != 200:
        return _dispatch_error_response(effective_status, res_headers)

    return _dispatch_success_response(path, req_headers, body_data, x_mock_stream, hang_mid_stream, res_headers)
