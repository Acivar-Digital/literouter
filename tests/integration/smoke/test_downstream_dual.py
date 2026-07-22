"""Integration smoke test: both downstream protocols through the LiteRouter gateway.

This is a SMOKE test, not a CI gate. It is skipped automatically when:
  * the gateway is not running on the configured base URL (connection refused), or
  * the required auth key / provider keys are absent.

Run with:  uv run pytest tests/integration/smoke/ --collect-only
Full run:  uv run pytest tests/integration/smoke/
"""

import os
import sys

import httpx
import pytest

BASE_URL = os.environ.get("LITEROUTER_BASE_URL", "http://localhost:7766").rstrip("/")
AUTH_KEY = os.environ.get("LITEROUTER_AUTH_KEY", "")

MODELS_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "models.json"
)


def _load_models():
    import json

    with open(MODELS_PATH) as f:
        return json.load(f)


def _pick(provider: str):
    for m in _load_models():
        if m.get("provider") == provider:
            return m
    return None


def _headers() -> dict:
    if AUTH_KEY:
        return {"Authorization": f"Bearer {AUTH_KEY}"}
    return {}


def _gateway_reachable() -> bool:
    try:
        httpx.get(f"{BASE_URL}/health", timeout=1.5)
        return True
    except (httpx.ConnectError, httpx.ConnectTimeout, httpx.HTTPError):
        try:
            httpx.get(f"{BASE_URL}/", timeout=1.5)
            return True
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.HTTPError):
            return False


# Skip the whole module if the gateway isn't up.
pytestmark = pytest.mark.skipif(
    not _gateway_reachable(),
    reason="LiteRouter gateway not reachable on " + BASE_URL,
)


def test_opencode_native_generate_content():
    """OpenCode native path: POST /v1beta/models/<google>:generateContent."""
    model = _pick("google")
    if model is None:
        pytest.skip("No google model found in models.json")
    upstream = model["upstream_id"]
    url = f"{BASE_URL}/v1beta/models/{upstream}:generateContent"
    body = {
        "contents": [{"role": "user", "parts": [{"text": "Say hi in one word."}]}],
    }
    try:
        resp = httpx.post(url, json=body, headers=_headers(), timeout=30)
    except (httpx.ConnectError, httpx.ConnectTimeout):
        pytest.skip("Gateway became unreachable during test")
    if resp.status_code in (401, 403):
        pytest.skip("Auth key missing or invalid (LITEROUTER_AUTH_KEY)")
    if resp.status_code in (429, 500):
        pytest.skip(f"Upstream/provider unavailable (status {resp.status_code})")
    assert resp.status_code == 200, resp.text[:500]
    data = resp.json()
    assert "candidates" in data, data


def test_pydantic_ai_openai_compat():
    """pydantic-ai OpenAI-compat path: POST /v1/chat/completions."""
    model = _load_models()[0]
    system_id = model["system_id"]
    url = f"{BASE_URL}/v1/chat/completions"
    body = {
        "model": system_id,
        "messages": [{"role": "user", "content": "Say hi in one word."}],
        "max_tokens": 16,
        "stream": False,
    }
    try:
        resp = httpx.post(url, json=body, headers=_headers(), timeout=30)
    except (httpx.ConnectError, httpx.ConnectTimeout):
        pytest.skip("Gateway became unreachable during test")
    if resp.status_code in (401, 403):
        pytest.skip("Auth key missing or invalid (LITEROUTER_AUTH_KEY)")
    if resp.status_code in (429, 500):
        pytest.skip(f"Upstream/provider unavailable (status {resp.status_code})")
    assert resp.status_code == 200, resp.text[:500]
    data = resp.json()
    assert "choices" in data, data
    assert data["choices"][0]["message"]["content"]
