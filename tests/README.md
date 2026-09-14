# LiteRouter Automated Test Architecture (v4.1)

Comprehensive automated test architecture, hermetic validation framework, and integration test runner for LiteRouter (Bun runtime, port 7766).

> **AI Agent Authoring Mandate**: When writing or updating tests, you **MUST** follow the complete operational specification in [`.opencode2/skills/literouter/test-hygiene-playbook.md`](../.opencode2/skills/literouter/test-hygiene-playbook.md).

---

## 1. Executive Overview & Test Architecture

LiteRouter v4.1 employs an accelerated, multi-tiered test matrix designed for sub-second developer iteration, deterministic state isolation, and zero external quota consumption. The test runner architecture decouples the test suite into:

1. **Accelerated Domain Runner (`scripts/test_runner.ts`)**: The default engine for `bun test`. Slices the test suite into 8 discrete domains and executes them concurrently across isolated subprocesses via `Bun.spawn`.
2. **Hermetic Unit Test Matrix (`tests/unit/`)**: Over 900 gateway unit tests exercising the v4.1 Unified Engine (`dispatch.ts`), streaming transformers, RequestPacer, CooldownManager, telemetry, and legacy fallback handlers.
3. **Benchmark Eval Grader Harness (`tests/eval/`)**: 182 grading tests evaluating AST patchers, Pydantic graders, prompt injection vetoes, and DOM web evaluators using hermetic mock doubles.
4. **Integration & Downstream Agent Gauntlet (`tests/integration/`)**: Pytest integration harness validating v4 vs legacy A/B parity, ephemeral gateway lifecycles, and downstream developer tools (OpenCode 2, Claude Code CLI, Pydantic AI).

```
                             ┌────────────────────────────────────────────────────────┐
                             │       LiteRouter Test Matrix (Bun & Python)            │
                             └───────────────────────────┬────────────────────────────┘
                                                         │
         ┌───────────────────────────────────────────────┼───────────────────────────────────────────────┐
         ▼                                               ▼                                               ▼
┌─────────────────────────────────┐             ┌─────────────────────────────────┐             ┌─────────────────────────────────┐
│     Accelerated Domain Runner   │             │       Evaluation Graders        │             │       Integration Gauntlet      │
│     (scripts/test_runner.ts)    │             │          (tests/eval/)          │             │       (tests/integration/)      │
├─────────────────────────────────┤             ├─────────────────────────────────┤             ├─────────────────────────────────┤
│ • 8 Isolated Domains            │             │ • 182 Grader Tests (~60ms)      │             │ • 28 Pytest Items (~11s)        │
│ • Parallel Bun.spawn Subprocs   │             │ • AST Patch Grader              │             │ • v4 A/B Parity Verification    │
│ • Zero Context Bloat Filtering  │             │ • Pydantic Contract Grader      │             │ • Downstream Tool Gauntlet      │
│ • Single-Line Pass Summaries    │             │ • Prompt Injection Defense      │             │ • Dots XML Cross-Wire E2E       │
│ • Surgical Failure Extraction   │             │ • Mock Doubles Only             │             │ • Ephemeral Gateway Lifecycle   │
└─────────────────────────────────┘             └─────────────────────────────────┘             └─────────────────────────────────┘
```

---

## 2. Accelerated Domain Test Runner (`scripts/test_runner.ts`)

LiteRouter routes primary accelerated test execution through `scripts/test_runner.ts` via `bun test`. Running `bun test` invokes this domain-partitioned runner rather than raw sequential test runs (for unbuffered native execution, use `bun run test:raw`).

### Why Accelerated Domain Execution?
- **Speed via Concurrency**: Spawns multiple parallel `bun test` child processes partitioned across distinct architectural domains, utilizing all available CPU cores.
- **State Isolation**: Subprocesses execute in isolated memory spaces, preventing singleton state bleed (`pacerRegistry`, `globalCooldownManager`, `KeyPool`) across disparate domains.
- **Anti-Bloat Output Filtering**: Suppresses thousands of lines of passing logs, runtime emojis, and banners. Emits a clean one-line pass summary or concise, surgical diffs on failure.

### The 8 Test Domains

The test runner automatically categorizes tests into 8 domains via `categorizeTests()`:

