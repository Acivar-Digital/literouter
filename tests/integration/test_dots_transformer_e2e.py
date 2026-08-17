from __future__ import annotations

import asyncio
import json
import logging
import os
import subprocess
import threading
import time
from typing import Any, AsyncIterator, Dict, Generator, List

import httpx
import pytest
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse

from tests.integration.mock_upstream import (
    MockUpstreamContext,
    get_ephemeral_port,
)

logger = logging.getLogger("test_dots_transformer_e2e")

AUTH_KEY = "test-e2e-token-secret-dots-12345"
KEY_1 = "sk-test-key-dots-00000000000000001"
TEST_MODEL = "openrouter/dots-studio/dots-3-note-preview:free"

TOOL_CALLS_XML_CONTENT = """Scribe finished. Let me check its deliverable.
<tool_calls>
<invoke name="shell">
<parameter name="command">
cd /home/yapilwsl/arthityap/baziforecaster && echo "=== agent_b file ==="; ls -la scratch/agent_b_change_log.md 2>&1
</parameter>
</invoke>
</tool_calls>"""


def make_dots_chat_payload() -> Dict[str, Any]:
    return {
        "id": "chatcmpl-mock-dots-1",
        "object": "chat.completion",
        "created": 1723380000,
        "model": "dots-studio/dots-3-note-preview:free",
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": TOOL_CALLS_XML_CONTENT,
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {"prompt_tokens": 15, "completion_tokens": 25, "total_tokens": 40},
    }


async def dots_sse_event_generator() -> AsyncIterator[bytes]:
    chunks = [
        {"choices": [{"index": 0, "delta": {"content": "Checking status:\n<tool_"}, "finish_reason": None}]},
        {
            "choices": [
                {
                    "index": 0,
                    "delta": {"content": "calls>\n<invoke name=\"shell\">\n"},
                    "finish_reason": None,
                }
            ]
        },
        {"choices": [{"index": 0, "delta": {"content": "<parameter name=\"command\">\n"}, "finish_reason": None}]},
        {"choices": [{"index": 0, "delta": {"content": "git status\n</parameter>\n"}, "finish_reason": None}]},
        {"choices": [{"index": 0, "delta": {"content": "</invoke>\n</tool_calls>"}, "finish_reason": None}]},
        {
            "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 15, "completion_tokens": 25, "total_tokens": 40},
        },
    ]
    for chunk in chunks:
        yield f"data: {json.dumps(chunk)}\n\n".encode("utf-8")
        await asyncio.sleep(0.02)
    yield b"data: [DONE]\n\n"


