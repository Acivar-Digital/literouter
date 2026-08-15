from __future__ import annotations

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
    MockCallRecord,
    MockUpstreamContext,
    create_mock_upstream_app,
    get_ephemeral_port,
)

logger = logging.getLogger("e2e_mock_test")

AUTH_KEY = "test-e2e-token-secret-12345"
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


def _wait_for_health(url: str, timeout_sec: float = 6.0) -> bool:
    deadline = time.time() + timeout_sec
    headers = {"Authorization": f"Bearer {AUTH_KEY}"}
    while time.time() < deadline:
        try:
            with httpx.Client(http2=True) as client:
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
    env["OPENROUTER_BASE_URL"] = f"http://127.0.0.1:{mock_port}"
    env["OPENROUTER_API_KEYS"] = f"{KEY_1},{KEY_2}"
    env["LITEROUTER_AUTH_KEY"] = AUTH_KEY
    env["REDIS_DB"] = str(TEST_REDIS_DB)
    return env


@pytest.fixture(scope="module")
def e2e_harness() -> Generator[Tuple[str, MockUpstreamContext], None, None]:
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


def _make_req_payload(stream: bool = False) -> Dict[str, Any]:
    return {
        "model": TEST_MODEL,
        "messages": [{"role": "user", "content": "Hello world"}],
        "stream": stream,
    }


def _auth_headers() -> Dict[str, str]:
    return {"Authorization": f"Bearer {AUTH_KEY}"}


def _assert_rotation_calls(calls: List[MockCallRecord], elapsed: float) -> None:
    assert elapsed >= 1.9, f"Elapsed {elapsed:.2f}s should be >= 2.0s rotation pause"
    assert len(calls) == 2
    assert calls[0].key != calls[1].key


def _assert_stream_chunks(chunks: List[str]) -> None:
    assert len(chunks) > 0
    assert any("Hello" in c for c in chunks)


def test_e2e_mock_non_stream_success(
    e2e_harness: Tuple[str, MockUpstreamContext],
) -> None:
    gw_url, ctx = e2e_harness
    _flush_test_redis()
    ctx.reset()

    with httpx.Client(http2=True) as client:
        resp = client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False),
            headers=_auth_headers(),
            timeout=10.0,
        )

    assert resp.status_code == 200
    data = resp.json()
    assert "choices" in data
    assert data["choices"][0]["message"]["content"] == "Mock response success"
    assert len(ctx.state.calls) == 1


def test_e2e_mock_429_rotation_failover(
    e2e_harness: Tuple[str, MockUpstreamContext],
) -> None:
    gw_url, ctx = e2e_harness
    _flush_test_redis()
    ctx.reset()
    ctx.state.fail_first_n_requests = 1

    start_time = time.time()
    with httpx.Client(http2=True) as client:
        resp = client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False),
            headers=_auth_headers(),
            timeout=10.0,
        )
    elapsed = time.time() - start_time

    assert resp.status_code == 200
    _assert_rotation_calls(ctx.state.calls, elapsed)


def test_e2e_mock_streaming_sse(
    e2e_harness: Tuple[str, MockUpstreamContext],
) -> None:
    gw_url, ctx = e2e_harness
    _flush_test_redis()
    ctx.reset()

    with httpx.Client(http2=True) as client:
        with client.stream(
            "POST",
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=True),
            headers=_auth_headers(),
            timeout=10.0,
        ) as stream_resp:
            assert stream_resp.status_code == 200
            chunks = [chunk for chunk in stream_resp.iter_text() if chunk.strip()]

    _assert_stream_chunks(chunks)


def test_e2e_mock_all_keys_exhausted(
    e2e_harness: Tuple[str, MockUpstreamContext],
) -> None:
    gw_url, ctx = e2e_harness
    _flush_test_redis()
    ctx.reset()
    ctx.state.fail_all_429 = True

    with httpx.Client(http2=True) as client:
        resp = client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False),
            headers=_auth_headers(),
            timeout=15.0,
        )

    assert resp.status_code in (429, 502)
    assert len(ctx.state.calls) >= 2
