# LiteRouter Test Suite Hygiene & Hermetic Air-Gap Playbook

> **Scope**: Master architectural standard and operational manual for authoring, maintaining, and executing automated tests in LiteRouter (`tests/` and `eval/`).
> **Target Audience**: AI agents and core engine maintainers.
> **Location**: `.opencode2/skills/literouter/test-hygiene-playbook.md`

---

## §1. Executive Summary & Zero-Cost Mandate

LiteRouter enforces an absolute, non-negotiable test hygiene mandate:
**Zero real API tokens, zero paid cloud quota, and zero external vendor keys may ever be consumed during standard test execution (`bun test` and default `uv run pytest`).**

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                LITEROUTER SUITE MANDATE                                │
├──────────────────────────┬─────────────────────────────┬───────────────────────────────┤
│ Target Scope             │ Cost & Quota Footprint      │ Execution Boundary            │
├──────────────────────────┼─────────────────────────────┼───────────────────────────────┤
│ tests/ (Unit & Mock E2E) │ $0.00 (100% Hermetic Mocks) │ Air-gapped (Loopback only)    │
│ eval/ (Benchmarks/Evals) │ Real Tokens / Live Quota    │ Explicit manual benchmark CLI │
└──────────────────────────┴─────────────────────────────┴───────────────────────────────┘
```

1. **`tests/` is Hermetic and Air-Gapped**: Every unit test, integration test, and handler scenario in `tests/` must run 100% locally with zero external network connectivity. Tests must complete rapidly and predictably without dependency on upstream provider uptime or valid paid credentials:
   - `tests/unit/`: v4.1 core gateway logic (engine, transformers, handlers, telemetry, pacer, cooldown — 938 tests).
   - `tests/eval/`: Benchmark eval grader unit tests (patch, pydantic, security, web runners — 182 tests).
   - `tests/unit/legacy/`: Legacy monolithic handlers and HTTP/2 transport tests for dual-path fallback (179 tests).
   - `tests/integration/`: Gateway end-to-end and mock loopback tests, pytest integration.
2. **`eval/` is Benchmark-Only**: Files under `eval/` (`eval.ts`, `speed.ts`, `code.ts`, `web.ts`) measure live LLM latency, reasoning quality, agentic code generation, and web DOM fidelity. They are **never** executed by `bun test` or CI pipelines without explicit operator intention.
3. **Fail-Closed Protection**: If test code inadvertently attempts to connect to an external LLM vendor (`api.openai.com`, `openrouter.ai`, `generativelanguage.googleapis.com`, etc.), the air-gap barrier instantly throws an unhandled exception, failing the test immediately.

---

## §2. Architecture: The Air-Gap Barrier

LiteRouter guarantees zero-cost hermetic isolation through a two-layer runtime enforcement mechanism configured in `bunfig.toml` and implemented in `tests/preload.ts`.

```
                  ┌─────────────────────────────────────────┐
                  │              bunfig.toml                │
                  │   [test] preload = ["tests/preload.ts"] │
                  └────────────────────┬────────────────────┘
                                       │
                                       ▼
                  ┌─────────────────────────────────────────┐
                  │            tests/preload.ts             │
                  └────────┬───────────────────────┬────────┘
                           │                       │
      [1. In-Memory Key Sanitization]              │ [2. Outbound Network Interceptor]
                           │                       │
                           ▼                       ▼
                process.env Provider Stubs     globalThis.fetch = airGapFetch
                ("mock-gg-stub-key-01", etc.)      │
                           │                       ├─► Loopback (127.0.0.1/localhost) ──► OK
                .env.local write-protected         │
                on disk remains UNTOUCHED          └─► Upstream (api.openai.com, etc.) ─► THROW!
                                                        UnmockedOutboundCallError
```

### 2.1 Preload Configuration (`bunfig.toml`)
The test runner auto-executes the air-gap barrier before loading any test module:
```toml
# bunfig.toml
[test]
preload = ["./tests/preload.ts"]
```

### 2.2 In-Memory Key Sanitization (Zero Disk Mutation)
Real provider keys in `.env.local` are write-protected on disk (`chmod 644`, owned by `root`). Under no circumstances should test runners or agents mutate, redact, or overwrite `.env.local`.

Instead, `tests/preload.ts` overwrites environment keys **strictly in-memory** during test initialization:
```typescript
process.env.NODE_ENV = "test";
process.env.LITEROUTER_TEST_MODE = "true";

