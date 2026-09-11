# LiteRouter Technical Architecture (v4.0)

This document serves as the technical blueprint for LiteRouter v4.0, detailing the core system design, in-memory networking stack, protocol multiplexing, directive-driven dispatch, and model evaluation pipeline.

---

## 1. System Overview & Architectural Vision

LiteRouter is a zero-dependency, ultra-low-latency AI API Gateway built on Bun and TypeScript. It acts as an intelligent layer-7 reverse proxy and translation bridge between client development environments (OpenCode, Claude Code, Cursor, Antigravity, Pydantic AI) and multiple upstream generative AI providers (OpenRouter, NVIDIA NIM, Google AI Studio, Google Cloud Vertex AI, Zen, Anthropic, and custom endpoints).

### Core Design Principles
- **Sub-Millisecond Overhead**: Single Bun process running native TypeScript, eliminating Python runtime bottlenecks and heavy database dependencies.
- **Zero External Database Dependency**: Fully in-memory state management. External Redis/Valkey instances and Lua scripts are completely replaced by lock-free, in-memory key pooling, precise cooldown timers, and FIFO pacing queues.
- **Protocol & ALPN Multiplexing**: Dual HTTP/2 and HTTP/1.1 support with Application-Layer Protocol Negotiation (ALPN) over native TLS, coupled with persistent outbound HTTP/2 session pooling (`h2_pool`).
- **Declarative Directive Keys**: Client authorization tokens carry routing, wire protocol, endpoint targeting, and transformation directives (`lr-<prov>-<payload>-<compl>-<nuances>`).
- **Token Bleed Defense**: Dynamic reasoning scrubber that strips historical reasoning blocks (`<thought>`, `delta.reasoning_content`) to prevent multi-turn prompt ballooning while preserving active tool-use context and Google thought signatures.
- **Audit-First Evaluation**: Built-in 3-pillar evaluation harness (`eval/eval.ts`) to benchmark throughput, agentic coding adherence, and frontend capabilities before promoting models to production routing.

---

## 2. In-Memory Key & Traffic Architecture (Replacing Redis/Valkey)

LiteRouter v4.0 completely eliminates external Redis/Valkey infrastructure in favor of an optimized, in-memory coordination engine residing within the Bun process:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             INCOMING REQUEST                                │
│                   (Bearer lr-<prov>-<payload>-<compl>-<nuance>)             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Ingress Request Pacer (`RequestPacer` / `FastFifoQueue`)                 │
│    - Smooths request bursts into deterministic intervals per provider       │
│    - Tracks dwell times via Exponential Moving Average (EMA)                │
│    - Fast FIFO queue drops gracefully via `PacerQueueOverflowError`         │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. In-Memory Key Pool Manager (`KeyPool`)                                   │
│    - Per-provider rotating key pools with atomic pointer advancement        │
│    - Skips keys currently in cooldown or quarantine                         │
│    - Event-driven notifications (`available:<provider>`) upon key readiness │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. Granular Cooldown & Conserve Manager (`CooldownManager`)                 │
│    - Automatic penalty clamping (5s to 2hr) and Retry-After header parsing  │
│    - Status-specific cooldowns (429: 65s, 401/403: 7 days, 5xx: 10s)        │
│    - Decoupled Key Conserve Engine with UTC Midnight rollover logic         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 KeyPool (`src/network/pool.ts`)
- **Structure**: Uses in-memory `Map<string, readonly string[]>` and atomic index pointer maps (`Map<string, number>`).
- **Rotation**: Selects keys via round-robin, automatically skipping quarantined or cooling keys.
- **Asynchronous Wakeup**: When a key's quarantine or cooldown expires, `KeyPool` fires Node.js event emitter signals (`available:<provider>` and `available`) to notify queued requests without polling.
- **Reset & Reload**: Supports instant hot-reset per provider (`/admin/pool/reset?provider=<prov>`) or global reset (`/reset`).

