"""S6 QA analytics test suite (zero network calls).

Covers data/src/contracts.py, ingest.py, transform.py, report.py with a
mocked BigQuery client. No test touches the network: BigQuery clients are
fakes, credentials are tmp files, and all I/O lands in tmp_path.
"""

from __future__ import annotations

import inspect
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import polars as pl
import pytest
from pydantic import ValidationError

from data.src import ingest as ingest_mod
from data.src import report as report_mod
from data.src import transform as transform_mod
from data.src.contracts import OpenRouterTraceRecord, QueryConfig, WatermarkState
from data.src.ingest import (
    TABLE_FQN,
    build_query,
    estimate_bytes,
    fetch_rows,
    ingest,
    parse_timestamp,
    read_watermark,
    resolve_credentials,
    save_parquet,
    write_watermark_atomic,
)
from data.src.report import (
    NO_DATA_MSG,
    build_report_data,
    format_markdown,
    format_terminal,
    generate,
    print_report,
    write_report,
)
from data.src.transform import add_derived_metrics, latency_percentiles, normalize_status, transform, unnest_metadata

SAMPLE_JSON = Path("/tmp/opencode/bq_sample.json")


# ---------------------------------------------------------------------------
# contracts: sample parse + drift rejection + bounds
# ---------------------------------------------------------------------------


def _sample_rows() -> list[dict[str, Any]]:
    return list(json.loads(SAMPLE_JSON.read_text(encoding="utf-8")))


def test_contracts_parse_sample_json_10_of_10() -> None:
    rows = _sample_rows()
    assert len(rows) == 10
    records = [OpenRouterTraceRecord.model_validate(row) for row in rows]
    assert len(records) == 10
    assert all(r.status in ("ok", "error") for r in records)
    assert all(r.trace_id for r in records)


def test_contracts_sample_timestamps_parse() -> None:
    for row in _sample_rows():
        rec = OpenRouterTraceRecord.model_validate(row)
        assert isinstance(rec.timestamp, datetime)


def test_contracts_rejects_success_uppercase_drift() -> None:
    base: dict[str, Any] = {"trace_id": "t1", "timestamp": "2026-09-17T00:00:00+00:00"}
    with pytest.raises(ValidationError):
        OpenRouterTraceRecord.model_validate({**base, "status": "SUCCESS"})


@pytest.mark.parametrize("bad", ["SUCCESS", "OK", "Ok", "Error", "ERROR", "", "unknown"])
def test_contracts_rejects_status_drift_variants(bad: str) -> None:
    with pytest.raises(ValidationError):
        OpenRouterTraceRecord.model_validate(
            {"trace_id": "t1", "timestamp": "2026-09-17T00:00:00+00:00", "status": bad},
        )


@pytest.mark.parametrize("good", ["ok", "error"])
def test_contracts_accepts_lowercase_status(good: str) -> None:
    rec = OpenRouterTraceRecord.model_validate(
        {"trace_id": "t1", "timestamp": "2026-09-17T00:00:00+00:00", "status": good},
    )
    assert rec.status == good
    assert rec.is_error == (good == "error")


def test_contracts_json_columns_coerced() -> None:
    rec = OpenRouterTraceRecord.model_validate(
        {
            "trace_id": "t1",
            "timestamp": "2026-09-17T00:00:00+00:00",
            "status": "ok",
            "metadata": '{"ticker": "AAPL"}',
            "attributes": {"k": "v"},
            "input": None,
            "output": "",
        },
    )
    assert rec.metadata == {"ticker": "AAPL"}
    assert rec.attributes == {"k": "v"}
    assert rec.input is None
    assert rec.output is None


def test_contracts_json_list_yields_none() -> None:
    rec = OpenRouterTraceRecord.model_validate(
        {
            "trace_id": "t1",
            "timestamp": "2026-09-17T00:00:00+00:00",
            "status": "ok",
            "metadata": "[1, 2]",
        },
    )
    assert rec.metadata is None


