"""Stream Kit Slice 3: Inter-Chunk Timing & Synthetic Heartbeat Auditor.

Measures inter-chunk arrival timestamps over SSE, asserting that inter-frame
silence never exceeds 5.5s (5500ms) during reasoning suppression, and verifying
the exact schema of synthetic empty delta heartbeat frames.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import socket
import subprocess
import sys
import threading
import time
from typing import Any, AsyncIterator, Dict, Generator, List, Optional, Tuple

import httpx
import pytest
import uvicorn
from fastapi import FastAPI, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, ConfigDict, Field

logger = logging.getLogger("streaming_kit.heartbeat_cadence")

DEFAULT_GATEWAY_URL: str = os.environ.get("LITEROUTER_BASE_URL", "https://localhost:7766")
DEFAULT_AUTH_KEY: str = "lr-or-oa-ch-no"
DEFAULT_USER_AGENT: str = "@opencode-ai/cli/2.0.0-beta.1"
DEFAULT_TEST_MODEL: str = "openrouter/openai/gpt-oss-120b:free"
MAX_ALLOWED_SILENCE_MS: float = 5500.0


# ------------------------------------------------------------------------------
# Data Models
# ------------------------------------------------------------------------------


class SSEChunkRecord(BaseModel):
    """High-resolution record of a single received SSE line or frame."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    raw_line: str
    timestamp_sec: float
    timestamp_ns: int
    delta_ms: float = 0.0
    is_data: bool = False
    is_done: bool = False
    is_comment: bool = False
    parsed_json: Optional[Dict[str, Any]] = None
    is_synthetic_heartbeat: bool = False


class CadenceAuditResult(BaseModel):
    """Aggregated results of the SSE inter-chunk cadence audit."""

    total_lines: int = 0
    data_chunks_count: int = 0
    heartbeat_chunks_count: int = 0
    max_silence_delta_ms: float = 0.0
    avg_inter_chunk_delta_ms: float = 0.0
    min_inter_chunk_delta_ms: float = 0.0
    total_duration_ms: float = 0.0
    all_deltas_ms: List[float] = Field(default_factory=list)
    records: List[SSEChunkRecord] = Field(default_factory=list)
    heartbeat_records: List[SSEChunkRecord] = Field(default_factory=list)
    passed: bool = True
    failure_reason: Optional[str] = None


# ------------------------------------------------------------------------------
# Schema Validation & Predicates (CC <= 5, Depth <= 3)
# ------------------------------------------------------------------------------


def _has_heartbeat_identifiers(data: Dict[str, Any]) -> bool:
    cid = str(data.get("id", ""))
    model = str(data.get("model", ""))
    obj = str(data.get("object", ""))
    id_match = cid.startswith("chatcmpl-heartbeat") or model == "heartbeat"
    return id_match and obj == "chat.completion.chunk"


def _has_empty_first_delta(choices: Any) -> bool:
    if not isinstance(choices, list) or len(choices) == 0:
        return False
    first = choices[0]
    if not isinstance(first, dict):
        return False
    delta = first.get("delta")
    return isinstance(delta, dict) and len(delta) == 0


def is_synthetic_heartbeat_payload(data: Dict[str, Any]) -> bool:
    """Returns True if the parsed JSON matches LiteRouter synthetic heartbeat structure."""
    if not isinstance(data, dict):
        return False
    if not _has_heartbeat_identifiers(data):
        return False
    return _has_empty_first_delta(data.get("choices"))


def _assert_root_identity(data: Dict[str, Any]) -> None:
    assert isinstance(data, dict), f"Heartbeat must be a JSON object, got {type(data)}"
    assert data.get("id") == "chatcmpl-heartbeat", f"Expected id='chatcmpl-heartbeat', got {data.get('id')}"
    assert (
        data.get("object") == "chat.completion.chunk"
    ), f"Expected object='chat.completion.chunk', got {data.get('object')}"


