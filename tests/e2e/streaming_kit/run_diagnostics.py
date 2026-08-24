"""Streaming Diagnostic Kit 2.0 - Master Diagnostic Runner & Reporter.

Executes all automated test scenarios defined in docs/Stream_Idle_Timeouts_2.0.md:
  1) Scenario 1 & 4: Extract and Replay Turn Payload & Byte Sanitization
     (tests/e2e/streaming_kit/extract_and_replay.py)
  2) Scenario 1 & 3: Strict Vercel AI SDK / Zod Stream Parser Probe
     (bun run tests/e2e/streaming_kit/vercel_zod_probe.ts)
  3) Scenario 2: Extended Reasoning Silence & Heartbeat Cadence Auditor
     (uv run pytest tests/e2e/streaming_kit/test_heartbeat_cadence.py)

Captures all outputs, execution timing, verifies gateway health, and generates
a structured Markdown and Console accreditation summary.
"""

from __future__ import annotations

import datetime
import os
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx
from pydantic import BaseModel, ConfigDict, Field

SCRIPT_DIR = Path(__file__).parent.resolve()
WORKSPACE_ROOT = SCRIPT_DIR.parent.parent.parent.resolve()

GATEWAY_ENDPOINTS = [
    "https://localhost:7766",
    "http://localhost:7766",
]


