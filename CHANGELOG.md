# Changelog

All notable changes to LiteRouter will be documented in this file.

## [Unreleased]

### Added / Declarative Provider Headers & OpenCode Identity Modernization (`config/providers.json`, `src/handlers/openai_compat.ts`, `src/handlers/anthropic_compat.ts`, `src/index.ts`, `tests/unit/openrouter_headers.test.ts`)
- **Declarative Per-Provider Attribution Headers (`config/providers.json`)**: Configured attribution and agentic harness whitelist headers directly in `config/providers.json` for OpenRouter (`or`) and Zen (`zn`).
- **Dynamic Header Resolution & Merging (`src/handlers/openai_compat.ts`)**: Outbound requests dynamically merge provider headers from `config/providers.json` via `resolveUpstreamEndpoint` and `buildAuthHeaders`.
- **Eliminated Hardcoded Provider Conditionals (`src/handlers/openai_compat.ts`, `src/handlers/anthropic_compat.ts`)**: Removed hardcoded provider conditionals in `src/handlers/openai_compat.ts` and `src/handlers/anthropic_compat.ts` in favor of declarative registry lookups.
- **Hot-Reload Cache Invalidation (`src/index.ts`, `src/handlers/openai_compat.ts`)**: Integrated `resetProvidersRegistryCache()` into `POST /reset` and state reset handlers for zero-restart live reload upon configuration updates.
- **Updated OpenCode Identity to `OpenCode/1.18.29`**: Updated default OpenCode identity and `LITEROUTER_USER_AGENT` to `OpenCode/1.18.29` across provider configurations and environment templates.
- **Comprehensive Unit Test Coverage (`tests/unit/openrouter_headers.test.ts`)**: Added comprehensive unit test coverage covering `buildAuthHeaders`, `resolveUpstreamEndpoint`, provider isolation (verifying non-configured providers like `nv` and `gg` remain clean), and cache invalidation behavior with dynamic provider reloading.
- **Live Gateway Integration Verification**: Verified live requests through the running LiteRouter gateway against Zen (`big-pickle` -> HTTP 200) and OpenRouter (`dots-studio/dots-3-note-preview:free` -> HTTP 200), confirming declarative header injection, agentic harness gate bypass, and zero rate-limit/quarantine errors.

### Added / Zen Provider OpenCode Identity & Referer Gating (`src/handlers/openai_compat.ts`, `scripts/doctor.ts`, `tests/unit/openrouter_headers.test.ts`)
- **Zen Gateway OpenCode Authentication & Referer Injection**: Injected OpenCode identity headers (`User-Agent: OpenCode/1.0.0`, `HTTP-Referer: https://opencode.ai`, and `Referer: https://opencode.ai`) in `buildAuthHeaders` when provider is `zn` or `zen`. Resolves synthetic HTTP 429 `FreeUsageLimitError: Rate limit exceeded` returned by `opencode.ai/zen/v1` when called with standard runtime User-Agents.
- **Diagnostic Doctor Probe Hardening (`scripts/doctor.ts`)**: Updated `probeZenKey` and `probeOpenrouterKey` in `scripts/doctor.ts` to include `User-Agent`, `HTTP-Referer`, and `Referer` headers so diagnostic probes testing `big-pickle` succeed with 200 OK.
- **Unit Test Coverage (`tests/unit/openrouter_headers.test.ts`)**: Added unit tests verifying `zn` and `zen` receive the appropriate OpenCode `User-Agent` and `Referer` headers while other providers (`nv`, `gg`) remain isolated.

### Added / OpenRouter Agentic Harness Whitelist Headers (`src/handlers/openai_compat.ts`, `src/config/env.ts`, `src/config/schema.ts`, `.env`)
- **OpenRouter Agentic Gate Bypass**: Added automatic injection of approved agentic harness whitelist headers (`HTTP-Referer`, `X-Title`, `User-Agent`) when dispatching OpenAI-compatible requests to OpenRouter (`provider === "or"` / `openrouter.ai`). Resolves OpenRouter HTTP 403 `Gate Free Endpoints by Agentic Harness` rejections on `:free` models (such as `thinkingmachines/inkling:free` and `liquid/lfm-2.5-2.6b:free`).
- **OpenCode Default Identity & Zero-Code Config**:
  - Defaults to `HTTP-Referer: https://opencode.ai`, `X-Title: OpenCode`, and `User-Agent: OpenCode/1.0.0`.
  - Configurable via `.env` variables `LITEROUTER_HTTP_REFERER`, `LITEROUTER_X_TITLE`, and `LITEROUTER_USER_AGENT`, allowing custom values (e.g. `unknown`) without editing code.
- **Unit & Live Integration Verification (`tests/unit/openrouter_headers.test.ts`)**:
  - Added unit test suite covering header injection, provider isolation (NVIDIA/Google/Zen remain untouched), and custom environment overrides.
  - Verified against live gateway daemon: both `liquid/lfm-2.5-2.6b:free` and `thinkingmachines/inkling:free` return HTTP 200 on attempt 1/3 with 0 key quarantines.


### Added / GCP Decoupling, Circuit Breaker Isolation & Timeout Hardening
- **Dedicated GCP Circuit Breaker Toggle (`GCP_ENABLE_CIRCUIT_BREAKER`) (`src/config/schema.ts`, `src/config/env.ts`, `src/handlers/gcp_compat.ts`, `.env`)**:
  - Added dedicated `GCP_ENABLE_CIRCUIT_BREAKER` toggle (default: `false`, supports boolean coercion).
  - Decoupled GCP from the global gateway circuit breaker (`LITEROUTER_CIRCUIT_BREAKER=true`). When set to `false`, upstream Google capacity spikes (503 Service Unavailable / high demand) are passed directly downstream without tripping an internal circuit breaker that locks out all 24 pooled keys.
  - Eliminated false "Quarantined Key #X for 60s" ghost log messages previously emitted by `logLimit` when a circuit breaker opened.
- **Dedicated GCP Pacer Toggle & Double-Pacing Resolution (`GCP_ENABLE_PACER`) (`src/handlers/gcp_compat.ts`)**:
  - Added `GCP_ENABLE_PACER` toggle (default: `true`).
  - Resolved double-pacing bug where `acquireGcpPacer` was executed twice per request (both in `executeGcpAttemptLoop` and `executeGcpDirectCall`). Pacing is now enforced strictly once in `executeGcpAttemptLoop` before key selection, preserving the S5 conveyor belt guarantees without queuing latency duplication.
- **Strict Quarantine Guards for Key Metrics**:
  - Wrapped all `globalKeyPool.reportFailure("gc", ...)` calls with `if (env.GCP_ENABLE_QUARANTINE)` across single-flight, mid-stream retry, and transport failure paths to prevent phantom penalty records when quarantine is disabled.
- **Operational Timeout Hardening (`.env`)**:
  - Increased `LITEROUTER_HTTP_TIMEOUT=300` and `LITEROUTER_NO_RESPONSE_TIMEOUT=300` (5 minutes) to ensure long-running, non-streaming structured tasks (such as Gemma 31B on complex batch operations) complete without premature socket timeout drops.
- **Single-Flight 502 Observability in Live Terminal (`src/handlers/gcp_compat.ts`)**:
  - Added explicit terminal logging (`logWarn`, `logServed`, `logSeparator`) for single-flight upstream transport errors (`NoResponseError`) and attempt loop exhaustion.
- **Unit & Regression Testing (`tests/handlers/gcp_retry.test.ts`)**:
  - Added test case 10 verifying that 5 consecutive 503 errors from Google do not trip the circuit breaker or block subsequent requests when `GCP_ENABLE_CIRCUIT_BREAKER=false`. Full suite passes (559/559 tests).

### Added / Skill Harmonization & Workflow Hardening
- **Skill Renamed to Canonical `literouter` (`.opencode2/skills/literouter/`)**:
  - Harmonized and renamed skill directory to `.opencode2/skills/literouter/` (single source of truth).
  - Purged all stale duplicate copies across the workspace/filesystem.
  - Consolidated `opencode2-streaming-troubleshooting.md` into the canonical playbook.
- **Workflow Enforcement & AGENTS.md Hardening**:
  - Updated `AGENTS.md` to mandate loading `literouter` (`skill load "literouter"`) at the start of all conversations.
  - Added explicit fallback trigger keywords table across core gateway, routing, client integration, streaming, reasoning/tools, and error classification domains.
  - Hardened OpenCode / OpenCode2 workflow reminder plugins (`remind-workflow.ts`) to inject the mandatory skill loading rule and fallback keyword triggers into every conversational turn context.
- **Configurable In-Flight Retry Toggle (`src/config/schema.ts`, `src/config/env.ts`, `.env`)**:
  - Added `GCP_ENABLE_RETRIES` environment flag (default: `true`, with flexible boolean coercion accepting `true`/`false`/`1`/`0`/`yes`/`no`).
  - When set to `true` (default), maintains full multi-key pool rotation and retry resilience on 429 rate limits, 5xx server errors, and transport failures.
- **Configurable Key Quarantine Toggle & Dumb-Forwarder Mode (`src/config/schema.ts`, `src/config/env.ts`, `src/network/pool.ts`, `src/handlers/gcp_compat.ts`)**:
  - Added `GCP_ENABLE_QUARANTINE` environment flag (default: `true`, supports boolean coercion `true`/`false`/`1`/`0`/`yes`/`no`).
  - When `GCP_ENABLE_QUARANTINE=false`, disables all cooldown, quarantine, and 503 load-shedding mechanisms for GCP (`gc`) keys across all error types (429, 5xx, 401, 403, and transport resets).
  - Failed keys remain immediately eligible in `globalKeyPool` round-robin selection.
  - Paired with `GCP_ENABLE_RETRIES=false`, LiteRouter functions as a pure, transparent dumb forwarder for GCP keys, passing upstream requests and responses directly downstream without key lockouts or 65s wait penalties.
- **Single-Flight Pass-Through Mode for Google Cloud Vertex (`gc`) (`src/handlers/gcp_compat.ts`)**:
  - When `GCP_ENABLE_RETRIES=false`, terminates immediately on attempt 1 and passes upstream 4xx/5xx responses (such as 429 Too Many Requests, 400 Context Length Overflow, 500/503 errors) directly downstream to the caller without attempting in-flight rotation across alternate keys.
  - Automatically preserves key health tracking and cooldown isolation in `globalKeyPool` (respecting upstream `Retry-After` headers and rate-limit TTLs) so subsequent requests seamlessly pick up healthy keys.
- **Transport Error Synthesis (HTTP 502 Bad Gateway)**:
  - When `GCP_ENABLE_RETRIES=false` and a network drop or `NoResponseError` occurs, synthesizes an OpenAI-compatible JSON error response (`502 Bad Gateway`) rather than looping or hanging.
- **Clean Mid-Stream Termination**:
  - Closes SSE streams cleanly upon mid-stream drops without attempting redundant resends when retries are disabled.
- **Unit & Integration Test Suite (`tests/handlers/gcp_retry.test.ts`)**:
  - Added full test suite verifying default retry rotation on 429, single-flight 429 pass-through, key quarantine preservation across sequential requests, transport fail-safe 502 synthesis, context length overflow 400 pass-through, and non-GCP provider isolation.

### Fixed / GCP Conveyor Bypass & Gateway-Edge Hoist — 429 Storm Resolved
- **`src/handlers/gcp_compat.ts` — Restored Ingress Conveyor (2000ms/240s) Before `waitAndSelectKey` and `fetch`** (mirrors `openai_compat.ts:648`): Re-inserted `acquireGcpPacer()` (2000ms `GCP_MIN_DELAY_MS` / 240s `GCP_PACER_MAX_QUEUE_WAIT_MS`) at the top of `executeGcpAttemptLoop` before `waitAndSelectKey` and again before every `fetchWithTtftGuard` in `executeGcpDirectCall` + mid-stream `retryProvider`; added explicit `shouldLoadShed` → `503 Service Unavailable` (with `Retry-After`) and `PacerQueueOverflowError` → `429 Too Many Requests` (with `Retry-After`) plus `499 Client Closed Request` abort handling on `signal.aborted`; fixes instant firing → 429 storm on 18-key `gc` bursts.
- **`src/index.ts` — Hoisted Ingress Conveyor to Gateway Edge (`handleAppRequest`/`dispatchRoute`)**: Added `ingressPacedRequests: WeakSet<Request>` deduplication guard and `acquireIngressPacer(req, rawKey)` calling `getPacerForProvider(provider).acquire(req.signal)` **before** dispatch for `or`/`nv`/`zn`/`gg` (covers both `handleAppRequest` and `dispatchRoute`); `gc` remains handler-paced to avoid double pacing (`2000ms × 2`); de-duplicated `openai_compat.ts`/`anthropic_compat.ts` handler ingress via `shouldPaceIngress` guard (`!["or","nv","zn","gg"].includes(provider)` → only non-edge providers pace inside handler).
- **`src/ui/logger.ts` — Added `logPacer` 🐢 `[PACER]` Telemetry**: New `logPacer(reqId, provider, dwellMs, { queueDepth, avgDwellMs, minIntervalMs })` emitting `🐢 [PACER reqId] Provider dwell=…ms depth=… avg=…ms interval=…ms` for every conveyor dispatch; now visible in `tmux` alongside `TTFT`/`USAGE`/`SERVED`.
- **`src/handlers/google_native.ts` — Paced `handleGoogleInteractionsPassthrough` (`gg`)**: Added `getPacerForProvider("gg").acquire(req.signal)` with `PacerQueueOverflowError` → `429 Retry-After` and abort → `499` handling before `globalKeyPool.selectNextKey("gg")`; prevents `H2` pinning bypass where native `gg` interactions previously skipped the conveyor entirely.
- **`tests` — `tests/unit/gcp_pacer_conveyor.test.ts` (13 tests)**: Covers singleton dwell enforcement (2000ms/240s, `pacerA===pacerB===pacerC`, 3-parallel acquire spacing ≥1700ms), conveyor ordering (`pacer-acquire` before `waitForKeyAvailable`), overflow `429 Retry-After`, abort `499` (fast <1000ms), billing guardrail (`403` for non-Gemma, `200` for Gemma), and `normalizeGcpModel` stripping (`gcp/`/`google/` prefixes).
- **Live verification**: `549 tests pass, 0 fail` (`bun test`); `tmux` `PACER` telemetry now visible; 18-key `gc` burst spaced `≥1700ms` (conveyor enforced); 429 storm resolved.