def test_query_config_defaults() -> None:
    cfg = QueryConfig()
    assert cfg.days == 7
    assert cfg.limit == 1000
    assert cfg.force_refresh is False


@pytest.mark.parametrize("days", [0, -1, 366, 10_000])
def test_query_config_days_bounds(days: int) -> None:
    with pytest.raises(ValidationError):
        QueryConfig(days=days)


@pytest.mark.parametrize("limit", [0, -5, 100_001])
def test_query_config_limit_bounds(limit: int) -> None:
    with pytest.raises(ValidationError):
        QueryConfig(limit=limit)


# ---------------------------------------------------------------------------
# watermark: round-trip + corrupt fallback
# ---------------------------------------------------------------------------


def test_watermark_empty_on_cold_start() -> None:
    assert WatermarkState().is_empty is True
    assert WatermarkState(last_timestamp=datetime.now(timezone.utc)).is_empty is False


def test_watermark_read_write_round_trip(tmp_path: Path) -> None:
    path = tmp_path / "wm" / ".watermark.json"
    state = WatermarkState(
        last_timestamp=datetime(2026, 9, 17, 12, 0, 0, tzinfo=timezone.utc),
        last_trace_id="gen-123",
    )
    write_watermark_atomic(state, path)
    assert path.is_file()
    loaded = read_watermark(path)
    assert loaded.last_trace_id == "gen-123"
    assert loaded.last_timestamp == state.last_timestamp
    assert loaded.is_empty is False


def test_watermark_missing_file_falls_back_empty(tmp_path: Path) -> None:
    loaded = read_watermark(tmp_path / "does-not-exist.json")
    assert loaded == WatermarkState()
    assert loaded.is_empty is True


def test_watermark_corrupt_file_falls_back_empty(tmp_path: Path) -> None:
    path = tmp_path / ".watermark.json"
    path.write_text("{ not valid json [[[", encoding="utf-8")
    assert read_watermark(path).is_empty is True


def test_watermark_write_creates_parent_dirs(tmp_path: Path) -> None:
    path = tmp_path / "a" / "b" / ".watermark.json"
    write_watermark_atomic(WatermarkState(last_trace_id="x"), path)
    assert read_watermark(path).last_trace_id == "x"


# ---------------------------------------------------------------------------
# transform: resilience + no .apply() + percentiles math
# ---------------------------------------------------------------------------


def test_transform_missing_metadata_keeps_all_rows() -> None:
    df = pl.DataFrame({"trace_id": ["a", "b"], "status": ["ok", "error"]})
    out = unnest_metadata(df)
    assert out.height == 2
    for key in ("ticker", "strategy", "environment"):
        assert key in out.columns
        assert out.get_column(key).null_count() == 2


def test_transform_missing_model_parameters_keeps_rows() -> None:
    df = pl.DataFrame({"trace_id": ["a"], "status": ["ok"]})
    out = transform(df)
    assert out.height == 1
    for col in ("temperature", "top_p", "max_tokens"):
        assert col in out.columns


def test_transform_null_metadata_never_drops_rows() -> None:
    df = pl.DataFrame(
        {
            "trace_id": ["a", "b", "c"],
            "status": ["ok", "ok", "error"],
            "metadata": [None, None, None],
        },
    )
    out = transform(df)
    assert out.height == 3


def test_transform_json_string_metadata_unnested() -> None:
    df = pl.DataFrame(
        {
            "trace_id": ["a", "b"],
            "status": ["ok", "ok"],
            "metadata": ['{"ticker": "AAPL", "strategy": "trend"}', None],
        },
    )
    out = unnest_metadata(df)
    assert out.get_column("ticker").to_list()[0] == "AAPL"
    assert out.get_column("strategy").to_list()[0] == "trend"
    assert out.get_column("ticker").to_list()[1] is None


