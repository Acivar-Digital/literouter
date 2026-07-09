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
from typing import Dict, List, Optional

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


def _resolve_upstream(group: FusionGroup, path_is_native: bool):
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    global fusion_groups, http_client

    # 1. Load models.json (read-only validation of chain ids)
    try:
        with open(BASE_DIR / "models.json", "r") as f:
            models_data = json.load(f)
        valid_system_ids = {m["system_id"] for m in models_data}
    except Exception as e:
        logger.error(f"Failed to load models.json: {e}")
        sys.exit(1)

    # 2. Load fusion.json
    try:
        with open(BASE_DIR / "fusion.json", "r") as f:
            fusion_data = json.load(f)

        for group_id, group_data in fusion_data.items():
            group = FusionGroup(**group_data)
            for model_id in group.chain:
                if model_id not in valid_system_ids:
                    logger.error(
                        f"Model '{model_id}' in fusion group '{group_id}' not found in models.json"
                    )
                    sys.exit(1)
            fusion_groups[group_id] = group
            logger.info(
                f"Loaded fusion group '{group_id}' chain={group.chain} upstream={group.upstream}"
            )
    except FileNotFoundError:
        logger.error("fusion.json not found at repository root")
        sys.exit(1)
    except ValidationError as e:
        logger.error(f"Invalid fusion.json format: {e}")
        sys.exit(1)

    # 3. Init HTTP client
    http_timeout = float(os.getenv("LITEROUTER_HTTP_TIMEOUT", "300"))
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(http_timeout))

    yield

    await http_client.aclose()


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


def clean_headers(headers: httpx.Headers) -> dict:
    """Remove hop-by-hop headers before returning the response to the client."""
    h = dict(headers)
    for key in ["content-encoding", "content-length", "transfer-encoding", "connection"]:
        h.pop(key, None)
    return h


async def _run_openai_fusion(
    group_id: str,
    chain: List[str],
    body: dict,
    req_headers: dict,
    is_stream: bool,
    upstream: str,
):
    """Fusion fallback for an OpenAI-compat upstream (/v1/chat/completions)."""
    start_idx = _get_sticky_start(group_id, chain)
    for i, upstream_id in enumerate(chain):
        if i < start_idx:
            continue

        if _circuit_open(upstream_id):
            logger.info(f"{group_id} {upstream_id} {i + 1}/{len(chain)} circuit-open, skipping")
            continue

        body["model"] = upstream_id
        try:
            req = http_client.build_request(
                "POST", upstream, headers=req_headers, json=body
            )
            resp = await http_client.send(req, stream=True)

            # Advance on 429 (exhausted/cooldown) or 5xx (upstream failure)
            if resp.status_code == 429 or resp.status_code >= 500:
                logger.info(f"{group_id} {upstream_id} {i + 1}/{len(chain)} -> {resp.status_code}")

                detail = ""
                try:
                    detail = (await resp.aread()).decode("utf-8", "ignore")
                except Exception:
                    pass
                finally:
                    await resp.aclose()  # Guarantee the connection is released

                if "cooldown" in detail or "exhausted quota" in detail:
                    _open_circuit(upstream_id)
                    logger.warning(f"{group_id} {upstream_id} circuit OPEN (cooldown detected)")
                continue

            # Halt on 400, 401, 403 (client/auth errors)
            if 400 <= resp.status_code < 500 and resp.status_code != 429:
                logger.info(f"{group_id} {upstream_id} {i + 1}/{len(chain)} halt {resp.status_code}")
                content = await resp.aread()
                return Response(
                    content=content,
                    status_code=resp.status_code,
                    headers=clean_headers(resp.headers),
                )

            # Success (2xx) — recover the model early.
            _close_circuit(upstream_id)
            if i > 0:
                _set_sticky(group_id, upstream_id)
            else:
                _clear_sticky(group_id)
            logger.info(f"{group_id} {upstream_id} {i+1}/{len(chain)} stream={is_stream}")
            resp_headers = clean_headers(resp.headers)
            resp_headers["X-Literouter-Model"] = upstream_id

            if is_stream:
                raw_it = resp.aiter_raw()
                try:
                    first_chunk = await raw_it.__anext__()
                except StopAsyncIteration:
                    await resp.aclose()
                    logger.warning(
                        f"{group_id} {upstream_id} {i + 1}/{len(chain)} empty stream, advancing"
                    )
                    continue
                except Exception as e:
                    await resp.aclose()
                    logger.warning(
                        f"{group_id} {upstream_id} {i + 1}/{len(chain)} "
                        f"early stream failure: {e}, advancing"
                    )
                    continue

                async def stream_gen(response, it, first):
                    try:
                        yield first
                        async for chunk in it:
                            yield chunk
                    except Exception as ex:
                        logger.error(
                            f"upstream stream broken mid-stream (model={upstream_id}): {ex}"
                        )
                    finally:
                        await response.aclose()

                return StreamingResponse(
                    stream_gen(resp, raw_it, first_chunk),
                    status_code=resp.status_code,
                    headers=resp_headers,
                )
            else:
                content = await resp.aread()
                return Response(content=content, status_code=resp.status_code, headers=resp_headers)

        except (httpx.RequestError, httpx.TimeoutException) as e:
            # Advance on network timeout / connection error to upstream
            logger.info(f"{group_id} {upstream_id} {i + 1}/{len(chain)} error: {e}")
            continue

    logger.warning(f"fusion group={group_id} exhausted all backends")
    return JSONResponse(
        status_code=429,
        content={"error": "all fusion backends exhausted", "model": group_id, "attempted": chain},
    )