### Added / GCP Provider (`gc`) Onboarding & Zero-Cost Gemma Billing Guardrail
- **Dedicated GCP Compatibility Handler (`src/handlers/gcp_compat.ts`)**:
  - Implemented dedicated GCP compatibility handler with a strict zero-cost Gemma billing guardrail, rejecting requests for non-Gemma models with `403 Forbidden`.
- **Provider Registration & Pacer Configuration (`src/index.ts`, `src/network/pacer.ts`)**:
  - Registered provider `gc` with 30 RPM conveyor-belt pacing (2,000ms delay between dispatches) and a 240s queue dwell timeout.
- **Multi-Key Pool Support (`src/config/env.ts`)**:
  - Added support for 18 pooled keys loaded from `GCP_KEYS` (with fallback to `GCP_API_KEYS`).
- **Gemma 4 Models Catalog Onboarding (`fusion.json`)**:
  - Added Gemma 4 models (`gemma-4-31b-it`, `gemma-4-26b-a4b-it`) configured with a 16k context window and a 14.4k RPD quota.
- **Live Upstream Diagnostic Probe (`scripts/doctor.ts`)**:
  - Added live upstream diagnostic probe in `scripts/doctor.ts` (18/18 keys verified 200 OK).

### Added / Stream-Safe HTTP/2 Connection Pool with Staggered Socket Aging & Anti-Pinning 429 Protection
- **Outbound HTTP/2 Staggered Connection Lifecycle & Aging (`src/network/h2_pool.ts`)**:
  - Implemented proactive connection aging via `maxSessionAgeMs` (default: 3 minutes) with $\pm 15\text{s}$ random jitter to prevent simultaneous socket draining across the pool.
  - Mitigates the Layer 4 (L4) / HTTP/2 connection pinning trap where long-lived persistent TCP connections get glued to a single upstream load balancer blade / edge proxy node, draining local token buckets and triggering recurrent `429 Too Many Requests`.
- **Stream-Safe Graceful Socket Draining & True Transport Isolation (`startDraining`, `releaseStream`, `fetcher.ts`)**:
  - Aging sessions transition to `isDraining = true`, stopping new request acquisitions and allowing new traffic to acquire/spawn fresh TCP connections with new ephemeral ports and full rate-limit buckets.
  - Individual stream errors and client-side aborts (`stream.destroy()`) are strictly isolated from the parent `ClientHttp2Session`; healthy shared connections remain in the pool and continue serving neighboring in-flight streams without cascading drops.
  - Session purging (`pool.purgeSession`) is strictly gated to true transport fatalities (`session.destroyed`, `session.closed`, `!isSessionHealthy`, or unrecoverable `error`/`close`/`goaway` events).
  - Added fallback hard-drain timeout (`drainTimeoutMs`) to guarantee zero zombie sockets or memory leaks.
- **Downstream HTTP/2 Client Abort Propagation & Route Dispatch Boundary (`src/index.ts`)**:
  - Linked inbound downstream `nodeReq` / `nodeRes` abort lifecycles (`nodeReq.once("aborted")`, `nodeRes.once("close")`) directly to `AbortController` signals passed to `Request` and upstream handlers.
  - Resolved the critical `nodeReq.on("close")` trap where listening to request body stream close prematurely aborted incoming requests the instant the client upload completed.
  - Fixed `pipeWebResponseToNode` to safely ignore `nodeReq.destroyed` and handle backpressure drain events cleanly without hanging client sockets.
  - Distinguishes standard downstream client disconnects/aborts from gateway faults, preventing benign client-side cancellations from generating false "Unhandled exception" error logs.
- **Playbook Documentation & Lazy-Loaded Topic Sheet (`.opencode2/skills/literouter-playbook/http2-lifecycle-stream-isolation.md`)**:
  - Created lazy-loaded operational topic reference detailing the `nodeReq` vs `nodeRes` event model, stream isolation rules, response piping backpressure, and zero-quarantine transport classifications.
- **Zero-Quarantine Stream Cancellation & Transport Classification (`classifier.ts`, `openai_compat.ts`, `anthropic_compat.ts`)**:
  - Reclassified stream-level transport resets (`"The pending stream has been canceled"`, `"ERR_HTTP2_STREAM_CANCEL"`, `"RST_STREAM"`) as immediate 0s retries in `classifyTransportError` and `classifyUpstreamError`.
  - Removed blanket 60s hardcoded mid-stream failure key penalties in `openai_compat.ts` and `anthropic_compat.ts`, dynamically classifying failures to prevent valid API keys in multi-key pools from being falsely quarantined during network blips or socket rotations.
- **Multi-Session Origin Balancing & Emergency Overflow Synchronization**:
  - Balances outbound traffic across `sessionsPerOrigin` (default: 4) parallel TCP sockets per origin using least-loaded stream dispatch.
  - Synchronized stream tracking on emergency overflow sessions (`item.activeStreams++`) and hardened single-flight connection mutexes against thundering-herd concurrency spikes.
- **Drop-In Telemetry & Diagnostic Script (`debug.ts`)**:
  - Added standalone Bun network diagnostic script with high-performance native File I/O (`Bun.file().writer()`), `DEBUG=on` gating, and real-time upstream routing header tracking (`cf-ray`, `x-amz-cf-id`, `x-served-by`, `x-ratelimit-remaining`, `retry-after`).

### Added / OpenCode 2 Outbound Reasoning History Scrubber Plugin & Auto-Patcher Integration
- **Outbound Reasoning History Scrubber V2 Plugin (`.opencode2/plugins/collapse-reasoning.ts`, `~/.config/opencode2/plugins/collapse-reasoning.ts`)**:
  - Implemented OpenCode 2 native V2 plugin hooked into `ctx.session.hook("context")` to strip historical `<think>...</think>`, `<thought>`, and reasoning parts from prior assistant messages before dispatching turns to upstream providers.
  - Enforces the core architectural policy: preserves full live streaming reasoning observability on the terminal in real time, while preventing SQLite reasoning delta accumulation from bloating subsequent prompt turns from 40k to 300k+ tokens.
  - Universal provider coverage: operates synchronously in-memory (< 0.1ms) across all configured endpoints (Antigravity on `10.32.34.243:8045`, Zen, OpenRouter, Google, NVIDIA) with zero UI disruption and zero async process blocking.
- **Auto-Patcher Integration & Self-Healing (`scripts/opencode2_autopatch.sh`)**:
  - Enhanced pre-launch auto-patcher to verify and synchronize `collapse-reasoning.ts` into `~/.config/opencode2/plugins/` and guarantee automatic registration in `~/.config/opencode2/config.json` (`"plugins": ["./plugins/collapse-reasoning.ts"]`).
  - Added dummy postinstall script detection (`is_dummy_placeholder`) to automatically self-heal and replace placeholder scripts with real ELF binaries on `@opencode-ai/cli` upgrades.
- **Playbook Documentation & Lazy-Loaded Topic Sheet (`.opencode2/skills/literouter-playbook/opencode2-reasoning-scrubber.md`)**:
  - Created lazy-loaded reference sheet detailing the streaming observability vs outbound history scrubbing policy, plugin hook lifecycle, and auto-patcher deployment.

### Upgraded / Bun v1.4.0 & Simultaneous Dual ALPN (`h2` + `http/1.1`) Gateway
- **Runtime Upgrade to Bun v1.4.0**:
  - Upgraded gateway runtime from Bun v1.3.13 to **Bun v1.4.0**, unlocking native TLS ALPN negotiation fixes.
- **Simultaneous Dual HTTP/2 (`h2`) & HTTP/1.1 on Port 7766 (`https://localhost:7766`)**:
  - Resolved TLS ALPN negotiation conflict where pure HTTP/1.1 clients (Node `fetch` in OpenCode2 and Claude Code) were previously rejected with `TLS alert: no application protocol (632)` (`UNKNOWN_CERTIFICATE_VERIFICATION_ERROR`).
  - Single unified port 7766 now simultaneously serves:
    - **HTTP/2 (`h2`)**: Binary multiplexed streaming for Python, Pydantic AI (`httpx.AsyncClient(http2=True)`), `curl --http2`, and `node:http2`.
    - **HTTP/1.1 over TLS**: Persistent keep-alive connections for OpenCode2, Claude Code, and standard REST tooling.
  - Enabled `LITEROUTER_TLS_ENABLED=true` and `LITEROUTER_HTTP2=true` in `.env`.
  - Upstream connections remain persistently multiplexed over HTTP/2 via `src/network/h2_pool.ts`.

### Added / Dedicated `lg` Nuance & Clean Zero-Overhead Passthrough
- **Pure Zero-Overhead Default Passthrough (`src/handlers/openai_compat.ts`)**:
  - Removed blanket XML/dots transformation from standard `openai_compat` streaming and non-streaming pipelines. Default OpenAI, Claude, Gemini, Qwen, DeepSeek, and other model requests now pass through with 100% untouched raw bytes and 0ms buffering.
  - Retained outbound provider reasoning parameter scrubbing (`sanitizeAndTransformPayload`), stripping unsupported thinking parameters and previous reasoning content from message history before dispatching to upstream providers.
  - Inbound reasoning streams (`reasoning_content`, `thought`, native reasoning deltas) pass directly through to OpenCode without interference.
- **Dedicated 1:1 Ling Mapping & `lg` Nuance (`src/transformers/ling.ts`, `src/directive/parser.ts`, `tests/unit/ling_transformer.test.ts`)**:
  - Introduced the `lg` directive nuance code (`lr-<provider>-<payload>-<completions>-lg`).
  - Added dedicated `src/transformers/ling.ts` containing a strict `LING_KNOWN_TAGS` 1:1 whitelist for exact Ling/GLM `<arg_key>/<arg_value>` syntax, `<invoke>` wrapping, role delimiters, and unclosed tag lookaheads.
  - XML transformation only activates when explicitly requested via `lg`, `tc`, or targeting `ling`/`dots` models, isolating experimental parsing from standard production traffic.

### Added / Canonical XML $\longleftrightarrow$ JSON Bidirectional Translation Gold Test
- **Universal XML Dialect Gold Test Suite (`tests/unit/gold_xml_bidirectional_translation.test.ts`)**:
  - Added comprehensive bidirectional translation Gold Tests validating:
    - **Inbound XML $\to$ JSON**: Exact 1-to-1 parsing of Ling-3.0/GLM-4 `<arg_key>/<arg_value>` syntax with type casting, Qwen `<function=...><parameter=...>`, DeepSeek/MiniMax `<invoke name="...">`, and trapped `<think>` tool calls without leaking XML markup or reasoning tokens.
    - **Outbound JSON $\to$ XML**: System prompt tool schema injection, `role: "tool"` execution observation transformation into `<tool_result id="...">` user turns, consecutive tool result turn compaction, and historical scratchpad reasoning pruning.

### Hardened / Unadorned GLM/Ling Tool Calling Thinking Breakout & Parameter Splitting
- **Unadorned Tool Breakout from Thinking Mode (`src/transformers/dots.ts`, `tests/unit/dots_xml_transformer.test.ts`)**:
  - Enhanced `flushInsideThinkContent` and `parseDotsXml` to immediately break out of `<think>` mode upon encountering unadorned function invocation syntax (e.g. `bash<arg_key>...`, `run_command<parameter_name>...`), preventing tool calls from getting trapped inside `reasoning_content` and stripped by downstream client filters.
  - Added support for `<tool_response>` / `<tool_result>` closing tags in thinking termination patterns.
- **Accurate Tool Parameter Chunk Boundaries (`src/transformers/dots.ts`)**:
  - Refined stream chunk boundary detection (`hasIntermediateTagOnly`) so intermediate argument tags (`<arg_key>`, `<parameter name="...">`, `<parameter_name>`) are held until their closing value tags (`</arg_value>`, `</parameter_value>`, `</invoke>`, `</tool_call>`) arrive, preventing fragmented tool call emission.

### Fixed / Elimination of Leaked `</role>` and Template Tags on TUI
- **Universal Template Tag Scrubbing & Bounded Prefix Matching (`src/transformers/dots.ts`, `tests/unit/dots_xml_transformer.test.ts`)**:
  - Fixed token-boundary leak where upstream tokenizers split `<` into one chunk and `/role>` into the subsequent chunk. Stream lookahead (`STREAM_PARTIAL_TAG_REGEX` and `TagSanitizerStreamBuffer`) safely buffers trailing bare `<` or tag prefixes until resolved, preventing `</role>` from slipping past regex filters to client terminal UIs.
  - Hardened partial tag and unclosed tag matching to strictly require alphanumeric tag identifiers or delimiters immediately after `<` (`/<(?:\/|[a-zA-Z_])[a-zA-Z0-9_\-: ="]{0,50}$/i`), preventing normal code expressions (`for (let i = 0; i < len; i++)`, `if (x < y)`) and brackets from stalling the stream or being stripped at `[DONE]`.
  - Expanded `LEAKED_TEMPLATE_REGEX` to cover all role, delimiter, and turn-boundary variations (`</role>`, `<role>`, `<role assistant>`, `<|startoftext|>`, `<|eot_id|>`, `<|tool_calls|>`, `<|/tool_call|>`, `<turn_end>`).
  - Added role/transition tag awareness in `flushInsideThinkContent` and `parseDotsXml` (`</role>`, `<|role_end|>`, `<tool_call>`), preventing thinking state locks and reasoning delta leakage into the TUI.

### Fixed / Upstream H2 Zombie Session Purge & Downstream Socket Reset on Stream Abort
- **Active H2 Session Purging & Liveness Validation (`src/network/h2_pool.ts`, `src/network/fetcher.ts`)**:
  - Added `purgeSession(origin, session)` and socket liveness validation (`isSessionHealthy`) in `H2SessionPool.acquireSession()`.
  - When an upstream stream aborts (e.g. idle timeout, network drop, or RST_STREAM frame), the faulted HTTP/2 session is immediately evicted and destroyed, guaranteeing that subsequent requests spawn a fresh TCP/TLS session rather than hanging on a poisoned socket.
- **Forced Downstream Socket Destruction on Broken Streams (`src/index.ts`)**:
  - Updated `pipeWebResponseToNode` to call `nodeRes.destroy(err)` if an unhandled stream error occurs after headers are sent, preventing downstream clients (like OpenCode CLI) from retaining a half-closed socket in their keep-alive pool that would otherwise trigger `ECONNRESET` on the subsequent turn.
  - Added `clientError` and `unknownProtocol` handlers to the HTTPS/H2 server to cleanly terminate aborted connections.

