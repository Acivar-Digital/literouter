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