| Domain | Target Path / Tests Included | Focus Area |
|---|---|---|
| **`handlers`** | `tests/unit/handlers/` | HTTP endpoint adapters, protocol routing, route dispatchers (`openai_compat`, `anthropic_compat`, `google_native_fusion`). |
| **`network`** | `tests/unit/network/`, `pacer.test.ts`, `cooldown.test.ts`, `pool.test.ts`, `fetcher.test.ts`, `pacer_cooldown_integration.test.ts`, `gcp_pacer_conveyor.test.ts` | RequestPacer conveyor belts, CooldownManager 429 quarantines, HTTP/2 multiplex connection pools, and fetcher resilience. |
| **`stream`** | `tests/unit/transformers/`, `midstream_retry.test.ts`, `safe_close.test.ts`, `tool_call_stream_regression.test.ts`, `responses_transformer.test.ts`, `thinking_transformer.test.ts`, `thought_signature.test.ts`, `gemma_transformer.test.ts`, `ling_transformer.test.ts`, `dots_*.test.ts`, `gold_xml_*.test.ts`, `test_*xml*.test.ts` | Streaming transformers (`oa`, `cl`, `gg`, `oo`, `ao`), SSE line splitters, thinking tag wrappers, XML stream reconstruction, mid-stream retry, socket aborts. |
| **`engine`** | `tests/unit/engine/`, `engine_dual_path.test.ts` | Unified engine dispatch (`src/engine/dispatch.ts`), fallback cascades, dual-path resolution (`LITEROUTER_ENGINE=v4\|legacy`). |
| **`telemetry`** | `tests/unit/telemetry/`, `visual_telemetry.test.ts` | Ring-buffer telemetry storage, trace recorders, visual metrics formatters, latency tracking. |
| **`legacy`** | `tests/unit/legacy/` | Monolithic legacy handlers, legacy parsers, and backward-compatibility regressions. |
| **`core`** | All other `tests/unit/*.test.ts` (e.g. `directive_parser.test.ts`, `model_presets.test.ts`, `auth.test.ts`) | Auth verification, directive parsing, API key rotation pools, configuration loaders, system utilities. |
| **`eval`** | `tests/eval/` | Benchmark evaluation suite, AST patchers, Pydantic graders, DOM evaluators, prompt injection validators. |

### Parallel Subprocess Execution via `Bun.spawn`

When executed without domain arguments, the runner resolves the 7 unit domains (`UNIT_DOMAINS`) and launches parallel child processes:

```typescript
const proc = Bun.spawn(["bun", "test", ...target.files], {
  stdout: "pipe",
  stderr: "pipe",
  env: process.env,
});

const [stdout, stderr, exitCode] = await Promise.all([
  new Response(proc.stdout).text(),
  new Response(proc.stderr).text(),
  proc.exited,
]);
```

All domains run simultaneously. Results are gathered with `Promise.all`, aggregated, and reported in a unified summary upon completion.

---

## 3. Targeted Subcommands for Fast Iteration

Rather than running the full test suite during active development, agents and developers can target individual domains directly:

```bash
# Run only network domain tests (pacer, cooldown, pools, fetcher)
bun test network

# Run only stream transformer and SSE tests
bun test stream

# Run only handler tests
bun test handlers

# Run only engine dispatch tests
bun test engine

# Run only telemetry tests
bun test telemetry

# Run only core tests (auth, keys, directives)
bun test core

# Run only legacy fallback tests
bun test legacy

# Run evaluation grader tests
bun test eval
```

### Filtering Within Domains or by Pattern
The runner accepts secondary filter arguments or direct pattern matches:

```bash
# Target only the pacer test within the network domain
bun test network pacer

# Target any test matching "directive" across all domains
bun test directive

# Run silent mode (suppresses pass summary in scripts)
bun test network --silent
```

---

## 4. Zero Context Bloat Architecture

Terminal output pollution is a critical failure mode in agentic development environments (OpenCode, Claude Code, Antigravity IDE). Running raw test runners dumps thousands of lines of passing assertions, banners, and server logs, exhausting LLM context windows and triggering silent truncation.

### Pass Suppression
When tests pass, all stdout and stderr from child processes are completely suppressed. The runner emits a single clean summary line:

```text
✓ All tests passed (1170 tests across 7 domains in 18.26s)
```

### Surgical Failure Extraction (`extractFailureOutput`)
When a test fails, passing output from successful domains remains suppressed. For the failing domain, `extractFailureOutput()` strips:
- Passing test assertions (`(pass) ...`)
- Server runtime emojis (`🔄`, `🟢`, `🏁`, `⚡`, `⚠️`, `🎯`, `🤖`, `🔵`)
- Bun test version headers (`bun test v...`)
- Generic test file summaries

Only the failing test title, expectation diff (expected vs received), and the relevant stack trace are surfaced:

```text
✗ Tests failed: 1 failed, 1169 passed across 7 domains in 17.84s

--- [stream] Failure ---
(fail) Stream Transformer > preserves thought blocks in reasoning stream
  expect(received).toEqual(expected)
  - Expected: "<thought>Analyzing prompt...</thought>"
  + Received: ""
    at tests/unit/transformers/thinking_transformer.test.ts:42:12
```

---

## 5. Unbuffered Raw Fallback (`bun run test:raw`)

When debugging low-level Bun runtime behavior, test harness crashes, or when interactive unbuffered output is required, use the unbuffered fallback:

```bash
# Native bun test run across all tests (unbuffered, no domain slicing)
bun run test:raw

# Raw run targeting a specific test file
bun run test:raw tests/unit/directive_parser.test.ts

# Raw run with native Bun flags
bun run test:raw --bail --timeout 10000
```

`bun run test:raw` executes native `bun test` directly without going through `scripts/test_runner.ts`.

---

## 6. Python Integration Suite (`tests/integration/`)

LiteRouter maintains an end-to-end integration test suite using Python and `pytest`. This suite validates live HTTP interactions against the running gateway (or an ephemeral mock instance) and asserts downstream compatibility.

```bash
# Run the complete integration test suite
uv run pytest tests/integration/

# Run specific integration categories
uv run pytest tests/integration/test_v4_ab_parity.py        # v4 vs Legacy A/B parity
uv run pytest tests/integration/test_downstream_gauntlet.py # Agent tool calls (OpenCode, Claude, Pydantic)
uv run pytest tests/integration/test_dots_transformer_e2e.py # XML & thinking tag transformations
```

### Scope & Coverage:
1. **v4 vs Legacy Parity (`test_v4_ab_parity.py`)**: Confirms payload and response equivalence between the v4 Unified Engine and the legacy monolithic handlers.
2. **Downstream Agent Gauntlet (`test_downstream_gauntlet.py`)**: Asserts that LiteRouter seamlessly handles payloads generated by real AI agent clients:
   - **OpenCode 2**: Reasoning tokens, tool-calling schemas, SSE chunk handling.
   - **Claude Code CLI**: Messages API conversion, Anthropic thinking blocks, stream reconnects.
   - **Pydantic AI**: Structured output schemas, validation error recovery, function calls.
3. **Dots XML Cross-Wire (`test_dots_transformer_e2e.py`)**: Tests raw XML and pseudo-tool call translation across models.
4. **Provider Matrices (`tests/integration/matrices/`)**: Matrix validation for Nemo, Google, and OpenRouter endpoints.

---

## 7. Command Reference Matrix

| Command | Target Suite | Description & Best Use Case | Output Profile |
|---|---|---|---|
| `bun test` | All 7 Unit Domains | **Default fast runner**. Runs 1,100+ tests across domains in parallel subprocesses. | Single-line pass summary; failure diffs only. |
| `bun test <domain>` | Single Domain | **Targeted iteration**. Runs only the specified domain (`handlers`, `network`, `stream`, etc.). | Single-line pass summary; failure diffs only. |
| `bun run test:raw` | Full Suite (Native) | **Unbuffered fallback**. Native `bun test` without domain runner wrapper or output suppression. | Full unbuffered Bun test logs. |
| `bun run test:failures` | Full Suite | Anti-bloat raw runner (`bun test --only-failures`). | Only failing tests shown. |
| `bun run test:eval` | `tests/eval/` | Benchmark grader unit tests (`scripts/test_runner.ts eval`, 182 tests). | Single-line pass summary; failure diffs only. |
| `uv run pytest tests/integration/` | `tests/integration/` | Python integration suite, downstream agent gauntlet, and A/B parity. | Standard Pytest output. |
| `bun run typecheck` | Whole Project | Static TypeScript typecheck (`tsc --noEmit`). | Zero errors required. |

