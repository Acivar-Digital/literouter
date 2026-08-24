Run started: 2026-08-24T07:13:32Z
$ tsc --noEmit
bun test v1.3.13 (bf2e2cec)

tests/smoke/health_probe.test.ts:
(pass) Gateway Smoke Health Probes > GET /health responds with 200 OK and healthy status under 50ms [0.92ms]
(pass) Gateway Smoke Health Probes > GET /v1/models probe with valid key returns 200 OK [0.84ms]

tests/integration/models_discovery.test.ts:
(pass) Dynamic Model Discovery Integration > filters models dynamically for OpenRouter direct key [0.38ms]
(pass) Dynamic Model Discovery Integration > filters models dynamically for Google Gemini direct key [0.50ms]
(pass) Dynamic Model Discovery Integration > returns configured models for Fusion preset key [0.29ms]
(pass) Dynamic Model Discovery Integration > serves Google native schema for GET /v1beta/models?key=... [0.31ms]
(pass) Dynamic Model Discovery Integration > rejects model discovery with 401 when key is missing or invalid [0.17ms]

tests/integration/stream_stall_resend.test.ts:
🔵 [08-24-07:13:34:634] [req_s46ncz0] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:13:34:647] [TTFT req_s46ncz0] TTFT = 7ms | Stream established [Upstream: HTTP/1.1]
(pass) Stream Stall Resend Integration > handles mid-stream stall and retries on the same key up to max attempts [29.33ms]

tests/integration/dual_http_h2.test.ts:
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > serves cleartext HTTP/1.1 requests correctly on port 7766 [0.36ms]
================================================================================
🚀 LITEROUTER v3.1 GATEWAY [BUN RUNTIME]
================================================================================
Port           : 7891
Protocol       : HTTP/2 (h2 ALPN) & HTTP/1.1 TLS
TLS Enabled    : true
Auth Mode      : API-Key Declarative Directive (lr-xx-xx-xx-xx / lr-fse-xxxx)
Strip Reasoning: true (Global default; overridable via 'ts' nuance)

Key Pools Loaded:
  • (No active key pools loaded from .env.local)

