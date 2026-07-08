# fusion.py
"""
LiteRouter Fusion Sidecar

Standalone FastAPI service that fronts the existing 7766 gateway and provides a
priority fallback chain for synthetic "fusion" models (e.g. local/google).

Launch with:
    uv run uvicorn fusion:app --host 0.0.0.0 --port 7768

(In scripts/start.sh a tmux pane starts it:
    tmux send-keys -t literouter "uv run uvicorn fusion:app --host 0.0.0.0 --port 7768" C-m)

Design notes:
- This sidecar does NOT import or modify src/main.py, src/router.py, src/config.py or models.json.
- Clients (opencode / pydantic-ai) target this sidecar on :7768.
- For a fusion model it calls the 7766 gateway once per upstream model in the chain,
  reusing 7766's key rotation + cooldowns. It advances to the next upstream only when the
  current one returns 429 (all keys exhausted), 5xx (upstream failure after key rotation),
  or a network error/timeout. It halts (returns the error) on 400/401/403.
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

import httpx
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ValidationError

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

FUSION_PORT = int(os.getenv("FUSION_PORT", "7768"))
FUSION_UPSTREAM_URL = os.getenv("FUSION_UPSTREAM_URL", "http://localhost:7766/v1/chat/completions")

BASE_DIR = Path(__file__).resolve().parent


class FusionGroup(BaseModel):
    description: str
    chain: List[str]


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
            logger.info(f"Loaded fusion group '{group_id}' with chain: {group.chain}")
    except FileNotFoundError:
        logger.error("fusion.json not found at repository root")
        sys.exit(1)
    except ValidationError as e:
        logger.error(f"Invalid fusion.json format: {e}")
        sys.exit(1)

    # 3. Init HTTP client
    http_client = httpx.AsyncClient(timeout=httpx.Timeout(300.0))

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
    # PATH A: Passthrough for non-fusion models (proxied unchanged to 7766)
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
    # PATH B: Fusion fallback logic
    # ---------------------------------------------------------
    chain = fusion_groups[model].chain
    for i, upstream_id in enumerate(chain):
        # Skip an upstream we know is currently cooled; don't re-burn its keys.
        if _circuit_open(upstream_id):
            logger.info(f"{model} {upstream_id} {i + 1}/{len(chain)} circuit-open, skipping")
            continue

        body["model"] = upstream_id
        try:
            req = http_client.build_request(
                "POST", FUSION_UPSTREAM_URL, headers=req_headers, json=body
            )
            resp = await http_client.send(req, stream=True)

            # Advance on 429 (exhausted/cooldown) or 5xx (upstream failure)
            if resp.status_code == 429 or resp.status_code >= 500:
                logger.info(f"{model} {upstream_id} {i + 1}/{len(chain)} -> {resp.status_code}")

                detail = ""
                try:
                    detail = (await resp.aread()).decode("utf-8", "ignore")
                except Exception:
                    pass
                finally:
                    await resp.aclose()  # Guarantee the connection is released

                if "cooldown" in detail or "exhausted quota" in detail:
                    _open_circuit(upstream_id)
                    logger.warning(f"{model} {upstream_id} circuit OPEN (cooldown detected)")
                continue

            # Halt on 400, 401, 403 (client/auth errors)
            if 400 <= resp.status_code < 500 and resp.status_code != 429:
                logger.info(f"{model} {upstream_id} {i + 1}/{len(chain)} halt {resp.status_code}")
                content = await resp.aread()
                return Response(
                    content=content,
                    status_code=resp.status_code,
                    headers=clean_headers(resp.headers),
                )

            # Success (2xx) — recover the model early.
            _close_circuit(upstream_id)
            logger.info(f"{model} {upstream_id} {i+1}/{len(chain)} stream={is_stream}")
            resp_headers = clean_headers(resp.headers)
            resp_headers["X-Literouter-Model"] = upstream_id

            if is_stream:

                async def stream_gen(response):
                    try:
                        async for chunk in response.aiter_raw():
                            yield chunk
                    finally:
                        await response.aclose()

                return StreamingResponse(
                    stream_gen(resp), status_code=resp.status_code, headers=resp_headers
                )
            else:
                content = await resp.aread()
                return Response(content=content, status_code=resp.status_code, headers=resp_headers)

        except (httpx.RequestError, httpx.TimeoutException) as e:
            # Advance on network timeout / connection error to 7766
            logger.info(f"{model} {upstream_id} {i + 1}/{len(chain)} error: {e}")
            continue

    # ---------------------------------------------------------
    # Exhausted all backends
    # ---------------------------------------------------------
    logger.warning(f"fusion group={model} exhausted all backends")
    return JSONResponse(
        status_code=429,
        content={"error": "all fusion backends exhausted", "model": model, "attempted": chain},
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("fusion:app", host="0.0.0.0", port=FUSION_PORT)
