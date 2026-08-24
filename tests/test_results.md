Run started: 2026-08-24T07:05:57Z
$ tsc --noEmit
bun test v1.3.13 (bf2e2cec)

tests/smoke/health_probe.test.ts:
(pass) Gateway Smoke Health Probes > GET /health responds with 200 OK and healthy status under 50ms [0.96ms]
(pass) Gateway Smoke Health Probes > GET /v1/models probe with valid key returns 200 OK [0.87ms]

tests/integration/models_discovery.test.ts:
(pass) Dynamic Model Discovery Integration > filters models dynamically for OpenRouter direct key [1.72ms]
(pass) Dynamic Model Discovery Integration > filters models dynamically for Google Gemini direct key [0.31ms]
(pass) Dynamic Model Discovery Integration > returns configured models for Fusion preset key [0.32ms]
(pass) Dynamic Model Discovery Integration > serves Google native schema for GET /v1beta/models?key=... [0.26ms]
(pass) Dynamic Model Discovery Integration > rejects model discovery with 401 when key is missing or invalid [0.13ms]

tests/integration/stream_stall_resend.test.ts:
🔵 [08-24-07:05:59:156] [req_d88sj22] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:05:59:168] [TTFT req_d88sj22] TTFT = 6ms | Stream established [Upstream: HTTP/1.1]
(pass) Stream Stall Resend Integration > handles mid-stream stall and retries on the same key up to max attempts [29.32ms]

tests/integration/dual_http_h2.test.ts:
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > serves cleartext HTTP/1.1 requests correctly on port 7766 [0.54ms]
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
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > negotiates HTTP/2 when server is started with TLS certs [28.25ms]
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > processes concurrent parallel requests without head-of-line blocking [1.73ms]
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > gracefully falls back when TLS certificates are absent [0.30ms]

tests/integration/h2_resilience.test.ts:
(pass) HTTP/2 & Resiliency End-to-End Integration > returns rich telemetry on /health including h2_outbound and circuit_breakers [0.35ms]
🔵 [08-24-07:05:59:205] [req_bqjq5xe] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-nv-oa-ch-no -> Target: NVIDIA NIM | Wire: OpenAI | EP: /v1/chat/completions
    Model     : meta/llama-3.3-70b-instruct | Key: NVIDIA NIM [Key #1/2]
(pass) HTTP/2 & Resiliency End-to-End Integration > returns clean HTTP 429 when pacer queue is saturated [0.79ms]
🔵 [08-24-07:05:59:205] [req_orx6wec] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-nv-oa-ch-no -> Target: NVIDIA NIM | Wire: OpenAI | EP: /v1/chat/completions
    Model     : meta/llama-3.3-70b-instruct | Key: NVIDIA NIM [Key #1/2]
⚠️ [08-24-07:05:59:206] [LIMIT req_orx6wec] NVIDIA NIM [Key #1/2] returned 503 Too Many Requests
    Parsed Retry-After: 60s -> Quarantined Key #1 for 60s
🔄 [08-24-07:05:59:407] [ROTATE req_orx6wec] Advancing to NVIDIA NIM [Key #2/2] -> Retrying immediately (Attempt 2/2)
⚠️ [08-24-07:05:59:407] [LIMIT req_orx6wec] NVIDIA NIM [Key #2/2] returned 503 Too Many Requests
    Parsed Retry-After: 60s -> Quarantined Key #2 for 60s
💥 [08-24-07:05:59:407] [ERROR req_orx6wec] Direct request attempts exhausted - Provider 'nv' circuit breaker is OPEN
(pass) HTTP/2 & Resiliency End-to-End Integration > fast-fails when circuit breaker is OPEN [201.98ms]

tests/integration/hard_reset_flush.test.ts:
(pass) Operational Hard Reset & Flush Integration > handles GET /reset and flushes all rate limits and quarantines [0.67ms]
(pass) Operational Hard Reset & Flush Integration > handles POST /reset unfreezing quarantined key states [0.39ms]

tests/integration/openai_compat.test.ts:
🔵 [08-24-07:05:59:417] [req_r2gjxic] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:05:59:419] [TTFT req_r2gjxic] TTFT = 2ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:05:59:419] [USAGE req_r2gjxic] OpenRouter (Key #1/2)
    Tokens: Prompt=10 | Completion=6 | Total=16 | Speed=3000.0 tok/s
🟢 [08-24-07:05:59:424] [SERVED req_r2gjxic] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) OpenAI Compatibility Handler Integration > handles non-streaming POST /v1/chat/completions successfully [11.75ms]
🔵 [08-24-07:05:59:439] [req_t9sqhwl] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:05:59:441] [TTFT req_t9sqhwl] TTFT = 2ms | Stream established [Upstream: HTTP/1.1]
(pass) OpenAI Compatibility Handler Integration > handles streaming POST /v1/chat/completions with SSE [17.16ms]
(pass) OpenAI Compatibility Handler Integration > returns 401 when API key directive is missing or malformed [18.15ms]
(pass) OpenAI Compatibility Handler Integration > does not log TTFT when upstream returns 4xx/5xx error [22.83ms]
🔵 [08-24-07:05:59:501] [req_ie0y75w] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
(pass) OpenAI Compatibility Handler Integration > returns 503 load shed when all provider keys are quarantined beyond wait budget [18.91ms]
🔵 [08-24-07:05:59:522] [req_gu5ca08] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:05:59:524] [TTFT req_gu5ca08] TTFT = 1ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:05:59:524] [USAGE req_gu5ca08] OpenRouter (Key #2/2)
    Tokens: Prompt=10 | Completion=6 | Total=16 | Speed=6000.0 tok/s
🟢 [08-24-07:05:59:524] [SERVED req_gu5ca08] HTTP 200 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) OpenAI Compatibility Handler Integration > handles transient cooldown with dwell and does not emit phantom logLimit [22.74ms]

