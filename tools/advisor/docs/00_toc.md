# Advisor Documentation Table of Contents

This document outlines the core modules of the Advisor system. Each documented topic follows a standard structure:
- **a. Inputs & Dependencies**: Upstream prerequisites, environment requirements, and source files.
- **b. Transformation**: Core logic, execution flow, data formatting, and error handling.
- **c. Outputs & Dependencies**: Emitted artifacts, return schemas, downstream consumers, and state updates.

## Topic Index

| Topic File | Source / Reference | 1-Line Purpose |
| :--- | :--- | :--- |
| [01_overview.md](01_overview.md) | `README.md`, `MVP_CHECKLIST.md` | System architecture overview, capabilities, and MVP implementation checklist. |
| [02_copilot_launcher.md](02_copilot_launcher.md) | `copilot.sh` | Main CLI orchestration entrypoint and execution harness for Copilot sessions. |
| [03_auth_login.md](03_auth_login.md) | `auth/m365_login.sh` | Interactive and automated M365 authentication flow handling. |
| [04_auth_capture.md](04_auth_capture.md) | `auth/capture.ts` | Token capture, credential lifecycle parsing, and local secret persistence. |
| [05_fetch_bun.md](05_fetch_bun.md) | `fetch/copilot_view.ts` | High-performance Bun-native client for Copilot view payload retrieval. |
| [06_fetch_sh.md](06_fetch_sh.md) | `fetch/views.sh` | Shell-based fallback fetcher for raw HTTP view endpoints. |
| [07_fetch_py.md](07_fetch_py.md) | `fetch/views.py` | Python-based view fetcher with extended error-handling and retry routines. |
| [08_parse_py.md](08_parse_py.md) | `fetch/parse_view.py` | Parser transforming raw Copilot view schemas into normalized data structures. |
| [09_mcp_review.md](09_mcp_review.md) | `mcp/copilot_review.ts` | MCP server integration exposing Copilot review analysis tools. |
| [10_keepalive.md](10_keepalive.md) | `session_keepalive.sh` | Background daemon preserving active session tokens and heartbeat state. |