def test_transform_no_apply_rowwise_calls() -> None:
    funcs = [
        transform_mod.load_raw,
        transform_mod.unnest_metadata,
        transform_mod.extract_model_params,
        transform_mod.normalize_status,
        transform_mod.add_derived_metrics,
        transform_mod.latency_percentiles,
        transform_mod.session_rollups,
        transform_mod.transform,
        transform_mod.save_processed,
    ]
    for fn in funcs:
        assert ".apply(" not in inspect.getsource(fn), f"{fn.__name__} uses .apply()"


def test_transform_normalize_ok_to_success() -> None:
    df = pl.DataFrame({"status": ["ok", "error"], "finish_reason": ["stop", "length"]})
    out = normalize_status(df)
    assert out.get_column("status_enum").to_list() == ["SUCCESS", "ERROR"]
    assert out.get_column("finish_reason_enum").to_list() == ["NORMAL_STOP", "MAX_TOKENS"]


def test_latency_percentiles_uniform_math() -> None:
    df = pl.DataFrame({"duration_ms": [100.0] * 10})
    pct = latency_percentiles(df)
    assert pct == {"p50_ms": 100.0, "p90_ms": 100.0, "p99_ms": 100.0}


def test_latency_percentiles_ordered_math() -> None:
    df = pl.DataFrame({"duration_ms": [float(v) for v in range(1, 101)]})
    pct = latency_percentiles(df)
    assert pct["p50_ms"] is not None and pct["p90_ms"] is not None and pct["p99_ms"] is not None
    assert abs(float(pct["p50_ms"]) - 50.0) <= 2.0
    assert abs(float(pct["p90_ms"]) - 90.0) <= 2.0
    assert abs(float(pct["p99_ms"]) - 99.0) <= 2.0
    assert float(pct["p50_ms"]) <= float(pct["p90_ms"]) <= float(pct["p99_ms"])


def test_latency_percentiles_empty_and_missing() -> None:
    assert latency_percentiles(pl.DataFrame({"duration_ms": []}, schema={"duration_ms": pl.Float64})) == {
        "p50_ms": None,
        "p90_ms": None,
        "p99_ms": None,
    }
    assert latency_percentiles(pl.DataFrame({"trace_id": ["a"]})) == {
        "p50_ms": None,
        "p90_ms": None,
        "p99_ms": None,
    }


def test_derived_metrics_math() -> None:
    df = pl.DataFrame(
        {
            "duration_ms": [1000.0],
            "completion_tokens": [100],
            "prompt_tokens": [200],
            "cached_tokens": [50],
            "reasoning_tokens": [25],
            "total_tokens": [300],
            "total_cost": [0.0003],
        },
    )
    out = add_derived_metrics(df)
    assert out.get_column("throughput_tps").to_list()[0] == pytest.approx(100.0)
    assert out.get_column("cache_ratio").to_list()[0] == pytest.approx(0.25)
    assert out.get_column("reasoning_ratio").to_list()[0] == pytest.approx(0.25)
    assert out.get_column("cost_per_m_tokens").to_list()[0] == pytest.approx(1.0)


def test_derived_metrics_zero_duration_safe() -> None:
    df = pl.DataFrame(
        {
            "duration_ms": [0.0],
            "completion_tokens": [100],
            "prompt_tokens": [0],
            "cached_tokens": [0],
            "reasoning_tokens": [0],
            "total_tokens": [0],
            "total_cost": [0.0],
        },
    )
    out = add_derived_metrics(df)
    assert out.get_column("throughput_tps").to_list()[0] is None
    assert out.get_column("cache_ratio").to_list()[0] is None
    assert out.get_column("cost_per_m_tokens").to_list()[0] is None


# ---------------------------------------------------------------------------
# report: empty-frame safe + dual output
# ---------------------------------------------------------------------------


def _empty_df() -> pl.DataFrame:
    return pl.DataFrame(schema={"trace_id": pl.String, "status": pl.String})


def test_report_empty_frame_safe_build() -> None:
    rep = build_report_data(_empty_df())
    assert rep.empty is True
    assert rep.total_traces == 0


def test_report_empty_terminal_and_markdown() -> None:
    rep = build_report_data(_empty_df())
    assert NO_DATA_MSG in format_terminal(rep)
    assert NO_DATA_MSG in format_markdown(rep, "2026-09-17T00:00:00+00:00")


