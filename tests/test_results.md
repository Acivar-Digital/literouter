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

