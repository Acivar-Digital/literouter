from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import threading
import time
from typing import Any, AsyncIterator, Dict, Generator, List, Optional, Tuple

import httpx
import pytest
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel

from tests.integration.mock_upstream import (
    MockUpstreamContext,
    get_ephemeral_port,
)

logger = logging.getLogger("downstream_gauntlet_test")

OPENCODE_KEY = "lr-zn-oa-ch-no"
CLAUDE_KEY = "lr-or-cl-ms-no"
PYDANTIC_KEY = "lr-nv-oa-ch-no"

MODEL_OPENCODE = "big-pickle"
MODEL_CLAUDE = "anthropic/claude-3.7-sonnet"
MODEL_PYDANTIC = "deepseek-ai/deepseek-r1"

MOCK_KEY_ZN = "sk-mock-zen-key-00000000000000001"
MOCK_KEY_OR = "sk-mock-or-key-00000000000000001"
MOCK_KEY_NV = "nvapi-mock-key-00000000000000001"


# ---------------------------------------------------------------------------
# Strict Validation Schemas (Zero-Zod Downstream Client Mirror)
# ---------------------------------------------------------------------------


class OpenAIChatChoiceMessage(BaseModel):
    role: str
    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    reasoning_content: Optional[str] = None


class OpenAIChatChoice(BaseModel):
    index: int
    message: OpenAIChatChoiceMessage
    finish_reason: Optional[str] = None


class OpenAIUsage(BaseModel):
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int


class OpenAIChatCompletionResponse(BaseModel):
    id: str
    object: str
    created: int
    model: str
    choices: List[OpenAIChatChoice]
    usage: Optional[OpenAIUsage] = None


class OpenAIChatDelta(BaseModel):
    role: Optional[str] = None
    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    reasoning_content: Optional[str] = None


class OpenAIChatStreamChoice(BaseModel):
    index: int
    delta: OpenAIChatDelta
    finish_reason: Optional[str] = None


class OpenAIChatCompletionChunk(BaseModel):
    id: str
    object: str
    created: int
    model: str
    choices: List[OpenAIChatStreamChoice]
    usage: Optional[OpenAIUsage] = None


class AnthropicContentBlock(BaseModel):
    type: str
    text: Optional[str] = None


class AnthropicUsage(BaseModel):
    input_tokens: int
    output_tokens: int


class AnthropicMessageResponse(BaseModel):
    id: str
    type: str
    role: str
    model: str
    content: List[AnthropicContentBlock]
    stop_reason: Optional[str] = None
    stop_sequence: Optional[str] = None
    usage: AnthropicUsage


class UserMetricSchema(BaseModel):
    user_id: str
    metric: str
    value: float


# ---------------------------------------------------------------------------
# Mock Upstream App & Generators
# ---------------------------------------------------------------------------


async def _opencode_sse_generator() -> AsyncIterator[bytes]:
    chunks = [
        {
            "id": "chatcmpl-stream-oc-1",
            "object": "chat.completion.chunk",
            "created": 1723380000,
            "model": MODEL_OPENCODE,
            "choices": [
                {
                    "index": 0,
                    "delta": {
                        "role": "assistant",
                        "reasoning_content": "Internal chain of thought step 1 that must be stripped.",
                    },
                    "finish_reason": None,
                }
            ],
        },
        {
            "id": "chatcmpl-stream-oc-1",
            "object": "chat.completion.chunk",
            "created": 1723380000,
            "model": MODEL_OPENCODE,
            "choices": [
                {
                    "index": 0,
                    "delta": {
                        "reasoning_content": "Internal chain of thought step 2 that must also be stripped.",
                    },
                    "finish_reason": None,
                }
            ],
        },
        {
            "id": "chatcmpl-stream-oc-1",
            "object": "chat.completion.chunk",
            "created": 1723380000,
            "model": MODEL_OPENCODE,
            "choices": [
                {
                    "index": 0,
                    "delta": {"content": "Hello "},
                    "finish_reason": None,
                }
            ],
        },
        {
            "id": "chatcmpl-stream-oc-1",
            "object": "chat.completion.chunk",
            "created": 1723380000,
            "model": MODEL_OPENCODE,
            "choices": [
                {
                    "index": 0,
                    "delta": {"content": "from OpenCode 2 probe!"},
                    "finish_reason": None,
                }
            ],
        },
        {
            "id": "chatcmpl-stream-oc-1",
            "object": "chat.completion.chunk",
            "created": 1723380000,
            "model": MODEL_OPENCODE,
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 12, "completion_tokens": 8, "total_tokens": 20},
        },
    ]
    for chunk in chunks:
        yield f"data: {json.dumps(chunk)}\n\n".encode("utf-8")
        await asyncio.sleep(0.01)
    yield b"data: [DONE]\n\n"


