Run started: 2026-08-18T06:06:44Z
bun test v1.3.13 (bf2e2cec)

tests/smoke/health_probe.test.ts:
(pass) Gateway Smoke Health Probes > GET /health responds with 200 OK and healthy status under 50ms [0.85ms]
(pass) Gateway Smoke Health Probes > GET /v1/models probe with valid key returns 200 OK [0.90ms]

tests/integration/models_discovery.test.ts:
(pass) Dynamic Model Discovery Integration > filters models dynamically for OpenRouter direct key [1.11ms]
(pass) Dynamic Model Discovery Integration > filters models dynamically for Google Gemini direct key [0.26ms]
(pass) Dynamic Model Discovery Integration > returns configured models for Fusion preset key [0.27ms]
(pass) Dynamic Model Discovery Integration > serves Google native schema for GET /v1beta/models?key=... [0.27ms]
(pass) Dynamic Model Discovery Integration > rejects model discovery with 401 when key is missing or invalid [0.11ms]

tests/integration/stream_stall_resend.test.ts:
🔵 [08-18-06:06:45:004] [req_32pgpde] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-06:06:45:016] [TTFT req_32pgpde] TTFT = 7ms | Stream established
(pass) Stream Stall Resend Integration > handles mid-stream stall and retries on the same key up to max attempts [26.21ms]

tests/integration/dual_http_h2.test.ts:
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > serves cleartext HTTP/1.1 requests correctly on port 7766 [0.24ms]
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > processes concurrent parallel requests without head-of-line blocking [0.45ms]
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > gracefully falls back when TLS certificates are absent [0.15ms]

tests/integration/hard_reset_flush.test.ts:
(pass) Operational Hard Reset & Flush Integration > handles GET /reset and flushes all rate limits and quarantines [0.93ms]
(pass) Operational Hard Reset & Flush Integration > handles POST /reset unfreezing quarantined key states [0.20ms]

tests/integration/openai_compat.test.ts:
🔵 [08-18-06:06:45:035] [req_tm2f3rs] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-06:06:45:037] [TTFT req_tm2f3rs] TTFT = 2ms | First chunk streamed downstream
🟢 [08-18-06:06:45:038] [USAGE req_tm2f3rs] OpenRouter (Key #1/2)
    Tokens: Prompt=10 | Completion=6 | Total=16 | Speed=3000.0 tok/s
🟢 [08-18-06:06:45:044] [SERVED req_tm2f3rs] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) OpenAI Compatibility Handler Integration > handles non-streaming POST /v1/chat/completions successfully [23.01ms]
🔵 [08-18-06:06:45:059] [req_h20mgsn] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-06:06:45:061] [TTFT req_h20mgsn] TTFT = 2ms | Stream established
(pass) OpenAI Compatibility Handler Integration > handles streaming POST /v1/chat/completions with SSE [16.74ms]
(pass) OpenAI Compatibility Handler Integration > returns 401 when API key directive is missing or malformed [17.26ms]

tests/integration/abort_propagation.test.ts:
🔵 [08-18-06:06:45:099] [req_v7oqs7a] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-06:06:45:101] [TTFT req_v7oqs7a] TTFT = 2ms | Stream established
(pass) Client Abort Signal Propagation Integration > propagates downstream client abort signal upstream immediately [102.70ms]

