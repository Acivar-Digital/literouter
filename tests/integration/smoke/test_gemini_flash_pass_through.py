import os

import httpx
import pytest

GATEWAY_URL = "http://127.0.0.1:7766"
AUTH_TOKEN = os.environ.get("LITEROUTER_AUTH_KEY")

MODEL = "google/gemini-3.1-flash-lite"

PAYLOAD = {
    "contents": [{"parts": [{"text": "say OK"}], "role": "user"}],
    "generationConfig": {"maxOutputTokens": 10},
}


def _native_url(action: str) -> str:
    return f"{GATEWAY_URL}/v1beta/models/{MODEL}:{action}"


@pytest.mark.parametrize("action", ["generateContent", "streamGenerateContent"])
def test_gemini_flash_via_native(action):
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

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"

    if action == "generateContent":
        data = resp.json()
        candidates = data.get("candidates")
        assert candidates, f"No candidates in response: {resp.text[:300]}"
        assert len(candidates) > 0


def test_gemini_flash_via_openai_compat():
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

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
    data = resp.json()
    choices = data.get("choices")
    assert choices, f"No choices in response: {resp.text[:300]}"