tests/integration/abort_propagation.test.ts:
🔵 [08-24-07:05:59:544] [req_gsxz7c8] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:05:59:546] [TTFT req_gsxz7c8] TTFT = 2ms | Stream established [Upstream: HTTP/1.1]
⚠️ [08-24-07:05:59:577] [LIMIT req_gsxz7c8] OpenRouter [Key #1/2] returned 500 Too Many Requests
    Parsed Retry-After: 60s -> Quarantined Key #1 for 60s
(pass) Client Abort Signal Propagation Integration > propagates downstream client abort signal upstream immediately [102.28ms]

tests/integration/ghost_response_guard.test.ts:
🔵 [08-24-07:05:59:645] [req_ak551h2] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🔄 [08-24-07:05:59:846] [ROTATE req_ak551h2] Advancing to OpenRouter [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:05:59:848] [TTFT req_ak551h2] TTFT = 1ms | Stream established [Upstream: HTTP/1.1]
(pass) Ghost Response & Zero-Token Guard Integration > detects 0-token HTTP 200 stream, rotates key, and succeeds seamlessly [218.84ms]
🔵 [08-24-07:05:59:883] [req_n9ficb4] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:05:59:885] [TTFT req_n9ficb4] TTFT = 2ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:05:59:885] [USAGE req_n9ficb4] OpenRouter (Key #1/2)
    Tokens: Prompt=15 | Completion=25 | Total=40 | Speed=12500.0 tok/s
🟢 [08-24-07:05:59:885] [SERVED req_n9ficb4] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Ghost Response & Zero-Token Guard Integration > does NOT falsely flag non-streaming tool call with null content as ghost response [36.40ms]
🔵 [08-24-07:05:59:916] [req_a1w8ndg] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-24-07:05:59:918] [TTFT req_a1w8ndg] TTFT = 2ms | Stream established [Upstream: HTTP/1.1]
(pass) Ghost Response & Zero-Token Guard Integration > does NOT falsely flag streaming tool call delta without content as ghost response [33.11ms]

