Run started: 2026-07-31T16:47:05Z
============================= test session starts ==============================
platform linux -- Python 3.14.0, pytest-9.0.3, pluggy-1.6.0
rootdir: /home/yapilwsl/arthityap/literouter
configfile: pyproject.toml
plugins: anyio-4.13.0, asyncio-1.3.0, logfire-4.37.0
asyncio: mode=Mode.AUTO, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collected 7 items

tests/integration/smoke/test_downstream_dual.py ss                       [ 28%]
tests/integration/smoke/test_gemini_flash_pass_through.py ...            [ 71%]
tests/integration/test_gemini_flash_tool_call.py ..                      [100%]

=============================== warnings summary ===============================
.venv/lib/python3.14/site-packages/google/genai/types.py:42
  /home/yapilwsl/arthityap/literouter/.venv/lib/python3.14/site-packages/google/genai/types.py:42: DeprecationWarning: '_UnionGenericAlias' is deprecated and slated for removal in Python 3.17
    VersionedUnionType = Union[builtin_types.UnionType, _UnionGenericAlias]

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
=================== 5 passed, 2 skipped, 1 warning in 8.04s ====================
Run started: 2026-08-10T02:15:10Z
### Full Suite: bun test && uv run pytest tests/integration/
bun test v1.3.13 (bf2e2cec)

tests/unit/core/gateway.test.ts:
[GOOGLE] Gate 1 Static Validator: Discarded invalid key.
[GOOGLE] Gate 1 Static Validator: Discarded invalid key.
[GOOGLE] Gate 1 Static Validator: Discarded invalid key.
[GOOGLE] Gate 1 Static Validator: Discarded invalid key.

 20 pass
 0 fail
 33 expect() calls
Ran 20 tests across 2 files. [4.08s]
============================= test session starts ==============================
platform linux -- Python 3.14.0, pytest-9.0.3, pluggy-1.6.0 -- /home/yapilwsl/arthityap/literouter/.venv/bin/python3
cachedir: .pytest_cache
rootdir: /home/yapilwsl/arthityap/literouter
configfile: pyproject.toml
plugins: anyio-4.13.0, asyncio-1.3.0, logfire-4.37.0
asyncio: mode=Mode.AUTO, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collecting ... collected 7 items

tests/integration/smoke/test_downstream_dual.py::test_opencode_native_generate_content PASSED [ 14%]
tests/integration/smoke/test_downstream_dual.py::test_pydantic_ai_openai_compat PASSED [ 28%]
tests/integration/smoke/test_gemini_flash_pass_through.py::test_gemini_flash_via_native[generateContent] PASSED [ 42%]
tests/integration/smoke/test_gemini_flash_pass_through.py::test_gemini_flash_via_native[streamGenerateContent] PASSED [ 57%]
tests/integration/smoke/test_gemini_flash_pass_through.py::test_gemini_flash_via_openai_compat PASSED [ 71%]
tests/integration/test_gemini_flash_tool_call.py::test_gemini_flash_tool_call_via_native[asyncio] PASSED [ 85%]
tests/integration/test_gemini_flash_tool_call.py::test_gemini_flash_tool_call_via_openai_compat[asyncio] PASSED [100%]

=============================== warnings summary ===============================
.venv/lib/python3.14/site-packages/google/genai/types.py:42
  /home/yapilwsl/arthityap/literouter/.venv/lib/python3.14/site-packages/google/genai/types.py:42: DeprecationWarning: '_UnionGenericAlias' is deprecated and slated for removal in Python 3.17
    VersionedUnionType = Union[builtin_types.UnionType, _UnionGenericAlias]

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
========================= 7 passed, 1 warning in 8.48s =========================
Run started: 2026-08-10T20:20:30Z

All checks passed!

Run ended: 2026-08-10T20:20:34Z
============================= test session starts ==============================
platform linux -- Python 3.14.0, pytest-9.0.3, pluggy-1.6.0
rootdir: /home/yapilwsl/arthityap/literouter
configfile: pyproject.toml
plugins: anyio-4.13.0, asyncio-1.3.0, logfire-4.37.0
asyncio: mode=Mode.AUTO, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collected 5 items / 1 skipped

tests/integration/smoke/test_downstream_dual.py ss                       [ 40%]
tests/integration/smoke/test_gemini_flash_pass_through.py FFF            [100%]

=================================== FAILURES ===================================
________________ test_gemini_flash_via_native[generateContent] _________________

action = 'generateContent'

    @pytest.mark.parametrize("action", ["generateContent", "streamGenerateContent"])
    def test_gemini_flash_via_native(action: str) -> None:
        url = _native_url(action)
        params = {"alt": "sse"} if "stream" in action else {}
    
        resp = httpx.post(
            url,
            params=params or None,
            json=PAYLOAD,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {AUTH_TOKEN}",
            },
            timeout=30,
        )
    
>       assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
E       AssertionError: Expected 200, got 401: Unauthorized
E       assert 401 == 200
E        +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/smoke/test_gemini_flash_pass_through.py:45: AssertionError
_____________ test_gemini_flash_via_native[streamGenerateContent] ______________

action = 'streamGenerateContent'

    @pytest.mark.parametrize("action", ["generateContent", "streamGenerateContent"])
    def test_gemini_flash_via_native(action: str) -> None:
        url = _native_url(action)
        params = {"alt": "sse"} if "stream" in action else {}
    
        resp = httpx.post(
            url,
            params=params or None,
            json=PAYLOAD,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {AUTH_TOKEN}",
            },
            timeout=30,
        )
    
>       assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
E       AssertionError: Expected 200, got 401: Unauthorized
E       assert 401 == 200
E        +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/smoke/test_gemini_flash_pass_through.py:45: AssertionError
_____________________ test_gemini_flash_via_openai_compat ______________________

    def test_gemini_flash_via_openai_compat() -> None:
        url = f"{GATEWAY_URL}/v1/chat/completions"
        resp = httpx.post(
            url,
            json={
                "model": MODEL,
                "messages": [{"role": "user", "content": "say OK"}],
                "max_tokens": 10,
                "stream": False,
            },
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {AUTH_TOKEN}",
            },
            timeout=30,
        )
    
>       assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
E       AssertionError: Expected 200, got 401: Unauthorized
E       assert 401 == 200
E        +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/smoke/test_gemini_flash_pass_through.py:68: AssertionError
=============================== warnings summary ===============================
.venv/lib/python3.14/site-packages/google/genai/types.py:42
  /home/yapilwsl/arthityap/literouter/.venv/lib/python3.14/site-packages/google/genai/types.py:42: DeprecationWarning: '_UnionGenericAlias' is deprecated and slated for removal in Python 3.17
    VersionedUnionType = Union[builtin_types.UnionType, _UnionGenericAlias]

-- Docs: https://docs.pytest.org/en/stable/how-to/capture-warnings.html
=========================== short test summary info ============================
FAILED tests/integration/smoke/test_gemini_flash_pass_through.py::test_gemini_flash_via_native[generateContent]
FAILED tests/integration/smoke/test_gemini_flash_pass_through.py::test_gemini_flash_via_native[streamGenerateContent]
FAILED tests/integration/smoke/test_gemini_flash_pass_through.py::test_gemini_flash_via_openai_compat
=================== 3 failed, 3 skipped, 1 warning in 2.26s ====================

Run started: 2026-08-18T05:48:22Z
bun test v1.3.13 (bf2e2cec)

tests/smoke/health_probe.test.ts:
(pass) Gateway Smoke Health Probes > GET /health responds with 200 OK and healthy status under 50ms [0.99ms]
(pass) Gateway Smoke Health Probes > GET /v1/models probe with valid key returns 200 OK [1.70ms]

tests/integration/models_discovery.test.ts:
(pass) Dynamic Model Discovery Integration > filters models dynamically for OpenRouter direct key [2.06ms]
(pass) Dynamic Model Discovery Integration > filters models dynamically for Google Gemini direct key [0.30ms]
(pass) Dynamic Model Discovery Integration > returns configured models for Fusion preset key [0.28ms]
(pass) Dynamic Model Discovery Integration > serves Google native schema for GET /v1beta/models?key=... [0.29ms]
(pass) Dynamic Model Discovery Integration > rejects model discovery with 401 when key is missing or invalid [0.13ms]

tests/integration/stream_stall_resend.test.ts:
🔵 [08-18-05:48:22:785] [req_bih22w6] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-05:48:22:798] [TTFT req_bih22w6] TTFT = 8ms | Stream established
(pass) Stream Stall Resend Integration > handles mid-stream stall and retries on the same key up to max attempts [28.30ms]

tests/integration/dual_http_h2.test.ts:
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > serves cleartext HTTP/1.1 requests correctly on port 7766 [0.32ms]
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > processes concurrent parallel requests without head-of-line blocking [0.70ms]
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > gracefully falls back when TLS certificates are absent [0.21ms]

tests/integration/hard_reset_flush.test.ts:
(pass) Operational Hard Reset & Flush Integration > handles GET /reset and flushes all rate limits and quarantines [0.84ms]
(pass) Operational Hard Reset & Flush Integration > handles POST /reset unfreezing quarantined key states [0.21ms]

tests/integration/openai_compat.test.ts:
🔵 [08-18-05:48:22:817] [req_r1nax41] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-05:48:22:819] [TTFT req_r1nax41] TTFT = 2ms | First chunk streamed downstream
🟢 [08-18-05:48:22:819] [USAGE req_r1nax41] OpenRouter (Key #1/2)
    Tokens: Prompt=10 | Completion=6 | Total=16 | Speed=3000.0 tok/s
🟢 [08-18-05:48:22:824] [SERVED req_r1nax41] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) OpenAI Compatibility Handler Integration > handles non-streaming POST /v1/chat/completions successfully [19.80ms]
🔵 [08-18-05:48:22:838] [req_nphftfy] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-05:48:22:840] [TTFT req_nphftfy] TTFT = 2ms | Stream established
(pass) OpenAI Compatibility Handler Integration > handles streaming POST /v1/chat/completions with SSE [15.78ms]
(pass) OpenAI Compatibility Handler Integration > returns 401 when API key directive is missing or malformed [17.97ms]

tests/integration/abort_propagation.test.ts:
🔵 [08-18-05:48:22:879] [req_yfxtmlm] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-05:48:22:881] [TTFT req_yfxtmlm] TTFT = 2ms | Stream established
(pass) Client Abort Signal Propagation Integration > propagates downstream client abort signal upstream immediately [101.17ms]

