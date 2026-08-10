# fusion.py
"""
LiteRouter Fusion Sidecar

Standalone FastAPI service that fronts the existing 7766 gateway and the 7767 TS
proxy, providing a priority fallback chain ("fusion") for synthetic models such
as local/google and pydantic/google.

Launch with:
    uv run uvicorn fusion:app --host 0.0.0.0 --port 7768

(In scripts/start.sh a tmux pane starts it:
    tmux send-keys -t literouter "uv run uvicorn fusion:app --host 0.0.0.0 --port 7768" C-m)

Design notes:
- This sidecar does NOT import or modify src/main.py, src/router.py, src/config.py or models.json.
- Clients (opencode / pydantic-ai) target this sidecar on :7768.
- For a fusion-group model it calls the configured upstream once per upstream model
  in the chain, reusing the upstream's key rotation + cooldowns. It advances to the
  next upstream only when the current one returns 429 (all keys exhausted), 5xx
  (upstream failure after key rotation), or a network error/timeout. It halts
  (returns the error) on 400/401/403.
- Routing is by FUSION GROUP, not by entry path. Each group in fusion.json declares
  its own `upstream` URL; the protocol (native /v1beta vs OpenAI-compat /v1) is
  inferred from that URL. This lets one group forward to the TS proxy natively
  (local/google -> 7767/v1beta) while another forwards OpenAI-compat payloads to the
  Python gateway (pydantic/google -> 7766/v1).
- Every successful response carries X-Literouter-Model = the upstream that served it.
"""

import json
import logging
import os
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, AsyncIterator, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()

import httpx  # noqa: E402
from fastapi import FastAPI, Request, Response  # noqa: E402
from fastapi.responses import JSONResponse, StreamingResponse  # noqa: E402
from pydantic import BaseModel, ValidationError  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

FUSION_PORT = int(os.getenv("FUSION_PORT", "7768"))
FUSION_UPSTREAM_URL = os.getenv("FUSION_UPSTREAM_URL", "http://localhost:7766/v1/chat/completions")
FUSION_UPSTREAM_URL_NATIVE = os.getenv("FUSION_UPSTREAM_URL_NATIVE", "http://localhost:7766/v1beta")

BASE_DIR = Path(__file__).resolve().parent


class FusionGroup(BaseModel):
    description: str
    chain: List[str]
    upstream: Optional[str] = None  # per-group upstream; protocol inferred from URL


fusion_groups: Dict[str, FusionGroup] = {}
http_client: Optional[httpx.AsyncClient] = None

# Per-model circuit breaker: mirrors the gateway's 65s rate-limit cooldown.
# A model that returns a "all keys cooled/exhausted" 429 is skipped for this window
# across requests, so the sidecar stops re-burning its keys and freezing the trio.
CIRCUIT_TTL = 65.0
circuit_open_until: Dict[str, float] = {}


def _open_circuit(upstream_id: str) -> None:
    circuit_open_until[upstream_id] = time.time() + CIRCUIT_TTL


def _circuit_open(upstream_id: str) -> bool:
    return time.time() < circuit_open_until.get(upstream_id, 0.0)


def _close_circuit(upstream_id: str) -> None:
    circuit_open_until.pop(upstream_id, None)


# Sticky fallback: once the chain falls back to a lower-priority model,
# subsequent requests start from that position instead of from the top.
# This gives higher-priority models real cooldown time (not just 65s).
STICKY_TTL = 300.0  # 5 minutes
sticky_position: Dict[str, tuple[str, float]] = {}  # group_id -> (upstream_id, expiry_time)


def _get_sticky_start(group_id: str, chain: List[str]) -> int:
    """Return chain index to start from. 0 = start from top (no stickiness)."""
    entry = sticky_position.get(group_id)
    if entry is None:
        return 0
    upstream_id, expiry = entry
    if time.time() >= expiry:
        del sticky_position[group_id]
        logger.info(f"{group_id} sticky {upstream_id} expired, will try higher-priority models")
        return 0
    try:
        idx = chain.index(upstream_id)
        if idx > 0:
            logger.info(
                f"{group_id} sticky at {upstream_id} (idx {idx}), "
                f"skipping {idx} higher model(s)"
            )
        return idx
    except ValueError:
        sticky_position.pop(group_id, None)
        return 0