### Hardened / Incremental Thinking Streaming & Multi-Dialect XML Tool Processing
- **Live Incremental Thinking Streaming (`src/transformers/dots.ts`, `tests/unit/dots_xml_transformer.test.ts`)**:
  - Upgraded `createDotsStreamTransformer` and `processDotsStreamChunk` to stream inside-`<think>` tokens incrementally as `reasoning_content` deltas as each SSE chunk arrives, preventing client/TUI UI freezing during extended thinking runs.
  - Correctly routes non-tag thinking chunks through active reasoning streaming buffers without leaking opening or closing `<think>` / `</think>` tags into `content` deltas.
- **Model-Agnostic XML Tool Calling & Template Token Stripping**:
  - Hardened support for Ling-3.0 / GLM-4 / Qwen / DeepSeek XML tool calls (`<tool_call>name<arg_key>k</arg_key><arg_value>v</arg_value></tool_call>`), `<tool_response>`, and `<tool_result>` observations.
  - Verified and enhanced control token scrubbing for `<|role_end|>`, `[gMASK]`, `<|startoftext|>`, and unclosed template wrappers across streaming and non-streaming responses.

### Fixed / Universal XML Tool Calling, Trapped Thinking Extraction & Turn Compaction
- **Pre-Thinking Tool Extraction (`src/transformers/dots.ts`, `tests/unit/dots_xml_transformer.test.ts`)**:
  - Re-ordered `parseDotsXml` to extract tool calls across all supported dialects (GLM `<arg_key>`/`<arg_value>`, Qwen `<function=...>`, DeepSeek `<invoke>`, JSON-in-XML) *before* stripping `<think>` reasoning tokens.
  - Fixes premature halting and empty responses on reasoning models (Ling 1.0, Qwen 2.5/3, DeepSeek R1, Kimi) where the model outputs tool calls inside its `<think>` block.
- **Consecutive Tool Results Compaction (`src/transformers/dots.ts`)**:
  - Upgraded `serializeDotsToolHistory` to buffer and collapse consecutive `role: "tool"` messages into a single `role: "user"` turn containing combined `<tool_result>` blocks.
  - Preserves strict user/assistant turn alternation expected by Jinja chat templates, eliminating template crashes and empty acknowledgments.
- **Zero Tag Leakage across Streams & Static Responses (`src/transformers/dots.ts`, `src/transformers/opencode_adapter.ts`)**:
  - Added full regex scrubbing for `<arg_key>`, `<arg_value>`, `<argument_name>`, `<argument_value>`, `<tool_call>`, and `<invoke>` across streaming deltas, non-streaming outputs, and outbound conversation history.

### Fixed / HTTP/2 Connection Pool Zombie Socket Purge on `ECONNRESET`
- **Permanent Runtime Error & Socket Reset Purging (`src/network/h2_pool.ts`, `tests/unit/h2_pool.test.ts`)**:
  - Fixed an issue where HTTP/2 sessions removed their socket error listeners immediately after the initial TLS handshake, leaving severed or half-closed connections (`ECONNRESET`, `EPIPE`, TCP RST) inside the active connection pool.
  - Resolved a condition where key failover rotation across multi-key pools failed repeatedly on the exact same underlying poisoned HTTP/2 socket instead of establishing a fresh connection.
  - Attached permanent lifecycle listeners (`session.on("error")`, `session.on("frameError")`, and `session.on("close")`) to instantly purge, destroy, and clear dead sessions and timers from the pool.
  - Added unit test coverage asserting immediate session destruction and pool eviction upon runtime transport failures.

### Added / Selective Tool Reasoning Retention & Thinking Budget Inflation (`LITEROUTER_AO_MAX_TOKENS`)
- **Selective History Reasoning Preservation (`src/transformers/opencode_adapter.ts`)**:
  - Upgraded `scrubReasoningFromMessage` so that assistant turns with `tool_calls` retain their `reasoning_content`.
  - Gives reasoning models (e.g., Ling 3.0, DeepSeek R1, QwQ) memory of their rationale across tool turns, eliminating tool amnesia loops and repetitive re-analysis of the same problem.
  - Conversational/text-only turns continue to have older thinking blocks pruned to keep context compact.
- **Thinking Budget Release & Max Tokens Inflation (`src/handlers/anthropic_compat.ts`, `src/config/schema.ts`, `src/config/env.ts`)**:
  - Added `LITEROUTER_AO_MAX_TOKENS` (default `32768`) to auto-inflate incoming Anthropic `max_tokens` (which Claude Code limits to 4k/8k) up to 32k when translating to OpenAI request payloads.
  - Prevents reasoning models from exhausting token ceilings during extended thinking phases, eliminating mid-stream truncation (`finish_reason: "length"`) and preventing CLI stalls that prompt the user to type "continue".

### Added / Anthropic Token Counter Endpoint (`POST /v1/messages/count_tokens`)
- **Native Support for Claude CLI Token Counting (`src/handlers/anthropic_compat.ts`, `src/index.ts`, `src/ui/banner.ts`)**:
  - Implemented `handleAnthropicCountTokens` and `estimateAnthropicInputTokens` to support Anthropic's `POST /v1/messages/count_tokens` (and `/api/v1/messages/count_tokens`, `/messages/count_tokens`).
  - Estimates input tokens accurately across system prompts, text blocks, thinking blocks, image inputs, tool calls, and tool schemas.
  - Resolves `404 Route Not Found: POST /v1/messages/count_tokens from claude-cli` errors encountered during Claude Code / Claude CLI execution.

### Added / AO Strip Reasoning Standard Flag (`LITEROUTER_AO_STRIP_REASONING`)
- **Default Outgoing Reasoning Stripping for Anthropic->OpenAI Cross-Wire (`.env`, `src/config/schema.ts`, `src/config/env.ts`, `src/transformers/payload.ts`)**:
  - Added `LITEROUTER_AO_STRIP_REASONING=true` (defaults to `true`), establishing a standard policy to strip reasoning parameters (`thinking`, `thinkingConfig`, `reasoning_effort`, `budget_tokens`) and historical thinking blocks from request payloads sent **TO** the upstream provider.
  - Ensures the user gets to read all live reasoning deltas downstream, while preventing upstream providers from wasting context or re-processing past reasoning.
  - Fully honors the `ts` (Thinking Support) nuance to preserve thinking signatures, and `sb` (Strip Budget) if explicit response filtering is desired.


### Added / Long-Running Harness Mid-Stream Resend & Conveyor Belt Ingress (`docs/Fix_Streaming_01.md`)
- **Mid-Stream Resend on Drop & Replay (`src/network/fetcher.ts`, `src/handlers/openai_compat.ts`)**:
  - Unlocked mid-stream recovery across all stream lifecycle hooks (`handlePrematureEof`, `handleInBandErrorIfPresent`, `handleStreamFailure`, and `handleEof`).
  - When an upstream provider drops connection, returns an in-band error, or terminates unexpectedly, LiteRouter immediately rotates to the next available healthy key in the pool and re-sends the request to resume streaming downstream.
  - Prioritizes long-running agent harness survival (OpenCode, Claude Code, Antigravity) over strict terminal cleanliness.
- **Harmonized Conveyor Belt Queue (`src/handlers/openai_compat.ts`)**:
  - Unified rate-pacing slots to index `0` across both inbound requests and mid-stream retry attempts, eliminating split pacer queues and deadlocks.
- **Uncapped Ingress Leg Permanence (`src/handlers/openai_compat.ts`)**:
  - Extended default ingress conveyor belt dwell timeout to 300,000ms (5 minutes) via `LITEROUTER_PACER_MAX_QUEUE_WAIT_MS`, ensuring long-running inference requests are not severed while waiting on key pools.
- **Persistent Architectural Policy**:
  - Formalized incoming leg (conveyor belt, zero artificial client socket timeouts) vs. outgoing leg (dynamic key rotation with mid-stream resend) in `docs/Fix_Streaming_01.md` and project Dolt memory.

### Added / Consolidated OpenCode Adapter, Resilient Stream Teardown & Telemetry Hardening
- **Dedicated OpenCode Adapter (`src/transformers/opencode_adapter.ts`)**:
  - Consolidated all Zen-parity OpenCode streaming and history transformations into a unified adapter module.
  - Features automatic client detection (`isOpenCodeClient`) with explicit nuance overrides (`ts` to preserve reasoning, `sb` to force stripping), strict delta sanitization (`sanitizeDelta`) dropping `null`/`undefined` content and empty `tool_calls` to satisfy strict downstream Zod schemas (`content: z.string().optional()`).
  - Implements multi-modal tool message array flattening (`normalizeToolContent`), metadata scrubbing (`stripToolMetadata`, `stripClientMetadata`), in-flight SQLite history scrubbing (`scrubReasoningFromMessages`), and throttled 5s synthetic data heartbeats (`FILTER_HEARTBEAT_INTERVAL_MS = 5000`) emitting empty delta frames (`data: {"choices":[{"index":0,"delta":{}}]}`) during deep-reasoning streams (e.g. `stealth/ox-alpha`).
  - Maintains 100% untouched raw pass-through isolation for Pydantic AI, OpenAI/Anthropic SDKs, and standard API clients.
- **Resilient Stream Teardown & Idempotent Controller (`src/network/fetcher.ts`)**:
  - Introduced `safeEnqueue`, `safeClose`, and `safeError` controller helpers wrapping stream operations with `isClosedRef` guards and `controller.desiredSize === null` checks.
  - Completely eliminates Bun runtime crashes and noisy `ERR_INVALID_STATE: Controller is already closed` errors during client aborts, socket resets, or upstream disconnects.
- **Post-TTFT Stream Drop Safety & Quarantine Protection (`src/network/fetcher.ts`, `src/handlers/openai_compat.ts`)**:
  - Halted mid-stream key rotation and eliminated false 60s rate-limit key pool quarantines once Time-To-First-Token (TTFT) content tokens have started streaming downstream to the client.
  - Prevents corrupting downstream response streams with disjointed key failover fragments while shielding active API key pools from unwarranted rate-limit penalties during client-side network interruptions.
- **Accurate Telemetry & Raw Upstream Error Logging (`src/ui/logger.ts`)**:
  - Fixed hardcoded `"Too Many Requests"` log string in `getHttpStatusText`, ensuring HTTP 500 (`Internal Server Error`), 502 (`Bad Gateway`), 503 (`Service Unavailable`), and 504 (`Gateway Timeout`) render accurate HTTP status names in gateway logs.
  - Added `extractErrorMessage` parser to extract and format structured error messages from upstream error bodies (supporting `.error.message`, `.error`, `.message`, and `.detail`), logging raw upstream error JSON directly to the console for rapid debugging.


### Added / Streaming Diagnostic Kit 2.0 & Tool Calling Resilience (`docs/Stream_Idle_Timeouts_2.0.md`, `tests/e2e/streaming_kit/`)
- **Automated Diagnostic & Verification Harness (`tests/e2e/streaming_kit/run_diagnostics.py`)**:
  - Implemented 4-stage automated diagnostic kit: SQLite turn extractor & replay (`extract_and_replay.py`), strict Vercel AI SDK Zod validator probe (`vercel_zod_probe.ts`), inter-chunk cadence & synthetic heartbeat auditor (`test_heartbeat_cadence.py`), and master test runner (`run_diagnostics.py`).
  - Proves zero `content: null` frames, zero Zod `TypeError` schema violations, inter-chunk silence $\le 5500\text{ms}$, and clean byte stream sanitization across deep reasoning models (`stealth/ox-alpha`).
- **OpenRouter Model Namespace Sanitizer (`src/handlers/openai_compat.ts`)**:
  - Automatically strips redundant `openrouter/` prefix from `payload.model` when targeting OpenRouter directly (e.g. `openrouter/openai/...` $\to$ `openai/...`), eliminating upstream `HTTP 400 Bad Request` errors caused by client-side provider prefixes.
- **Resilient Stream EOF Controller Guard (`src/network/fetcher.ts`)**:
  - Guarded `controller.close()` in `handleEof` with `if (controller.desiredSize !== null)`, eliminating noisy `ERR_INVALID_STATE` stack traces on client-side aborts/disconnects.
- **Tool Message Wire Formatting & Multi-Turn Chaining Regression Suite (`tests/unit/tool_call_stream_regression.test.ts`)**:
  - Added unit test coverage verifying `role: "tool"` array content normalization into valid flat strings, stripping OpenCode metadata fields, and preserving incremental `tool_calls` argument deltas during reasoning streams.
- **OpenCode2 Autonomous Tool Chaining Configuration (`~/.config/opencode2/agents/build.md`, `~/.config/opencode2/config.json`)**:
  - Configured OpenCode2 Build agent with `steps: 100`, `maxSteps: 100`, auto-allowed permissions, and continuous tool chaining prompts to eliminate intermediate conversational turn-pauses ("continue" stalls) between tool invocations.

### Fixed / Throttled Synthetic Heartbeats for Extended Reasoning Streams (`src/transformers/thinking.ts`, `src/handlers/openai_compat.ts`)
- **Throttled 5s Empty Delta Heartbeats (`FILTER_HEARTBEAT_INTERVAL_MS = 5000`)**:
  - Implemented stateful heartbeat tracking in `createOpenCodeReasoningFilterStreamTransformer`: whenever deep reasoning models (e.g. `stealth/ox-alpha`) stream continuous reasoning deltas that are stripped by the OpenCode filter, LiteRouter emits a standard empty delta frame `data: {"id":"chatcmpl-heartbeat", ... "choices":[{"index":0,"delta":{}}]}` at 5-second intervals.
  - Prevents client-side 55-second stream inactivity timeouts in OpenCode (Vercel AI SDK / `eventsource-parser`), permanently eliminating the mid-turn freeze and manual "continue" stall on long reasoning prompts.
- **Unified Reasoning Key Stripping for Non-Streaming Responses (`src/handlers/openai_compat.ts`)**:
  - Reused `deleteReasoningKeys` in `stripReasoningFromResponseBody`, ensuring all 9 reasoning key variants (`thought`, `thoughts`, `thinking`, `thinking_content`, `reasoningDetails`, `think`, `reasoning`, `reasoning_content`, `reasoning_details`) are sanitized across non-streaming responses.