### 2.2 CooldownManager (`src/network/cooldown.ts`)
- **State Map**: In-memory `Map<string, KeyCooldownState>` storing `quarantinedUntil`, `reason`, and `lastErrorStatus`.
- **Intelligent Header Extraction**: Inspects upstream responses for `Retry-After` (seconds or HTTP date formats), `quotaResetDelay` in JSON bodies, or provider-specific headers.
- **Grace Retries**: Transient delays under 2,000ms trigger a micro-wait without penalizing key reputation.
- **Clamping**: Cooldown intervals are safely clamped between a 5-second floor and a 2-hour ceiling.

### 2.3 RequestPacer & FastFifoQueue (`src/network/pacer.ts`)
- **Traffic Shaping**: Prevents rate-limit spikes by enforcing minimum inter-request dispatch intervals (`minIntervalMs` or derived from `maxRpm`).
- **FastFifoQueue**: Doubly-linked node list (`QueueNode<T>`) providing $O(1)$ enqueue, dequeue, and arbitrary removal (e.g. when an inbound request aborts while queued).
- **EMA Dwell Telemetry**: Maintains exponential moving average (EMA) of queue wait times, logged transparently in gateway telemetry.

---

## 3. Decoupled Key Conserve Engine (Midnight UTC Rollover)