tests/integration/ghost_response_guard.test.ts:
🔵 [08-18-05:48:22:976] [req_zjlpgy4] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
⚠️ [08-18-05:48:22:977] [LIMIT req_zjlpgy4] OpenRouter [Key #1/2] returned 429 Too Many Requests
    Parsed Retry-After: 60s -> Quarantined Key #1 for 60s
🔄 [08-18-05:48:22:978] [ROTATE req_zjlpgy4] Advancing to OpenRouter [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-05:48:22:979] [TTFT req_zjlpgy4] TTFT = 1ms | Stream established
(pass) Ghost Response & Zero-Token Guard Integration > detects 0-token HTTP 200 stream, rotates key, and succeeds seamlessly [17.34ms]

tests/integration/google_native.test.ts:
🔵 [08-18-05:48:22:997] [req_4p7pewl] Inbound POST /v1beta/models/gemini-2.5-flash:generateContent from unknown
    Directive : lr-gg-gg-gc-no -> Target: Google | Wire: Google | EP: /v1beta/models/gemini-2.5-flash:generateContent
    Model     : gemini-2.5-flash | Key: Google [Key #1/2]
🟢 [08-18-05:48:22:999] [TTFT req_4p7pewl] TTFT = 2ms | First chunk streamed downstream
🟢 [08-18-05:48:22:999] [SERVED req_4p7pewl] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Google Native & Beta Endpoints Integration > handles native /v1beta/models/*:generateContent with ?key= query auth [18.17ms]
🔵 [08-18-05:48:23:018] [req_gf14xiq] Inbound POST /v1beta/openai/chat/completions from unknown
    Directive : lr-gg-oa-ob-dp -> Target: Google | Wire: OpenAI | EP: /v1beta/openai/chat/completions
    Model     : gemini-2.5-flash | Key: Google [Key #1/2] | Nuances: [dp]
🟢 [08-18-05:48:23:019] [TTFT req_gf14xiq] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-05:48:23:019] [SERVED req_gf14xiq] HTTP 200 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Google Native & Beta Endpoints Integration > handles OpenAI-compatible beta /v1beta/openai/chat/completions [20.18ms]
(pass) Google Native & Beta Endpoints Integration > rejects unauthorized native requests with 401 [18.66ms]

tests/integration/anthropic_compat.test.ts:
🔵 [08-18-05:48:23:059] [req_asvaseg] Inbound POST /v1/messages from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-18-05:48:23:061] [TTFT req_asvaseg] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-05:48:23:062] [USAGE req_asvaseg] Anthropic (Key #1/2)
    Tokens: Prompt=10 | Completion=8 | Total=18 | Speed=8000.0 tok/s
🟢 [08-18-05:48:23:062] [SERVED req_asvaseg] HTTP 200 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles non-streaming POST /v1/messages with x-api-key header [22.00ms]
🔵 [08-18-05:48:23:080] [req_2b3g3o0] Inbound POST /v1/messages from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-18-05:48:23:081] [TTFT req_2b3g3o0] TTFT = 1ms | Stream established
🟢 [08-18-05:48:23:082] [USAGE req_2b3g3o0] Anthropic (Key #1/2)
    Tokens: Prompt=0 | Completion=5 | Total=5 | Speed=2500.0 tok/s
🟢 [08-18-05:48:23:082] [SERVED req_2b3g3o0] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles streaming POST /v1/messages and emits SSE event stream [20.24ms]
(pass) Anthropic Compatibility Handler Integration > rejects unauthorized request with 401 when key is missing [18.48ms]

tests/unit/visual_telemetry.test.ts:
(pass) Visual Telemetry & Terminal UI > formats timestamps consistently in [MM-DD-HH:MM:SS:mmm] format [0.50ms]
(pass) Visual Telemetry & Terminal UI > resolves friendly provider and wire display names [0.13ms]
(pass) Visual Telemetry & Terminal UI > formats token numbers with thousands commas [0.21ms]
(pass) Visual Telemetry & Terminal UI > logs rich multi-line inbound request telemetry [0.22ms]
(pass) Visual Telemetry & Terminal UI > logs TTFT and token usage with tok/s speed calculation [0.20ms]
(pass) Visual Telemetry & Terminal UI > logs limit warning with parsed retry-after [0.07ms]
(pass) Visual Telemetry & Terminal UI > logs key rotation with attempt count [0.39ms]
(pass) Visual Telemetry & Terminal UI > logs separator line [0.07ms]

tests/unit/language_guardrail.test.ts:
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-01: enforces zero Chinese character leakage in generic code reasoning and comments [0.06ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-02: detects and flags Chinese token leakage in code outputs [0.03ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-03: preserves 100% genuine Chinese characters in BaZi metaphysics data payloads while keeping explanations in English [0.27ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-04: verifies all 10 Heavenly Stems, 12 Earthly Branches, and Ten Gods in whitelist [0.11ms]

tests/unit/zdist.test.ts:
(pass) Rate Limit Tracker — Sliding Window RPM > records requests and counts within sliding 60s window [0.27ms]
(pass) Rate Limit Tracker — Sliding Window RPM > tracks RPM independently per key index [0.17ms]
(pass) Rate Limit Tracker — Sliding Window RPM > detects 95% threshold approach for RPM ceiling [0.20ms]
(pass) Rate Limit Tracker — Daily RPD Quota > records and returns daily cumulative requests [0.31ms]
(pass) Rate Limit Tracker — Daily RPD Quota > detects 95% threshold approach for daily RPD quota [0.25ms]
(pass) Rate Limit Tracker — Daily RPD Quota > clears all counters on hard reset [0.56ms]

tests/unit/path_resolver.test.ts:
(pass) Path Resolver — providers.json Completion URL Mapping > resolves OpenRouter chat completions endpoint (or, ch) [0.04ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves OpenRouter messages endpoint (or, ms) [0.03ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves NVIDIA chat completions endpoint (nv, ch) [0.01ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google OpenAI-compat beta endpoint (gg, ob)
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google native generateContent with model substitution (gg, gc) [0.01ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google embeddings with model substitution (gg, em) [0.01ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Anthropic direct messages endpoint (an, ms)
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Zen chat endpoint (zn, ch)
(pass) Path Resolver — providers.json Completion URL Mapping > returns null for non-existent completion code on provider [0.02ms]
(pass) Path Resolver — Outbound Auth Transformation > formats standard Bearer header for OpenRouter [0.04ms]
(pass) Path Resolver — Outbound Auth Transformation > formats standard Bearer header for NVIDIA NIM [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats x-api-key and anthropic-version for Anthropic direct [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats Bearer header for Google OpenAI beta endpoint (ob) [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats query parameter ?key= for Google Native RPC (gc) [0.01ms]

tests/unit/fusion_sticky.test.ts:
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > returns null when no sticky position is cached [0.12ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > stores and returns sticky tier position on fallback [0.07ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > isolates sticky positions across distinct models [0.03ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > expires sticky position after 5-minute TTL [0.02ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > clears sticky tier when primary recovery succeeds [0.03ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > resets all sticky entries on clearAll [0.02ms]

tests/unit/classifier.test.ts:
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'Provider returned error' as retry_rotate with 0s quarantine [0.12ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'No available provider' as retry_rotate with 0s quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'temporarily unavailable' as retry_rotate with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > handles case-insensitivity for retryable 400 patterns [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'maximum context length' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'context_length' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'safety' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'HARM_PROBABILITY' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies generic 400 errors as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 standard rate limit as retry_rotate with 65s default quarantine [0.12ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > honors Retry-After header for 429 standard rate limit [0.05ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > honors Retry-After in Record<string, string> format [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'insufficient_quota' as retry_rotate with 7-day (604800s) quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'credit_limit' as retry_rotate with 7-day quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'out of balance' as retry_rotate with 7-day quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 401 as retry_rotate with 7-day (604800s) quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 403 as retry_rotate with 7-day (604800s) quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 500 as retry_rotate with 10s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 502 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 503 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 504 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError > HTTP 404 - Not Found > classifies 404 as fail_fast with 0s quarantine [0.01ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > handles undefined bodyText gracefully [0.01ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > handles empty string bodyText gracefully [0.01ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > safely processes huge bodies (>4KB) without performance degradation or errors [0.09ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > safely handles non-JSON malformed bodies [0.02ms]

tests/unit/gemma_transformer.test.ts:
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > converts system message into prepended [System Context] in first user message [0.25ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > creates a user message if only a system message is present [0.04ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > merges consecutive user messages into a single user turn [0.09ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > merges consecutive assistant messages into a single turn [0.04ms]
(pass) Gemma Transformer — End-to-End Payload Sanitization > applies gemma constraints when 'gm' nuance is provided [0.08ms]
(pass) LaTeX Normalizer > replaces double-escaped times formula with clean unicode [0.02ms]
(pass) LaTeX Normalizer > replaces rightarrow with unicode arrow [0.06ms]
(pass) LaTeX Normalizer > replaces inequality symbols [0.02ms]

tests/unit/header_sanitizer.test.ts:
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > strips content-encoding and compression headers from downstream responses [0.07ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > strips all RFC hop-by-hop headers [0.11ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > updates content-length when bodyLength is supplied [0.04ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > omits content-length if bodyLength is undefined [0.02ms]

tests/unit/rotation_loop.test.ts:
🔵 [08-18-05:48:23:119] [req_y3nds7l] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-05:48:23:119] [TTFT req_y3nds7l] TTFT = 0ms | First chunk streamed downstream
🔄 [08-18-05:48:23:119] [ROTATE req_y3nds7l] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-05:48:23:120] [TTFT req_y3nds7l] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-05:48:23:120] [USAGE req_y3nds7l] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15 | Speed=5000.0 tok/s
🟢 [08-18-05:48:23:120] [SERVED req_y3nds7l] HTTP 200 in 1ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 returns 400 'Provider returned error' and succeeds with 200 [1.64ms]
🔵 [08-18-05:48:23:120] [req_bk8fmh0] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-05:48:23:120] [TTFT req_bk8fmh0] TTFT = 0ms | First chunk streamed downstream
🟢 [08-18-05:48:23:120] [SERVED req_bk8fmh0] HTTP 400 in 0ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > fails fast on 400 'maximum context length' without trying Key 2 [0.59ms]
🔵 [08-18-05:48:23:121] [req_1bxe49d] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-05:48:23:121] [TTFT req_1bxe49d] TTFT = 0ms | First chunk streamed downstream
⚠️ [08-18-05:48:23:121] [LIMIT req_1bxe49d] OpenAI [Key #1/2] returned 429 Too Many Requests
    Parsed Retry-After: 30s -> Quarantined Key #1 for 30s
🔄 [08-18-05:48:23:121] [ROTATE req_1bxe49d] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-05:48:23:121] [TTFT req_1bxe49d] TTFT = 0ms | First chunk streamed downstream
🟢 [08-18-05:48:23:121] [USAGE req_1bxe49d] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-18-05:48:23:121] [SERVED req_1bxe49d] HTTP 200 in 0ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 returns 429 Rate Limit and succeeds with 200 [0.95ms]
🔵 [08-18-05:48:23:122] [req_pemf2qo] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-05:48:23:122] [TTFT req_pemf2qo] TTFT = 0ms | First chunk streamed downstream
⚠️ [08-18-05:48:23:122] [LIMIT req_pemf2qo] OpenAI [Key #1/2] returned 401 Too Many Requests
    Parsed Retry-After: 604800s -> Quarantined Key #1 for 604800s
🔄 [08-18-05:48:23:122] [ROTATE req_pemf2qo] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-05:48:23:122] [TTFT req_pemf2qo] TTFT = 0ms | First chunk streamed downstream
🟢 [08-18-05:48:23:122] [USAGE req_pemf2qo] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-18-05:48:23:123] [SERVED req_pemf2qo] HTTP 200 in 0ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > quarantines Key 1 for 7 days on 401 and succeeds with Key 2 [1.15ms]

tests/unit/cooldown.test.ts:
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 65s default cooldown on HTTP 429 rate limit [0.43ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 10s cooldown on transient 5xx server errors [0.04ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 7 days cooldown on 401/403 auth errors [0.01ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 0s cooldown on 400/404 client errors (no penalty on key)
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns baseline 30s cooldown for unknown errors
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses numeric Retry-After header [0.04ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > clamps sub-minimum delay to 5s min threshold [0.01ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > clamps excessive delay to 7200s max threshold [0.02ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses Google JSON error quotaResetDelay string [0.05ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses Google JSON error retryDelay field in details [0.02ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > flags sub-2s reset delays for immediate grace retry [0.02ms]
(pass) Cooldown Manager — Pool Exhaustion Ladder Backoff > calculates 3-step ladder backoff delays [0.04ms]
(pass) Cooldown Manager — In-Memory Key State Management > quarantines key and tracks remaining cooldown ms [0.09ms]
(pass) Cooldown Manager — In-Memory Key State Management > reports unquarantined once cooldown epoch passes [0.02ms]
(pass) Cooldown Manager — In-Memory Key State Management > flushes all quarantined keys on clearAll [0.02ms]

tests/unit/directive_parser.test.ts:
(pass) Directive Parser — Direct Keys > parses standard OpenRouter claude direct key [0.07ms]
(pass) Directive Parser — Direct Keys > parses NVIDIA OpenAI-format chat direct key with dot-prompt [0.11ms]
(pass) Directive Parser — Direct Keys > parses Google OpenAI beta direct key [0.02ms]
(pass) Directive Parser — Direct Keys > parses Zen provider direct key [0.24ms]
(pass) Directive Parser — Direct Keys > parses all registered 2-letter provider codes [0.08ms]
(pass) Directive Parser — Direct Keys > parses all registered 2-letter completion codes [0.14ms]
(pass) Directive Parser — Compound Nuances > parses two compound nuances delimited by plus [0.05ms]
(pass) Directive Parser — Compound Nuances > parses three compound nuances [0.27ms]
(pass) Directive Parser — Compound Nuances > parses compound nuances with gemma and strip-budget [0.02ms]
(pass) Directive Parser — Fusion Keys > parses quad fusion preset key [0.04ms]
(pass) Directive Parser — Fusion Keys > parses pydn fusion preset key [0.02ms]
(pass) Directive Parser — Fusion Keys > parses fast and deep presets [0.02ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > normalizes uppercase direct keys to lowercase [0.14ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > trims surrounding whitespace and tabs [0.04ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > normalizes uppercase fusion keys [0.03ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects empty or missing key with 401 invalid_api_key [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects standard OpenAI key format without lr prefix [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects incomplete direct key with only 3 segments
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown provider code [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown payload wire code [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown completion code [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects invalid nuance modifier in compound list [0.02ms]

tests/unit/dots_xml_transformer.test.ts:
(pass) Dots XML Transformer — Static Parsing > parses single XML function invocation into OpenAI tool_calls structure [1.30ms]
(pass) Dots XML Transformer — Static Parsing > parses XML invocation with multiple parameters [0.28ms]
(pass) Dots XML Transformer — Static Parsing > passes through text without XML invocations untouched [0.06ms]
(pass) Dots XML Transformer — Streaming Chunk Handling > handles XML tags split across chunk boundaries [0.20ms]

tests/unit/thinking_transformer.test.ts:
(pass) Thinking Transformer — Streaming Delta Processing > strips thinking block content when preserveThinking is false [0.13ms]
(pass) Thinking Transformer — Streaming Delta Processing > converts thinking block to thinking_delta when preserveThinking is true [0.07ms]
(pass) Thinking Transformer — Streaming Delta Processing > passes clean text without thinking tags as text_delta [0.07ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > preserves reasoning if 'ts' nuance is present, overriding global default [0.02ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > strips reasoning if 'sb' nuance is present, overriding global default
(pass) Thinking Transformer — Reasoning Stripping Policy > follows global default when neither 'ts' nor 'sb' is specified [0.01ms]
(pass) Thinking Transformer — Payload Parameter Scrubber > removes reasoning and thinking parameters from payload [0.04ms]

tests/unit/zod_schema.test.ts:
(pass) Zod Schema — providers.json Validation > validates a conforming providers configuration [0.31ms]
(pass) Zod Schema — providers.json Validation > rejects invalid base_url format in providers [0.83ms]
(pass) Zod Schema — providers.json Validation > rejects negative rate limits [0.35ms]
(pass) Zod Schema — fusion.json Validation > validates a conforming fusion configuration with presets and tiers [0.42ms]
(pass) Zod Schema — fusion.json Validation > rejects tier missing apikey directive [0.20ms]
(pass) Zod Schema — Environment Variables Auto-Coercion & Defaults > applies resilient defaults when optional env vars are omitted [0.31ms]
(pass) Zod Schema — Environment Variables Auto-Coercion & Defaults > coerces string numbers and booleans properly [0.25ms]

tests/unit/thought_signature.test.ts:
(pass) Google Thought Signature Store — Capture & Injection > saves and retrieves thought signature by tool call id [0.05ms]
(pass) Google Thought Signature Store — Capture & Injection > returns undefined for untracked tool call id [0.02ms]
(pass) Google Thought Signature Store — Capture & Injection > injects saved thought signature into matching historical assistant tool call [0.17ms]
(pass) Google Thought Signature Store — Capture & Injection > leaves messages unchanged if no tool calls exist [0.02ms]
(pass) Google Thought Signature Store — Capture & Injection > clears all stored signatures on clearThoughtSignatures [0.01ms]

tests/unit/auth_extractor.test.ts:
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from standard Authorization Bearer header [0.06ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from case-insensitive bearer prefix [0.09ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from x-api-key header (Anthropic format) [0.02ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?key= (Google format) [0.03ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?api_key= [0.02ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?token= [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes Authorization Bearer over x-api-key header [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes headers over URL query parameters [0.03ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes ?key= over ?api_key= in query parameters [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > returns null when no authorization mechanism is present [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > passes extracted token cleanly to validator for schema verification [0.05ms]

 175 pass
 0 fail
 481 expect() calls
Ran 175 tests across 26 files. [433.00ms]
============================= test session starts ==============================
platform linux -- Python 3.14.0, pytest-9.0.3, pluggy-1.6.0
rootdir: /home/yapilwsl/arthityap/literouter
configfile: pyproject.toml
plugins: anyio-4.13.0, asyncio-1.3.0, logfire-4.37.0
asyncio: mode=Mode.AUTO, debug=False, asyncio_default_fixture_loop_scope=None, asyncio_default_test_loop_scope=function
collected 13 items

tests/integration/smoke/test_downstream_dual.py ss                       [ 15%]
tests/integration/smoke/test_gemini_flash_pass_through.py FFF            [ 38%]
tests/integration/test_dots_transformer_e2e.py FF                        [ 53%]
tests/integration/test_e2e_gateway_mock.py FFFF                          [ 84%]
tests/integration/test_gemini_flash_tool_call.py FF                      [100%]

=================================== FAILURES ===================================
________________ test_gemini_flash_via_native[generateContent] _________________

action = 'generateContent'

    @pytest.mark.parametrize("action", ["generateContent", "streamGenerateContent"])
    def test_gemini_flash_via_native(action: str) -> None:
        url = _native_url(action)
        params = {"alt": "sse"} if "stream" in action else {}
    
        with httpx.Client(http2=True) as client:
            resp = client.post(
                url,
                params=params or None,
                json=PAYLOAD,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {AUTH_TOKEN}",
                },
                timeout=30,
            )
    
>       assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
E       AssertionError: Expected 200, got 401: {
E           "error": {
E             "message": "Invalid API key directive 'sk-lr-8f2a9e3b1c4d7e5f'. Must follow lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>",
E             "type": "invalid_request_error",
E       assert 401 == 200
E        +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/smoke/test_gemini_flash_pass_through.py:46: AssertionError
_____________ test_gemini_flash_via_native[streamGenerateContent] ______________

action = 'streamGenerateContent'

    @pytest.mark.parametrize("action", ["generateContent", "streamGenerateContent"])
    def test_gemini_flash_via_native(action: str) -> None:
        url = _native_url(action)
        params = {"alt": "sse"} if "stream" in action else {}
    
        with httpx.Client(http2=True) as client:
            resp = client.post(
                url,
                params=params or None,
                json=PAYLOAD,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {AUTH_TOKEN}",
                },
                timeout=30,
            )
    
>       assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
E       AssertionError: Expected 200, got 401: {
E           "error": {
E             "message": "Invalid API key directive 'sk-lr-8f2a9e3b1c4d7e5f'. Must follow lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>",
E             "type": "invalid_request_error",
E       assert 401 == 200
E        +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/smoke/test_gemini_flash_pass_through.py:46: AssertionError
_____________________ test_gemini_flash_via_openai_compat ______________________

    def test_gemini_flash_via_openai_compat() -> None:
        url = f"{GATEWAY_URL}/v1/chat/completions"
        with httpx.Client(http2=True) as client:
            resp = client.post(
                url,
                json={
                    "model": MODEL,
                    "messages": [{"role": "user", "content": "say OK"}],
                    "max_tokens": 10,
                    "stream": False,
                },
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {AUTH_TOKEN}",
                },
                timeout=30,
            )
    
>       assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
E       AssertionError: Expected 200, got 401: {
E           "error": {
E             "message": "Invalid API key directive 'sk-lr-8f2a9e3b1c4d7e5f'. Must follow lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>",
E             "type": "invalid_request_error",
E       assert 401 == 200
E        +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/smoke/test_gemini_flash_pass_through.py:70: AssertionError
________________ test_dots_non_streaming_converts_to_tool_calls ________________

dots_e2e_stack = {'gw_port': 42569, 'gw_url': 'https://127.0.0.1:42569', 'mock_ctx': <tests.integration.mock_upstream.MockUpstreamContext object at 0x71798b5117f0>}

    def test_dots_non_streaming_converts_to_tool_calls(dots_e2e_stack: Dict[str, Any]) -> None:
        gw_url = dots_e2e_stack["gw_url"]
        headers = {
            "Authorization": f"Bearer {AUTH_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": TEST_MODEL,
            "messages": [{"role": "user", "content": "Run git status"}],
            "stream": False,
        }
    
        with httpx.Client(verify=False, timeout=10.0) as client:
            resp = client.post(f"{gw_url}/v1/chat/completions", headers=headers, json=payload)
>           assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
E           AssertionError: Expected 200, got 401: {
E               "error": {
E                 "message": "Invalid API key directive 'test-e2e-token-secret-dots-12345'. Must follow lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>",
E                 "type": "invalid_request_error",
E                 "code": "invalid_api_key"
E               }
E             }
E           assert 401 == 200
E            +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/test_dots_transformer_e2e.py:183: AssertionError
__________________ test_dots_streaming_converts_to_tool_calls __________________

dots_e2e_stack = {'gw_port': 42569, 'gw_url': 'https://127.0.0.1:42569', 'mock_ctx': <tests.integration.mock_upstream.MockUpstreamContext object at 0x71798b5117f0>}

    def test_dots_streaming_converts_to_tool_calls(dots_e2e_stack: Dict[str, Any]) -> None:
        gw_url = dots_e2e_stack["gw_url"]
        headers = {
            "Authorization": f"Bearer {AUTH_KEY}",
            "Content-Type": "application/json",
        }
        payload = {
            "model": TEST_MODEL,
            "messages": [{"role": "user", "content": "Run git status"}],
            "stream": True,
        }
    
        with httpx.Client(verify=False, timeout=10.0) as client:
            with client.stream("POST", f"{gw_url}/v1/chat/completions", headers=headers, json=payload) as response:
>               assert response.status_code == 200
E               assert 401 == 200
E                +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/test_dots_transformer_e2e.py:214: AssertionError
_______________________ test_e2e_mock_non_stream_success _______________________

e2e_harness = ('https://127.0.0.1:45421', <tests.integration.mock_upstream.MockUpstreamContext object at 0x71798b415810>)

    def test_e2e_mock_non_stream_success(
        e2e_harness: Tuple[str, MockUpstreamContext],
    ) -> None:
        gw_url, ctx = e2e_harness
        _flush_test_redis()
        ctx.reset()
    
        with httpx.Client(http2=True) as client:
            resp = client.post(
                f"{gw_url}/v1/chat/completions",
                json=_make_req_payload(stream=False),
                headers=_auth_headers(),
                timeout=10.0,
            )
    
>       assert resp.status_code == 200
E       assert 401 == 200
E        +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/test_e2e_gateway_mock.py:147: AssertionError
_____________________ test_e2e_mock_429_rotation_failover ______________________

e2e_harness = ('https://127.0.0.1:45421', <tests.integration.mock_upstream.MockUpstreamContext object at 0x71798b415810>)

    def test_e2e_mock_429_rotation_failover(
        e2e_harness: Tuple[str, MockUpstreamContext],
    ) -> None:
        gw_url, ctx = e2e_harness
        _flush_test_redis()
        ctx.reset()
        ctx.state.fail_first_n_requests = 1
    
        start_time = time.time()
        with httpx.Client(http2=True) as client:
            resp = client.post(
                f"{gw_url}/v1/chat/completions",
                json=_make_req_payload(stream=False),
                headers=_auth_headers(),
                timeout=10.0,
            )
        elapsed = time.time() - start_time
    
>       assert resp.status_code == 200
E       assert 401 == 200
E        +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/test_e2e_gateway_mock.py:172: AssertionError
_________________________ test_e2e_mock_streaming_sse __________________________

e2e_harness = ('https://127.0.0.1:45421', <tests.integration.mock_upstream.MockUpstreamContext object at 0x71798b415810>)

    def test_e2e_mock_streaming_sse(
        e2e_harness: Tuple[str, MockUpstreamContext],
    ) -> None:
        gw_url, ctx = e2e_harness
        _flush_test_redis()
        ctx.reset()
    
        with httpx.Client(http2=True) as client:
            with client.stream(
                "POST",
                f"{gw_url}/v1/chat/completions",
                json=_make_req_payload(stream=True),
                headers=_auth_headers(),
                timeout=10.0,
            ) as stream_resp:
>               assert stream_resp.status_code == 200
E               assert 401 == 200
E                +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/test_e2e_gateway_mock.py:191: AssertionError
_______________________ test_e2e_mock_all_keys_exhausted _______________________

e2e_harness = ('https://127.0.0.1:45421', <tests.integration.mock_upstream.MockUpstreamContext object at 0x71798b415810>)

    def test_e2e_mock_all_keys_exhausted(
        e2e_harness: Tuple[str, MockUpstreamContext],
    ) -> None:
        gw_url, ctx = e2e_harness
        _flush_test_redis()
        ctx.reset()
        ctx.state.fail_all_429 = True
    
        with httpx.Client(http2=True) as client:
            resp = client.post(
                f"{gw_url}/v1/chat/completions",
                json=_make_req_payload(stream=False),
                headers=_auth_headers(),
                timeout=15.0,
            )
    
>       assert resp.status_code in (429, 502)
E       assert 401 in (429, 502)
E        +  where 401 = <Response [401 Unauthorized]>.status_code

tests/integration/test_e2e_gateway_mock.py:213: AssertionError
_______________ test_gemini_flash_tool_call_via_native[asyncio] ________________

self = GoogleModel()
messages = [ModelRequest(parts=[SystemPromptPart(content='You are a helpful assistant.', timestamp=datetime.datetime(2026, 8, 18,....timezone.utc), run_id='01a01369-f957-7770-8c73-13e279e3d450', conversation_id='01a01369-f957-7770-8c73-13e19ef10fbc')]
stream = False, model_settings = {}
model_request_parameters = ModelRequestParameters(function_tools=[ToolDefinition(name='get_weather', parameters_json_schema={'additionalPropertie...on': {'type': 'string'}}, 'required': ['location'], 'type': 'object'}, strict=True)], native_tools=[], output_tools=[])

    async def _generate_content(
        self,
        messages: list[ModelMessage],
        stream: bool,
        model_settings: GoogleModelSettings,
        model_request_parameters: ModelRequestParameters,
    ) -> GenerateContentResponse | Awaitable[AsyncIterator[GenerateContentResponse]]:
        contents, config = await self._build_content_and_config(
            messages,
            model_settings,
            model_request_parameters,
        )
        func = self.client.aio.models.generate_content_stream if stream else self.client.aio.models.generate_content
        try:
>           return await func(model=self._model_name, contents=contents, config=config)  # type: ignore
                   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

.venv/lib/python3.14/site-packages/pydantic_ai/models/google.py:767: 
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 
.venv/lib/python3.14/site-packages/google/genai/models.py:8679: in generate_content
    return await self._generate_content(
.venv/lib/python3.14/site-packages/google/genai/models.py:7153: in _generate_content
    response = await self._api_client.async_request(
.venv/lib/python3.14/site-packages/google/genai/_api_client.py:1664: in async_request
    result = await self._async_request(
.venv/lib/python3.14/site-packages/google/genai/_api_client.py:1597: in _async_request
    return await self._async_retry(  # type: ignore[no-any-return]
.venv/lib/python3.14/site-packages/tenacity/asyncio/__init__.py:112: in __call__
    do = await self.iter(retry_state=retry_state)
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/tenacity/asyncio/__init__.py:157: in iter
    result = await action(retry_state)
             ^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/tenacity/_utils.py:111: in inner
    return call(*args, **kwargs)
           ^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/tenacity/__init__.py:413: in exc_check
    raise retry_exc.reraise()
          ^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/tenacity/__init__.py:184: in reraise
    raise self.last_attempt.result()
          ^^^^^^^^^^^^^^^^^^^^^^^^^^
../../.local/share/uv/python/cpython-3.14.0-linux-x86_64-gnu/lib/python3.14/concurrent/futures/_base.py:443: in result
    return self.__get_result()
           ^^^^^^^^^^^^^^^^^^^
../../.local/share/uv/python/cpython-3.14.0-linux-x86_64-gnu/lib/python3.14/concurrent/futures/_base.py:395: in __get_result
    raise self._exception
.venv/lib/python3.14/site-packages/tenacity/asyncio/__init__.py:116: in __call__
    result = await fn(*args, **kwargs)
             ^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/google/genai/_api_client.py:1577: in _async_request_once
    await errors.APIError.raise_for_async_response(client_response)
.venv/lib/python3.14/site-packages/google/genai/errors.py:247: in raise_for_async_response
    await cls.raise_error_async(status_code, response_json, response)
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 

cls = <class 'google.genai.errors.APIError'>, status_code = 401
response_json = {'error': {'code': 'invalid_api_key', 'message': "Invalid API key directive 'sk-lr-8f2a9e3b1c4d7e5f'. Must follow lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>", 'type': 'invalid_request_error'}}
response = <Response [401 Unauthorized]>

    @classmethod
    async def raise_error_async(
        cls, status_code: int, response_json: Any, response: Optional[
            Union['ReplayResponse', httpx.Response, 'aiohttp.ClientResponse']
        ]
    ) -> None:
      """Raises an appropriate APIError subclass based on the status code.
    
      Args:
        status_code: The HTTP status code of the response.
        response_json: The JSON body of the response, or a dict containing error
          details.
        response: The original response object.
    
      Raises:
        ClientError: If the status code is in the 4xx range.
        ServerError: If the status code is in the 5xx range.
        APIError: For other error status codes.
      """
      if 400 <= status_code < 500:
>       raise ClientError(status_code, response_json, response)
E       google.genai.errors.ClientError: 401 None. {'error': {'message': "Invalid API key directive 'sk-lr-8f2a9e3b1c4d7e5f'. Must follow lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>", 'type': 'invalid_request_error', 'code': 'invalid_api_key'}}

.venv/lib/python3.14/site-packages/google/genai/errors.py:269: ClientError

The above exception was the direct cause of the following exception:

    @pytest.mark.anyio
    async def test_gemini_flash_tool_call_via_native() -> None:
>       result = await agent.run("What is the weather in Singapore? Use the get_weather tool.")
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

tests/integration/test_gemini_flash_tool_call.py:35: 
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 
.venv/lib/python3.14/site-packages/pydantic_ai/agent/abstract.py:545: in run
    node = await agent_run.next(node)  # pyright: ignore[reportArgumentType]
           ^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/run.py:402: in next
    return await self._run_node_with_hooks(node, self._advance_graph)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/run.py:326: in _run_node_with_hooks
    return await self._wrap_and_advance(run_context, node, step_fn)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/run.py:296: in _wrap_and_advance
    result = await cap.on_node_run_error(run_context, node=node, error=e)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:331: in on_node_run_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:328: in on_node_run_error
    return await capability.on_node_run_error(cap_ctx, node=node, error=error)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:492: in on_node_run_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:328: in on_node_run_error
    return await capability.on_node_run_error(cap_ctx, node=node, error=error)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:492: in on_node_run_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/run.py:294: in _wrap_and_advance
    result = await cap.wrap_node_run(run_context, node=node, handler=step_fn)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:314: in wrap_node_run
    return await chain(node)
           ^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:745: in wrapped
    return await cap.wrap_node_run(_ctx_for_cap(cap, ctx), node=node, handler=inner)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:471: in wrap_node_run
    return await handler(node)
           ^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:745: in wrapped
    return await cap.wrap_node_run(_ctx_for_cap(cap, ctx), node=node, handler=inner)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:471: in wrap_node_run
    return await handler(node)
           ^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/run.py:272: in _advance_graph
    task = await self._graph_run.next(task)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_graph/graph_builder.py:580: in next
    return await anext(self)
           ^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_graph/graph_builder.py:557: in __anext__
    raise self._next.error
.venv/lib/python3.14/site-packages/pydantic_graph/graph_builder.py:856: in _run_tracked_task
    result = await self._run_task(t_)
             ^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_graph/graph_builder.py:903: in _run_task
    output = await node.call(step_context)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_graph/step.py:253: in _call_node
    return await node.run(GraphRunContext(state=ctx.state, deps=ctx.deps))
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/_agent_graph.py:630: in run
    return await self._make_request(ctx)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/_agent_graph.py:873: in _make_request
    model_response = await ctx.deps.root_capability.on_model_request_error(
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:401: in on_model_request_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:398: in on_model_request_error
    return await capability.on_model_request_error(cap_ctx, request_context=request_context, error=error)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:573: in on_model_request_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:398: in on_model_request_error
    return await capability.on_model_request_error(cap_ctx, request_context=request_context, error=error)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:573: in on_model_request_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/_agent_graph.py:863: in _make_request
    model_response = await ctx.deps.root_capability.wrap_model_request(
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:384: in wrap_model_request
    return await chain(request_context)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:707: in wrapped
    return await cap.wrap_model_request(
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:550: in wrap_model_request
    return await handler(request_context)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:707: in wrapped
    return await cap.wrap_model_request(
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:550: in wrap_model_request
    return await handler(request_context)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/_agent_graph.py:848: in model_handler
    response = await req_ctx.model.request(
.venv/lib/python3.14/site-packages/pydantic_ai/models/google.py:499: in request
    response = await self._generate_content(messages, False, model_settings, model_request_parameters)
               ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 

self = GoogleModel()
messages = [ModelRequest(parts=[SystemPromptPart(content='You are a helpful assistant.', timestamp=datetime.datetime(2026, 8, 18,....timezone.utc), run_id='01a01369-f957-7770-8c73-13e279e3d450', conversation_id='01a01369-f957-7770-8c73-13e19ef10fbc')]
stream = False, model_settings = {}
model_request_parameters = ModelRequestParameters(function_tools=[ToolDefinition(name='get_weather', parameters_json_schema={'additionalPropertie...on': {'type': 'string'}}, 'required': ['location'], 'type': 'object'}, strict=True)], native_tools=[], output_tools=[])

    async def _generate_content(
        self,
        messages: list[ModelMessage],
        stream: bool,
        model_settings: GoogleModelSettings,
        model_request_parameters: ModelRequestParameters,
    ) -> GenerateContentResponse | Awaitable[AsyncIterator[GenerateContentResponse]]:
        contents, config = await self._build_content_and_config(
            messages,
            model_settings,
            model_request_parameters,
        )
        func = self.client.aio.models.generate_content_stream if stream else self.client.aio.models.generate_content
        try:
            return await func(model=self._model_name, contents=contents, config=config)  # type: ignore
        except errors.APIError as e:
            if (status_code := e.code) >= 400:
>               raise ModelHTTPError(
                    status_code=status_code,
                    model_name=self._model_name,
                    body=cast(Any, e.details),  # pyright: ignore[reportUnknownMemberType]
                ) from e
E               pydantic_ai.exceptions.ModelHTTPError: status_code: 401, model_name: gemini-3.1-flash-lite, body: {'error': {'message': "Invalid API key directive 'sk-lr-8f2a9e3b1c4d7e5f'. Must follow lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>", 'type': 'invalid_request_error', 'code': 'invalid_api_key'}}

.venv/lib/python3.14/site-packages/pydantic_ai/models/google.py:770: ModelHTTPError
____________ test_gemini_flash_tool_call_via_openai_compat[asyncio] ____________

model_name = 'google/gemini-3.1-flash-lite'

    @contextmanager
    def _map_api_errors(model_name: str) -> Generator[None]:
        try:
>           yield

.venv/lib/python3.14/site-packages/pydantic_ai/models/openai.py:192: 
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 
.venv/lib/python3.14/site-packages/pydantic_ai/models/openai.py:936: in _completions_create
    return await self.client.chat.completions.create(
.venv/lib/python3.14/site-packages/openai/resources/chat/completions/completions.py:2814: in create
    return await self._post(
.venv/lib/python3.14/site-packages/openai/_base_client.py:1931: in post
    return await self.request(cast_to, opts, stream=stream, stream_cls=stream_cls)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 

self = <openai.AsyncOpenAI object at 0x717988f6ecf0>
cast_to = <class 'openai.types.chat.chat_completion.ChatCompletion'>
options = FinalRequestOptions(method='post', url='/chat/completions', params={}, headers={'User-Agent': 'pydantic-ai/2.4.0'}, ma...s': {'location': {'type': 'string'}}, 'required': ['location'], 'type': 'object'}, 'strict': True}}]}, extra_json=None)

    async def request(
        self,
        cast_to: Type[ResponseT],
        options: FinalRequestOptions,
        *,
        stream: bool = False,
        stream_cls: type[_AsyncStreamT] | None = None,
    ) -> ResponseT | _AsyncStreamT:
        if self._platform is None:
            # `get_platform` can make blocking IO calls so we
            # execute it earlier while we are in an async context
            self._platform = await asyncify(get_platform)()
    
        cast_to = self._maybe_override_cast_to(cast_to, options)
    
        # create a copy of the options we were given so that if the
        # options are mutated later & we then retry, the retries are
        # given the original options
        input_options = model_copy(options)
        if input_options.idempotency_key is None and input_options.method.lower() != "get":
            # ensure the idempotency key is reused between requests
            input_options.idempotency_key = self._idempotency_key()
    
        response: httpx.Response | None = None
        max_retries = input_options.get_max_retries(self.max_retries)
    
        retries_taken = 0
        for retries_taken in range(max_retries + 1):
            options = model_copy(input_options)
            options = await self._prepare_options(options)
    
            remaining_retries = max_retries - retries_taken
            request = self._build_request(options, retries_taken=retries_taken)
            await self._prepare_request(request)
    
            kwargs: HttpxSendArgs = {}
            if self.custom_auth is not None:
                kwargs["auth"] = self.custom_auth
    
            if options.follow_redirects is not None:
                kwargs["follow_redirects"] = options.follow_redirects
    
            log.debug("Sending HTTP Request: %s %s", request.method, request.url)
    
            response = None
            try:
                response = await self._send_request(
                    request,
                    stream=stream or self._should_stream_response_body(request=request),
                    **kwargs,
                )
            except httpx.TimeoutException as err:
                log.debug("Encountered httpx.TimeoutException", exc_info=True)
    
                if remaining_retries > 0:
                    await self._sleep_for_retry(
                        retries_taken=retries_taken,
                        max_retries=max_retries,
                        options=input_options,
                        response=None,
                    )
                    continue
    
                log.debug("Raising timeout error")
                raise APITimeoutError(request=request) from err
            except OpenAIError as err:
                # Propagate OpenAIErrors as-is, without retrying or wrapping in APIConnectionError
                raise err
            except Exception as err:
                log.debug("Encountered Exception", exc_info=True)
    
                if remaining_retries > 0:
                    await self._sleep_for_retry(
                        retries_taken=retries_taken,
                        max_retries=max_retries,
                        options=input_options,
                        response=None,
                    )
                    continue
    
                log.debug("Raising connection error")
                raise APIConnectionError(request=request) from err
    
            log.debug(
                'HTTP Response: %s %s "%i %s" %s',
                request.method,
                request.url,
                response.status_code,
                response.reason_phrase,
                response.headers,
            )
            log.debug("request_id: %s", response.headers.get("x-request-id"))
    
            try:
                response.raise_for_status()
            except httpx.HTTPStatusError as err:  # thrown on 4xx and 5xx status code
                log.debug("Encountered httpx.HTTPStatusError", exc_info=True)
    
                if remaining_retries > 0 and self._should_retry(err.response):
                    await err.response.aclose()
                    await self._sleep_for_retry(
                        retries_taken=retries_taken,
                        max_retries=max_retries,
                        options=input_options,
                        response=response,
                    )
                    continue
    
                # If the response is streamed then we need to explicitly read the response
                # to completion before attempting to access the response text.
                if not err.response.is_closed:
                    await err.response.aread()
    
                log.debug("Re-raising status error")
>               raise self._make_status_error_from_response(err.response) from None
E               openai.AuthenticationError: Error code: 401 - {'error': {'message': "Invalid API key directive 'sk-lr-8f2a9e3b1c4d7e5f'. Must follow lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>", 'type': 'invalid_request_error', 'code': 'invalid_api_key'}}

.venv/lib/python3.14/site-packages/openai/_base_client.py:1716: AuthenticationError

The above exception was the direct cause of the following exception:

    @pytest.mark.anyio
    async def test_gemini_flash_tool_call_via_openai_compat() -> None:
        """Tool call through OpenAI-compat route — requires thought_signature fix."""
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider
    
        p = OpenAIProvider(
            base_url=f"{GATEWAY_URL}/v1",
            api_key=os.environ.get("LITEROUTER_AUTH_KEY"),
            http_client=httpx.AsyncClient(http2=True),
        )
        m = OpenAIChatModel("google/gemini-3.1-flash-lite", provider=p)
        ag = Agent(model=m, system_prompt="You are a helpful assistant.")
    
        @ag.tool
        async def get_weather(ctx: RunContext[object], /, location: str) -> str:
            return f"The weather in {location} is 22°C and sunny."
    
>       result = await ag.run("What is the weather in Singapore? Use the get_weather tool.")
                 ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^

tests/integration/test_gemini_flash_tool_call.py:60: 
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 
.venv/lib/python3.14/site-packages/pydantic_ai/agent/abstract.py:545: in run
    node = await agent_run.next(node)  # pyright: ignore[reportArgumentType]
           ^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/run.py:402: in next
    return await self._run_node_with_hooks(node, self._advance_graph)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/run.py:326: in _run_node_with_hooks
    return await self._wrap_and_advance(run_context, node, step_fn)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/run.py:296: in _wrap_and_advance
    result = await cap.on_node_run_error(run_context, node=node, error=e)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:331: in on_node_run_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:328: in on_node_run_error
    return await capability.on_node_run_error(cap_ctx, node=node, error=error)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:492: in on_node_run_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:328: in on_node_run_error
    return await capability.on_node_run_error(cap_ctx, node=node, error=error)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:492: in on_node_run_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/run.py:294: in _wrap_and_advance
    result = await cap.wrap_node_run(run_context, node=node, handler=step_fn)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:314: in wrap_node_run
    return await chain(node)
           ^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:745: in wrapped
    return await cap.wrap_node_run(_ctx_for_cap(cap, ctx), node=node, handler=inner)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:471: in wrap_node_run
    return await handler(node)
           ^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:745: in wrapped
    return await cap.wrap_node_run(_ctx_for_cap(cap, ctx), node=node, handler=inner)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:471: in wrap_node_run
    return await handler(node)
           ^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/run.py:272: in _advance_graph
    task = await self._graph_run.next(task)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_graph/graph_builder.py:580: in next
    return await anext(self)
           ^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_graph/graph_builder.py:557: in __anext__
    raise self._next.error
.venv/lib/python3.14/site-packages/pydantic_graph/graph_builder.py:856: in _run_tracked_task
    result = await self._run_task(t_)
             ^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_graph/graph_builder.py:903: in _run_task
    output = await node.call(step_context)
             ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_graph/step.py:253: in _call_node
    return await node.run(GraphRunContext(state=ctx.state, deps=ctx.deps))
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/_agent_graph.py:630: in run
    return await self._make_request(ctx)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/_agent_graph.py:873: in _make_request
    model_response = await ctx.deps.root_capability.on_model_request_error(
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:401: in on_model_request_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:398: in on_model_request_error
    return await capability.on_model_request_error(cap_ctx, request_context=request_context, error=error)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:573: in on_model_request_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:398: in on_model_request_error
    return await capability.on_model_request_error(cap_ctx, request_context=request_context, error=error)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:573: in on_model_request_error
    raise error
.venv/lib/python3.14/site-packages/pydantic_ai/_agent_graph.py:863: in _make_request
    model_response = await ctx.deps.root_capability.wrap_model_request(
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:384: in wrap_model_request
    return await chain(request_context)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:707: in wrapped
    return await cap.wrap_model_request(
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:550: in wrap_model_request
    return await handler(request_context)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/combined.py:707: in wrapped
    return await cap.wrap_model_request(
.venv/lib/python3.14/site-packages/pydantic_ai/capabilities/abstract.py:550: in wrap_model_request
    return await handler(request_context)
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
.venv/lib/python3.14/site-packages/pydantic_ai/_agent_graph.py:848: in model_handler
    response = await req_ctx.model.request(
.venv/lib/python3.14/site-packages/pydantic_ai/models/openai.py:836: in request
    response = await self._completions_create(
.venv/lib/python3.14/site-packages/pydantic_ai/models/openai.py:925: in _completions_create
    with _map_api_errors(self.model_name):
         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
../../.local/share/uv/python/cpython-3.14.0-linux-x86_64-gnu/lib/python3.14/contextlib.py:162: in __exit__
    self.gen.throw(value)
_ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ _ 

model_name = 'google/gemini-3.1-flash-lite'

    @contextmanager
    def _map_api_errors(model_name: str) -> Generator[None]:
        try:
            yield
        except APIStatusError as e:
            if (status_code := e.status_code) >= 400:
>               raise ModelHTTPError(status_code=status_code, model_name=model_name, body=e.body) from e
E               pydantic_ai.exceptions.ModelHTTPError: status_code: 401, model_name: google/gemini-3.1-flash-lite, body: {'message': "Invalid API key directive 'sk-lr-8f2a9e3b1c4d7e5f'. Must follow lr-<provider>-<payload>-<completions>-<nuances> or lr-fse-<preset>", 'type': 'invalid_request_error', 'code': 'invalid_api_key'}

.venv/lib/python3.14/site-packages/pydantic_ai/models/openai.py:195: ModelHTTPError
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
=========================== short test summary info ============================
FAILED tests/integration/smoke/test_gemini_flash_pass_through.py::test_gemini_flash_via_native[generateContent]
FAILED tests/integration/smoke/test_gemini_flash_pass_through.py::test_gemini_flash_via_native[streamGenerateContent]
FAILED tests/integration/smoke/test_gemini_flash_pass_through.py::test_gemini_flash_via_openai_compat
FAILED tests/integration/test_dots_transformer_e2e.py::test_dots_non_streaming_converts_to_tool_calls
FAILED tests/integration/test_dots_transformer_e2e.py::test_dots_streaming_converts_to_tool_calls
FAILED tests/integration/test_e2e_gateway_mock.py::test_e2e_mock_non_stream_success
FAILED tests/integration/test_e2e_gateway_mock.py::test_e2e_mock_429_rotation_failover
FAILED tests/integration/test_e2e_gateway_mock.py::test_e2e_mock_streaming_sse
FAILED tests/integration/test_e2e_gateway_mock.py::test_e2e_mock_all_keys_exhausted
FAILED tests/integration/test_gemini_flash_tool_call.py::test_gemini_flash_tool_call_via_native[asyncio]
FAILED tests/integration/test_gemini_flash_tool_call.py::test_gemini_flash_tool_call_via_openai_compat[asyncio]
================== 11 failed, 2 skipped, 3 warnings in 4.98s ===================
Run started: 2026-08-18T05:55:40Z
bun test v1.3.13 (bf2e2cec)

tests/smoke/health_probe.test.ts:
(pass) Gateway Smoke Health Probes > GET /health responds with 200 OK and healthy status under 50ms [0.80ms]
(pass) Gateway Smoke Health Probes > GET /v1/models probe with valid key returns 200 OK [0.85ms]

tests/integration/models_discovery.test.ts:
(pass) Dynamic Model Discovery Integration > filters models dynamically for OpenRouter direct key [1.52ms]
(pass) Dynamic Model Discovery Integration > filters models dynamically for Google Gemini direct key [0.24ms]
(pass) Dynamic Model Discovery Integration > returns configured models for Fusion preset key [0.29ms]
(pass) Dynamic Model Discovery Integration > serves Google native schema for GET /v1beta/models?key=... [0.21ms]
(pass) Dynamic Model Discovery Integration > rejects model discovery with 401 when key is missing or invalid [0.12ms]

tests/integration/stream_stall_resend.test.ts:
🔵 [08-18-05:55:40:595] [req_sjvpeol] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-05:55:40:607] [TTFT req_sjvpeol] TTFT = 8ms | Stream established
(pass) Stream Stall Resend Integration > handles mid-stream stall and retries on the same key up to max attempts [21.40ms]

tests/integration/dual_http_h2.test.ts:
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > serves cleartext HTTP/1.1 requests correctly on port 7766 [0.21ms]
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > processes concurrent parallel requests without head-of-line blocking [0.43ms]
(pass) Dual Protocol HTTP/1.1 & HTTP/2 ALPN Integration > gracefully falls back when TLS certificates are absent [0.14ms]

tests/integration/hard_reset_flush.test.ts:
(pass) Operational Hard Reset & Flush Integration > handles GET /reset and flushes all rate limits and quarantines [0.82ms]
(pass) Operational Hard Reset & Flush Integration > handles POST /reset unfreezing quarantined key states [0.16ms]

tests/integration/openai_compat.test.ts:
🔵 [08-18-05:55:40:626] [req_ndqzz5k] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-05:55:40:628] [TTFT req_ndqzz5k] TTFT = 2ms | First chunk streamed downstream
🟢 [08-18-05:55:40:628] [USAGE req_ndqzz5k] OpenRouter (Key #1/2)
    Tokens: Prompt=10 | Completion=6 | Total=16 | Speed=3000.0 tok/s
🟢 [08-18-05:55:40:633] [SERVED req_ndqzz5k] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) OpenAI Compatibility Handler Integration > handles non-streaming POST /v1/chat/completions successfully [21.54ms]
🔵 [08-18-05:55:40:647] [req_a9s674k] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-05:55:40:649] [TTFT req_a9s674k] TTFT = 1ms | Stream established
(pass) OpenAI Compatibility Handler Integration > handles streaming POST /v1/chat/completions with SSE [15.59ms]
(pass) OpenAI Compatibility Handler Integration > returns 401 when API key directive is missing or malformed [19.83ms]

tests/integration/abort_propagation.test.ts:
🔵 [08-18-05:55:40:690] [req_79rg45e] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
🟢 [08-18-05:55:40:692] [TTFT req_79rg45e] TTFT = 2ms | Stream established
(pass) Client Abort Signal Propagation Integration > propagates downstream client abort signal upstream immediately [101.12ms]

tests/integration/ghost_response_guard.test.ts:
🔵 [08-18-05:55:40:786] [req_9nsvrze] Inbound POST /v1/chat/completions from unknown
    Directive : lr-or-oa-ch-no -> Target: OpenRouter | Wire: OpenAI | EP: /api/v1/chat/completions
    Model     : openai/gpt-4o | Key: OpenRouter [Key #1/2]
⚠️ [08-18-05:55:40:790] [LIMIT req_9nsvrze] OpenRouter [Key #1/2] returned 429 Too Many Requests
    Parsed Retry-After: 60s -> Quarantined Key #1 for 60s
🔄 [08-18-05:55:40:790] [ROTATE req_9nsvrze] Advancing to OpenRouter [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-05:55:40:791] [TTFT req_9nsvrze] TTFT = 1ms | Stream established
(pass) Ghost Response & Zero-Token Guard Integration > detects 0-token HTTP 200 stream, rotates key, and succeeds seamlessly [18.82ms]

tests/integration/google_native.test.ts:
🔵 [08-18-05:55:40:808] [req_ih7zumw] Inbound POST /v1beta/models/gemini-2.5-flash:generateContent from unknown
    Directive : lr-gg-gg-gc-no -> Target: Google | Wire: Google | EP: /v1beta/models/gemini-2.5-flash:generateContent
    Model     : gemini-2.5-flash | Key: Google [Key #1/2]
🟢 [08-18-05:55:40:809] [TTFT req_ih7zumw] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-05:55:40:809] [SERVED req_ih7zumw] HTTP 200 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Google Native & Beta Endpoints Integration > handles native /v1beta/models/*:generateContent with ?key= query auth [16.80ms]
🔵 [08-18-05:55:40:828] [req_a14mwys] Inbound POST /v1beta/openai/chat/completions from unknown
    Directive : lr-gg-oa-ob-dp -> Target: Google | Wire: OpenAI | EP: /v1beta/openai/chat/completions
    Model     : gemini-2.5-flash | Key: Google [Key #1/2] | Nuances: [dp]
🟢 [08-18-05:55:40:829] [TTFT req_a14mwys] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-05:55:40:829] [SERVED req_a14mwys] HTTP 200 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Google Native & Beta Endpoints Integration > handles OpenAI-compatible beta /v1beta/openai/chat/completions [19.81ms]
(pass) Google Native & Beta Endpoints Integration > rejects unauthorized native requests with 401 [19.46ms]

tests/integration/anthropic_compat.test.ts:
🔵 [08-18-05:55:40:871] [req_azm8b7p] Inbound POST /v1/messages from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-18-05:55:40:873] [TTFT req_azm8b7p] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-05:55:40:873] [USAGE req_azm8b7p] Anthropic (Key #1/2)
    Tokens: Prompt=10 | Completion=8 | Total=18 | Speed=8000.0 tok/s
🟢 [08-18-05:55:40:874] [SERVED req_azm8b7p] HTTP 200 in 1ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles non-streaming POST /v1/messages with x-api-key header [23.10ms]
🔵 [08-18-05:55:40:891] [req_lvane9i] Inbound POST /v1/messages from unknown
    Directive : lr-an-cl-ms-no -> Target: Anthropic | Wire: Claude | EP: /v1/messages
    Model     : claude-3-7-sonnet-20250219 | Key: Anthropic [Key #1/2]
🟢 [08-18-05:55:40:893] [TTFT req_lvane9i] TTFT = 2ms | Stream established
🟢 [08-18-05:55:40:893] [USAGE req_lvane9i] Anthropic (Key #1/2)
    Tokens: Prompt=0 | Completion=5 | Total=5 | Speed=2500.0 tok/s
🟢 [08-18-05:55:40:893] [SERVED req_lvane9i] HTTP 200 in 2ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) Anthropic Compatibility Handler Integration > handles streaming POST /v1/messages and emits SSE event stream [20.00ms]
(pass) Anthropic Compatibility Handler Integration > rejects unauthorized request with 401 when key is missing [18.75ms]

tests/unit/visual_telemetry.test.ts:
(pass) Visual Telemetry & Terminal UI > formats timestamps consistently in [MM-DD-HH:MM:SS:mmm] format [0.63ms]
(pass) Visual Telemetry & Terminal UI > resolves friendly provider and wire display names [0.05ms]
(pass) Visual Telemetry & Terminal UI > formats token numbers with thousands commas [0.11ms]
(pass) Visual Telemetry & Terminal UI > logs rich multi-line inbound request telemetry [0.18ms]
(pass) Visual Telemetry & Terminal UI > logs TTFT and token usage with tok/s speed calculation [0.19ms]
(pass) Visual Telemetry & Terminal UI > logs limit warning with parsed retry-after [0.09ms]
(pass) Visual Telemetry & Terminal UI > logs key rotation with attempt count [0.08ms]
(pass) Visual Telemetry & Terminal UI > logs separator line [0.03ms]

tests/unit/language_guardrail.test.ts:
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-01: enforces zero Chinese character leakage in generic code reasoning and comments [0.05ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-02: detects and flags Chinese token leakage in code outputs [0.02ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-03: preserves 100% genuine Chinese characters in BaZi metaphysics data payloads while keeping explanations in English [0.16ms]
(pass) Multilingual Guardrail & Domain Metaphysics Invariants > T-04: verifies all 10 Heavenly Stems, 12 Earthly Branches, and Ten Gods in whitelist [0.05ms]

tests/unit/zdist.test.ts:
(pass) Rate Limit Tracker — Sliding Window RPM > records requests and counts within sliding 60s window [0.20ms]
(pass) Rate Limit Tracker — Sliding Window RPM > tracks RPM independently per key index [0.04ms]
(pass) Rate Limit Tracker — Sliding Window RPM > detects 95% threshold approach for RPM ceiling [0.12ms]
(pass) Rate Limit Tracker — Daily RPD Quota > records and returns daily cumulative requests [0.18ms]
(pass) Rate Limit Tracker — Daily RPD Quota > detects 95% threshold approach for daily RPD quota [0.21ms]
(pass) Rate Limit Tracker — Daily RPD Quota > clears all counters on hard reset [0.05ms]

tests/unit/path_resolver.test.ts:
(pass) Path Resolver — providers.json Completion URL Mapping > resolves OpenRouter chat completions endpoint (or, ch) [0.04ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves OpenRouter messages endpoint (or, ms) [0.01ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves NVIDIA chat completions endpoint (nv, ch)
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google OpenAI-compat beta endpoint (gg, ob)
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google native generateContent with model substitution (gg, gc) [0.01ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Google embeddings with model substitution (gg, em)
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Anthropic direct messages endpoint (an, ms) [0.01ms]
(pass) Path Resolver — providers.json Completion URL Mapping > resolves Zen chat endpoint (zn, ch)
(pass) Path Resolver — providers.json Completion URL Mapping > returns null for non-existent completion code on provider [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats standard Bearer header for OpenRouter [0.04ms]
(pass) Path Resolver — Outbound Auth Transformation > formats standard Bearer header for NVIDIA NIM
(pass) Path Resolver — Outbound Auth Transformation > formats x-api-key and anthropic-version for Anthropic direct [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats Bearer header for Google OpenAI beta endpoint (ob) [0.01ms]
(pass) Path Resolver — Outbound Auth Transformation > formats query parameter ?key= for Google Native RPC (gc) [0.01ms]

tests/unit/fusion_sticky.test.ts:
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > returns null when no sticky position is cached [0.09ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > stores and returns sticky tier position on fallback [0.26ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > isolates sticky positions across distinct models [0.05ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > expires sticky position after 5-minute TTL [0.03ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > clears sticky tier when primary recovery succeeds [0.03ms]
(pass) Fusion Sticky Cache — 5-Minute Fallback Position > resets all sticky entries on clearAll [0.02ms]

tests/unit/classifier.test.ts:
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'Provider returned error' as retry_rotate with 0s quarantine [0.11ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'No available provider' as retry_rotate with 0s quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'temporarily unavailable' as retry_rotate with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > handles case-insensitivity for retryable 400 patterns [0.01ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'maximum context length' as fail_fast with 0s quarantine [0.01ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'context_length' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'safety' as fail_fast with 0s quarantine [0.01ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies 'HARM_PROBABILITY' as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 400 - Provider-side retryable vs client-side fail-fast > classifies generic 400 errors as fail_fast with 0s quarantine [0.01ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 standard rate limit as retry_rotate with 65s default quarantine [0.12ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > honors Retry-After header for 429 standard rate limit [0.05ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > honors Retry-After in Record<string, string> format [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'insufficient_quota' as retry_rotate with 7-day (604800s) quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'credit_limit' as retry_rotate with 7-day quarantine [0.01ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 429 - Rate limit vs Quota exhaustion > classifies 429 with 'out of balance' as retry_rotate with 7-day quarantine [0.01ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 401 as retry_rotate with 7-day (604800s) quarantine [0.03ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 401 & 403 - Authentication and Authorization errors > classifies 403 as retry_rotate with 7-day (604800s) quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 500 as retry_rotate with 10s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 502 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 503 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError > HTTP 5xx - Transient server errors > classifies HTTP 504 as retry_rotate with 10s quarantine
(pass) Error Classifier — classifyUpstreamError > HTTP 404 - Not Found > classifies 404 as fail_fast with 0s quarantine [0.02ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > handles undefined bodyText gracefully [0.01ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > handles empty string bodyText gracefully [0.01ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > safely processes huge bodies (>4KB) without performance degradation or errors [0.09ms]
(pass) Error Classifier — classifyUpstreamError > Robustness & Bounded parsing > safely handles non-JSON malformed bodies [0.02ms]

tests/unit/gemma_transformer.test.ts:
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > converts system message into prepended [System Context] in first user message [0.83ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > creates a user message if only a system message is present [0.04ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > merges consecutive user messages into a single user turn [0.07ms]
(pass) Gemma Transformer — System Prompt Transformation & Turn Merging > merges consecutive assistant messages into a single turn [0.03ms]
(pass) Gemma Transformer — End-to-End Payload Sanitization > applies gemma constraints when 'gm' nuance is provided [0.08ms]
(pass) LaTeX Normalizer > replaces double-escaped times formula with clean unicode [0.02ms]
(pass) LaTeX Normalizer > replaces rightarrow with unicode arrow [0.05ms]
(pass) LaTeX Normalizer > replaces inequality symbols [0.02ms]

tests/unit/header_sanitizer.test.ts:
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > strips content-encoding and compression headers from downstream responses [0.07ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > strips all RFC hop-by-hop headers [0.10ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > updates content-length when bodyLength is supplied [0.03ms]
(pass) Header Sanitizer — Compression and Hop-by-Hop Stripping > omits content-length if bodyLength is undefined [0.04ms]

tests/unit/rotation_loop.test.ts:
🔵 [08-18-05:55:40:928] [req_hhbdiup] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-05:55:40:928] [TTFT req_hhbdiup] TTFT = 0ms | First chunk streamed downstream
🔄 [08-18-05:55:40:928] [ROTATE req_hhbdiup] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-05:55:40:928] [TTFT req_hhbdiup] TTFT = 0ms | First chunk streamed downstream
🟢 [08-18-05:55:40:928] [USAGE req_hhbdiup] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-18-05:55:40:929] [SERVED req_hhbdiup] HTTP 200 in 0ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 returns 400 'Provider returned error' and succeeds with 200 [1.34ms]
🔵 [08-18-05:55:40:929] [req_2afu2t8] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-05:55:40:929] [TTFT req_2afu2t8] TTFT = 0ms | First chunk streamed downstream
🟢 [08-18-05:55:40:929] [SERVED req_2afu2t8] HTTP 400 in 0ms (attempt 1/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > fails fast on 400 'maximum context length' without trying Key 2 [0.50ms]
🔵 [08-18-05:55:40:929] [req_a9vbeev] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-05:55:40:930] [TTFT req_a9vbeev] TTFT = 1ms | First chunk streamed downstream
⚠️ [08-18-05:55:40:930] [LIMIT req_a9vbeev] OpenAI [Key #1/2] returned 429 Too Many Requests
    Parsed Retry-After: 30s -> Quarantined Key #1 for 30s
🔄 [08-18-05:55:40:930] [ROTATE req_a9vbeev] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-05:55:40:930] [TTFT req_a9vbeev] TTFT = 0ms | First chunk streamed downstream
🟢 [08-18-05:55:40:930] [USAGE req_a9vbeev] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15
🟢 [08-18-05:55:40:930] [SERVED req_a9vbeev] HTTP 200 in 0ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > retries on Key 2 when Key 1 returns 429 Rate Limit and succeeds with 200 [0.84ms]
🔵 [08-18-05:55:40:930] [req_aq7m4qx] Inbound POST /v1/chat/completions from unknown
    Directive : lr-oa-oa-ch-no -> Target: OpenAI | Wire: OpenAI | EP: /v1/chat/completions
    Model     : gpt-4o | Key: OpenAI [Key #1/2]
🟢 [08-18-05:55:40:930] [TTFT req_aq7m4qx] TTFT = 0ms | First chunk streamed downstream
⚠️ [08-18-05:55:40:930] [LIMIT req_aq7m4qx] OpenAI [Key #1/2] returned 401 Too Many Requests
    Parsed Retry-After: 604800s -> Quarantined Key #1 for 604800s
🔄 [08-18-05:55:40:930] [ROTATE req_aq7m4qx] Advancing to OpenAI [Key #2/2] -> Retrying immediately (Attempt 2/2)
🟢 [08-18-05:55:40:931] [TTFT req_aq7m4qx] TTFT = 1ms | First chunk streamed downstream
🟢 [08-18-05:55:40:931] [USAGE req_aq7m4qx] OpenAI (Key #2/2)
    Tokens: Prompt=10 | Completion=5 | Total=15 | Speed=5000.0 tok/s
🟢 [08-18-05:55:40:931] [SERVED req_aq7m4qx] HTTP 200 in 1ms (attempt 2/2)
────────────────────────────────────────────────────────────────────────────────
(pass) In-Flight Retry & Rotation Loop > quarantines Key 1 for 7 days on 401 and succeeds with Key 2 [0.92ms]

tests/unit/cooldown.test.ts:
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 65s default cooldown on HTTP 429 rate limit [0.55ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 10s cooldown on transient 5xx server errors [0.04ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 7 days cooldown on 401/403 auth errors [0.01ms]
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns 0s cooldown on 400/404 client errors (no penalty on key)
(pass) Cooldown Manager — Status Code Reason-Aware Mapping > assigns baseline 30s cooldown for unknown errors
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses numeric Retry-After header [0.03ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > clamps sub-minimum delay to 5s min threshold [0.01ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > clamps excessive delay to 7200s max threshold
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses Google JSON error quotaResetDelay string [0.04ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > parses Google JSON error retryDelay field in details [0.02ms]
(pass) Cooldown Manager — Retry-After & Google Delay Parsing > flags sub-2s reset delays for immediate grace retry [0.02ms]
(pass) Cooldown Manager — Pool Exhaustion Ladder Backoff > calculates 3-step ladder backoff delays [0.04ms]
(pass) Cooldown Manager — In-Memory Key State Management > quarantines key and tracks remaining cooldown ms [0.04ms]
(pass) Cooldown Manager — In-Memory Key State Management > reports unquarantined once cooldown epoch passes [0.01ms]
(pass) Cooldown Manager — In-Memory Key State Management > flushes all quarantined keys on clearAll [0.02ms]

tests/unit/directive_parser.test.ts:
(pass) Directive Parser — Direct Keys > parses standard OpenRouter claude direct key [0.06ms]
(pass) Directive Parser — Direct Keys > parses NVIDIA OpenAI-format chat direct key with dot-prompt [0.03ms]
(pass) Directive Parser — Direct Keys > parses Google OpenAI beta direct key [0.02ms]
(pass) Directive Parser — Direct Keys > parses Zen provider direct key [0.02ms]
(pass) Directive Parser — Direct Keys > parses all registered 2-letter provider codes [0.08ms]
(pass) Directive Parser — Direct Keys > parses all registered 2-letter completion codes [0.10ms]
(pass) Directive Parser — Compound Nuances > parses two compound nuances delimited by plus [0.03ms]
(pass) Directive Parser — Compound Nuances > parses three compound nuances [0.01ms]
(pass) Directive Parser — Compound Nuances > parses compound nuances with gemma and strip-budget [0.01ms]
(pass) Directive Parser — Fusion Keys > parses quad fusion preset key [0.03ms]
(pass) Directive Parser — Fusion Keys > parses pydn fusion preset key [0.01ms]
(pass) Directive Parser — Fusion Keys > parses fast and deep presets [0.01ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > normalizes uppercase direct keys to lowercase [0.02ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > trims surrounding whitespace and tabs [0.01ms]
(pass) Directive Validator — Strict Lowercase & Sanitization > normalizes uppercase fusion keys [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects empty or missing key with 401 invalid_api_key [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects standard OpenAI key format without lr prefix
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects incomplete direct key with only 3 segments
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown provider code [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown payload wire code [0.02ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects unknown completion code [0.01ms]
(pass) Directive Validator — Zero-Fallback Strict 401 Rejections > rejects invalid nuance modifier in compound list [0.01ms]

tests/unit/dots_xml_transformer.test.ts:
(pass) Dots XML Transformer — Static Parsing > parses single XML function invocation into OpenAI tool_calls structure [0.90ms]
(pass) Dots XML Transformer — Static Parsing > parses XML invocation with multiple parameters [0.06ms]
(pass) Dots XML Transformer — Static Parsing > passes through text without XML invocations untouched [0.02ms]
(pass) Dots XML Transformer — Streaming Chunk Handling > handles XML tags split across chunk boundaries [0.21ms]

tests/unit/thinking_transformer.test.ts:
(pass) Thinking Transformer — Streaming Delta Processing > strips thinking block content when preserveThinking is false [0.11ms]
(pass) Thinking Transformer — Streaming Delta Processing > converts thinking block to thinking_delta when preserveThinking is true [0.05ms]
(pass) Thinking Transformer — Streaming Delta Processing > passes clean text without thinking tags as text_delta [0.03ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > preserves reasoning if 'ts' nuance is present, overriding global default [0.02ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > strips reasoning if 'sb' nuance is present, overriding global default [0.01ms]
(pass) Thinking Transformer — Reasoning Stripping Policy > follows global default when neither 'ts' nor 'sb' is specified [0.01ms]
(pass) Thinking Transformer — Payload Parameter Scrubber > removes reasoning and thinking parameters from payload [0.04ms]

tests/unit/zod_schema.test.ts:
(pass) Zod Schema — providers.json Validation > validates a conforming providers configuration [0.28ms]
(pass) Zod Schema — providers.json Validation > rejects invalid base_url format in providers [0.52ms]
(pass) Zod Schema — providers.json Validation > rejects negative rate limits [0.11ms]
(pass) Zod Schema — fusion.json Validation > validates a conforming fusion configuration with presets and tiers [0.32ms]
(pass) Zod Schema — fusion.json Validation > rejects tier missing apikey directive [0.13ms]
(pass) Zod Schema — Environment Variables Auto-Coercion & Defaults > applies resilient defaults when optional env vars are omitted [0.17ms]
(pass) Zod Schema — Environment Variables Auto-Coercion & Defaults > coerces string numbers and booleans properly [0.14ms]

tests/unit/thought_signature.test.ts:
(pass) Google Thought Signature Store — Capture & Injection > saves and retrieves thought signature by tool call id [0.04ms]
(pass) Google Thought Signature Store — Capture & Injection > returns undefined for untracked tool call id [0.02ms]
(pass) Google Thought Signature Store — Capture & Injection > injects saved thought signature into matching historical assistant tool call [0.08ms]
(pass) Google Thought Signature Store — Capture & Injection > leaves messages unchanged if no tool calls exist [0.02ms]
(pass) Google Thought Signature Store — Capture & Injection > clears all stored signatures on clearThoughtSignatures [0.01ms]

tests/unit/auth_extractor.test.ts:
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from standard Authorization Bearer header [0.05ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from case-insensitive bearer prefix [0.07ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from x-api-key header (Anthropic format) [0.03ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?key= (Google format) [0.03ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?api_key= [0.02ms]
(pass) Auth Extractor — Waterfall Extraction Channels > extracts directive from URL query parameter ?token= [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes Authorization Bearer over x-api-key header [0.02ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes headers over URL query parameters [0.01ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > prioritizes ?key= over ?api_key= in query parameters [0.01ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > returns null when no authorization mechanism is present [0.01ms]
(pass) Auth Extractor — Waterfall Precedence & Edge Cases > passes extracted token cleanly to validator for schema verification [0.04ms]

 175 pass
 0 fail
 481 expect() calls
Ran 175 tests across 26 files. [407.00ms]
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
=================== 6 passed, 7 skipped, 3 warnings in 3.99s ===================