async def _run_native_fusion(
    group_id: str,
    chain: List[str],
    model_name: str,
    action: str,
    query: dict,
    req_headers: dict,
    body_bytes: bytes,
    upstream: str,
):
    """Fusion fallback for a native Google SDK upstream (/v1beta/models/...:action)."""
    start_idx = _get_sticky_start(group_id, chain)
    for i, upstream_id in enumerate(chain):
        if i < start_idx:
            continue

        if _circuit_open(upstream_id):
            logger.info(f"{group_id} {upstream_id} {i + 1}/{len(chain)} circuit-open, skipping")
            continue

        target = f"{upstream}/models/{upstream_id}:{action}"
        try:
            req = http_client.build_request(
                "POST", target, params=query, headers=req_headers, content=body_bytes
            )
            resp = await http_client.send(req, stream=True)
        except (httpx.RequestError, httpx.TimeoutException) as e:
            logger.info(f"{group_id} {upstream_id} {i + 1}/{len(chain)} error: {e}")
            continue

        # Advance on 429 (exhausted/cooldown) or 5xx (upstream failure)
        if resp.status_code == 429 or resp.status_code >= 500:
            logger.info(f"{group_id} {upstream_id} {i + 1}/{len(chain)} -> {resp.status_code}")
            detail = ""
            try:
                detail = (await resp.aread()).decode("utf-8", "ignore")
            except Exception:
                pass
            finally:
                await resp.aclose()
            if "cooldown" in detail or "exhausted quota" in detail:
                _open_circuit(upstream_id)
                logger.warning(f"{group_id} {upstream_id} circuit OPEN (cooldown detected)")
            continue

        # Halt on 400, 401, 403 (client/auth errors) — return verbatim
        if 400 <= resp.status_code < 500 and resp.status_code != 429:
            logger.info(f"{group_id} {upstream_id} {i + 1}/{len(chain)} halt {resp.status_code}")
            content = await resp.aread()
            return Response(
                content=content,
                status_code=resp.status_code,
                headers=clean_headers(resp.headers),
            )

        # Success — read the first chunk NOW so an upstream that closes the
        # stream before emitting any bytes (e.g. Google dropping the SSE early)
        # falls back to the next chain model instead of poisoning the client
        # stream with a truncated / broken response.
        native_it = resp.aiter_bytes()
        try:
            first_chunk = await native_it.__anext__()
        except StopAsyncIteration:
            await resp.aclose()
            logger.warning(
                f"{group_id} {upstream_id} {i + 1}/{len(chain)} empty stream, advancing"
            )
            continue
        except Exception as e:
            await resp.aclose()
            logger.warning(
                f"{group_id} {upstream_id} {i + 1}/{len(chain)} "
                f"early stream failure: {e}, advancing"
            )
            continue

        _close_circuit(upstream_id)
        if i > 0:
            _set_sticky(group_id, upstream_id)
        else:
            _clear_sticky(group_id)
        logger.info(f"{group_id} {upstream_id} {i + 1}/{len(chain)} native action={action}")
        return _relay_native(resp, upstream_id, native_it, first_chunk)

    logger.warning(f"fusion group={group_id} exhausted all backends")
    return JSONResponse(
        status_code=429,
        content={"error": "all fusion backends exhausted", "model": group_id, "attempted": chain},
    )


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "Invalid JSON body"}, status_code=400)

    model = body.get("model")
    if not model:
        return JSONResponse({"error": "Missing 'model' in request"}, status_code=400)

    # Forward Authorization and Content-Type headers unchanged
    req_headers = {}
    if "authorization" in request.headers:
        req_headers["authorization"] = request.headers["authorization"]
    if "content-type" in request.headers:
        req_headers["content-type"] = request.headers["content-type"]

    is_stream = bool(body.get("stream"))

    # ---------------------------------------------------------
    # PATH A: Passthrough for non-fusion models (proxied unchanged)
    # ---------------------------------------------------------
    if model not in fusion_groups:
        try:
            req = http_client.build_request(
                "POST", FUSION_UPSTREAM_URL, headers=req_headers, json=body
            )
            resp = await http_client.send(req, stream=True)

            if is_stream:

                async def stream_gen(response):
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
            else:
                content = await resp.aread()
                return Response(
                    content=content,
                    status_code=resp.status_code,
                    headers=clean_headers(resp.headers),
                )
        except Exception as e:
            logger.error(f"Passthrough error for {model}: {e}")
            return JSONResponse({"error": "Bad Gateway", "details": str(e)}, status_code=502)

    # ---------------------------------------------------------
    # PATH B: Fusion group — route by the group's protocol
    # ---------------------------------------------------------
    group = fusion_groups[model]
    upstream, protocol = _resolve_upstream(group, False)
    if protocol == "native":
        body_bytes = (await request.body()) or b"{}"
        return await _run_native_fusion(
            group_id=model,
            chain=group.chain,
            model_name=model,
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
async def fusion_native(model_name_and_action: str, request: Request):
    """
    Native Google proxy that mirrors 7766's /v1beta route. Dumb forwarder for
    non-fusion models; for a fusion-group model it substitutes the upstream model
    in the URL and rotates across the chain on 429/5xx. The protocol (native vs
    OpenAI-compat) is taken from the fusion group's `upstream`, so a group such as
    pydantic/google entered here still forwards its OpenAI payload correctly.
    """
    if ":" in model_name_and_action:
        model_name, action = model_name_and_action.split(":", 1)
    else:
        model_name, action = model_name_and_action, "generateContent"

    # Strip 'models/' prefix if the client included it in the path
    if model_name.startswith("models/"):
        model_name = model_name[len("models/"):]

    req_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length")
    }
    query = dict(request.query_params)
    body_bytes = await request.body()

    # Non-fusion model -> straight dumb forward as-is
    if model_name not in fusion_groups:
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

    # Fusion group -> route by the group's protocol
    group = fusion_groups[model_name]
    upstream, protocol = _resolve_upstream(group, True)
    if protocol == "native":
        return await _run_native_fusion(
            group_id=model_name,
            chain=group.chain,
            model_name=model_name,
            action=action,
            query=query,
            req_headers=req_headers,
            body_bytes=body_bytes,
            upstream=upstream,
        )

    # OpenAI-compat group entered via /v1beta: parse body, run openai fusion
    try:
        body = json.loads(body_bytes) if body_bytes else {}
    except Exception:
        body = {}
    is_stream = bool(body.get("stream"))
    return await _run_openai_fusion(
        group_id=model_name,
        chain=group.chain,
        body=body,
        req_headers=req_headers,
        is_stream=is_stream,
        upstream=upstream,
    )


def _relay_native(
    resp: httpx.Response,
    served_model: Optional[str],
    iterator=None,
    first_chunk=None,
):
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

    async def stream_gen():
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
