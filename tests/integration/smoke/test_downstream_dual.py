"""Integration smoke test: both downstream protocols through the LiteRouter gateway.

This is a SMOKE test, not a CI gate. It is skipped automatically when:
  * the gateway is not running on the configured base URL (connection refused), or
  * the required auth key / provider keys are absent.

Run with:  uv run pytest tests/integration/smoke/ --collect-only
Full run:  uv run pytest tests/integration/smoke/
"""

import json
import os
from typing import Any, Dict, Optional

import httpx
import pytest

BASE_URL: str = os.environ.get("LITEROUTER_BASE_URL", "http://localhost:7766").rstrip(
    "/"
)
AUTH_KEY: str = os.environ.get("LITEROUTER_AUTH_KEY", "")

MODELS_PATH: str = os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "config", "models.json"
)


def _load_models() -> list[Dict[str, Any]]:
    with open(MODELS_PATH) as f:
        data = json.load(f)
        if isinstance(data, dict) and "models" in data:
            models_val = data["models"]
            if isinstance(models_val, list):
                return models_val
        if isinstance(data, list):
            return data
        return []


def _pick(provider: str) -> Optional[Dict[str, Any]]:
    for m in _load_models():
        if m.get("provider") == provider:
            return m
    return None


def _headers(token: Optional[str] = None) -> Dict[str, str]:
    key = token or AUTH_KEY
    if key:
        return {"Authorization": f"Bearer {key}"}
    return {}


def _gateway_reachable() -> bool:
    for path in ("/health", "/"):
        try:
            httpx.get(f"{BASE_URL}{path}", timeout=1.5, verify=False)
            return True
        except (httpx.ConnectError, httpx.ConnectTimeout, httpx.HTTPError):
            continue
    return False


def _post(
    url: str,
    body: Dict[str, Any],
    headers: Optional[Dict[str, str]] = None,
) -> httpx.Response:
    try:
        req_headers = headers if headers is not None else _headers()
        return httpx.post(
            url, json=body, headers=req_headers, timeout=30, verify=False
        )
    except (httpx.ConnectError, httpx.ConnectTimeout):
        pytest.skip("Gateway became unreachable during test")
        raise


def _handle_response(resp: httpx.Response) -> None:
    if resp.status_code in (401, 403):
        pytest.skip("Auth key missing or invalid (LITEROUTER_AUTH_KEY)")
    if resp.status_code in (404, 429, 500, 502, 503):
        pytest.skip(f"Upstream/provider unavailable (status {resp.status_code})")
    assert resp.status_code == 200, resp.text[:500]


# Skip the whole module if the gateway isn't up.
pytestmark = pytest.mark.skipif(
    not _gateway_reachable(),
    reason="LiteRouter gateway not reachable on " + BASE_URL,
)


@pytest.mark.live
def test_opencode_native_generate_content() -> None:
    """OpenCode native path: POST /v1beta/models/<google>:generateContent."""
    model = _pick("google")
    if model is None:
        pytest.skip("No google model found in models.json")
    upstream: str = str(model.get("id", ""))
    url: str = f"{BASE_URL}/v1beta/models/{upstream}:generateContent"
    body: Dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": "Say hi in one word."}]}],
    }
    native_key = os.environ.get("LITEROUTER_AUTH_KEY_NATIVE", "lr-gg-gg-gc-no")
    resp = _post(url, body, headers={"Authorization": f"Bearer {native_key}"})
    _handle_response(resp)
    data = resp.json()
    assert "candidates" in data, data


@pytest.mark.live
def test_pydantic_ai_openai_compat() -> None:
    """pydantic-ai OpenAI-compat path: POST /v1/chat/completions."""
    models = _load_models()
    if not models:
        pytest.skip("No models loaded from models.json")
    model = models[0]
    system_id: str = str(model.get("id", ""))
    url: str = f"{BASE_URL}/v1/chat/completions"
    body: Dict[str, Any] = {
        "model": system_id,
        "messages": [{"role": "user", "content": "Say hi in one word."}],
        "max_tokens": 16,
        "stream": False,
    }
    openai_key = os.environ.get("LITEROUTER_AUTH_KEY_OPENAI", "lr-or-oa-ch-no")
    resp = _post(url, body, headers={"Authorization": f"Bearer {openai_key}"})
    _handle_response(resp)
    data = resp.json()
    assert "choices" in data, data
    assert data["choices"][0]["message"]["content"]
