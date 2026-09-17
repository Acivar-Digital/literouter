"""QA analytics dual-output report generator (S4).

Input: processed polars frames (post-transform trace records).
Output: (1) ASCII summary table to stdout, (2) dated Markdown file in
``data/reports/REPORT_YYYYMMDD_HHMMSS.md``.

Informational only: never exits non-zero, never raises on empty input.
Empty frames produce a graceful "no data" message in both outputs.

Per data/PLAN.md section 6 + grill_me decisions 4 (informational only)
and 5 (dual output).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import polars as pl

REPORTS_DIR = Path("data/reports")
REPORT_PREFIX = "REPORT_"
NO_DATA_MSG = "No trace data available for the selected window."
SLOW_P99_MS = 10_000.0

LATENCY_COLS = ("duration_ms",)
COST_COLS = ("input_cost", "output_cost", "total_cost")
TOKEN_COLS = ("prompt_tokens", "completion_tokens", "total_tokens")


@dataclass
class ModelLatency:
    model: str
    count: int
    p50_ms: float
    p90_ms: float
    p95_ms: float
    p99_ms: float
    avg_tokens_per_sec: float


@dataclass
class ReportData:
    total_traces: int = 0
    total_sessions: int = 0
    date_from: str = "-"
    date_to: str = "-"
    success_count: int = 0
    error_count: int = 0
    success_rate_pct: float = 0.0
    total_input_cost: float = 0.0
    total_output_cost: float = 0.0
    total_cost: float = 0.0
    cache_hit_ratio_pct: float = 0.0
    byok_count: int = 0
    byok_cost: float = 0.0
    latencies: list[ModelLatency] = field(default_factory=list)
    slow_models: list[str] = field(default_factory=list)
    error_breakdown: list[tuple[str, int]] = field(default_factory=list)
    finish_breakdown: list[tuple[str, int]] = field(default_factory=list)
    rate_limit_by_provider: list[tuple[str, int]] = field(default_factory=list)
    overflow_count: int = 0
    strategy_rows: list[tuple[str, int, float, float]] = field(default_factory=list)
    ticker_rows: list[tuple[str, int, float, float]] = field(default_factory=list)
    reasoning_rows: list[tuple[str, float, float]] = field(default_factory=list)
    empty: bool = True


def _has(df: pl.DataFrame, col: str) -> bool:
    return col in df.columns


def _quantile(s: pl.Series, q: float) -> float:
    vals = s.drop_nulls()
    if len(vals) == 0:
        return 0.0
    return float(vals.quantile(q, interpolation="nearest") or 0.0)


def _value_counts(df: pl.DataFrame, col: str) -> list[tuple[str, int]]:
    if not _has(df, col):
        return []
    vc = df.get_column(col).fill_null("unknown").cast(pl.String).value_counts()
    vc = vc.sort("count", descending=True)
    return [(str(m), int(c)) for m, c in zip(vc[col].to_list(), vc["count"].to_list())]


def _kpi_section(df: pl.DataFrame, rep: ReportData) -> None:
    rep.total_traces = df.height
    rep.empty = df.height == 0
    if rep.empty:
        return
    if _has(df, "session_id"):
        col = df.get_column("session_id")
        # SESSION COUNT RULE (literouter-72vd): distinct non-null session_id
        # + 1 extra session if any null-session traces exist. This matches
        # transform.session_rollups where group_by("session_id") keeps null
        # as a single group, so stdout Sessions == sessions parquet height.
        rep.total_sessions = col.drop_nulls().n_unique() + (1 if col.null_count() > 0 else 0)
    elif df.height > 0:
        # No session_id column: transform fabricates an all-null column whose
        # group_by yields exactly one (null) session row.
        rep.total_sessions = 1
    if _has(df, "timestamp"):
        ts = df.get_column("timestamp").drop_nulls()
        if len(ts) > 0:
            rep.date_from = str(ts.min())
            rep.date_to = str(ts.max())
    if _has(df, "status"):
        st = df.get_column("status").cast(pl.String).str.to_lowercase()
        rep.success_count = int((st == "ok").sum())
        rep.error_count = int((st == "error").sum())
        rep.success_rate_pct = round(100.0 * rep.success_count / df.height, 2)


def _cost_section(df: pl.DataFrame, rep: ReportData) -> None:
    if rep.empty:
        return
    for attr, col in (("total_input_cost", "input_cost"), ("total_output_cost", "output_cost")):
        if _has(df, col):
            setattr(rep, attr, round(float(df.get_column(col).fill_null(0).sum()), 6))
    if _has(df, "total_cost"):
        rep.total_cost = round(float(df.get_column("total_cost").fill_null(0).sum()), 6)
    if _has(df, "cached_tokens") and _has(df, "prompt_tokens"):
        cached = float(df.get_column("cached_tokens").fill_null(0).sum())
        prompt = float(df.get_column("prompt_tokens").fill_null(0).sum())
        rep.cache_hit_ratio_pct = round(100.0 * cached / prompt, 2) if prompt > 0 else 0.0
    if _has(df, "is_byok"):
        byok = df.filter(pl.col("is_byok").fill_null(False))
        rep.byok_count = byok.height
        if _has(byok, "total_cost"):
            rep.byok_cost = round(float(byok.get_column("total_cost").fill_null(0).sum()), 6)


def _latency_for(group: pl.DataFrame, model: str) -> ModelLatency:
    if "duration_ms" in group.columns:
        dur = group.get_column("duration_ms").drop_nulls()
    else:
        dur = pl.Series([], dtype=pl.Float64)
    if "_tps" in group.columns:
        tps_vals = group.get_column("_tps").drop_nulls()
    else:
        tps_vals = pl.Series([], dtype=pl.Float64)
    return ModelLatency(
        model=model,
        count=group.height,
        p50_ms=round(_quantile(dur, 0.50), 1),
        p90_ms=round(_quantile(dur, 0.90), 1),
        p95_ms=round(_quantile(dur, 0.95), 1),
        p99_ms=round(_quantile(dur, 0.99), 1),
        avg_tokens_per_sec=round(float(tps_vals.mean()) if len(tps_vals) else 0.0, 1),
    )


def _latency_section(df: pl.DataFrame, rep: ReportData) -> None:
    if rep.empty or not _has(df, "duration_ms"):
        return
    work = df
    if _has(df, "completion_tokens"):
        work = work.with_columns(
            (pl.col("completion_tokens").fill_null(0) / (pl.col("duration_ms") / 1000.0).clip(1e-9)).alias("_tps")
        )
    if _has(work, "model"):
        for keys, group in work.group_by("model", maintain_order=False):
            lat = _latency_for(group, str(keys[0]))
            rep.latencies.append(lat)
        rep.latencies.sort(key=lambda r: r.count, reverse=True)
    else:
        rep.latencies.append(_latency_for(work, "all"))
    rep.slow_models = [lat.model for lat in rep.latencies if lat.p99_ms > SLOW_P99_MS]


def _error_section(df: pl.DataFrame, rep: ReportData) -> None:
    if rep.empty:
        return
    rep.error_breakdown = _value_counts(df, "status")
    rep.finish_breakdown = _value_counts(df, "finish_reason")
    rep.overflow_count = 0
    if _has(df, "finish_reason"):
        fr = df.get_column("finish_reason").cast(pl.String).str.to_lowercase()
        rep.overflow_count = int((fr == "length").sum())
        rl = df.filter(fr.is_in(["rate_limit", "rate-limit", "429"]))
        if rl.height and _has(rl, "provider_name"):
            prov = rl.get_column("provider_name").fill_null("unknown").cast(pl.String)
            vc = prov.value_counts().sort("count", descending=True)
            names = vc["provider_name"].to_list()
            counts = vc["count"].to_list()
            rep.rate_limit_by_provider = [(str(m), int(c)) for m, c in zip(names, counts)]


def _domain_section(df: pl.DataFrame, rep: ReportData) -> None:
    if rep.empty:
        return
    for attr, key in (("strategy_rows", "strategy"), ("ticker_rows", "ticker")):
        if not _has(df, key):
            continue
        rows: list[tuple[str, int, float, float]] = []
        for keys, group in df.group_by(key, maintain_order=False):
            name = str(keys[0])
            cost = float(group.get_column("total_cost").fill_null(0).sum()) if _has(group, "total_cost") else 0.0
            lat = float(group.get_column("duration_ms").drop_nulls().mean()) if _has(group, "duration_ms") else 0.0
            rows.append((name, group.height, round(lat, 1), round(cost, 6)))
        rows.sort(key=lambda r: r[1], reverse=True)
        setattr(rep, attr, rows[:20])
    if _has(df, "model") and _has(df, "reasoning_tokens") and _has(df, "completion_tokens"):
        rows2: list[tuple[str, float, float]] = []
        for keys, group in df.group_by("model", maintain_order=False):
            model = str(keys[0])
            comp = float(group.get_column("completion_tokens").fill_null(0).sum())
            reas = float(group.get_column("reasoning_tokens").fill_null(0).sum())
            ratio = round(100.0 * reas / comp, 2) if comp > 0 else 0.0
            rows2.append((str(model), ratio, rep.cache_hit_ratio_pct))
        rows2.sort(key=lambda r: r[1], reverse=True)
        rep.reasoning_rows = rows2[:20]


def build_report_data(df: pl.DataFrame) -> ReportData:
    """Aggregate processed trace frames into report facts. Empty-safe."""
    rep = ReportData()
    _kpi_section(df, rep)
    _cost_section(df, rep)
    _latency_section(df, rep)
    _error_section(df, rep)
    _domain_section(df, rep)
    return rep


def _table(headers: list[str], rows: list[tuple[object, ...]]) -> str:
    widths = [len(h) for h in headers]
    str_rows = [[str(c) for c in r] for r in rows]
    for r in str_rows:
        for i, c in enumerate(r):
            widths[i] = max(widths[i], len(c))
    bar = "+-" + "-+-".join("-" * w for w in widths) + "-+"
    head = "| " + " | ".join(h.ljust(w) for h, w in zip(headers, widths)) + " |"
    lines = [bar, head, bar]
    for r in str_rows:
        lines.append("| " + " | ".join(c.ljust(w) for c, w in zip(r, widths)) + " |")
    lines.append(bar)
    return "\n".join(lines)


def format_terminal(rep: ReportData) -> str:
    """Render ASCII summary to stdout. Informational only, never fails."""
    if rep.empty:
        return f"LiteRouter QA Report\n===================\n{NO_DATA_MSG}"
    lines = [
        "LiteRouter QA Report (informational only)",
        "=========================================",
        f"Traces: {rep.total_traces} | Sessions: {rep.total_sessions} | "
        f"Window: {rep.date_from} .. {rep.date_to}",
        f"Success: {rep.success_count} ({rep.success_rate_pct}%) | Errors: {rep.error_count}",
        f"Cost: input ${rep.total_input_cost} + output ${rep.total_output_cost} "
        f"= total ${rep.total_cost} | Cache hit: {rep.cache_hit_ratio_pct}% | "
        f"BYOK: {rep.byok_count} reqs (${rep.byok_cost})",
        "",
        "Latency by model (ms):",
        _table(
            ["model", "n", "p50", "p90", "p95", "p99", "tok/s"],
            [(m.model, m.count, m.p50_ms, m.p90_ms, m.p95_ms, m.p99_ms, m.avg_tokens_per_sec) for m in rep.latencies],
        ),
        "",
        "Errors:",
        _table(["status", "count"], rep.error_breakdown),
        _table(["finish_reason", "count"], rep.finish_breakdown),
        f"Context overflows (finish_reason=length): {rep.overflow_count}",
    ]
    if rep.rate_limit_by_provider:
        lines += ["", "Rate limits by provider:", _table(["provider", "count"], rep.rate_limit_by_provider)]
    if rep.slow_models:
        lines += ["", f"Note: p99 > 10s (informational): {', '.join(rep.slow_models)}"]
    return "\n".join(lines)


def format_markdown(rep: ReportData, generated_at: str) -> str:
    """Render full dated Markdown report. Empty-safe."""
    head = ["# LiteRouter QA Report", "", f"_Generated: {generated_at} (UTC)_", ""]
    if rep.empty:
        return "\n".join(head + [f"> {NO_DATA_MSG}", ""])
    body = [
        "## A. Executive Overview",
        "",
        f"- Total traces: **{rep.total_traces}** | Sessions: **{rep.total_sessions}**",
        f"- Window: `{rep.date_from}` .. `{rep.date_to}`",
        f"- Success rate: **{rep.success_rate_pct}%** ({rep.success_count} ok / {rep.error_count} errors)",
        f"- Total cost: **${rep.total_cost}** (input ${rep.total_input_cost}, output ${rep.total_output_cost})",
        f"- Cache hit ratio: **{rep.cache_hit_ratio_pct}%** | BYOK: {rep.byok_count} reqs (${rep.byok_cost})",
        "",
        "## B. Latency & Performance Matrix",
        "",
        "| Model | Count | p50 (ms) | p90 (ms) | p95 (ms) | p99 (ms) | Avg tok/s |",
        "|---|---|---|---|---|---|---|",
    ]
    for m in rep.latencies:
        body.append(f"| {m.model} | {m.count} | {m.p50_ms} | {m.p90_ms} |")
        body[-1] += f" {m.p95_ms} | {m.p99_ms} | {m.avg_tokens_per_sec} |"
    if rep.slow_models:
        body += ["", f"> Note (informational): p99 > 10s for: {', '.join(rep.slow_models)}"]
    body += [
        "",
        "## C. Reliability & Error Taxonomy",
        "",
        "| Status | Count |",
        "|---|---|",
    ]
    body += [f"| {s} | {c} |" for s, c in rep.error_breakdown]
    body += ["", "| Finish reason | Count |", "|---|---|"]
    body += [f"| {s} | {c} |" for s, c in rep.finish_breakdown]
    body += [
        "",
        f"- Context overflows (`finish_reason == 'length'`): **{rep.overflow_count}**",
    ]
    if rep.rate_limit_by_provider:
        body += ["", "| Rate-limited provider | Count |", "|---|---|"]
        body += [f"| {p} | {c} |" for p, c in rep.rate_limit_by_provider]
    if rep.strategy_rows:
        body += ["", "## D. Strategy & Application Telemetry", ""]
        body += ["| Strategy | Reqs | Avg latency (ms) | Cost |", "|---|---|---|---|"]
        body += [f"| {s} | {n} | {lat} | ${c} |" for s, n, lat, c in rep.strategy_rows]
    if rep.ticker_rows:
        body += ["", "| Ticker | Reqs | Avg latency (ms) | Cost |", "|---|---|---|---|"]
        body += [f"| {s} | {n} | {lat} | ${c} |" for s, n, lat, c in rep.ticker_rows]
    if rep.reasoning_rows:
        body += ["", "## E. Reasoning & Caching Efficiency", ""]
        body += ["| Model | Reasoning % | Cache hit % |", "|---|---|---|"]
        body += [f"| {m} | {r} | {c} |" for m, r, c in rep.reasoning_rows]
    body += ["", "## F. QA Summary (Informational Only)", ""]
    body += ["Distributions above are objective; no failure thresholds or exits applied.", ""]
    return "\n".join(head + body)


def write_report(df: pl.DataFrame, reports_dir: Path | str = REPORTS_DIR, now: datetime | None = None) -> Path:
    """Build report from frames and persist dated Markdown. Returns path."""
    dest = Path(reports_dir)
    dest.mkdir(parents=True, exist_ok=True)
    stamp = (now or datetime.now(timezone.utc)).strftime("%Y%m%d_%H%M%S")
    rep = build_report_data(df)
    generated_at = (now or datetime.now(timezone.utc)).isoformat()
    path = dest / f"{REPORT_PREFIX}{stamp}.md"
    path.write_text(format_markdown(rep, generated_at), encoding="utf-8")
    return path


def print_report(df: pl.DataFrame) -> str:
    """Print ASCII summary to stdout. Returns rendered text."""
    text = format_terminal(build_report_data(df))
    print(text)
    return text


def generate(df: pl.DataFrame, reports_dir: Path | str = REPORTS_DIR) -> tuple[str, Path]:
    """Dual output: stdout summary + dated Markdown file."""
    text = print_report(df)
    path = write_report(df, reports_dir)
    return text, path
