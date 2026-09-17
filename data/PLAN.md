# OpenRouter & BigQuery LLM Trace Analytics: QA Architecture & Implementation Plan

**Author:** Senior QA Lead  
**Date:** 2026-09-18  
**Scope:** Automated BigQuery Telemetry Ingestion, Transformation, Quality Analysis, and Reporting Pipeline  
**Target Directory:** `/home/yapilwsl/arthityap/literouter/data`  

---

## Executive Summary

This document establishes the architecture, data contracts, transformation requirements, and reporting specifications for mining LLM inference traces streamed from OpenRouter into Google BigQuery (`project-7b250e67-6e23-4c02-ab5.openrouter.openrouter_traces`).

The primary goal is to provide a single-command, reproducible analytics process that:
1. Securely authenticates and downloads raw telemetry traces without redundant queries or excessive data scan costs.
2. Normalizes, cleans, and extracts structured metadata (e.g. trading strategies, tickers, agent session states, tool invocations).
3. Evaluates model reliability, latency SLA compliance ($p_{50}, p_{90}, p_{99}$), error cascades (429 rate limits, timeouts, context overflows), and economic efficiency (caching savings, BYOK vs shared credit consumption).
4. Emits clear, actionable Markdown and tabular QA diagnostic reports for ongoing system optimization.

---

## 1. What is it we want to understand?

As Senior QA overseeing gateway operations, model routing, and automated agent workflows, we are investigating five critical dimensions of system behavior:

### A. Reliability, Fault Tolerance & Error Topology
* **Upstream Error Rates**: What percentage of inference calls fail (`status != 'SUCCESS'` or HTTP status $\ge 400$)?
* **Failure Categorization**: What is the breakdown of `finish_reason` (`stop`, `length`, `content_filter`, `error`, `tool_calls`)? Specifically:
  * How frequently do prompts hit context limits (`finish_reason == 'length'`)?
  * How frequently do tool calls terminate abnormally?
* **Rate-Limit Cascades & Fallbacks**: How often are 429 (`RESOURCE_EXHAUSTED`) responses received from upstream providers (e.g., Google AI Studio, Anthropic, Bedrock), and how effectively does the routing layer recover across spans within the same `trace_id` or `session_id`?

### B. Latency & SLA Performance (`duration_ms`)
* **Distribution Profiles**: What are the true latency percentiles ($p_{50}, p_{90}, p_{95}, p_{99}$) segmented by:
  * Model ID (e.g. `google/gemini-3.5-flash-lite`, `anthropic/claude-3.5-sonnet`, `openai/gpt-4o`)
  * Upstream Provider (`google-ai-studio`, `google-vertex`, `anthropic`, `amazon-bedrock`)
* **Prompt Size vs. Latency Elasticity**: What is the empirical latency per 1,000 prompt tokens and generation speed (tokens/sec)?
* **Cache Acceleration**: What is the real-world latency delta between cold prompt evaluation and cached prompt evaluation (`cached_tokens > 0`)?

### C. Economics, Cost Efficiency & Cache Utilization
* **Spend Breakdown**: Total expenditures across `input_cost`, `output_cost`, and `total_cost`.
* **Prompt Caching Realization**: How much money and token volume is being saved by OpenRouter / Google prompt caching?
  $$\text{Cache Hit Ratio} = \frac{\sum \text{cached\_tokens}}{\sum \text{prompt\_tokens}} \times 100\%$$
* **BYOK vs. Shared Credit Utilization**: Verifying that zero-cost BYOK requests (`is_byok: true`, `total_cost == 0`) remain strictly isolated from paid credit consumption.

### D. Domain Application Behavior (Trading & Agent Metadata)
* **Strategy & Asset Correlation**: Using the custom `metadata` JSON field (e.g. `ticker: "BTC"`, `strategy: "Moving Average Breakout"`, `trade_id`), which financial assets or trading strategies correlate with:
  * High reasoning token overhead?
  * Elevated failure rates or timeout tendencies?
* **Turn & Session Complexity**: For multi-turn conversational agents, how does token cost and latency compound across conversation depth (`session_id` turn counts)?

### E. Reasoning Dynamics (Thinking Tokens)
* **Reasoning Budget Health**: For models featuring native reasoning (e.g. Gemini 3.5 Thinking, DeepSeek R1, OpenAI o1/o3), what proportion of total completion tokens is consumed by hidden reasoning (`reasoning_tokens`) vs. user-visible output?

---

## 2. Why is OpenRouter data most useful for this understanding?

OpenRouter trace data streamed directly to BigQuery provides distinct advantages over isolated provider logs or client-side telemetry:

1. **Unified Cross-Provider Standard Schema**:
   * Direct provider APIs (Google, Anthropic, AWS Bedrock, OpenAI) emit fundamentally incompatible logging formats and billing schemas.
   * OpenRouter normalizes every request into a single OpenTelemetry-compatible span contract (`trace_id`, `span_id`, `provider_slug`, `model`, `duration_ms`, `total_cost`, `cached_tokens`, `reasoning_tokens`).
