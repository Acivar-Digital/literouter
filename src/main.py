"""
main.py — FastAPI server for LiteRouter v2.2

Three routing pathways (configured in .env):
  anthropic + anthropic  → Native Anthropic SDK
  anthropic + openrouter → Anthropic format → OpenRouter /messages
  openai    + openrouter → OpenAI format → OpenRouter /chat/completions
"""

import asyncio
import json
import logging
import time
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
_processing_lock = asyncio.Lock()


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


# ── Request Processing ────────────────────────────────────────────────────────


async def _process_request(body: dict, provider_name: str, template: str, provider):
    """Forward a single request to the upstream provider."""
    should_stream = body.get("stream", False)
    use_anthropic = template == "anthropic"
    use_gemini = is_gemini_provider(provider)

    async with _processing_lock:
        # Rate limit check
        min_delay_ms = config.provider_min_delays.get(provider_name, config.rotate_delay_ms)
        rl = rate_limiter.can_call(provider_name, min_delay_ms)
        if not rl["ready"]:
            logger.info("[RateLimiter] %s waiting %dms", provider_name, rl["wait_ms"])
            metrics.increment_rate_limit_wait()
            metrics.add_rate_limit_wait_ms(rl["wait_ms"])
            await asyncio.sleep(rl["wait_ms"] / 1000.0)

        # Get next API key
        key = router.get_next_key(provider_name, provider.api_keys)
        if not key:
            raise HTTPException(status_code=503, detail=f"[{provider_name}] No available API keys.")

        metrics.increment_request()
        metrics.increment_key_usage(key)
        start_time = time.time()

        # Apply model params from config
        model_config = config.model_params.get(provider_name)
        if model_config:
            body["model"] = model_config["model"]
            for k, v in model_config.items():
                if k != "model":
                    body[k] = v

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
            logger.info("[debug] TRANSFORMED ANTHROPIC PAYLOAD: %s", payload)
            if is_anthropic_provider(provider):
                # Native Anthropic: use x-api-key header
                headers["x-api-key"] = key
                headers["anthropic-version"] = "2023-06-01"
                del headers["Authorization"]

        else:
            # OpenAI template → /chat/completions endpoint
            target_url = f"{provider.base_url}/chat/completions"

        # Dispatch
        logger.info("[debug] OUTBOUND PAYLOAD: %s", payload)
        if should_stream:
            return await _stream_request(
                target_url, payload, headers, key, provider_name,
                use_gemini, use_anthropic, start_time,
            )
        return await _buffered_request(
            target_url, payload, headers, key, provider_name,
            use_gemini, use_anthropic, start_time,
        )


async def _buffered_request(
    target_url, payload, headers, key, provider_name,
    use_gemini, use_anthropic, start_time,
):
    """Non-streaming: buffer full response, transform, return JSON."""
    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            if use_gemini:
                resp = await client.post(target_url, json=payload, params={"key": key})
            else:
                resp = await client.post(target_url, json=payload, headers=headers)

            rate_limiter.mark_call(provider_name)

            if resp.status_code in (429, 401, 403):
                router.report_error(provider_name, key, resp.status_code)

            if not resp.is_success:
                err_text = resp.text[:200]
                logger.warning("[%s] upstream %d: %s", provider_name, resp.status_code, err_text)
                metrics.increment_error()
                metrics.increment_error_by_status(resp.status_code)
                return JSONResponse(
                    status_code=resp.status_code,
                    content={"error": {"message": err_text, "type": "upstream_error", "code": resp.status_code}},
                )

            metrics.increment_success()
            latency_ms = int((time.time() - start_time) * 1000)
            metrics.add_latency(latency_ms)
            logger.info("[%s] success status=%d latency=%dms", provider_name, resp.status_code, latency_ms)

            data = resp.json()
            if use_gemini:
                data = transform_gemini_response(data)
            # Anthropic + OpenRouter: pass response as-is (OpenRouter returns OpenAI-format)
            # Anthropic + native: pass response as-is (client expects Anthropic format)
            return JSONResponse(content=data)

    except httpx.TimeoutException:
        logger.error("[%s] request timed out", provider_name)
        metrics.increment_error()
        return JSONResponse(status_code=504, content={"error": {"message": "Upstream timeout.", "type": "upstream_error"}})
    except httpx.ConnectError as exc:
        logger.error("[%s] connection refused: %s", provider_name, exc)
        metrics.increment_error()
        return JSONResponse(status_code=502, content={"error": {"message": "Upstream connection refused.", "type": "upstream_error"}})
    except Exception as exc:
        logger.error("[%s] unexpected error: %s", provider_name, exc)
        metrics.increment_error()
        return JSONResponse(status_code=500, content={"error": {"message": "Internal server error.", "type": "internal_error"}})


async def _stream_request(
    target_url, payload, headers, key, provider_name,
    use_gemini, use_anthropic, start_time,
):
    """Streaming: return StreamingResponse with transformed chunks."""

    async def _upstream_stream():
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
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
                        err_text = err_body[:200].decode("utf-8", errors="replace")
                        metrics.increment_error()
                        metrics.increment_error_by_status(resp.status_code)
                        yield b'data: {"error": {"message": "' + err_text.encode() + b'", "type": "upstream_error"}}\n\n'
                        return
                    # All pathways: pass streaming response as-is
                    async for chunk in resp.aiter_bytes():
                        yield chunk
            metrics.increment_success()
            latency_ms = int((time.time() - start_time) * 1000)
            metrics.add_latency(latency_ms)
            logger.info("[%s] stream success latency=%dms", provider_name, latency_ms)
        except httpx.TimeoutException:
            logger.error("[%s] stream timed out", provider_name)
            metrics.increment_error()
            yield b'data: {"error": {"message": "Upstream timeout.", "type": "upstream_error"}}\n\n'
        except httpx.ConnectError as exc:
            logger.error("[%s] stream connection refused: %s", provider_name, exc)
            metrics.increment_error()
            yield b'data: {"error": {"message": "Upstream connection refused.", "type": "upstream_error"}}\n\n'
        except Exception as exc:
            logger.error("[%s] stream unexpected error: %s", provider_name, exc)
            metrics.increment_error()
            yield b'data: {"error": {"message": "Internal server error.", "type": "internal_error"}}\n\n'

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
    logger.info("[debug] RAW BODY (%d bytes): %s", len(raw_body), raw_body[:2000])

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": {"message": "Invalid JSON body", "type": "invalid_request_error"}})

    if "input" in body and "messages" not in body:
        body["messages"] = body["input"]

    # Sanitize custom block types injected by client TUI/CLI systems
    if "messages" in body and isinstance(body["messages"], list):
        for msg in body["messages"]:
            if isinstance(msg, dict) and isinstance(msg.get("content"), list):
                for block in msg["content"]:
                    if isinstance(block, dict) and block.get("type") in ("input_text", "output_text"):
                        block_type = block.get("type")
                        block["type"] = "text"
                        logger.info("[Sanitizer] Replaced %s block with standard text", block_type)

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

    # Get routing from requested model or .env (template + provider)
    template, provider_name, provider = _get_routing(raw_model)

    return await _process_request(body, provider_name, template, provider)


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
        "queue": {"length": 0, "isProcessing": _processing_lock.locked(), "rotateDelayMs": config.rotate_delay_ms},
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
            result[name] = {"configured": True, "model": config.model_params.get(name, {}).get("model", "not set")}
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