const MOCK_PROVIDER_KEYS: Readonly<Record<string, string>> = {
  GOOGLE_API_KEYS: "mock-gg-stub-key-01,mock-gg-stub-key-02",
  GCP_KEYS: "mock-gc-stub-key-01,mock-gc-stub-key-02",
  GCP_API_KEYS: "mock-gc-stub-key-01,mock-gc-stub-key-02",
  OPENROUTER_API_KEYS: "mock-or-stub-key-01,mock-or-stub-key-02",
  NVIDIA_API_KEYS: "mock-nv-stub-key-01,mock-nv-stub-key-02",
  ZEN_API_KEYS: "mock-zn-stub-key-01,mock-zn-stub-key-02",
  ANTHROPIC_API_KEYS: "mock-an-stub-key-01,mock-an-stub-key-02",
  OPENAI_API_KEYS: "mock-oa-stub-key-01,mock-oa-stub-key-02",
  GROQ_API_KEYS: "mock-gq-stub-key-01,mock-gq-stub-key-02",
  CEREBRAS_API_KEYS: "mock-cb-stub-key-01,mock-cb-stub-key-02",
  DEEPSEEK_API_KEYS: "mock-ds-stub-key-01,mock-ds-stub-key-02",
  MISTRAL_API_KEYS: "mock-ms-stub-key-01,mock-ms-stub-key-02",
  TOGETHER_API_KEYS: "mock-tg-stub-key-01,mock-tg-stub-key-02",
};

for (const [key, stub] of Object.entries(MOCK_PROVIDER_KEYS)) {
  process.env[key] = stub;
  if (typeof Bun !== "undefined" && Bun.env) {
    Bun.env[key] = stub;
  }
}
```

### 2.3 Outbound Network Interceptor (`UnmockedOutboundCallError`)
Any call to `globalThis.fetch` is intercepted by `airGapFetch`.
- Requests directed to `localhost`, `127.0.0.1`, `::1`, `0.0.0.0`, `.local`, `.test`, or relative URIs (`/path`) are allowed through to local mock test doubles.
- Any attempt to contact an external URL instantly raises an `UnmockedOutboundCallError`:
```typescript
export class UnmockedOutboundCallError extends Error {
  constructor(url: string) {
    super(`Outbound live API request blocked in test environment to: ${url}`);
    this.name = "UnmockedOutboundCallError";
  }
}

