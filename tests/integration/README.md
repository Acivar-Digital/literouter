# LiteRouter Pytest Integration Suite & Agent Gauntlet

Comprehensive integration test suite, v4 A/B engine parity verification, and downstream agent compatibility gauntlet for LiteRouter.

```
tests/integration/
├── test_v4_ab_parity.py            # 100% byte & stream parity between legacy and v4 engines
├── test_v4_smoke.py                # Live smoke suite: 429 rotation, 500 trips, trace endpoints
├── test_downstream_gauntlet.py     # Downstream client probes: OpenCode 2, Claude Code CLI, Pydantic AI
├── test_dots_transformer_e2e.py    # Bidirectional XML-to-JSON and tool mapping end-to-end
├── test_e2e_gateway_mock.py        # Full-lifecycle gateway mock loopbacks
├── mock_upstream.py                # FastAPI mock upstream server with controllable responses
├── matrices/                       # Provider compatibility matrices (Google, NeMo)
└── smoke/                          # Direct model connectivity smoke probes
```

---

## 1. Key Test Suites

### 1.1 Engine A/B Parity (`test_v4_ab_parity.py`)
LiteRouter v4.1 maintains dual-path execution (`legacy` vs `v4.1`). This test suite fires identical payloads across both engine implementations using an ephemeral test harness and asserts 100% parity:
- **Non-Streaming Chat Completion**: Compares HTTP status, JSON payload structure, model attribution, and headers.
- **Streaming Chat Completion**: Consumes SSE deltas from both engines and asserts chunk-by-chunk and full text reconstruction parity.
- **Responses API Parity**: Validates `/v1/responses` behavior across both engines.
- **Error Status Mapping**: Ensures 400 Bad Request, 429 Rate Limit, and 500 Server Error status codes and bodies match.

### 1.2 v4 Core Smoke Tests (`test_v4_smoke.py`)
Exercises high-stress gateway behaviors against an ephemeral loopback server:
- **429 Key Cooldown Rotation**: Injects upstream 429 errors to verify automatic key advance and cooldown placement.
- **Circuit Breaker Activation**: Trips the circuit breaker via consecutive upstream 500 errors and verifies fast-canning (503 response) on subsequent calls.
- **Trace Inspection Endpoints**: Queries `GET /v1/traces` and `GET /v1/traces/{id}` to verify in-memory and SQLite trace persistence.
- **Dynamic Header Propagation**: Asserts client-provided headers and directive flags are accurately injected into outbound requests.

### 1.3 Downstream Agent Gauntlet (`test_downstream_gauntlet.py`)
Simulates realistic workloads from major AI developer environments and frameworks:
- **OpenCode 2 Compatibility**:
  - Validates thinking chunk stripping (`delta.reasoning_content` removed for OpenCode clients to prevent SQLite database bloat).
  - Asserts non-streaming and streaming completions work seamlessly with Zen models (`big-pickle`).
- **Claude Code CLI Compatibility**:
  - Tests Anthropic Messages protocol (`/v1/messages`) translation to OpenRouter.
  - Verifies SSE streaming events (`message_start`, `content_block_delta`, `message_stop`).
- **Pydantic AI Compatibility**:
  - Verifies structured JSON outputs and function/tool-calling schemas.
  - Tests HTTP/2 multiplex connection reuse across repeated requests.

### 1.4 Dots XML Transformer E2E (`test_dots_transformer_e2e.py`)
- Tests bidirectional translation between raw XML `<tool_call>` / `<think>` markup and standard OpenAI/Anthropic tool schemas.
- Verifies that open-weight models lacking native tool support can function with downstream agent harnesses.

---

## 2. Prerequisites & Environment Setup

All integration tests are executed using **Python 3.14+** managed via **`uv`**.

```bash
# Ensure Python virtual environment and dependencies are synced
uv sync
```

### Self-Contained Ephemeral Harness
Integration tests in this directory are fully self-contained. They automatically:
1. Spin up a lightweight `FastAPI` / `uvicorn` mock upstream server on an ephemeral port.
2. Spawn an isolated LiteRouter gateway instance (`bun run src/index.ts`) on an ephemeral port.
3. Execute HTTP/1.1 and HTTP/2 requests using `httpx`.
4. Gracefully terminate both processes upon test completion.

---

## 3. How to Run

### Run Full Hermetic Integration Suite (Default)
```bash
uv run pytest tests/integration/
```
*Runs all hermetic integration tests against ephemeral local mock servers in ~11s. All tests requiring live vendor credentials are automatically skipped.*

### Run a Specific Test Suite
```bash
# Downstream agent gauntlet only (OpenCode 2, Claude Code, Pydantic AI)
uv run pytest tests/integration/test_downstream_gauntlet.py -v

# v4 vs Legacy A/B parity suite only
uv run pytest tests/integration/test_v4_ab_parity.py -v

# v4 smoke & resilience tests only
uv run pytest tests/integration/test_v4_smoke.py -v
```

### Live Upstream Probes (`--live`)
```bash
uv run pytest tests/integration/ --live
```
*Explicitly enables live tests requiring a running gateway on `localhost:7766` with active provider credentials configured in `.env.local`.*

---

## 4. Test Execution & Assertion Best Practices

1. **Ephemeral Ports**: Always use `get_ephemeral_port()` from `mock_upstream.py` to prevent port collision conflicts (`EADDRINUSE`).
2. **HTTP/2 Support**: When verifying streaming or multiplexing, instantiate `httpx.Client(http2=True, verify=False)`.
3. **Health Polling**: Use `_wait_for_health(gw_url)` before dispatching test requests to ensure the child gateway process is fully bound and ready.
