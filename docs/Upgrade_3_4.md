# LiteRouter Version 3.4 Architecture: Comprehensive Testing Suite & Quality Gates

## Executive Overview

Part 4 defines the complete test harness and automated verification matrix for LiteRouter v3. Rebuilt ground-up using Bun's native test runner (`bun test`) and Python integration smoke tests (`uv run pytest`), this suite covers all filtering logic, engine resilience, model transformers, protocol adapters, and diagnostic quality gates.

---

## 1. Test Suite Architecture & Directory Layout

```text
tests/
├── unit/                                  # Pure in-memory unit tests (Sub-millisecond execution)
│   ├── directive_parser.test.ts          # 2-letter key parsing, validation & 401 rejection
│   ├── auth_extractor.test.ts            # Header & Query parameter extraction waterfall
│   ├── path_resolver.test.ts             # providers.json completion path mapping
│   ├── cooldown.test.ts                  # Reason-aware TTL, Retry-After & sub-2s grace retry
│   ├── zdist.test.ts                     # Sliding window RPM & daily RPD quota counters
│   ├── fusion_sticky.test.ts             # FSE 5-minute sticky fallback & primary recovery
│   ├── thinking_transformer.test.ts      # Global stripping vs 'ts' Anthropic delta conversion
│   ├── gemma_transformer.test.ts         # System-to-user prompt mapping & turn merging
│   ├── dots_xml_transformer.test.ts      # Real-time streaming XML tool call parsing
│   ├── thought_signature.test.ts         # Google Gemini thought signature store & injection
│   └── zod_schema.test.ts                # Config validation & auto-healing schemas
│
├── integration/                           # End-to-end proxy tests with mock upstream servers
│   ├── openai_compat.test.ts             # OpenAI /v1/chat/completions full streaming cycle
│   ├── anthropic_compat.test.ts          # Claude /v1/messages <-> OpenAI bidirectional translation
│   ├── google_native.test.ts             # Google /v1beta native RPC & OpenAI-beta endpoints
│   ├── models_discovery.test.ts          # Dynamic GET /v1/models filtering per API key
│   ├── abort_propagation.test.ts         # Client disconnection & Ctrl+C signal cancellation
│   ├── ghost_response_guard.test.ts      # HTTP 200 empty body & 0-token stream detection
│   ├── stream_stall_resend.test.ts       # 30s idle timeout & seamless in-flight resend
│   ├── dual_http_h2.test.ts              # HTTP/1.1 vs HTTP/2 ALPN TLS negotiation
│   └── hard_reset_flush.test.ts          # GET /reset cache flush & key unfreeze
│
├── fixtures/                              # Mock HTTP payloads & SSE stream chunks
│   ├── mock_openai_stream.txt            # Raw OpenAI SSE chunks
│   ├── mock_anthropic_stream.txt         # Raw Anthropic content_block_delta chunks
│   ├── mock_dots_xml_stream.txt          # Raw text chunks containing <invoke> XML tags
│   └── mock_gemini_thought_sig.json      # Tool call payload containing extra_content
│
└── smoke/                                 # Fast live health checks
    └── health_probe.test.ts              # /health & /v1/models fast smoke probes
```

---

## 2. Unit Test Specifications (Derived from Docs 1, 2, 3)

### 2.1 Directive & Authentication Tests (`directive_parser.test.ts`, `auth_extractor.test.ts`)
1. **Standard 2-Letter Direct Keys**:
   - `lr-or-cl-ms-no` $\rightarrow$ `{ provider: "openrouter", payload: "cl", completion: "ms", nuances: ["no"] }`.
   - `lr-nv-oa-ch-dp` $\rightarrow$ `{ provider: "nvidia", payload: "oa", completion: "ch", nuances: ["dp"] }`.
   - `lr-gg-oa-ob-dp` $\rightarrow$ `{ provider: "google", payload: "oa", completion: "ob", nuances: ["dp"] }`.
   - `lr-zn-oa-ch-no` $\rightarrow$ `{ provider: "zen", payload: "oa", completion: "ch", nuances: ["no"] }`.
2. **Compound Nuance Composition**:
   - `lr-nv-oa-ch-dp+ts` $\rightarrow$ `nuances: ["dp", "ts"]`.
   - `lr-gg-oa-ob-dp+ts+g3` $\rightarrow$ `nuances: ["dp", "ts", "g3"]`.
3. **Fusion FSE Keys**:
   - `lr-fse-quad` $\rightarrow$ `{ type: "fusion", preset: "quad" }`.
   - `lr-fse-pydn` $\rightarrow$ `{ type: "fusion", preset: "pydn" }`.
4. **Strict Lowercase Normalization**:
   - `LR-OR-CL-MS-NO` is normalized to `lr-or-cl-ms-no`.
   - Trailing whitespace `  lr-nv-oa-ch-dp \n` is trimmed cleanly.
