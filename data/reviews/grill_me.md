# Senior QA Grill-Me Interview: OpenRouter BigQuery Analytics Pipeline

**Status:** Concluded - Consensus Reached (5/5 Decisions Resolved)  
**Location:** `data/reviews/grill_me.md`  
**Purpose:** Relentless architectural interrogation to stress-test every branch of the design tree before writing execution code.

---

## Design Decision Tree

```
1. Ingestion Scope & Cost Control
   ├── 1.1 Ingestion Window (Default lookback vs Watermark vs Date Range)
   └── 1.2 Scan Safety (Dry-run byte limit guardrail)

2. Local Data Processing & Storage Tier
   ├── 2.1 Storage Format (Parquet vs JSONL vs SQLite/DuckDB)
   └── 2.2 Processing Library (Polars vs Pandas)

3. Metadata Unnesting & Schema Discipline
   ├── 3.1 Metadata Contract (Strict Pydantic vs Flexible Dict Extraction)
   └── 3.2 Unrecognized Columns & Schema Drift Handling

4. QA SLA & Anomaly Alerting Thresholds
   ├── 4.1 Error Rate Tolerance (What % triggers a QA warning?)
   └── 4.2 Latency SLA ($p_{90}$ / $p_{99}$ threshold limits)

5. Reporting & User Interface
   ├── 5.1 CLI Ergonomics (Flags, single-command run)
   └── 5.2 Artifact Output (Terminal ASCII vs Markdown report vs CSV export)
```

---

## Resolved Decisions Log

*(Decisions will be recorded here as each branch is agreed upon)*

| # | Branch | Question | Decision | Date |
|---|---|---|---|---|
| 1 | Ingestion | Ingestion Window & Freshness | Incremental Watermarking via `data/raw/.watermark.json` (fallback: rolling 7 days on cold start) | 2026-09-18 |
| 2 | Storage & Engine | Processing Library & Local Format | Polars DataFrame engine + Apache Parquet storage (`data/raw/` & `data/processed/`) | 2026-09-18 |
| 3 | Metadata | Unnesting & Schema Variation | Resilient Hybrid: Promote core business keys (`ticker`, `strategy`, `trade_id`) to typed columns; preserve remaining keys without failing | 2026-09-18 |
| 4 | QA Thresholds | Alerting & Tolerance Rules | Informational Only: Output clean, objective distributions ($p_{50}, p_{90}, p_{99}$, counts, ratios) without artificial failure exits or alarmist flags | 2026-09-18 |
| 5 | Output Delivery | CLI & Report Format | Dual Output: Print immediate ASCII summary table to terminal stdout AND save full dated Markdown report to `data/reports/REPORT_YYYYMMDD_HHMMSS.md` | 2026-09-18 |
