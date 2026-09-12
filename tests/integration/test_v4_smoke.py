from __future__ import annotations

import logging
import os
import subprocess
import threading
import time
from typing import Any, Dict, Generator, Tuple

import httpx
import pytest
import redis
import uvicorn

from tests.integration.mock_upstream import (
    MockUpstreamContext,
    create_mock_upstream_app,
    get_ephemeral_port,
)

logger = logging.getLogger("v4_smoke_test")

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
def v4_smoke_harness() -> Generator[Tuple[str, MockUpstreamContext], None, None]:
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


def _reset_gateway(gw_url: str) -> None:
    try:
        with httpx.Client(http2=True, verify=False) as client:
            client.post(f"{gw_url}/reset")
    except Exception:
        pass


def _headers(req_id: str | None = None) -> Dict[str, str]:
    h = {
        "Authorization": f"Bearer {AUTH_KEY}",
        "X-LiteRouter-Engine": "v4",
    }
    if req_id:
        h["X-Request-ID"] = req_id
    return h


def _make_req_payload(stream: bool = False) -> Dict[str, Any]:
    return {
        "model": TEST_MODEL,
        "messages": [{"role": "user", "content": "Smoke test prompt"}],
        "stream": stream,
    }


def test_v4_key_cooldown_rotation_on_429(
    v4_smoke_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Verify v4 engine key cooldown rotation across mock keys upon upstream 429."""
    gw_url, ctx = v4_smoke_harness
    _reset_gateway(gw_url)
    ctx.reset()
    ctx.state.fail_first_n_requests = 1

    with httpx.Client(http2=True, verify=False) as client:
        resp = client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False),
            headers=_headers(),
            timeout=10.0,
        )

    assert resp.status_code == 200
    assert len(ctx.state.calls) == 2

    first_key = ctx.state.calls[0].key
    second_key = ctx.state.calls[1].key
    assert first_key != second_key, f"Expected key rotation, but got same key: {first_key}"
    assert first_key in (KEY_1, KEY_2)
    assert second_key in (KEY_1, KEY_2)


def test_v4_circuit_breaker_rejection_on_repeated_500(
    v4_smoke_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Verify that repeated 500 errors trip the circuit breaker resulting in 503 with Retry-After."""
    gw_url, ctx = v4_smoke_harness
    _reset_gateway(gw_url)
    ctx.reset()
    ctx.state.fail_all_500 = True

    # Send requests until the failure threshold (5) is tripped
    with httpx.Client(http2=True, verify=False) as client:
        # Request 1 (3 attempts)
        client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False),
            headers=_headers(),
            timeout=10.0,
        )
        # Request 2 (further attempts, trips breaker to OPEN)
        client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False),
            headers=_headers(),
            timeout=10.0,
        )

        # Request 3: Circuit breaker is OPEN -> immediate 503 response
        resp_tripped = client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False),
            headers=_headers(),
            timeout=10.0,
        )

    assert resp_tripped.status_code == 503
    assert "retry-after" in resp_tripped.headers, "Missing Retry-After header on 503 circuit breaker response"
    retry_after = int(resp_tripped.headers["retry-after"])
    assert retry_after > 0

    err_body = resp_tripped.json()
    assert "error" in err_body
    assert err_body["error"].get("code") == "circuit_breaker_open"


def test_v4_trace_inspection_by_id(
    v4_smoke_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Verify GET /v1/traces/:reqId returns trace with client and upstream legs."""
    gw_url, ctx = v4_smoke_harness
    _reset_gateway(gw_url)
    ctx.reset()

    req_id = f"trace-smoke-{int(time.time())}"
    with httpx.Client(http2=True, verify=False) as client:
        # Send successful request with explicit X-Request-ID
        post_resp = client.post(
            f"{gw_url}/v1/chat/completions",
            json=_make_req_payload(stream=False),
            headers=_headers(req_id=req_id),
            timeout=10.0,
        )
        assert post_resp.status_code == 200

        # Query trace detail endpoint
        trace_resp = client.get(
            f"{gw_url}/v1/traces/{req_id}",
            headers=_headers(),
            timeout=5.0,
        )

    assert trace_resp.status_code == 200
    trace_data = trace_resp.json()

    assert trace_data["reqId"] == req_id
    assert trace_data["status"] == 200
    assert "legs" in trace_data

    legs = trace_data["legs"]
    assert "clientInbound" in legs and len(legs["clientInbound"]) > 0
    assert "upstreamOutbound" in legs and len(legs["upstreamOutbound"]) > 0
    assert "upstreamInbound" in legs and len(legs["upstreamInbound"]) > 0
    assert "clientOutbound" in legs and len(legs["clientOutbound"]) > 0


def test_v4_trace_inspection_errors_query(
    v4_smoke_harness: Tuple[str, MockUpstreamContext],
) -> None:
    """Verify GET /v1/traces?errors=true&n=5 returns error traces."""
    gw_url, ctx = v4_smoke_harness
    _reset_gateway(gw_url)
    ctx.reset()

    # Trigger a 400 error request with malformed JSON body
    with httpx.Client(http2=True, verify=False) as client:
        err_resp = client.post(
            f"{gw_url}/v1/chat/completions",
            content="{bad-json",
            headers=_headers(req_id="err-req-malformed-01"),
            timeout=5.0,
        )
        assert err_resp.status_code == 400

        # Query errors list
        traces_resp = client.get(
            f"{gw_url}/v1/traces?errors=true&n=5",
            headers=_headers(),
            timeout=5.0,
        )

    assert traces_resp.status_code == 200
    data = traces_resp.json()
    assert "traces" in data
    assert isinstance(data["traces"], list)
    assert len(data["traces"]) <= 5
    for t in data["traces"]:
        assert t["status"] >= 400