export function airGapFetch(
  input: string | URL | Request,
  init?: RequestInit
): Promise<Response> {
  const targetUrl = extractUrl(input);
  if (!isLoopbackOrTestDouble(targetUrl)) {
    throw new UnmockedOutboundCallError(targetUrl);
  }
  return originalFetch.call(globalThis, input as RequestInfo, init);
}
```

---

## §3. Parking Taxonomy (Where New Tests Belong)

When adding tests to LiteRouter, use the following deterministic parking taxonomy:

```
tests/
├── unit/                       # Core gateway logic, fast, non-networked (<10ms)
│   ├── engine/                 # Dispatcher, routing, circuit breaker, retry loops
│   ├── transformers/           # Scrubber, thinking tags, XML tools, deltas
│   ├── handlers/               # v4 pure route orchestration handlers
│   ├── telemetry/              # Metrics, logging, traces, latency trackers
│   ├── network/                # Key pool, pacer conveyor, cooldown manager
│   └── legacy/                 # Monolithic v3.x handlers & legacy HTTP/2 transport
├── eval/                       # Unit tests for benchmark graders (eval framework)
│   ├── patch.test.ts           # Patch extraction and application unit tests
│   ├── pydantic.test.ts        # Pydantic schema validation tests
│   ├── security.test.ts        # Injection & safety guard tests
│   └── web.test.ts             # Web runner & DOM hygiene unit tests
├── integration/                # Full gateway pipeline, mock HTTP loopbacks
│   ├── <handler>_<feature>.test.ts
│   └── test_<feature>_e2e.py   # Pytest mock integration
├── fixtures/                   # Static golden recordings (.json, .sse, .txt)
│   ├── <provider>/
│   └── mock_openai_stream.txt
eval/                           # Live model evaluations (NOT run by bun test)
├── eval.ts                     # Master evaluation gauntlet (orchestrator)
├── speed.ts                    # Latency, TTFT, and throughput benchmarks
├── code.ts                     # Agentic code generation benchmark
└── web.ts                      # Frontend DOM generation benchmark
```

### 3.1 `tests/unit/` (v4.1 Core Gateway & Subsystems)
- **Scope**: Pure logic tests, dispatcher, route execution, AST parsers, directive token validation, cooldown math, header builders, scrubber transforms, pacer conveyor, and telemetry.
- **Performance**: Ultra-fast execution (<10ms per test). Executed via `bun run test:gateway` (938 tests).
- **Environment**: In-memory data structures only; loopback test doubles for mock provider responses.
- **Examples**: `tests/unit/engine/dispatch.test.ts`, `tests/unit/network/cooldown.test.ts`, `tests/unit/transformers/scrubber.test.ts`.

### 3.2 `tests/eval/` (Benchmark Grader Unit Tests)
- **Scope**: Hermetic unit tests verifying the offline grading algorithms, patch appliers, Pydantic schema validators, security checks, and web DOM grading logic used by the `eval/` benchmark gauntlet.
- **Performance**: Fast offline execution. Executed via `bun run test:eval` (182 tests).
- **Environment**: 100% hermetic and local; zero LLM token consumption.
- **Examples**: `tests/eval/patch.test.ts`, `tests/eval/pydantic.test.ts`, `tests/eval/security.test.ts`.

### 3.3 `tests/unit/legacy/` (Dual-Path Fallback Suites)
- **Scope**: Legacy monolithic handlers and legacy HTTP/2 transport tests maintained for dual-path fallback safety (`x-literouter-engine: legacy`).
- **Performance**: Executed via `bun run test:legacy` (179 tests).
- **Environment**: Hermetic mock tests ensuring regression safety for legacy code paths.
- **Examples**: `tests/unit/legacy/openai_compat_legacy.test.ts`, `tests/unit/legacy/h2_pool_legacy.test.ts`.

### 3.4 `tests/integration/` (Gateway End-to-End & Loopbacks)
- **Scope**: In-process or loopback integration tests checking the full LiteRouter pipeline (`handleAppRequest`, route dispatching, SSE streaming, keep-alive frames, HTTP/2 pooling, abort propagation), plus Pytest integration suites (`test_*_e2e.py`).
- **Environment**: Uses `Bun.serve` on ephemeral loopback ports (`127.0.0.1:0` or `127.0.0.1:8999`) to simulate upstream provider responses.
- **Examples**: `tests/integration/openai_compat.test.ts`, `tests/integration/ghost_response_guard.test.ts`, `tests/integration/abort_propagation.test.ts`.

### 3.5 `tests/fixtures/<provider>/`
- **Scope**: Static recorded golden payloads, wire SSE text, chunk boundaries, and JSON schemas.
- **Rules**:
  - Store as `.json`, `.txt`, or `.sse`.
  - Must not contain live upstream keys or proprietary customer data.
  - Read via `Bun.file()` or `fs.readFileSync()`.
- **Examples**: `tests/fixtures/mock_anthropic_stream.txt`, `tests/fixtures/mock_openai_stream.txt`.

### 3.6 `eval/` (Capability Benchmarks & Evals)
- **Scope**: Live benchmark gauntlets (`eval/eval.ts`, `eval/code.ts`, `eval/web.ts`, `eval/speed.ts`).
- **Rules**:
  - Excluded from standard `bun test` passes.
  - Require explicit model targets: `bun run eval/eval.ts <model_name>`.
  - Allowed to consume live API tokens as per operator directive.

---

## §4. Test Simulation Transparency Banner Rule

When writing tests that intentionally simulate failure gates (HTTP 429 rate limits, HTTP 503 service unavailable, circuit breaker trips, network disconnections, or timeout aborts), the test **MUST** emit an explicit console banner immediately before injecting the mock error.

### 4.1 The Transparency Rule
Without a simulation banner, standard loggers emit alarming red warning messages (`⚠️ [LIMIT] returned 503`, `🚨 [CIRCUIT BREAKER] Tripped`), causing developers and automated monitoring agents to falsely assume the gateway is failing.

### 4.2 Mandatory Format
```typescript
console.log(
  "🧪 [TEST SIMULATION] Executing resilience gate test: injecting mock 503 upstream error to verify failover..."
);
```

### 4.3 Reference Implementation
```typescript
test("falls over to next key on upstream 503", async () => {
  // 1. Emit the simulation banner
  console.log(
    "🧪 [TEST SIMULATION] Executing resilience gate test: injecting mock 503 upstream error to verify key rotation..."
  );

  // 2. Configure mock upstream to return simulated 503
  mockServer.setResponse({
    status: 503,
    body: JSON.stringify({ error: { message: "Simulated upstream capacity overload" } }),
  });

  // 3. Dispatch through gateway
  const res = await handleAppRequest(req);
  expect(res.status).toBe(200);
});
```

---

## §5. Anti-Context-Bloat & Silent Truncation Prevention

### 5.1 The Danger of Full-Suite LLM Context Flooding
The complete test suite contains **1,180 tests** across 97 files. Running an unqualified `bun test` produces tens of thousands of characters of terminal output:
1. **Silent Output Truncation**: When agents or subagents execute `bun test`, output limits (e.g. 30KB or 2000 lines) trigger harness truncation. The actual stack trace of a failed test is frequently buried and discarded in the truncated segment, leading to false negatives where an agent believes all tests passed when failures actually occurred.
2. **Context Exhaustion & Hallucination**: Massive test outputs flood the context window, degrading the model's reasoning capabilities, overwriting critical instructions, and causing hallucinated root causes.
3. **Simulation Log Pollution**: Resilience tests intentionally simulate network crashes and 5xx/429 responses, printing alarming error logs (`💥 [ERROR] Upstream socket closed abruptly`) that look like genuine failures even when the assertions passed.

### 5.2 Targeted Test Runners (The Primary Prescriptions)
Never run blanket `bun test` during iterative development. LiteRouter provides fine-grained, partitioned runners to keep context clean:

| Command | Target Scope | Test Count | When to Use |
|---|---|---|---|
| `bun run test:gateway` | `tests/unit` (Core engine, transformers, handlers) | ~938 tests | **Primary runner** for gateway edits, routing, pacer, cooldown, and scrubber work. No eval noise. |
| `bun run test:eval` | `tests/eval` (Benchmark grader logic) | ~182 tests | When modifying eval graders, patch tools, or benchmark validation rules. |
| `bun run test:legacy` | `tests/unit/legacy` (Dual-path legacy fallback) | ~179 tests | When verifying compatibility of legacy handlers or monolithic fallbacks. |
| `bun run test:failures` | `bun test --only-failures` | Only failed tests | When running across the suite to surface **only** regressions without passing spam. |
| `bun test <file>` | Single test file | Targeted | **Gold standard** during active file editing (e.g. `bun test tests/unit/pacer.test.ts`). |

### 5.3 Silent Log Redirection (`/tmp/test.log`)
When a full suite run is required (e.g. for GoLive or definition-of-done gates), agents MUST pipe standard output to `/tmp/test.log` and verify the exit code:

```bash
# Execute full suite cleanly without dumping 1,180 test lines into context:
bun test > /tmp/test.log 2>&1
echo "Exit code: $?"