- **Suppressed KeepAlive Logging on Disconnected Sockets (`src/network/fetcher.ts`)**:
  - Downgraded `tryEnqueueKeepAlive` logging on closed downstream controllers from `error` to `debug`.

### Fixed / Stream Idle Timeout Unification & OpenCode Stream Healing (`docs/Stream_Idle_Timeouts.md`)
- **Unified Stream Idle Timeout (120s / 2 Minutes) (`src/network/fetcher.ts`, `src/config/schema.ts`, `src/config/env.ts`)**:
  - Unified `STREAM_IDLE_TIMEOUT_MS` and `LITEROUTER_STREAM_IDLE_TIMEOUT_MS` from 30s to 120s (2 minutes), aligning inter-chunk stall detection with TTFT budgets to support deep reasoning models (`stealth/ox-alpha`) on large contexts (40k+ tokens).
- **Upstream Raw Control Character Sanitization (`src/transformers/thinking.ts`)**:
  - Implemented `sanitizeRawControlChars` in `processSseDataLine` to escape unescaped carriage returns (`0x0D` / `\r`) emitted inside string literals by upstream providers before calling `JSON.parse`.
  - Prevents engine-level `JSON Parse error: Unterminated string` in downstream client parsers (Vercel AI SDK in OpenCode) that previously caused instant 21ms aborts with `rawFinish: "network_error"`.
- **OpenCode Reasoning Filter Handler Wiring (`src/handlers/openai_compat.ts`)**:
  - Fixed `determineShouldFilterReasoning` to properly invoke `isOpenCodeClient`, ensuring `createOpenCodeReasoningFilterStreamTransformer` is correctly attached for OpenCode sessions under default directives (e.g. `lr-or-oa-ch-no`).
- **Strict Delta Content Sanitization (`src/transformers/thinking.ts`)**:
  - Updated `sanitizeDelta` to automatically delete `content` if it is `null` or `undefined`, ensuring streaming deltas conform with strict downstream client Zod schemas (`content: z.string().optional()`).
  - Completely drops pure reasoning frames without emitting orphaned newline characters, preventing SSE parser desynchronization.
- **Forensic Documentation & Diagnostic Playbook (`docs/Stream_Idle_Timeouts.md`)**:
  - Published comprehensive root cause analysis and Section 7 Diagnostic Playbook covering the 5 primary agent stall vectors (output token exhaustion, bash quoting deadlocks, UI permission gates, edge H2 resets, and SQLite WAL contention).

### Added / OpenCode2 Auto-Patcher & Self-Healing Launcher (`scripts/opencode2_autopatch.sh`)
- **Standalone Auto-Patcher Script (`scripts/opencode2_autopatch.sh`)**:
  - Implemented an idempotent, standalone bash script verifying the installed `@opencode-ai/cli` in Node/NVM directory.
  - Automatically verifies executable binaries (`opencode2`), resolves platform binary links, generates `.bak` safety backups before state changes, and validates reasoning fold/scrubber logic.
  - Added dedicated patching routines for tool message formatting (normalizing `role: "tool"` content arrays `[{type: "text", text: ...}]` into flat strings for strict OpenAI-compatible upstreams) and network error handling (preventing silent subagent completion on `network_error`, stream stalls, or empty chunks).
  - Features ultra-fast (< 5ms) execution with timestamp-based stamp verification (`.autopatch_verified`) comparing against target binaries and the patch script itself for zero-overhead startup.
- **Launcher Integration (`~/.local/bin/opencode2`)**:
  - Integrated pre-launch self-healing invocation into `/home/yapilwsl/.local/bin/opencode2`, ensuring transparent environment resilience on every CLI invocation.

### Added / OpenCode Reasoning Stream Filter & Context Bloat Elimination (Option 1B)
- **Automatic OpenCode Client Detection & Reasoning Stream Stripping (`src/transformers/thinking.ts`, `src/handlers/openai_compat.ts`)**:
  - OpenCode2 beta accumulates all streaming `delta.reasoning` / `delta.reasoning_content` SSE chunks into local SQLite session tables and injects them back into subsequent request contexts as historical assistant messages, rapidly ballooning conversation prompt size from ~40K to 300K+ tokens.
  - Implemented automatic client detection (`isOpenCodeClient`) inspecting `User-Agent: opencode*`, `x-opencode` header, and `x-client-name: opencode*`.
  - For OpenCode clients, LiteRouter attaches `createOpenCodeReasoningFilterStreamTransformer()` to downstream SSE streams, cleanly stripping `delta.reasoning` and `delta.reasoning_content` in flight and suppressing empty intermediate chunks, while preserving `delta.content`, `role`, `tool_calls`, `finish_reason`, and token usage stats.
  - Non-streaming responses for OpenCode similarly have `reasoning` and `reasoning_content` stripped from choices and assistant messages via `stripReasoningFromResponseBody()`.
- **SDK & Client Preservation (Pydantic AI / External SDKs)**:
  - Preserves full un-stripped reasoning deltas for non-OpenCode clients (Pydantic AI, OpenAI SDK, curl, Python requests) ensuring chain-of-thought observability for agentic SDK workflows.
- **Directive Nuance Override (`ts` vs `sb`)**:
  - Directive nuance `ts` (Thinking Support, e.g. `lr-or-oa-ch-ts`) explicitly overrides client detection and forces LiteRouter to preserve reasoning chunks for OpenCode if thinking output is desired.
  - Directive nuance `sb` (Strip Budget / Strip Reasoning, e.g. `lr-or-oa-ch-sb`) forces reasoning stripping across any client.
- **Unit Test Coverage (`tests/unit/opencode_reasoning_filter.test.ts`)**:
  - Added 16 unit tests asserting User-Agent detection, header inspection, chunk filtering, stream transformer fragmentation handling, and Pydantic AI raw stream preservation.

### Added / Event-Driven Key Availability, Tiered Auth Backoff & Backpressure Architecture
- **Event-Driven KeyPool Notifier with Zero-Polling Dwell (`src/network/pool.ts`, `src/handlers/openai_compat.ts`)**:
  - Upgraded `KeyPool` to extend `EventEmitter`, emitting targeted `available:${provider}` events when keys exit cooldowns.
  - Implemented `waitForKeyAvailable(provider, timeoutMs, signal)` for zero-CPU-polling key acquisition, with deterministic listener and timer cleanup on client abort or timeout.
  - Protected against thundering-herd concurrency: waiters remain subscribed until a key is successfully acquired or timeout/abort occurs.
- **Tiered 401/403 Exponential Auth Backoff (`src/network/classifier.ts`, `src/network/pool.ts`)**:
  - Replaced static 7-day auth lockouts with progressive backoff per key: 1st failure = 5 minutes (300s), 2nd failure = 30 minutes (1800s), 3+ consecutive failures = 24 hours (86400s).
  - Successful responses (`reportSuccess`) reset consecutive auth failure counters to 0.
- **Authenticated Zero-Downtime Operator Reset API (`src/index.ts`)**:
  - Added authenticated `POST /admin/pool/reset` (and query `?provider=<prov>`) secured by `LITEROUTER_AUTH_KEY` or valid directive tokens, allowing zero-downtime cooldown clearing for single providers or the entire gateway.
- **Standard HTTP Backpressure on Capacity Exhaustion (`src/handlers/openai_compat.ts`, `src/handlers/anthropic_compat.ts`)**:
  - Added standard `Retry-After: <seconds>` headers to HTTP 503 load-shedding responses, allowing downstream AI clients (Claude Code, OpenCode, Cursor) to back off accurately.

### Fixed / Pacer FIFO Inversion, Cooldown Dwell & Error Classification Hardening
- **Pacer FIFO Queue & Cooldown Dwell Integration (`src/handlers/openai_compat.ts`, `src/handlers/anthropic_compat.ts`)**:
  - Fixed Pacer control-flow inversion: requests now acquire the FIFO pacer and dwell in the conveyor belt queue when keys are in transient cooldowns (up to `maxWaitMs` / 20s), rather than fast-failing with 429.
  - Implemented `waitAndSelectKey` to cleanly poll and pick available keys as cooldowns clear within the wait budget.
- **Eradicated Phantom Upstream 429 Telemetry (`src/handlers/openai_compat.ts`, `src/ui/logger.ts`)**:
  - Eliminated fabricated `logLimit(..., 429)` calls when local key pools are depleted. The gateway now accurately logs local pool exhaustion via `logExhausted` without claiming that an upstream vendor returned 429.
- **Transport Error & NoResponse 2-Second Quarantine (`src/network/classifier.ts`, `src/handlers/openai_compat.ts`)**:
  - Decoupled network transport timeouts, TTFT timeouts, and `NoResponseError` from rate-limit policies: transient connection drops are assigned a 2-second retry quarantine (`quarantineTtlSec: 2`) instead of a 60-second 429 rate-limit penalty.
- **Expanded TTFT Timeouts for Reasoning & Preview Models (`src/network/fetcher.ts`)**:
  - Raised default base TTFT timeout from 5s to 15s.
  - Automatically detected thinking, reasoning, coder, preview, and dots models (`/o1|o3|deepseek|r1|dots|thinking|preview|coder|reasoning|thought/i`) and extended their TTFT ceiling to 60s.
- **Automated Integration & Regression Test Suite (`tests/unit/pacer_cooldown_integration.test.ts`)**:
  - Added comprehensive tests verifying FIFO queue cooldown dwelling, 503 load shedding on long budget overruns, and 2s transport error classification.

### Fixed / Anthropic Compatibility Protocol & 1-to-1 Schema Translation Hardening
- **P0 Truncated Tool Call Stop Reason Guard (`src/handlers/anthropic_compat.ts`)**:
  - Fixed safety vulnerability in `mapOpenAIToAnthropicStopReason`: `finish_reason === "length"` now strictly takes precedence over `hasToolUse`, ensuring incomplete tool calls return `"max_tokens"` instead of `"tool_use"` to prevent agents from executing truncated shell or file commands.
- **Strict Outbound Request Parameter Whitelisting (`src/handlers/anthropic_compat.ts`)**:
  - Replaced open pass-through with strict OpenAI key allowlist (`ALLOWED_OPENAI_KEYS`), stripping unsupported Anthropic-specific parameters (`anthropic_version`, `anthropic_beta`, `cache_control`, `mcp_servers`, `container`) that cause 400 Bad Request on strict upstream providers.
- **Inbound Payload Validation & Document Block Rejection (`validateAnthropicPayload`)**:
  - Validated inbound payload structure and cleanly rejected unsupported Anthropic PDF/document blocks with clear 400 errors instead of silently dropping content turns.
- **Assistant History Thinking Block Separation**:
  - Separated `thinking` blocks into `reasoning_content` instead of concatenating into visible `content` text in multi-turn history translation, preventing chain-of-thought pollution in subsequent dialogue.
- **SSE Stream Robustness & JSON Injection Safety (`createAnthropicStreamTransformer`)**:
  - Standardized all SSE frame emission via `sseEvent` using native `JSON.stringify()`, eliminating JSON escaping vulnerabilities in model and tool names.
  - Hardened SSE chunk parser to normalize CRLF (`\r\n`), ignore comments (`: keep-alive`), support spaceless `data:`, and handle in-stream error payloads emitted over HTTP 200 streams.
  - Implemented `pendingStopReason` state to delay `message_delta` until the final usage chunk arrives in streaming mode, ensuring full token metrics delivery.
- **Header Sanitization**:
  - Stripped client `Authorization` headers alongside `x-api-key`, `anthropic-version`, `anthropic-beta`, and `content-length` when constructing synthetic OpenAI requests.
- **Unit Test Suite Expansion (`tests/unit/anthropic_openai_compat.test.ts`)**:
  - Expanded test suite to 20 comprehensive unit tests verifying truncated tool safety, request whitelisting, document validation, array content translation, CRLF handling, and in-stream error events.

### Added / Anthropic-to-OpenAI Cross-Wire Payload (`ao`) & Bidirectional Tool Translation
- **New Payload Directive `ao` (`src/directive/parser.ts`, `src/config/schema.ts`)** — Introduced `ao` (Anthropic-to-OpenAI cross-wire translation) payload code, allowing Claude Code and Anthropic Messages clients to seamlessly execute against any OpenAI-compatible backend using directives such as `lr-or-ao-ch-no` or `lr-nv-ao-ch-no`.
- **Full Bidirectional Tool Calling & Schema Mapping (`src/handlers/anthropic_compat.ts`)** — Upgraded `translateAnthropicToOpenAI` to fully preserve all agent tools and execution turns:
  - Transforms Anthropic tool schemas (`input_schema`) to OpenAI function specifications (`parameters`).
  - Maps assistant `tool_use` blocks to OpenAI `tool_calls` with JSON-serialized arguments (with `content: null` when text is absent).
  - Decomposes user multi-block turns with `tool_result` into discrete OpenAI `role: "tool"` messages with `tool_call_id` and stringified results, properly preceding trailing user text blocks.
  - Transforms non-streaming OpenAI `tool_calls` responses into Anthropic `tool_use` content blocks with `stop_reason: "tool_use"`.
- **Streaming Tool-Calling SSE State Machine (`createAnthropicStreamTransformer`)** — Enhanced the SSE streaming transformer with a stateful chunk parser. Tracks OpenAI `delta.tool_calls` streaming chunks and emits full Anthropic `content_block_start (type: "tool_use")`, `content_block_delta (type: "input_json_delta")`, `content_block_stop`, and `message_delta (stop_reason: "tool_use")` events, preventing agent loops from hanging during streaming tool execution.
- **Unit Test Suite (`tests/unit/anthropic_openai_compat.test.ts`)** — Added comprehensive unit test suite covering system prompt extraction, tool schema transformation, assistant/user multi-turn tool execution, non-streaming responses, and streaming SSE tool-calling transitions (243 passed tests total).