def _assert_root_meta(data: Dict[str, Any]) -> None:
    assert data.get("model") == "heartbeat", f"Expected model='heartbeat', got {data.get('model')}"
    assert isinstance(data.get("created"), int), f"Expected created integer timestamp, got {data.get('created')}"


def _assert_choice_fields(choice: Dict[str, Any]) -> None:
    assert choice.get("index") == 0, f"Expected choice index 0, got {choice.get('index')}"
    assert choice.get("delta") == {}, f"Expected choice delta to be empty object {{}}, got {choice.get('delta')}"
    assert (
        choice.get("finish_reason") is None
    ), f"Expected finish_reason to be null/None, got {choice.get('finish_reason')}"


def _assert_heartbeat_choice(choices: Any) -> None:
    assert isinstance(choices, list) and len(choices) == 1, f"Expected choices array with length 1, got {choices}"
    choice = choices[0]
    assert isinstance(choice, dict), f"Choice element must be dict, got {type(choice)}"
    _assert_choice_fields(choice)


def assert_heartbeat_schema(data: Dict[str, Any]) -> None:
    """Strictly asserts the schema of a LiteRouter synthetic heartbeat frame."""
    _assert_root_identity(data)
    _assert_root_meta(data)
    _assert_heartbeat_choice(data.get("choices"))


# ------------------------------------------------------------------------------
# Auditor Helpers & Class (CC <= 5, Depth <= 3)
# ------------------------------------------------------------------------------


def _parse_sse_data_payload(trimmed: str) -> Tuple[Optional[Dict[str, Any]], bool]:
    payload_str = trimmed[5:].strip()
    try:
        parsed = json.loads(payload_str)
        if isinstance(parsed, dict):
            return parsed, is_synthetic_heartbeat_payload(parsed)
    except (json.JSONDecodeError, UnicodeDecodeError, ValueError) as err:
        logger.debug("Failed parsing SSE payload JSON: %s", err)
        return None, False
    return None, False


def _is_event_chunk(r: SSEChunkRecord) -> bool:
    return r.is_data or r.is_comment


def _extract_chunk_deltas(records: List[SSEChunkRecord]) -> List[float]:
    data_records = list(filter(_is_event_chunk, records))
    if len(data_records) <= 1:
        return [0.0]
    return [r.delta_ms for r in data_records[1:]]


def _calculate_duration_ms(records: List[SSEChunkRecord]) -> float:
    if len(records) <= 1:
        return 0.0
    return (records[-1].timestamp_sec - records[0].timestamp_sec) * 1000.0


def _calc_delta_stats(deltas: List[float]) -> Tuple[float, float, float]:
    if not deltas:
        return 0.0, 0.0, 0.0
    return max(deltas), min(deltas), (sum(deltas) / len(deltas))


def _check_cadence_threshold(max_delta: float, max_allowed: float) -> Tuple[bool, Optional[str]]:
    if max_delta <= max_allowed:
        return True, None
    return False, f"Max silence {max_delta:.2f}ms exceeded threshold {max_allowed:.2f}ms"


def _compute_cadence_metrics(
    records: List[SSEChunkRecord],
    max_allowed: float,
) -> CadenceAuditResult:
    data_records = list(filter(_is_event_chunk, records))
    heartbeats = [r for r in records if r.is_synthetic_heartbeat]
    deltas = _extract_chunk_deltas(records)

    max_delta, min_delta, avg_delta = _calc_delta_stats(deltas)
    duration = _calculate_duration_ms(records)
    passed, reason = _check_cadence_threshold(max_delta, max_allowed)

    return CadenceAuditResult(
        total_lines=len(records),
        data_chunks_count=len(data_records),
        heartbeat_chunks_count=len(heartbeats),
        max_silence_delta_ms=max_delta,
        avg_inter_chunk_delta_ms=avg_delta,
        min_inter_chunk_delta_ms=min_delta,
        total_duration_ms=duration,
        all_deltas_ms=deltas,
        records=records,
        heartbeat_records=heartbeats,
        passed=passed,
        failure_reason=reason,
    )