# If exit code is non-zero, inspect only the tail or grep for failures:
tail -n 30 /tmp/test.log
```

If `Exit code: 0`, the suite passed with 100% certainty. If `Exit code != 0`, grep specifically for `fail`:
```bash
grep -E "(fail|FAIL|error|ERROR)" /tmp/test.log | head -n 30
```

---

## §6. State Teardown & Anti-Flake Symmetry

Global singletons in LiteRouter maintain state across requests (key rotation pointers, cooldown timestamps, circuit breaker failure counters, pacer conveyor queues, HTTP/2 connection pools). Failing to reset state creates order-dependent test flakes.

### 5.1 Mandatory Reset in `beforeEach` and `afterEach`
Every test suite interacting with gateway logic must import and execute `resetAllState()`:

```typescript
import { beforeEach, afterEach, describe, test, expect } from "bun:test";
import { handleAppRequest, resetAllState } from "../../src/lib";

describe("OpenAI Compat Gateway Pipeline", () => {
  beforeEach(() => {
    resetAllState();
  });

  afterEach(() => {
    resetAllState();
  });

  // test cases...
});
```

### 5.2 What `resetAllState()` Clears
`src/index.ts:resetAllState()` resets:
1. `globalCooldownManager.clearAll()`: Clears active provider cooldown timers and quarantine counters.
2. `globalKeyPool.reset()`: Resets rotation indexes and re-initializes key pools from environment.
3. `clearCircuitBreakerRegistry()`: Resets circuit breaker half-open/closed states and failure counts.
4. `clearPacerRegistry()`: Flushes queued pacer promises and pacing cadence timers.
5. `resetHttp2Pool()`: Closes active multiplexed H2 client sessions.
6. `resetProvidersRegistryCache()`: Reloads provider headers and endpoints.
7. `loadAndCacheNativeChains()` / `resetNativeFlashTierIndex()`: Resets Google Flash cascade indexes.

### 5.3 Mock Server Teardown
If your test suite spins up a local mock server using `Bun.serve`, always terminate it in `afterEach` or `afterAll` with force-kill:
```typescript
let mockServer: ReturnType<typeof Bun.serve>;