def _set_sticky(group_id: str, upstream_id: str) -> None:
    sticky_position[group_id] = (upstream_id, time.time() + STICKY_TTL)
    logger.info(f"{group_id} sticky set to {upstream_id} for {STICKY_TTL:.0f}s")


def _clear_sticky(group_id: str) -> None:
    sticky_position.pop(group_id, None)


def _resolve_upstream(group: FusionGroup, path_is_native: bool) -> tuple[str, str]:
    """Return (upstream_url, protocol) for a fusion group.

    protocol is inferred from the group's `upstream` URL: a URL containing
    '/v1beta' is treated as the native Google SDK endpoint; anything else is
    treated as an OpenAI-compat /chat/completions endpoint. Falls back to the
    legacy global per-path URL when a group omits `upstream`.
    """
    if group.upstream:
        if "/v1beta" in group.upstream:
            return group.upstream, "native"
        return group.upstream, "openai"
    if path_is_native:
        return FUSION_UPSTREAM_URL_NATIVE, "native"
    return FUSION_UPSTREAM_URL, "openai"


def _load_fusion_config() -> tuple[set[str], Dict[str, FusionGroup]]:
    """Load models.json and fusion.json, validate chain ids against registry."""
    with open(BASE_DIR / "models.json", "r") as f:
        models_data = json.load(f)
    valid_system_ids = {m["system_id"] for m in models_data}
    with open(BASE_DIR / "fusion.json", "r") as f:
        fusion_data = json.load(f)
    groups: Dict[str, FusionGroup] = {}
    for group_id, group_data in fusion_data.items():
        group = FusionGroup(**group_data)
        for model_id in group.chain:
            if model_id not in valid_system_ids:
                logger.error(
                    f"Model '{model_id}' in fusion group '{group_id}' not found in models.json"
                )
                sys.exit(1)
        groups[group_id] = group
        logger.info(
            f"Loaded fusion group '{group_id}' chain={group.chain} upstream={group.upstream}"
        )
    return valid_system_ids, groups


def _init_http_client() -> httpx.AsyncClient:
    """Create the shared httpx async client from env config."""
    timeout = float(os.getenv("LITEROUTER_HTTP_TIMEOUT", "300"))
    return httpx.AsyncClient(timeout=httpx.Timeout(timeout))


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    global fusion_groups, http_client
    try:
        _load_fusion_config()
    except FileNotFoundError:
        logger.error("fusion.json not found at repository root")
        sys.exit(1)
    except ValidationError as e:
        logger.error(f"Invalid fusion.json format: {e}")
        sys.exit(1)
    http_client = _init_http_client()
    yield
    await http_client.aclose()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


def clean_headers(headers: httpx.Headers) -> dict[str, Any]:
    """Remove hop-by-hop headers before returning the response to the client."""
    h = dict(headers)
    for key in ["content-encoding", "content-length", "transfer-encoding", "connection"]:
        h.pop(key, None)
    return h


def _build_forward_headers(request: Request) -> dict[str, str]:
    """Extract Authorization and Content-Type from the incoming request."""
    req_headers: dict[str, str] = {}
    if "authorization" in request.headers:
        req_headers["authorization"] = request.headers["authorization"]
    if "content-type" in request.headers:
        req_headers["content-type"] = request.headers["content-type"]
    return req_headers


async def _advance_on_error(
    resp: httpx.Response,
    group_id: str,
    upstream_id: str,
    idx: int,
    chain_len: int,
) -> bool:
    """Log, close, and circuit-open on 429/5xx. Returns True to advance."""
    logger.info(f"{group_id} {upstream_id} {idx + 1}/{chain_len} -> {resp.status_code}")
    detail = ""
    try:
        detail = (await resp.aread()).decode("utf-8", "ignore")
    except Exception as e:
        logger.debug(f"{group_id} {upstream_id} error reading response body: {e}")
    finally:
        await resp.aclose()
    if "cooldown" in detail or "exhausted quota" in detail:
        _open_circuit(upstream_id)
        logger.warning(f"{group_id} {upstream_id} circuit OPEN (cooldown detected)")
    return True


