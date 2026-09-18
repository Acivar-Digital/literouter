# 01 Overview

Architectural overview and MVP specification for Advisor (Rebel), derived from `advisor/README.md` and `advisor/MVP_CHECKLIST.md`.

**Purpose**:
Advisor provides deterministic OAuth session capture and noise-filtered DOM translation for AI agents, resolving silent auth redirect failures and fragile HTML scraping leaks without touching model gateway traffic.

**Rebel vs 9router Differentiation (1-Line Facts)**:
- **Traffic Layer**: 9router routes model traffic via directive keys; Rebel routes zero model traffic and handles only auth capture and HTML fetching.
- **Port Separation**: 9router runs the LLM proxy on port 7766; Rebel runs an auth callback server on local port 8765.
- **Provider Config**: 9router manages provider endpoints and key rotation; Rebel has zero provider configs or config shadowing.
- **Rate Limiting**: 9router handles request pacing and cooldown quarantine; Rebel contains no rate-limiting or sliding-window logic.
- **Secret Isolation**: 9router reads gateway provider keys; Rebel never reads `.env*` and persists sessions strictly in `~/.advisor_tools/`.
- **Runtime Footprint**: Antigravity-Manager requires Docker for proxy rotation; Rebel runs locally via Bun and lightweight shell/Python scripts.

## a. Inputs-required dependencies

- **Source Specifications**: `advisor/README.md` (architecture contract) and `advisor/MVP_CHECKLIST.md` (readiness criteria).
- **Runtimes & CLIs**:
  - `bun` (>= 1.0) for executing `advisor/auth/capture.ts`.
  - `python3` (>= 3.10) with `ruff` for `advisor/fetch/views.py`.
  - `stealthy-fetch` CLI for targeted DOM retrieval (`--ai-targeted -s selectors`).
  - POSIX-compliant shell (`bash`) for orchestrating `advisor/fetch/views.sh`.
- **External Local Endpoints**: Local OAuth redirect listener at `http://localhost:8765/callback`.
- **Environment & Storage Constraints**:
  - User home directory path (`$HOME`) to resolve external state at `~/.advisor_tools/`.
  - Zero `.env*` or repo secret dependencies (no tokens, API keys, or `<REDACTED>` values).

## b. Transformation

- **MVP Scope & Implementation**:
  - **Deterministic Auth Capture (`advisor/auth/capture.ts`)**: Pre-generates OAuth authorization URLs, captures authorization codes on `http://localhost:8765/callback`, maintains session refresh loops, and enforces immediate shutdown on `invalid_grant`.
  - **HTML-to-Agent Translation (`advisor/fetch/views.sh`, `views.py`)**: Executes stealth fetch with targeted DOM selectors, strips scripts/ads/markup noise, writes sanitized views to temporary storage, and cleans temp files upon completion.
  - **Zero-Secret Contract**: Session state and refresh metadata are captured without logging or committing raw tokens or PII to git.
- **Execution & Quality Gates**:
  - Auth service static typing validated via `bun run typecheck`.
  - Python fetch wrappers linted via `uv run ruff check .`.
  - Zero model-traffic routing, sliding windows, or rate-limiting interference.

## c. Outputs-dependencies

- **Produced Artifacts**:
  - `~/.advisor_tools/`: Out-of-repo directory storing session state files (never tracked in git).
  - Sanitized view extracts: Cleaned DOM text payloads generated in temp directories for agent consumption.
  - Verification checklist (`advisor/MVP_CHECKLIST.md`): Verified state with placeholder URLs and zero raw secrets.
- **Downstream Consumers**:
  - AI coding agents consuming structured, noise-free page extracts.
  - Agent workflows requiring deterministic local OAuth sessions without browser profile pollution.
- **Guaranteed Invariants**:
  - `.env*` files remain untouched; no credential leakage or git repo pollution.
  - Complete operational isolation from LiteRouter (9router) port 7766 LLM routing.
