# LiteRouter Automated Test Suite

Comprehensive automated test architecture for the LiteRouter Bun gateway (port 7766).

> **AI Agent Authoring Mandate**: When writing or updating tests, you **MUST** follow the complete operational specification in [`.opencode2/skills/literouter/test-hygiene-playbook.md`](../.opencode2/skills/literouter/test-hygiene-playbook.md).

---

## 1. Zero-Cost Mandate & Hermetic Air-Gap Barrier

LiteRouter enforces a strict **Zero-Cost Mandate**:
- Standard test runs (`bun test` and default `uv run pytest`) **never** consume real API tokens, paid vendor quota, or external network bandwidth.
- `tests/` is 100% hermetic and isolated from external networks.
- `eval/` contains capability benchmarks (`eval.ts`, `speed.ts`, `code.ts`, `web.ts`) and is **never** executed by `bun test`.

### The Air-Gap Barrier (`tests/preload.ts`)
Configured in `bunfig.toml` via `preload = ["./tests/preload.ts"]`:
1. **In-Memory Key Sanitization**: Replaces all vendor API keys (`GOOGLE_API_KEYS`, `OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS`, etc.) with synthetic stubs (`mock-gg-stub-key-01`) **strictly in-memory**. The write-protected `.env.local` on disk is never modified.
2. **Network Interceptor**: Wraps `globalThis.fetch`. Any request directed to external LLM vendor endpoints immediately throws an `UnmockedOutboundCallError`. Only loopback connections (`localhost`, `127.0.0.1`, `::1`) are permitted.

---

## 2. Directory Structure & Parking Taxonomy

```
tests/
├── unit/                       # Pure logic, fast, non-networked (<10ms)
│   ├── directive_parser.test.ts
│   ├── cooldown.test.ts
│   ├── thinking_transformer.test.ts
│   └── fusion/
├── integration/                # Full gateway pipeline, mock HTTP loopbacks
│   ├── openai_compat.test.ts
│   ├── ghost_response_guard.test.ts
│   ├── abort_propagation.test.ts
│   └── test_dots_transformer_e2e.py  # Pytest mock integration
├── fixtures/                   # Static golden recorded payloads (.json, .sse, .txt)
│   ├── mock_openai_stream.txt
│   ├── mock_anthropic_stream.txt
│   └── mock_gemini_thought_sig.json
├── handlers/                   # Targeted handler suites (e.g. gcp_retry.test.ts)
└── smoke/                      # Liveness probes & health checks
```

| Directory | Execution Engine | Scope & Description | Speed |
|---|---|---|---|
| `tests/unit/` | `bun test` | Pure functions, AST parsers, directive token parsing, pacer cooldown calculations, header builders. No listener sockets. | <10ms / test |
| `tests/integration/` | `bun test` & `pytest` | In-process gateway dispatch (`handleAppRequest`), SSE streaming, HTTP/2 pooling, loopback mock servers (`127.0.0.1`). | ~10-100ms / test |
| `tests/fixtures/` | N/A | Golden response streams, sample chunks, and mock wire frames. Zero live keys. | Static files |
| `tests/handlers/` | `bun test` | Specific handler retry and resilience permutations. | Fast |
| `eval/` | `bun run eval/<script>.ts` | Benchmark gauntlet (speed, code, web). **Excluded from `bun test`**. Consumes real tokens when invoked. | Manual only |

---

## 3. Test Simulation Transparency Banners

When tests intentionally inject failure conditions (HTTP 429 rate limits, HTTP 503 capacity errors, circuit breaker trips, network timeouts), the test **MUST** log a simulation banner before triggering the failure:

```typescript
console.log(
  "🧪 [TEST SIMULATION] Executing resilience gate test: injecting mock 503 upstream error to verify failover..."
);
```

This distinguishes intentional test-induced failures from legitimate runtime errors in console logs.

---

## 4. State Teardown & Anti-Flake Symmetry

Global singletons (`globalKeyPool`, `globalCooldownManager`, `pacerRegistry`, `circuitBreakers`, `h2_pool`) maintain state between calls.

To prevent test cross-contamination, every test suite must reset state in `beforeEach` and `afterEach`:

```typescript
import { beforeEach, afterEach, describe, test, expect } from "bun:test";
import { handleAppRequest, resetAllState } from "../../src/lib";

describe("Gateway Handler Test Suite", () => {
  beforeEach(() => {
    resetAllState();
  });

  afterEach(() => {
    resetAllState();
  });

  // test cases...
});
```

Mock servers instantiated via `Bun.serve` must be forcibly closed in `afterEach`:
```typescript
afterEach(() => {
  if (mockServer) {
    mockServer.stop(true);
  }
  resetAllState();
});
```

---

## 5. Pytest Integration Suite & the `--live` Flag

Python integration tests reside in `tests/integration/`:

- **Hermetic by Default**:
  ```bash
  uv run pytest tests/integration/
  ```
  Runs completely hermetic against mock doubles in ~2.7s. All tests marked `@pytest.mark.live` are automatically skipped.
- **Live Upstream Probes (`--live`)**:
  ```bash
  uv run pytest tests/integration/ --live
  ```
  Explicitly enables live tests requiring a running gateway on `http://localhost:7766` with active provider credentials.

---

## 6. How to Run Tests

### Run Full Hermetic Suite
```bash
# Run all Bun TypeScript unit & integration tests (~17s, 700+ tests)
bun test

# Run all Python integration tests (~2.7s, hermetic mocks)
uv run pytest tests/integration/
```

### Run Targeted Tests
```bash
# Run a specific TypeScript test file
bun test tests/unit/directive_parser.test.ts

# Run a specific subsystem folder
bun test tests/unit/fusion/

# Run a single Python integration test
uv run pytest tests/integration/test_dots_transformer_e2e.py
```

### Full Quality Gate Pipeline
Before committing code or completing an agent task, execute:
```bash
bun run typecheck && uv run ruff check . && bun test && uv run pytest tests/integration/
```