Certain providers (such as OpenRouter's free tier) enforce hard daily quotas (e.g., 200 requests/day per key) reset strictly at 00:00:00 UTC. Treating daily quota exhaustion as a short 65-second rate limit causes continuous 429 loops and rapid key exhaustion across pools.

LiteRouter v4.0 implements a decoupled key conservation subsystem:

### 3.1 Conserve Rules Matching
Providers define declarative `conserve_rules` in `config/providers.json`:
```json
{
  "conserve_rules": [
    {
      "status": 429,
      "contains": "free-models-per-day",
      "ttl": "midnight_utc",
      "reason": "daily_free_limit"
    }
  ]
}
```

### 3.2 Midnight UTC Calculation (`calculateMidnightUtcSec`)
When a conserve rule with `ttl: "midnight_utc"` triggers:
1. The engine calculates the exact milliseconds remaining until the next UTC midnight:
   $$\text{nextMidnightUtc} = \text{Date.UTC}(\text{year}, \text{month}, \text{day} + 1, 0, 0, 0, 0)$$
2. A **60-second safety buffer** is appended to ensure the upstream quota window has completely rolled over:
   $$\text{ttlSec} = \lceil (\text{nextMidnightUtc} - \text{nowMs}) / 1000 \rceil + 60$$
3. The specific key is parked until midnight UTC without quarantining the entire provider pool or penalizing paid keys.

---

## 4. HTTP/2 ALPN Multiplexing & Outbound `h2_pool`

LiteRouter features full end-to-end HTTP/2 capabilities for both inbound clients and outbound upstreams.

```
┌─────────────────────────┐                     ┌─────────────────────────┐
│     Client (OpenCode,   │                     │  Upstream Provider API  │
│    Claude Code, Cursor) │                     │ (OpenRouter, NIM, etc.) │
└────────────┬────────────┘                     └────────────▲────────────┘
             │                                               │
             │ TLS ALPN (h2, http/1.1)                       │ Multiplexed Streams
             ▼                                               │ (Single TCP/TLS Socket)
┌────────────────────────────────────────────────────────────┴────────────┐
│ LiteRouter v4.0 Gateway (Port 7766)                                     │
│                                                                         │
│  [Inbound Secure Server]                                                │
│  - http2.createSecureServer({ allowHTTP1: true, ALPNProtocols: [...] }) │
│  - Backpressure pipe with drain handling (`pipeWebResponseToNode`)     │
│  - Clean client abort propagation (SIGABRT / ERR_HTTP2_STREAM_CANCEL)   │
│                                                                         │
│  [Outbound Session Pool: `Http2SessionPool` (`src/network/h2_pool.ts`)] │
│  - Single-Flight Connection Mutex (`connectionLocks`)                  │
│  - Active stream multiplexing (up to 80 concurrent streams/session)     │
│  - Health probing, idle draining (30s), max session lifespan (180s)     │
└─────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Inbound ALPN Secure Server (`src/index.ts`)
- **Native Dual-Protocol**: Uses `node:http2`'s `createSecureServer` with `ALPNProtocols: ["h2", "http/1.1"]` and `allowHTTP1: true`.
- **Stream Lifecycle & Backpressure**: Streams are piped chunk-by-chunk. If the underlying TCP buffer saturates (`nodeRes.write(value) === false`), streaming pauses until the `"drain"` event fires.
- **Client Disconnect Handling**: Early client termination cancels the active reader immediately and releases upstream stream handles without dangling socket leaks.

### 4.2 Outbound `Http2SessionPool` (`src/network/h2_pool.ts`)
- **Single-Flight Connection Mutex**: Outbound connection requests to the same origin share an in-flight promise (`connectionLocks`), preventing thundering herds during cold boots or connection recreation.
- **Multiplexing Thresholds**: Up to 80 active streams per HTTP/2 session (`maxStreamsPerSession: 80`).
- **Session Lifecycle & Recycling**:
  - Unhealthy sessions (closed, destroyed, or socket-reset) are purged automatically.
  - Sessions older than 180 seconds (`maxSessionAgeMs`) enter graceful draining (`isDraining: true`).
  - Active streams complete on draining sessions, while new requests spin up a fresh session.
  - Emergency overflow sessions are created if all existing sessions reach maximum concurrency.

---

## 5. Directive Key Grammar & Routing Dispatch

LiteRouter uses a structured, self-describing API key convention known as **Directive Keys**. The client's Authorization header dynamically specifies provider routing, wire protocol adaptation, completion endpoints, and behavioral nuances.

### 5.1 Grammar Specification
$$\mathbf{Directive} = \texttt{lr-}\{\mathbf{Provider}\}\texttt{-}\{\mathbf{Payload}\}\texttt{-}\{\mathbf{Completion}\}\texttt{-}\{\mathbf{Nuances}\}$$

- **Provider (13)**: `or` (OpenRouter), `nv` (NVIDIA NIM), `gg` (Google Studio), `oa` (OpenAI), `an` (Anthropic), `gq` (Groq), `cb` (Cerebras), `ds` (DeepSeek), `ms` (Mistral), `tg` (Together), `zn` (Zen), `gc` (Google Cloud Vertex), `tp` (Test Provider).
- **Payload / Wire (6)**:
  - `oa`: Standard OpenAI ChatCompletions (scrubs historical reasoning tokens).
  - `oo`: Native OpenAI Responses API (preserves raw response structure).
  - `cl`: Anthropic Messages wire format.
  - `gg`: Google Generative Language REST format.
  - `rs`: Responses format adapted/translated.
  - `ao`: Anthropic-inbound to OpenAI-outbound cross-wire.
- **Completion Endpoint (10)**: `ch` (`/v1/chat/completions`), `ms` (`/v1/messages`), `rs` (`/v1/responses`), `gc` (`generateContent`), `ob`, `g1`, `im`, `em`, `au`, `md`.
- **Nuances (8, combinable with `+`)**:
  - `no`: Standard / No special nuance.
  - `dp`: Deep reasoning / Tool extraction mode.
  - `ts`: Thinking preserved (retains thinking chunks).
  - `sb`: Strict sanitize / Force strip reasoning for all clients.
  - `gm`: Gemma payload sanitization (`thinkingConfig` stripped).
  - `g3`: Gemini 3 preview adaptations.
  - `tc`: Tool compaction enabled.
  - `lg`: Legacy compatibility pass-through.

### 5.2 Fusion Virtual Model Keys
Format: `lr-fse-<preset>`
- Presets: `quad` (balanced 4-model cluster), `pydn` (Pydantic / structured output specialist), `fast` (sub-second latency cluster), `deep` (deep reasoning & math fallback).
- Configured in `config/fusion.json` with sticky 5-minute fallback caching (`FusionStickyCache`).

### 5.3 Ingress Routing Table
Directives are validated and dispatched by `dispatchRoute()` in `src/index.ts`:

| Route Path | Method | Handler Source | Applicable Directives |
|---|---|---|---|
| `/v1/chat/completions` | `POST` | `src/handlers/openai_compat.ts` | `lr-*-oa-ch-*`, `lr-*-ao-ch-*` |
| `/v1/messages`, `/messages` | `POST` | `src/handlers/anthropic_compat.ts` | `lr-*-cl-ms-*` |
| `/v1/responses` | `POST` | `src/handlers/openai_original.ts` | `lr-*-oo-rs-*` |
| `/v1beta/models/*:generateContent` | `POST` | `src/handlers/google_native.ts` | `lr-gg-gg-gc-*` |
| `/v1beta/openai/*` | `POST` | `src/handlers/gcp_compat.ts` | `lr-gc-oa-ch-*` |
| `/v1/models`, `/v1beta/models` | `GET` | `src/handlers/discovery.ts` | Dynamic discovery via provider credentials |
| `/health`, `/hello` | `GET` | `src/index.ts` | Auth-free system health and pool metrics |
| `/reset` | `POST` | `src/index.ts` | Auth-free hard gateway state reload |
| `/admin/pool/reset` | `POST` | `src/index.ts` | Authenticated per-provider key pool reset |

---

## 6. Transformations, Thought Signatures & Token Bleed

### 6.1 Reasoning Scrubber (`src/transformers/thinking.ts`)
Multi-turn agent sessions (OpenCode, Claude Code) compound prompt costs exponentially when previous turns contain large `<thinking>` blocks.
- **Dynamic Historical Stripping**: LiteRouter strips reasoning tokens from previous assistant messages in the conversation history while leaving the current turn's active reasoning intact.
- **70% Cost Reduction**: By stripping stale thinking artifacts, context token counts drop by 50% to 70% in long-running agent workflows.

### 6.2 Google Thought Signature Preservation
Google Gemini models require an opaque `thought_signature` token to accompany tool-call responses across consecutive turns.
- When Gemini emits a tool call with a thought signature, LiteRouter records the mapping.
- On subsequent tool responses submitted by the client, LiteRouter injects the corresponding thought signature into the payload, preventing upstream `"Invalid tool call signature"` failures.

### 6.3 Gemma Payload Sanitization
Gemma 2 and Gemma 3 models crash when upstream payloads include `thinkingConfig` or `thinking_config`. LiteRouter recursively scrubs these keys from incoming requests targeting Gemma models.

---

## 7. The 3-Pillar Model Evaluation Gauntlet (`eval/eval.ts`)

LiteRouter includes an automated, production-grade model auditing suite to evaluate upstream model viability across three distinct capabilities:

```
                          ┌───────────────────────────┐
                          │     Master Evaluator      │
                          │      (eval/eval.ts)       │
                          └─────────────┬─────────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           ▼                            ▼                            ▼
┌───────────────────────┐   ┌───────────────────────┐   ┌───────────────────────┐
│       Pillar 1:       │   │       Pillar 2:       │   │       Pillar 3:       │
│   Speed & Throughput  │   │  Agentic & Code Eval  │   │  Web Vision-Language  │
│    (eval/speed.ts)    │   │    (eval/code.ts)     │   │    (eval/web.ts)      │
└───────────────────────┘   └───────────────────────┘   └───────────────────────┘
```

### Pillar 1: Speed & Latency Benchmark (`eval/speed.ts`)
- **Metrics Tracked**:
  - **TTFT (Time to First Token)**: Measures cold and warm responsiveness in milliseconds.
  - **Output Throughput (tokens/sec)**: Measures sustained generation speed.
  - **Total Latency**: Measures wall-clock turn duration across varying prompt sizes.

### Pillar 2: Agentic & Coding Capability Harness (`eval/code.ts`)
Evaluates dual wire protocols (ChatCompletions and Responses API) across a 5-stage pipeline:
1. **Stage 1 (Wire Integrity)**: Validates JSON structure, header conformity, and clean SSE stream framing.
2. **Stage 2 (Pydantic / Schema Adherence)**: Strict JSON schema enforcement for structured tool arguments.
3. **Stage 3 (Agentic Multi-Step Loop)**: Executes multi-turn tool calling and thought signature tracking.
4. **Stage 4 (Surgical Patching)**: Evaluates search-and-replace code patching accuracy without line drift.
5. **Stage 5 (Security & Prompt Injection)**: Tests guardrails against jailbreaks, delimiter escape, and credential leakage.

### Pillar 3: Web Frontend & Vision-Language Suite (`eval/web.ts`)
1. **Stage 1 (DOM & Semantic Structure)**: Evaluates semantic HTML5 hierarchies and CSS containment.
2. **Stage 2 (Responsive Layouts)**: Validates flexbox, grid, and fluid viewport scaling.
3. **Stage 3 (State & React Logic)**: Checks state transitions, hooks lifecycle, and event wiring.
4. **Stage 4 (Code Hygiene)**: Detects memory leaks, uncancelled intervals, and anti-patterns.
5. **Stage 5 (Accessibility & WCAG)**: Audits ARIA roles, contrast standards, and keyboard navigation.

### Synthesis & Report Card
The harness synthesizes results into an executive report card (`eval/reports/<model>.md`) with unbiased pass@k metrics ($k=1$) and provides an **Architectural Role Recommendation**:
- **Orchestrator**: High reasoning precision, resilient tool calling, and strict schema compliance.
- **General Coder**: Rapid patch application, strong syntax accuracy, and consistent diff generation.
- **Explorer**: High throughput and cost efficiency suited for wide-breadth discovery and summarization.

---

## 8. Directory & File Map

```
src/
├── config/
│   ├── env.ts             # Zod environment schema and configuration loader
│   ├── keys.ts            # Key pool loader and static key validator
│   ├── providers.json     # Declarative provider endpoints, headers, and conserve rules
│   └── fusion.json        # Virtual model fallback chains and models registry
├── directive/
│   ├── parser.ts          # Directive key tokenizer and grammar parser
│   └── validator.ts       # Endpoint matching rules and credential extraction
├── handlers/
│   ├── openai_compat.ts   # /v1/chat/completions route with key rotation and streaming
│   ├── anthropic_compat.ts# /v1/messages native Claude Code route
│   ├── openai_original.ts # /v1/responses native ACP route
│   ├── google_native.ts   # Google Generative Language REST forwarder and cascades
│   ├── gcp_compat.ts      # Vertex AI Gemini & Gemma router
│   └── discovery.ts       # /v1/models dynamic model enumeration
├── network/
│   ├── pool.ts            # In-memory KeyPool implementation
│   ├── cooldown.ts        # CooldownManager and Midnight UTC conserve calculation
│   ├── pacer.ts           # RequestPacer with FastFifoQueue and EMA dwell tracking
│   ├── h2_pool.ts         # Outbound HTTP/2 session pool with single-flight mutex
│   ├── circuit_breaker.ts # Provider circuit breaker and failure tracking
│   └── fetcher.ts         # Resilient HTTP fetcher with first-byte timeout
├── transformers/
│   ├── thinking.ts        # Reasoning scrubber and Google thought signature injector
│   ├── nuances.ts         # Nuance code transformers (deep, strict, compact)
│   └── payload.ts         # Gemma sanitizer and payload normalizer
└── index.ts               # Bun HTTP/2 server entrypoint and route dispatcher
```