async def _halt_on_client_error(resp: httpx.Response) -> Response:
    """Return a verbatim Response for 4xx (non-429) errors."""
    content = await resp.aread()
    return Response(
        content=content,
        status_code=resp.status_code,
        headers=clean_headers(resp.headers),
    )


def _success_postprocess(
    group_id: str,
    upstream_id: str,
    idx: int,
) -> None:
    """Close circuit and set sticky on a successful upstream response."""
    _close_circuit(upstream_id)
    if idx > 0:
        _set_sticky(group_id, upstream_id)
    else:
        _clear_sticky(group_id)


def _build_response_headers(
    resp: httpx.Response, upstream_id: str
) -> dict[str, Any]:
    """Clean upstream headers and inject X-Literouter-Model."""
    resp_headers = clean_headers(resp.headers)
    resp_headers["X-Literouter-Model"] = upstream_id
    return resp_headers


async def _openai_stream_or_halt(
    resp: httpx.Response,
    resp_headers: dict[str, Any],
    group_id: str,
    upstream_id: str,
    idx: int,
    chain_len: int,
) -> Any:
    """Return StreamingResponse on success, True to advance on empty stream."""
    raw_it = resp.aiter_raw()
    try:
        first_chunk = await raw_it.__anext__()
    except StopAsyncIteration:
        await resp.aclose()
        logger.warning(
            f"{group_id} {upstream_id} {idx + 1}/{chain_len} empty stream, advancing"
        )
        return True
    except Exception as e:
        await resp.aclose()
        logger.warning(
            f"{group_id} {upstream_id} {idx + 1}/{chain_len} early stream failure: {e}, advancing"
        )
        return True

    async def stream_gen(response: httpx.Response, it: Any, first: bytes) -> AsyncIterator[bytes]:
        try:
            yield first
            async for chunk in it:
                yield chunk
        except Exception as ex:
            logger.error(f"upstream stream broken mid-stream (model={upstream_id}): {ex}")
        finally:
            await response.aclose()

    return StreamingResponse(
        stream_gen(resp, raw_it, first_chunk),
        status_code=resp.status_code,
        headers=resp_headers,
    )


async def _native_stream_or_halt(
    resp: httpx.Response,
    upstream_id: str,
    group_id: str,
    idx: int,
    chain_len: int,
) -> Any:
    """Return StreamingResponse on success, True to advance on empty stream."""
    native_it = resp.aiter_bytes()
    try:
        first_chunk = await native_it.__anext__()
    except StopAsyncIteration:
        await resp.aclose()
        logger.warning(
            f"{group_id} {upstream_id} {idx + 1}/{chain_len} empty stream, advancing"
        )
        return True
    except Exception as e:
        await resp.aclose()
        logger.warning(
            f"{group_id} {upstream_id} {idx + 1}/{chain_len} early stream failure: {e}, advancing"
        )
        return True
    _success_postprocess(group_id, upstream_id, idx)
    logger.info(f"{group_id} {upstream_id} {idx + 1}/{chain_len} native action=generateContent")
    return _relay_native(resp, upstream_id, native_it, first_chunk)


async def _send_openai_request(
    group_id: str,
    upstream_id: str,
    idx: int,
    chain_len: int,
    body: dict[str, Any],
    req_headers: dict[str, str],
    upstream: str,
) -> Optional[httpx.Response]:
    """Build and send an OpenAI-compat upstream request. Returns resp or None on error."""
    assert http_client is not None
    body["model"] = upstream_id
    try:
        req = http_client.build_request("POST", upstream, headers=req_headers, json=body)
        return await http_client.send(req, stream=True)
    except (httpx.RequestError, httpx.TimeoutException) as e:
        logger.info(f"{group_id} {upstream_id} {idx + 1}/{chain_len} error: {e}")
        return None


