"""
main.py — FastAPI server for LiteRouter.

Replaces Bun.serve() with a FastAPI-based HTTP server that routes
OpenAI-compatible chat completion requests to upstream providers.
"""

import asyncio
import logging
import time
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse

from src.config import get_config, is_gemini_provider
from src.gemini import build_gemini_request_body, transform_gemini_response
from src.metrics import get_metrics
from src.rate_limiter import get_rate_limiter
from src.redis_client import get_redis_client
from src.redis_client import redis_available as check_redis
from src.router import get_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger(__name__)

config = get_config()
router = get_router()
rate_limiter = get_rate_limiter()
metrics = get_metrics()

_processing_lock = asyncio.Lock()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Log startup/shutdown events."""
    provider_names = ", ".join(config.providers.keys())
    logger.info(
        "LiteRouter starting — providers: %s, port: %d",
        provider_names,
        config.port,
    )
    yield
    logger.info("LiteRouter shutting down")


app = FastAPI(title="LiteRouter", version="1.0.0", lifespan=lifespan)


def _check_auth(authorization: str | None) -> bool:
    """Return True if the Bearer token matches the configured auth key."""
    if not config.auth_key:
        return True
    if not authorization:
        return False
    token = authorization[7:].strip() if authorization.startswith("Bearer ") else ""
    return token == config.auth_key


async def _process_request(body: dict, provider_name: str) -> dict:
    """Forward a single request to the upstream provider (sequential)."""
    async with _processing_lock:
        provider = config.providers[provider_name]
        use_gemini = is_gemini_provider(provider)

        default_delay = config.rotate_delay_ms
        min_delay_ms = config.provider_min_delays.get(provider_name, default_delay)

        rl = rate_limiter.can_call(provider_name, min_delay_ms)
        if not rl["ready"]:
            logger.info("[RateLimiter] %s waiting %dms", provider_name, rl["wait_ms"])
            metrics.increment_rate_limit_wait()
            metrics.add_rate_limit_wait_ms(rl["wait_ms"])
            await asyncio.sleep(rl["wait_ms"] / 1000.0)

        key = router.get_next_key(provider_name, provider.api_keys)
        if not key:
            raise HTTPException(
                status_code=503,
                detail=f"[{provider_name}] No available API keys.",
            )

        metrics.increment_request()
        metrics.increment_key_usage(key)
        start_time = time.time()

        lookup_key = provider_name
        model_config = config.model_params.get(lookup_key)
        if model_config:
            body["model"] = model_config["model"]
            for k, v in model_config.items():
                if k == "model":
                    continue
                body[k] = v

        body["stream"] = False

        headers = {
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

        if use_gemini:
            target_url = (
                f"{provider.base_url}/models/{body['model']}:generateContent"
            )
            gemini_body = build_gemini_request_body(body)
            payload = gemini_body
            del headers["Authorization"]
        else:
            target_url = f"{provider.base_url}/chat/completions"
            payload = body

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                if use_gemini:
                    resp = await client.post(
                        target_url,
                        json=payload,
                        params={"key": key},
                    )
                else:
                    resp = await client.post(
                        target_url,
                        json=payload,
                        headers=headers,
                    )

            rate_limiter.mark_call(provider_name)

            if resp.status_code in (429, 401, 403):
                router.report_error(provider_name, key, resp.status_code)

            if not resp.is_success:
                err_text = resp.text[:200]
                logger.warning(
                    "[%s] upstream %d: %s", provider_name, resp.status_code, err_text
                )
                metrics.increment_error()
                metrics.increment_error_by_status(resp.status_code)
                return JSONResponse(
                    status_code=resp.status_code,
                    content={
                        "error": {
                            "message": err_text,
                            "type": "upstream_error",
                            "code": resp.status_code,
                        }
                    },
                )

            metrics.increment_success()
            latency_ms = int((time.time() - start_time) * 1000)
            metrics.add_latency(latency_ms)
            logger.info(
                "[%s] success status=%d latency=%dms",
                provider_name,
                resp.status_code,
                latency_ms,
            )

            data = resp.json()
            if use_gemini:
                data = transform_gemini_response(data)

            return JSONResponse(content=data)

        except httpx.TimeoutException:
            logger.error("[%s] request timed out", provider_name)
            metrics.increment_error()
            return JSONResponse(
                status_code=504,
                content={"error": {"message": "Upstream timeout.", "type": "upstream_error"}},
            )
        except httpx.ConnectError as exc:
            logger.error("[%s] connection refused: %s", provider_name, exc)
            metrics.increment_error()
            return JSONResponse(
                status_code=502,
                content={
                    "error": {
                        "message": "Upstream connection refused.",
                        "type": "upstream_error",
                    },
                },
            )
        except Exception as exc:
            logger.error("[%s] unexpected error: %s", provider_name, exc)
            metrics.increment_error()
            return JSONResponse(
                status_code=500,
                content={"error": {"message": "Internal server error.", "type": "internal_error"}},
            )


@app.post("/v1/chat/completions")
async def chat_completions(request: Request, authorization: str | None = Header(None)):
    """Main routing endpoint — OpenAI-compatible chat completions."""
    if not _check_auth(authorization):
        return JSONResponse(
            status_code=401,
            content={"error": {"message": "Invalid API key", "type": "invalid_request_error"}},
        )

    try:
        body = await request.json()
    except Exception:
        return JSONResponse(
            status_code=400,
            content={"error": {"message": "Invalid JSON body", "type": "invalid_request_error"}},
        )

    raw_model: str = body.get("model", "")
    if "/" in raw_model:
        parts = raw_model.split("/", 1)
        provider_name = parts[0]
    else:
        provider_name = raw_model

    if provider_name not in config.providers:
        available = ", ".join(config.providers.keys())
        return JSONResponse(
            status_code=400,
            content={
                "error": {
                    "message": f"Unknown provider '{provider_name}'. Available: {available}",
                    "type": "invalid_request_error",
                }
            },
        )

    return await _process_request(body, provider_name)


@app.get("/health")
@app.get("/")
async def health():
    """Health endpoint with config, router, queue, rate limiter, and metrics status."""
    return JSONResponse(
        content={
            "status": "ok",
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "config": {
                "port": config.port,
                "host": config.host,
                "authEnabled": bool(config.auth_key),
                "providers": {
                    name: {
                        "baseUrl": p.base_url,
                        "keys": len(p.api_keys),
                        "model": config.model_params.get(name, {}).get("model", "not configured"),
                        "minDelayMs": config.provider_min_delays.get(name, config.rotate_delay_ms),
                    }
                    for name, p in config.providers.items()
                },
            },
            "router": router.get_router_status(config.providers),
            "queue": {
                "length": 0,
                "isProcessing": _processing_lock.locked(),
                "rotateDelayMs": config.rotate_delay_ms,
            },
            "rateLimiter": {
                "providerStatus": rate_limiter.get_status(),
                "defaultMinDelayMs": config.rotate_delay_ms,
            },
            "metrics": metrics.get_metrics(),
            "redis": {
                "connected": check_redis(),
                "info": get_redis_info_safe(),
            },
        }
    )


@app.get("/metrics")
async def detailed_metrics():
    """Detailed metrics endpoint."""
    return JSONResponse(content=metrics.get_metrics())


def get_redis_info_safe() -> dict:
    """Return Redis info or empty dict if unavailable."""
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
