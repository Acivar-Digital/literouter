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

1. **`tests/` is Hermetic and Air-Gapped**: Every unit test, integration test, and handler scenario in `tests/` must run 100% locally with zero external network connectivity. Tests must complete rapidly and predictably without dependency on upstream provider uptime or valid paid credentials.
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
├── unit/                       # Pure logic, fast, non-networked (<10ms)
│   ├── <subsystem>_<feature>.test.ts
│   └── fusion/
├── integration/                # Full gateway pipeline, mock HTTP loopbacks
│   ├── <handler>_<feature>.test.ts
│   └── test_<feature>_e2e.py   # Pytest mock integration
├── fixtures/                   # Static golden recordings (.json, .sse, .txt)
│   ├── <provider>/
│   └── mock_openai_stream.txt
└── handlers/                   # Targeted handler unit/retry suites
eval/                           # Live model evaluations (NOT run by bun test)
├── eval.ts
├── speed.ts
├── code.ts
└── web.ts
```

### 3.1 `tests/unit/<subsystem>_<feature>.test.ts`
- **Scope**: Pure logic tests, AST parsers, directive token validation, cooldown math, header builders, scrubber transforms.
- **Performance**: Ultra-fast execution (<10ms per test).
- **Environment**: In-memory data structures only; no active TCP listener sockets.
- **Examples**: `tests/unit/directive_parser.test.ts`, `tests/unit/cooldown.test.ts`, `tests/unit/thinking_transformer.test.ts`.

### 3.2 `tests/integration/<handler>_<feature>.test.ts`
- **Scope**: In-process or loopback integration tests checking the full LiteRouter pipeline (`handleAppRequest`, route dispatching, SSE streaming, keep-alive frames, HTTP/2 pooling, abort propagation).
- **Environment**: Uses `Bun.serve` on ephemeral loopback ports (`127.0.0.1:0` or `127.0.0.1:8999`) to simulate upstream provider responses.
- **Examples**: `tests/integration/openai_compat.test.ts`, `tests/integration/ghost_response_guard.test.ts`, `tests/integration/abort_propagation.test.ts`.

### 3.3 `tests/fixtures/<provider>/`
- **Scope**: Static recorded golden payloads, wire SSE text, chunk boundaries, and JSON schemas.
- **Rules**:
  - Store as `.json`, `.txt`, or `.sse`.
  - Must not contain live upstream keys or proprietary customer data.
  - Read via `Bun.file()` or `fs.readFileSync()`.
- **Examples**: `tests/fixtures/mock_anthropic_stream.txt`, `tests/fixtures/mock_openai_stream.txt`.

### 3.4 `eval/` (Capability Benchmarks & Evals)
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

## §5. State Teardown & Anti-Flake Symmetry

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

## §6. Pytest Integration Gate (`--live`)

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

## §7. Verification Checklist for New Tests

Before committing any new test or test modification, complete every gate in this checklist:

```bash
# Gate 1: TypeScript static typecheck
bun run typecheck

# Gate 2: Code hygiene and anti-hallucination validation
uv run python admin/code_hygiene/agent_guardrail.py validate <test_file>

# Gate 3: Targeted test execution
bun test <test_file>

# Gate 4: Full suite hermetic verification (Zero regressions, all pass)
bun test

# Gate 5: Python integration check
uv run pytest tests/integration/
```

- [ ] Does the test use synthetic stub keys (e.g. `mock-gg-stub-key-01`) instead of real credentials?
- [ ] Is all external traffic mocked via loopback test doubles (`127.0.0.1`)?
- [ ] Does every simulated error (429, 503, timeout) emit a `🧪 [TEST SIMULATION]` banner?
- [ ] Are `beforeEach` and `afterEach` hooks invoking `resetAllState()`?
- [ ] Are mock servers terminated via `mockServer.stop(true)`?
- [ ] Did the test pass without raising `UnmockedOutboundCallError`?
