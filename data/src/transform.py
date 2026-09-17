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


def _provider_expr(df: pl.DataFrame) -> pl.Expr:
    """Resolve provider as ``provider_slug`` with fallback to ``provider_name``."""
    slug = (
        pl.col("provider_slug").cast(pl.String, strict=False)
        if "provider_slug" in df.columns
        else pl.lit(None, dtype=pl.String)
    )
    name = (
        pl.col("provider_name").cast(pl.String, strict=False)
        if "provider_name" in df.columns
        else pl.lit(None, dtype=pl.String)
    )
    slug_clean = (
        pl.when(slug.is_null() | (slug == ""))
        .then(pl.lit(None, dtype=pl.String))
        .otherwise(slug)
    )
    name_clean = (
        pl.when(name.is_null() | (name == ""))
        .then(pl.lit(None, dtype=pl.String))
        .otherwise(name)
    )
    return pl.coalesce([slug_clean, name_clean]).alias("provider")


def provider_rollups(df: pl.DataFrame) -> pl.DataFrame:
    """Group by (provider, model) with latency percentiles and cost totals."""
    if df.is_empty():
        return pl.DataFrame(
            schema={
                "provider": pl.String,
                "model": pl.String,
                "n": pl.UInt32,
                "p50_ms": pl.Float64,
                "p90_ms": pl.Float64,
                "p95_ms": pl.Float64,
                "p99_ms": pl.Float64,
                "avg_tps": pl.Float64,
                "total_cost": pl.Float64,
            }
        )
    work = df.with_columns(_provider_expr(df))
    if "model" not in work.columns:
        work = work.with_columns(pl.lit(None, dtype=pl.String).alias("model"))
    if "throughput_tps" not in work.columns:
        work = add_derived_metrics(work)
    if "duration_ms" not in work.columns:
        work = work.with_columns(pl.lit(None, dtype=pl.Float64).alias("duration_ms"))
    if "total_cost" not in work.columns:
        work = work.with_columns(pl.lit(None, dtype=pl.Float64).alias("total_cost"))
    dur = pl.col("duration_ms").cast(pl.Float64, strict=False)
    return (
        work.group_by(["provider", "model"])
        .agg(
            [
                pl.len().alias("n"),
                dur.quantile(0.50).alias("p50_ms"),
                dur.quantile(0.90).alias("p90_ms"),
                dur.quantile(0.95).alias("p95_ms"),
                dur.quantile(0.99).alias("p99_ms"),
                pl.col("throughput_tps").mean().alias("avg_tps"),
                pl.col("total_cost").sum().alias("total_cost"),
            ]
        )
        .sort("n", descending=True)
    )


def cache_delta(df: pl.DataFrame) -> dict[str, float | int | None]:
    """Compare cached (``cached_tokens`` > 0) vs cold rows on latency and cost.

    Null ``cached_tokens`` counts as cold (uncached). ``cache_saving_usd``
    is a heuristic: ``(cold_avg_cost - cached_avg_cost) * cached_n``
    (None when either side is empty).
    """
    work = df
    if "cached_tokens" not in work.columns:
        work = work.with_columns(pl.lit(None, dtype=pl.Int64).alias("cached_tokens"))
    if "throughput_tps" not in work.columns:
        work = add_derived_metrics(work)
    if "duration_ms" not in work.columns:
        work = work.with_columns(pl.lit(None, dtype=pl.Float64).alias("duration_ms"))
    if "total_cost" not in work.columns:
        work = work.with_columns(pl.lit(None, dtype=pl.Float64).alias("total_cost"))
    if "prompt_tokens" not in work.columns:
        work = work.with_columns(pl.lit(None, dtype=pl.Int64).alias("prompt_tokens"))
    is_cached = pl.col("cached_tokens").is_not_null() & (pl.col("cached_tokens") > 0)
    cached = work.filter(is_cached)
    cold = work.filter(~is_cached)
    cached_n, cold_n = cached.height, cold.height
    cached_avg_dur = cached.get_column("duration_ms").mean() if cached_n else None
    cold_avg_dur = cold.get_column("duration_ms").mean() if cold_n else None
    cached_avg_tps = cached.get_column("throughput_tps").mean() if cached_n else None
    cold_avg_tps = cold.get_column("throughput_tps").mean() if cold_n else None
    cached_avg_cost = cached.get_column("total_cost").mean() if cached_n else None
    cold_avg_cost = cold.get_column("total_cost").mean() if cold_n else None
    if cached_avg_cost is not None and cold_avg_cost is not None:
        saving: float | None = (float(cold_avg_cost) - float(cached_avg_cost)) * cached_n
    else:
        saving = None
    cached_tok = work.select(pl.col("cached_tokens").fill_null(0).sum()).item()
    prompt_tok = work.select(pl.col("prompt_tokens").fill_null(0).sum()).item()
    hit_ratio = (float(cached_tok) / float(prompt_tok) * 100.0) if prompt_tok else None
    return {
        "cached_n": cached_n,
        "cold_n": cold_n,
        "cached_avg_duration_ms": cached_avg_dur,
        "cold_avg_duration_ms": cold_avg_dur,
        "cached_avg_tps": cached_avg_tps,
        "cold_avg_tps": cold_avg_tps,
        "cached_avg_cost": cached_avg_cost,
        "cold_avg_cost": cold_avg_cost,
        "cache_saving_usd": saving,
        "cache_hit_ratio_pct": hit_ratio,
    }


