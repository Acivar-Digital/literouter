from __future__ import annotations

import subprocess
import time
from typing import Generator

import httpx
import pytest

from tests.e2e.mock_provider.config import MockControlConfig
from tests.e2e.mock_provider.runner import MockProviderProcess, find_free_port


@pytest.fixture(scope="module")
def mock_server() -> Generator[MockProviderProcess, None, None]:
    port = find_free_port()
    runner = MockProviderProcess(port=port, http_mode="auto", log_enabled=False)
    runner.start()
    try:
        yield runner
    finally:
        runner.stop()


def _make_sample_payload() -> dict[str, object]:
    return {
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "Hello mock"}],
    }


def _verify_journal_entry(
    entry: dict[str, object], expected_path: str, expected_key: str
) -> None:
    assert entry["path"] == expected_path
    assert entry["provider_key"] == expected_key


def test_health_endpoint(mock_server: MockProviderProcess) -> None:
    res = httpx.get(f"{mock_server.base_url}/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert "uptime_utc" in data


def test_openai_chat_completion_non_stream(
    mock_server: MockProviderProcess,
) -> None:
    mock_server.reset_state()
    headers = {"Authorization": "Bearer sk-test-openai-key"}
    res = httpx.post(
        f"{mock_server.base_url}/v1/chat/completions",
        headers=headers,
        json=_make_sample_payload(),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["object"] == "chat.completion"
    assert len(body["choices"]) == 1

    entries = mock_server.get_journal()
    assert len(entries) == 1
    _verify_journal_entry(
        entries[0],
        "/v1/chat/completions",
        "sk-test-openai-key",
    )


def test_anthropic_messages_non_stream(
    mock_server: MockProviderProcess,
) -> None:
    mock_server.reset_state()
    headers = {"x-api-key": "ant-api-test-key-123"}
    res = httpx.post(
        f"{mock_server.base_url}/v1/messages",
        headers=headers,
        json=_make_sample_payload(),
    )
    assert res.status_code == 200
    body = res.json()
    assert body["type"] == "message"
    assert body["role"] == "assistant"

    entries = mock_server.get_journal()
    assert len(entries) == 1
    _verify_journal_entry(
        entries[0],
        "/v1/messages",
        "ant-api-test-key-123",
    )


def test_streaming_openai_sse(mock_server: MockProviderProcess) -> None:
    mock_server.reset_state()
    payload = {
        "model": "gpt-4o",
        "messages": [{"role": "user", "content": "Stream me"}],
        "stream": True,
    }
    res = httpx.post(f"{mock_server.base_url}/v1/chat/completions", json=payload)
    assert res.status_code == 200
    assert "text/event-stream" in res.headers.get("content-type", "")
    assert "data: [DONE]" in res.text


def test_custom_status_and_rate_limit(mock_server: MockProviderProcess) -> None:
    mock_server.reset_state()
    mock_server.set_control(
        MockControlConfig(status_code=429, rate_limit_reset_sec=42)
    )

    res = httpx.post(
        f"{mock_server.base_url}/v1/chat/completions",
        json=_make_sample_payload(),
    )
    assert res.status_code == 429
    assert res.headers.get("retry-after") == "42"


def test_per_request_header_override(mock_server: MockProviderProcess) -> None:
    mock_server.reset_state()
    headers = {
        "x-mock-status": "503",
        "x-mock-rate-limit-reset": "15",
    }
    res = httpx.post(
        f"{mock_server.base_url}/v1/chat/completions",
        headers=headers,
        json=_make_sample_payload(),
    )
    assert res.status_code == 503
    assert res.headers.get("retry-after") == "15"


def test_artificial_latency(mock_server: MockProviderProcess) -> None:
    mock_server.reset_state()
    t0 = time.monotonic()
    res = httpx.post(
        f"{mock_server.base_url}/v1/chat/completions",
        headers={"x-mock-latency-ms": "120"},
        json=_make_sample_payload(),
    )
    elapsed = time.monotonic() - t0
    assert res.status_code == 200
    assert elapsed >= 0.10


def test_ghost_timeout(mock_server: MockProviderProcess) -> None:
    mock_server.reset_state()
    with pytest.raises(httpx.TimeoutException):
        httpx.post(
            f"{mock_server.base_url}/v1/chat/completions",
            headers={"x-mock-ghost": "true"},
            json=_make_sample_payload(),
            timeout=0.2,
        )


def test_http2_prior_knowledge(mock_server: MockProviderProcess) -> None:
    cmd = [
        "curl",
        "--http2-prior-knowledge",
        "-s",
        "-X",
        "POST",
        f"{mock_server.base_url}/v1/chat/completions",
        "-H",
        "Content-Type: application/json",
        "-d",
        '{"model": "gpt-4o", "messages": [{"role": "user", "content": "hi"}]}',
    ]
    res = subprocess.run(cmd, capture_output=True, text=True)
    assert res.returncode == 0
    assert "chat.completion" in res.stdout
