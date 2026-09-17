"""Polars vectorized transformation for OpenRouter BigQuery trace telemetry.

Reads raw Parquet batches (``data/raw/traces_*.parquet``), resiliently unnests
JSON columns (``metadata``, ``model_parameters``), normalizes categoricals,
engineers analytical features, and persists clean Parquet to ``data/processed/``.

Per ``data/PLAN.md`` §4 (transformation) + §10 (JSON access conventions).

Design rules: vectorized expressions only (no row-wise ``.apply()``),
missing/invalid JSON yields nulls and never drops rows.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

import polars as pl

META_STRING_KEYS: tuple[str, ...] = (
    "ticker",
    "strategy",
    "trade_id",
    "environment",
    "run_id",
    "trace_name",
    "generation_name",
    "department",
)

PARAM_FLOAT_KEYS: tuple[str, ...] = ("temperature", "top_p")
PARAM_INT_KEYS: tuple[str, ...] = ("max_tokens",)

TOKEN_INT_COLS: tuple[str, ...] = (
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "cached_tokens",
    "reasoning_tokens",
)


def load_raw(path: str | Path) -> pl.DataFrame:
    """Read a raw Parquet batch (or glob) into a DataFrame."""
    return pl.read_parquet(path)


def _string_key_expr(df: pl.DataFrame, col: str, key: str) -> pl.Expr:
    """Build a resilient vectorized extractor for one JSON string key."""
    if col not in df.columns:
        return pl.lit(None, dtype=pl.String).alias(key)
    dtype = df.schema[col]
    if dtype == pl.Null:
        return pl.lit(None, dtype=pl.String).alias(key)
    if dtype == pl.String:
        return pl.col(col).str.json_path_match(f"$.{key}").alias(key)
    if isinstance(dtype, pl.Struct) and key in dtype.to_schema():
        return pl.col(col).struct.field(key).cast(pl.String, strict=False).alias(key)
    if isinstance(dtype, pl.Struct):
        return pl.lit(None, dtype=pl.String).alias(key)
    return pl.col(col).cast(pl.String, strict=False).str.json_path_match(f"$.{key}").alias(key)


def unnest_metadata(df: pl.DataFrame) -> pl.DataFrame:
    """Promote business keys from ``metadata`` JSON into typed columns."""
    exprs = [_string_key_expr(df, "metadata", key) for key in META_STRING_KEYS]
    return df.with_columns(exprs)


def extract_model_params(df: pl.DataFrame) -> pl.DataFrame:
    """Extract ``temperature``/``top_p``/``max_tokens`` from ``model_parameters``."""
    exprs: list[pl.Expr] = []
    for key in PARAM_FLOAT_KEYS:
        exprs.append(
            _string_key_expr(df, "model_parameters", key).cast(pl.Float64, strict=False)
        )
    for key in PARAM_INT_KEYS:
        exprs.append(
            _string_key_expr(df, "model_parameters", key).cast(pl.Int64, strict=False)
        )
    return df.with_columns(exprs)


def normalize_status(df: pl.DataFrame) -> pl.DataFrame:
    """Normalize raw ``status`` (``ok``/``error``) and ``finish_reason`` enums."""
    s = pl.col("status").cast(pl.String, strict=False).str.to_lowercase()
    status_enum = (
        pl.when(s.is_null())
        .then(pl.lit(None, dtype=pl.String))
        .when(s == "ok")
        .then(pl.lit("SUCCESS"))
        .when(s.str.contains("429|rate_limit|resource_exhausted"))
        .then(pl.lit("RATE_LIMIT"))
        .when(s.str.contains("timeout|deadline_exceeded"))
        .then(pl.lit("TIMEOUT"))
        .when(s.str.contains("cancel"))
        .then(pl.lit("CANCELLED"))
        .otherwise(pl.lit("ERROR"))
        .alias("status_enum")
    )
    f = pl.col("finish_reason").cast(pl.String, strict=False).str.to_lowercase()
    finish_enum = (
        pl.when(f.is_null())
        .then(pl.lit(None, dtype=pl.String))
        .when(f.is_in(["stop", "completed", "end_turn"]))
        .then(pl.lit("NORMAL_STOP"))
        .when(f.is_in(["length", "max_tokens"]))
        .then(pl.lit("MAX_TOKENS"))
        .when(f.is_in(["tool_calls", "function_call"]))
        .then(pl.lit("TOOL_CALL"))
        .when(f.is_in(["content_filter", "filtered", "safety"]))
        .then(pl.lit("FILTERED"))
        .when(f.is_in(["error", "failed"]))
        .then(pl.lit("ERROR"))
        .otherwise(pl.col("finish_reason").cast(pl.String, strict=False).str.to_uppercase())
        .alias("finish_reason_enum")
    )
    if "status" not in df.columns:
        df = df.with_columns(pl.lit(None, dtype=pl.String).alias("status"))
    if "finish_reason" not in df.columns:
        df = df.with_columns(pl.lit(None, dtype=pl.String).alias("finish_reason"))
    return df.with_columns([status_enum, finish_enum])


def _safe_div(num: str, den: str) -> pl.Expr:
    """Vectorized safe division: null when denominator is null or zero."""
    return (
        pl.when(pl.col(den).is_not_null() & (pl.col(den) != 0))
        .then(pl.col(num).cast(pl.Float64, strict=False) / pl.col(den).cast(pl.Float64, strict=False))
        .otherwise(pl.lit(None, dtype=pl.Float64))
    )


def add_derived_metrics(df: pl.DataFrame) -> pl.DataFrame:
    """Add throughput, cache/reasoning ratios, and cost-per-M-tokens columns."""
    for col in TOKEN_INT_COLS:
        if col not in df.columns:
            df = df.with_columns(pl.lit(None, dtype=pl.Int64).alias(col))
    for col in ("duration_ms", "total_cost"):
        if col not in df.columns:
            df = df.with_columns(pl.lit(None, dtype=pl.Float64).alias(col))
    duration_s = (
        pl.when(pl.col("duration_ms").is_not_null() & (pl.col("duration_ms") > 0))
        .then(pl.col("duration_ms").cast(pl.Float64, strict=False) / 1000.0)
        .otherwise(pl.lit(None, dtype=pl.Float64))
    )
    throughput = (
        pl.when(duration_s.is_not_null() & pl.col("completion_tokens").is_not_null())
        .then(pl.col("completion_tokens").cast(pl.Float64, strict=False) / duration_s)
        .otherwise(pl.lit(None, dtype=pl.Float64))
        .alias("throughput_tps")
    )
    cost_per_m = (_safe_div("total_cost", "total_tokens") * 1_000_000.0).alias("cost_per_m_tokens")
    return df.with_columns(
        [
            throughput,
            _safe_div("cached_tokens", "prompt_tokens").alias("cache_ratio"),
            _safe_div("reasoning_tokens", "completion_tokens").alias("reasoning_ratio"),
            cost_per_m,
        ]
    )


def latency_percentiles(df: pl.DataFrame) -> dict[str, float | None]:
    """Compute p50/p90/p99 of ``duration_ms`` (null when column is absent/empty)."""
    if "duration_ms" not in df.columns:
        return {"p50_ms": None, "p90_ms": None, "p99_ms": None}
    lat = df.select(pl.col("duration_ms").cast(pl.Float64, strict=False).drop_nulls())
    if lat.is_empty():
        return {"p50_ms": None, "p90_ms": None, "p99_ms": None}
    return {
        "p50_ms": lat.select(pl.col("duration_ms").quantile(0.50)).item(),
        "p90_ms": lat.select(pl.col("duration_ms").quantile(0.90)).item(),
        "p99_ms": lat.select(pl.col("duration_ms").quantile(0.99)).item(),
    }


def session_rollups(df: pl.DataFrame) -> pl.DataFrame:
    """Aggregate session-level KPIs grouped by ``session_id``.

    SESSION COUNT RULE (literouter-72vd): one row per distinct non-null
    session_id plus a single null-session row when null-session traces
    exist (polars ``group_by`` keeps null as one group). Report stdout
    Sessions uses the same rule so counts agree with parquet height.
    """
    if "session_id" not in df.columns:
        df = df.with_columns(pl.lit(None, dtype=pl.String).alias("session_id"))
    if "status_enum" not in df.columns:
        df = df.with_columns(pl.lit(None, dtype=pl.String).alias("status_enum"))
    return df.group_by("session_id").agg(
        [
            pl.len().alias("turns"),
            pl.col("total_tokens").sum().alias("session_tokens"),
            pl.col("total_cost").sum().alias("session_cost"),
            pl.col("duration_ms").sum().alias("session_duration_ms"),
            pl.col("duration_ms").mean().alias("avg_duration_ms"),
            (pl.col("status_enum") != "SUCCESS").any().alias("had_failure"),
        ]
    )


def transform(df: pl.DataFrame) -> pl.DataFrame:
    """Run the full vectorized transformation pipeline without dropping rows."""
    df = unnest_metadata(df)
    df = extract_model_params(df)
    df = normalize_status(df)
    df = add_derived_metrics(df)
    return df


def save_processed(
    df: pl.DataFrame, out_dir: str | Path, stamp: str | None = None
) -> tuple[Path, Path]:
    """Persist transformed traces and session rollups as Parquet; return paths."""
    dest = Path(out_dir)
    dest.mkdir(parents=True, exist_ok=True)
    tag = stamp or datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    traces_path = dest / f"traces_processed_{tag}.parquet"
    sessions_path = dest / f"sessions_{tag}.parquet"
    df.write_parquet(traces_path)
    session_rollups(df).write_parquet(sessions_path)
    return traces_path, sessions_path


def main(argv: list[str] | None = None) -> int:
    """CLI: transform raw batch(es) into ``data/processed/`` Parquet."""
    parser = argparse.ArgumentParser(description="Transform raw trace Parquet batches.")
    parser.add_argument("--input", required=True, help="Input Parquet path or glob.")
    parser.add_argument("--output-dir", default="data/processed", help="Output directory.")
    args = parser.parse_args(argv)
    df = load_raw(args.input)
    out = transform(df)
    traces_path, sessions_path = save_processed(out, args.output_dir)
    pct = latency_percentiles(out)
    print(f"rows={out.height} traces={traces_path} sessions={sessions_path} pct={pct}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