tests/integration/google_native.test.ts:
🔵 [08-24-07:05:59:938] [req_w65oejx] Inbound POST /v1beta/models/gemini-2.5-flash:generateContent [HTTP/1.1] from unknown
    Directive : lr-gg-gg-gc-no -> Target: Google | Wire: Google | EP: /v1beta/models/gemini-2.5-flash:generateContent
    Model     : gemini-2.5-flash | Key: Google [Key #1/2]
🟢 [08-24-07:05:59:941] [TTFT req_w65oejx] TTFT = 2ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:05:59:941] [SERVED req_w65oejx] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Google Native & Beta Endpoints Integration > handles native /v1beta/models/*:generateContent with ?key= query auth [21.42ms]
🔵 [08-24-07:05:59:959] [req_2o4z71i] Inbound POST /v1beta/openai/chat/completions [HTTP/1.1] from unknown
    Directive : lr-gg-oa-ob-dp -> Target: Google | Wire: OpenAI | EP: /v1beta/openai/chat/completions
    Model     : gemini-2.5-flash | Key: Google [Key #1/2] | Nuances: [dp]
🟢 [08-24-07:05:59:962] [TTFT req_2o4z71i] TTFT = 2ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:05:59:962] [SERVED req_2o4z71i] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Google Native & Beta Endpoints Integration > handles OpenAI-compatible beta /v1beta/openai/chat/completions [20.72ms]
(pass) Google Native & Beta Endpoints Integration > rejects unauthorized native requests with 401 [17.78ms]

tests/integration/anthropic_compat.test.ts:
🔵 [08-24-07:06:00:001] [req_zu2ukto] Inbound POST /v1/messages [HTTP/1.1] from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-24-07:06:00:004] [TTFT req_zu2ukto] TTFT = 2ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:06:00:008] [USAGE req_zu2ukto] Anthropic (Key #1/2)
    Tokens: Prompt=10 | Completion=8 | Total=18 | Speed=4000.0 tok/s
🟢 [08-24-07:06:00:009] [SERVED req_zu2ukto] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles non-streaming POST /v1/messages with x-api-key header [27.11ms]
🔵 [08-24-07:06:00:023] [req_gb3a7gc] Inbound POST /v1/messages [HTTP/1.1] from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-24-07:06:00:027] [TTFT req_gb3a7gc] TTFT = 3ms | Stream established [Upstream: HTTP/1.1]
🟢 [08-24-07:06:00:027] [USAGE req_gb3a7gc] Anthropic (Key #1/2)
    Tokens: Prompt=0 | Completion=5 | Total=5 | Speed=1666.7 tok/s
🟢 [08-24-07:06:00:028] [SERVED req_gb3a7gc] HTTP 200 in 3ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles streaming POST /v1/messages and emits SSE event stream [18.88ms]
(pass) Anthropic Compatibility Handler Integration > rejects unauthorized request with 401 when key is missing [17.28ms]
(pass) Anthropic Compatibility Handler Integration > does not log TTFT when upstream returns 4xx/5xx error [2024.36ms]
🔵 [08-24-07:06:02:080] [req_hxlhmx1] Inbound POST /v1/messages [HTTP/1.1] from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
(pass) Anthropic Compatibility Handler Integration > returns 503 load shed when all provider keys are quarantined beyond wait budget [10.68ms]
🔵 [08-24-07:06:02:101] [req_71mwlr2] Inbound POST /v1/messages [HTTP/1.1] from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-24-07:06:02:103] [TTFT req_71mwlr2] TTFT = 2ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:06:02:103] [USAGE req_71mwlr2] Anthropic (Key #2/2)
    Tokens: Prompt=10 | Completion=8 | Total=18 | Speed=4000.0 tok/s
🟢 [08-24-07:06:02:103] [SERVED req_71mwlr2] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles transient cooldown with dwell and does not emit phantom logLimit [22.44ms]

tests/unit/visual_telemetry.test.ts:
(pass) Visual Telemetry & Terminal UI > formats timestamps consistently in [MM-DD-HH:MM:SS:mmm] format [0.74ms]
(pass) Visual Telemetry & Terminal UI > resolves friendly provider and wire display names [0.07ms]
(pass) Visual Telemetry & Terminal UI > formats token numbers with thousands commas [0.18ms]
(pass) Visual Telemetry & Terminal UI > logs rich multi-line inbound request telemetry [0.20ms]
(pass) Visual Telemetry & Terminal UI > logs TTFT and token usage with tok/s speed calculation [0.32ms]
(pass) Visual Telemetry & Terminal UI > logs limit warning with parsed retry-after [0.19ms]
(pass) Visual Telemetry & Terminal UI > logs key rotation with attempt count [0.17ms]
(pass) Visual Telemetry & Terminal UI > logs served response with green indicator for 2xx status [0.32ms]
(pass) Visual Telemetry & Terminal UI > logs served response with warning indicator for 4xx/5xx status [0.12ms]
(pass) Visual Telemetry & Terminal UI > logs exhausted error with provider name and backoff ms [0.15ms]
(pass) Visual Telemetry & Terminal UI > logs separator line [0.03ms]

tests/unit/circuit_breaker.test.ts:
(pass) Provider Circuit Breaker with Strict Canary Lease > starts in CLOSED state and allows traffic [0.05ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > trips to OPEN state upon reaching failure threshold of 5xx errors [0.05ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > does not trip for non-critical 4xx errors [0.04ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > transitions from OPEN to HALF_OPEN after cooldown and permits exactly ONE canary probe [60.33ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > kicks back to OPEN immediately if canary probe fails [60.61ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > recovers canary lease if canary probe times out after maxCanaryDurationMs [91.45ms]
(pass) Provider Circuit Breaker with Strict Canary Lease > retrieves and registers singleton breakers correctly via helper [0.25ms]

tests/unit/language_guardrail.test.ts:
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-01: enforces zero Chinese character leakage in generic code reasoning and comments [0.12ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-02: detects and flags Chinese token leakage in code outputs [0.04ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-03: preserves 100% genuine Chinese characters in BaZi metaphysics data payloads while keeping explanations in English [0.13ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-04: verifies all 10 Heavenly Stems, 12 Earthly Branches, and Ten Gods in whitelist [0.08ms]

tests/unit/zdist.test.ts:
(pass) Rate Limit Tracker — Sliding Window RPM > records requests and counts within sliding 60s window [0.36ms]
(pass) Rate Limit Tracker — Sliding Window RPM > tracks RPM independently per key index [0.06ms]
(pass) Rate Limit Tracker — Sliding Window RPM > detects 95% threshold approach for RPM ceiling [0.32ms]
(pass) Rate Limit Tracker — Daily RPD Quota > records and returns daily cumulative requests [0.39ms]
(pass) Rate Limit Tracker — Daily RPD Quota > detects 95% threshold approach for daily RPD quota [0.65ms]
(pass) Rate Limit Tracker — Daily RPD Quota > clears all counters on hard reset [0.07ms]

tests/unit/path_resolver.test.ts:
(pass) Path Resolver — providers.json Completion URL Mapping > resolves OpenRouter chat completions endpoint (or, ch) [0.06ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves OpenRouter messages endpoint (or, ms) [0.01ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves NVIDIA chat completions endpoint (nv, ch) [0.01ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google OpenAI-compat beta endpoint (gg, ob)
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google native generateContent with model substitution (gg, gc) [0.02ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google embeddings with model substitution (gg, em) [0.01ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Anthropic direct messages endpoint (an, ms)
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Zen chat endpoint (zn, ch) [0.01ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Zen models endpoint (zn, md)
(pass) Path Resolver — providers.json Completion URL Mapping > returns null for non-existent completion code on provider [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats standard Bearer header for OpenRouter [0.04ms]
(pass) Path Resolver — Outbound Auth Transformation > formats standard Bearer header for NVIDIA NIM [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats x-api-key and anthropic-version for Anthropic direct [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats Bearer header for Google OpenAI beta endpoint (ob)
(pass) Path Resolver — Outbound Auth Transformation > formats query parameter ?key= for Google Native RPC (gc) [0.01ms]

tests/unit/midstream_retry.test.ts:
(pass) formatMidstreamErrorFrame > formats OpenAI error frame with JSON error payload and data: [DONE] delimiter [0.13ms]
(pass) formatMidstreamErrorFrame > formats Anthropic error frame with SSE event error format [0.10ms]
(pass) isInBandErrorChunk > detects in-band server error chunk containing 'Server error mid-response. The response above may be incomplete.' and returns { isError: true } [0.14ms]
(pass) isInBandErrorChunk > detects 5xx error JSON in SSE chunks and returns { isError: true } [1.19ms]
(pass) isInBandErrorChunk > returns { isError: false } for standard content deltas [0.22ms]
(pass) isInBandErrorChunk > detects finish_reason: network_error and finish_reason: error chunks as errors [0.12ms]
(pass) isInBandErrorChunk > returns { isError: false } for empty byte chunks [0.05ms]
(pass) isLikelySSEDoneMarker > returns true for [DONE] and valid terminal finish_reasons [0.08ms]
(pass) isLikelySSEDoneMarker > returns false for network_error, error, or non-terminal chunks [0.04ms]
(pass) handlePrematureEof > returns null if hasSeenDoneMarker is true [0.16ms]
(pass) handlePrematureEof > returns null if hasSeenDataToken is true [0.09ms]
(pass) handlePrematureEof > calls retryProvider when neither token nor done marker seen [0.20ms]
(pass) createResilientStream — Mid-Stream Error Recovery > suppresses in-band error chunk, calls nextAttemptProvider, and continues streaming downstream until done [1.14ms]
(pass) createResilientStream — Mid-Stream Error Recovery > recovers when upstream reader throws mid-stream (e.g. socket reset) via nextAttemptProvider [0.49ms]
(pass) createResilientStream — Mid-Stream Error Recovery > seals downstream with SSE error frame when midstream retries fail or nextAttemptProvider throws after tokens [0.35ms]
(pass) createResilientStream — Mid-Stream Error Recovery > seals downstream with SSE error frame when nextAttemptProvider returns null / no further attempts after tokens [0.23ms]
(pass) createResilientStream — Mid-Stream Error Recovery > seals downstream with SSE error frame when upstream fails midstream and no nextAttemptProvider is provided [0.26ms]
(pass) createResilientStream — Mid-Stream Error Recovery > errors downstream controller when upstream fails with 0 tokens and no nextAttemptProvider is provided [0.21ms]
(pass) createResilientStream — Mid-Stream Error Recovery > premature EOF with 0 data tokens triggers retryProvider and seamlessly yields chunks from 2nd provider [1.38ms]
(pass) createResilientStream — Mid-Stream Error Recovery > clean EOF after data tokens does NOT trigger retry and closes cleanly [0.46ms]
(pass) createResilientStream — Mid-Stream Error Recovery > clean EOF after [DONE] marker does NOT trigger retry and closes cleanly [0.71ms]
(pass) createResilientStream — Mid-Stream Error Recovery > inspectChunkMarkers accurately tracks [DONE], finish_reason, and content tokens [0.13ms]
(pass) createResilientStream — Mid-Stream Error Recovery > readWithChunkTimeout throws StreamStallError when reading times out [26.43ms]
(pass) createResilientStream — Mid-Stream Error Recovery > inter-chunk stall timeout triggers retryProvider and resumes streaming from 2nd provider [27.12ms]
(pass) createResilientStream — Mid-Stream Error Recovery > retryProvider exhaustion formats downstream OpenAI error frame and terminates cleanly [0.69ms]
(pass) createResilientStream — Mid-Stream Error Recovery > retryProvider exhaustion formats downstream Anthropic error frame and terminates cleanly [0.29ms]
(pass) createResilientStream — Mid-Stream Error Recovery > keepalive comment frames do not count as data tokens, so premature EOF still triggers retry [0.50ms]
(pass) createResilientStream — Mid-Stream Error Recovery > recovers seamlessly when upstream emits finish_reason: network_error on first chunk before tokens [1.72ms]
(pass) createResilientStream — Mid-Stream Error Recovery > detects fragmented TCP packet with finish_reason: network_error split across 2 chunks and retries cleanly [0.78ms]
(pass) createResilientStream — Mid-Stream Error Recovery > midstream drop after tokens outputs clean OpenAI SSE error block and closes without throwing uncaught controller exceptions [0.40ms]
(pass) createResilientStream — Mid-Stream Error Recovery > midstream stall after tokens outputs clean SSE error block and closes cleanly without throwing [23.78ms]
(pass) createResilientStream — Mid-Stream Error Recovery > midstream in-band error after tokens outputs clean SSE error block and closes cleanly [0.73ms]

tests/unit/fusion_sticky.test.ts:
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > returns null when no sticky position is cached [0.13ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > stores and returns sticky tier position on fallback [0.12ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > isolates sticky positions across distinct models [0.05ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > expires sticky position after 5-minute TTL [0.03ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > clears sticky tier when primary recovery succeeds [0.03ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > resets all sticky entries on clearAll [0.03ms]

tests/unit/classifier.test.ts:
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'Provider returned error' as fail_fast with 0s quarantine [0.13ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'No available provider' as retry_rotate with 0s quarantine [0.04ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'temporarily unavailable' as retry_rotate with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > handles case-insensitivity for retryable 400 patterns [0.01ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'maximum context length' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'context_length_exceeded' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'prompt is too long' / context overflow as fail_fast with 0s quarantine [0.09ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies Anthropic context window overflow error as fail_fast with 0s quarantine [0.05ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies Google Gemini token limit exceeded 400 as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'safety' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'HARM_PROBABILITY' as fail_fast with 0s quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies generic 400 errors as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 standard rate limit as retry_rotate with 65s default quarantine [0.20ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > honors Retry-After header for 429 standard rate limit [0.06ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > honors Retry-After in Record<string, string> format [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'insufficient_quota' as retry_rotate with 7-day (604800s) quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'credit_limit' as retry_rotate with 7-day quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'out of balance' as retry_rotate with 7-day quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 401 as retry_rotate with tiered quarantine (default/1st failure = 300s) [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 403 as retry_rotate with tiered quarantine (default/1st failure = 300s) [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 401 with consecutiveAuthFailures = 2 as 1800s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 403 with consecutiveAuthFailures >= 3 as 86400s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 5xx - Transient server errors > classifies HTTP 500 as retry_rotate with 10s quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 5xx - Transient server errors > classifies HTTP 502 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 5xx - Transient server errors > classifies HTTP 503 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 5xx - Transient server errors > classifies HTTP 504 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > HTTP 404 - Not Found > classifies 404 as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates TCP RST / ECONNRESET with 2s cooldown quarantine [0.05ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates socket EOF / hang up with 2s cooldown quarantine [0.01ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates ConnectTimeout with 2s cooldown quarantine [0.01ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates status 0 pre-stream transport reset with 2s cooldown quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates TTFT timeout with 2s transient quarantine [0.01ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates NoResponse / timed out waiting for first chunk with 2s transient quarantine [0.01ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Transport & Network Connection Drops (Pre-TTFT) > evaluates status 0 TTFT timeout with 2s transient quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Robustness & Bounded parsing > handles undefined bodyText gracefully [0.09ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Robustness & Bounded parsing > handles empty string bodyText gracefully [0.03ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Robustness & Bounded parsing > safely processes huge bodies (>4KB) without performance degradation or errors [0.12ms]
(pass) Error Classifier — classifyUpstreamError & classifyTransportError > Robustness & Bounded parsing > safely handles non-JSON malformed bodies [0.03ms]

tests/unit/gemma_transformer.test.ts:
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > converts system message into prepended [System Context] in first user message [0.33ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > creates a user message if only a system message is present [0.18ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > merges consecutive user messages into a single user turn [0.13ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > merges consecutive assistant messages into a single turn [0.02ms]
(pass) Gemma Transformer — End-to-End Payload Sanitization > applies gemma constraints when 'gm' nuance is provided [0.10ms]
(pass) LaTeX Normalizer > replaces double-escaped times formula with clean unicode [0.02ms]
(pass) LaTeX Normalizer > replaces rightarrow with unicode arrow [0.08ms]
(pass) LaTeX Normalizer > replaces inequality symbols [0.02ms]

tests/unit/fetcher.test.ts:
(pass) Fetcher — Transport Error Wrapping > wraps raw fetch network transport exceptions in NoResponseError when signal is not aborted [0.39ms]
(pass) Fetcher — Transport Error Wrapping > rethrows raw error when clientSignal is aborted [0.36ms]
(pass) Dynamic TTFT Resolution (`resolveTtftTimeout`) > defaults to 120000ms (120s) when model is undefined or empty [0.21ms]
(pass) Dynamic TTFT Resolution (`resolveTtftTimeout`) > uses envTimeoutMs when provided for all models [0.06ms]
(pass) Dynamic TTFT Resolution (`resolveTtftTimeout`) > unifies TTFT timeout to 120000ms across all models including reasoning and preview models [0.20ms]
(pass) Wire-Compliant Midstream Error Frame (`formatMidstreamErrorFrame`) > formats Anthropic error frame correctly for 'anthropic' and 'cl' [0.11ms]
(pass) Wire-Compliant Midstream Error Frame (`formatMidstreamErrorFrame`) > formats OpenAI error frame correctly with [DONE] marker for 'openai' and default [0.06ms]
(pass) Stream First Chunk TTFT Timeout (`readFirstChunkWithTimeout`) > rejects with NoResponseError when chunk is not read within timeoutMs [51.08ms]
(pass) Stream First Chunk TTFT Timeout (`readFirstChunkWithTimeout`) > resolves promptly when first chunk is received before timeoutMs [0.91ms]
(pass) Content Chunk Reading with Multi-Packet Buffering (`readFirstContentChunkWithTimeout`) > buffers initial empty newlines/preambles until content arrives and returns combined buffer [0.52ms]
(pass) Content Chunk Reading with Multi-Packet Buffering (`readFirstContentChunkWithTimeout`) > throws NoResponseError when stream closes with 0 content tokens after empty chunks [0.27ms]

tests/unit/key_pool_event_driven.test.ts:
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 1: Event-driven key availability resolution without polling > wakes up immediately when TTL timer expires without manual polling [101.90ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 1: Event-driven key availability resolution without polling > resolves immediately when a key is already available [0.25ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 2: Thundering-herd safety & concurrency > handles 10 concurrent waiters gracefully without unhandled promise rejections [81.01ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 2: Thundering-herd safety & concurrency > allows fast waiters to timeout while slower waiters acquire key on wake [101.08ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 3: AbortSignal cleanup & zero listener leaks > cleans up event listeners upon AbortSignal trigger [0.42ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 3: AbortSignal cleanup & zero listener leaks > cleans up event listeners upon timeout expiration [50.90ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 3: AbortSignal cleanup & zero listener leaks > cleans up event listeners upon successful key acquisition after event wakeup [50.52ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 4: Consecutive 401/403 auth failure quarantine escalation > escalates quarantine through 300s -> 1800s -> 86400s on consecutive auth failures [0.31ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 4: Consecutive 401/403 auth failure quarantine escalation > resets consecutive auth failures to 0 upon reportSuccess [0.06ms]
(pass) KeyPool — Event-Driven Key Availability & Lifecycle > Test 5: Targeted reset(provider) isolation > clears only specified provider cooldowns and timers while preserving other providers [0.39ms]

tests/unit/header_sanitizer.test.ts:
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > strips content-encoding and compression headers from downstream responses [0.20ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > strips all RFC hop-by-hop headers [0.16ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > updates content-length when bodyLength is supplied [0.08ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > omits content-length if bodyLength is undefined [0.05ms]

tests/unit/rotation_loop.test.ts:
🔵 [08-24-07:06:02:909] [req_gsbc7gi] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🔄 [08-24-07:06:04:911] [ROTATE req_gsbc7gi] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:06:04:912] [TTFT req_gsbc7gi] TTFT = 1ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:06:04:912] [USAGE req_gsbc7gi] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15 | Speed=5000.0 tok/s
🟢 [08-24-07:06:04:912] [SERVED req_gsbc7gi] HTTP 200 in 1ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 returns 400 'no available provider' and succeeds with 200 [2004.37ms]
🔵 [08-24-07:06:04:914] [req_zvctkgu] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
⚠️ [08-24-07:06:04:915] [SERVED req_zvctkgu] HTTP 400 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > fails fast on 400 'maximum context length' without trying Key 2 [1.95ms]
🔵 [08-24-07:06:04:916] [req_85mwxsj] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
⚠️ [08-24-07:06:04:916] [LIMIT req_85mwxsj] OpenAI [Key #1/2] returned 429 Too Many Requests
    Parsed Retry-After: 30s -> Quarantined Key #1 for 30s
🔄 [08-24-07:06:06:917] [ROTATE req_85mwxsj] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:06:06:918] [TTFT req_85mwxsj] TTFT = 0ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:06:06:918] [USAGE req_85mwxsj] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-24-07:06:06:918] [SERVED req_85mwxsj] HTTP 200 in 0ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 returns 429 Rate Limit and succeeds with 200 [2003.44ms]
🔵 [08-24-07:06:06:919] [req_weg1cv7] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
⚠️ [08-24-07:06:06:920] [LIMIT req_weg1cv7] OpenAI [Key #1/2] returned 401 Too Many Requests
    Parsed Retry-After: 300s -> Quarantined Key #1 for 300s
🔄 [08-24-07:06:08:920] [ROTATE req_weg1cv7] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:06:08:921] [TTFT req_weg1cv7] TTFT = 1ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:06:08:921] [USAGE req_weg1cv7] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15 | Speed=5000.0 tok/s
🟢 [08-24-07:06:08:921] [SERVED req_weg1cv7] HTTP 200 in 1ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > quarantines Key 1 on 401 (tiered quarantine: 300s for 1st failure) and succeeds with Key 2 [2002.97ms]
🔵 [08-24-07:06:08:922] [req_adsrbde] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🔄 [08-24-07:06:10:924] [ROTATE req_adsrbde] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:06:10:925] [TTFT req_adsrbde] TTFT = 0ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:06:10:926] [USAGE req_adsrbde] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-24-07:06:10:926] [SERVED req_adsrbde] HTTP 200 in 0ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 encounters a raw socket transport error (e.g. 'The connection was closed') and succeeds with 200 [2005.06ms]
🔵 [08-24-07:06:10:927] [req_squkx8x] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
(pass) In-Flight Retry & Rotation Loop > does not retry on Key 2 and propagates abort when clientSignal is aborted [1.47ms]

tests/unit/payload_scrubbing.test.ts:
(pass) Payload Scrubbing Toggle (LITEROUTER_ENABLE_SCRUBBING) > preserves thinking, tools, and gemma params when enableScrubbing is false [0.12ms]
(pass) Payload Scrubbing Toggle (LITEROUTER_ENABLE_SCRUBBING) > scrubs thinking, tools, and gemma params when enableScrubbing is true [0.13ms]
(pass) Payload Scrubbing Toggle (LITEROUTER_ENABLE_SCRUBBING) > scrubUnsupportedParameters directly respects enableScrubbing flag [0.03ms]
(pass) Inbound Request Reasoning Scrubbing (OpenCode2 Inbound Payload) > scrubs a message with 375+ reasoning parts down to pure text content [0.32ms]
(pass) Inbound Request Reasoning Scrubbing (OpenCode2 Inbound Payload) > normalizes empty message content to empty string when all parts are reasoning [0.10ms]
(pass) Inbound Request Reasoning Scrubbing (OpenCode2 Inbound Payload) > preserves multi-part content arrays if multiple non-reasoning parts remain [0.06ms]
(pass) Inbound Request Reasoning Scrubbing (OpenCode2 Inbound Payload) > pipeline sanitizeAndTransformPayload / cleanOpenAIBody scrubs full conversation history with 375+ reasoning parts [0.42ms]
(pass) Inbound Request Reasoning Scrubbing (OpenCode2 Inbound Payload) > handles undefined or empty messages array gracefully [0.02ms]
(pass) Strict Tool Payload Normalization & Client Metadata Stripping > normalizes role: 'tool' content array into a single newline-separated string [0.10ms]
(pass) Strict Tool Payload Normalization & Client Metadata Stripping > ensures role: 'tool' content is always a string even if null or undefined [0.02ms]
(pass) Strict Tool Payload Normalization & Client Metadata Stripping > strips client metadata from role: 'user' and role: 'assistant' messages while preserving standard fields [0.06ms]

tests/unit/opencode_reasoning_filter.test.ts:
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > detects opencode User-Agent strings (case-insensitive) [0.03ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > does not match non-OpenCode User-Agents (e.g. pydantic-ai, curl, python) [0.03ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > detects x-opencode header via Headers instance [0.03ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > detects x-opencode header via record object [0.02ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > detects x-client-name header when containing opencode [0.02ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > activates on 'sb' (strip budget/reasoning) nuance even without opencode header [0.02ms]
(pass) OpenCode Reasoning Filter — Client Detection (isOpenCodeClient) > is overridden by 'ts' (thinking support) nuance, preserving reasoning for opencode [0.01ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > strips reasoning_content, reasoning, and reasoning_details from delta and returns shouldEmit: false if only reasoning was present [0.19ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > preserves delta and returns shouldEmit: true when delta contains content [0.05ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > preserves delta and returns shouldEmit: true when delta contains role: assistant [0.03ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > preserves delta and returns shouldEmit: true when delta contains tool_calls [0.03ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > returns shouldEmit: true when finish_reason is present (e.g. stop or tool_calls) [0.03ms]
(pass) OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk) > returns shouldEmit: true when usage stats are present in chunk [0.02ms]
(pass) OpenCode Reasoning Filter — Stream Transformer (createOpenCodeReasoningFilterStreamTransformer) > filters out reasoning deltas while keeping role, content, finish_reason, and [DONE] [2.42ms]
(pass) OpenCode Reasoning Filter — Stream Transformer (createOpenCodeReasoningFilterStreamTransformer) > handles chunk fragmentation across stream reads cleanly [0.37ms]
(pass) OpenCode Reasoning Filter — Stream Transformer (createOpenCodeReasoningFilterStreamTransformer) > ensures non-OpenCode clients (like Pydantic AI) preserve the raw reasoning stream intact [0.17ms]
(pass) OpenCode Reasoning Filter — Non-Streaming Response Body (stripReasoningFromResponseBody) > strips reasoning, reasoning_content, and reasoning_details from json choices and messages [0.16ms]
(pass) OpenCode2 Downstream SSE Stream — Live Thinking Delivery > delivers reasoning deltas unmodified to OpenCode2 by default so TUI renders thinking [0.13ms]
(pass) OpenCode2 Downstream SSE Stream — Live Thinking Delivery > strips reasoning deltas when 'sb' (strip budget/reasoning) nuance is explicitly requested [0.67ms]
(pass) OpenCode2 Downstream SSE Stream — Live Thinking Delivery > safely drops reasoning chunks where content is null without emitting invalid null content to OpenCode [0.24ms]

tests/unit/admin_pool_reset.test.ts:
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > rejects unauthorized access when no token is provided [0.99ms]
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > rejects unauthorized access when an invalid token is provided [0.42ms]
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > allows access with valid master LITEROUTER_AUTH_KEY and performs hard reset if no provider [0.65ms]
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > allows access with valid directive token in Authorization header [0.44ms]
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > resets a specific provider via query parameter [0.50ms]
(pass) Admin Pool Reset Endpoint (/admin/pool/reset) > resets a specific provider via JSON body [0.60ms]

tests/unit/anthropic_openai_compat.test.ts:
(pass) Anthropic -> OpenAI Forward Translation > translates basic system and user messages [0.34ms]
(pass) Anthropic -> OpenAI Forward Translation > does not include stream_options or max_completion_tokens by default when streaming [0.05ms]
(pass) Anthropic -> OpenAI Forward Translation > translates array system prompt with multiple text blocks [0.10ms]
(pass) Anthropic -> OpenAI Forward Translation > translates Anthropic tool definitions (input_schema -> parameters) [0.09ms]
(pass) Anthropic -> OpenAI Forward Translation > translates assistant message with thinking block via .thinking property into reasoning_content [0.15ms]
(pass) Anthropic -> OpenAI Forward Translation > translates multimodal user messages with image base64 and url [0.14ms]
(pass) Anthropic -> OpenAI Forward Translation > translates user message containing tool_result with is_error flag [0.08ms]
(pass) Anthropic -> OpenAI Forward Translation > translates tool_choice with disable_parallel_tool_use: true to parallel_tool_calls: false [0.06ms]
(pass) Anthropic -> OpenAI Forward Translation > strips unwhitelisted Anthropic-only keys from outbound OpenAI request [0.05ms]
(pass) Inbound Payload Validation > rejects document content blocks with clean descriptive message [0.03ms]
(pass) Inbound Payload Validation > accepts valid text, image, and tool_use requests [0.02ms]
(pass) OpenAI -> Anthropic Response Translation (Non-Streaming) > maps finish_reason length to max_tokens even when tool calls exist [0.10ms]
(pass) OpenAI -> Anthropic Response Translation (Non-Streaming) > translates reasoning_content from upstream model to thinking block [0.26ms]
(pass) OpenAI -> Anthropic Response Translation (Non-Streaming) > translates array message.content from OpenAI response properly [0.06ms]
(pass) OpenAI -> Anthropic Response Translation (Non-Streaming) > translates tool_calls in OpenAI response to Anthropic tool_use content blocks [0.05ms]
(pass) OpenAI -> Anthropic SSE Stream Transformation > transforms text chunks and captures final token usage on empty choices with CRLF and comments [1.24ms]
(pass) OpenAI -> Anthropic SSE Stream Transformation > handles upstream in-stream error event on HTTP 200 [0.34ms]
(pass) OpenAI -> Anthropic SSE Stream Transformation > transforms reasoning stream chunks into thinking_delta events [1.05ms]
(pass) OpenAI -> Anthropic SSE Stream Transformation > handles interleaved multi-tool calls without state desync [0.67ms]
(pass) OpenAI -> Anthropic SSE Stream Transformation > passes through native Anthropic SSE events cleanly without corruption [0.42ms]
(pass) Anthropic Error Response Helper > creates compliant Anthropic error envelope [0.13ms]

tests/unit/cooldown.test.ts:
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 65s default cooldown on HTTP 429 rate limit [0.04ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 10s cooldown on transient 5xx server errors [0.02ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 7 days cooldown on 401/403 auth errors [0.01ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 0s cooldown on 400/404 client errors (no penalty on key) [0.01ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns baseline 30s cooldown for unknown errors
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses numeric Retry-After header [0.06ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > clamps sub-minimum delay to 5s min threshold [0.02ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > clamps excessive delay to 7200s max threshold [0.02ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses Google JSON error quotaResetDelay string [0.05ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses Google JSON error retryDelay field in details [0.03ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > flags sub-2s reset delays for immediate grace retry [0.02ms]
(pass) Cooldown Manager — Pool Exhaustion Ladder Backoff > calculates 3-step ladder backoff delays [0.06ms]
(pass) Cooldown Manager — In-Memory Key State Management > quarantines key and tracks remaining cooldown ms [0.07ms]
(pass) Cooldown Manager — In-Memory Key State Management > reports unquarantined once cooldown epoch passes [0.02ms]
(pass) Cooldown Manager — In-Memory Key State Management > flushes all quarantined keys on clearAll [0.03ms]

tests/unit/directive_parser.test.ts:
(pass) Directive Parser — Direct Keys > parses standard OpenRouter claude direct key [0.12ms]
(pass) Directive Parser — Direct Keys > parses NVIDIA OpenAI-format chat direct key with dot-prompt [0.04ms]
(pass) Directive Parser — Direct Keys > parses Google OpenAI beta direct key [0.03ms]
(pass) Directive Parser — Direct Keys > parses Zen provider direct key [0.02ms]
(pass) Directive Parser — Direct Keys > parses all registered 2-letter provider codes [0.09ms]
(pass) Directive Parser — Direct Keys > parses test provider direct keys [0.04ms]
(pass) Directive Parser — Direct Keys > parses ao (Anthropic-to-OpenAI cross-wire) payload code [0.02ms]
(pass) Directive Parser — Direct Keys > parses all registered 2-letter completion codes [0.09ms]
(pass) Directive Parser — Compound Nuances > parses two compound nuances delimited by plus [0.03ms]
(pass) Directive Parser — Compound Nuances > parses three compound nuances [0.02ms]
(pass) Directive Parser — Compound Nuances > parses compound nuances with gemma and strip-budget [0.02ms]
(pass) Directive Parser — Fusion Keys > parses quad fusion preset key [0.03ms]
(pass) Directive Parser — Fusion Keys > parses pydn fusion preset key [0.02ms]
(pass) Directive Parser — Fusion Keys > parses fast and deep presets [0.02ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > normalizes uppercase direct keys to lowercase [0.03ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > trims surrounding whitespace and tabs [0.03ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > normalizes uppercase fusion keys [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects empty or missing key with 401 invalid_api_key [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects standard OpenAI key format without lr prefix [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects incomplete direct key with only 3 segments [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown provider code [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown payload wire code [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown completion code [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects invalid nuance modifier in compound list [0.03ms]

tests/unit/pacer_cooldown_integration.test.ts:
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 1. Pacer FIFO Queue & Cooldown Dwell Integration > dwells during 1-second cooldown and successfully selects key once expired [1001.53ms]
🔵 [08-24-07:06:11:970] [req_20hyx6w] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/1]
🟢 [08-24-07:06:12:972] [TTFT req_20hyx6w] TTFT = 1ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:06:12:972] [USAGE req_20hyx6w] OpenAI (Key #1/1)
    Tokens: Prompt=10 | Completion=5 | Total=15 | Speed=5000.0 tok/s
🟢 [08-24-07:06:12:972] [SERVED req_20hyx6w] HTTP 200 in 1ms
────────────────────────────────────────────────────────────────────────────────
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 1. Pacer FIFO Queue & Cooldown Dwell Integration > handles inbound HTTP request dwelling during 1s cooldown and succeeds with 200 OK [1003.30ms]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 1. Pacer FIFO Queue & Cooldown Dwell Integration > returns null if client aborts while waitAndSelectKey is dwelling [101.13ms]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 2. Load-Shedding on Long Cooldown Budget Overrun > shouldLoadShed returns true immediately when cooldown exceeds wait budget [0.32ms]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 2. Load-Shedding on Long Cooldown Budget Overrun > shouldLoadShed returns false when active keys are available [0.11ms]
🔵 [08-24-07:06:13:075] [req_k76inst] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/1]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 2. Load-Shedding on Long Cooldown Budget Overrun > triggers 503 load-shedding response immediately on 60s cooldown without hanging [0.61ms]
🔵 [08-24-07:06:13:075] [req_vx8k5u8] Inbound POST /v1/chat/completions [HTTP/1.1] from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🔄 [08-24-07:06:15:077] [ROTATE req_vx8k5u8] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-24-07:06:15:077] [TTFT req_vx8k5u8] TTFT = 0ms | First chunk streamed downstream [Upstream: HTTP/1.1]
🟢 [08-24-07:06:15:077] [USAGE req_vx8k5u8] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-24-07:06:15:078] [SERVED req_vx8k5u8] HTTP 200 in 0ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 3. Transport Error & TTFT Timeout Quarantine Classification > applies 2-second transport quarantine on NoResponseError, NOT 60-second rate limit [2002.81ms]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 3. Transport Error & TTFT Timeout Quarantine Classification > quarantines key for exactly 2 seconds when reportFailure is invoked with customTtlSec 2 [0.25ms]
(pass) Pacer Cooldown Integration, Load-Shedding & Transport Error Classification > 3. Transport Error & TTFT Timeout Quarantine Classification > verifies 429 status defaults to 65s rate limit quarantine while transport timeout is 2s [0.16ms]

tests/unit/dots_xml_transformer.test.ts:
(pass) Dots XML Transformer — Static Parsing > parses single XML function invocation into OpenAI tool_calls structure [0.49ms]
(pass) Dots XML Transformer — Static Parsing > parses XML invocation with multiple parameters [0.07ms]
(pass) Dots XML Transformer — Static Parsing > passes through text without XML invocations untouched [0.02ms]
(pass) Dots XML Transformer — Streaming Chunk Handling > handles XML tags split across chunk boundaries [0.27ms]
(pass) Dots XML Tool History Serialization > serializes tool calls to XML invoke blocks inside <tool_calls> [0.15ms]
(pass) Dots XML Tool History Serialization > handles empty or non-JSON arguments in tool call serialization [0.05ms]
(pass) Dots XML Tool History Serialization > serializes assistant tool calls and tool messages into XML conversation history [0.12ms]
(pass) Dots XML Tool History Serialization > integrates with sanitizeAndTransformPayload via 'tc' nuance and merges consecutive user messages [0.13ms]
(pass) Dots XML Tool History Serialization > automatically triggers Dots tool history serialization when model name includes 'dots' [0.27ms]

tests/unit/thinking_transformer.test.ts:
(pass) Thinking Transformer — Streaming Delta Processing > strips thinking block content when preserveThinking is false [0.14ms]
(pass) Thinking Transformer — Streaming Delta Processing > converts thinking block to thinking_delta when preserveThinking is true [0.06ms]
(pass) Thinking Transformer — Streaming Delta Processing > passes clean text without thinking tags as text_delta [0.03ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > preserves reasoning if 'ts' nuance is present, overriding global default [0.01ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > strips reasoning if 'sb' nuance is present, overriding global default
(pass) Thinking Transformer — Reasoning Stripping Policy > follows global default when neither 'ts' nor 'sb' is specified [0.01ms]
(pass) Thinking Transformer — Payload Parameter Scrubber > removes reasoning and thinking parameters from payload [0.04ms]

tests/unit/zod_schema.test.ts:
(pass) Zod Schema — providers.json Validation > validates a conforming providers configuration [0.34ms]
(pass) Zod Schema — providers.json Validation > rejects invalid base_url format in providers [0.78ms]
(pass) Zod Schema — providers.json Validation > rejects negative rate limits [0.11ms]
(pass) Zod Schema — fusion.json Validation > validates a conforming fusion configuration with presets and tiers [0.31ms]
(pass) Zod Schema — fusion.json Validation > rejects tier missing apikey directive [0.08ms]
(pass) Zod Schema — Environment Variables Auto-Coercion & Defaults > applies resilient defaults when optional env vars are omitted [0.12ms]
(pass) Zod Schema — Environment Variables Auto-Coercion & Defaults > coerces string numbers and booleans properly [0.06ms]

tests/unit/thought_signature.test.ts:
(pass) Google Thought Signature Store — Capture & Injection > saves and retrieves thought signature by tool call id [0.06ms]
(pass) Google Thought Signature Store — Capture & Injection > returns undefined for untracked tool call id [0.02ms]
(pass) Google Thought Signature Store — Capture & Injection > injects saved thought signature into matching historical assistant tool call [0.11ms]
(pass) Google Thought Signature Store — Capture & Injection > leaves messages unchanged if no tool calls exist [0.02ms]
(pass) Google Thought Signature Store — Capture & Injection > clears all stored signatures on clearThoughtSignatures [0.03ms]

tests/unit/auth_extractor.test.ts:
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from standard Authorization Bearer header [0.11ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from case-insensitive bearer prefix [0.03ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from x-api-key header (Anthropic format) [0.02ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?key= (Google format) [0.03ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?api_key= [0.01ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?token= [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes Authorization Bearer over x-api-key header [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes headers over URL query parameters [0.01ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes ?key= over ?api_key= in query parameters [0.03ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > returns null when no authorization mechanism is present [0.01ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > passes extracted token cleanly to validator for schema verification [0.06ms]

tests/unit/pacer.test.ts:
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > FastFifoQueue (O(1) operations) > enqueues and dequeues elements in FIFO order [0.07ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > FastFifoQueue (O(1) operations) > removes arbitrary nodes from the middle cleanly [0.07ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > FastFifoQueue (O(1) operations) > removes head and tail nodes cleanly [0.03ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > FastFifoQueue (O(1) operations) > clears all elements properly [0.02ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > allows immediate acquisition on cold start or when idle longer than minInterval [30.71ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > enforces minimum interval spacing between consecutive requests [50.49ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > releases multiple queued requests one by one at strict intervals in strict FIFO order [93.03ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > throws PacerQueueOverflowError when max queue depth is exceeded [0.32ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > cancels queued request when client signal is aborted and removes from queue in O(1) [0.22ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > rejects immediately if signal is already aborted before acquire [0.09ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > tracks accurate stats reporting (queueDepth and avgDwellTimeMs) [81.07ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > applies fallback calculations from maxRpm if minIntervalMs is not set [0.29ms]
(pass) Pure FIFO Conveyor Belt Pacer & Anti-429 Queue > RequestPacer conveyor belt pacing & rate limiting > applies provider delays from registry and clears properly [0.13ms]

tests/unit/dots_tool_mapping.test.ts:
(pass) Dots Tool History Serialization & Compaction > transforms assistant message with tool_calls into XML invoke blocks and strips tool_calls [0.22ms]
(pass) Dots Tool History Serialization & Compaction > transforms role: 'tool' message into role: 'user' with <tool_result> wrapping [0.09ms]
(pass) Dots Tool History Serialization & Compaction > transforms multi-turn Claude Code summarization history to contain ZERO tool roles and merges consecutive user turns cleanly (model dots) [0.30ms]
(pass) Dots Tool History Serialization & Compaction > transforms multi-turn summarization history when activated via 'tc' nuance flag [0.11ms]
(pass) Upstream Error Classification — 400 Fail-Fast > classifies HTTP 400 with 'provider returned error' as fail_fast with 0s quarantine and isRetryable: false [0.07ms]

tests/unit/h2_pool.test.ts:
(pass) Outbound HTTP/2 Multiplexed Session Pool > attaches stream lifecycle guard and releases stream count idempotently [0.36ms]
(pass) Outbound HTTP/2 Multiplexed Session Pool > handles in-pool GOAWAY graceful drain and destroys session when active streams hit 0 [0.13ms]
(pass) Outbound HTTP/2 Multiplexed Session Pool > provides session pool telemetry stats across origins [0.11ms]

 360 pass
 0 fail
 1319 expect() calls
Ran 360 tests across 39 files. [16.25s]
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
================== 6 passed, 7 skipped, 3 warnings in 12.90s ===================
