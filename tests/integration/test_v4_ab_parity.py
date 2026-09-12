from __future__ import annotations

import json
import logging
import os
import subprocess
import threading
import time
from typing import Any, Dict, Generator, List, Tuple

import httpx
import pytest
import redis
import uvicorn

from tests.integration.mock_upstream import (
    MockUpstreamContext,
    create_mock_upstream_app,
    get_ephemeral_port,
)

logger = logging.getLogger("v4_ab_parity_test")

AUTH_KEY = "lr-or-oa-ch-no"
KEY_1 = "sk-test-key-alpha-mock00000000000000001"
KEY_2 = "sk-test-key-beta-mock00000000000000002"
TEST_MODEL = "openrouter/openai/gpt-oss-120b:free"
TEST_REDIS_DB = 14


def _flush_test_redis() -> None:
    try:
        r = redis.Redis(host="127.0.0.1", port=6379, db=TEST_REDIS_DB)
        r.flushdb()
    except Exception as err:
        logger.debug(f"Redis flush skipped: {err}")


def _wait_for_health(url: str, timeout_sec: float = 8.0) -> bool:
    deadline = time.time() + timeout_sec
    headers = {"Authorization": f"Bearer {AUTH_KEY}"}
    while time.time() < deadline:
        try:
            with httpx.Client(http2=True, verify=False) as client:
                resp = client.get(f"{url}/health", headers=headers, timeout=0.5)
                if resp.status_code in (200, 401):
                    return True
        except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError) as err:
            logger.debug(f"Health probe waiting: {err}")
        time.sleep(0.1)
    return False


def _start_mock_server(ctx: MockUpstreamContext, port: int) -> uvicorn.Server:
    app = create_mock_upstream_app(ctx)
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
    env["MOCK_OR_PORT"] = str(mock_port)
    env["OPENROUTER_API_KEYS"] = f"{KEY_1},{KEY_2}"
    env["REDIS_DB"] = str(TEST_REDIS_DB)
    env["LITEROUTER_ENGINE_OVERRIDE"] = "true"
    return env


@pytest.fixture(scope="module")
def ab_harness() -> Generator[Tuple[str, MockUpstreamContext], None, None]:
    _flush_test_redis()
    mock_port = get_ephemeral_port()
    gw_port = get_ephemeral_port()

    ctx = MockUpstreamContext()
    server = _start_mock_server(ctx, mock_port)

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
    _flush_test_redis()


def _headers_for_engine(engine: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {AUTH_KEY}",
        "X-LiteRouter-Engine": engine,
    }


