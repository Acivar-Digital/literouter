# LiteRouter Automated Test Architecture (v4.1)

Comprehensive automated test architecture, hermetic validation framework, and integration test runner for LiteRouter (Bun runtime, port 7766).

> **AI Agent Authoring Mandate**: When writing or updating tests, you **MUST** follow the complete operational specification in [`.opencode2/skills/literouter/test-hygiene-playbook.md`](../.opencode2/skills/literouter/test-hygiene-playbook.md).

---

## 1. Executive Overview & Architecture

LiteRouter v4.1 employs a multi-tiered test matrix designed for maximum execution speed, zero external quota consumption, and deterministic state isolation. The suite exercises:
- The **v4.1 Unified Engine** (`src/engine/dispatch.ts`, `src/transformers/`, `src/handlers/v4/`).
- The **Legacy Dual-Path Fallback** (`src/handlers/legacy/`, `src/network/h2_pool.ts`).
- The **Benchmark Grader Harness** (`eval/stages/`, `eval/graders/`).
- The **Integration & Downstream Agent Gauntlet** (OpenCode 2, Claude Code CLI, Pydantic AI).

```
                            ┌──────────────────────────────────────────────┐
                            │             tests/ Test Suites               │
                            └──────────────────────┬───────────────────────┘
                                                   │
         ┌─────────────────────────┬───────────────┴───────────────┬─────────────────────────┐
         ▼                         ▼                               ▼                         ▼
  tests/unit/                tests/eval/                  tests/integration/           tests/smoke/
(938 Tests, ~15s)          (182 Tests, ~44ms)             (28 Pytest Items)         (Liveness Probes)
  ├─ Engine Dispatch         ├─ AST Patch Grader            ├─ v4 A/B Parity          └─ health_probe.test.ts
  ├─ Transformers            ├─ Pydantic Grader             ├─ Downstream Gauntlet
  ├─ Telemetry/Tracing       ├─ Security Injection Grader   ├─ Cooldown / Breaker
  ├─ Request Pacer           ├─ DOM/Web Evaluators          └─ Dots XML Cross-Wire
  └─ legacy/ (179 tests)     └─ (Hermetic mocks only)
```

---

## 2. Directory Map & Suite Matrix

| Directory | Primary Runner | Test Count | Scope & Coverage | Speed |
|---|---|---|---|---|
| [`tests/unit/`](./unit/README.md) | `bun run test:gateway` | **938 tests** | Core v4.1 engine dispatch, payload transformers (`oa`, `cl`, `gg`, `oo`, `ao`), directive parser, telemetry ring-buffer, trace writer, RequestPacer, and CooldownManager. Includes legacy fallback tests. | ~15s full / <250ms engine |
| [`tests/eval/`](./eval/README.md) | `bun run test:eval` | **182 tests** | Unit tests for the benchmark eval harness (`eval/`). Validates AST patchers, Pydantic graders, prompt injection vetoes, and web DOM scoring using hermetic mock doubles. | ~44ms |
| [`tests/unit/legacy/`](./unit/legacy/README.md) | `bun run test:legacy` | **179 tests** | Dual-path backward compatibility tests. Verifies monolithic legacy handlers (`openai_compat`, `google_native_fusion`), HTTP/2 multiplex pool, and legacy parsers. | ~7s |
| [`tests/integration/`](./integration/README.md) | `uv run pytest tests/integration/` | **28 items** | Pytest integration tests, v4 vs legacy A/B parity, ephemeral gateway lifecycle, downstream tool gauntlet (OpenCode 2, Claude Code CLI, Pydantic AI), and Dots XML cross-wire. | ~11s |
| `tests/smoke/` | `bun test tests/smoke` | **3 tests** | Gateway health probe, liveness verification, and startup assertions. | <100ms |
| `tests/fixtures/` | *Static Artifacts* | N/A | Golden stream recordings (`mock_openai_stream.txt`, `mock_anthropic_stream.txt`, `mock_dots_xml_stream.txt`, `mock_gemini_thought_sig.json`). | N/A |

---

## 3. Quick Command Matrix

| Command | Target Suite | Description & Best Use Case |
|---|---|---|
| `bun run test:gateway` | `tests/unit/` | **Default for core development**. Runs 938 gateway tests without noisy benchmark evaluation banners. |
| `bun run test:failures` | Full Suite | **Anti-bloat runner** (`bun test --only-failures`). Executes the entire suite but prints output **only** for failing tests. |
| `bun run test:eval` | `tests/eval/` | Runs 182 benchmark grader unit tests in ~44ms. Tests evaluation logic without making live model calls. |
| `bun run test:legacy` | `tests/unit/legacy/` | Runs 179 dual-path fallback tests to ensure backward compatibility for `LITEROUTER_ENGINE=legacy`. |
| `bun test` | Full Suite | Runs all 1,180 TypeScript unit and eval tests across 97 files. |
| `uv run pytest tests/integration/` | `tests/integration/` | Runs hermetic Python integration tests, downstream agent gauntlet, and A/B parity suite. |
| `bun run typecheck` | Whole Project | Static TypeScript typecheck (`tsc --noEmit`). Must report zero errors. |