afterEach(() => {
  if (mockServer) {
    mockServer.stop(true); // pass true to close all open keep-alive connections
  }
  resetAllState();
});
```

### 5.4 Absolute Ban on Restoring Real Keys
**Never** attempt to restore real API keys in `afterEach`. The test runner process must remain hermetic and sanitized from boot to exit.

---

## §7. Pytest Integration Gate (`--live`)

For Python integration tests under `tests/integration/`:

```
                       uv run pytest tests/integration/
                                      │
                                      ▼
                      Does test have @pytest.mark.live ?
                                     / \
                                    /   \
                             YES   /     \   NO
                                  ▼       ▼
                          Is --live set?  Execute hermetic
                                / \       mock test
                         YES   /   \  NO
                              ▼     ▼
                        Execute     SKIP test
                        Live Smoke  (Default protection)
```

1. **Default Run is Hermetic**:
   ```bash
   uv run pytest tests/integration/
   ```
   Runs in ~2.7s. All tests marked `@pytest.mark.live` are automatically skipped to protect live keys and budget.
2. **Explicit Opt-In for Live Probes**:
   ```bash
   uv run pytest tests/integration/ --live
   ```
   Executes live downstream smoke tests connecting to a running gateway instance on `localhost:7766`.
3. **Marking Live Tests**:
   ```python
   import pytest

   @pytest.mark.live
   def test_live_gemini_stream():
       # Only executes when --live is explicitly passed
       ...
   ```

---

## §8. Verification Checklist for New Tests

Before committing any new test or test modification, complete every gate in this checklist:

```bash
# Gate 1: TypeScript static typecheck
bun run typecheck

# Gate 2: Code hygiene and anti-hallucination validation
uv run python admin/code_hygiene/agent_guardrail.py validate <test_file>

# Gate 3: Targeted test execution
bun test <test_file>

# Gate 4: Fast gateway verification or anti-bloat failure check
bun run test:gateway
# or for failure-only verification across entire suite:
bun run test:failures

# Gate 5: Python integration check
uv run pytest tests/integration/
```

- [ ] Does the test use synthetic stub keys (e.g. `mock-gg-stub-key-01`) instead of real credentials?
- [ ] Is all external traffic mocked via loopback test doubles (`127.0.0.1`)?
- [ ] Does every simulated error (429, 503, timeout) emit a `🧪 [TEST SIMULATION]` banner?
- [ ] Are `beforeEach` and `afterEach` hooks invoking `resetAllState()`?
- [ ] Are mock servers terminated via `mockServer.stop(true)`?
- [ ] Did the test pass without raising `UnmockedOutboundCallError`?