async def _claude_sse_generator() -> AsyncIterator[bytes]:
    events = [
        (
            "message_start",
            {
                "type": "message_start",
                "message": {
                    "id": "msg_mock_claude_stream_1",
                    "type": "message",
                    "role": "assistant",
                    "model": MODEL_CLAUDE,
                    "content": [],
                    "stop_reason": None,
                    "stop_sequence": None,
                    "usage": {"input_tokens": 18, "output_tokens": 1},
                },
            },
        ),
        (
            "content_block_start",
            {
                "type": "content_block_start",
                "index": 0,
                "content_block": {"type": "text", "text": ""},
            },
        ),
        (
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "Claude Code stream "},
            },
        ),
        (
            "content_block_delta",
            {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": "probe completed successfully."},
            },
        ),
        (
            "content_block_stop",
            {
                "type": "content_block_stop",
                "index": 0,
            },
        ),
        (
            "message_delta",
            {
                "type": "message_delta",
                "delta": {"stop_reason": "end_turn", "stop_sequence": None},
                "usage": {"output_tokens": 26},
            },
        ),
        (
            "message_stop",
            {
                "type": "message_stop",
            },
        ),
    ]
    for event_name, data in events:
        msg = f"event: {event_name}\ndata: {json.dumps(data)}\n\n"
        yield msg.encode("utf-8")
        await asyncio.sleep(0.01)