---

## 4. Developer & AI Agent Workflow Guidance

### Preventing LLM Context Bloat & Silent Truncation
Running blanket `bun test` outputs over **1,100 lines of streaming logs and test passes**. In LLM harness environments (OpenCode, Claude Code, Antigravity), massive terminal output causes **context window bloat** and **silent truncation**, hiding critical stack traces and failure root causes.

#### 🟢 The Recommended Agent Workflow:
1. **Target your active subsystem**:
   - Modifying engine dispatch or transformers? Run `bun test tests/unit/engine/` (<2s).
   - Modifying directive parsing or keys? Run `bun test tests/unit/directive_parser.test.ts`.
   - Modifying telemetry? Run `bun test tests/unit/telemetry/`.
2. **Pre-commit verification**:
   - Run `bun run test:gateway` to verify all 938 gateway tests.
   - Run `bun run test:eval` to verify all 182 eval grader tests.
   - Run `bun run test:failures` if you suspect a regression elsewhere in the repository.
3. **Full Suite Log Redirection**:
   If executing the full suite is required for GoLive evidence, redirect stdout to prevent context explosion:
   ```bash
   bun test > /tmp/test.log 2>&1 && echo "Suite passed cleanly: exit code $?" || tail -n 50 /tmp/test.log
   ```

---

## 5. Hermetic Air-Gap Barrier (`tests/preload.ts`)

LiteRouter enforces a zero-cost, hermetic air-gap barrier during all automated test executions. Configured via `bunfig.toml` (`preload = ["./tests/preload.ts"]`), the barrier guarantees:

1. **Zero Outbound Token Consumption**:
   - `globalThis.fetch` is intercepted and wrapped.
   - Any HTTP request targeting external LLM vendor endpoints (`api.openai.com`, `openrouter.ai`, `integrate.api.nvidia.com`, `generativelanguage.googleapis.com`) immediately throws an `UnmockedOutboundCallError`.
   - Only loopback requests (`localhost`, `127.0.0.1`, `::1`) are permitted.
2. **In-Memory Key Sanitization**:
   - Vendor API keys (`GOOGLE_API_KEYS`, `OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS`, etc.) are replaced with synthetic test stubs (`mock-gg-stub-key-01`) **strictly in-memory**.
   - **MANDATE**: The physical, write-protected `.env.local` file on disk is **never touched, read, or modified** by tests.

---

## 6. Test Simulation Transparency Banners

When tests intentionally inject failure conditions (HTTP 429 rate limits, HTTP 500 server crashes, circuit breaker trips, mid-stream socket aborts), the test **MUST** emit a transparency banner before triggering the failure:

```typescript
console.log(
  "🧪 [TEST SIMULATION] Executing resilience gate test: injecting mock 503 upstream error to verify failover..."
);
```

This prevents developers and automated diagnostic monitors from misinterpreting expected test assertions as live gateway malfunctions.

---

## 7. State Teardown & Anti-Flake Symmetry

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

## 8. Rate Limiting & Pacing Architecture (v4.1)

- **Zdist Formally Retired**: Preemptive client-side sliding-window rate tracking (`RateLimitTracker` / `zdist.ts`) was retired in v4.1 (see `docs/GRAVEYARD/ZDIST.md`). Upstream LLM rate limits behave as dynamic leaky buckets with clock drift, making local preemptive tracking brittle and counterproductive.
- **Active Architecture**: Replaced by deterministic **RequestPacer** (`src/network/pacer.ts` spacing ingress requests by `min_delay_ms`) to smooth burst traffic, paired with **CooldownManager** (`src/network/cooldown.ts` reactive 429 quarantine with `Retry-After` header extraction and fallback TTL). Tested extensively in `tests/unit/pacer.test.ts` and `tests/unit/cooldown.test.ts`.

---

## 9. Full Quality Gate Pipeline

Before marking any task complete or submitting code changes:
```bash
# 1. Typecheck (Zero errors required)
bun run typecheck

# 2. Python Linting (Integration test hygiene)
uv run ruff check .

# 3. Fast Gateway Tests (938 tests)
bun run test:gateway

# 4. Evaluation Grader Tests (182 tests)
bun run test:eval

# 5. Integration Smoke & Gauntlet Tests (28 items)
uv run pytest tests/integration/
```
