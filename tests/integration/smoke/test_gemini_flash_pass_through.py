import os

import httpx
import pytest

GATEWAY_URL = os.environ.get("LITEROUTER_BASE_URL", "http://127.0.0.1:7766")
AUTH_TOKEN = os.environ.get("LITEROUTER_AUTH_KEY")

MODEL = "google/gemini-3.1-flash-lite"

PAYLOAD = {
    "contents": [{"parts": [{"text": "say OK"}], "role": "user"}],
    "generationConfig": {"maxOutputTokens": 10},
}


def _native_url(action: str) -> str:
    return f"{GATEWAY_URL}/v1beta/models/{MODEL}:{action}"


def _assert_native_content_response(resp: httpx.Response) -> None:
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
    data = resp.json()
    candidates = data.get("candidates")
    assert candidates, f"No candidates in response: {resp.text[:300]}"
    assert len(candidates) > 0


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

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"

    if action == "generateContent":
        _assert_native_content_response(resp)


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

    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text[:200]}"
    data = resp.json()
    choices = data.get("choices")
    assert choices, f"No choices in response: {resp.text[:300]}"