def create_gauntlet_mock_app(ctx: MockUpstreamContext) -> FastAPI:
    app = FastAPI(title="LiteRouter Downstream Gauntlet Mock Upstream")

    @app.get("/health")
    def health() -> Dict[str, str]:
        return {"status": "ok"}

    @app.post("/chat/completions")
    @app.post("/v1/chat/completions")
    @app.post("/api/v1/chat/completions")
    @app.post("/zen/v1/chat/completions")
    async def chat_completions(request: Request) -> Response:
        auth_header = request.headers.get("Authorization", "")
        key = auth_header.replace("Bearer ", "").strip()
        body = await request.json()
        is_stream = bool(body.get("stream", False))

        ctx.record_call(
            key=key,
            path=request.url.path,
            is_stream=is_stream,
            headers=dict(request.headers),
            body=body,
        )

        model = str(body.get("model", ""))

        # Probe 1: OpenCode 2 simulation (big-pickle)
        if model == MODEL_OPENCODE:
            if is_stream:
                return StreamingResponse(
                    _opencode_sse_generator(),
                    media_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
                )
            return JSONResponse(
                status_code=200,
                content={
                    "id": "chatcmpl-mock-opencode-nonstream",
                    "object": "chat.completion",
                    "created": 1723380000,
                    "model": MODEL_OPENCODE,
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": "Clean text response for OpenCode 2.",
                                "reasoning_content": "Internal chain of thought that must be stripped by LiteRouter.",
                            },
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 10, "completion_tokens": 8, "total_tokens": 18},
                },
            )

        # Probe 3: Pydantic AI simulation (deepseek-ai/deepseek-r1)
        if model == MODEL_PYDANTIC:
            tools = body.get("tools")
            if tools:
                return JSONResponse(
                    status_code=200,
                    content={
                        "id": "chatcmpl-mock-pydantic-tool",
                        "object": "chat.completion",
                        "created": 1723380000,
                        "model": MODEL_PYDANTIC,
                        "choices": [
                            {
                                "index": 0,
                                "message": {
                                    "role": "assistant",
                                    "content": None,
                                    "tool_calls": [
                                        {
                                            "id": "call_metric_001",
                                            "type": "function",
                                            "function": {
                                                "name": "record_user_metric",
                                                "arguments": (
                                                    '{"user_id": "usr_99", "metric": "latency", "value": 42.5}'
                                                ),
                                            },
                                        }
                                    ],
                                },
                                "finish_reason": "tool_calls",
                            }
                        ],
                        "usage": {"prompt_tokens": 30, "completion_tokens": 20, "total_tokens": 50},
                    },
                )
            # Structured JSON schema output
            return JSONResponse(
                status_code=200,
                content={
                    "id": "chatcmpl-mock-pydantic-json",
                    "object": "chat.completion",
                    "created": 1723380000,
                    "model": MODEL_PYDANTIC,
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": '{"user_id": "usr_99", "metric": "throughput", "value": 1500.0}',
                            },
                            "finish_reason": "stop",
                        }
                    ],
                    "usage": {"prompt_tokens": 25, "completion_tokens": 15, "total_tokens": 40},
                },
            )

        # Default fallback chat payload
        return JSONResponse(
            status_code=200,
            content={
                "id": "chatcmpl-mock-default",
                "object": "chat.completion",
                "created": 1723380000,
                "model": model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "Default mock response"},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 5, "completion_tokens": 5, "total_tokens": 10},
            },
        )

    @app.post("/messages")
    @app.post("/v1/messages")
    @app.post("/api/v1/messages")
    async def anthropic_messages(request: Request) -> Response:
        body = await request.json()
        is_stream = bool(body.get("stream", False))

        ctx.record_call(
            key=request.headers.get("x-api-key", request.headers.get("Authorization", "")),
            path=request.url.path,
            is_stream=is_stream,
            headers=dict(request.headers),
            body=body,
        )

        if is_stream:
            return StreamingResponse(
                _claude_sse_generator(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
            )

        return JSONResponse(
            status_code=200,
            content={
                "id": "msg_mock_claude_nonstream_1",
                "type": "message",
                "role": "assistant",
                "model": MODEL_CLAUDE,
                "content": [
                    {
                        "type": "text",
                        "text": "Hello! Anthropic Messages format downstream probe verified.",
                    }
                ],
                "stop_reason": "end_turn",
                "stop_sequence": None,
                "usage": {
                    "input_tokens": 18,
                    "output_tokens": 24,
                },
            },
        )

    return app


# ---------------------------------------------------------------------------
# Test Fixture & Server Harness
# ---------------------------------------------------------------------------


def _wait_for_health(url: str, timeout_sec: float = 8.0) -> bool:
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            with httpx.Client(http2=True, verify=False) as client:
                resp = client.get(f"{url}/health", timeout=0.5)
                if resp.status_code in (200, 401):
                    return True
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError) as err:
            logger.debug(f"Health probe waiting: {err}")
        time.sleep(0.1)
    return False