Endpoints Registered:
  • /v1/chat/completions (OpenAI Chat Completions)
  • /v1/messages         (Anthropic Claude Messages)
  • /v1/models           (Dynamic Model Discovery)
  • /v1beta/openai/*     (Google OpenAI-Compat Beta)
  • /v1beta/models/*     (Google Native RPC)
  • /reset               (Hard Flush / Key Unfreeze)
  • /health              (Health Check Probe)
================================================================================
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > negotiates HTTP/2 when server is started with TLS certs [26.95ms]
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > processes concurrent parallel requests without head-of-line blocking [1.43ms]
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > gracefully falls back when TLS certificates are absent [0.20ms]

tests/integration/h2_resilience.test.ts:
(pass) HTTP/2 & Resiliency End-to-End Integration > returns rich telemetry on /health including h2_outbound and circuit_breakers [0.34ms]
🔵 [08-24-07:13:34:682] [req_vvmwvmk] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-nv-oa-ch-no -> Target: NVIDIA NIM | Wire: OpenAI | EP: /v1/chat/completions
    Model     : meta/llama-3.3-70b-instruct | Key: NVIDIA NIM [Key #1/2]
(pass) HTTP/2 & Resiliency End-to-End Integration > returns clean HTTP 429 when pacer queue is saturated [0.76ms]
🔵 [08-24-07:13:34:683] [req_uecbdfi] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-nv-oa-ch-no -> Target: NVIDIA NIM | Wire: OpenAI | EP: /v1/chat/completions
    Model     : meta/llama-3.3-70b-instruct | Key: NVIDIA NIM [Key #1/2]
⚠️ [08-24-07:13:34:683] [LIMIT req_uecbdfi] NVIDIA NIM [Key #1/2] returned 503 Too Many Requests
    Parsed Retry-After: 60s -> Quarantined Key #1 for 60s
🔄 [08-24-07:13:34:884] [ROTATE req_uecbdfi] Advancing to NVIDIA NIM [Key #2/2] -> Retrying immediately (Attempt 2/2)
⚠️ [08-24-07:13:34:884] [LIMIT req_uecbdfi] NVIDIA NIM [Key #2/2] returned 503 Too Many Requests
    Parsed Retry-After: 60s -> Quarantined Key #2 for 60s
💥 [08-24-07:13:34:884] [ERROR req_uecbdfi] Direct request attempts exhausted - Provider 'nv' circuit breaker is OPEN
(pass) HTTP/2 & Resiliency End-to-End Integration > fast-fails when circuit breaker is OPEN [201.93ms]

tests/integration/hard_reset_flush.test.ts:
(pass) Operational Hard Reset & Flush Integration > handles GET /reset and flushes all rate limits and quarantines [0.38ms]
(pass) Operational Hard Reset & Flush Integration > handles POST /reset unfreezing quarantined key states [0.18ms]

tests/integration/openai_compat.test.ts:
🔵 [08-24-07:13:34:902] [req_f8pzs0b] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:13:34:905] [TTFT req_f8pzs0b] TTFT = 3ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:34:905] [USAGE req_f8pzs0b] OpenRouter (Key #1/2)
    Tokens: Prompt=10 | Completion=6 | Total=16 | Speed=2000.0 tok/s
🟢 [08-24-07:13:34:910] [SERVED req_f8pzs0b] HTTP 200 in 3ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) OpenAI Compatibility Handler Integration > handles non-streaming POST /v1/chat/completions successfully [22.94ms]
🔵 [08-24-07:13:34:925] [req_tc87dyy] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:13:34:929] [TTFT req_tc87dyy] TTFT = 4ms | Stream established [Upstream: HTTP/1.1]
(pass) OpenAI Compatibility Handler Integration > handles streaming POST /v1/chat/completions with SSE [18.44ms]
(pass) OpenAI Compatibility Handler Integration > returns 401 when API key directive is missing or malformed [16.03ms]
(pass) OpenAI Compatibility Handler Integration > does not log TTFT when upstream returns 4xx/5xx error [22.96ms]
🔵 [08-24-07:13:34:988] [req_s4s2pls] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
(pass) OpenAI Compatibility Handler Integration > returns 503 load shed when all provider keys are quarantined beyond wait budget [19.99ms]
🔵 [08-24-07:13:35:008] [req_231o6ek] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:13:35:009] [TTFT req_231o6ek] TTFT = 1ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:35:009] [USAGE req_231o6ek] OpenRouter (Key #2/2)
    Tokens: Prompt=10 | Completion=6 | Total=16 | Speed=6000.0 tok/s
🟢 [08-24-07:13:35:010] [SERVED req_231o6ek] HTTP 200 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) OpenAI Compatibility Handler Integration > handles transient cooldown with dwell and does not emit phantom logLimit [21.41ms]

tests/integration/abort_propagation.test.ts:
🔵 [08-24-07:13:35:032] [req_r8pxz9g] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:13:35:035] [TTFT req_r8pxz9g] TTFT = 2ms | Stream established [Upstream: HTTP/1.1]
⚠️ [08-24-07:13:35:064] [LIMIT req_r8pxz9g] OpenRouter [Key #1/2] returned 500 Too Many Requests
    Parsed Retry-After: 60s -> Quarantined Key #1 for 60s
(pass) Client Abort Signal Propagation Integration > propagates downstream client abort signal upstream immediately [104.65ms]

tests/integration/ghost_response_guard.test.ts:
🔵 [08-24-07:13:35:131] [req_snfshor] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🔄 [08-24-07:13:35:332] [ROTATE req_snfshor] Advancing to OpenRouter [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:13:35:334] [TTFT req_snfshor] TTFT = 2ms | Stream established [Upstream: HTTP/1.1]
(pass) Ghost Response & Zero-Token Guard Integration > detects 0-token HTTP 200 stream, rotates key, and succeeds seamlessly [216.79ms]
🔵 [08-24-07:13:35:360] [req_xt2ykdf] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:13:35:362] [TTFT req_xt2ykdf] TTFT = 2ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:35:362] [USAGE req_xt2ykdf] OpenRouter (Key #1/2)
    Tokens: Prompt=15 | Completion=25 | Total=40 | Speed=12500.0 tok/s
🟢 [08-24-07:13:35:362] [SERVED req_xt2ykdf] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Ghost Response & Zero-Token Guard Integration > does NOT falsely flag non-streaming tool call with null content as ghost response [28.27ms]
🔵 [08-24-07:13:35:402] [req_3q11mp4] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:13:35:404] [TTFT req_3q11mp4] TTFT = 2ms | Stream established [Upstream: HTTP/1.1]
(pass) Ghost Response & Zero-Token Guard Integration > does NOT falsely flag streaming tool call delta without content as ghost response [41.85ms]

tests/integration/google_native.test.ts:
🔵 [08-24-07:13:35:424] [req_u96ps7q] Inbound POST /v1beta/models/gemini-2.5-flash:generateContent [HTTP/1.1] from unknown
    Directive : lr-gg-gg-gc-no -> Target: Google | Wire: Google | EP: /v1beta/models/gemini-2.5-flash:generateContent
    Model     : gemini-2.5-flash | Key: Google [Key #1/2]
🟢 [08-24-07:13:35:427] [TTFT req_u96ps7q] TTFT = 2ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:35:427] [SERVED req_u96ps7q] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Google Native & Beta Endpoints Integration > handles native /v1beta/models/*:generateContent with ?key= query auth [21.04ms]
🔵 [08-24-07:13:35:444] [req_wnd90z6] Inbound POST /v1beta/openai/chat/completions [HTTP/1.1] from unknown
    Directive : lr-gg-oa-ob-dp -> Target: Google | Wire: OpenAI | EP: /v1beta/openai/chat/completions
    Model     : gemini-2.5-flash | Key: Google [Key #1/2] | Nuances: [dp]
🟢 [08-24-07:13:35:448] [TTFT req_wnd90z6] TTFT = 3ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:35:448] [SERVED req_wnd90z6] HTTP 200 in 3ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Google Native & Beta Endpoints Integration > handles OpenAI-compatible beta /v1beta/openai/chat/completions [21.18ms]
(pass) Google Native & Beta Endpoints Integration > rejects unauthorized native requests with 401 [16.74ms]

tests/integration/anthropic_compat.test.ts:
🔵 [08-24-07:13:35:487] [req_syxxe14] Inbound POST /v1/messages [HTTP/1.1] from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-24-07:13:35:490] [TTFT req_syxxe14] TTFT = 2ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:35:490] [USAGE req_syxxe14] Anthropic (Key #1/2)
    Tokens: Prompt=10 | Completion=8 | Total=18 | Speed=4000.0 tok/s
🟢 [08-24-07:13:35:490] [SERVED req_syxxe14] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles non-streaming POST /v1/messages with x-api-key header [22.51ms]
🔵 [08-24-07:13:35:507] [req_9cp7p5x] Inbound POST /v1/messages [HTTP/1.1] from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-24-07:13:35:510] [TTFT req_9cp7p5x] TTFT = 3ms | Stream established [Upstream: HTTP/1.1]
🟢 [08-24-07:13:35:510] [USAGE req_9cp7p5x] Anthropic (Key #1/2)
    Tokens: Prompt=0 | Completion=5 | Total=5 | Speed=1666.7 tok/s
🟢 [08-24-07:13:35:510] [SERVED req_9cp7p5x] HTTP 200 in 3ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles streaming POST /v1/messages and emits SSE event stream [19.94ms]
(pass) Anthropic Compatibility Handler Integration > rejects unauthorized request with 401 when key is missing [17.30ms]
(pass) Anthropic Compatibility Handler Integration > does not log TTFT when upstream returns 4xx/5xx error [2022.76ms]
🔵 [08-24-07:13:37:566] [req_hv86eqf] Inbound POST /v1/messages [HTTP/1.1] from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
(pass) Anthropic Compatibility Handler Integration > returns 503 load shed when all provider keys are quarantined beyond wait budget [15.46ms]
🔵 [08-24-07:13:37:585] [req_lizybip] Inbound POST /v1/messages [HTTP/1.1] from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-24-07:13:37:587] [TTFT req_lizybip] TTFT = 2ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:37:587] [USAGE req_lizybip] Anthropic (Key #2/2)
    Tokens: Prompt=10 | Completion=8 | Total=18 | Speed=4000.0 tok/s
🟢 [08-24-07:13:37:587] [SERVED req_lizybip] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles transient cooldown with dwell and does not emit phantom logLimit [21.10ms]

tests/unit/visual_telemetry.test.ts:
(pass) Visual Telemetry & Terminal UI > formats timestamps consistently in [MM-DD-HH:MM:SS:mmm] format [0.05ms]
(pass) Visual Telemetry & Terminal UI > resolves friendly provider and wire display names [0.08ms]
(pass) Visual Telemetry & Terminal UI > formats token numbers with thousands commas [0.14ms]
(pass) Visual Telemetry & Terminal UI > logs rich multi-line inbound request telemetry [0.18ms]
(pass) Visual Telemetry & Terminal UI > logs TTFT and token usage with tok/s speed calculation [0.19ms]
(pass) Visual Telemetry & Terminal UI > logs limit warning with parsed retry-after [0.07ms]
(pass) Visual Telemetry & Terminal UI > logs key rotation with attempt count [0.05ms]
(pass) Visual Telemetry & Terminal UI > logs served response with green indicator for 2xx status [0.05ms]
(pass) Visual Telemetry & Terminal UI > logs served response with warning indicator for 4xx/5xx status [0.06ms]
(pass) Visual Telemetry & Terminal UI > logs exhausted error with provider name and backoff ms [0.06ms]
(pass) Visual Telemetry & Terminal UI > logs separator line [0.03ms]

tests/unit/circuit_breaker.test.ts:
(pass) Provider Circuit Breaker with Strict Canary Lease > starts in CLOSED state and allows traffic [0.08ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > trips to OPEN state upon reaching failure threshold of 5xx errors [0.07ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > does not trip for non-critical 4xx errors [0.03ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > transitions from OPEN to HALF_OPEN after cooldown and permits exactly ONE canary probe [60.41ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > kicks back to OPEN immediately if canary probe fails [60.58ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > recovers canary lease if canary probe times out after maxCanaryDurationMs [92.27ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > retrieves and registers singleton breakers correctly via helper [0.20ms]

tests/unit/language_guardrail.test.ts:
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-01: enforces zero Chinese character leakage in generic code reasoning and comments [0.10ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-02: detects and flags Chinese token leakage in code outputs [0.07ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-03: preserves 100% genuine Chinese characters in BaZi metaphysics data payloads while keeping explanations in English [0.15ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-04: verifies all 10 Heavenly Stems, 12 Earthly Branches, and Ten Gods in whitelist [0.09ms]

tests/unit/zdist.test.ts:
(pass) Rate Limit Tracker — Sliding Window RPM > records requests and counts within sliding 60s window [0.39ms]
(pass) Rate Limit Tracker — Sliding Window RPM > tracks RPM independently per key index [0.06ms]
(pass) Rate Limit Tracker — Sliding Window RPM > detects 95% threshold approach for RPM ceiling [0.40ms]
(pass) Rate Limit Tracker — Daily RPD Quota > records and returns daily cumulative requests [0.21ms]
(pass) Rate Limit Tracker — Daily RPD Quota > detects 95% threshold approach for daily RPD quota [0.32ms]
(pass) Rate Limit Tracker — Daily RPD Quota > clears all counters on hard reset [0.07ms]

tests/unit/path_resolver.test.ts:
(pass) Path Resolver — providers.json Completion URL Mapping > resolves OpenRouter chat completions endpoint (or, ch) [0.15ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves OpenRouter messages endpoint (or, ms) [0.07ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves NVIDIA chat completions endpoint (nv, ch) [0.02ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google OpenAI-compat beta endpoint (gg, ob) [0.02ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google native generateContent with model substitution (gg, gc) [0.35ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google embeddings with model substitution (gg, em) [0.05ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Anthropic direct messages endpoint (an, ms) [0.04ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Zen chat endpoint (zn, ch) [0.03ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Zen models endpoint (zn, md) [0.01ms]
(pass) Path Resolver — providers.json Completion URL Mapping > returns null for non-existent completion code on provider [0.02ms]
(pass) Path Resolver — Outbound Auth Transformation > formats standard Bearer header for OpenRouter [0.06ms]
(pass) Path Resolver — Outbound Auth Transformation > formats standard Bearer header for NVIDIA NIM [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats x-api-key and anthropic-version for Anthropic direct [0.02ms]
(pass) Path Resolver — Outbound Auth Transformation > formats Bearer header for Google OpenAI beta endpoint (ob) [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats query parameter ?key= for Google Native RPC (gc) [0.02ms]

tests/unit/midstream_retry.test.ts:
(pass) formatMidstreamErrorFrame > formats OpenAI error frame with JSON error payload and data: [DONE] delimiter [0.08ms]
(pass) formatMidstreamErrorFrame > formats Anthropic error frame with SSE event error format [0.15ms]
(pass) isInBandErrorChunk > detects in-band server error chunk containing 'Server error mid-response. The response above may be incomplete.' and returns { isError: true } [0.15ms]
(pass) isInBandErrorChunk > detects 5xx error JSON in SSE chunks and returns { isError: true } [0.23ms]
(pass) isInBandErrorChunk > returns { isError: false } for standard content deltas [0.16ms]
(pass) isInBandErrorChunk > detects finish_reason: network_error and finish_reason: error chunks as errors [0.09ms]
(pass) isInBandErrorChunk > returns { isError: false } for empty byte chunks [0.03ms]
(pass) isLikelySSEDoneMarker > returns true for [DONE] and valid terminal finish_reasons [0.05ms]
(pass) isLikelySSEDoneMarker > returns false for network_error, error, or non-terminal chunks [0.02ms]
(pass) handlePrematureEof > returns null if hasSeenDoneMarker is true [0.11ms]
(pass) handlePrematureEof > returns null if hasSeenDataToken is true [0.13ms]
(pass) handlePrematureEof > calls retryProvider when neither token nor done marker seen [0.22ms]
(pass) createResilientStream — Mid-Stream Error Recovery > suppresses in-band error chunk, calls nextAttemptProvider, and continues streaming downstream until done [1.58ms]
(pass) createResilientStream — Mid-Stream Error Recovery > recovers when upstream reader throws mid-stream (e.g. socket reset) via nextAttemptProvider [0.78ms]
(pass) createResilientStream — Mid-Stream Error Recovery > seals downstream with SSE error frame when midstream retries fail or nextAttemptProvider throws after tokens [0.48ms]
(pass) createResilientStream — Mid-Stream Error Recovery > seals downstream with SSE error frame when nextAttemptProvider returns null / no further attempts after tokens [0.28ms]
(pass) createResilientStream — Mid-Stream Error Recovery > seals downstream with SSE error frame when upstream fails midstream and no nextAttemptProvider is provided [0.39ms]
(pass) createResilientStream — Mid-Stream Error Recovery > errors downstream controller when upstream fails with 0 tokens and no nextAttemptProvider is provided [0.24ms]
(pass) createResilientStream — Mid-Stream Error Recovery > premature EOF with 0 data tokens triggers retryProvider and seamlessly yields chunks from 2nd provider [0.28ms]
(pass) createResilientStream — Mid-Stream Error Recovery > clean EOF after data tokens does NOT trigger retry and closes cleanly [0.21ms]
(pass) createResilientStream — Mid-Stream Error Recovery > clean EOF after [DONE] marker does NOT trigger retry and closes cleanly [0.18ms]
(pass) createResilientStream — Mid-Stream Error Recovery > inspectChunkMarkers accurately tracks [DONE], finish_reason, and content tokens [0.08ms]
(pass) createResilientStream — Mid-Stream Error Recovery > readWithChunkTimeout throws StreamStallError when reading times out [28.78ms]
(pass) createResilientStream — Mid-Stream Error Recovery > inter-chunk stall timeout triggers retryProvider and resumes streaming from 2nd provider [27.02ms]
(pass) createResilientStream — Mid-Stream Error Recovery > retryProvider exhaustion formats downstream OpenAI error frame and terminates cleanly [1.10ms]
(pass) createResilientStream — Mid-Stream Error Recovery > retryProvider exhaustion formats downstream Anthropic error frame and terminates cleanly [0.32ms]
(pass) createResilientStream — Mid-Stream Error Recovery > keepalive comment frames do not count as data tokens, so premature EOF still triggers retry [0.30ms]
(pass) createResilientStream — Mid-Stream Error Recovery > recovers seamlessly when upstream emits finish_reason: network_error on first chunk before tokens [0.28ms]
(pass) createResilientStream — Mid-Stream Error Recovery > detects fragmented TCP packet with finish_reason: network_error split across 2 chunks and retries cleanly [0.27ms]
(pass) createResilientStream — Mid-Stream Error Recovery > midstream drop after tokens outputs clean OpenAI SSE error block and closes without throwing uncaught controller exceptions [0.16ms]
(pass) createResilientStream — Mid-Stream Error Recovery > midstream stall after tokens outputs clean SSE error block and closes cleanly without throwing [22.01ms]
(pass) createResilientStream — Mid-Stream Error Recovery > midstream in-band error after tokens outputs clean SSE error block and closes cleanly [1.32ms]

tests/unit/fusion_sticky.test.ts:
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > returns null when no sticky position is cached [0.30ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > stores and returns sticky tier position on fallback [0.94ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > isolates sticky positions across distinct models [0.05ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > expires sticky position after 5-minute TTL [0.05ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > clears sticky tier when primary recovery succeeds [0.05ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > resets all sticky entries on clearAll [0.04ms]

tests/unit/classifier.test.ts:
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'Provider returned error' as fail_fast with 0s quarantine [0.11ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'No available provider' as retry_rotate with 0s quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'temporarily unavailable' as retry_rotate with 0s quarantine [0.21ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > handles case-insensitivity for retryable 400 patterns [0.04ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'maximum context length' as fail_fast with 0s quarantine [0.07ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'context_length_exceeded' as fail_fast with 0s quarantine [0.04ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'prompt is too long' / context overflow as fail_fast with 0s quarantine [0.20ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies Anthropic context window overflow error as fail_fast with 0s quarantine [0.44ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies Google Gemini token limit exceeded 400 as fail_fast with 0s quarantine [0.05ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'safety' as fail_fast with 0s quarantine [0.26ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'HARM_PROBABILITY' as fail_fast with 0s quarantine [0.18ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies generic 400 errors as fail_fast with 0s quarantine [0.04ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 standard rate limit as retry_rotate with 65s default quarantine [1.58ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > honors Retry-After header for 429 standard rate limit [0.11ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > honors Retry-After in Record<string, string> format [0.03ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'insufficient_quota' as retry_rotate with 7-day (604800s) quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'credit_limit' as retry_rotate with 7-day quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'out of balance' as retry_rotate with 7-day quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 401 as retry_rotate with tiered quarantine (default/1st failure = 300s) [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 403 as retry_rotate with tiered quarantine (default/1st failure = 300s) [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 401 with consecutiveAuthFailures = 2 as 1800s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 403 with consecutiveAuthFailures >= 3 as 86400s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 5xx - Transient server errors > classifies HTTP 500 as retry_rotate with 10s quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 5xx - Transient server errors > classifies HTTP 502 as retry_rotate with 10s quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 5xx - Transient server errors > classifies HTTP 503 as retry_rotate with 10s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 5xx - Transient server errors > classifies HTTP 504 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 404 - Not Found > classifies 404 as fail_fast with 0s quarantine [0.07ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates TCP RST / ECONNRESET with 2s cooldown quarantine [0.07ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates socket EOF / hang up with 2s cooldown quarantine [0.04ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates ConnectTimeout with 2s cooldown quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates status 0 pre-stream transport reset with 2s cooldown quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates TTFT timeout with 2s transient quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates NoResponse / timed out waiting for first chunk with 2s transient quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates status 0 TTFT timeout with 2s transient quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Robustness & Bounded parsing > handles undefined bodyText gracefully [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Robustness & Bounded parsing > handles empty string bodyText gracefully [0.04ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Robustness & Bounded parsing > safely processes huge bodies (>4KB) without performance degradation or errors [0.16ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Robustness & Bounded parsing > safely handles non-JSON malformed bodies [0.04ms]

tests/unit/gemma_transformer.test.ts:
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > converts system message into prepended [System Context] in first user message [0.29ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > creates a user message if only a system message is present [0.06ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > merges consecutive user messages into a single user turn [0.11ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > merges consecutive assistant messages into a single turn [0.03ms]
(pass) Gemma Transformer — End-to-End Payload Sanitization > applies gemma constraints when 'gm' nuance is provided [0.12ms]
(pass) LaTeX Normalizer > replaces double-escaped times formula with clean unicode [0.03ms]
(pass) LaTeX Normalizer > replaces rightarrow with unicode arrow [0.12ms]
(pass) LaTeX Normalizer > replaces inequality symbols [0.03ms]

tests/unit/fetcher.test.ts:
(pass) Fetcher — Transport Error Wrapping > wraps raw fetch network transport exceptions in NoResponseError when signal is not aborted [0.31ms]
(pass) Fetcher — Transport Error Wrapping > rethrows raw error when clientSignal is aborted [0.22ms]
(pass) Dynamic TTFT Resolution (`resolveTtftTimeout`) > defaults to 120000ms (120s) when model is undefined or empty [0.02ms]
(pass) Dynamic TTFT Resolution (`resolveTtftTimeout`) > uses envTimeoutMs when provided for all models [0.02ms]
(pass) Dynamic TTFT Resolution (`resolveTtftTimeout`) > unifies TTFT timeout to 120000ms across all models including reasoning and preview models [0.06ms]
(pass) Wire-Compliant Midstream Error Frame (`formatMidstreamErrorFrame`) > formats Anthropic error frame correctly for 'anthropic' and 'cl' [0.06ms]
(pass) Wire-Compliant Midstream Error Frame (`formatMidstreamErrorFrame`) > formats OpenAI error frame correctly with [DONE] marker for 'openai' and default [0.03ms]
(pass) Stream First Chunk TTFT Timeout (`readFirstChunkWithTimeout`) > rejects with NoResponseError when chunk is not read within timeoutMs [51.10ms]
(pass) Stream First Chunk TTFT Timeout (`readFirstChunkWithTimeout`) > resolves promptly when first chunk is received before timeoutMs [0.36ms]
(pass) Content Chunk Reading with Multi-Packet Buffering (`readFirstContentChunkWithTimeout`) > buffers initial empty newlines/preambles until content arrives and returns combined buffer [0.48ms]
(pass) Content Chunk Reading with Multi-Packet Buffering (`readFirstContentChunkWithTimeout`) > throws NoResponseError when stream closes with 0 content tokens after empty chunks [0.30ms]

tests/unit/key_pool_event_driven.test.ts:
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 1: Event-driven key availability resolution without polling > wakes up immediately when TTL timer expires without manual polling [101.76ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 1: Event-driven key availability resolution without polling > resolves immediately when a key is already available [0.19ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 2: Thundering-herd safety & concurrency > handles 10 concurrent waiters gracefully without unhandled promise rejections [81.32ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 2: Thundering-herd safety & concurrency > allows fast waiters to timeout while slower waiters acquire key on wake [101.22ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 3: AbortSignal cleanup & zero listener leaks > cleans up event listeners upon AbortSignal trigger [0.48ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 3: AbortSignal cleanup & zero listener leaks > cleans up event listeners upon timeout expiration [51.74ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 3: AbortSignal cleanup & zero listener leaks > cleans up event listeners upon successful key acquisition after event wakeup [50.56ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 4: Consecutive 401/403 auth failure quarantine escalation > escalates quarantine through 300s -> 1800s -> 86400s on consecutive auth failures [0.31ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 4: Consecutive 401/403 auth failure quarantine escalation > resets consecutive auth failures to 0 upon reportSuccess [0.06ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 5: Targeted reset(provider) isolation > clears only specified provider cooldowns and timers while preserving other providers [1.06ms]

tests/unit/header_sanitizer.test.ts:
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > strips content-encoding and compression headers from downstream responses [0.12ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > strips all RFC hop-by-hop headers [0.08ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > updates content-length when bodyLength is supplied [0.03ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > omits content-length if bodyLength is undefined [0.02ms]

tests/unit/rotation_loop.test.ts:
🔵 [08-24-07:13:38:384] [req_zsvsjtf] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🔄 [08-24-07:13:40:385] [ROTATE req_zsvsjtf] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:13:40:386] [TTFT req_zsvsjtf] TTFT = 1ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:40:386] [USAGE req_zsvsjtf] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15 | Speed=5000.0 tok/s
🟢 [08-24-07:13:40:386] [SERVED req_zsvsjtf] HTTP 200 in 1ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 returns 400 'no available provider' and succeeds with 200 [2002.78ms]
🔵 [08-24-07:13:40:387] [req_01kc0gn] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
⚠️ [08-24-07:13:40:388] [SERVED req_01kc0gn] HTTP 400 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > fails fast on 400 'maximum context length' without trying Key 2 [1.40ms]
🔵 [08-24-07:13:40:388] [req_8y85bgl] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
⚠️ [08-24-07:13:40:389] [LIMIT req_8y85bgl] OpenAI [Key #1/2] returned 429 Too Many Requests
    Parsed Retry-After: 30s -> Quarantined Key #1 for 30s
🔄 [08-24-07:13:42:390] [ROTATE req_8y85bgl] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:13:42:390] [TTFT req_8y85bgl] TTFT = 0ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:42:390] [USAGE req_8y85bgl] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-24-07:13:42:390] [SERVED req_8y85bgl] HTTP 200 in 0ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 returns 429 Rate Limit and succeeds with 200 [2002.80ms]
🔵 [08-24-07:13:42:391] [req_vfq6ofv] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
⚠️ [08-24-07:13:42:392] [LIMIT req_vfq6ofv] OpenAI [Key #1/2] returned 401 Too Many Requests
    Parsed Retry-After: 300s -> Quarantined Key #1 for 300s
🔄 [08-24-07:13:44:392] [ROTATE req_vfq6ofv] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:13:44:393] [TTFT req_vfq6ofv] TTFT = 1ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:44:393] [USAGE req_vfq6ofv] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15 | Speed=5000.0 tok/s
🟢 [08-24-07:13:44:393] [SERVED req_vfq6ofv] HTTP 200 in 1ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > quarantines Key 1 on 401 (tiered quarantine: 300s for 1st failure) and succeeds with Key 2 [2003.69ms]
🔵 [08-24-07:13:44:395] [req_6ig4k6q] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🔄 [08-24-07:13:46:398] [ROTATE req_6ig4k6q] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:13:46:399] [TTFT req_6ig4k6q] TTFT = 1ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:46:399] [USAGE req_6ig4k6q] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15 | Speed=5000.0 tok/s
🟢 [08-24-07:13:46:399] [SERVED req_6ig4k6q] HTTP 200 in 1ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 encounters a raw socket transport error (e.g. 'The connection was closed') and succeeds with 200 [2004.60ms]
🔵 [08-24-07:13:46:399] [req_b3enaey] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
(pass) In-Flight Retry & Rotation Loop > does not retry on Key 2 and propagates abort when clientSignal is aborted [0.97ms]

tests/unit/payload_scrubbing.test.ts:
(pass) Payload Scrubbing Toggle (LITEROUTER_ENABLE_SCRUBBING) > preserves thinking, tools, and gemma params when enableScrubbing is false [0.21ms]
(pass) Payload Scrubbing Toggle (LITEROUTER_ENABLE_SCRUBBING) > scrubs thinking, tools, and gemma params when enableScrubbing is true [0.28ms]
(pass) Payload Scrubbing Toggle (LITEROUTER_ENABLE_SCRUBBING) > scrubUnsupportedParameters directly respects enableScrubbing flag [0.13ms]
(pass) Inbound Request Reasoning Scrubbing (OpenCode2 Inbound Payload) > scrubs a message with 375+ reasoning parts down to pure text content [1.66ms]
(pass) Inbound Request Reasoning Scrubbing (OpenCode2 Inbound Payload) > normalizes empty message content to empty string when all parts are reasoning [0.13ms]
(pass) Inbound Request Reasoning Scrubbing (OpenCode2 Inbound Payload) > preserves multi-part content arrays if multiple non-reasoning parts remain [0.07ms]
(pass) Inbound Request Reasoning Scrubbing (OpenCode2 Inbound Payload) > pipeline sanitizeAndTransformPayload / cleanOpenAIBody scrubs full conversation history with 375+ reasoning parts [0.27ms]
(pass) Inbound Request Reasoning Scrubbing (OpenCode2 Inbound Payload) > handles undefined or empty messages array gracefully [0.02ms]
(pass) Strict Tool Payload Normalization & Client Metadata Stripping > normalizes role: 'tool' content array into a single newline-separated string [0.09ms]
(pass) Strict Tool Payload Normalization & Client Metadata Stripping > ensures role: 'tool' content is always a string even if null or undefined [0.62ms]
(pass) Strict Tool Payload Normalization & Client Metadata Stripping > strips client metadata from role: 'user' and role: 'assistant' messages while preserving standard fields [0.11ms]

tests/unit/opencode_reasoning_filter.test.ts:
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > detects opencode User-Agent strings (case-insensitive) [0.07ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > does not match non-OpenCode User-Agents (e.g. pydantic-ai, curl, python) [0.03ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > detects x-opencode header via Headers instance [0.04ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > detects x-opencode header via record object [0.03ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > detects x-client-name header when containing opencode [0.03ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > activates on 'sb' (strip budget/reasoning) nuance even without opencode header [0.02ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > is overridden by 'ts' (thinking support) nuance, preserving reasoning for opencode [0.02ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > strips reasoning_content, reasoning, and reasoning_details from delta and returns shouldEmit: false if only reasoning was present [0.99ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > preserves delta and returns shouldEmit: true when delta contains content [0.07ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > preserves delta and returns shouldEmit: true when delta contains role: assistant [0.04ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > preserves delta and returns shouldEmit: true when delta contains tool_calls [0.04ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > returns shouldEmit: true when finish_reason is present (e.g. stop or tool_calls) [0.03ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > returns shouldEmit: true when usage stats are present in chunk [0.02ms]
(pass) OpenCode Reasoning Filter — Stream Transformer (createOpenCodeReasoningFilterStreamTransformer) > filters out reasoning deltas while keeping role, content, finish_reason, and [DONE] [2.91ms]
(pass) OpenCode Reasoning Filter — Stream Transformer (createOpenCodeReasoningFilterStreamTransformer) > handles chunk fragmentation across stream reads cleanly [0.33ms]
(pass) OpenCode Reasoning Filter — Stream Transformer (createOpenCodeReasoningFilterStreamTransformer) > ensures non-OpenCode clients (like Pydantic AI) preserve the raw reasoning stream intact [0.15ms]
(pass) OpenCode Reasoning Filter — Non-Streaming Response Body (stripReasoningFromResponseBody) > strips reasoning, reasoning_content, and reasoning_details from json choices and messages [0.76ms]
(pass) OpenCode2 Downstream SSE Stream — Live Thinking Delivery > delivers reasoning deltas unmodified to OpenCode2 by default so TUI renders thinking [0.18ms]
(pass) OpenCode2 Downstream SSE Stream — Live Thinking Delivery > strips reasoning deltas when 'sb' (strip budget/reasoning) nuance is explicitly requested [0.27ms]
(pass) OpenCode2 Downstream SSE Stream — Live Thinking Delivery > safely drops reasoning chunks where content is null without emitting invalid null content to OpenCode [0.30ms]

tests/unit/admin_pool_reset.test.ts:
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > rejects unauthorized access when no token is provided [1.18ms]
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > rejects unauthorized access when an invalid token is provided [0.41ms]
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > allows access with valid master LITEROUTER_AUTH_KEY and performs hard reset if no provider [0.90ms]
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > allows access with valid directive token in Authorization header [0.45ms]
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > resets a specific provider via query parameter [0.40ms]
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > resets a specific provider via JSON body [0.44ms]

tests/unit/anthropic_openai_compat.test.ts:
(pass) Anthropic -> OpenAI Forward Translation > translates basic system and user messages [0.29ms]
(pass) Anthropic -> OpenAI Forward Translation > does not include stream_options or max_completion_tokens by default when streaming [0.03ms]
(pass) Anthropic -> OpenAI Forward Translation > translates array system prompt with multiple text blocks [0.08ms]
(pass) Anthropic -> OpenAI Forward Translation > translates Anthropic tool definitions (input_schema -> parameters) [0.07ms]
(pass) Anthropic -> OpenAI Forward Translation > translates assistant message with thinking block via .thinking property into reasoning_content [0.11ms]
(pass) Anthropic -> OpenAI Forward Translation > translates multimodal user messages with image base64 and url [0.33ms]
(pass) Anthropic -> OpenAI Forward Translation > translates user message containing tool_result with is_error flag [0.08ms]
(pass) Anthropic -> OpenAI Forward Translation > translates tool_choice with disable_parallel_tool_use: true to parallel_tool_calls: false [0.05ms]
(pass) Anthropic -> OpenAI Forward Translation > strips unwhitelisted Anthropic-only keys from outbound OpenAI request [0.04ms]
(pass) Inbound Payload Validation > rejects document content blocks with clean descriptive message [0.03ms]
(pass) Inbound Payload Validation > accepts valid text, image, and tool_use requests [0.01ms]
(pass) OpenAI -> Anthropic Response Translation (Non-Streaming) > maps finish_reason length to max_tokens even when tool calls exist [0.07ms]
(pass) OpenAI -> Anthropic Response Translation (Non-Streaming) > translates reasoning_content from upstream model to thinking block [0.15ms]
(pass) OpenAI -> Anthropic Response Translation (Non-Streaming) > translates array message.content from OpenAI response properly [0.06ms]
(pass) OpenAI -> Anthropic Response Translation (Non-Streaming) > translates tool_calls in OpenAI response to Anthropic tool_use content blocks [0.04ms]
(pass) OpenAI -> Anthropic SSE Stream Transformation > transforms text chunks and captures final token usage on empty choices with CRLF and comments [2.01ms]
(pass) OpenAI -> Anthropic SSE Stream Transformation > handles upstream in-stream error event on HTTP 200 [0.48ms]
(pass) OpenAI -> Anthropic SSE Stream Transformation > transforms reasoning stream chunks into thinking_delta events [0.93ms]
(pass) OpenAI -> Anthropic SSE Stream Transformation > handles interleaved multi-tool calls without state desync [0.62ms]
(pass) OpenAI -> Anthropic SSE Stream Transformation > passes through native Anthropic SSE events cleanly without corruption [0.43ms]
(pass) Anthropic Error Response Helper > creates compliant Anthropic error envelope [0.11ms]

tests/unit/cooldown.test.ts:
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 65s default cooldown on HTTP 429 rate limit [0.03ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 10s cooldown on transient 5xx server errors [0.06ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 7 days cooldown on 401/403 auth errors [0.02ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 0s cooldown on 400/404 client errors (no penalty on key) [0.01ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns baseline 30s cooldown for unknown errors
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses numeric Retry-After header [0.07ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > clamps sub-minimum delay to 5s min threshold [0.02ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > clamps excessive delay to 7200s max threshold [0.01ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses Google JSON error quotaResetDelay string [0.06ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses Google JSON error retryDelay field in details [0.02ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > flags sub-2s reset delays for immediate grace retry [0.02ms]
(pass) Cooldown Manager — Pool Exhaustion Ladder Backoff > calculates 3-step ladder backoff delays [0.04ms]
(pass) Cooldown Manager — In-Memory Key State Management > quarantines key and tracks remaining cooldown ms [0.07ms]
(pass) Cooldown Manager — In-Memory Key State Management > reports unquarantined once cooldown epoch passes [0.02ms]
(pass) Cooldown Manager — In-Memory Key State Management > flushes all quarantined keys on clearAll [0.04ms]

tests/unit/directive_parser.test.ts:
(pass) Directive Parser — Direct Keys > parses standard OpenRouter claude direct key [0.14ms]
(pass) Directive Parser — Direct Keys > parses NVIDIA OpenAI-format chat direct key with dot-prompt [0.10ms]
(pass) Directive Parser — Direct Keys > parses Google OpenAI beta direct key [0.12ms]
(pass) Directive Parser — Direct Keys > parses Zen provider direct key [0.10ms]
(pass) Directive Parser — Direct Keys > parses all registered 2-letter provider codes [0.11ms]
(pass) Directive Parser — Direct Keys > parses test provider direct keys [0.04ms]
(pass) Directive Parser — Direct Keys > parses ao (Anthropic-to-OpenAI cross-wire) payload code [0.03ms]
(pass) Directive Parser — Direct Keys > parses all registered 2-letter completion codes [0.06ms]
(pass) Directive Parser — Compound Nuances > parses two compound nuances delimited by plus [0.02ms]
(pass) Directive Parser — Compound Nuances > parses three compound nuances [0.02ms]
(pass) Directive Parser — Compound Nuances > parses compound nuances with gemma and strip-budget [0.02ms]
(pass) Directive Parser — Fusion Keys > parses quad fusion preset key [0.04ms]
(pass) Directive Parser — Fusion Keys > parses pydn fusion preset key [0.01ms]
(pass) Directive Parser — Fusion Keys > parses fast and deep presets [0.02ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > normalizes uppercase direct keys to lowercase [0.03ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > trims surrounding whitespace and tabs [0.02ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > normalizes uppercase fusion keys [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects empty or missing key with 401 invalid_api_key [0.03ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects standard OpenAI key format without lr prefix [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects incomplete direct key with only 3 segments
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown provider code [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown payload wire code [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown completion code [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects invalid nuance modifier in compound list [0.02ms]

tests/unit/pacer_cooldown_integration.test.ts:
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 1. Pacer FIFO Queue & Cooldown Dwell Integration > dwells during 1-second cooldown and successfully selects key once expired [1001.03ms]
🔵 [08-24-07:13:47:450] [req_ijt19cx] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/1]
🟢 [08-24-07:13:48:451] [TTFT req_ijt19cx] TTFT = 0ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:48:452] [USAGE req_ijt19cx] OpenAI (Key #1/1)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-24-07:13:48:452] [SERVED req_ijt19cx] HTTP 200 in 0ms
────────────────────────────────────────────────────────────────────────────────
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 1. Pacer FIFO Queue & Cooldown Dwell Integration > handles inbound HTTP request dwelling during 1s cooldown and succeeds with 200 OK [1002.64ms]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 1. Pacer FIFO Queue & Cooldown Dwell Integration > returns null if client aborts while waitAndSelectKey is dwelling [101.59ms]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 2. Load-Shedding on Long Cooldown Budget Overrun > shouldLoadShed returns true immediately when cooldown exceeds wait budget [0.28ms]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 2. Load-Shedding on Long Cooldown Budget Overrun > shouldLoadShed returns false when active keys are available [0.09ms]
🔵 [08-24-07:13:48:554] [req_xnb4vph] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/1]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 2. Load-Shedding on Long Cooldown Budget Overrun > triggers 503 load-shedding response immediately on 60s cooldown without hanging [0.69ms]
🔵 [08-24-07:13:48:555] [req_w1hkjxi] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🔄 [08-24-07:13:50:558] [ROTATE req_w1hkjxi] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:13:50:558] [TTFT req_w1hkjxi] TTFT = 0ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:13:50:558] [USAGE req_w1hkjxi] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-24-07:13:50:559] [SERVED req_w1hkjxi] HTTP 200 in 0ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 3. Transport Error & TTFT Timeout Quarantine Classification > applies 2-second transport quarantine on NoResponseError, NOT 60-second rate limit [2004.25ms]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 3. Transport Error & TTFT Timeout Quarantine Classification > quarantines key for exactly 2 seconds when reportFailure is invoked with customTtlSec 2 [0.28ms]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 3. Transport Error & TTFT Timeout Quarantine Classification > verifies 429 status defaults to 65s rate limit quarantine while transport timeout is 2s [0.13ms]

tests/unit/dots_xml_transformer.test.ts:
(pass) Dots XML Transformer — Static Parsing > parses single XML function invocation into OpenAI tool_calls structure [0.45ms]
(pass) Dots XML Transformer — Static Parsing > parses XML invocation with multiple parameters [0.15ms]
(pass) Dots XML Transformer — Static Parsing > passes through text without XML invocations untouched [0.02ms]
(pass) Dots XML Transformer — Streaming Chunk Handling > handles XML tags split across chunk boundaries [0.38ms]
(pass) Dots XML Tool History Serialization > serializes tool calls to XML invoke blocks inside <tool_calls> [0.18ms]
(pass) Dots XML Tool History Serialization > handles empty or non-JSON arguments in tool call serialization [0.06ms]
(pass) Dots XML Tool History Serialization > serializes assistant tool calls and tool messages into XML conversation history [0.17ms]
(pass) Dots XML Tool History Serialization > integrates with sanitizeAndTransformPayload via 'tc' nuance and merges consecutive user messages [0.82ms]
(pass) Dots XML Tool History Serialization > automatically triggers Dots tool history serialization when model name includes 'dots' [0.15ms]

tests/unit/thinking_transformer.test.ts:
(pass) Thinking Transformer — Streaming Delta Processing > strips thinking block content when preserveThinking is false [0.17ms]
(pass) Thinking Transformer — Streaming Delta Processing > converts thinking block to thinking_delta when preserveThinking is true [0.06ms]
(pass) Thinking Transformer — Streaming Delta Processing > passes clean text without thinking tags as text_delta [0.03ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > preserves reasoning if 'ts' nuance is present, overriding global default [0.02ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > strips reasoning if 'sb' nuance is present, overriding global default [0.01ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > follows global default when neither 'ts' nor 'sb' is specified [0.01ms]
(pass) Thinking Transformer — Payload Parameter Scrubber > removes reasoning and thinking parameters from payload [0.06ms]

tests/unit/zod_schema.test.ts:
(pass) Zod Schema — providers.json Validation > validates a conforming providers configuration [0.48ms]
(pass) Zod Schema — providers.json Validation > rejects invalid base_url format in providers [0.72ms]
(pass) Zod Schema — providers.json Validation > rejects negative rate limits [0.12ms]
(pass) Zod Schema — fusion.json Validation > validates a conforming fusion configuration with presets and tiers [0.40ms]
(pass) Zod Schema — fusion.json Validation > rejects tier missing apikey directive [0.11ms]
(pass) Zod Schema — Environment Variables Auto-Coercion & Defaults > applies resilient defaults when optional env vars are omitted [0.13ms]
(pass) Zod Schema — Environment Variables Auto-Coercion & Defaults > coerces string numbers and booleans properly [0.07ms]

tests/unit/thought_signature.test.ts:
(pass) Google Thought Signature Store — Capture & Injection > saves and retrieves thought signature by tool call id [0.12ms]
(pass) Google Thought Signature Store — Capture & Injection > returns undefined for untracked tool call id [0.02ms]
(pass) Google Thought Signature Store — Capture & Injection > injects saved thought signature into matching historical assistant tool call [0.12ms]
(pass) Google Thought Signature Store — Capture & Injection > leaves messages unchanged if no tool calls exist [0.03ms]
(pass) Google Thought Signature Store — Capture & Injection > clears all stored signatures on clearThoughtSignatures [0.02ms]

tests/unit/auth_extractor.test.ts:
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from standard Authorization Bearer header [0.08ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from case-insensitive bearer prefix [0.02ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from x-api-key header (Anthropic format) [0.02ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?key= (Google format) [0.03ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?api_key= [0.02ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?token= [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes Authorization Bearer over x-api-key header [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes headers over URL query parameters [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes ?key= over ?api_key= in query parameters [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > returns null when no authorization mechanism is present [0.21ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > passes extracted token cleanly to validator for schema verification [0.25ms]

tests/unit/pacer.test.ts:
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > FastFifoQueue (O(1) operations) > enqueues and dequeues elements in FIFO order [0.10ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > FastFifoQueue (O(1) operations) > removes arbitrary nodes from the middle cleanly [0.09ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > FastFifoQueue (O(1) operations) > removes head and tail nodes cleanly [0.03ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > FastFifoQueue (O(1) operations) > clears all elements properly [0.03ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > allows immediate acquisition on cold start or when idle longer than minInterval [38.47ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > enforces minimum interval spacing between consecutive requests [50.87ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > releases multiple queued requests one by one at strict intervals in strict FIFO order [93.15ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > throws PacerQueueOverflowError when max queue depth is exceeded [0.54ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > cancels queued request when client signal is aborted and removes from queue in O(1) [0.69ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > rejects immediately if signal is already aborted before acquire [0.14ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > tracks accurate stats reporting (queueDepth and avgDwellTimeMs) [80.94ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > applies fallback calculations from maxRpm if minIntervalMs is not set [0.66ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > applies provider delays from registry and clears properly [0.17ms]

tests/unit/dots_tool_mapping.test.ts:
(pass) Dots Tool History Serialization & Compaction > transforms assistant message with tool_calls into XML invoke blocks and strips tool_calls [0.24ms]
(pass) Dots Tool History Serialization & Compaction > transforms role: 'tool' message into role: 'user' with <tool_result> wrapping [0.10ms]
(pass) Dots Tool History Serialization & Compaction > transforms multi-turn Claude Code summarization history to contain ZERO tool roles and merges consecutive user turns cleanly (model dots) [0.45ms]
(pass) Dots Tool History Serialization & Compaction > transforms multi-turn summarization history when activated via 'tc' nuance flag [0.83ms]
(pass) Upstream Error Classification — 400 Fail-Fast > classifies HTTP 400 with 'provider returned error' as fail_fast with 0s quarantine and isRetryable: false [0.11ms]

tests/unit/h2_pool.test.ts:
(pass) Outbound HTTP/2 Multiplexed Session Pool > attaches stream lifecycle guard and releases stream count idempotently [0.25ms]
(pass) Outbound HTTP/2 Multiplexed Session Pool > handles in-pool GOAWAY graceful drain and destroys session when active streams hit 0 [0.35ms]
(pass) Outbound HTTP/2 Multiplexed Session Pool > provides session pool telemetry stats across origins [0.31ms]

 360 pass
 0 fail
 1319 expect() calls
Ran 360 tests across 39 files. [16.28s]
============================= test session starts ==============================
platform linux -- Python 3.14.0, pytest-9.0.3, pluggy-1.6.0
rootdir: /home/yapilwsl/arthityap/literouter
configfile: pyproject.toml
plugins: anyio-4.13.0, asyncio-1.3.0, logfire-4.37.0
asyncio: mode=Mode.AUTO, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collected 13 items

tests/integration/smoke/test_downstream_dual.py ss                       [ 15%]
tests/integration/smoke/test_gemini_flash_pass_through.py sss            [ 38%]
tests/integration/test_dots_transformer_e2e.py ..                        [ 53%]
tests/integration/test_e2e_gateway_mock.py ....                          [ 84%]
tests/integration/test_gemini_flash_tool_call.py ss                      [100%]

=============================== warnings summary ===============================
.venv/lib/python3.14/site-packages/google/genai/types.py:42
  /home/yapilwsl/arthityap/literouter/.venv/lib/python3.14/site-packages/google/genai/types.py:42: DeprecationWarning: '_UnionGenericAlias' is deprecated and slated for removal in Python 3.17
    VersionedUnionType = Union[builtin_types.UnionType, _UnionGenericAlias]

tests/integration/test_dots_transformer_e2e.py::test_dots_non_streaming_converts_to_tool_calls
  /home/yapilwsl/arthityap/literouter/.venv/lib/python3.14/site-packages/websockets/legacy/__init__.py:6: DeprecationWarning: websockets.legacy is deprecated; see https://websockets.readthedocs.io/en/stable/howto/upgrade.html for upgrade instructions
    warnings.warn(  # deprecated in 14.0 - 2024-11-09

tests/integration/test_dots_transformer_e2e.py::test_dots_non_streaming_converts_to_tool_calls
  /home/yapilwsl/arthityap/literouter/.venv/lib/python3.14/site-packages/uvicorn/protocols/websockets/websockets_impl.py:17: DeprecationWarning: websockets.server.WebSocketServerProtocol is deprecated
    from websockets.server import WebSocketServerProtocol

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
================== 6 passed, 7 skipped, 3 warnings in 13.12s ===================