async def _classify_response(
    resp: httpx.Response,
    group_id: str,
    upstream_id: str,
    idx: int,
    chain_len: int,
) -> Any:
    """Classify an upstream response. Returns 'advance', 'halt', or 'success'."""
    # Advance on 429 or 5xx
    if resp.status_code == 429 or resp.status_code >= 500:
        return await _advance_on_error(resp, group_id, upstream_id, idx, chain_len)
    # Halt on 400/401/403
    if 400 <= resp.status_code < 500:
        logger.info(f"{group_id} {upstream_id} {idx + 1}/{chain_len} halt {resp.status_code}")
        return await _halt_on_client_error(resp)
    return "success"


async def _openai_success_path(
    resp: httpx.Response,
    group_id: str,
    upstream_id: str,
    idx: int,
    chain: List[str],
    is_stream: bool,
) -> Any:
    """Handle the success path after classification for OpenAI upstreams."""
    _success_postprocess(group_id, upstream_id, idx)
    resp_headers = _build_response_headers(resp, upstream_id)
    logger.info(f"{group_id} {upstream_id} {idx+1}/{len(chain)} stream={is_stream}")
    if is_stream:
        return await _openai_stream_or_halt(
            resp, resp_headers, group_id, upstream_id, idx, len(chain)
        )
    content = await resp.aread()
    return Response(content=content, status_code=resp.status_code, headers=resp_headers)


async def _process_openai_upstream(
    group_id: str,
    chain: List[str],
    body: dict[str, Any],
    req_headers: dict[str, str],
    is_stream: bool,
    upstream: str,
    idx: int,
    upstream_id: str,
) -> Any:
    """Attempt a single upstream model in the OpenAI-compat fusion chain."""
    if _circuit_open(upstream_id):
        logger.info(f"{group_id} {upstream_id} {idx + 1}/{len(chain)} circuit-open, skipping")
        return True
    body["model"] = upstream_id
    resp = await _send_openai_request(
        group_id, upstream_id, idx, len(chain), body, req_headers, upstream
    )
    if resp is None:
        return True
    classified = await _classify_response(resp, group_id, upstream_id, idx, len(chain))
    if classified != "success":
        return classified
    return await _openai_success_path(resp, group_id, upstream_id, idx, chain, is_stream)


async def _process_native_upstream(
    group_id: str,
    chain: List[str],
    query: dict[str, str],
    req_headers: dict[str, Any],
    body_bytes: bytes,
    upstream: str,
    idx: int,
    upstream_id: str,
    action: str,
) -> Any:
    """Attempt a single upstream model in the native Google SDK fusion chain."""
    assert http_client is not None
    if _circuit_open(upstream_id):
        logger.info(f"{group_id} {upstream_id} {idx + 1}/{len(chain)} circuit-open, skipping")
        return True
    target = f"{upstream}/models/{upstream_id}:{action}"
    try:
        req = http_client.build_request(
            "POST", target, params=query, headers=req_headers, content=body_bytes
        )
        resp = await http_client.send(req, stream=True)
    except (httpx.RequestError, httpx.TimeoutException) as e:
        logger.info(f"{group_id} {upstream_id} {idx + 1}/{len(chain)} error: {e}")
        return True
    classified = await _classify_response(resp, group_id, upstream_id, idx, len(chain))
    if classified != "success":
        return classified
    return await _native_stream_or_halt(resp, upstream_id, group_id, idx, len(chain))


async def _run_openai_fusion(
    group_id: str,
    chain: List[str],
    body: dict[str, Any],
    req_headers: dict[str, str],
    is_stream: bool,
    upstream: str,
) -> Any:
    """Fusion fallback for an OpenAI-compat upstream (/v1/chat/completions)."""
    assert http_client is not None
    start_idx = _get_sticky_start(group_id, chain)
    for i, upstream_id in enumerate(chain):
        if i < start_idx:
            continue
        result = await _process_openai_upstream(
            group_id, chain, body, req_headers, is_stream, upstream, i, upstream_id
        )
        if isinstance(result, bool):
            continue
        return result
    logger.warning(f"fusion group={group_id} exhausted all backends")
    return JSONResponse(
        status_code=429,
        content={"error": "all fusion backends exhausted", "model": group_id, "attempted": chain},
    )