def test_report_dual_output_files_exist(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    text, path = generate(_empty_df(), reports_dir=tmp_path)
    assert NO_DATA_MSG in text
    assert path.is_file()
    assert path.name.startswith("REPORT_") and path.suffix == ".md"
    assert NO_DATA_MSG in path.read_text(encoding="utf-8")
    captured = capsys.readouterr()
    assert NO_DATA_MSG in captured.out


def test_report_write_report_creates_dated_file(tmp_path: Path) -> None:
    path = write_report(_empty_df(), reports_dir=tmp_path)
    assert path.is_file()
    assert path.parent == tmp_path


def test_report_nonempty_kpis() -> None:
    df = pl.DataFrame(
        {
            "trace_id": ["a", "b", "c"],
            "session_id": ["s1", "s1", "s2"],
            "status": ["ok", "ok", "error"],
            "finish_reason": ["stop", "stop", "length"],
            "duration_ms": [100.0, 200.0, 300.0],
            "model": ["m1", "m1", "m2"],
            "total_cost": [0.001, 0.002, 0.003],
            "input_cost": [0.0005, 0.001, 0.0015],
            "output_cost": [0.0005, 0.001, 0.0015],
            "prompt_tokens": [10, 20, 30],
            "cached_tokens": [5, 5, 0],
            "completion_tokens": [10, 10, 10],
        },
    )
    rep = build_report_data(df)
    assert rep.empty is False
    assert rep.total_traces == 3
    assert rep.total_sessions == 2
    assert rep.success_count == 2
    assert rep.error_count == 1
    assert rep.success_rate_pct == pytest.approx(66.67, abs=0.01)
    assert rep.total_cost == pytest.approx(0.006)
    text = format_terminal(rep)
    assert "Traces: 3" in text
    md = format_markdown(rep, "2026-09-17T00:00:00+00:00")
    assert "Total traces: **3**" in md


def test_print_report_returns_text(capsys: pytest.CaptureFixture[str]) -> None:
    text = print_report(_empty_df())
    assert NO_DATA_MSG in text
    assert NO_DATA_MSG in capsys.readouterr().out


# ---------------------------------------------------------------------------
# ingest: dry-run mocked + fail-closed auth (zero network)
# ---------------------------------------------------------------------------


def test_resolve_credentials_fail_closed_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GOOGLE_APPLICATION_CREDENTIALS", raising=False)
    with pytest.raises(RuntimeError, match="Fail-closed"):
        resolve_credentials()


def test_resolve_credentials_fail_closed_bad_path(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(tmp_path / "nope.json"))
    with pytest.raises(RuntimeError, match="Fail-closed"):
        resolve_credentials()


def test_resolve_credentials_ok_with_tmp_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    cred = tmp_path / "fake-creds.json"
    cred.write_text("{}", encoding="utf-8")
    monkeypatch.setenv("GOOGLE_APPLICATION_CREDENTIALS", str(cred))
    assert resolve_credentials() == str(cred)


def test_build_query_partition_pruned() -> None:
    q = build_query(7, 100)
    assert TABLE_FQN in q
    assert "INTERVAL 7 DAY" in q
    assert "LIMIT 100" in q
    assert "ORDER BY timestamp DESC" in q


def test_build_query_rejects_bad_days() -> None:
    with pytest.raises(ValueError, match="days must be >= 1"):
        build_query(0)


def test_parse_timestamp_values() -> None:
    now = datetime.now(timezone.utc)
    assert parse_timestamp(now) is now
    assert parse_timestamp("2026-09-17T00:00:00+00:00") == datetime(2026, 9, 17, tzinfo=timezone.utc)
    assert parse_timestamp("not-a-date") is None
    assert parse_timestamp(None) is None
    assert parse_timestamp("") is None


class _FakeJob:
    def __init__(self, total_bytes: int) -> None:
        self.total_bytes_processed: int | None = total_bytes


class _FakeRecord:
    def __init__(self, payload: dict[str, Any]) -> None:
        self._payload = payload

    def items(self) -> Any:
        return self._payload.items()


class _FakeResult:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def __iter__(self) -> Any:
        return (_FakeRecord(dict(r)) for r in self._rows)


class _FakeQueryJob:
    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._rows = rows

    def result(self) -> _FakeResult:
        return _FakeResult(self._rows)


class _FakeClient:
    def __init__(self, rows: list[dict[str, Any]] | None = None, total_bytes: int = 1234) -> None:
        self._rows = rows or []
        self._total_bytes = total_bytes
        self.seen_configs: list[Any] = []

    def query(self, _query: str, job_config: Any = None) -> Any:
        self.seen_configs.append(job_config)
        if job_config is not None and getattr(job_config, "dry_run", False):
            return _FakeJob(self._total_bytes)
        return _FakeQueryJob(self._rows)


def test_estimate_bytes_mocked_zero_scan() -> None:
    client = _FakeClient(total_bytes=4096)
    job_config = MagicMock(dry_run=True, use_query_cache=False)
    job = client.query("SELECT 1", job_config=job_config)
    assert int(job.total_bytes_processed or 0) == 4096
    assert estimate_bytes(client, "SELECT 1") == 4096


def test_fetch_rows_materializes_and_isoformats() -> None:
    ts = datetime(2026, 9, 17, 12, 0, 0, tzinfo=timezone.utc)
    rows = fetch_rows(_FakeClient([{"trace_id": "t1", "timestamp": ts, "status": "ok"}]), "SELECT 1")
    assert len(rows) == 1
    assert rows[0]["trace_id"] == "t1"
    assert rows[0]["timestamp"] == ts.isoformat()


def test_ingest_dry_run_mocked_no_parquet(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    client = _FakeClient(total_bytes=777)
    monkeypatch.setattr(ingest_mod, "_make_client", lambda: client)
    monkeypatch.setattr(ingest_mod, "estimate_bytes", lambda _c, _q: 777)
    called: list[str] = []
    monkeypatch.setattr(ingest_mod, "fetch_rows", lambda _c, _q: called.append("x") or [])
    result = ingest(
        QueryConfig(days=7, limit=10),
        dry_run=True,
        raw_dir=tmp_path / "raw",
        watermark_path=tmp_path / ".watermark.json",
    )
    assert result["dry_run"] is True
    assert result["estimated_bytes"] == 777
    assert called == []
    assert list((tmp_path / "raw").glob("*.parquet")) == []


def test_ingest_full_mocked_writes_parquet_and_watermark(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    rows = [
        {
            "trace_id": "t1",
            "timestamp": "2026-09-17T12:00:00+00:00",
            "status": "ok",
            "model": "m1",
        },
    ]
    client = _FakeClient(rows=rows)
    monkeypatch.setattr(ingest_mod, "_make_client", lambda: client)
    monkeypatch.setattr(ingest_mod, "estimate_bytes", lambda _c, _q: 100)
    monkeypatch.setattr(ingest_mod, "fetch_rows", lambda _c, _q: [dict(r) for r in rows])
    raw_dir = tmp_path / "raw"
    wm_path = tmp_path / ".watermark.json"
    result = ingest(QueryConfig(days=7, limit=10), dry_run=False, raw_dir=raw_dir, watermark_path=wm_path)
    assert result["dry_run"] is False
    assert result["row_count"] == 1
    assert Path(str(result["parquet_file"])).is_file()
    assert read_watermark(wm_path).last_trace_id == "t1"


def test_save_parquet_round_trip(tmp_path: Path) -> None:
    out = save_parquet([{"a": 1, "b": "x"}, {"a": 2, "b": "y"}], tmp_path / "t.parquet")
    assert out.is_file()
    assert pl.read_parquet(out).height == 2


def test_report_module_no_network_imports() -> None:
    src = inspect.getsource(report_mod)
    assert "bigquery" not in src.lower()
    assert "httpx" not in src.lower()
    assert "requests" not in src.lower()


# ---------------------------------------------------------------------------
# literouter-72vd: stdout Sessions == sessions parquet height (null rule)
# ---------------------------------------------------------------------------


def _sessions_df(session_ids: list[str | None]) -> pl.DataFrame:
    n = len(session_ids)
    return pl.DataFrame(
        {
            "trace_id": [f"t{i}" for i in range(n)],
            "session_id": session_ids,
            "status": ["ok"] * n,
        },
    )


def test_sessions_stdout_matches_parquet_height_on_sample() -> None:
    # Mirrors /tmp/opencode/bq_sample.parquet: 9x one session + 1x null.
    df = _sessions_df(["ses_f4fd51e8fffe8W9250FJ4lo7Zk"] * 9 + [None])
    rep = build_report_data(df)
    rollups = transform_mod.session_rollups(transform(df))
    assert rep.total_sessions == 2
    assert rollups.height == 2
    assert rep.total_sessions == rollups.height
    assert "Sessions: 2" in format_terminal(rep)


def test_sessions_null_counting_edge_cases() -> None:
    # All null-session traces collapse to exactly one session row.
    all_null = _sessions_df([None, None])
    assert build_report_data(all_null).total_sessions == 1
    assert transform_mod.session_rollups(transform(all_null)).height == 1
    # No nulls: pure distinct count.
    distinct = _sessions_df(["s1", "s1", "s2"])
    assert build_report_data(distinct).total_sessions == 2
    assert transform_mod.session_rollups(transform(distinct)).height == 2
    # Empty frame stays zero on both sides.
    empty = pl.DataFrame(schema={"trace_id": pl.String, "session_id": pl.String, "status": pl.String})
    assert build_report_data(empty).total_sessions == 0
    assert transform_mod.session_rollups(transform(empty)).height == 0
    # Missing session_id column on non-empty df counts as one null session.
    missing = pl.DataFrame({"trace_id": ["a", "b"], "status": ["ok", "ok"]})
    assert build_report_data(missing).total_sessions == 1
    assert transform_mod.session_rollups(transform(missing)).height == 1


# ---------------------------------------------------------------------------
# literouter-6ptn (Slice D): new-metrics regression (additive, mocked, no net)
# ---------------------------------------------------------------------------


def _provider_frame() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "provider_slug": ["openai", None, ""],
            "provider_name": ["Other", "anthropic", "x-model-gw"],
            "model": ["m1", "m1", "m2"],
            "duration_ms": [100.0, 200.0, 300.0],
            "throughput_tps": [10.0, 20.0, 30.0],
            "total_cost": [0.001, 0.002, 0.003],
        },
    )


def test_provider_rollups_slug_preferred_over_name() -> None:
    rollups = transform_mod.provider_rollups(_provider_frame())
    by_model = {(r["provider"], r["model"]): r for r in rollups.to_dicts()}
    assert by_model[("openai", "m1")]["n"] == 1
    assert by_model[("anthropic", "m1")]["n"] == 1


def test_provider_rollups_empty_slug_falls_back_to_name() -> None:
    rollups = transform_mod.provider_rollups(_provider_frame())
    providers = {r["provider"] for r in rollups.to_dicts()}
    assert "x-model-gw" in providers
    assert "Other" not in providers


def test_provider_rollups_p50_p95_uniform_math() -> None:
    df = pl.DataFrame(
        {
            "provider_slug": ["openai"] * 5,
            "provider_name": ["openai"] * 5,
            "model": ["m1"] * 5,
            "duration_ms": [200.0] * 5,
            "throughput_tps": [50.0] * 5,
            "total_cost": [0.001] * 5,
        },
    )
    rollups = transform_mod.provider_rollups(df)
    assert rollups.height == 1
    row = rollups.to_dicts()[0]
    assert row["n"] == 5
    assert row["p50_ms"] == pytest.approx(200.0)
    assert row["p95_ms"] == pytest.approx(200.0)
    assert row["total_cost"] == pytest.approx(0.005)


def test_provider_rollups_empty_safe() -> None:
    rollups = transform_mod.provider_rollups(pl.DataFrame(schema={"trace_id": pl.String}))
    assert rollups.height == 0
    assert {"provider", "model", "n", "p50_ms", "p95_ms"}.issubset(set(rollups.columns))


def test_cache_delta_cached_vs_cold_split_and_saving() -> None:
    df = pl.DataFrame(
        {
            "cached_tokens": [10, 0, 20, 0],
            "prompt_tokens": [100, 100, 100, 100],
            "duration_ms": [100.0, 200.0, 100.0, 200.0],
            "throughput_tps": [10.0, 20.0, 10.0, 20.0],
            "total_cost": [0.001, 0.003, 0.001, 0.003],
        },
    )
    delta = transform_mod.cache_delta(df)
    assert delta["cached_n"] == 2
    assert delta["cold_n"] == 2
    assert delta["cached_avg_duration_ms"] == pytest.approx(100.0)
    assert delta["cold_avg_duration_ms"] == pytest.approx(200.0)
    assert delta["cache_saving_usd"] == pytest.approx((0.003 - 0.001) * 2)


def test_cache_delta_null_cached_counts_as_cold() -> None:
    df = pl.DataFrame(
        {
            "cached_tokens": [10, None, None],
            "prompt_tokens": [100, 100, 100],
            "duration_ms": [100.0, 200.0, 300.0],
            "throughput_tps": [10.0, 20.0, 30.0],
            "total_cost": [0.001, 0.002, 0.003],
        },
    )
    delta = transform_mod.cache_delta(df)
    assert delta["cached_n"] == 1
    assert delta["cold_n"] == 2


def test_depth_analysis_buckets_and_failure_rate() -> None:
    sessions = pl.DataFrame(
        {
            "session_id": ["a", "b", "c", "d"],
            "turns": [1, 3, 7, 2],
            "session_cost": [0.001, 0.002, 0.003, 0.004],
            "session_duration_ms": [100.0, 200.0, 300.0, 400.0],
            "had_failure": [False, True, False, False],
        },
    )
    depth = transform_mod.depth_analysis(sessions)
    buckets = {r["depth_bucket"]: r for r in depth.to_dicts()}
    assert set(buckets) == {"1", "2-5", "6+"}
    assert buckets["1"]["n_sessions"] == 1
    assert buckets["6+"]["n_sessions"] == 1
    assert buckets["2-5"]["n_sessions"] == 2
    assert buckets["2-5"]["failure_rate"] == pytest.approx(0.5)


def test_depth_analysis_empty_safe() -> None:
    depth = transform_mod.depth_analysis(pl.DataFrame(schema={"turns": pl.Int64}))
    assert depth.height == 0
    assert {"depth_bucket", "n_sessions", "failure_rate"}.issubset(set(depth.columns))


def test_byok_flag_zero_true_null_null_paid_false() -> None:
    df = pl.DataFrame({"total_cost": [0.0, None, 0.005]})
    out = transform_mod.add_byok_flag(df)
    assert out.get_column("is_byok").to_list() == [True, None, False]


def test_byok_summary_counts() -> None:
    df = pl.DataFrame({"total_cost": [0.0, 0.0, 0.005, None]})
    summary = transform_mod.byok_summary(df)
    assert summary["byok_n"] == 2
    assert summary["paid_n"] == 1
    assert summary["total_n"] == 4
    assert summary["paid_cost"] == pytest.approx(0.005)


def test_trace_chains_429_to_ok_recovered_rate_one() -> None:
    df = pl.DataFrame(
        {
            "trace_id": ["chain1", "chain1"],
            "status_enum": ["RATE_LIMIT", "SUCCESS"],
            "status": ["error", "ok"],
            "finish_reason": ["rate_limit", "stop"],
        },
    )
    chains = transform_mod.trace_chains(df)
    assert chains.height == 1
    row = chains.to_dicts()[0]
    assert row["had_429"] is True
    assert row["ends_ok"] is True
    assert row["recovered"] is True
    stats = transform_mod.recovery_rate(chains)
    assert stats["n_429_chains"] == 1
    assert stats["n_recovered"] == 1
    assert stats["recovery_rate"] == pytest.approx(1.0)


def test_recovery_rate_all_ok_no_429_zero_safe() -> None:
    df = pl.DataFrame(
        {
            "trace_id": ["x", "y"],
            "status_enum": ["SUCCESS", "SUCCESS"],
            "status": ["ok", "ok"],
            "finish_reason": ["stop", "stop"],
        },
    )
    stats = transform_mod.recovery_rate(df)
    assert stats["n_429_chains"] == 0
    assert stats["n_recovered"] == 0
    assert stats["recovery_rate"] is None


def _report_synthetic_df() -> pl.DataFrame:
    return pl.DataFrame(
        {
            "trace_id": ["t1", "t2", "t3", "t4"],
            "session_id": ["s1", "s1", "s2", "s2"],
            "status": ["ok", "error", "ok", "ok"],
            "finish_reason": ["stop", "rate_limit", "stop", "stop"],
            "duration_ms": [100.0, 200.0, 300.0, 400.0],
            "model": ["m1", "m1", "m1", "m2"],
            "provider_name": ["openai", "openai", "anthropic", "anthropic"],
            "user_id": ["u1", "u1", "u2", "u2"],
            "api_key_name": ["k1", "k1", "k2", "k2"],
            "total_cost": [0.0, 0.002, 0.003, 0.004],
            "total_tokens": [10, 20, 30, 40],
            "prompt_tokens": [5, 10, 15, 20],
            "cached_tokens": [5, 0, 0, 0],
            "completion_tokens": [5, 10, 15, 20],
        },
    )


def test_report_new_sections_present_on_synthetic() -> None:
    rep = build_report_data(_report_synthetic_df())
    assert rep.empty is False
    assert len(rep.provider_perf_rows) > 0
    assert rep.total_chains > 0
    assert rep.chains_with_429 >= 1
    assert len(rep.user_rows) == 2
    assert len(rep.apikey_rows) == 2
    assert len(rep.turn_hist) > 0
    assert len(rep.turn_stats) > 0
    assert rep.byok_derived_count == 1
    assert rep.paid_count == 3
    md = format_markdown(rep, "2026-09-17T00:00:00+00:00")
    for section in ("### G.", "### H.", "### I1.", "### I2.", "### J.", "### K."):
        assert section in md
    term = format_terminal(rep)
    for snippet in (
        "Provider performance",
        "429 & recovery",
        "User activity",
        "Usage by API key",
        "Turn depth",
        "BYOK derived",
    ):
        assert snippet in term


def test_report_new_sections_empty_safe() -> None:
    rep = build_report_data(pl.DataFrame(schema={"trace_id": pl.String, "status": pl.String}))
    assert rep.empty is True
    assert rep.provider_perf_rows == []
    assert rep.total_chains == 0
    assert rep.chains_with_429 == 0
    assert rep.user_rows == []
    assert rep.apikey_rows == []
    assert rep.turn_hist == []
    assert rep.byok_derived_count == 0
    assert NO_DATA_MSG in format_terminal(rep)


def test_transform_pipeline_adds_is_byok_flag() -> None:
    df = pl.DataFrame({"trace_id": ["a", "b"], "status": ["ok", "ok"], "total_cost": [0.0, 0.01]})
    out = transform(df)
    assert "is_byok" in out.columns
    assert out.get_column("is_byok").to_list() == [True, False]


def test_transform_new_fns_no_apply_rowwise_calls() -> None:
    funcs = [
        transform_mod.provider_rollups,
        transform_mod.cache_delta,
        transform_mod.depth_analysis,
        transform_mod.add_byok_flag,
        transform_mod.byok_summary,
        transform_mod.trace_chains,
        transform_mod.recovery_rate,
    ]
    for fn in funcs:
        assert ".apply(" not in inspect.getsource(fn), f"{fn.__name__} uses .apply()"