5. **Zero-Fallback Strict 401 Rejection**:
   - Reject missing key $\rightarrow$ `401 Unauthorized` with `code: "invalid_api_key"`.
   - Reject malformed key (`sk-openai-123`, `lr-invalid-code`, `lr-or-cl-ms`) $\rightarrow$ `401 Unauthorized`.
   - Reject unknown provider (`lr-xx-oa-ch-no`) $\rightarrow$ `401 Unauthorized`.
6. **Multi-Channel Key Extraction Waterfall**:
   - Extracts from `Authorization: Bearer <key>`.
   - Extracts from `x-api-key: <key>`.
   - Extracts from URL query parameter `?key=<key>`.
   - Extracts from URL query parameter `?api_key=<key>`.

---

### 2.2 Completion Path & Outbound Auth (`path_resolver.test.ts`)
1. **Path Resolution from `providers.json`**:
   - Resolves `(or, ch)` $\rightarrow$ `https://openrouter.ai/api/v1/chat/completions`.
   - Resolves `(or, ms)` $\rightarrow$ `https://openrouter.ai/api/v1/messages`.
   - Resolves `(gg, ob)` $\rightarrow$ `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`.
   - Resolves `(gg, gc)` with model `gemini-2.5-pro` $\rightarrow$ `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent`.
2. **Outbound Auth Transformation**:
   - OpenRouter/NVIDIA $\rightarrow$ Injects `Authorization: Bearer <VENDOR_KEY>`.
   - Anthropic Direct $\rightarrow$ Injects `x-api-key: <KEY>` and `anthropic-version: 2023-06-01`.
   - Google Native RPC $\rightarrow$ Appends `?key=<KEY>` to outgoing URL.

---

### 2.3 Key Pool Rotation & Smart Cooldown (`cooldown.test.ts`)
1. **Reason-Aware TTL Assignment**:
   - Upstream `429` $\rightarrow$ Key quarantined for `65s`.
   - Upstream `503` / `504` $\rightarrow$ Key quarantined for `10s`.
   - Upstream `401` / `403` $\rightarrow$ Key quarantined for `604,800s` (7 days).
   - Upstream `400` $\rightarrow$ Zero cooldown penalty on key.
2. **`Retry-After` Header & Body Parsing**:
   - Parses `Retry-After: 120` $\rightarrow$ Sets TTL to 120s.
   - Parses Google body `{"error": {"message": "...quotaResetDelay: 45s..."}}` $\rightarrow$ Sets TTL to 45s.
   - Clamps extreme values: `Retry-After: 1` clamped to `5s` min; `Retry-After: 999999` clamped to `7200s` max.
3. **Sub-2s Grace Retry**:
   - When upstream says retry in $\le 2\text{s}$, verifies that the engine waits and retries the **same key once** before advancing rotation index.
4. **All-Keys Exhaustion Ladder**:
   - When all keys are quarantined, verifies ladder backoff (`65s -> 90s -> 120s`) and returns `503 Service Unavailable` with `Retry-After`.

---

### 2.4 Model Constraints & Transformers (`transformers.test.ts`)
1. **Dot-Prompt (`dp`)**:
   - Empty `system` string `""` or blank message is injected with minimal `.` placeholder.
2. **Thought Signature Store (`ts`)**:
   - Tool call with `extra_content.google.thought_signature: "sig_abc123"` is stored in memory.
   - Subsequent user tool result message automatically has `"sig_abc123"` re-attached to assistant turn.
3. **Gemma Turn & Prompt Transformer (`gm`)**:
   - `system` role is converted and prepended to first `user` turn.
   - Consecutive messages `[user, user]` are merged into a single `user` turn.
   - Strips `presence_penalty`, `frequency_penalty`, `thinkingConfig`, `logit_bias`.
4. **Dots XML Function Calling (`dots_xml_transformer.test.ts`)**:
   - Streaming text containing `<invoke name="get_weather"><parameter name="city">Tokyo</parameter></invoke>` is parsed into clean OpenAI `tool_calls` delta JSON, with XML tags stripped from message text.
5. **LaTeX Normalization**:
   - Converts `\\times 10` $\rightarrow$ `× 10` and `$\\rightarrow$` $\rightarrow$ `→`.

---

### 2.5 Fusion Sticky Engine (`fusion_sticky.test.ts`)
1. **Fallback Sequence**:
   - Request with `lr-fse-quad` tests Tier 1 (OpenRouter). On 429, falls back to Tier 2 (Anthropic Direct) and succeeds.
2. **Sticky Cache Setting**:
   - Verifies `sticky_position["quad:claude-3.7-sonnet"]` is set to Tier 2 with 300s TTL.
   - Second request within 5 minutes directly executes on Tier 2 (skipping Tier 1).
3. **Sticky Expiration & Primary Recovery**:
   - After 5 minutes, next request tests Tier 1 again. If Tier 1 succeeds, sticky state is cleared back to Tier 1.

---

## 3. Integration & Network Resilience Tests