async def _run_native_fusion(
    group_id: str,
    chain: List[str],
    action: str,
    query: dict[str, str],
    req_headers: dict[str, Any],
    body_bytes: bytes,
    upstream: str,
) -> Any:
    """Fusion fallback for a native Google SDK upstream (/v1beta/models/...:action)."""
    assert http_client is not None
    start_idx = _get_sticky_start(group_id, chain)
    for i, upstream_id in enumerate(chain):
        if i < start_idx:
            continue
        result = await _process_native_upstream(
            group_id, chain, query, req_headers, body_bytes, upstream, i, upstream_id, action
        )
        if isinstance(result, bool):
            continue
        return result
    logger.warning(f"fusion group={group_id} exhausted all backends")
    return JSONResponse(
        status_code=429,
        content={"error": "all fusion backends exhausted", "model": group_id, "attempted": chain},
    )


@app.post("/v1/chat/completions")
async def chat_completions(request: Request) -> Any:
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)
    model = body.get("model")
    if not model:
        return JSONResponse({"error": "Missing 'model' in request"}, status_code=400)
    req_headers = _build_forward_headers(request)
    is_stream = bool(body.get("stream"))
    if model not in fusion_groups:
        return await _passthrough_openai(body, req_headers, is_stream)
    return await _dispatch_fusion(model, body, req_headers, is_stream, request, False)


async def _passthrough_openai(
    body: dict[str, Any], req_headers: dict[str, str], is_stream: bool
) -> Any:
    """Dumb forwarder for non-fusion models through the /v1/chat/completions path."""
    assert http_client is not None
    try:
        req = http_client.build_request(
            "POST", FUSION_UPSTREAM_URL, headers=req_headers, json=body
        )
        resp = await http_client.send(req, stream=True)
        return await _openai_passthrough_response(resp, body, req_headers, is_stream)
    except Exception as e:
        model = body.get("model", "unknown")
        logger.error(f"Passthrough error for {model}: {e}")
        return JSONResponse({"error": "Bad Gateway", "details": str(e)}, status_code=502)


async def _openai_passthrough_response(
    resp: httpx.Response, body: dict[str, Any], req_headers: dict[str, str], is_stream: bool
) -> Any:
    """Build the passthrough response for OpenAI-compat non-fusion models."""
    if is_stream:
        async def stream_gen(response: httpx.Response) -> AsyncIterator[bytes]:
            try:
                async for chunk in response.aiter_raw():
                    yield chunk
            finally:
                await response.aclose()
        return StreamingResponse(
            stream_gen(resp),
            status_code=resp.status_code,
            headers=clean_headers(resp.headers),
        )
    content = await resp.aread()
    return Response(
        content=content,
        status_code=resp.status_code,
        headers=clean_headers(resp.headers),
    )


async def _dispatch_fusion(
    model: str,
    body: dict[str, Any],
    req_headers: dict[str, str],
    is_stream: bool,
    request: Request,
    path_is_native: bool,
) -> Any:
    """Route a fusion-group model to the appropriate protocol handler."""
    group = fusion_groups[model]
    upstream, protocol = _resolve_upstream(group, path_is_native)
    if protocol == "native":
        body_bytes = (await request.body()) or b"{}"
        return await _run_native_fusion(
            group_id=model,
            chain=group.chain,
            action="generateContent",
            query=dict(request.query_params),
            req_headers=req_headers,
            body_bytes=body_bytes,
            upstream=upstream,
        )
    return await _run_openai_fusion(
        group_id=model,
        chain=group.chain,
        body=body,
        req_headers=req_headers,
        is_stream=is_stream,
        upstream=upstream,
    )