def _start_mock_server(app: FastAPI, port: int) -> uvicorn.Server:
    config = uvicorn.Config(app=app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    return server


def _build_gateway_env(mock_port: int, gw_port: int) -> Dict[str, str]:
    env = os.environ.copy()
    env["LITEROUTER_PORT"] = str(gw_port)
    env["LITEROUTER_ROTATE_DELAY_MS"] = "2000"
    env["LITEROUTER_MAX_ATTEMPTS"] = "3"
    env["LITEROUTER_ENGINE_OVERRIDE"] = "true"
    env["LITEROUTER_ENGINE"] = "v4"
    env["MOCK_ZN_PORT"] = str(mock_port)
    env["MOCK_OR_PORT"] = str(mock_port)
    env["MOCK_NV_PORT"] = str(mock_port)
    env["ZEN_API_KEYS"] = f"{MOCK_KEY_ZN},{MOCK_KEY_ZN}2"
    env["OPENROUTER_API_KEYS"] = f"{MOCK_KEY_OR},{MOCK_KEY_OR}2"
    env["NVIDIA_API_KEYS"] = f"{MOCK_KEY_NV},{MOCK_KEY_NV}2"
    return env


@pytest.fixture(scope="module")
def gauntlet_harness() -> Generator[Tuple[str, MockUpstreamContext], None, None]:
    mock_port = get_ephemeral_port()
    gw_port = get_ephemeral_port()

    ctx = MockUpstreamContext()
    app = create_gauntlet_mock_app(ctx)
    server = _start_mock_server(app, mock_port)

    gw_env = _build_gateway_env(mock_port, gw_port)
    gw_proc = subprocess.Popen(
        ["bun", "run", "src/index.ts"],
        env=gw_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    gw_url = f"https://127.0.0.1:{gw_port}"
    if not _wait_for_health(gw_url, timeout_sec=8.0):
        gw_proc.kill()
        server.should_exit = True
        pytest.fail(f"Gateway failed to start on port {gw_port}")

    yield gw_url, ctx

    gw_proc.terminate()
    try:
        gw_proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        gw_proc.kill()
    server.should_exit = True


# ---------------------------------------------------------------------------
# Downstream Agent Gauntlet Probes
# ---------------------------------------------------------------------------


def test_opencode2_simulation_probe_non_streaming(
    gauntlet_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Probe 1.1: OpenCode 2 non-streaming chat completion with thinking stripping."""
    gw_url, _ = gauntlet_harness

    headers = {
        "Authorization": f"Bearer {OPENCODE_KEY}",
        "User-Agent": "OpenCode/1.18.29",
        "x-opencode": "1",
    }
    payload = {
        "model": MODEL_OPENCODE,
        "messages": [{"role": "user", "content": "Explain async rust."}],
        "stream": False,
    }

    with httpx.Client(http2=True, verify=False, timeout=10.0) as client:
        resp = client.post(f"{gw_url}/v1/chat/completions", headers=headers, json=payload)

    assert resp.status_code == 200, f"OpenCode probe failed: {resp.status_code} {resp.text}"
    body = resp.json()

    # Verify zero-Zod schema validation against OpenAI schema
    parsed = OpenAIChatCompletionResponse.model_validate(body)
    assert parsed.model == MODEL_OPENCODE
    assert len(parsed.choices) > 0

    first_choice = parsed.choices[0]
    msg = first_choice.message

    # Verification: thinking stripped, clean text tokens generated
    raw_message = body["choices"][0]["message"]
    assert "reasoning_content" not in raw_message or raw_message["reasoning_content"] is None
    assert "reasoning" not in raw_message
    assert msg.content == "Clean text response for OpenCode 2."
    assert first_choice.finish_reason == "stop"


def test_opencode2_simulation_probe_streaming(
    gauntlet_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Probe 1.2: OpenCode 2 streaming SSE chat completion with thinking chunks stripped."""
    gw_url, _ = gauntlet_harness

    headers = {
        "Authorization": f"Bearer {OPENCODE_KEY}",
        "User-Agent": "OpenCode/1.18.29",
        "x-opencode": "1",
    }
    payload = {
        "model": MODEL_OPENCODE,
        "messages": [{"role": "user", "content": "Explain async rust stream."}],
        "stream": True,
    }

    content_chunks: List[str] = []
    has_done = False

    with httpx.Client(http2=True, verify=False, timeout=10.0) as client:
        with client.stream("POST", f"{gw_url}/v1/chat/completions", headers=headers, json=payload) as resp:
            assert resp.status_code == 200, f"Streaming failed: {resp.status_code}"
            assert "text/event-stream" in resp.headers.get("content-type", "")

            for line in resp.iter_lines():
                line = line.strip()
                if not line or not line.startswith("data:"):
                    continue
                data_str = line[5:].strip()
                if data_str == "[DONE]":
                    has_done = True
                    break

                chunk_json = json.loads(data_str)
                # Verify zero-Zod parsing against OpenAI stream chunk schema
                chunk = OpenAIChatCompletionChunk.model_validate(chunk_json)

                # Verify reasoning_content is NOT in delta (stripped)
                raw_delta = chunk_json["choices"][0]["delta"]
                assert "reasoning_content" not in raw_delta or raw_delta["reasoning_content"] is None
                assert "reasoning" not in raw_delta

                delta_content = chunk.choices[0].delta.content
                if delta_content:
                    content_chunks.append(delta_content)

    assert has_done is True, "Stream did not emit [DONE]"
    full_text = "".join(content_chunks)
    assert full_text == "Hello from OpenCode 2 probe!"


def test_claude_code_simulation_probe_non_streaming(
    gauntlet_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Probe 2.1: Claude Code non-streaming Messages API response parsing."""
    gw_url, _ = gauntlet_harness

    headers = {
        "Authorization": f"Bearer {CLAUDE_KEY}",
        "anthropic-version": "2023-06-01",
        "User-Agent": "Claude-Code/1.0.0",
    }
    payload = {
        "model": MODEL_CLAUDE,
        "messages": [{"role": "user", "content": "Hello Claude Code"}],
        "max_tokens": 1024,
        "stream": False,
    }

    with httpx.Client(http2=True, verify=False, timeout=10.0) as client:
        resp = client.post(f"{gw_url}/v1/messages", headers=headers, json=payload)

    assert resp.status_code == 200, f"Claude Code probe failed: {resp.status_code} {resp.text}"
    body = resp.json()

    # Verification: Claude Code client parses downstream response cleanly as Anthropic Messages format
    parsed = AnthropicMessageResponse.model_validate(body)
    assert parsed.type == "message"
    assert parsed.role == "assistant"
    assert parsed.model == MODEL_CLAUDE
    assert len(parsed.content) > 0
    assert parsed.content[0].type == "text"
    assert parsed.content[0].text == "Hello! Anthropic Messages format downstream probe verified."
    assert parsed.usage.input_tokens == 18
    assert parsed.usage.output_tokens == 24
    assert parsed.stop_reason == "end_turn"


def test_claude_code_simulation_probe_streaming(
    gauntlet_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Probe 2.2: Claude Code streaming Messages API with SSE content_block_delta."""
    gw_url, _ = gauntlet_harness

    headers = {
        "Authorization": f"Bearer {CLAUDE_KEY}",
        "anthropic-version": "2023-06-01",
        "User-Agent": "Claude-Code/1.0.0",
    }
    payload = {
        "model": MODEL_CLAUDE,
        "messages": [{"role": "user", "content": "Stream Claude Code"}],
        "max_tokens": 1024,
        "stream": True,
    }

    events_received: List[str] = []
    text_deltas: List[str] = []
    final_output_tokens: Optional[int] = None

    with httpx.Client(http2=True, verify=False, timeout=10.0) as client:
        with client.stream("POST", f"{gw_url}/v1/messages", headers=headers, json=payload) as resp:
            assert resp.status_code == 200, f"Claude stream failed: {resp.status_code}"
            current_event = ""

            for line in resp.iter_lines():
                line = line.strip()
                if not line:
                    continue
                if line.startswith("event:"):
                    current_event = line[6:].strip()
                    events_received.append(current_event)
                elif line.startswith("data:"):
                    data = json.loads(line[5:].strip())
                    if current_event == "content_block_delta":
                        text_deltas.append(data.get("delta", {}).get("text", ""))
                    elif current_event == "message_delta":
                        final_output_tokens = data.get("usage", {}).get("output_tokens")

    # Verification: Claude Code client parses stream, valid usage tokens, clean completion
    assert "message_start" in events_received
    assert "content_block_start" in events_received
    assert "content_block_delta" in events_received
    assert "content_block_stop" in events_received
    assert "message_delta" in events_received
    assert "message_stop" in events_received

    streamed_text = "".join(text_deltas)
    assert streamed_text == "Claude Code stream probe completed successfully."
    assert final_output_tokens == 26


def test_pydantic_ai_simulation_probe_tool_call(
    gauntlet_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Probe 3.1: Pydantic AI simulation with structured tool calling."""
    gw_url, _ = gauntlet_harness

    headers = {
        "Authorization": f"Bearer {PYDANTIC_KEY}",
        "User-Agent": "pydantic-ai/1.0.0",
    }
    payload = {
        "model": MODEL_PYDANTIC,
        "messages": [{"role": "user", "content": "Track latency metric"}],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "record_user_metric",
                    "description": "Record a telemetry metric for user",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "user_id": {"type": "string"},
                            "metric": {"type": "string"},
                            "value": {"type": "number"},
                        },
                        "required": ["user_id", "metric", "value"],
                    },
                },
            }
        ],
        "tool_choice": "auto",
        "stream": False,
    }

    with httpx.Client(http2=True, verify=False, timeout=10.0) as client:
        resp = client.post(f"{gw_url}/v1/chat/completions", headers=headers, json=payload)

    assert resp.status_code == 200, f"Pydantic tool probe failed: {resp.status_code} {resp.text}"
    body = resp.json()

    # Verification: Response adheres strictly to OpenAI chat schema
    parsed = OpenAIChatCompletionResponse.model_validate(body)
    choice = parsed.choices[0]
    assert choice.finish_reason == "tool_calls"
    assert choice.message.tool_calls is not None
    assert len(choice.message.tool_calls) == 1

    tool_call = choice.message.tool_calls[0]
    assert tool_call["function"]["name"] == "record_user_metric"

    # Verification: Arguments cleanly validate into Pydantic schema with zero errors
    args_json = tool_call["function"]["arguments"]
    metric_record = UserMetricSchema.model_validate_json(args_json)
    assert metric_record.user_id == "usr_99"
    assert metric_record.metric == "latency"
    assert metric_record.value == 42.5


def test_pydantic_ai_simulation_probe_structured_json(
    gauntlet_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Probe 3.2: Pydantic AI simulation with structured JSON schema response."""
    gw_url, _ = gauntlet_harness

    headers = {
        "Authorization": f"Bearer {PYDANTIC_KEY}",
        "User-Agent": "pydantic-ai/1.0.0",
    }
    payload = {
        "model": MODEL_PYDANTIC,
        "messages": [{"role": "user", "content": "Return throughput metric"}],
        "response_format": {"type": "json_object"},
        "stream": False,
    }

    with httpx.Client(http2=True, verify=False, timeout=10.0) as client:
        resp = client.post(f"{gw_url}/v1/chat/completions", headers=headers, json=payload)

    assert resp.status_code == 200, f"Pydantic JSON probe failed: {resp.status_code} {resp.text}"
    body = resp.json()

    # Verification: Content is non-null and parses into strict schema
    parsed = OpenAIChatCompletionResponse.model_validate(body)
    content_str = parsed.choices[0].message.content
    assert content_str is not None, "Content must not be null for structured JSON response"

    metric_record = UserMetricSchema.model_validate_json(content_str)
    assert metric_record.user_id == "usr_99"
    assert metric_record.metric == "throughput"
    assert metric_record.value == 1500.0


def test_pydantic_ai_simulation_probe_http2_connection_reuse(
    gauntlet_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Probe 3.3: Pydantic AI HTTP connection reuse / keep-alive over HTTP/2."""
    gw_url, _ = gauntlet_harness

    headers = {
        "Authorization": f"Bearer {PYDANTIC_KEY}",
        "User-Agent": "pydantic-ai/1.0.0",
    }
    payload = {
        "model": MODEL_PYDANTIC,
        "messages": [{"role": "user", "content": "Keep-alive ping"}],
        "response_format": {"type": "json_object"},
        "stream": False,
    }

    # Execute consecutive requests over the single persistent HTTP/2 client
    with httpx.Client(http2=True, verify=False, timeout=10.0) as client:
        for idx in range(5):
            resp = client.post(f"{gw_url}/v1/chat/completions", headers=headers, json=payload)
            assert resp.status_code == 200, f"Request {idx} failed: {resp.status_code} {resp.text}"
            parsed = OpenAIChatCompletionResponse.model_validate(resp.json())
            assert parsed.choices[0].message.content is not None
            # Verify HTTP/2 negotiation
            assert resp.http_version == "HTTP/2", f"Expected HTTP/2 but got {resp.http_version}"
