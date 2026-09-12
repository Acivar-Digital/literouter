# LiteRouter v4.1 Gateway Unit Test Suite

High-throughput, hermetic unit tests for the LiteRouter v4.1 core gateway architecture.

```
tests/unit/
├── engine/                 # Unified dispatch pipeline, strategies, circuit breakers
│   ├── dispatch.test.ts
│   ├── dispatch_abort.test.ts
│   ├── circuit_breaker.test.ts
│   ├── pacer_adapter.test.ts
│   └── strategies/         # Provider execution strategies (standard, zen, gcp, etc.)
├── handlers/               # v4 thin route handlers & v4 router dispatcher
│   ├── v4_handlers.test.ts
│   └── v4_router.test.ts
├── transformers/           # Wire format transformers (oa, cl, gg, oo, ao)
│   ├── openai_chat.test.ts
│   ├── anthropic_messages.test.ts
│   ├── google_native.test.ts
│   ├── openai_responses.test.ts
│   └── anthropic_openai_xwire.test.ts
├── telemetry/              # In-memory tracing, ring-buffers, sanitizers
│   ├── trace_writer.test.ts
│   ├── ring_buffer.test.ts
│   ├── sanitize.test.ts
│   └── session.test.ts
├── legacy/                 # Dual-path fallback monolithic suites (179 tests)
│   └── README.md
├── directive_parser.test.ts # Directive token grammar (lr-*-*-*-*)
├── pacer.test.ts           # RequestPacer delay queues & burst smoothing
├── cooldown.test.ts        # Reactive 429 quarantine & TTL backoff
└── circuit_breaker.test.ts # Tri-state failure threshold management
```

---

## 1. Scope & Coverage

The `tests/unit/` suite validates all components of the **v4.1 Unified Engine**:

### 1.1 Engine Dispatch Pipeline (`src/engine/`)
- **Unified Dispatch Pipeline** (`dispatch.ts`, `dispatch.test.ts`): Tests end-to-end request resolution, strategy selection, key rotation loops, and streaming cutoff handling.
- **Mid-stream Abort Discrimination** (`dispatch_abort.test.ts`): Guarantees that client aborts (`AbortError`, code 20) terminate quietly without false-positive circuit breaker trips or 500 error telemetry.
- **Provider Execution Strategies** (`strategies/`):
  - `standard.test.ts`: Standard Bearer token authentication (OpenRouter, NVIDIA).
  - `zen_single_flight.test.ts`: UUID `x-session-id` injection and single-flight semantics.
  - `native_cascade.test.ts`: Gemini sticky tier fallbacks (`gemini-flash`, `gemini-flash-lite`) and `advance_target` on 404.
  - `gcp_guarded.test.ts`: Zero-cost Gemma model billing guardrail and HTTP 403 enforcement.
  - `anthropic_direct.test.ts`: Direct Anthropic headers (`x-api-key`, `anthropic-version`).

### 1.2 Payload Transformers (`src/transformers/`)
Verifies bidirectional translation and reasoning stripping across all five wire protocols:
- `oa` (`openai_chat.test.ts`): OpenAI Chat Completions payload formatting and delta chunk handling.
- `cl` (`anthropic_messages.test.ts`): Anthropic Claude Messages API request/response mappings.
- `gg` (`google_native.test.ts`): Google Gemini REST API (`generateContent`) translation.
- `oo` (`openai_responses.test.ts`): OpenAI Responses API native passthrough.
- `ao` (`anthropic_openai_xwire.test.ts`): Anthropic-to-OpenAI cross-wire translation for tools and XML reasoning extraction.

### 1.3 Thin Route Handlers (`src/handlers/v4/`)
- `v4_handlers.test.ts`: Thin handler input validation (JSON parsing, directive format, HTTP status mapping).
- `v4_router.test.ts`: Inbound route dispatch, HTTP method validation, and trace query routing (`GET /v1/traces`).

### 1.4 Telemetry & Tracing (`src/telemetry/`)
- `trace_writer.test.ts`: SQLite trace writer with `:memory:` in-memory database testing, eviction rings, and schema migration.
- `ring_buffer.test.ts`: Fixed-capacity ring buffer for real-time trace queries without memory leaks.
- `sanitize.test.ts`: Masking of sensitive authorization keys and bearer tokens in telemetry traces.
- `session.test.ts`: Client session tracking and latency metrics.

### 1.5 Resilience & Rate Limiting Architecture
- **Request Pacer** (`pacer.test.ts`): Deterministic ingress pacing by provider `min_delay_ms` to eliminate concurrency burst spikes.
- **Cooldown Manager** (`cooldown.test.ts`): Reactive HTTP 429 quarantine with `Retry-After` header parsing and configurable backoff TTLs.
- **Circuit Breaker** (`circuit_breaker.test.ts`): Tri-state (CLOSED, OPEN, HALF-OPEN) circuit breaker protecting downstream clients from flapping backends.
- *Architectural Note*: Preemptive client-side RPM rate tracking (`zdist.ts`) was retired in v4.1 in favor of this reactive, jitter-immune architecture.

---

## 2. How to Run

### Run Entire Gateway Suite (Recommended)
```bash
bun run test:gateway
```
*Executes all 938 tests across 76 files in `tests/unit/` (including legacy fallback tests) in ~15s.*

### Run Targeted Subsystems
```bash
# Engine dispatch & strategies only (<250ms)
bun test tests/unit/engine/

# Payload transformers only (~1.5s)
bun test tests/unit/transformers/

# Telemetry & tracing only (<1s)
bun test tests/unit/telemetry/

# Specific test file
bun test tests/unit/directive_parser.test.ts
```

### Run Failures Only
```bash
bun run test:failures
```
*Runs the full suite but suppresses all passing logs, showing only failure diffs.*

---

## 3. Performance & Isolation Guarantees

1. **Zero External Calls**:
   Preloaded via `tests/preload.ts`. Any unmocked external HTTP call is intercepted and throws an `UnmockedOutboundCallError`.
2. **Deterministic Teardown**:
   All tests invoke `resetAllState()` before and after each test case, clearing active key pools, pacer queues, and circuit breaker registries.
3. **Sub-Millisecond Execution**:
   Pure logic tests in this directory execute in under 1ms per test, with the entire engine dispatch test suite completing in under 250ms.
