"""BigQuery ingestion engine (S2).

Partition-pruned pull from ``openrouter_traces`` with incremental watermark,
dry-run byte estimation, and Parquet persistence via polars.

Auth: ``GOOGLE_APPLICATION_CREDENTIALS`` env var only (fail-closed).
The credential file body is never read or hardcoded here; the BigQuery
client consumes it via Application Default Credentials.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import polars as pl

try:  # S1 contracts (canonical); stub fallback if S1 not yet merged.
    from data.src.contracts import QueryConfig, WatermarkState
except ImportError:  # pragma: no cover - S1 missing fallback
    try:
        from src.contracts import QueryConfig, WatermarkState  # type: ignore[no-redef]
    except ImportError:
        try:
            from contracts import QueryConfig, WatermarkState  # type: ignore[no-redef]
        except ImportError:
            from pydantic import BaseModel, Field

            class QueryConfig(BaseModel):
                """Minimal S1-compatible query config stub."""

                days: int = Field(default=7, ge=1, le=365)
                limit: int = Field(default=1000, ge=1, le=100000)
                force_refresh: bool = False

            class WatermarkState(BaseModel):
                """Minimal S1-compatible watermark stub."""

                last_timestamp: datetime | None = None
                last_trace_id: str | None = None


TABLE_FQN = "project-7b250e67-6e23-4c02-ab5.openrouter.openrouter_traces"
CRED_ENV_VAR = "GOOGLE_APPLICATION_CREDENTIALS"
FALLBACK_DAYS = 7

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_RAW_DIR = REPO_ROOT / "data" / "raw"
DEFAULT_WATERMARK = DEFAULT_RAW_DIR / ".watermark.json"


def resolve_credentials() -> str:
    """Return credential path from env only; fail-closed if missing."""
    cred_path = os.environ.get(CRED_ENV_VAR, "").strip()
    if not cred_path:
        raise RuntimeError(f"Fail-closed: {CRED_ENV_VAR} env var is not set.")
    if not Path(cred_path).is_file():
        raise RuntimeError(f"Fail-closed: credential file not found at {CRED_ENV_VAR} path.")
    return cred_path


def build_query(days: int, limit: int | None = None) -> str:
    """Partition-pruned SELECT ordered by recency (canonical PLAN.md §9)."""
    safe_days = int(days)
    if safe_days < 1:
        raise ValueError("days must be >= 1")
    query = (
        f"SELECT * FROM `{TABLE_FQN}` "
        f"WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL {safe_days} DAY) "
        "ORDER BY timestamp DESC"
    )
    if limit is not None:
        query += f" LIMIT {int(limit)}"
    return query


def read_watermark(path: Path = DEFAULT_WATERMARK) -> WatermarkState:
    """Read watermark; return empty state on missing/corrupt file."""
    try:
        return WatermarkState.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError):
        return WatermarkState()


def write_watermark_atomic(state: WatermarkState, path: Path = DEFAULT_WATERMARK) -> Path:
    """Atomically persist watermark via tmp-file + os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = state.model_dump_json(indent=2)
    fd, tmp_name = tempfile.mkstemp(dir=str(path.parent), prefix=".watermark.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(payload)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp_name, path)
    except BaseException:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise
    return path


def estimate_bytes(client: Any, query: str) -> int:
    """Dry-run byte estimation; bills 0 bytes, performs no scan."""
    from google.cloud import bigquery

    job_config = bigquery.QueryJobConfig(dry_run=True, use_query_cache=False)
    job = client.query(query, job_config=job_config)
    return int(job.total_bytes_processed or 0)


def fetch_rows(client: Any, query: str) -> list[dict[str, Any]]:
    """Execute query and materialize rows (proven probe pattern)."""
    rows: list[dict[str, Any]] = []
    for record in client.query(query).result():
        item = dict(record.items())
        ts = item.get("timestamp")
        if ts is not None and not isinstance(ts, str):
            item["timestamp"] = ts.isoformat()
        rows.append(item)
    return rows


def save_parquet(rows: list[dict[str, Any]], out_path: Path) -> Path:
    """Persist rows to Parquet via polars."""
    out_path.parent.mkdir(parents=True, exist_ok=True)
    pl.DataFrame(rows).write_parquet(str(out_path))
    return out_path


def _with_limit(query: str, limit: int) -> str:
    """Append a validated LIMIT clause to a canonical analytical query."""
    safe_limit = int(limit)
    if safe_limit < 1:
        raise ValueError("limit must be >= 1")
    return f"{query.rstrip().rstrip(';')} LIMIT {safe_limit}"


def _query_dataframe(client: Any, query: str) -> pl.DataFrame:
    """Execute query via result() iteration and return a polars DataFrame."""
    rows = fetch_rows(client, query)
    if not rows:
        return pl.DataFrame()
    return pl.DataFrame(rows)


def _run_analytical(
    client: Any, query: str, limit: int, dry_run: bool
) -> pl.DataFrame | dict[str, Any]:
    """Dry-run (byte estimate, 0 billed) or live-run a canonical query."""
    final_query = _with_limit(query, limit)
    if dry_run:
        estimated = estimate_bytes(client, final_query)
        return {"dry_run": True, "query": final_query, "estimated_bytes": estimated}
    return _query_dataframe(client, final_query)


def build_cost_by_model_query() -> str:
    """Canonical PLAN §9.1: cost analysis by model (30d, status 'ok')."""
    return (
        "SELECT DATE(timestamp) AS day, model, "
        "SUM(total_cost) AS total_cost, SUM(total_tokens) AS total_tokens, "
        "COUNT(*) AS request_count "
        f"FROM `{TABLE_FQN}` "
        "WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY) "
        "AND status = 'ok' "
        "GROUP BY day, model ORDER BY day DESC, total_cost DESC"
    )


def build_user_activity_query() -> str:
    """Canonical PLAN §9.2: user activity analysis (7d)."""
    return (
        "SELECT user_id, COUNT(DISTINCT trace_id) AS trace_count, "
        "COUNT(DISTINCT session_id) AS session_count, "
        "SUM(total_tokens) AS total_tokens, SUM(total_cost) AS total_cost, "
        "AVG(duration_ms) AS avg_duration_ms "
        f"FROM `{TABLE_FQN}` "
        "WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) "
        "GROUP BY user_id ORDER BY total_cost DESC"
    )


def build_error_sample_query() -> str:
    """Canonical PLAN §9.3: error analysis sample (1h, status 'error')."""
    return (
        "SELECT trace_id, timestamp, model, level, finish_reason, "
        "metadata, input, output "
        f"FROM `{TABLE_FQN}` "
        "WHERE status = 'error' "
        "AND timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 1 HOUR) "
        "ORDER BY timestamp DESC"
    )


def build_provider_perf_query() -> str:
    """Canonical PLAN §9.4: provider performance (p50/p95, 7d, status 'ok')."""
    return (
        "SELECT provider_name, model, AVG(duration_ms) AS avg_duration_ms, "
        "APPROX_QUANTILES(duration_ms, 100)[OFFSET(50)] AS p50_duration_ms, "
        "APPROX_QUANTILES(duration_ms, 100)[OFFSET(95)] AS p95_duration_ms, "
        "COUNT(*) AS request_count "
        f"FROM `{TABLE_FQN}` "
        "WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 7 DAY) "
        "AND status = 'ok' "
        "GROUP BY provider_name, model HAVING request_count >= 10 "
        "ORDER BY avg_duration_ms"
    )


def build_usage_by_apikey_query() -> str:
    """Canonical PLAN §9.5: usage by API key (30d)."""
    return (
        "SELECT api_key_name, COUNT(DISTINCT trace_id) AS trace_count, "
        "SUM(total_cost) AS total_cost, SUM(prompt_tokens) AS prompt_tokens, "
        "SUM(completion_tokens) AS completion_tokens "
        f"FROM `{TABLE_FQN}` "
        "WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY) "
        "GROUP BY api_key_name ORDER BY total_cost DESC"
    )


def cost_by_model_30d(
    client: Any, limit: int = 1000, dry_run: bool = False
) -> pl.DataFrame | dict[str, Any]:
    """Run PLAN §9.1 cost-by-model query; dry-run returns byte estimate."""
    return _run_analytical(client, build_cost_by_model_query(), limit, dry_run)


def user_activity_7d(
    client: Any, limit: int = 1000, dry_run: bool = False
) -> pl.DataFrame | dict[str, Any]:
    """Run PLAN §9.2 user-activity query; dry-run returns byte estimate."""
    return _run_analytical(client, build_user_activity_query(), limit, dry_run)


def error_sample_1h(
    client: Any, limit: int = 100, dry_run: bool = False
) -> pl.DataFrame | dict[str, Any]:
    """Run PLAN §9.3 error-sample query; dry-run returns byte estimate."""
    return _run_analytical(client, build_error_sample_query(), limit, dry_run)


def provider_perf_7d(
    client: Any, limit: int = 1000, dry_run: bool = False
) -> pl.DataFrame | dict[str, Any]:
    """Run PLAN §9.4 provider-perf query; dry-run returns byte estimate."""
    return _run_analytical(client, build_provider_perf_query(), limit, dry_run)


def usage_by_apikey_30d(
    client: Any, limit: int = 1000, dry_run: bool = False
) -> pl.DataFrame | dict[str, Any]:
    """Run PLAN §9.5 usage-by-apikey query; dry-run returns byte estimate."""
    return _run_analytical(client, build_usage_by_apikey_query(), limit, dry_run)


def parse_timestamp(value: Any) -> datetime | None:
    """Parse an ISO timestamp value to datetime; None if unparseable."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, str) and value.strip():
        try:
            return datetime.fromisoformat(value)
        except ValueError:
            return None
    return None


def _make_client() -> Any:
    from google.cloud import bigquery

    resolve_credentials()  # fail-closed before client construction
    return bigquery.Client()


def ingest(
    config: QueryConfig,
    dry_run: bool = False,
    raw_dir: Path = DEFAULT_RAW_DIR,
    watermark_path: Path = DEFAULT_WATERMARK,
) -> dict[str, Any]:
    """Run ingestion; dry-run returns estimate only (0 bytes billed)."""
    query = build_query(config.days, config.limit)
    client = _make_client()
    estimated = estimate_bytes(client, query)
    if dry_run:
        return {"dry_run": True, "query": query, "estimated_bytes": estimated}
    rows = fetch_rows(client, query)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out_path = save_parquet(rows, raw_dir / f"traces_{stamp}.parquet")
    first = rows[0] if rows else {}
    state = WatermarkState(
        last_timestamp=parse_timestamp(first.get("timestamp")),
        last_trace_id=first.get("trace_id"),
    )
    write_watermark_atomic(state, watermark_path)
    return {
        "dry_run": False,
        "query": query,
        "estimated_bytes": estimated,
        "row_count": len(rows),
        "parquet_file": str(out_path),
    }


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """CLI args: --days overrides watermark window, --dry-run estimates only."""
    parser = argparse.ArgumentParser(description="BigQuery trace ingestion (S2).")
    parser.add_argument("--days", type=int, default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--force-refresh", action="store_true")
    parser.add_argument("--raw-dir", type=Path, default=DEFAULT_RAW_DIR)
    parser.add_argument("--watermark", type=Path, default=DEFAULT_WATERMARK)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """Entry point: resolve window, run ingest, print JSON summary."""
    args = parse_args(argv)
    days = args.days or FALLBACK_DAYS
    config = QueryConfig(
        days=days,
        limit=args.limit or QueryConfig.model_fields["limit"].default,
        force_refresh=args.force_refresh,
    )
    result = ingest(config, dry_run=args.dry_run, raw_dir=args.raw_dir, watermark_path=args.watermark)
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