### 3.1 Network Fetcher & Ghosting Defense (`ghost_response_guard.test.ts`, `stream_stall_resend.test.ts`)
1. **First-Byte Timeout**:
   - Upstream accepts connection but sends 0 bytes for >5s $\rightarrow$ Aborts, triggers `NoResponseError`, rotates key.
2. **Ghost Response Guard (Zero Tokens)**:
   - Upstream returns HTTP 200 with empty body $\rightarrow$ Caught by `hasContentToken()`, rotates to next key.
3. **Mid-Stream Stall Recovery**:
   - Active SSE stream stalls for >30s mid-generation $\rightarrow$ Triggers in-flight reconnect/resend (`STREAM_STALL_MAX_RESENDS = 2`) on same key.
4. **Client Abort Signal Propagation**:
   - Downstream client cancels request (`req.signal.abort()`) $\rightarrow$ Upstream mock server receives instant abort signal, terminating generation.
5. **SSE Keep-Alive Heartbeat**:
   - Delays first token by 20s $\rightarrow$ Verifies LiteRouter emits `: keep-alive\n\n` comments every 15s to keep socket alive.

---

### 3.2 Dynamic Model Discovery (`models_discovery.test.ts`)
1. **Direct Key Discovery**:
   - `GET /v1/models` with `lr-or-cl-ms-no` returns OpenRouter catalog.
   - `GET /v1/models` with `lr-gg-oa-ob-dp` returns Google Gemini catalog.
2. **Fusion Key Discovery**:
   - `GET /v1/models` with `lr-fse-quad` returns the exact list of models configured under `presets.quad.models` in `fusion.json`.
3. **Google Native SDK Discovery**:
   - `GET /v1beta/models?key=lr-gg-gg-gc-no` returns Google native JSON schema.

---

### 3.3 Dual Protocol: HTTP/1.1 & HTTP/2 (`dual_http_h2.test.ts`)
1. **Plaintext HTTP/1.1**:
   - When certs are absent, serves HTTP/1.1 on port 7766.
2. **HTTP/2 TLS ALPN**:
   - When `certs/localhost.pem` exists, serves HTTP/2 multiplexed streams with ALPN negotiation.
   - Cancelling an H2 stream propagates `RST_STREAM` abort upstream.

---

### 3.4 Operational Hard Reset (`hard_reset_flush.test.ts`)
1. Quarantines multiple keys via forced 429s.
2. Calls `GET http://localhost:7766/reset`.
3. Verifies all keys are unquarantined, rotation index is 0, and rate limit counters are cleared.

---

## 4. Quality Gates & Verification Commands

All quality gates must pass before GoLive:

| Gate | Execution Command | Acceptance Criteria |
|---|---|---|
| **TypeScript Guardrail** | `bun run scripts/guardrail.ts validate <file>` | Zero AST slop, nesting depth $\le 3$, CC $\le 5$, zero swallowed catch blocks |
| **Lint & Format** | `bun run lint && uv run ruff check .` | 0 errors, 0 warnings (Biome / Ruff) |
| **Typecheck** | `bun run tsc --noEmit` | Strict type checking with 0 errors |
| **Unit Tests** | `bun test tests/unit/` | 100% tests pass (Sub-second execution) |
| **Integration Suite** | `bun test tests/integration/` | All streaming & protocol tests pass |
| **Diagnostic Doctor** | `bun run scripts/doctor.ts` | All static schemas & key pools validated |
| **E2E Smoke** | `uv run pytest tests/smoke/` | Gateway health probe returns 200 OK |
| **Full Suite** | `bun test && uv run pytest` | All test suites green, exit code 0 |

---

## 5. TypeScript Anti-Slop Guardrail (`scripts/guardrail.ts`)

Ported directly from the `baziforecaster` anti-slop pipeline, `scripts/guardrail.ts` enforces deterministic code quality across all agent edits:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    BUN TS AGENT GUARDRAIL PIPELINE                          │
│                                                                             │
│  1. Checkpoint   ──► Snapshot target file to .checkpoints/ before edit      │
│  2. [Agent Edit] ──► Edit file                                              │
│  3. Validate:                                                               │
│     ├── Gate 1: AST Nesting Depth (Depth ≤ 3)                               │
│     ├── Gate 2: Cyclomatic Complexity (CC ≤ 5)                              │
│     ├── Gate 3: Anti-Slop (No swallowed catch, no naked 'any', no TODOs)    │
│     ├── Gate 4: Typecheck (`bun run tsc --noEmit`)                          │
│     ├── Gate 5: Fast Linter (`bun run biome check <file>`)                  │
│     └── Gate 6: Sanitizer (Strip \xa0, CRLF, broken escapes)                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Guardrail CLI Commands
```bash
# Snapshot file before editing
bun run scripts/guardrail.ts checkpoint src/handlers/openai_compat.ts

# Validate file after editing (runs AST slop check, CC check, typecheck, lint, sanitization)
bun run scripts/guardrail.ts validate src/handlers/openai_compat.ts

# Inspect unified diff against pre-edit checkpoint
bun run scripts/guardrail.ts diff src/handlers/openai_compat.ts
```