class TestScenarioResult(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    scenario_id: str
    name: str
    target_file: str
    command: List[str]
    description: str
    expected_metric: str
    passed: bool = False
    exit_code: int = -1
    duration_sec: float = 0.0
    stdout: str = ""
    stderr: str = ""
    error_summary: Optional[str] = None
    extra_metrics: Dict[str, Any] = Field(default_factory=dict)


class GatewayHealthInfo(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    reachable: bool = False
    endpoint: str = ""
    status: str = "unknown"
    uptime_sec: float = 0.0
    circuit_breakers: Dict[str, Any] = Field(default_factory=dict)
    h2_outbound: Dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None


def _probe_single_endpoint(base_url: str) -> Optional[GatewayHealthInfo]:
    """Probe a single base URL for health status."""
    health_url = f"{base_url}/health"
    try:
        with httpx.Client(verify=False, timeout=5.0) as client:
            res = client.get(health_url)
            if res.status_code == 200:
                data = res.json()
                return GatewayHealthInfo(
                    reachable=True,
                    endpoint=health_url,
                    status=data.get("status", "healthy"),
                    uptime_sec=float(data.get("uptime", 0.0)),
                    circuit_breakers=data.get("circuit_breakers", {}),
                    h2_outbound=data.get("h2_outbound", {}),
                )
    except Exception:
        return None
    return None


def check_gateway_health() -> GatewayHealthInfo:
    """Probe LiteRouter gateway health on port 7766."""
    for base_url in GATEWAY_ENDPOINTS:
        info = _probe_single_endpoint(base_url)
        if info is not None:
            return info

    return GatewayHealthInfo(
        reachable=False,
        error="Unable to connect to LiteRouter on https://localhost:7766 or http://localhost:7766",
    )


def _handle_proc_completion(proc: subprocess.CompletedProcess[str]) -> Tuple[int, str, str, Optional[str]]:
    """Convert completed subprocess result into standard tuple."""
    err_sum = None if proc.returncode == 0 else f"Process exited with code {proc.returncode}"
    return proc.returncode, proc.stdout, proc.stderr, err_sum


def _run_subprocess_safe(command: List[str], timeout_sec: float) -> Tuple[int, str, str, Optional[str]]:
    """Safely execute a subprocess with timeout protection."""
    env = dict(os.environ, NODE_TLS_REJECT_UNAUTHORIZED="0")
    try:
        proc = subprocess.run(
            command,
            cwd=str(WORKSPACE_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout_sec,
            env=env,
        )
        return _handle_proc_completion(proc)
    except subprocess.TimeoutExpired as exc:
        out = str(exc.stdout or "")
        err = str(exc.stderr or "")
        return 124, out, err, f"Test timed out after {timeout_sec}s"
    except Exception as exc:
        return 1, "", str(exc), f"Execution exception: {exc}"


def _get_display_target_path(target_path: Path) -> str:
    """Return relative or absolute display path for target file."""
    if target_path.is_relative_to(WORKSPACE_ROOT):
        return str(target_path.relative_to(WORKSPACE_ROOT))
    return str(target_path)


def execute_diagnostic_step(
    scenario_id: str,
    name: str,
    target_rel_path: str,
    command: List[str],
    description: str,
    expected_metric: str,
    timeout_sec: float = 180.0,
) -> TestScenarioResult:
    """Execute a single diagnostic scenario subprocess and capture results."""
    target_path = SCRIPT_DIR / target_rel_path if not os.path.isabs(target_rel_path) else Path(target_rel_path)
    result = TestScenarioResult(
        scenario_id=scenario_id,
        name=name,
        target_file=_get_display_target_path(target_path),
        command=command,
        description=description,
        expected_metric=expected_metric,
    )

    if not target_path.exists():
        result.passed = False
        result.exit_code = 127
        result.error_summary = f"Target script not found: {target_path}"
        result.stderr = f"File missing: {target_path}"
        return result

    start_time = time.perf_counter()
    exit_code, stdout, stderr, err_sum = _run_subprocess_safe(command, timeout_sec)
    result.duration_sec = time.perf_counter() - start_time
    result.exit_code = exit_code
    result.stdout = stdout
    result.stderr = stderr
    result.passed = exit_code == 0
    result.error_summary = err_sum
    return result


def _format_header(now_utc: str, all_passed: bool, duration_sec: float) -> List[str]:
    """Format markdown header section."""
    verdict = "PASSED (All Scenarios Verified)" if all_passed else "FAILED (Issues Detected)"
    verdict_badge = f"{'✅' if all_passed else '❌'} {verdict}"
    return [
        "# Streaming Diagnostic Kit 2.0 - Verification Report",
        f"**Timestamp (UTC):** `{now_utc}`  ",
        f"**Overall Suite Verdict:** {verdict_badge}  ",
        f"**Total Suite Duration:** `{duration_sec:.2f}s`  ",
        "",
    ]


def _format_health_section(health: GatewayHealthInfo) -> List[str]:
    """Format LiteRouter gateway health summary."""
    lines = ["## 1. LiteRouter Gateway Health & Status"]
    if health.reachable:
        lines.append(f"- **Endpoint:** `{health.endpoint}`")
        lines.append(f"- **Status:** `{health.status}`")
        lines.append(f"- **Uptime:** `{health.uptime_sec:.1f}s`")
        lines.append(f"- **Active H2 Outbound Sessions:** `{health.h2_outbound}`")
        lines.append(f"- **Circuit Breakers:** `{health.circuit_breakers}`")
    else:
        lines.append(f"- **Reachability:** ❌ UNREACHABLE (`{health.error}`)")
    lines.append("")
    return lines


def _format_scenarios_table(results: List[TestScenarioResult]) -> List[str]:
    """Format scenario execution matrix table."""
    lines = [
        "## 2. Diagnostic Scenarios Matrix",
        "| Scenario | Target Harness | Expected Metric / Contract | Duration | Verdict |",
        "|---|---|---|---|---|",
    ]
    for r in results:
        status_badge = "✅ PASS" if r.passed else f"❌ FAIL (exit {r.exit_code})"
        row = (
            f"| **{r.scenario_id}**: {r.name} | `{r.target_file}` | "
            f"{r.expected_metric} | {r.duration_sec:.2f}s | {status_badge} |"
        )
        lines.append(row)
    lines.append("")
    return lines


def _is_component_passed(results: List[TestScenarioResult], substring: str) -> bool:
    """Check if matching scenario result passed."""
    for r in results:
        if substring in r.target_file:
            return r.passed
    return False


def _build_criteria_row(label: str, expected: str, ok_text: str, fail_text: str, passed: bool) -> str:
    """Build single row in criteria verification table."""
    obs = ok_text if passed else fail_text
    badge = "✅ PASS" if passed else "❌ FAIL"
    return f"| **{label}** | {expected} | {obs} | {badge} |"


def _format_acceptance_criteria(health: GatewayHealthInfo, results: List[TestScenarioResult]) -> List[str]:
    """Format criteria verification table according to doc specifications."""
    zod_pass = _is_component_passed(results, "vercel_zod_probe")
    cadence_pass = _is_component_passed(results, "test_heartbeat_cadence")
    replay_pass = _is_component_passed(results, "extract_and_replay")

    row1 = _build_criteria_row(
        "Zod Delta Validation",
        "Zero `content: null` chunks emitted",
        "Validated 0 content:null chunks against StrictOpenAIChunkSchema",
        "Zod schema validation failed",
        zod_pass,
    )
    row2 = _build_criteria_row(
        "Max Inter-Chunk Silence",
        "< 5.5 seconds (Heartbeat fires)",
        "Heartbeat cadences <= 5500ms verified",
        "Silence timeout or heartbeat missing",
        cadence_pass,
    )
    row3 = _build_criteria_row(
        "Replay & Control Sanitization",
        "Raw `\\r` sanitized, turn succeeds",
        "Payloads replayed and 0 unescaped control chars",
        "Replay failure or sanitization defect",
        replay_pass,
    )
    row4 = _build_criteria_row(
        "Gateway Status & Connectivity",
        "HTTP 200 on `/health` and stream",
        "Gateway healthy & accepting stream requests",
        "Gateway connection error",
        health.reachable,
    )

    return [
        "## 3. Detailed Acceptance Criteria Verification",
        "| Criterion | Expected Condition | Observed Result | Pass/Fail |",
        "|---|---|---|---|",
        row1,
        row2,
        row3,
        row4,
        "",
    ]


def _format_single_failure(r: TestScenarioResult) -> List[str]:
    """Format diagnostic details for a single failed scenario."""
    lines = [
        f"### ❌ {r.scenario_id}: {r.name}",
        f"- **Command:** `{' '.join(r.command)}`",
        f"- **Exit Code:** `{r.exit_code}`",
    ]
    if r.error_summary:
        lines.append(f"- **Error:** `{r.error_summary}`")
    raw_log = r.stderr.strip() or r.stdout.strip()
    if raw_log:
        lines.extend(["```", raw_log[:2000], "```"])
    return lines


def _format_failures_section(results: List[TestScenarioResult]) -> List[str]:
    """Format failure diagnostics section if any scenario failed."""
    failed = [r for r in results if not r.passed]
    if not failed:
        return []
    lines = ["## 4. Failure Diagnostics & Logs"]
    for r in failed:
        lines.extend(_format_single_failure(r))
    lines.append("")
    return lines


def render_report(health: GatewayHealthInfo, results: List[TestScenarioResult], total_duration_sec: float) -> str:
    """Generate Markdown and terminal verification report."""
    now_utc = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    all_passed = health.reachable and all(r.passed for r in results)

    lines: List[str] = []
    lines.extend(_format_header(now_utc, all_passed, total_duration_sec))
    lines.extend(_format_health_section(health))
    lines.extend(_format_scenarios_table(results))
    lines.extend(_format_acceptance_criteria(health, results))
    lines.extend(_format_failures_section(results))
    return "\n".join(lines)


def _get_suite_scenarios() -> List[Dict[str, Any]]:
    """Return suite definitions for the 3 test stages."""
    return [
        {
            "scenario_id": "Scenario 1 & 4",
            "name": "DB Payload Replay & Byte Sanitization",
            "target_rel_path": "extract_and_replay.py",
            "command": ["uv", "run", "python", str(SCRIPT_DIR / "extract_and_replay.py")],
            "description": "Replays failing turn payload and checks for null content and control char sanitization",
            "expected_metric": "Zero content:null chunks & clean byte stream",
            "timeout_sec": 240.0,
        },
        {
            "scenario_id": "Scenario 1 & 3",
            "name": "Vercel AI SDK Strict Zod Stream Parser Probe",
            "target_rel_path": "vercel_zod_probe.ts",
            "command": ["bun", "run", str(SCRIPT_DIR / "vercel_zod_probe.ts")],
            "description": "Streams reasoning & tool-call deltas with strict @ai-sdk/openai Zod schemas",
            "expected_metric": "Zero Zod validation exceptions & valid tool serialization",
            "timeout_sec": 120.0,
        },
        {
            "scenario_id": "Scenario 2",
            "name": "Reasoning Silence & Heartbeat Cadence Auditor",
            "target_rel_path": "test_heartbeat_cadence.py",
            "command": ["uv", "run", "pytest", "-v", str(SCRIPT_DIR / "test_heartbeat_cadence.py")],
            "description": "Measures SSE inter-chunk arrival timestamps and empty delta heartbeats",
            "expected_metric": "Max inter-frame silence <= 5500ms & heartbeat deltas",
            "timeout_sec": 120.0,
        },
    ]


def _run_single_scenario(s: Dict[str, Any], idx: int) -> TestScenarioResult:
    """Run a single test scenario and log console progress."""
    print(f"\n[Step {idx}/3] Executing {s['scenario_id']}: {s['name']}...")
    print(f"  Target: {s['target_rel_path']}")
    print(f"  Command: {' '.join(s['command'])}")

    res = execute_diagnostic_step(
        scenario_id=s["scenario_id"],
        name=s["name"],
        target_rel_path=s["target_rel_path"],
        command=s["command"],
        description=s["description"],
        expected_metric=s["expected_metric"],
        timeout_sec=s["timeout_sec"],
    )

    if res.passed:
        print(f"  ✓ {s['scenario_id']} PASSED in {res.duration_sec:.2f}s")
    else:
        print(f"  ✗ {s['scenario_id']} FAILED in {res.duration_sec:.2f}s (Exit code: {res.exit_code})")
        if res.error_summary:
            print(f"    Error: {res.error_summary}")

    return res


def _log_gateway_health(health: GatewayHealthInfo) -> None:
    """Log gateway health status banner."""
    if health.reachable:
        print(f"  ✓ LiteRouter is HEALTHY on {health.endpoint} (uptime: {health.uptime_sec:.1f}s)")
    else:
        print(f"  ✗ WARNING: LiteRouter is UNREACHABLE: {health.error}")


def run_all_diagnostics() -> int:
    """Run full test suite orchestrator."""
    suite_start = time.perf_counter()
    print("=" * 70)
    print("   STREAMING DIAGNOSTIC KIT 2.0 - MASTER TEST HARNESS RUNNER")
    print("=" * 70)

    print("\n[Step 0/3] Checking LiteRouter Gateway Health (localhost:7766)...")
    health = check_gateway_health()
    _log_gateway_health(health)

    scenarios = _get_suite_scenarios()
    results = [_run_single_scenario(s, idx) for idx, s in enumerate(scenarios, 1)]

    total_duration = time.perf_counter() - suite_start
    report = render_report(health, results, total_duration)

    print("\n" + "=" * 70)
    print("                     VERIFICATION REPORT")
    print("=" * 70 + "\n")
    print(report)

    all_passed = health.reachable and all(r.passed for r in results)
    return 0 if all_passed else 1


if __name__ == "__main__":
    sys.exit(run_all_diagnostics())