def depth_analysis(sessions: pl.DataFrame) -> pl.DataFrame:
    """Bucket session rollups by turn depth (1 / 2-5 / 6+) with cost and risk."""
    if sessions.is_empty() or "turns" not in sessions.columns:
        return pl.DataFrame(
            schema={
                "depth_bucket": pl.String,
                "n_sessions": pl.UInt32,
                "avg_cost": pl.Float64,
                "avg_latency_ms": pl.Float64,
                "failure_rate": pl.Float64,
            }
        )
    work = sessions
    if "session_cost" not in work.columns:
        work = work.with_columns(pl.lit(None, dtype=pl.Float64).alias("session_cost"))
    if "session_duration_ms" not in work.columns:
        work = work.with_columns(pl.lit(None, dtype=pl.Float64).alias("session_duration_ms"))
    if "had_failure" not in work.columns:
        work = work.with_columns(pl.lit(False).alias("had_failure"))
    bucket = (
        pl.when(pl.col("turns").is_null())
        .then(pl.lit(None, dtype=pl.String))
        .when(pl.col("turns") <= 1)
        .then(pl.lit("1"))
        .when(pl.col("turns") <= 5)
        .then(pl.lit("2-5"))
        .otherwise(pl.lit("6+"))
        .alias("depth_bucket")
    )
    return (
        work.with_columns(bucket)
        .group_by("depth_bucket")
        .agg(
            [
                pl.len().alias("n_sessions"),
                pl.col("session_cost").mean().alias("avg_cost"),
                pl.col("session_duration_ms").mean().alias("avg_latency_ms"),
                pl.col("had_failure").cast(pl.Float64, strict=False).mean().alias("failure_rate"),
            ]
        )
        .sort("depth_bucket")
    )


def add_byok_flag(df: pl.DataFrame) -> pl.DataFrame:
    """Add ``is_byok`` derived flag (heuristic: ``total_cost == 0``).

    There is no native ``is_byok`` column upstream; ``api_key_name``
    patterns are secondary hints only — zero cost is the authority.
    Null cost yields null flag (unknown).
    """
    if "total_cost" not in df.columns:
        df = df.with_columns(pl.lit(None, dtype=pl.Float64).alias("total_cost"))
    flag = (
        pl.when(pl.col("total_cost").is_null())
        .then(pl.lit(None, dtype=pl.Boolean))
        .when(pl.col("total_cost") == 0)
        .then(pl.lit(True))
        .otherwise(pl.lit(False))
        .alias("is_byok")
    )
    return df.with_columns(flag)