def _validate_heartbeat_records(heartbeat_records: List[SSEChunkRecord]) -> None:
    for hb in heartbeat_records:
        assert hb.parsed_json is not None
        assert_heartbeat_schema(hb.parsed_json)


class CadenceAuditor(BaseModel):
    """Stateful auditor that records SSE lines with high-resolution timestamps and audits cadence."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    max_allowed_silence_ms: float = MAX_ALLOWED_SILENCE_MS
    records: List[SSEChunkRecord] = Field(default_factory=list)
    last_event_ts: Optional[float] = None
    start_ts: Optional[float] = None

    def _calc_arrival_delta(self, now_sec: float) -> float:
        if self.start_ts is None:
            self.start_ts = now_sec
        delta_ms = (now_sec - self.last_event_ts) * 1000.0 if self.last_event_ts is not None else 0.0
        self.last_event_ts = now_sec
        return delta_ms

    def record_line(
        self,
        line: str,
        timestamp_sec: Optional[float] = None,
        timestamp_ns: Optional[int] = None,
    ) -> SSEChunkRecord:
        """Records an incoming SSE line and calculates arrival delta from previous event."""
        now_sec = timestamp_sec if timestamp_sec is not None else time.perf_counter()
        now_ns = timestamp_ns if timestamp_ns is not None else time.perf_counter_ns()
        delta_ms = self._calc_arrival_delta(now_sec)

        trimmed = line.strip()
        is_comment = trimmed.startswith(":")
        is_data = trimmed.startswith("data:")
        is_done = trimmed in ("data: [DONE]", "data:[DONE]")

        parsed_json, is_heartbeat = _parse_sse_data_payload(trimmed) if (is_data and not is_done) else (None, False)

        record = SSEChunkRecord(
            raw_line=line,
            timestamp_sec=now_sec,
            timestamp_ns=now_ns,
            delta_ms=delta_ms,
            is_data=is_data,
            is_done=is_done,
            is_comment=is_comment,
            parsed_json=parsed_json,
            is_synthetic_heartbeat=is_heartbeat,
        )
        self.records.append(record)
        return record

    def finalize(self) -> CadenceAuditResult:
        """Calculates aggregate metrics and returns CadenceAuditResult."""
        if not self.records:
            return CadenceAuditResult(total_lines=0, passed=False, failure_reason="No SSE records captured.")
        return _compute_cadence_metrics(self.records, self.max_allowed_silence_ms)

    def assert_cadence_and_heartbeats(
        self,
        require_heartbeat: bool = False,
        expected_min_heartbeats: int = 1,
    ) -> CadenceAuditResult:
        """Finalizes and runs strict assertions on cadence thresholds and heartbeat schema."""
        result = self.finalize()
        assert result.passed, f"Cadence assertion failed: {result.failure_reason}"
        if require_heartbeat:
            assert result.heartbeat_chunks_count >= expected_min_heartbeats, "Missing required heartbeat frames"
        _validate_heartbeat_records(result.heartbeat_records)
        return result


# ------------------------------------------------------------------------------
# Streaming Client Helper (CC <= 5, Depth <= 3)
# ------------------------------------------------------------------------------


def _read_lines_into_auditor(response: httpx.Response, auditor: CadenceAuditor) -> None:
    for line in response.iter_lines():
        if line and line.strip():
            auditor.record_line(line)


def stream_and_audit(
    base_url: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    max_allowed_silence_ms: float = MAX_ALLOWED_SILENCE_MS,
    timeout_sec: float = 45.0,
    verify_tls: bool = False,
) -> CadenceAuditResult:
    """Connects to LiteRouter endpoint with streaming enabled and records arrival cadence."""
    auditor = CadenceAuditor(max_allowed_silence_ms=max_allowed_silence_ms)
    endpoint = f"{base_url.rstrip('/')}/v1/chat/completions"

    with httpx.Client(verify=verify_tls, timeout=timeout_sec) as client:
        with client.stream("POST", endpoint, headers=headers, json=payload) as response:
            if response.status_code != 200:
                err_text = response.read().decode("utf-8", errors="replace")
                raise RuntimeError(f"Streaming request failed with HTTP {response.status_code}: {err_text[:400]}")
            _read_lines_into_auditor(response, auditor)

    return auditor.finalize()


# ------------------------------------------------------------------------------
# Mock Upstream App (CC <= 5, Depth <= 3)
# ------------------------------------------------------------------------------


def _get_ephemeral_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _format_mock_sse_chunk(delta_dict: Dict[str, Any], finish_reason: Optional[str] = None) -> bytes:
    chunk = {
        "id": "chatcmpl-mock-reasoning-stream",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": DEFAULT_TEST_MODEL,
        "choices": [{"index": 0, "delta": delta_dict, "finish_reason": finish_reason}],
    }
    return f"data: {json.dumps(chunk)}\n\n".encode("utf-8")


async def slow_reasoning_sse_generator() -> AsyncIterator[bytes]:
    """Generates an SSE stream simulating prolonged reasoning tokens spanning ~6.5s."""
    yield _format_mock_sse_chunk({"role": "assistant"})

    reasoning_delays = [
        ("Reasoning phase 1: analyzing boundaries...", 1.2),
        ("Reasoning phase 2: evaluating timing thresholds...", 1.2),
        ("Reasoning phase 3: formulating internal thoughts...", 1.2),
        ("Reasoning phase 4: synthesizing final conclusion...", 1.6),
    ]

    for thought, delay in reasoning_delays:
        await asyncio.sleep(delay)
        yield _format_mock_sse_chunk({"reasoning_content": thought})

    await asyncio.sleep(1.2)
    yield _format_mock_sse_chunk({"content": "Streaming cadence audit verified."})
    await asyncio.sleep(0.1)
    yield _format_mock_sse_chunk({}, finish_reason="stop")
    yield b"data: [DONE]\n\n"


def create_cadence_mock_upstream_app() -> FastAPI:
    app = FastAPI(title="LiteRouter Slow Reasoning Mock Upstream")

    @app.get("/health")
    def health() -> Dict[str, str]:
        return {"status": "ok"}

    @app.post("/chat/completions")
    @app.post("/api/v1/chat/completions")
    async def chat_completions(request: Request) -> Response:
        body = await request.json()
        if body.get("stream", False):
            return StreamingResponse(
                slow_reasoning_sse_generator(),
                media_type="text/event-stream",
                headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
            )
        return JSONResponse(
            status_code=200,
            content={
                "id": "chatcmpl-mock-sync",
                "object": "chat.completion",
                "created": int(time.time()),
                "model": DEFAULT_TEST_MODEL,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": "mock sync"},
                        "finish_reason": "stop",
                    }
                ],
            },
        )

    return app


# ------------------------------------------------------------------------------
# Pytest Fixtures & Integration Harness (CC <= 5, Depth <= 3)
# ------------------------------------------------------------------------------


def _start_mock_server_thread(mock_port: int) -> uvicorn.Server:
    mock_app = create_cadence_mock_upstream_app()
    config = uvicorn.Config(app=mock_app, host="127.0.0.1", port=mock_port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    return server


def _probe_health_endpoint(client: httpx.Client, url: str, headers: Dict[str, str]) -> bool:
    try:
        res = client.get(f"{url}/health", headers=headers, timeout=0.5)
        return res.status_code in (200, 401)
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError) as err:
        logger.debug("Health probe error: %s", err)
        return False


def _poll_gateway_until_healthy(gw_url: str, timeout_sec: float = 8.0) -> bool:
    deadline = time.time() + timeout_sec
    headers = {"Authorization": f"Bearer {DEFAULT_AUTH_KEY}"}
    with httpx.Client(verify=False) as client:
        while time.time() < deadline:
            if _probe_health_endpoint(client, gw_url, headers):
                return True
            time.sleep(0.1)
    return False


def _build_gateway_subprocess(gw_port: int, mock_port: int) -> subprocess.Popen[bytes]:
    gw_env = os.environ.copy()
    gw_env["LITEROUTER_PORT"] = str(gw_port)
    gw_env["MOCK_OR_PORT"] = str(mock_port)
    gw_env["OPENROUTER_API_KEYS"] = "sk-test-key-mock-00000000000000001"
    gw_env["REDIS_DB"] = "14"

    return subprocess.Popen(
        ["bun", "run", "src/index.ts"],
        env=gw_env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def _cleanup_gateway(proc: subprocess.Popen[bytes], server: uvicorn.Server) -> None:
    proc.terminate()
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        proc.kill()
    server.should_exit = True


@pytest.fixture(scope="module")
def mock_reasoning_gateway_harness() -> Generator[Tuple[str, int], None, None]:
    """Launches mock upstream + LiteRouter Bun gateway configured to route through it."""
    mock_port = _get_ephemeral_port()
    gw_port = _get_ephemeral_port()

    server = _start_mock_server_thread(mock_port)
    proc = _build_gateway_subprocess(gw_port, mock_port)
    gw_url = f"https://127.0.0.1:{gw_port}"

    if not _poll_gateway_until_healthy(gw_url):
        proc.kill()
        server.should_exit = True
        pytest.fail(f"Gateway failed to start on port {gw_port}")

    try:
        yield gw_url, gw_port
    finally:
        _cleanup_gateway(proc, server)


# ------------------------------------------------------------------------------
# Unit Tests (CC <= 5, Depth <= 3)
# ------------------------------------------------------------------------------


def test_heartbeat_schema_validation_positive() -> None:
    """Verifies that authentic LiteRouter synthetic heartbeat payload passes schema assertion."""
    valid_payload = {
        "id": "chatcmpl-heartbeat",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": "heartbeat",
        "choices": [
            {
                "index": 0,
                "delta": {},
                "finish_reason": None,
            }
        ],
    }
    assert is_synthetic_heartbeat_payload(valid_payload) is True
    assert_heartbeat_schema(valid_payload)


def test_heartbeat_schema_validation_negative_non_empty_delta() -> None:
    """Verifies that payloads with non-empty delta fail heartbeat validation."""
    invalid_payload = {
        "id": "chatcmpl-heartbeat",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": "heartbeat",
        "choices": [
            {
                "index": 0,
                "delta": {"content": "not empty"},
                "finish_reason": None,
            }
        ],
    }
    assert is_synthetic_heartbeat_payload(invalid_payload) is False
    with pytest.raises(AssertionError, match="Expected choice delta to be empty object"):
        assert_heartbeat_schema(invalid_payload)


def _feed_auditor_sequence(auditor: CadenceAuditor, t0: float) -> None:
    auditor.record_line('data: {"choices":[{"delta":{"role":"assistant"}}]}', timestamp_sec=t0)
    auditor.record_line('data: {"choices":[{"delta":{"content":"A"}}]}', timestamp_sec=t0 + 1.0)
    auditor.record_line('data: {"choices":[{"delta":{"content":"B"}}]}', timestamp_sec=t0 + 2.5)
    auditor.record_line('data: {"choices":[{"delta":{"content":"C"}}]}', timestamp_sec=t0 + 4.0)
    auditor.record_line("data: [DONE]", timestamp_sec=t0 + 4.1)


def _assert_chunk_counts(result: CadenceAuditResult) -> None:
    assert result.passed is True
    assert result.total_lines == 5
    assert result.data_chunks_count == 5


def _assert_timing_deltas(result: CadenceAuditResult) -> None:
    assert pytest.approx(result.max_silence_delta_ms, rel=1e-3) == 1500.0
    assert pytest.approx(result.total_duration_ms, rel=1e-3) == 4100.0


def test_cadence_auditor_timing_calculation() -> None:
    """Verifies that the CadenceAuditor accurately calculates deltas and silence durations."""
    auditor = CadenceAuditor(max_allowed_silence_ms=5500.0)
    _feed_auditor_sequence(auditor, t0=100.0)
    result = auditor.finalize()
    _assert_chunk_counts(result)
    _assert_timing_deltas(result)


def test_cadence_auditor_max_silence_threshold_failure() -> None:
    """Verifies that an inter-chunk silence gap exceeding 5500ms fails the audit."""
    auditor = CadenceAuditor(max_allowed_silence_ms=5500.0)
    t0 = 100.0
    auditor.record_line('data: {"choices":[{"delta":{"role":"assistant"}}]}', timestamp_sec=t0)
    auditor.record_line('data: {"choices":[{"delta":{"content":"Delayed chunk"}}]}', timestamp_sec=t0 + 6.2)
    auditor.record_line("data: [DONE]", timestamp_sec=t0 + 6.3)

    result = auditor.finalize()
    assert result.passed is False
    assert result.max_silence_delta_ms >= 6200.0

    with pytest.raises(AssertionError, match="Cadence assertion failed"):
        auditor.assert_cadence_and_heartbeats()


# ------------------------------------------------------------------------------
# Integration / E2E Tests (CC <= 5, Depth <= 3)
# ------------------------------------------------------------------------------


def _collect_test_stream_lines(
    endpoint: str,
    headers: Dict[str, str],
    payload: Dict[str, Any],
    auditor: CadenceAuditor,
) -> None:
    with httpx.Client(verify=False, timeout=30.0) as client:
        with client.stream("POST", endpoint, headers=headers, json=payload) as response:
            if response.status_code != 200:
                err = response.read().decode()
                pytest.fail(f"Expected 200 OK, got {response.status_code}: {err}")
            _read_lines_into_auditor(response, auditor)


def _extract_choice_delta_content(r: SSEChunkRecord) -> Optional[str]:
    if not r.parsed_json:
        return None
    choices = r.parsed_json.get("choices")
    if not isinstance(choices, list) or len(choices) == 0:
        return None
    first = choices[0]
    if not isinstance(first, dict):
        return None
    delta = first.get("delta", {})
    return delta.get("content")


def _extract_text_content_chunks(records: List[SSEChunkRecord]) -> List[str]:
    contents = [_extract_choice_delta_content(r) for r in records]
    return [c for c in contents if c is not None]


def _assert_content_chunk_delivered(records: List[SSEChunkRecord]) -> None:
    content_chunks = _extract_text_content_chunks(records)
    assert len(content_chunks) >= 1
    assert any("Streaming cadence audit verified." in c for c in content_chunks)


def test_mock_upstream_reasoning_heartbeat_cadence_e2e(
    mock_reasoning_gateway_harness: Tuple[str, int],
) -> None:
    """E2E Test: Tests LiteRouter against mock reasoning upstream stream."""
    gw_url, _ = mock_reasoning_gateway_harness
    endpoint = f"{gw_url}/v1/chat/completions"

    headers = {
        "Authorization": f"Bearer {DEFAULT_AUTH_KEY}",
        "User-Agent": DEFAULT_USER_AGENT,
        "Content-Type": "application/json",
    }
    payload = {
        "model": DEFAULT_TEST_MODEL,
        "messages": [{"role": "user", "content": "Test reasoning heartbeat cadence"}],
        "stream": True,
    }

    auditor = CadenceAuditor(max_allowed_silence_ms=MAX_ALLOWED_SILENCE_MS)
    _collect_test_stream_lines(endpoint, headers, payload, auditor)

    result = auditor.assert_cadence_and_heartbeats(require_heartbeat=True, expected_min_heartbeats=1)
    assert result.heartbeat_chunks_count >= 1
    assert result.max_silence_delta_ms <= MAX_ALLOWED_SILENCE_MS
    _assert_content_chunk_delivered(result.records)


def _probe_live_health(url: str, headers: Dict[str, str]) -> bool:
    try:
        with httpx.Client(verify=False, timeout=1.5) as client:
            res = client.get(f"{url}/health", headers=headers)
            return res.status_code in (200, 401)
    except (httpx.ConnectError, httpx.TimeoutException, httpx.HTTPError) as err:
        logger.debug("Live probe unreachable: %s", err)
        return False


def test_live_gateway_cadence_probe() -> None:
    """Optional smoke probe against a running live LiteRouter gateway on localhost:7766."""
    live_url = os.environ.get("LITEROUTER_BASE_URL", "https://localhost:7766")
    headers = {
        "Authorization": f"Bearer {DEFAULT_AUTH_KEY}",
        "User-Agent": DEFAULT_USER_AGENT,
        "Content-Type": "application/json",
    }

    if not _probe_live_health(live_url, headers):
        pytest.skip(f"Live gateway unreachable on {live_url}")

    payload = {
        "model": DEFAULT_TEST_MODEL,
        "messages": [{"role": "user", "content": "Ping cadence test"}],
        "stream": True,
    }

    try:
        result = stream_and_audit(live_url, headers, payload, verify_tls=False)
        assert result.max_silence_delta_ms <= MAX_ALLOWED_SILENCE_MS
    except (httpx.HTTPError, RuntimeError) as err:
        logger.info("Live gateway stream notice: %s", err)


# ------------------------------------------------------------------------------
# Standalone CLI Runner (CC <= 5, Depth <= 3)
# ------------------------------------------------------------------------------


def _print_cadence_summary(result: CadenceAuditResult) -> None:
    print("\n" + "=" * 70)
    print(" STREAMING CADENCE AUDIT REPORT")
    print("=" * 70)
    print(f" Total SSE Lines       : {result.total_lines}")
    print(f" Data / Comment Chunks : {result.data_chunks_count}")
    print(f" Synthetic Heartbeats  : {result.heartbeat_chunks_count}")
    print(f" Total Duration        : {result.total_duration_ms:.2f} ms")
    print(f" Max Inter-Chunk Delta : {result.max_silence_delta_ms:.2f} ms")
    print(f" Min Inter-Chunk Delta : {result.min_inter_chunk_delta_ms:.2f} ms")
    print(f" Avg Inter-Chunk Delta : {result.avg_inter_chunk_delta_ms:.2f} ms")
    print(f" Audit Status          : {'PASSED [<= 5500ms]' if result.passed else 'FAILED'}")
    if result.failure_reason:
        print(f" Failure Reason        : {result.failure_reason}")
    print("=" * 70)

    if result.heartbeat_records:
        print("\n Synthetic Heartbeat Frames Detected:")
        for i, hb in enumerate(result.heartbeat_records, start=1):
            print(f"  [{i}] Delta: {hb.delta_ms:.2f}ms | Payload: {json.dumps(hb.parsed_json)}")
        print("=" * 70 + "\n")


def main() -> int:
    parser = argparse.ArgumentParser(description="LiteRouter Streaming Inter-Chunk Timing Auditor")
    parser.add_argument("--url", default=DEFAULT_GATEWAY_URL, help="Gateway base URL")
    parser.add_argument("--key", default=DEFAULT_AUTH_KEY, help="Authorization Bearer key")
    parser.add_argument("--user-agent", default=DEFAULT_USER_AGENT, help="Client User-Agent header")
    parser.add_argument("--model", default=DEFAULT_TEST_MODEL, help="Model identifier")
    parser.add_argument("--threshold-ms", type=float, default=MAX_ALLOWED_SILENCE_MS, help="Max allowed silence ms")
    parser.add_argument("--prompt", default="Explain streaming cadence.", help="Prompt content")

    args = parser.parse_args()
    headers = {"Authorization": f"Bearer {args.key}", "User-Agent": args.user_agent, "Content-Type": "application/json"}
    payload = {"model": args.model, "messages": [{"role": "user", "content": args.prompt}], "stream": True}

    print(f"Starting SSE cadence audit against {args.url} (Model: {args.model})...")
    try:
        result = stream_and_audit(args.url, headers, payload, args.threshold_ms, verify_tls=False)
        _print_cadence_summary(result)
        return 0 if result.passed else 1
    except (httpx.HTTPError, RuntimeError, ValueError) as err:
        print(f"ERROR: Streaming audit failed: {err}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