2. **Ground-Truth Network Telemetry**:
   * Client-side application logs only record the client's end-to-end socket round-trip, which mixes client network jitter with server compute time.
   * OpenRouter records upstream server latency, provider router latency, and authoritative upstream status codes.
3. **Structured Contextual Metadata Passthrough**:
   * OpenRouter allows arbitrary JSON objects to be injected into the request under `metadata`. This metadata is persisted directly into the BigQuery `metadata` column without polluting the LLM's prompt context window.
   * This bridges the gap between high-level application events (e.g., a specific trading execution) and low-level token telemetry.
4. **Hierarchical Trace & Span Lineage**:
   * Columns `trace_id`, `span_id`, and `parent_span_id` preserve parent-child relationships, enabling QA analysis of agentic multi-hop workflows, subagent spawning, and tool-calling execution trees.
5. **Direct BigQuery Analytical Power**:
   * Instead of contending with rate-limited, paginated HTTP analytics endpoints, BigQuery offers columnar storage, partitioning on `timestamp`, SQL aggregation capabilities, and direct extraction into Arrow/Pandas/Polars.

---

## 3. How are we going to obtain the raw data?

### Authentication & Authorization
* **Credential**: Google Cloud Service Account key stored securely in `data/credentials/google-osa.json` (`openrouter-broadcast@project-7b250e67-6e23-4c02-ab5.iam.gserviceaccount.com`).
* **Target Resource**: Project `project-7b250e67-6e23-4c02-ab5`, dataset `openrouter`, table `openrouter_traces`.
* **Security Discipline**: Credentials are kept strictly in `data/credentials/`, which is gitignored (`data/` in `.gitignore`). No keys or credentials will ever be hardcoded into scripts or committed to source control.

### Acquisition Workflow
1. **Incremental Partition-Pruned Ingestion**:
   * Standard queries must filter against `timestamp` using parameterized lookbacks (e.g., `WHERE timestamp >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL @lookback_days DAY)`).
   * A local state watermark (`data/raw/.watermark.json`) will track the latest downloaded `timestamp` and `trace_id` to allow incremental pulls without re-downloading historical traces.
2. **Cost & Scan Safety (Dry-Run Verification)**:
   * The download utility will support a `--dry-run` flag utilizing `bigquery.QueryJobConfig(dry_run=True)` to report estimated bytes scanned before running the live query.
3. **Local Raw Persistence**:
   * Downloaded raw batches are stored in `data/raw/` in **Apache Parquet format** (`traces_YYYYMMDD_HHMMSS.parquet`) with optional compressed JSONL backup. Parquet preserves strict Arrow data types (timestamps, nested JSON, float64) with zero schema drift and optimal compression.

---

## 4. Transformation & Data Engineering Logic

Once the raw records are downloaded, the pipeline executes the following deterministic transformations:

```
[Raw BigQuery Traces]
         │
         ▼
[Type Coercion & Schema Validation] ──► (Pydantic / Arrow Contract)
         │
         ▼
[JSON Column Extraction] ─────────────► (metadata, attributes, model_parameters)
         │
         ▼
[Feature Engineering] ────────────────► (Latency buckets, Cache ratios, Error flags)
         │
         ▼
[Session & Aggregate Rollups] ────────► (Model, Provider, Strategy, Session KPIs)
         │
         ▼
[Clean Processed Parquet / Reports]
```

### Key Transformation Steps:
1. **JSON Unnesting (`metadata`, `attributes`, `model_parameters`)**:
   * Extract business keys from `metadata`: `ticker`, `strategy`, `trade_id`, `environment`, `run_id`.
   * Extract operational settings from `model_parameters`: `temperature`, `top_p`, `max_tokens`.
2. **Categorical Normalization**:
   * Normalize `status` into clean enum values: `SUCCESS`, `ERROR`, `RATE_LIMIT` (429), `TIMEOUT`, `CANCELLED`.
   * Classify `finish_reason`: `NORMAL_STOP`, `MAX_TOKENS`, `TOOL_CALL`, `FILTERED`, `ERROR`.
3. **Derived Analytical Metrics**:
   * **Throughput Proxy**: $\text{Tokens per Second} = \frac{\text{completion\_tokens}}{(\text{duration\_ms} / 1000)}$
   * **Cache Efficiency Ratio**: $\frac{\text{cached\_tokens}}{\text{prompt\_tokens}}$
   * **Reasoning Ratio**: $\frac{\text{reasoning\_tokens}}{\text{completion\_tokens}}$
   * **Effective Unit Cost**: $\frac{\text{total\_cost}}{\text{total\_tokens}} \times 1,000,000$ (cost per million tokens)