---

## 8. Hermetic Air-Gap Barrier (`tests/preload.ts`)

LiteRouter enforces a zero-cost, hermetic air-gap barrier during all automated test executions. Configured via `bunfig.toml` (`preload = ["./tests/preload.ts"]`), the barrier guarantees:

1. **Zero Outbound Token Consumption**:
   - `globalThis.fetch` is intercepted and wrapped.
   - Any HTTP request targeting external LLM vendor endpoints (`api.openai.com`, `openrouter.ai`, `integrate.api.nvidia.com`, `generativelanguage.googleapis.com`) immediately throws an `UnmockedOutboundCallError`.
   - Only loopback requests (`localhost`, `127.0.0.1`, `::1`) are permitted.
2. **In-Memory Key Sanitization**:
   - Vendor API keys (`GOOGLE_API_KEYS`, `OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS`, etc.) are replaced with synthetic test stubs (`mock-gg-stub-key-01`) **strictly in-memory**.
   - **MANDATE**: The physical, write-protected `.env.local` file on disk is **never touched, read, or modified** by tests.

---

## 9. Test Simulation Transparency Banners

When tests intentionally inject failure conditions (HTTP 429 rate limits, HTTP 500 server crashes, circuit breaker trips, mid-stream socket aborts), the test **MUST** emit a transparency banner before triggering the failure:

```typescript
console.log(
  "🧪 [TEST SIMULATION] Executing resilience gate test: injecting mock 503 upstream error to verify failover..."
);
```

This prevents developers and automated diagnostic monitors from misinterpreting expected test assertions as live gateway malfunctions.

---

## 10. State Teardown & Anti-Flake Symmetry

LiteRouter gateway components use singleton registries (`globalKeyPool`, `globalCooldownManager`, `pacerRegistry`, `circuitBreakers`, `h2_pool`). To guarantee zero cross-test state leakage:

1. Always invoke `resetAllState()` in both `beforeEach` and `afterEach`:
   ```typescript
   import { beforeEach, afterEach, describe, test, expect } from "bun:test";
   import { resetAllState } from "../../src/lib";

   describe("Component Test Suite", () => {
     beforeEach(() => {
       resetAllState();
     });

     afterEach(() => {
       resetAllState();
     });
   });
   ```
2. Any mock HTTP server created with `Bun.serve({ ... })` must be forcefully terminated in `afterEach`:
   ```typescript
   afterEach(() => {
     if (mockServer) {
       mockServer.stop(true);
     }
     resetAllState();
   });
   ```

---

## 11. Rate Limiting & Pacing Architecture (v4.1)

- **Zdist Formally Retired**: Preemptive client-side sliding-window rate tracking (`RateLimitTracker` / `zdist.ts`) was retired in v4.1 (see `docs/GRAVEYARD/ZDIST.md`). Upstream LLM rate limits behave as dynamic leaky buckets with clock drift, making local preemptive tracking brittle and counterproductive.
- **Active Architecture**: Replaced by deterministic **RequestPacer** (`src/network/pacer.ts` spacing ingress requests by `min_delay_ms`) to smooth burst traffic, paired with **CooldownManager** (`src/network/cooldown.ts` reactive 429 quarantine with `Retry-After` header extraction and fallback TTL). Tested extensively in `tests/unit/pacer.test.ts` and `tests/unit/cooldown.test.ts`.

---

## 12. Full Quality Gate Pipeline

Before marking any task complete or submitting code changes:

```bash
# 1. Typecheck (Zero errors required)
bun run typecheck

# 2. Python Linting (Integration test hygiene)
uv run ruff check .

# 3. Accelerated Gateway Tests (1,100+ tests across parallel domains)
bun test

# 4. Evaluation Grader Tests (182 tests)
bun run test:eval

# 5. Integration Smoke & Gauntlet Tests (28 items)
uv run pytest tests/integration/
```
