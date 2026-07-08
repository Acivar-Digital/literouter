"""
FastAPI Core, Streaming Normalization, Client Pool, & Failover Loop
"""

import asyncio
import json
import logging
import time
from collections import deque
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

import httpx
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from src.config import (
    GOOGLE_API_KEYS,
    LITEROUTER_AUTH_KEY,
    LITEROUTER_COLLAPSE_REASONING,
    LITEROUTER_HOST,
    LITEROUTER_PORT,
    MODEL_REGISTRY,
    NVIDIA_API_KEYS,
    OPENROUTER_API_KEYS,
    ZEN_API_KEYS,
    ZEN_BASE_URL,
)
from src.router import ModelFirstRouter, NoDeploymentsAvailable, estimate_tokens

logger = logging.getLogger("gateway")

# Bounded queue to track metrics and operational warnings without memory leaks
metrics_history = deque(maxlen=5000)

router = ModelFirstRouter(GOOGLE_API_KEYS, NVIDIA_API_KEYS, OPENROUTER_API_KEYS, ZEN_API_KEYS)
http_client: httpx.AsyncClient | None = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage lifecycle of persistent resources (HTTP connection pool and Redis connection).
    """
    global http_client
    await router.connect()
    # Configure custom high-performance connection pool parameters
    limits = httpx.Limits(max_keepalive_connections=100, max_connections=500)
    timeout = httpx.Timeout(connect=5.0, read=15.0, write=10.0, pool=5.0)
    http_client = httpx.AsyncClient(limits=limits, timeout=timeout)
    logger.info("Persistent Gateway Connection Pools initialized.")
    yield
    await http_client.aclose()
    await router.disconnect()
    logger.info("Persistent Gateway Connection Pools clean shutdown.")

app = FastAPI(lifespan=lifespan, title="LiteRouter API Gateway")

async def verify_auth_key(request: Request):
    """
    Security gate verifying the caller against Gateway secret token rules.
    Supports standard Bearer Token, x-goog-api-key header, and key query param.
    """
    if not LITEROUTER_AUTH_KEY:
        return

    # 1. Check standard Bearer token in Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header.split("Bearer ")[1].strip()
        if token == LITEROUTER_AUTH_KEY:
            return

    # 2. Check x-goog-api-key header (used by Google native SDKs)
    goog_key_header = request.headers.get("x-goog-api-key", "")
    if goog_key_header.strip() == LITEROUTER_AUTH_KEY:
        return

    # 3. Check key query parameter (used by some Google SDK calls)
    query_key = request.query_params.get("key", "")
    if query_key.strip() == LITEROUTER_AUTH_KEY:
        return

    raise HTTPException(status_code=401, detail="Unauthorized client credentials")


def _clean_gemma_payload(data: Any) -> Any:
    """
    Recursively strips thinkingConfig and thinking_config properties to prevent engine crashes.
    """
    if isinstance(data, dict):
        return {
            k: _clean_gemma_payload(v)
            for k, v in data.items()
            if k not in ("thinkingConfig", "thinking_config")
        }
    elif isinstance(data, list):
        return [_clean_gemma_payload(item) for item in data]
    return data

def _clean_latex_symbols_bytes(chunk: bytes) -> bytes:
    """Replaces raw LaTeX arrow and multiplication notations with clean unicode symbols."""
    import re
    # Clean multiplication enclosures (e.g. $\times 1.5$ -> × 1.5)
    # Supports 1 or 2 backslashes
    chunk = re.sub(br'\$\\{1,2}times\s*(\d+(?:\.\d+)?)\$', b'\xc3\x97 \\1', chunk)
    
    replacements = [
        (b"$\\\\rightarrow$", b"\xe2\x86\x92"),
        (b"\\\\rightarrow", b"\xe2\x86\x92"),
        (b"$\\\\to$", b"\xe2\x86\x92"),
        (b"\\\\to", b"\xe2\x86\x92"),
        (b"$\\rightarrow$", b"\xe2\x86\x92"),
        (b"\\rightarrow", b"\xe2\x86\x92"),
        (b"$\\to$", b"\xe2\x86\x92"),
        (b"\\to", b"\xe2\x86\x92"),
        (b"$\\\\times$", b"\xc3\x97"),
        (b"\\\\times", b"\xc3\x97"),
        (b"$\\times$", b"\xc3\x97"),
        (b"\\times", b"\xc3\x97"),
    ]
    for target, rep in replacements:
        chunk = chunk.replace(target, rep)
    return chunk

def _merge_consecutive_messages(messages: list) -> list:
    """
    Merges consecutive message structures with identical roles (e.g. user-following-user)
    to prevent validation failures on upstream engines.
    """
    if not messages:
        return []

    merged = []
    for msg in messages:
        if not merged:
            merged.append(dict(msg))
            continue

        prev = merged[-1]
        if prev.get("role") == msg.get("role"):
            prev_content = prev.get("content", "")
            curr_content = msg.get("content", "")

            if isinstance(prev_content, str) and isinstance(curr_content, str):
                prev["content"] = prev_content + "\n\n" + curr_content
            elif isinstance(prev_content, list) and isinstance(curr_content, list):
                prev["content"] = prev_content + curr_content
            elif isinstance(prev_content, list) and isinstance(curr_content, str):
                prev["content"] = prev_content + [{"type": "text", "text": curr_content}]
            elif isinstance(prev_content, str) and isinstance(curr_content, list):
                prev["content"] = [{"type": "text", "text": prev_content}] + curr_content
            else:
                prev["content"] = str(prev_content) + "\n\n" + str(curr_content)
        else:
            merged.append(dict(msg))

    return merged

async def stream_transformer(response_stream, collapse_reasoning: bool) -> AsyncGenerator[str, None]:
    """
    Intercepts standard SSE stream signals line-by-line, isolating and transforming
    Google reasoning structures to OpenAI formats while keeping tool calls untouched.
    """
    has_started_thought = False
    has_ended_thought = False
    buffer = ""

    async for chunk in response_stream.aiter_bytes():
        cleaned_chunk = _clean_latex_symbols_bytes(chunk)
        buffer += cleaned_chunk.decode("utf-8", errors="replace")
        while "\n" in buffer:
            line, buffer = buffer.split("\n", 1)
            line = line.strip()
            if not line:
                continue
            if line.startswith(":"):
                continue  # SSE Comment block
            if line.startswith("data: "):
                data_str = line[6:].strip()
                if data_str == "[DONE]":
                    continue  # Separated to ensure proper isolated done signal execution

                try:
                    chunk_json = json.loads(data_str)
                except Exception:
                    yield f"data: {data_str}\n\n"
                    continue

                choices = chunk_json.get("choices", [])
                if choices:
                    delta = choices[0].get("delta", {})

                    # Intercept various reasoning styles
                    raw_reasoning = (
                        delta.get("reasoning_content") or
                        delta.get("reasoningContent") or
                        delta.get("thought") or
                        delta.get("thought_summary")
                    )

                    reasoning = ""
                    if isinstance(raw_reasoning, dict):
                        reasoning = raw_reasoning.get("reasoningContent") or raw_reasoning.get("text") or ""
                    elif isinstance(raw_reasoning, str):
                        reasoning = raw_reasoning

                    # Strip raw proprietary fields from stream representation
                    for k in ("reasoningContent", "thought", "thought_summary"):
                        delta.pop(k, None)

                    if reasoning:
                        if collapse_reasoning:
                            content_delta = ""
                            if not has_started_thought:
                                content_delta += "<thought>\n"
                                has_started_thought = True
                            content_delta += reasoning
                            delta["content"] = content_delta
                            delta["reasoning_content"] = None
                        else:
                            delta["reasoning_content"] = reasoning
                    else:
                        # Close collapsible reasoning states if regular content or tool blocks begin
                        if collapse_reasoning and has_started_thought and not has_ended_thought:
                            standard_content = delta.get("content")
                            if standard_content or delta.get("tool_calls") or delta.get("function_call"):
                                delta["content"] = "\n</thought>\n" + (standard_content or "")
                                has_ended_thought = True

                    choices[0]["delta"] = delta
                    chunk_json["choices"] = choices

                yield f"data: {json.dumps(chunk_json)}\n\n"

    # Close thinking tags if ending stream unexpectedly
    if collapse_reasoning and has_started_thought and not has_ended_thought:
        closing_chunk = {
            "choices": [{
                "index": 0,
                "delta": {
                    "content": "\n</thought>\n"
                }
            }]
        }
        yield f"data: {json.dumps(closing_chunk)}\n\n"

    yield "data: [DONE]\n\n"

def transform_non_streaming(response_data: dict, collapse_reasoning: bool) -> dict:
    """
    Adjust non-streaming OpenAI chat structure payloads to normalize reasoning outputs.
    """
    choices = response_data.get("choices", [])
    if not choices:
        return response_data

    message = choices[0].get("message", {})
    raw_reasoning = (
        message.get("reasoning_content") or
        message.get("reasoningContent") or
        message.get("thought") or
        message.get("thought_summary")
    )

    reasoning = ""
    if isinstance(raw_reasoning, dict):
        reasoning = raw_reasoning.get("reasoningContent") or raw_reasoning.get("text") or ""
    elif isinstance(raw_reasoning, str):
        reasoning = raw_reasoning

    for k in ("reasoningContent", "thought", "thought_summary"):
        message.pop(k, None)

    if reasoning:
        if collapse_reasoning:
            original_content = message.get("content") or ""
            message["content"] = f"<thought>\n{reasoning}\n</thought>\n{original_content}"
            message["reasoning_content"] = None
        else:
            message["reasoning_content"] = reasoning

    choices[0]["message"] = message
    response_data["choices"] = choices
    return response_data

# =====================================================================
# Route 1: Google SDK Route - Pure Pass-Through Proxy
# =====================================================================
@app.post("/v1beta/models/{model_name_and_action:path}", dependencies=[Depends(verify_auth_key)])
@app.post("/v1beta/{model_name_and_action:path}", dependencies=[Depends(verify_auth_key)])
async def google_sdk_route(model_name_and_action: str, request: Request):
    """
    Pure pass-through router for native Google SDK requests.
    Excludes formatting adjustments on response streams to preserve complex features.
    """
    if model_name_and_action.startswith("models/"):
        model_name_and_action = model_name_and_action[7:]
    model_name = model_name_and_action.split(":")[0]
    action = model_name_and_action.split(":")[1] if ":" in model_name_and_action else "generateContent"

    if model_name not in MODEL_REGISTRY:
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model_name}' is not recognized or whitelisted in LiteRouter."
        )

    meta = MODEL_REGISTRY[model_name]
    provider = meta["provider"]
    upstream_model = meta["upstream_model"]

    if provider != "google":
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model_name}' is not a Google model and cannot be queried via Google REST endpoint."
        )

    upstream_action_path = f"{upstream_model}:{action}"

    # Process request details
    try:
        body_bytes = await request.body()
        req_json = json.loads(body_bytes) if body_bytes else {}
    except Exception:
        req_json = {}

    # Strip reasoning rules if targeting a Gemma-style model
    if "gemma" in upstream_model.lower():
        req_json = _clean_gemma_payload(req_json)

    # Estimate capacity loads
    prompt_str = str(req_json)
    estimated_tokens = estimate_tokens(prompt_str, 1024)

    # Dynamic failover retry loop across all keys
    num_keys = len(router.keys.get('google', []))
    for attempt in range(num_keys + 1):
        active_key = None
        try:
            active_key = await router.get_available_key(provider, upstream_model, estimated_tokens)

            # Prepare forwarding query strings without original keys
            client_params = dict(request.query_params)
            client_params["key"] = active_key

            url = f"https://generativelanguage.googleapis.com/v1beta/models/{upstream_action_path}"

            # Prepare upstream HTTP client arguments
            req_headers = {k: v for k, v in request.headers.items() if k.lower() not in ("host", "authorization", "content-length")}

            upstream_req = http_client.build_request(
                method="POST",
                url=url,
                params=client_params,
                headers=req_headers,
                json=req_json if body_bytes else None
            )

            # Initiate upstream pass-through stream
            upstream_resp = await http_client.send(upstream_req, stream=True)

            if upstream_resp.status_code >= 400:
                await upstream_resp.aread()  # Avoid connection leaking
                upstream_resp.raise_for_status()

            async def generate_bytes():
                async for chunk in upstream_resp.aiter_bytes():
                    yield _clean_latex_symbols_bytes(chunk)
                await upstream_resp.aclose()

            # Pass-through back to caller
            response_headers = {k: v for k, v in upstream_resp.headers.items() if k.lower() not in ("transfer-encoding", "content-encoding")}
            return StreamingResponse(generate_bytes(), status_code=upstream_resp.status_code, headers=response_headers)

        except NoDeploymentsAvailable as exc:
            if attempt == num_keys:
                logger.error(f"No keys available for google on model {model_name}: {exc}")
                raise HTTPException(status_code=429, detail=str(exc))
            await asyncio.sleep(0.5)
            continue
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            status = getattr(getattr(exc, "response", None), "status_code", "timeout")
            metrics_history.append((time.time(), model_name, str(status)))

            if active_key:
                await router.report_error("google", active_key, str(status), model_name)

            if attempt == num_keys:
                logger.error(f"Failover loop exhausted. Service execution failed on error: {exc}")
                raise HTTPException(status_code=502, detail=f"Upstream provider failed: {exc}")

# =====================================================================
# Route 2: OpenAI Compatibility Route
# =====================================================================
@app.post("/v1/chat/completions", dependencies=[Depends(verify_auth_key)])
async def openai_compatibility_route(request: Request):
    """
    Decodes and processes request structures, normalizing reasoning outputs
    into compliant formats while maintaining functional safety.
    """
    try:
        body_bytes = await request.body()
        req_json = json.loads(body_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid payload JSON: {e}")

    model_name = req_json.get("model")
    if not model_name or model_name not in MODEL_REGISTRY:
        raise HTTPException(
            status_code=400,
            detail=f"Model '{model_name}' is not recognized or whitelisted in LiteRouter."
        )

    meta = MODEL_REGISTRY[model_name]
    provider = meta["provider"]
    upstream_model = meta["upstream_model"]
    api_url = meta["api_url"].format(ZEN_BASE_URL=ZEN_BASE_URL)

    # Mutate payload model for upstream compatibility
    req_json["model"] = upstream_model
    is_stream = req_json.get("stream", False)

    # Sanitize message structures
    messages = req_json.get("messages", [])
    req_json["messages"] = _merge_consecutive_messages(messages)

    # Estimate capacity loads
    prompt_str = str(req_json["messages"])
    estimated_tokens = estimate_tokens(prompt_str, req_json.get("max_tokens") or 2048)

    num_keys = len(router.keys.get(provider, []))
    for attempt in range(num_keys + 1):
        active_key = None
        try:
            active_key = await router.get_available_key(provider, upstream_model, estimated_tokens)

            url = api_url
            headers = {
                "Authorization": f"Bearer {active_key}",
                "Content-Type": "application/json"
            }

            upstream_req = http_client.build_request(
                method="POST",
                url=url,
                headers=headers,
                json=req_json
            )

            upstream_resp = await http_client.send(upstream_req, stream=is_stream)

            if upstream_resp.status_code >= 400:
                if is_stream:
                    await upstream_resp.aread()
                upstream_resp.raise_for_status()

            if is_stream:
                return StreamingResponse(
                    stream_transformer(upstream_resp, LITEROUTER_COLLAPSE_REASONING),
                    media_type="text/event-stream"
                )
            else:
                cleaned_bytes = _clean_latex_symbols_bytes(upstream_resp.content)
                data = json.loads(cleaned_bytes)
                transformed_data = transform_non_streaming(data, LITEROUTER_COLLAPSE_REASONING)
                return JSONResponse(content=transformed_data, status_code=upstream_resp.status_code)

        except NoDeploymentsAvailable as exc:
            if attempt == num_keys:
                logger.error(f"No keys available for {provider} on model {upstream_model}: {exc}")
                raise HTTPException(status_code=429, detail=str(exc))
            await asyncio.sleep(0.5)
            continue
        except (httpx.HTTPStatusError, httpx.RequestError) as exc:
            status = getattr(getattr(exc, "response", None), "status_code", "timeout")
            metrics_history.append((time.time(), upstream_model, str(status)))

            if active_key:
                await router.report_error(provider, active_key, str(status), upstream_model)

            if attempt == num_keys:
                logger.error(f"Failover loop exhausted on OpenAI route: {exc}")
                raise HTTPException(status_code=502, detail=f"All upstream nodes failed to resolve request: {exc}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.main:app", host=LITEROUTER_HOST, port=LITEROUTER_PORT)