def create_dots_mock_upstream_app(ctx: MockUpstreamContext) -> FastAPI:
    app = FastAPI(title="LiteRouter Dots Mock Upstream")

    @app.get("/health")
    def health() -> Dict[str, str]:
        return {"status": "ok"}

    @app.post("/chat/completions")
    async def chat_completions(request: Request) -> Response:
        auth_header = request.headers.get("Authorization", "")
        key = auth_header.replace("Bearer ", "").strip()
        body = await request.json()
        is_stream = bool(body.get("stream", False))

        ctx.record_call(key=key, path="/chat/completions", is_stream=is_stream)

        if is_stream:
            return StreamingResponse(
                dots_sse_event_generator(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
            )
        return JSONResponse(status_code=200, content=make_dots_chat_payload())

    return app


def _wait_for_health(url: str, timeout_sec: float = 6.0) -> bool:
    deadline = time.time() + timeout_sec
    headers = {"Authorization": f"Bearer {AUTH_KEY}"}
    while time.time() < deadline:
        try:
            with httpx.Client(verify=False) as client:
                resp = client.get(f"{url}/health", headers=headers, timeout=0.5)
                if resp.status_code in (200, 401):
                    return True
        except Exception as err:
            logger.debug(f"Health probe waiting: {err}")
        time.sleep(0.1)
    return False


@pytest.fixture(scope="module")
def dots_e2e_stack() -> Generator[Dict[str, Any], None, None]:
    mock_ctx = MockUpstreamContext()
    mock_port = get_ephemeral_port()
    mock_app = create_dots_mock_upstream_app(mock_ctx)
    config = uvicorn.Config(app=mock_app, host="127.0.0.1", port=mock_port, log_level="error")
    mock_server = uvicorn.Server(config)
    mock_thread = threading.Thread(target=mock_server.run, daemon=True)
    mock_thread.start()

    gw_port = get_ephemeral_port()
    env = os.environ.copy()
    env["LITEROUTER_PORT"] = str(gw_port)
    env["OPENROUTER_BASE_URL"] = f"http://127.0.0.1:{mock_port}"
    env["OPENROUTER_API_KEYS"] = KEY_1
    env["LITEROUTER_AUTH_KEY"] = AUTH_KEY

    gw_proc = subprocess.Popen(
        ["bun", "run", "src/index.ts"],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    gw_url = f"https://127.0.0.1:{gw_port}"
    healthy = _wait_for_health(gw_url, timeout_sec=8.0)
    assert healthy, "LiteRouter gateway failed to become healthy in E2E dots test"

    yield {
        "gw_url": gw_url,
        "gw_port": gw_port,
        "mock_ctx": mock_ctx,
    }

    gw_proc.terminate()
    try:
        gw_proc.wait(timeout=3.0)
    except subprocess.TimeoutExpired:
        gw_proc.kill()
    mock_server.should_exit = True


def test_dots_non_streaming_converts_to_tool_calls(dots_e2e_stack: Dict[str, Any]) -> None:
    gw_url = dots_e2e_stack["gw_url"]
    headers = {
        "Authorization": f"Bearer {AUTH_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": TEST_MODEL,
        "messages": [{"role": "user", "content": "Run git status"}],
        "stream": False,
    }

    with httpx.Client(verify=False, timeout=10.0) as client:
        resp = client.post(f"{gw_url}/v1/chat/completions", headers=headers, json=payload)
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"

        data = resp.json()
        choice = data["choices"][0]
        message = choice["message"]

        # Crucial assertions:
        assert "tool_calls" in message, "tool_calls missing from assistant message"
        tool_calls = message["tool_calls"]
        assert len(tool_calls) == 1
        assert tool_calls[0]["function"]["name"] == "shell"

        parsed_args = json.loads(tool_calls[0]["function"]["arguments"])
        assert "agent_b file" in parsed_args["command"]
        assert message["content"] == "Scribe finished. Let me check its deliverable."


def test_dots_streaming_converts_to_tool_calls(dots_e2e_stack: Dict[str, Any]) -> None:
    gw_url = dots_e2e_stack["gw_url"]
    headers = {
        "Authorization": f"Bearer {AUTH_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": TEST_MODEL,
        "messages": [{"role": "user", "content": "Run git status"}],
        "stream": True,
    }

    with httpx.Client(verify=False, timeout=10.0) as client:
        with client.stream("POST", f"{gw_url}/v1/chat/completions", headers=headers, json=payload) as response:
            assert response.status_code == 200

            tool_calls_received: List[Dict[str, Any]] = []
            content_chunks: List[str] = []

            for line in response.iter_lines():
                line = line.strip()
                if not line or line.startswith(":"):
                    continue
                if line == "data: [DONE]":
                    break
                if line.startswith("data: "):
                    data_str = line[6:]
                    chunk_json = json.loads(data_str)
                    delta = chunk_json["choices"][0]["delta"]

                    if "content" in delta and delta["content"]:
                        content_chunks.append(delta["content"])
                    if "tool_calls" in delta and delta["tool_calls"]:
                        tool_calls_received.extend(delta["tool_calls"])

            # Assert standard text was passed through without XML tags
            full_content = "".join(content_chunks)
            assert "Checking status:" in full_content
            assert "<tool_calls>" not in full_content
            assert "</tool_calls>" not in full_content
            assert "<invoke" not in full_content

            # Assert tool calls were parsed and emitted
            assert len(tool_calls_received) >= 1
            tc = tool_calls_received[0]
            assert tc["function"]["name"] == "shell"
            args = json.loads(tc["function"]["arguments"])
            assert "git status" in args["command"]