4. **Session Aggregation**:
   * Aggregate by `session_id` to calculate session-level metrics: total conversation duration, total tokens consumed, turn count, and boolean indicator if any turn suffered a failure.

---

## 5. Tooling & Technical Stack

In accordance with repository engineering standards:

| Layer | Technology | Rationale |
|---|---|---|
| **Runtime & Package Manager** | `uv run python` (Python 3.12+) | Repository-standard deterministic virtual environment management; fast execution without global dependency pollution. |
| **Cloud Client** | `google-cloud-bigquery`, `db-dtypes` | Official Google Cloud SDK for secure BigQuery querying and credential handling. |
| **Data Processing & Analytics** | `polars` / `pandas` | High-performance, columnar DataFrame processing. Polars provides sub-second vectorized JSON parsing and zero-copy Arrow integration. |
| **Data Validation Contract** | `pydantic` (v2) | Enforces strict validation of schema fields, ensuring missing columns or upstream type shifts fail loudly and early. |
| **Local Storage Format** | Apache Parquet (`pyarrow`) | Columnar format with Snappy compression; preserves rich schemas, fast read/write, and small disk footprint. |
| **Reporting & Formatting** | Markdown + Rich / Tabulate | Generates human-readable, versionable QA audit summaries with clean ASCII tables. |

---

## 6. What Can We Expect to See from the Report?

The generated report (`data/reports/QA_REPORT_YYYYMMDD.md` and terminal summary) will present a structured executive and diagnostic breakdown:

### A. Executive Overview
* **Total Volume**: Total traces evaluated, total sessions, date range analyzed.
* **Health Score**: Overall system success rate (%) and total error count.
* **Financial Summary**: Total gross cost, estimated savings from prompt caching, and BYOK zero-cost volume.

### B. Latency & Performance Matrix
* Table comparing models and providers:
  $$\text{Model} \quad|\quad \text{Count} \quad|\quad p_{50} \text{ (ms)} \quad|\quad p_{90} \text{ (ms)} \quad|\quad p_{99} \text{ (ms)} \quad|\quad \text{Avg Tokens/sec}$$
* Highlight of latency degradation outliers ($p_{99} > 10\text{s}$) or upstream slowdowns.

### C. Reliability & Error Taxonomy
* Distribution of error codes and `finish_reason` occurrences.
* Upstream rate-limit (429) occurrences by provider/key.
* Context window overflow alerts (`finish_reason == 'length'`).

### D. Strategy & Application Telemetry (Trading Domain)
* Breakdown by `strategy` and `ticker`:
  * Which trading strategy consumed the most tokens?
  * Did any specific asset or strategy suffer higher inference latency or failure rates?

### E. Reasoning & Prompt Caching Efficiency
* Cache hit efficiency percentage per model.
* Breakdown of thinking/reasoning token consumption for reasoning-enabled models.

### F. Actionable QA Recommendations
* Automated alerts based on established thresholds:
  * ⚠️ *Warning*: Model X failure rate exceeds 2.0%.
  * ⚠️ *Latency Alert*: Upstream provider Y experienced a 40% increase in $p_{95}$ latency.
  * 💡 *Optimization*: Model Z cache hit rate is below 15%—review prompt prefix stability.

---

## 7. Directory Organization Structure

The `data/` directory has been reorganized into a structured, scalable layout:

```
/home/yapilwsl/arthityap/literouter/data/
├── credentials/
│   ├── google-osa.json            # Active Google Cloud BigQuery service account key
│   └── openrouter-osa.json        # Supplementary / backup service account configuration
├── docs/
│   ├── 01_Build.md                # Original OpenRouter BigQuery setup guide & sample queries
│   └── schema.md                  # Complete BigQuery table schema DDL reference
├── raw/                           # Ingested raw Parquet batches (.parquet, .watermark.json)
├── processed/                     # Cleaned, unnested, and feature-engineered datasets
├── reports/                       # Generated QA Markdown reports and summary tables
└── PLAN.md                        # This architecture and implementation plan
```

---

## 8. Next Steps & Implementation Pipeline

Once this plan is reviewed and approved, implementation will proceed in four discrete stages:

1. **Pipeline Script Construction (`data/scripts/fetch_and_report.py`)**:
   * Build the unified runner that accepts CLI parameters (`--days`, `--limit`, `--dry-run`, `--output-format`).
2. **Data Ingestion Engine**:
   * Implement BigQuery client wrapper with automated watermark tracking and Parquet serialization into `data/raw/`.
3. **Data Transformation & Metrics Engine**:
   * Implement Polars/Pandas transformations to unnest `metadata`, calculate percentiles ($p_{50}, p_{90}, p_{99}$), and compute cache/reasoning metrics into `data/processed/`.
4. **Report Generator**:
   * Implement the automated Markdown QA report builder outputting into `data/reports/`.