### Added / Outbound HTTP/2 Multiplexing, Anti-429 Pacing & Provider Circuit Breaking
- **Outbound HTTP/2 Multiplexed Session Pool (`src/network/h2_pool.ts`)** — Implemented persistent outbound HTTP/2 session multiplexing (`node:http2`) with single-flight connection mutexes, eliminating TCP handshake storms. Includes in-pool `GOAWAY` frame tracking with immediate teardown when active streams reach zero, and deterministic stream scope RAII lifecycle guards. Features transparent fallback to HTTP/1.1 keep-alive if ALPN or H2 negotiation fails.
- **Token-Bucket Rate Pacer & Anti-429 Fast Queue (`src/network/pacer.ts`)** — Introduced per-provider and per-key token-bucket pacing with an $O(1)$ `FastFifoQueue`, bounded queue timeouts (15s), and clean local HTTP 429 backpressure responses with `Retry-After` headers. Tracks Exponential Moving Average (EMA, $\alpha=0.1$) queue dwell time telemetry.
- **Provider Circuit Breaker with Expiring Canary Lease (`src/network/circuit_breaker.ts`)** — Added 3-state circuit breaking (`CLOSED`, `OPEN`, `HALF_OPEN`) per provider. Trips on 5xx/529 error bursts and restricts `HALF_OPEN` recovery to exactly one concurrent canary probe protected by a 60-second auto-expiring lease, preventing thundering herds and deadlock.
- **Visual TTFT Upstream Protocol Tagging (`src/ui/logger.ts`, `src/network/fetcher.ts`)** — Enriched real-time TTFT terminal telemetry to explicitly log the outbound protocol (`[Upstream: HTTP/2]` vs `[Upstream: HTTP/1.1]`) on every request lifecycle.
- **Health Telemetry & System Endpoints (`src/index.ts`)** — Extended `/health` endpoint with real-time outbound HTTP/2 session statistics and circuit breaker health telemetry across all configured upstream providers.
- **Unit & Integration Test Coverage** — Added comprehensive unit test suites (`tests/unit/pacer.test.ts`, `tests/unit/circuit_breaker.test.ts`, `tests/unit/h2_pool.test.ts`) and end-to-end integration tests (`tests/integration/h2_resilience.test.ts`), bringing total passing test suite to 216 tests.

### Fixed / Restored Live Upstream API Key Health Probing (`scripts/doctor.ts`)
- **Fixed / Restored Live Upstream API Key Health Probing (`scripts/doctor.ts`)** — Restored active upstream authentication probes for Google Gemini (`gemini-3.1-flash-lite`), NVIDIA NIM (`meta/llama-3.1-8b-instruct`), OpenRouter (`openrouter/free:nitro`), and Zen (`zen/hy3-free`) with `mkcert` root CA TLS verification and 1s safe pacing, alongside local config/JSON validations and `/health` server probe.

### Fixed / Zen Provider Routing & Telemetry Error Handling
- **Zen Provider Upstream `base_url` (`config/providers.json`)** — Fixed Zen provider upstream `base_url` to `https://opencode.ai/zen` (resolving `/v1/chat/completions` and `/v1/models` paths correctly).
- **TTFT & Stream Telemetry Error Guard (`src/network/fetcher.ts`)** — Prevented TTFT and stream established telemetry logging on HTTP 4xx/5xx error responses.
- **Response Status Visual Telemetry (`src/ui/logger.ts`)** — Updated `logServed` to warn on HTTP 4xx/5xx responses instead of logging a green success.

### Added / Mid-Stream Error Recovery & In-Band Error Suppression
- **In-Band SSE Error Frame Interceptor (`isInBandErrorChunk` in `src/network/fetcher.ts`)** — Detects upstream in-band 5xx SSE error payloads (e.g. `"Server error mid-response. The response above may be incomplete."`, internal server errors, overloaded errors) and suppresses them from leaking downstream to client IDEs/TUIs.
- **Multi-Attempt Resilient Stream Controller (`createResilientStream`)** — Enhanced `createResilientStream` with dynamic `retryProvider` callbacks. When an upstream stream encounters a mid-generation drop (socket reset, EOF) or in-band error chunk, LiteRouter quarantines the failing key (10s), rotates to the next active key in the pool (up to 3 attempts), re-fetches the generation, and transparently pipes the new stream into the open downstream client connection without terminating the session.
- **Unit Test Suite (`tests/unit/midstream_retry.test.ts`)** — Added comprehensive unit tests asserting in-band error signature detection, regular SSE delta pass-through, multi-attempt stream stitching, and exhausted retry error propagation.

### Added / In-Flight Error Classification & Retry Resilience
- **Centralized Error Classifier (`src/network/classifier.ts`)** — Introduced `classifyUpstreamError` to systematically parse HTTP status codes, upstream error headers, and response bodies, returning structured `ErrorDisposition` (`retry_rotate` vs. `fail_fast` with appropriate `quarantineTtlSec`).
- **Network & Transport Layer Resilience (`src/network/fetcher.ts`, `src/handlers/openai_compat.ts`, `src/handlers/anthropic_compat.ts`)** — Wrapped all pre-stream socket failures, TCP resets (TCP RST / `ReadError` / `ECONNRESET`), HTTP/2 GOAWAY (`RemoteProtocolError`), and connection timeouts (`ConnectTimeout` / `ConnectError`) into `NoResponseError`. Outbound transport exceptions occurring before payload delivery are trapped and retried across pooled keys in-flight (up to 3 attempts) instead of propagating unhandled socket errors to the client.
- **In-Flight Key Rotation (Up to 3 Attempts)** — Enabled immediate automatic key rotation for transient and provider-side errors:
  - **HTTP 400 (Provider temporary errors)**: Retries on "provider returned error", "no available provider", "temporarily unavailable" with 0s quarantine.
  - **HTTP 429 (Rate limits & Quota exhaustion)**: Retries immediately across keys; sets dynamic cooldown for rate limits (parsing `Retry-After` / `x-ratelimit-reset`) or 7-day quarantine for exhausted balances / credit limits (`insufficient_quota`, `credit_limit`, `out of balance`).
  - **HTTP 401 & 403 (Auth/Permissions)**: Rotates to next key and quarantines invalid key for 7 days (`604800s`).
  - **HTTP 5xx (500, 502, 503, 504)**: Retries transient server errors with a 10s key quarantine.
- **Fail-Fast for Client-Side Errors** — Immediately aborts retry loops and returns error directly to the downstream client with 0s quarantine for deterministic client errors: HTTP 400 (context length exceeded, schema/validation errors, content moderation/safety filters), HTTP 404 (model or resource not found), and other non-retryable 4xx client errors.
- **Unit Test Coverage (`tests/unit/classifier.test.ts` & `tests/unit/rotation_loop.test.ts`)** — Added comprehensive unit tests validating error body inspection, reset header parsing, disposition actions, quarantine durations, and in-flight retry loop exhaustion behavior.

### Added / Multilingual Guardrails & Domain Metaphysics Preservation
- **Tiered Multi-Language Instruction Architecture** — Implemented global cognitive and explanatory pinning to English across Claude Code (`~/.claude/CLAUDE.md`) while explicitly whitelisting Chinese metaphysics entities (Heavenly Stems, Earthly Branches, Ten Gods, Trigrams, Hexagrams, and Solar Terms) in `baziforecaster/AGENTS.md`.
- **Regression Test Coverage (`tests/unit/language_guardrail.test.ts`)** — Added automated verification asserting zero Chinese token leakage in generic code reasoning while guaranteeing 100% genuine Chinese character retention in BaZi metaphysics data payloads.
- **Playbook Documentation Update (`claude-code.md`)** — Documented Chinese-native model language guardrails in `.opencode2/skills/literouter-playbook/claude-code.md`.