def byok_summary(df: pl.DataFrame) -> dict[str, float | int | None]:
    """Summarize BYOK (zero-cost) vs paid request volume and spend."""
    work = df if "is_byok" in df.columns else add_byok_flag(df)
    if "total_cost" not in work.columns:
        work = work.with_columns(pl.lit(None, dtype=pl.Float64).alias("total_cost"))
    byok = work.filter(pl.col("is_byok") == True)  # noqa: E712
    paid = work.filter(pl.col("is_byok") == False)  # noqa: E712
    total = work.height
    byok_n, paid_n = byok.height, paid.height
    byok_cost = byok.select(pl.col("total_cost").fill_null(0.0).sum()).item() if byok_n else 0.0
    paid_cost = paid.select(pl.col("total_cost").fill_null(0.0).sum()).item() if paid_n else 0.0
    return {
        "byok_n": byok_n,
        "paid_n": paid_n,
        "total_n": total,
        "byok_share": (byok_n / total) if total else None,
        "byok_cost": float(byok_cost),
        "paid_cost": float(paid_cost),
    }


def _is_429_expr(df: pl.DataFrame) -> pl.Expr:
    """Vectorized per-row 429 predicate across status/level/attributes."""
    parts: list[pl.Expr] = []
    if "status_enum" in df.columns:
        parts.append(pl.col("status_enum") == "RATE_LIMIT")
    for col in ("status", "level"):
        if col in df.columns:
            s = pl.col(col).cast(pl.String, strict=False).str.to_lowercase()
            parts.append(s.str.contains("429|rate_limit|resource_exhausted"))
    if "attributes" in df.columns:
        dtype = df.schema["attributes"]
        if dtype == pl.String or dtype == pl.Null:
            attr = pl.col("attributes").cast(pl.String, strict=False).str.to_lowercase()
        else:
            attr = pl.col("attributes").cast(pl.String, strict=False).str.to_lowercase()
        parts.append(attr.str.contains("429|resource_exhausted"))
    if not parts:
        return pl.lit(False).alias("is_429")
    expr: pl.Expr = parts[0].fill_null(False)
    for extra in parts[1:]:
        expr = expr | extra.fill_null(False)
    return expr.alias("is_429")


def trace_chains(df: pl.DataFrame) -> pl.DataFrame:
    """Group spans by ``trace_id`` into retry chains with 429 lineage."""
    if df.is_empty():
        return pl.DataFrame(
            schema={
                "trace_id": pl.String,
                "chain_length": pl.UInt32,
                "had_429": pl.Boolean,
                "ends_ok": pl.Boolean,
                "recovered": pl.Boolean,
            }
        )
    work = df
    if "trace_id" not in work.columns:
        work = work.with_columns(pl.lit(None, dtype=pl.String).alias("trace_id"))
    if "status_enum" not in work.columns:
        work = normalize_status(work)
    work = work.with_columns(_is_429_expr(work))
    order_col: str | None = None
    for candidate in ("timestamp", "start_time"):
        if candidate in work.columns:
            order_col = candidate
            break
    if order_col is not None:
        work = work.sort(["trace_id", order_col], nulls_last=True)
    raw_ok = pl.col("status_enum") == "SUCCESS"
    return work.group_by("trace_id").agg(
        [
            pl.len().alias("chain_length"),
            pl.col("is_429").any().alias("had_429"),
            raw_ok.last().alias("ends_ok"),
            (pl.col("is_429").any() & raw_ok.last()).alias("recovered"),
        ]
    )


def recovery_rate(chains_or_traces: pl.DataFrame) -> dict[str, float | int | None]:
    """Compute 429 recovery rate from ``trace_chains`` output or raw traces."""
    chains = chains_or_traces
    if "had_429" not in chains.columns:
        chains = trace_chains(chains_or_traces)
    n_429 = chains.filter(pl.col("had_429") == True).height  # noqa: E712
    n_recovered = chains.filter(pl.col("recovered") == True).height  # noqa: E712
    return {
        "n_429_chains": n_429,
        "n_recovered": n_recovered,
        "recovery_rate": (n_recovered / n_429) if n_429 else None,
    }


def transform(df: pl.DataFrame) -> pl.DataFrame:
    """Run the full vectorized transformation pipeline without dropping rows."""
    df = unnest_metadata(df)
    df = extract_model_params(df)
    df = normalize_status(df)
    df = add_derived_metrics(df)
    df = add_byok_flag(df)
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