@app.post("/v1beta/models/{model_name_and_action:path}")
@app.post("/v1beta/{model_name_and_action:path}")
async def fusion_native(model_name_and_action: str, request: Request) -> Any:
    """
    Native Google proxy that mirrors 7766's /v1beta route. Dumb forwarder for
    non-fusion models; for a fusion-group model it substitutes the upstream model
    in the URL and rotates across the chain on 429/5xx. The protocol (native vs
    OpenAI-compat) is taken from the fusion group's `upstream`, so a group such as
    pydantic/google entered here still forwards its OpenAI payload correctly.
    """
    assert http_client is not None
    model_name, action = _parse_native_path(model_name_and_action)
    req_headers = _build_native_forward_headers(request)
    query = dict(request.query_params)
    body_bytes = await request.body()
    if model_name not in fusion_groups:
        return await _passthrough_native(model_name, action, req_headers, query, body_bytes)
    group = fusion_groups[model_name]
    upstream, protocol = _resolve_upstream(group, True)
    if protocol == "native":
        return await _run_native_fusion(
            group_id=model_name,
            chain=group.chain,
            action=action,
            query=query,
            req_headers=req_headers,
            body_bytes=body_bytes,
            upstream=upstream,
        )
    body = _parse_body_bytes(body_bytes)
    is_stream = bool(body.get("stream"))
    return await _run_openai_fusion(
        group_id=model_name,
        chain=group.chain,
        body=body,
        req_headers=req_headers,
        is_stream=is_stream,
        upstream=upstream,
    )


def _parse_native_path(model_name_and_action: str) -> tuple[str, str]:
    """Split 'model:action' path into (model_name, action)."""
    if ":" in model_name_and_action:
        model_name, action = model_name_and_action.split(":", 1)
    else:
        model_name, action = model_name_and_action, "generateContent"
    if model_name.startswith("models/"):
        model_name = model_name[len("models/"):]
    return model_name, action


def _build_native_forward_headers(request: Request) -> dict[str, str]:
    """Build headers for native forwarder, stripping hop-by-hop fields."""
    return {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length")
    }


def _parse_body_bytes(body_bytes: bytes) -> dict[str, Any]:
    """Safely parse JSON body bytes into a dict."""
    try:
        body = json.loads(body_bytes) if body_bytes else {}
    except Exception:
        body = {}
    return body


async def _passthrough_native(
    model_name: str,
    action: str,
    req_headers: dict[str, str],
    query: dict[str, str],
    body_bytes: bytes,
) -> Any:
    """Dumb forwarder for non-fusion models through the /v1beta path."""
    assert http_client is not None
    target = f"{FUSION_UPSTREAM_URL_NATIVE}/models/{model_name}:{action}"
    try:
        req = http_client.build_request(
            "POST", target, params=query, headers=req_headers, content=body_bytes
        )
        resp = await http_client.send(req, stream=True)
        return _relay_native(resp, None)
    except Exception as e:
        logger.error(f"fusion native passthrough error for {model_name}: {e}")
        return JSONResponse({"error": "Bad Gateway", "details": str(e)}, status_code=502)


def _relay_native(
    resp: httpx.Response,
    served_model: Optional[str],
    iterator: Optional[Any] = None,
    first_chunk: Optional[bytes] = None,
) -> StreamingResponse:
    """Stream a native upstream response back to the client, unchanged.

    `iterator` is the already-started async iterator (resp.aiter_bytes()).
    `first_chunk` is the chunk already consumed from `iterator` for early-failure
    detection; it is yielded first so the remainder of `iterator` continues
    seamlessly. Mid-stream transport errors are caught and logged rather than
    crashing the request handler with a raw traceback.
    """
    headers = clean_headers(resp.headers)
    if served_model:
        headers["X-Literouter-Model"] = served_model
    if iterator is None:
        iterator = resp.aiter_bytes()

    async def stream_gen() -> AsyncIterator[bytes]:
        try:
            if first_chunk is not None:
                yield first_chunk
            async for chunk in iterator:
                yield chunk
        except Exception as e:
            logger.error(f"upstream stream broken mid-stream (model={served_model}): {e}")
        finally:
            await resp.aclose()

    return StreamingResponse(stream_gen(), status_code=resp.status_code, headers=headers)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("fusion:app", host="0.0.0.0", port=FUSION_PORT)