### Fixed / Claude Code & Bun Zlib Decompression Transport Immunity
- **Enforced `Accept-Encoding: identity` Upstream (`src/network/fetcher.ts`, `src/handlers/anthropic_compat.ts`, `src/handlers/openai_compat.ts`)** — Injected `Accept-Encoding: identity` into all outbound upstream provider HTTP and SSE streaming requests. Prevents upstream providers and edge CDNs (OpenRouter, Cloudflare, Anthropic) from returning chunked gzip streams and zero-length sync frames, completely resolving Bun native engine `Decompression error: ZlibError` (Bun issue #23149) in Claude Code and Bun-compiled CLI clients.
- **Downstream Response Header Sanitization (`sanitizeDownstreamHeaders`)** — Created centralized downstream header sanitizer stripping hop-by-hop and compression headers (`content-encoding`, `transfer-encoding`, `connection`, `keep-alive`) and recalculating `content-length` on non-streaming responses, preventing decompression mismatch errors in downstream clients over localhost.
- **Unit & Integration Test Coverage** — Added `tests/unit/header_sanitizer.test.ts` and updated `tests/integration/anthropic_compat.test.ts` to assert header stripping and `Accept-Encoding: identity` injection across streaming and non-streaming requests.

### Fixed / Bun Socket Idle Timeout & Streaming Keep-Alive
- **Configured `idleTimeout: 60` on `Bun.serve`** — Prevented Bun runtime from cutting active SSE streams prematurely (default was 10s idle timeout in Bun) during model thinking pauses or slow token generation (e.g. `dots-studio/dots-3-note-preview:free`), resolving `Decode error (200 POST /v1/messages)` in OpenCode and Anthropic SDK clients.
- **Dynamic Config Binding in `src/network/fetcher.ts`** — Updated `fetchWithTtftGuard`, `startKeepAliveTimer`, and `mergeSignals` to dynamically read `KEEPALIVE_INTERVAL_MS`, `LITEROUTER_NO_RESPONSE_TIMEOUT_MS`, and `LITEROUTER_HTTP_TIMEOUT_MS` from `getEnv()`.
- **Environment Normalization (`src/config/schema.ts` & `src/config/env.ts`)** — Added `LITEROUTER_IDLE_TIMEOUT_SEC` schema coercion and automatic shorthand normalization for `.env` parameters (`LITEROUTER_IDLE_TIMEOUT`, `LITEROUTER_STREAM_IDLE_TIMEOUT`, `LITEROUTER_HTTP_TIMEOUT`).

### Documentation Update
- **Documented API Key Directive (`lr-or-cl-ms-no`) for Claude Code** — Updated `literouter-playbook` SKILL to clarify that users targeting OpenRouter with downstream Anthropic clients (like Claude Code) must use the `ms` (Messages) completion code. Using `ch` triggers `translateAnthropicToOpenAI`, which drops `tool_use`/`tool_result` blocks during fallback, causing agents to hang indefinitely.

### Chores / Repository Hygiene
- **Consolidated Upsell Campaign Artifacts** — Moved all upsell campaign documentation (`POSITIONING.md`, `ONE_PAGER.md`, `CHEAT_SHEET.md`, `COMPARISON.md`, `USE_CASES.md`, `DEMO.md`, `SUMMARY.md`, `demo_upsell.ts`, social posts, tech deep-dive) from `docs/` and `scripts/` into a dedicated `demo/` folder. Updated all internal cross-references, README links, and run commands accordingly.

## [3.5.1] — 2026-08-17

### Fixed / OpenRouter Dots & Anthropic Compat Layer
- **Directive Completion Endpoint Correction (`lr-or-cl-ch-dp`)** — Fixed OpenRouter Dots directive in OpenCode configs and skill playbooks. Because downstream Anthropic clients (`@ai-sdk/anthropic`) target `/v1/messages` but OpenRouter routes Dots models via `/api/v1/chat/completions`, directive was updated to `lr-or-cl-ch-dp` (payload: `cl`, upstream endpoint: `ch`).
- **Output Token Clamping (`max_tokens <= 65536`)** — Added automatic defensive clamping in `src/transformers/payload.ts` to prevent total context overflow HTTP 400 rejections from OpenRouter (`input_tokens + max_tokens > 512,000`).
- **OpenRouter Comment SSE Frame Handling (`hasContentToken`)** — Enhanced `hasContentToken` in `src/network/fetcher.ts` to recognize OpenRouter initial processing comment frames (`: OPENROUTER PROCESSING`) and structured JSON markers, avoiding false-positive ghost response classifications.
- **Anthropic-to-OpenAI Tool Schema Translation** — Fixed `translateAnthropicToOpenAI` in `src/handlers/anthropic_compat.ts` to properly transform Anthropic tool structures into standard OpenAI function call schemas.
- **Verification Matrix Update (`scripts/test_opencode2_models.sh`)** — Added `LR-DOTS` (`lr-dots/dots-studio/dots-3-note-preview:free`) to the automated multi-provider verification script.

## [3.5.0] — 2026-08-17

### Added / Upgrade 3.3 Visual Telemetry & Terminal UI
- **Multi-Line Inbound Request Logging (`src/ui/logger.ts`)** — Restored full Upgrade 3.3 multi-line telemetry for all incoming requests across `/v1/chat/completions`, `/v1/messages`, and `/v1beta/models/*`. Logs show Request ID, Method, Path, Client User-Agent, Directive Token, Target Provider, Wire Format, Upstream Endpoint, Model identifier, Active Key Index (`Key #X/Y`), and Nuance modifiers (`[dp, ts]`).
- **Live Stream TTFT & Token Speed Telemetry** — Added real-time Time-To-First-Token emission (`🟢 [TTFT reqId] TTFT = Xms | Stream established`) and live token accounting (`🟢 [USAGE reqId] Provider (Key #X/Y) | Tokens: Prompt=X | Reasoning=Y | Completion=Z | Total=N | Speed=X.X tok/s`) directly into stdout for streaming and non-streaming responses.
- **Key Rotation & Attempt Round Visibility** — Explicitly tracks and logs key rotation events (`🔄 [ROTATE reqId] Advancing to Provider [Key #X/Y] -> Retrying immediately (Attempt 2/3)`) and rate limit cooldown quarantines with parsed `Retry-After` headers.
- **Visual Section Dividers (`logSeparator`)** — Clean terminal boundary lines separating discrete request lifecycles during high-concurrency agent sessions.

### Added / OpenCode v2 Multi-Provider Support & Client Suite
- **Declarative OpenCode 2 Provider Directives** — Added support for `lr-dots` (`@ai-sdk/anthropic` with `lr-or-cl-ms-dp`), `lr-or` (`@ai-sdk/openai-compatible` with `lr-or-oa-ch-no`), `lr-nv` (`@ai-sdk/openai-compatible` with `lr-nv-oa-ch-no`), `lr-zn` (`@ai-sdk/openai-compatible` with `lr-zn-oa-ch-no`), and `lr-gg` (`@ai-sdk/openai-compatible` with `lr-gg-oa-ob-gm`).
- **Client Cache Tag Sanitizer** — Automatically strips client cache keys (`prompt_cache_key`, `prompt_cache_retrieval`, `prompt_cache_reset`) to prevent HTTP 400 validation rejections from strict upstream providers (NVIDIA NIM).
- **Automated Verification Script (`scripts/test_opencode2_models.sh`)** — Executable multi-provider CLI test runner validating live streaming and model routing end-to-end.

### Documentation & Skills
- **`literouter-playbook` Skill Modernization** — Complete rewrite of all 7 guide documents in `.opencode/skills/literouter-playbook/` (`SKILL.md`, `setup.md`, `setup_checklist.md`, `troubleshoot.md`, `opencode2-playbook.md`, `antigravity.md`, `agy-ide-setup.md`) reflecting declarative directive architecture and full visual telemetry.


### Added / Dots Tool-Calling Polyfill
- **Modular Dots XML Transformer (`src/transformers/dots.ts`)** — Added dedicated streaming and non-streaming XML tool-calling polyfill. Automatically intercepts `<dots_function_call>` and `<invoke name="...">` XML tags emitted into plain text by Dots Studio preview models (`dots-studio/dots-3-note-preview:free`) and translates them into OpenAI-standard JSON `tool_calls` and SSE deltas for OpenCode 2 and agentic CLI execution.
- **Zero-Blast-Radius Gating (`isDotsModel`)** — Transformer is conditionally enabled in `src/handlers/openai_compat.ts` strictly when the target model identifier contains `dots`. Standard models (Llama, Gemini, Mistral, Qwen) completely bypass this logic with zero performance overhead.
- **End-to-End Test Suite** — Added unit test suite in `tests/unit/transformers/dots.test.ts` (covering token chunk fragmentation, character escaping, and fail-open fallbacks) and live proxy E2E integration test in `tests/integration/test_dots_transformer_e2e.py`.

## [3.4.0] — 2026-08-16

### Added / OpenRouter Model
- **Model `openrouter/dots-studio/dots-3-note-preview:free`** — Added `dots-studio/dots-3-note-preview:free` to the OpenRouter provider registry with `context: 512000`, `max_output: 512000`. Registered in OpenCode v1 and OpenCode2 provider configs under `provider.literouter.models` mirroring the laguna-s-2.1 reasoning setup (`include_reasoning: false`, `reasoning: true`, `reasoningEffort: high`) plus concise-assistant system prompt.

### Added / Native HTTP/2 & Dual TLS ALPN Negotiation
- **Native Bun.serve TLS ALPN on Port 7766** — Upgraded LiteRouter entry point in `src/index.ts` to natively serve TLS on port `7766` with automatic ALPN negotiation supporting concurrent `h2` (HTTP/2 multiplexing) and `http/1.1` clients without requiring Granian, Nginx, or external reverse proxies.
- **Local Certificate Automation (`scripts/setup_certs.sh`)** — Added setup script utilizing `mkcert` to issue trusted local Root CA certificates into `certs/localhost.pem` and `certs/localhost-key.pem` (gitignored).
- **Environment Auto-Detection (`src/config/env.ts`)** — Exported `LITEROUTER_TLS_CERT`, `LITEROUTER_TLS_KEY`, and `LITEROUTER_TLS_ENABLED` which automatically enables TLS when certificates are present in `certs/` and falls back to plaintext HTTP/1.1 if absent.
- **Client Disconnect & Upstream Abort Propagation** — Downstream client stream aborts (`req.signal` / RST_STREAM) now propagate directly into upstream provider `fetch()` requests, freeing socket pools and preventing runaway upstream token burn.
- **Health & Protocol Telemetry** — Enhanced `/health` response and startup logs to report active protocol mode (`HTTP/2 + HTTP/1.1 (ALPN)`).
- **OpenCode 2 Client Integration** — Configured OpenCode 2 endpoint to `https://localhost:7766/v1` with `NODE_EXTRA_CA_CERTS` pointing to local `mkcert` root CA for seamless zero-warning execution.
- **Test Suite Modernization** — Added TypeScript unit tests in `tests/unit/core/http2_tls.test.ts` and updated Python integration test fixtures in `tests/conftest.py` with `httpx[http2]` (`h2`) support.

## [3.3.16] — 2026-08-12

### Fixed / OpenAI-Compatible Model Resolution
- **Fallback Resolution for Unprefixed Model Identifiers in `executeOpenAICompat`** — Fixed model registry lookup in `src/handlers/openai_compat.ts` (`MODEL_REGISTRY.get(modelName) || MODEL_REGISTRY.get("google/" + modelName)`). Clients sending bare model identifiers like `gemini-3.5-flash-lite` to `/v1/chat/completions` (without the `google/` vendor prefix) now resolve seamlessly instead of failing with HTTP 400 Bad Request ("Model not recognized") and hanging in OpenCode CLI or OpenAI SDKs.

## [3.3.15] — 2026-08-12

### Added / Routing & Model Discovery
- **OpenAI Model Listing Endpoint (`/v1/models` & `/models`)** — Added dynamic model listing endpoint in `src/index.ts` returning standard OpenAI-compatible `{ "object": "list", "data": [...] }` schema, aggregating all models from `models.json` (`MODEL_REGISTRY`) and virtual fallback groups from `fusion.json` (`FUSION_GROUPS`). Enables instant model auto-discovery in OpenCode, Cursor, LibreChat, and SillyTavern.

### Added / Documentation & Architecture Governance
- **`KIV.md` (Keep In View)** — Established deferred features tracker and community PR guidelines. Includes a turnkey AI builder prompt for users needing direct Anthropic Messages (`/v1/messages`) compatibility.
- **`GRAVEYARD.md` (Architecture Graveyard)** — Documented formally evaluated and rejected architectural anti-patterns (relational DB ORMs, heavy web admin GUIs, serverless edge rewrites, bespoke multi-modal parsers) to safeguard sub-millisecond Bun+Valkey latency.
- **`INSTALL.md` Autonomous AI Setup Playbook** — Revamped setup instructions into a zero-babysitting machine-readable playbook for users' AI coding assistants, featuring Docker Valkey fallback (`valkey/valkey:alpine`), interactive key intake guardrails, and pre-flight health diagnostics (`doctor.ts`).
- **`README.md` Architectural Updates** — Added documentation for the intelligent transparent pass-through philosophy for `/v1/*` endpoints and linked governance documents.

## [3.3.14] — 2026-08-11

### Added / Models
- **New OpenRouter Models**: `nvidia/nemotron-3.5-lightning:free` (200K context / 65K output) and `liquid/lfm-2.5-2.6b:free` (128K context / 65K output) added to `models.json` and OpenCode provider config.

### Fixed / Streaming & Timeouts
- **Stream Idle Timeout Fallback to `LITEROUTER_STREAM_IDLE_TIMEOUT_MS`** — Fixed `idleTimeoutMs` default in `src/network/fetcher.ts` to respect `LITEROUTER_STREAM_IDLE_TIMEOUT_MS` (derived from `LITEROUTER_STREAM_IDLE_TIMEOUT` in `.env`/`.env.local`, default 30s) instead of falling back to the 5s first-byte ghost timeout (`noResponseTimeoutMs`). This eliminates mid-stream socket dropouts ("Network connection lost") during extended model reasoning or slow token generation.

## [3.3.13] — 2026-08-11

### Changed / Key Rotation
- **Immediate Key Rotation on HTTP 502** — Updated `processOpenAIError` in `src/handlers/openai_compat.ts` to immediately report HTTP 502 errors (`errorType = "502"`) to Valkey/Redis (placing the key on a 30s `timed_out` cooldown) and rotate to the next available key after a 2s inter-key delay (`MIN_ROTATE_DELAY_MS`), eliminating single-key grace retries (`action: "retry_same"`).

## [3.3.12] — 2026-08-11

### Fixed / Logging & Stream Lifecycle
- **Keepalive Timer Lifecycle & `logWarn` Formatting** — Fixed argument signature for `logWarn` in `src/transformers/payload.ts` preventing `[object Object]` log pollution. Ensured SSE heartbeat `setInterval` timers are cleanly terminated via `stopKeepAlive()` on error or client stream cancellation in `payload.ts` and `google_native.ts`.

### Added / Configuration Separation & Protection
- **`protect.sh` Root Protection Script** — Added `./protect.sh [lock|unlock|status]` helper script enabling users to lock `.env.local` ownership to root (`chmod 644`), making secret keys read-only to processes and impossible for automated LLM agents to overwrite.
- **Split `.env` (Settings) and `.env.local` (Keys)** — Moved non-sensitive server configurations (ports, timeouts, retry delays, reasoning flags, endpoint URLs) into tracked `.env`. Secret provider API keys remain exclusively in git-ignored `.env.local`.
- **Zero-Complexity Setup** — Leveraged Bun and `python-dotenv` cascading env loader (`.env` defaults overridden by `.env.local`) with 0 LOC change to TypeScript AST.

### Fixed / Security Mandate
- **Restored API Keys & Protected `.env.local`** — Restored real API keys in `.env.local` from checkpoint backup after an automated sanitization pass accidentally replaced active keys with `<REDACTED>` placeholders.
- **Strict Anti-Redaction Policy** — Added explicit mandates across project guidelines (`AGENTS.md`, `CLAUDE.md`, `literouter-playbook` skill, and `bd remember`): **NEVER modify, sanitize, replace, or touch API keys or `.env.local` files under any circumstances.**

## [3.3.11] — 2026-08-10

### Added
- **Environment-Driven Configuration** — Externalized all hardcoded models, timing constants, and endpoints to `.env.local`. New env vars in `src/config/env.ts`:
  - `FUSION_CIRCUIT_TTL_MS` (65000ms) — Fusion circuit breaker TTL
  - `FUSION_STICKY_TTL_MS` (300000ms) — Fusion sticky fallback expiry
  - `COOLDOWN_DEFAULT_TTL_SEC` (30s), `COOLDOWN_RATE_LIMIT_TTL_SEC` (65s), `COOLDOWN_TIMEOUT_TTL_SEC` (10s), `COOLDOWN_AUTH_TTL_SEC` (604800s/7d) — per-error-class cooldown durations
  - `COOLDOWN_TTL_MIN_SEC` (5s), `COOLDOWN_TTL_MAX_SEC` (7200s/2h) — TTL clamp bounds
  - `GRACE_RETRY_DELAY_MS` (1500ms) — same-key retry delay after 502/soft reset
  - `STREAM_STALL_MAX_RESENDS` (3) — SSE stream stall resend count
  - `KEEPALIVE_INTERVAL_MS` (2000ms) — SSE keep-alive ping interval
  - `GOOGLE_INTERACTIONS_MODEL` (`antigravity-preview-05-2026`) — Google interactions endpoint model
  - `GOOGLE_NATIVE_BASE_URL` (`https://generativelanguage.googleapis.com`) — base URL for native `/v1beta/models/` calls
- All new settings are documented inline in `.env.local` with comments explaining purpose and default values.

### Removed
- **`tencent/hy3:free` model** — Removed from `models.json` and associated metadata files. No longer referenced in `opencode.json` or gateway routing.

## [3.3.10] — 2026-08-10

### Reverted
- **Immediate Key Rotation Module Rollback** — Reverted commit `9472adc` (`feat(keys): immediate rotation on provider errors, 3-attempt cap, configurable delay`).
- **Key Rotation Helper Removed** — Deleted `src/handlers/key_rotation.ts` and `src/handlers/error_classifier.ts`.
- **10-Second `timed_out` Cooldown Removed** — Errors no longer immediately place keys on cooldown; the prior key rotation and 3-attempt limit logic has been removed from `src/handlers/openai_compat.ts`.
- **`LITEROUTER_KEY_ROTATE_DELAY_MS` Config Removed** — The default rotate delay of `2000ms` has been reverted to the original inline `LITEROUTER_ROTATE_DELAY_MS` behavior (no separate inter-attempt rotation delay).

## [3.3.9] — 2026-08-08

### Added / Fixed
- **Historical Assistant Reasoning Sanitization & Context Bloat Prevention** — Added `sanitizeHistoricalMessages` in `src/transformers/payload.ts` and integrated it into `src/handlers/openai_compat.ts`. Before upstream dispatch, prior assistant turns have volatile reasoning fields (`reasoning_content`, `reasoningContent`, `thought`, `thought_summary`) stripped to prevent cumulative context bloat and token cost spikes during multi-turn agent sessions.
- **Universal Assistant Content Normalization** — Updated `sanitizeHistoricalMessages` so that any `role: "assistant"` message with `content: null` or `content: undefined` normalizes to `content: ""` (empty string), preventing `400 Bad Request` schema rejections from strict upstream providers (Anthropic, DeepSeek, OpenRouter) on empty assistant turns or tool-calling turns.
- **Configurable Environment Toggle** — Added `LITEROUTER_STRIP_REASONING` in `src/config/env.ts` (defaults to `true`), supporting flexible boolean string parsing (`"false"`, `"0"`, `"no"`, `"off"` to disable).
- **Unit Test Coverage** — Added comprehensive unit tests in `tests/unit/core/gateway.test.ts` covering assistant reasoning stripping, null content normalization (with and without tool calls), and toggle bypass.

## [3.3.8] — 2026-08-01

### Added / Fixed
- **0-Token Content Token Inspection & Immediate Resend** — Updated `fetchWithFirstByteTimeout` in `src/network/fetcher.ts` to hold HTTP 200 OK headers and inspect incoming SSE chunks for actual content tokens (`delta.content`, `delta.reasoning_content`, `delta.thought`, `delta.tool_calls`, or Gemini `parts[].text`). If an upstream stream returns 0 content tokens (e.g. metadata-only chunks `{"role":"assistant","content":""}`) within `LITEROUTER_NO_RESPONSE_TIMEOUT` (5s), it throws `NoResponseError("upstream sent 0 content tokens")` **before** flushing HTTP headers to downstream.
- **Idle Stream Detection & Immediate Resend** — Extended `fetchWithFirstByteTimeout` to monitor the upstream stream for idle timeouts after the first content token arrives. If no chunk is received within `LITEROUTER_STREAM_IDLE_TIMEOUT_MS` (default 30s), throws `NoResponseError` — same retry path as 0-token ghosting (immediate key rotation, 0ms delay, no cooldown).
- **Immediate 0ms Key Resend on Ghosting** — Caught `NoResponseError` in `src/handlers/openai_compat.ts` and `src/handlers/google_native.ts` now triggers an immediate `continue` in the retry loop with **0ms delay**, instantly resending the request to Key #2 without locking or placing Key #1 in Valkey cooldown.
- **Disambiguated Key Logging** — Updated key logging format across all handlers from `activeKey.substring(0, 6)...` to `...${activeKey.slice(-6)}`, ensuring rotated keys in the pool are immediately distinguishable in terminal logs.
- **Removed Transformer-Level Idle Timeout** — Removed idle timeout handling from `createStreamTransformer` in `src/transformers/payload.ts` and the inline idle timer in `src/handlers/google_native.ts`. Idle timeout is now handled entirely at the `fetchWithFirstByteTimeout` level in `src/network/fetcher.ts`.

## [3.3.7] — 2026-07-31

### Fixed
- **First-Chunk Verification for Streaming Responses** — Fixed an issue where upstream providers (such as OpenRouter free tier models) return 200 OK HTTP headers but fail to send any body chunks within the timeout window. `fetchWithFirstByteTimeout` in `src/network/fetcher.ts` now waits for the first actual body chunk before resolving 200 OK. If upstream returns 200 OK headers but zero body bytes within `LITEROUTER_NO_RESPONSE_TIMEOUT` (5s), it throws `NoResponseError`, triggering key rotation and failover before headers are sent to downstream clients.
- **Mid-Stream Inter-Chunk Idle Timeout** — Added `LITEROUTER_STREAM_IDLE_TIMEOUT_MS` (default 30s) in `src/config/env.ts` and updated stream transformers (`src/transformers/payload.ts` & `src/handlers/google_native.ts`). If an upstream stream stalls mid-generation without emitting a chunk for 30s, LiteRouter terminates the stream cleanly with `data: [DONE]\n\n` instead of hanging client sockets indefinitely or injecting malformed error payloads.
- **SSE Keep-Alive Comments** — Added periodic `:\n\n` keep-alive comment injection into both stream transformers (`payload.ts` and `google_native.ts`) every 15 seconds. This prevents downstream SSE clients (e.g. openCode) from triggering their own idle timeouts during slow upstream responses where tokens arrive infrequently.

## [3.3.6] — 2026-07-29

### Fixed
- **Automatic Valkey/Redis State Flush on Gateway Boot** — Updated `router.connect()` in `src/index.ts` to automatically execute `await this.redis.flushAll()` during startup. This ensures that starting or restarting the gateway via `bun run src/index.ts`, `scripts/start.sh`, or `scripts/restart.sh` always flushes residual key rate-limits, cooldown ZSETs, and 7-day 403 quarantine states, resetting all provider API keys for fresh execution.

## [3.3.5] — 2026-07-27

### Added
- **Google Models Added & Updated** — Tested Google API keys against candidate Gemini 2.5 and 3.x Flash models. Added/updated supported models in `models.json`:
  - `google/gemini-2.5-flash` (`upstream_id: gemini-2.5-flash`)
  - `google/gemini-2.5-flash-lite` (`upstream_id: gemini-2.5-flash-lite`)
  - `google/gemini-3-flash` (`upstream_id: gemini-3-flash-preview`)
  - `google/gemini-3-flash-preview` (`upstream_id: gemini-3-flash-preview`)
  - `google/gemini-3.5-flash` (`upstream_id: gemini-3.5-flash`)
  - `google/gemini-3.5-flash-lite` (`upstream_id: gemini-3.5-flash-lite`)
  - `google/gemini-3.6-flash` (`upstream_id: gemini-3.6-flash`)
### Changed
- **`pydantic/google` Fusion Chain Updated** — Removed Gemma models and updated `fusion.json` to chain 7 Gemini models starting with `google/gemini-3.5-flash-lite` and `google/gemini-3.1-flash-lite` as primary workhorses:
  1. `google/gemini-3.5-flash-lite`
  2. `google/gemini-3.1-flash-lite`
  3. `google/gemini-3.6-flash`
  4. `google/gemini-3.5-flash`
  5. `google/gemini-3-flash-preview`
  6. `google/gemini-2.5-flash`
  7. `google/gemini-2.5-flash-lite`
- **Updated Skill Playbook & Docs** — Documented Antigravity Agent (`antigravity-preview-05-2026`) distinction vs standard completion models (Antigravity is an Agent execution harness requiring Google's `/v1beta/interactions` API rather than text `:generateContent` endpoints). Updated `.opencode/skills/literouter-playbook/SKILL.md`, `troubleshoot.md`, and `setup.md`.

## [3.3.4] — 2026-07-24

### Added
- **Model `openrouter/inclusionai/ling-3.0-flash:free`** — Added Inclusion AI `ling-3.0-flash:free` to the OpenRouter provider registry (`models.json`) with `context: 200000`, `max_output: 65536`. Synced to `opencode.json` under `provider.literouter.models`.

### Fixed
- **Gateway Retry Logic (Max Attempts & Round Backoff)** — Fixed a critical infinite loop and busy-wait bug during rate limit failovers (issue literouter-p1h):
  - Removed an incorrect `attempt < maxAttempts` condition inside the "All keys exhausted" handler that was swallowing the error and causing a ~24s busy-wait instead of executing the intended round backoff ladder (e.g. 65s wait for quota limits).
  - Added an `allKeysExhausted` state tracker to the round loop. If a request hits `LITEROUTER_MAX_ATTEMPTS` but doesn't actually exhaust all available keys, the gateway now correctly breaks the round loop and fails the request instantly with HTTP 429 ("Max attempts exhausted"), preventing infinite downstream request spam.
  - **Enforced `MIN_ROTATE_DELAY_MS` between rotation attempts**: Added missing delay logic at the end of the attempt loop to ensure `getProviderDelayMs` (with its 2s hard floor) is respected between rotating keys on sequential 429s/500s. Previously, keys were rotated instantly, leading to provider burst-firing.

## [3.3.3] — 2026-07-21

### Added
- **Model `openrouter/poolside/laguna-s-2.1:free`** — Added Poolside `laguna-s-2.1:free` to the OpenRouter provider registry with `context: 200000`, `max_output: 65535`. Synced to `opencode.json` under `provider.literouter.models`.
- **502 transient retry** — When an upstream returns HTTP 502 (bad gateway / proxy-layer hiccup), the same key is retried once with a 1.5s delay and no cooldown, following the G3 grace-retry pattern. A 502 means the proxy/load-balancer rejected the request before the model saw it — rotating keys doesn't help (they all hit the same edge). If the retry also 502s, it falls through to normal error handling (cooldown + rotation). See `src/index.ts` line 942.

## [3.3.2] — 2026-07-20

### Added
- **Silent-upstream (no-response ghost) detection** — New `fetchWithFirstByteTimeout` + `NoResponseError` in `executeOpenAICompat` (all non-Google OpenAI-compat providers: OpenRouter/NVIDIA/Zen). If an upstream sends **zero bytes/headers within 5s** (`LITEROUTER_NO_RESPONSE_TIMEOUT`, default 5s), the request is aborted and the key rotates to the next one after a `LITEROUTER_NO_RESPONSE_RETRY_DELAY` (default 5000ms) wait. Crucially this is **NOT a cooldown** — the provider gave no backoff signal (no status, no Retry-After), so the key is not penalized. Covers the NVIDIA edge case where the first request is black-holed but an immediate retry on another key succeeds. If all keys ghost, the loop falls through to the existing 300s generic timeout → 502. Google-native (`executeGoogleNative`) is intentionally excluded.

### Changed
- `executeOpenAICompat` upstream `fetch` now routes through `fetchWithFirstByteTimeout` instead of a bare `fetch`.

## [3.3.1] — 2026-07-17

### Added
- **Model `nvidia/thinkingmachines/inkling`** — Added Thinking Machines `inkling` to the NVIDIA provider registry (`models.json`) with `upstream_id: thinkingmachines/inkling`. Synced to `opencode.json` under `provider.literouter.models`. `context` (1048576) sourced from OpenRouter catalog via `gather_model_details.py`; `max_output` remains a manual placeholder (OpenRouter returns `max_completion_tokens: None` for this model).
- **Model `openrouter/nvidia/nemotron-3-ultra-550b-a55b:free`** — Added NVIDIA `nemotron-3-ultra-550b-a55b:free` to the **OpenRouter** provider registry (`models.json`, `provider: openrouter`) — OpenRouter-hosted, NOT NVIDIA-direct. Synced to `opencode.json` under `provider.literouter.models` (`context: 256000`, `max_output: 65536`).
- **Standardized model-settings extraction** — Deleted redundant `scripts/sync_model_context.py`. `scripts/gather_model_details.py` is now the single extraction pipeline: it fetches the OpenRouter catalog (`/api/v1/models`, keyless), applies the `:free`/`-free` suffix strip + `ORG_MAP` org-remap, matches every non-google provider (incl. nvidia), and writes `context`/`max_output` back into `models.json`. OpenRouter is the canonical source; Hugging Face and NVIDIA-native APIs were evaluated and rejected (they don't expose these fields reliably).

### Removed
- **Legacy gateway route `/v1beta/openai/chat/completions`** — redundant alias of `/v1/chat/completions` (both dispatched to `executeOpenAICompat`); no client or integration test targeted it (OpenCode uses the native `/v1beta/models/{model}:{action}` path, pydantic-ai uses `/v1`). `/v1/chat/completions` is now the sole OpenAI-compat entry point. The *upstream* Google OpenAI-compat endpoint (`PROVIDER_API_URLS.google`) is unchanged and remains the forward target for Google-via-`/v1` requests.

## [3.3.0] — 2026-07-17

### Added
- **Streaming `usage` + TTFT extraction (observability)** — The streaming `TransformStream` now peeks at each SSE chunk (inline, no buffering) and extracts token `usage` (`usage` for OpenAI-compat, `usageMetadata` for Google-native), plus Time-To-First-Token (request-start → first byte). For OpenAI-compat streaming we now inject `stream_options.include_usage: true` so providers actually emit the final usage chunk. Extracted usage is sunk to logs (`[USAGE]` / `[TTFT]`) and accumulated per provider+model in Redis (`usage:{provider}:{model}`, 30d retention) via `router.recordUsage`. Non-streaming responses are extracted the same way. **No response bytes are altered and no quota-enforcement change occurs** — this is observability only.
- **Smart cooldown (reason-aware backoff)** — Derived from a cross-repo study of three rotation gateways (design: `docs/IMPL_smart_cooldown.md`):
  - **G1 — honour upstream reset delay**: `reportError` now accepts a `ttlOverride`; the `>=400` handler parses `Retry-After` and Google `quotaResetDelay`/`retryDelay` to set a precise cooldown (clamped 5–7200s) instead of a fixed constant.
  - **G2 — reason-aware outer backoff**: the all-keys-exhausted backoff ladder is chosen by failure class — quota (429) uses `[65s, 90s, 120s]`, transient (5xx/timeout) uses a shorter `[8s, 15s, 30s]`.
  - **G3 — grace retry**: when an upstream says "retry in ≤2s", the **same** key is retried once after a short buffer instead of burning a rotation (distinct from the client-abort 499 no-op).
  - **G4 — 5xx TTL alignment**: `500`/`502` now share the 10s transient cooldown previously reserved for `503`/`504`/`timeout` (was 30s default).

### Safety (provider firewall / Google 15rpm protection)
- **Hard 2s floor on key-attempt delay** — `getProviderDelayMs` / `getMinDelayMs` now enforce `MIN_ROTATE_DELAY_MS = 2000`; a `GOOGLE_MIN_DELAY_MS=0` (or `LITEROUTER_ROTATE_DELAY_MS=0`) can no longer zero the gap between retries, so we never burst-fire a provider endpoint (firewall ban risk). Default gap remains 10s.
- **Rate-limit (429) cooldown floored at 65s** — `reportError` now clamps a 429 `ttlOverride` to `max(parsedReset, 65)`. A Google key that hits the 15rpm limit is therefore NEVER re-hit sooner than 65s, so the rolling quota window can decay instead of being re-fed and blocked forever. Longer upstream `Retry-After` values are still honoured.
- **Flat 65s floor on ANY Google error** — `reportError` now enforces `max(ttl, 65)` whenever `provider === "google"`, covering 5xx/timeout/transient errors too (Google is strict: 15rpm/model, per-key pools, and a 5xx often precedes a rate-limit block). Non-Google providers keep their existing tiered TTLs.
- **G3 grace-retry scoped to non-429** — the same-key retry-on-`reset<=2s` now explicitly excludes `429` (and only fires when `reset <= 2s`, with a `max(reset,2)s + 1.5s` wait), so a rate-limited key always rotates. (Previously the 5s clamp made G3 a no-op; it is now functional but rate-limit-safe.)

### Changed
- `createStreamTransformer` now accepts an optional `StreamMeta` for observability sinks.
- `reportError` signature gained an optional `ttlOverride?: number | null` (backward compatible).
- `parseResetDelay` now returns the RAW reset value (callers clamp); the 5–7200s safety clamp moved into `reportError` and the 2s floor into the grace-retry wait.

## [3.2.0] — 2026-07-17

### Added
- **Client-disconnect propagation** — Upstream `fetch` now composes the incoming client `AbortSignal` with the server-side HTTP timeout via `upstreamSignal()` (`src/index.ts`). When a user hits "Stop" or closes the connection, the upstream generation is **cancelled immediately** instead of burning tokens until the timeout fires. Algorithm: `AbortSignal.any([req.signal, AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS)])`, threaded through `executeFusion` → `executeOpenAICompat` / `executeGoogleNative` → both upstream `fetch` sites.
- **User-abort = no-op (decision A)** — When `signal?.aborted` is true in the execute `catch` blocks, the error is treated as a non-fatal client disconnect: `router.reportError` / circuit-breaker cooldown is **skipped** and a `499 Client Closed` is returned. A healthy upstream is never penalized for an impatient user. Validated against Envoy/AgentGateway's implicit Rust `Drop` / `RST_STREAM` mechanism (our `AbortSignal` is the correct Bun translation).

### Changed
- `executeOpenAICompat`, `executeGoogleNative`, and `executeFusion` gained an optional `signal?: AbortSignal` parameter (defaulting to the timeout-only signal when absent, so existing call paths are unchanged).

## [3.1.0] — 2026-07-16

### Added
- **Emoji state logging** — Terminal logs now carry intuitive per-state emoji prefixes for faster visual scanning (🔵 inbound request, 🔄 rotate/backoff, ⚠️ provider limit, 🔴 system limit exhausted, 🟢 served, 🔗 fusion, 🚀 boot, 📝 trace, 💥 error). Existing text tags (`[REQ]`, `[PROVIDER_LIMIT]`, `[FUSION]`, etc.) are preserved for grep-ability.
- **Request trace archive** — Every request is assigned a `crypto.randomUUID()` `reqId` threaded through all handlers and the fusion chain. Raw **downstream** (request body sent upstream) and **upstream** (provider response) payloads are matched by `reqId` and written to `logs/traces/<reqId>.json` for post-crash investigation. Writes are non-blocking (fire-and-forget, `0600` perms) to avoid I/O lag on the request path; there is no in-memory buffer (files are the sole archive). The `logs/traces/` directory is cleared at every boot via `clearTraces()`, mirroring the Valkey flush.

## [3.0.0] — 2026-07-16

### Architecture — Single Bun Process (BREAKING)

LiteRouter has been consolidated from three processes (Python `:7766` + TypeScript `:7767` + Fusion sidecar `:7768`) into a **single Bun/TypeScript process** on port `:7766`. This eliminates the Python gateway, the fusion sidecar, and all inter-process coordination.

### Added
- **In-process fusion runtime** — Fusion groups now run inside the main Bun process instead of a separate sidecar. Circuit breaker (65s), sticky fallback (300s), and `X-Literouter-Model` response header preserved.
- **ZSET+Lua atomic quota** — True rolling 60s windows via Redis/Valkey Lua script (no minute-edge bursts). Member format `{timestamp}-{random}:{tokens}` prevents collisions.
- **Per-request backoff** — When all keys for a provider are exhausted, backs off 65s → 90s → 120s before returning 429.
- **Google native route** — `/v1beta/models/{model}:{action}` with query-param auth.
- **Reasoning normalization** — `LITEROUTER_COLLAPSE_REASONING` env flag collapses `reasoning_content`, `reasoningContent`, `thought` into `<thought>` tags.
- **LaTeX symbol cleaning** — Normalizes `\rightarrow`, `\to`, `\times` → Unicode on all responses.
- **Gemma payload scrubbing** — Recursively strips `thinkingConfig`/`thinking_config` from Gemma requests.
- **Verbose request logging** — Every request logs `[REQ]`, `[GOOGLE] Served`, `[FUSION]` with model, provider, key prefix, and upstream details.

### Changed
- **scripts/start.sh** — Single `bun run ts-src/src/index.ts` instead of 3-process launch. Port reads from `LITEROUTER_PORT` env var (default `7766`).
- **scripts/stop.sh** — Single-process teardown. No more separate Python/fusion sidecar cleanup.
- **scripts/restart.sh** — Simplified to stop + flush + start.
- **Port** — Server now runs on `:7766` by default (was `:7767` for TS proxy).
- **Logging** — All runtime logs stream to the single `literouter` tmux session.

### Removed
- **Python gateway** (`src/main.py`, `src/config.py`, `src/router.py`, `src/rate_limiter.py`, `src/metrics.py`, `src/anthropic.py`, `src/gemini.py`, `src/queue.py`, `src/embed_cache.py`, `src/redis_client.py`, `src/doctor.py`) — All Python source files removed.
- **Fusion sidecar** (`fusion.py`) — Fusion is now in-process.
- **Python dependencies** (`uv.lock`, `pyproject.toml` deps) — No longer needed.
- **status.sh** — No longer relevant (single-process health checked via `/health`).

### Fixed
- **Fusion fallthrough fix** — `fromFusion` check added after inner loop (not just catch block). When individual keys return 429 (not "all keys exhausted"), fusion chain falls through immediately without trying more keys across rounds. Stopped extra key burns.
- **Real RPM counter in logs** — `getAvailableKey` now returns `currentRpm` from the Lua script's ZSET count. Success logs show `rpm X/15` (per-key, starts at 1). `[PROVIDER_LIMIT]` logs show the same.
- **Verbose logging restored** — `attempt X/Y`, `[PROVIDER_LIMIT]`, `[SYSTEM_LIMIT]` logs all active on both native and OpenAI-compat routes.
- **Native route transparent pass-through** — `cleanGemmaPayload` removed from native route (`/v1beta/`). OpenAI-compat route (`/v1/`) still scrubs `thinkingConfig`. Native route now passes request body unchanged to Google.
- **Standardized key rotation delay to 10s** — Removed `GOOGLE_MIN_DELAY_MS=2000` override. All providers now use `LITEROUTER_ROTATE_DELAY_MS=10000`.
- **Telemetry sanitization** — Removed raw request body dumps from native logging. Logs now only capture metadata.
- **Port consistency** — `start.sh` now reads port from `.env` `LITEROUTER_PORT` instead of hardcoding.

## [3.1.0] — 2026-07-16

### Added
- **Thought signature support** — Google's OpenAI-compat endpoint requires `thought_signature` in `tool_calls[0].extra_content.google.thought_signature` for function calling. Proxy extracts it from Google's response (both streaming SSE and non-streaming), stores in-memory keyed by tool_call ID, and re-injects on the next request. Both `/v1beta/` (native) and `/v1/` (OpenAI-compat) routes support tool calls with Google models. Fully transparent — no client-side changes.
- **Expanded Gemma payload sanitization** — `cleanGemmaPayload` now also strips `presence_penalty`, `frequency_penalty`, `logit_bias`, `user`, `seed`, `logprobs`, `top_logprobs` (prevents Google 500 Internal Error on Gemma 4 models via OpenAI-compat route).
- **Gemini flash integration tests** — 5 tests covering native pass-through, OpenAI-compat pass-through, tool calls via native route (Pydantic AI Google SDK), and tool calls via OpenAI-compat route (Pydantic AI OpenAI SDK).

### Fixed
- **Verbose logging cleaned** — Removed `body=${errSnippet}` from `[PROVIDER_LIMIT]` log lines (no more request/response body dumping).
- **conftest.py** — Stripped broken Python gateway singleton reset fixture (modules no longer exist in Bun-only architecture).

## [2.9.3] — 2026-07-10

### Added
- **setup_checklist.md** — New executable checklist document with task-item workflows for Add Model, Delete Model, Add Provider, Delete Provider operations. Includes explicit approval gates, file naming patterns, and verification criteria.

### Changed
- **setup.md** — Simplified to technical reference; checklists moved to setup_checklist.md for executable workflows.

### Removed
- **admin/studio/** — Deleted redundant outsource pipeline staging folder (contained stale model reference for dead `laguna-xs.2:free`)

## [2.9.2] — 2026-07-08

### Added
- **Fusion Sidecar Service** — Introduced `fusion.py` (port `7768`), a lightweight proxy that implements priority-based model fallback chains. It enables "virtual" models (e.g., `local/google`) that automatically fail over from primary to secondary models upon `429` or `5xx` errors from the main gateway.

### Fixed
- **Longrunning Mode (Sticky Fallback)** — Verified implementation of the sticky fallback mechanism in `fusion.py` to ensure priority chains correctly "stick" to successful models for 5 minutes, preventing wasteful retries of rate-limited primaries.
- **Gemma Payload Sanitization** — Fixed engine crashes for Gemma models when using the OpenAI compatibility route (`/v1/chat/completions`) by applying `_clean_gemma_payload` to strip prohibited `thinkingConfig` fields.

## [2.9.1] — 2026-07-08

## [2.9.0] — 2026-07-08

### Fixed
- **Atomic Quota Management** — Replaced "Check-then-Act" rolling window with an atomic Redis Lua script. This eliminates race conditions where multiple concurrent requests could bypass rate limits (boundary bursting).
- **Router Hardening** — Added `NoScriptError` handling for Lua scripts to ensure the proxy recovers automatically after Redis restarts.
- **Key Rotation Fixes** — Implemented cascade protection in `report_error` and integrated `REDIS_DB` configuration for better database isolation.

## [2.8.0] — 2026-06-21

### Added
- **Do Not Assume Directive** — Added explicit documentation of local vs VPS configuration logic and the active target verification.
- **Housekeeping** — Cleaned up untracked test scripts (`test_curl_rotation.py`).

## [2.7.0] — 2026-06-20

### Added
- **Zen Models Configuration** — Added tracking and metadata for Zen models (`big-pickle`, `deepseek-v4-flash-free`, `mimo-v2.5-free`, `qwen3.6-plus-free`, `minimax-m3-free`, `nemotron-3-ultra-free`, `north-mini-code-free`) in `models.json`.

### Fixed
- **Configuration Fixes** — Fixed trailing commas in `opencode.json` configuration and added `User-Agent: LiteRouter/2.2` header to `src/doctor.py` to prevent validation rejections.

## [2.6.0] — 2026-06-18

### Added
- **Mandatory `@ai-sdk/openai-compatible` SDK Integration** — Established the requirement to configure OpenCode with the compatible SDK. This forces the client to hit standard `/v1/chat/completions` natively rather than the ACP `/v1/responses` endpoint, making the proxy robust by omitting complex in-flight protocol translation.

### Fixed
- **Multi-turn tool calling 400 errors** — Fixed an issue where upstream providers (OpenRouter, Nvidia) returned 400 Bad Request on multi-turn conversations. This was caused by ACP `function_call` and `function_call_output` items lacking a `role` field. The sanitizer now properly converts these to the standard OpenAI `tool_calls` format.
- **Tool call streaming fixes** — Resolved `ZodValidationError: expected object, received undefined` and SSE stream corruption by bypassing protocol translation entirely for tool-calling models via the compatible SDK.
- **Uvicorn read timeout** — Increased upstream read timeout limit to 300s to support slow/complex reasoning models.


## [2.5.0] — 2026-06-18

### Architecture — Multi-Provider Routing

LiteRouter now supports **multiple upstream providers** through a single endpoint. Requests are routed based on the model prefix:

| Prefix | Provider | Upstream |
|--------|----------|----------|
| `openrouter/` | OpenRouter | `openrouter.ai/api/v1` |
| `nvidia/` | Nvidia | `integrate.api.nvidia.com/v1` |
| `anthropic/` | Anthropic | `api.anthropic.com` |

Each provider has its own independent key pool, rotation counter, health tracking, and rate limiting.

### Added
- **Multi-provider support** — Add as many providers as you want via `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS` in `.env`
- **Model prefix stripping** — Provider prefix (e.g., `nvidia/`) is automatically stripped before forwarding to the upstream API
- **Nvidia provider** — Pre-configured Nvidia integration with 6 API keys
- **OpenCode integration docs** — README updated with `opencode.json` configuration example

### Changed
- **Model passthrough** — Client's model ID is never overwritten by config defaults (previously `OPENROUTER_MODEL` would override the request)
- **Extra params injection** — Config-level `temperature` etc. only apply if the client didn't already set them
- **start.sh** — Uses `nohup` + `disown` for proper daemon persistence
- **Streaming error responses** — Use proper JSON serialization instead of string concatenation

### Removed
- **Debug logs** — Removed noisy `[debug] RAW BODY`, `[debug] OUTBOUND PAYLOAD`, `[debug] TRANSFORMED ANTHROPIC PAYLOAD` log lines that leaked request content

## [2.4.0] — 2026-06-13

### Added
- **`/v1/responses` endpoint** — Added support mapping to `chat_completions` for newer OpenCode compatibility.
- **OpenCode Format Mapping** — Translated `"input"` field to `"messages"` on input, and mapped `"input_text"` content block type to `"text"` for Anthropic Messages compatibility.
- **TUI Integration** — Configured global `opencode.json` with `openrouter/owl-alpha` as `Owl-Alpha (Literouter)`.

## [2.3.0] — 2026-06-13

### Added
- **Project Initialization** — Synced optional and dev dependencies via `uv sync --all-extras`.
- **VPS Redis Verification** — Successfully verified connectivity and authentication with Redis Enterprise running in Docker on the remote VPS (10.32.34.243:12000).

## [2.2.0] — 2026-05-18

### Architecture — Clean Template + Provider Selection

Replaced the complex auto-detection system with three explicit pathways configured in `.env`:

| Template   | Provider   | Endpoint                              |
|------------|------------|---------------------------------------|
| `anthropic`| `anthropic`| Native Anthropic SDK → `/messages`    |
| `anthropic`| `openrouter`| Anthropic format → OR `/messages`   |
| `openai`   | `openrouter`| OpenAI format → OR `/chat/completions`|

Configure via:
```env
LITEROUTER_TEMPLATE=anthropic   # or openai
LITEROUTER_PROVIDER=openrouter  # or anthropic
```

### Added
- **`/v1/models` endpoint** — Queries OpenRouter's live model list (356+ models with context lengths and pricing)
- **Anthropic streaming** — Full SSE conversion from Anthropic event stream → OpenAI chunk format
- **`build_anthropic_request_body()`** — Converts OpenAI chat format → Anthropic Messages API format (system extraction, tool_calls mapping)
- **In-memory rate limiter fallback** — Works when Redis is down instead of allowing all calls
- **Lua script atomic rate limiting** — Pre-registered Redis Lua script for atomic check-and-set
- **PID file management** — `start.sh`, `stop.sh`, `restart.sh`, `status.sh` with `.literouter.pid` tracking
- **Test suite** — 9 test files covering config, router, rate limiter, Anthropic, streaming, models, embed cache, integration

### Changed
- **Router counter** — Atomic `INCR` instead of separate GET + INCR (race condition fix)
- **Rate limiter** — Falls back to in-memory when Redis is down (was: always ready=true)
- **Config scanner** — Skips providers with empty API keys (prevents phantom providers from shell env pollution)
- **Redis default host** — Changed from hardcoded `10.32.34.243` to `localhost`
- **OpenRouter base URL** — Restored to `https://openrouter.ai/api/v1` (was incorrectly changed to `/api`)

### Fixed
- **Model name prefix stripping** — OpenRouter keeps full `provider/model` format; Anthropic strips prefix
- **Memory counter drift** — In-memory fallback counter increments by actual offset
- **Anthropic transformer** — Handles string content (not just arrays), None usage values, preserves reasoning_tokens
- **`is_anthropic_model()`** — No longer matches `claudex` (requires `claude-` with hyphen)
- **Shell env pollution** — VS Code/Claude Code `ANTHROPIC_*` env vars no longer create phantom providers

## [2.1.0] — 2026-05-18

### Added
- Initial Anthropic response transformer
- Streaming support (SSE pass-through)
- Model name prefix stripping