tests/integration/ghost_response_guard.test.ts:
🔵 [08-18-06:06:45:198] [req_lawngiz] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
⚠️ [08-18-06:06:45:200] [LIMIT req_lawngiz] OpenRouter [Key #1/2] returned 429 Too Many Requests
    Parsed Retry-After: 60s -> Quarantined Key #1 for 60s
🔄 [08-18-06:06:45:201] [ROTATE req_lawngiz] Advancing to OpenRouter [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-06:06:45:202] [TTFT req_lawngiz] TTFT = 1ms | Stream established
(pass) Ghost Response & Zero-Token Guard Integration > detects 0-token HTTP 200 stream, rotates key, and succeeds seamlessly [18.57ms]

tests/integration/google_native.test.ts:
🔵 [08-18-06:06:45:219] [req_60qhal0] Inbound POST /v1beta/models/gemini-2.5-flash:generateContent from unknown
    Directive : lr-gg-gg-gc-no -> Target: Google | Wire: Google | EP: /v1beta/models/gemini-2.5-flash:generateContent
    Model     : gemini-2.5-flash | Key: Google [Key #1/2]
🟢 [08-18-06:06:45:220] [TTFT req_60qhal0] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-06:06:45:220] [SERVED req_60qhal0] HTTP 200 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Google Native & Beta Endpoints Integration > handles native /v1beta/models/*:generateContent with ?key= query auth [17.08ms]
🔵 [08-18-06:06:45:239] [req_tfoblk5] Inbound POST /v1beta/openai/chat/completions from unknown
    Directive : lr-gg-oa-ob-dp -> Target: Google | Wire: OpenAI | EP: /v1beta/openai/chat/completions
    Model     : gemini-2.5-flash | Key: Google [Key #1/2] | Nuances: [dp]
🟢 [08-18-06:06:45:240] [TTFT req_tfoblk5] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-06:06:45:240] [SERVED req_tfoblk5] HTTP 200 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Google Native & Beta Endpoints Integration > handles OpenAI-compatible beta /v1beta/openai/chat/completions [19.91ms]
(pass) Google Native & Beta Endpoints Integration > rejects unauthorized native requests with 401 [19.08ms]

tests/integration/anthropic_compat.test.ts:
🔵 [08-18-06:06:45:280] [req_9xdrqcg] Inbound POST /v1/messages from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-18-06:06:45:282] [TTFT req_9xdrqcg] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-06:06:45:283] [USAGE req_9xdrqcg] Anthropic (Key #1/2)
    Tokens: Prompt=10 | Completion=8 | Total=18 | Speed=8000.0 tok/s
🟢 [08-18-06:06:45:283] [SERVED req_9xdrqcg] HTTP 200 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles non-streaming POST /v1/messages with x-api-key header [21.20ms]
🔵 [08-18-06:06:45:302] [req_llef7yf] Inbound POST /v1/messages from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-18-06:06:45:305] [TTFT req_llef7yf] TTFT = 3ms | Stream established
🟢 [08-18-06:06:45:305] [USAGE req_llef7yf] Anthropic (Key #1/2)
    Tokens: Prompt=0 | Completion=5 | Total=5 | Speed=1666.7 tok/s
🟢 [08-18-06:06:45:305] [SERVED req_llef7yf] HTTP 200 in 3ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles streaming POST /v1/messages and emits SSE event stream [22.61ms]
(pass) Anthropic Compatibility Handler Integration > rejects unauthorized request with 401 when key is missing [16.59ms]

tests/unit/visual_telemetry.test.ts:
(pass) Visual Telemetry & Terminal UI > formats timestamps consistently in [MM-DD-HH:MM:SS:mmm] format [0.24ms]
(pass) Visual Telemetry & Terminal UI > resolves friendly provider and wire display names [0.04ms]
(pass) Visual Telemetry & Terminal UI > formats token numbers with thousands commas [0.14ms]
(pass) Visual Telemetry & Terminal UI > logs rich multi-line inbound request telemetry [0.27ms]
(pass) Visual Telemetry & Terminal UI > logs TTFT and token usage with tok/s speed calculation [0.21ms]
(pass) Visual Telemetry & Terminal UI > logs limit warning with parsed retry-after [0.07ms]
(pass) Visual Telemetry & Terminal UI > logs key rotation with attempt count [0.10ms]
(pass) Visual Telemetry & Terminal UI > logs separator line [0.04ms]

tests/unit/language_guardrail.test.ts:
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-01: enforces zero Chinese character leakage in generic code reasoning and comments [0.09ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-02: detects and flags Chinese token leakage in code outputs [0.03ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-03: preserves 100% genuine Chinese characters in BaZi metaphysics data payloads while keeping explanations in English [0.11ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-04: verifies all 10 Heavenly Stems, 12 Earthly Branches, and Ten Gods in whitelist [0.05ms]

tests/unit/zdist.test.ts:
(pass) Rate Limit Tracker — Sliding Window RPM > records requests and counts within sliding 60s window [0.32ms]
(pass) Rate Limit Tracker — Sliding Window RPM > tracks RPM independently per key index [0.06ms]
(pass) Rate Limit Tracker — Sliding Window RPM > detects 95% threshold approach for RPM ceiling [0.17ms]
(pass) Rate Limit Tracker — Daily RPD Quota > records and returns daily cumulative requests [0.50ms]
(pass) Rate Limit Tracker — Daily RPD Quota > detects 95% threshold approach for daily RPD quota [0.88ms]
(pass) Rate Limit Tracker — Daily RPD Quota > clears all counters on hard reset [0.09ms]

tests/unit/path_resolver.test.ts:
(pass) Path Resolver — providers.json Completion URL Mapping > resolves OpenRouter chat completions endpoint (or, ch) [0.04ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves OpenRouter messages endpoint (or, ms) [0.03ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves NVIDIA chat completions endpoint (nv, ch) [0.04ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google OpenAI-compat beta endpoint (gg, ob) [0.02ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google native generateContent with model substitution (gg, gc) [0.14ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google embeddings with model substitution (gg, em) [0.02ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Anthropic direct messages endpoint (an, ms) [0.02ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Zen chat endpoint (zn, ch)
(pass) Path Resolver — providers.json Completion URL Mapping > returns null for non-existent completion code on provider [0.02ms]
(pass) Path Resolver — Outbound Auth Transformation > formats standard Bearer header for OpenRouter [0.04ms]
(pass) Path Resolver — Outbound Auth Transformation > formats standard Bearer header for NVIDIA NIM [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats x-api-key and anthropic-version for Anthropic direct [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats Bearer header for Google OpenAI beta endpoint (ob) [0.02ms]
(pass) Path Resolver — Outbound Auth Transformation > formats query parameter ?key= for Google Native RPC (gc) [0.01ms]

tests/unit/fusion_sticky.test.ts:
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > returns null when no sticky position is cached [0.10ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > stores and returns sticky tier position on fallback [0.06ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > isolates sticky positions across distinct models [0.02ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > expires sticky position after 5-minute TTL [0.02ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > clears sticky tier when primary recovery succeeds [0.03ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > resets all sticky entries on clearAll [0.02ms]

tests/unit/classifier.test.ts:
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'Provider returned error' as retry_rotate with 0s quarantine [0.13ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'No available provider' as retry_rotate with 0s quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'temporarily unavailable' as retry_rotate with 0s quarantine [0.08ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > handles case-insensitivity for retryable 400 patterns [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'maximum context length' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'context_length' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'safety' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'HARM_PROBABILITY' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies generic 400 errors as fail_fast with 0s quarantine [0.01ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 standard rate limit as retry_rotate with 65s default quarantine [0.13ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > honors Retry-After header for 429 standard rate limit [0.13ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > honors Retry-After in Record<string, string> format [0.03ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'insufficient_quota' as retry_rotate with 7-day (604800s) quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'credit_limit' as retry_rotate with 7-day quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'out of balance' as retry_rotate with 7-day quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 401 as retry_rotate with 7-day (604800s) quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 403 as retry_rotate with 7-day (604800s) quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 500 as retry_rotate with 10s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 502 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 503 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 504 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError > HTTP 404 - Not Found > classifies 404 as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > handles undefined bodyText gracefully [0.01ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > handles empty string bodyText gracefully [0.01ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > safely processes huge bodies (>4KB) without performance degradation or errors [0.12ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > safely handles non-JSON malformed bodies [0.02ms]

tests/unit/gemma_transformer.test.ts:
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > converts system message into prepended [System Context] in first user message [0.92ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > creates a user message if only a system message is present [0.04ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > merges consecutive user messages into a single user turn [0.09ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > merges consecutive assistant messages into a single turn [0.03ms]
(pass) Gemma Transformer — End-to-End Payload Sanitization > applies gemma constraints when 'gm' nuance is provided [0.08ms]
(pass) LaTeX Normalizer > replaces double-escaped times formula with clean unicode [0.02ms]
(pass) LaTeX Normalizer > replaces rightarrow with unicode arrow [0.07ms]
(pass) LaTeX Normalizer > replaces inequality symbols [0.02ms]

tests/unit/fetcher.test.ts:
(pass) Fetcher — Transport Error Wrapping > wraps raw fetch network transport exceptions in NoResponseError when signal is not aborted [0.23ms]
(pass) Fetcher — Transport Error Wrapping > rethrows raw error when clientSignal is aborted [0.23ms]

tests/unit/header_sanitizer.test.ts:
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > strips content-encoding and compression headers from downstream responses [0.84ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > strips all RFC hop-by-hop headers [0.15ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > updates content-length when bodyLength is supplied [0.04ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > omits content-length if bodyLength is undefined [0.03ms]

tests/unit/rotation_loop.test.ts:
🔵 [08-18-06:06:45:343] [req_kr7s7ag] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-06:06:45:343] [TTFT req_kr7s7ag] TTFT = 0ms | First chunk streamed downstream
🔄 [08-18-06:06:45:343] [ROTATE req_kr7s7ag] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-06:06:45:344] [TTFT req_kr7s7ag] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-06:06:45:344] [USAGE req_kr7s7ag] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15 | Speed=5000.0 tok/s
🟢 [08-18-06:06:45:344] [SERVED req_kr7s7ag] HTTP 200 in 1ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 returns 400 'Provider returned error' and succeeds with 200 [1.83ms]
🔵 [08-18-06:06:45:344] [req_vp0q416] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-06:06:45:344] [TTFT req_vp0q416] TTFT = 0ms | First chunk streamed downstream
🟢 [08-18-06:06:45:344] [SERVED req_vp0q416] HTTP 400 in 0ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > fails fast on 400 'maximum context length' without trying Key 2 [0.70ms]
🔵 [08-18-06:06:45:345] [req_6ltmx16] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-06:06:45:345] [TTFT req_6ltmx16] TTFT = 0ms | First chunk streamed downstream
⚠️ [08-18-06:06:45:345] [LIMIT req_6ltmx16] OpenAI [Key #1/2] returned 429 Too Many Requests
    Parsed Retry-After: 30s -> Quarantined Key #1 for 30s
🔄 [08-18-06:06:45:345] [ROTATE req_6ltmx16] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-06:06:45:345] [TTFT req_6ltmx16] TTFT = 0ms | First chunk streamed downstream
🟢 [08-18-06:06:45:346] [USAGE req_6ltmx16] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-18-06:06:45:346] [SERVED req_6ltmx16] HTTP 200 in 0ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 returns 429 Rate Limit and succeeds with 200 [1.20ms]
🔵 [08-18-06:06:45:346] [req_1zk93g2] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-06:06:45:346] [TTFT req_1zk93g2] TTFT = 0ms | First chunk streamed downstream
⚠️ [08-18-06:06:45:346] [LIMIT req_1zk93g2] OpenAI [Key #1/2] returned 401 Too Many Requests
    Parsed Retry-After: 604800s -> Quarantined Key #1 for 604800s
🔄 [08-18-06:06:45:346] [ROTATE req_1zk93g2] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-06:06:45:347] [TTFT req_1zk93g2] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-06:06:45:347] [USAGE req_1zk93g2] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15 | Speed=5000.0 tok/s
🟢 [08-18-06:06:45:347] [SERVED req_1zk93g2] HTTP 200 in 1ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > quarantines Key 1 for 7 days on 401 and succeeds with Key 2 [1.37ms]
🔵 [08-18-06:06:45:347] [req_lpon3uu] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
⚠️ [08-18-06:06:45:348] [LIMIT req_lpon3uu] OpenAI [Key #1/2] returned 429 Too Many Requests
    Parsed Retry-After: 60s -> Quarantined Key #1 for 60s
🔄 [08-18-06:06:45:348] [ROTATE req_lpon3uu] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-06:06:45:348] [TTFT req_lpon3uu] TTFT = 0ms | First chunk streamed downstream
🟢 [08-18-06:06:45:348] [USAGE req_lpon3uu] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-18-06:06:45:348] [SERVED req_lpon3uu] HTTP 200 in 0ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 encounters a raw socket transport error (e.g. 'The connection was closed') and succeeds with 200 [1.36ms]
🔵 [08-18-06:06:45:349] [req_7yvke53] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
💥 [08-18-06:06:45:349] [ERROR req_7yvke53] Unhandled exception in request handler - The operation was aborted
(pass) In-Flight Retry & Rotation Loop > does not retry on Key 2 and propagates abort when clientSignal is aborted [0.60ms]

tests/unit/cooldown.test.ts:
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 65s default cooldown on HTTP 429 rate limit [0.02ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 10s cooldown on transient 5xx server errors [0.02ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 7 days cooldown on 401/403 auth errors [0.03ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 0s cooldown on 400/404 client errors (no penalty on key) [0.01ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns baseline 30s cooldown for unknown errors
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses numeric Retry-After header [0.08ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > clamps sub-minimum delay to 5s min threshold [0.02ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > clamps excessive delay to 7200s max threshold [0.01ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses Google JSON error quotaResetDelay string [0.04ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses Google JSON error retryDelay field in details [0.02ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > flags sub-2s reset delays for immediate grace retry [0.02ms]
(pass) Cooldown Manager — Pool Exhaustion Ladder Backoff > calculates 3-step ladder backoff delays [0.04ms]
(pass) Cooldown Manager — In-Memory Key State Management > quarantines key and tracks remaining cooldown ms [0.04ms]
(pass) Cooldown Manager — In-Memory Key State Management > reports unquarantined once cooldown epoch passes [0.02ms]
(pass) Cooldown Manager — In-Memory Key State Management > flushes all quarantined keys on clearAll [0.02ms]

tests/unit/directive_parser.test.ts:
(pass) Directive Parser — Direct Keys > parses standard OpenRouter claude direct key [0.07ms]
(pass) Directive Parser — Direct Keys > parses NVIDIA OpenAI-format chat direct key with dot-prompt [0.05ms]
(pass) Directive Parser — Direct Keys > parses Google OpenAI beta direct key [0.03ms]
(pass) Directive Parser — Direct Keys > parses Zen provider direct key [0.02ms]
(pass) Directive Parser — Direct Keys > parses all registered 2-letter provider codes [0.15ms]
(pass) Directive Parser — Direct Keys > parses all registered 2-letter completion codes [0.10ms]
(pass) Directive Parser — Compound Nuances > parses two compound nuances delimited by plus [0.02ms]
(pass) Directive Parser — Compound Nuances > parses three compound nuances [0.02ms]
(pass) Directive Parser — Compound Nuances > parses compound nuances with gemma and strip-budget [0.01ms]
(pass) Directive Parser — Fusion Keys > parses quad fusion preset key [0.03ms]
(pass) Directive Parser — Fusion Keys > parses pydn fusion preset key [0.01ms]
(pass) Directive Parser — Fusion Keys > parses fast and deep presets [0.02ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > normalizes uppercase direct keys to lowercase [0.03ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > trims surrounding whitespace and tabs [0.02ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > normalizes uppercase fusion keys [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects empty or missing key with 401 invalid_api_key [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects standard OpenAI key format without lr prefix [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects incomplete direct key with only 3 segments
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown provider code [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown payload wire code [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown completion code [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects invalid nuance modifier in compound list [0.02ms]

tests/unit/dots_xml_transformer.test.ts:
(pass) Dots XML Transformer — Static Parsing > parses single XML function invocation into OpenAI tool_calls structure [1.05ms]
(pass) Dots XML Transformer — Static Parsing > parses XML invocation with multiple parameters [0.16ms]
(pass) Dots XML Transformer — Static Parsing > passes through text without XML invocations untouched [0.03ms]
(pass) Dots XML Transformer — Streaming Chunk Handling > handles XML tags split across chunk boundaries [0.33ms]

tests/unit/thinking_transformer.test.ts:
(pass) Thinking Transformer — Streaming Delta Processing > strips thinking block content when preserveThinking is false [0.13ms]
(pass) Thinking Transformer — Streaming Delta Processing > converts thinking block to thinking_delta when preserveThinking is true [0.07ms]
(pass) Thinking Transformer — Streaming Delta Processing > passes clean text without thinking tags as text_delta [0.03ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > preserves reasoning if 'ts' nuance is present, overriding global default [0.02ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > strips reasoning if 'sb' nuance is present, overriding global default [0.01ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > follows global default when neither 'ts' nor 'sb' is specified [0.01ms]
(pass) Thinking Transformer — Payload Parameter Scrubber > removes reasoning and thinking parameters from payload [0.05ms]

tests/unit/zod_schema.test.ts:
(pass) Zod Schema — providers.json Validation > validates a conforming providers configuration [1.39ms]
(pass) Zod Schema — providers.json Validation > rejects invalid base_url format in providers [0.63ms]
(pass) Zod Schema — providers.json Validation > rejects negative rate limits [0.26ms]
(pass) Zod Schema — fusion.json Validation > validates a conforming fusion configuration with presets and tiers [0.37ms]
(pass) Zod Schema — fusion.json Validation > rejects tier missing apikey directive [0.16ms]
(pass) Zod Schema — Environment Variables Auto-Coercion & Defaults > applies resilient defaults when optional env vars are omitted [0.36ms]
(pass) Zod Schema — Environment Variables Auto-Coercion & Defaults > coerces string numbers and booleans properly [0.12ms]

tests/unit/thought_signature.test.ts:
(pass) Google Thought Signature Store — Capture & Injection > saves and retrieves thought signature by tool call id [0.53ms]
(pass) Google Thought Signature Store — Capture & Injection > returns undefined for untracked tool call id [0.04ms]
(pass) Google Thought Signature Store — Capture & Injection > injects saved thought signature into matching historical assistant tool call [0.12ms]
(pass) Google Thought Signature Store — Capture & Injection > leaves messages unchanged if no tool calls exist [0.03ms]
(pass) Google Thought Signature Store — Capture & Injection > clears all stored signatures on clearThoughtSignatures [0.01ms]

tests/unit/auth_extractor.test.ts:
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from standard Authorization Bearer header [0.07ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from case-insensitive bearer prefix [0.06ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from x-api-key header (Anthropic format) [0.03ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?key= (Google format) [0.05ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?api_key= [0.03ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?token= [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes Authorization Bearer over x-api-key header [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes headers over URL query parameters [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes ?key= over ?api_key= in query parameters [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > returns null when no authorization mechanism is present [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > passes extracted token cleanly to validator for schema verification [0.05ms]

 179 pass
 0 fail
 493 expect() calls
Ran 179 tests across 27 files. [419.00ms]
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
=================== 6 passed, 7 skipped, 3 warnings in 4.43s ===================