def _make_req_payload(stream: bool = False, tools: List[Dict[str, Any]] | None = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {
        "model": TEST_MODEL,
        "messages": [{"role": "user", "content": "Hello world"}],
        "stream": stream,
    }
    if tools:
        payload["tools"] = tools
    return payload


def test_ab_parity_non_streaming_chat_completion(
    ab_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Validate 100% parity for basic non-streaming chat completions between legacy and v4."""
    gw_url, ctx = ab_harness
    ctx.reset()

    # 1. Baseline: legacy engine
    with httpx.Client(http2=True, verify=False) as client:
        resp_legacy = client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False),
            headers=_headers_for_engine("legacy"),
            timeout=10.0,
        )

    # 2. Candidate: v4 engine
    with httpx.Client(http2=True, verify=False) as client:
        resp_v4 = client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False),
            headers=_headers_for_engine("v4"),
            timeout=10.0,
        )

    # Identical HTTP status (200)
    assert resp_legacy.status_code == 200
    assert resp_v4.status_code == 200

    data_legacy = resp_legacy.json()
    data_v4 = resp_v4.json()

    # Verify response JSON schema
    for key in ("id", "choices", "created", "model", "usage"):
        assert key in data_legacy, f"Missing {key} in legacy response"
        assert key in data_v4, f"Missing {key} in v4 response"

    # Verify choices structure and content
    assert len(data_legacy["choices"]) == len(data_v4["choices"]) == 1
    legacy_choice = data_legacy["choices"][0]
    v4_choice = data_v4["choices"][0]

    assert legacy_choice["finish_reason"] == v4_choice["finish_reason"] == "stop"
    assert legacy_choice["message"]["content"] == v4_choice["message"]["content"] == "Mock response success"
    assert legacy_choice["message"]["role"] == v4_choice["message"]["role"] == "assistant"

    # Verify token counts parity
    assert data_v4["usage"]["prompt_tokens"] == data_legacy["usage"]["prompt_tokens"]
    assert data_v4["usage"]["completion_tokens"] == data_legacy["usage"]["completion_tokens"]
    assert data_v4["usage"]["total_tokens"] == data_legacy["usage"]["total_tokens"]


def test_ab_parity_streaming_sse_chat_completion(
    ab_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Validate 100% parity for streaming SSE chat completions between legacy and v4."""
    gw_url, ctx = ab_harness
    ctx.reset()

    def _collect_stream_chunks(engine: str) -> Tuple[List[str], str, List[Dict[str, Any]]]:
        raw_chunks: List[str] = []
        collected_content: List[str] = []
        parsed_chunks: List[Dict[str, Any]] = []

        with httpx.Client(http2=True, verify=False) as client:
            with client.stream(
                "POST",
                f"{gw_url}/v1/chat/completions",
                json=_make_req_payload(stream=True),
                headers=_headers_for_engine(engine),
                timeout=10.0,
            ) as stream_resp:
                assert stream_resp.status_code == 200
                for line in stream_resp.iter_lines():
                    trimmed = line.strip()
                    if not trimmed:
                        continue
                    raw_chunks.append(trimmed)
                    if trimmed.startswith("data: "):
                        data_str = trimmed[6:].strip()
                        if data_str == "[DONE]":
                            continue
                        parsed = json.loads(data_str)
                        parsed_chunks.append(parsed)
                        delta = parsed["choices"][0].get("delta", {})
                        if "content" in delta and delta["content"]:
                            collected_content.append(delta["content"])

        full_content = "".join(collected_content)
        return raw_chunks, full_content, parsed_chunks

    legacy_raw, legacy_content, legacy_chunks = _collect_stream_chunks("legacy")
    v4_raw, v4_content, v4_chunks = _collect_stream_chunks("v4")

    # Verify both terminate with [DONE]
    assert legacy_raw[-1] == "data: [DONE]"
    assert v4_raw[-1] == "data: [DONE]"

    # Verify concatenated delta content matches exactly
    assert legacy_content == v4_content == "Hello from mock stream!"

    # Verify finish reasons match
    legacy_finish_reasons = [
        c["choices"][0]["finish_reason"] for c in legacy_chunks if c["choices"][0]["finish_reason"]
    ]
    v4_finish_reasons = [
        c["choices"][0]["finish_reason"] for c in v4_chunks if c["choices"][0]["finish_reason"]
    ]
    assert legacy_finish_reasons == v4_finish_reasons == ["stop"]


def test_ab_parity_tool_calling_payloads(
    ab_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Validate tool calling payload structure and semantics parity between legacy and v4."""
    gw_url, ctx = ab_harness
    ctx.reset()

    sample_tools = [
        {
            "type": "function",
            "function": {
                "name": "get_current_weather",
                "description": "Get current temperature for a given location.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "location": {"type": "string", "description": "City and state"}
                    },
                    "required": ["location"],
                },
            },
        }
    ]

    with httpx.Client(http2=True, verify=False) as client:
        resp_legacy = client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False, tools=sample_tools),
            headers=_headers_for_engine("legacy"),
            timeout=10.0,
        )

    with httpx.Client(http2=True, verify=False) as client:
        resp_v4 = client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False, tools=sample_tools),
            headers=_headers_for_engine("v4"),
            timeout=10.0,
        )

    assert resp_legacy.status_code == 200
    assert resp_v4.status_code == 200

    data_legacy = resp_legacy.json()
    data_v4 = resp_v4.json()

    choice_legacy = data_legacy["choices"][0]
    choice_v4 = data_v4["choices"][0]

    assert choice_legacy["finish_reason"] == choice_v4["finish_reason"] == "tool_calls"
    assert "tool_calls" in choice_legacy["message"]
    assert "tool_calls" in choice_v4["message"]

    tools_legacy = choice_legacy["message"]["tool_calls"]
    tools_v4 = choice_v4["message"]["tool_calls"]

    assert len(tools_legacy) == len(tools_v4) == 1
    assert tools_legacy[0]["type"] == tools_v4[0]["type"] == "function"
    assert tools_legacy[0]["function"]["name"] == tools_v4[0]["function"]["name"] == "get_current_weather"
    expected_args = '{"location": "Tokyo, Japan"}'
    assert tools_legacy[0]["function"]["arguments"] == tools_v4[0]["function"]["arguments"] == expected_args


def test_v4_mandatory_client_attribution_headers(
    ab_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Verify that mandatory client attribution headers (HTTP-Referer, X-Title, User-Agent)

    are present on upstream outbound requests from the v4 engine.
    """
    gw_url, ctx = ab_harness
    ctx.reset()

    with httpx.Client(http2=True, verify=False) as client:
        resp_v4 = client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False),
            headers=_headers_for_engine("v4"),
            timeout=10.0,
        )

    assert resp_v4.status_code == 200
    assert len(ctx.state.calls) >= 1

    last_call = ctx.state.calls[-1]
    headers = {k.lower(): v for k, v in last_call.headers.items()}

    # Verify mandatory client attribution headers
    assert "http-referer" in headers, "Missing HTTP-Referer header on upstream request"
    assert headers["http-referer"] == "https://opencode.ai"

    assert "x-title" in headers, "Missing X-Title header on upstream request"
    assert headers["x-title"] == "OpenCode"

    assert "user-agent" in headers, "Missing User-Agent header on upstream request"
    assert "OpenCode" in headers["user-agent"]
