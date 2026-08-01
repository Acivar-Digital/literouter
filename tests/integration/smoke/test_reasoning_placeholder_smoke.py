import httpx
import pytest

GATEWAY_URL = "http://127.0.0.1:7766"
AUTH_TOKEN = "sk-lr-8f2a9e3b1c4d7e5f"

def test_reasoning_placeholder_and_history_sanitization():
    url = f"{GATEWAY_URL}/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AUTH_TOKEN}",
    }

    payload_turn1 = {
        "model": "openrouter/inclusionai/ling-3.0-flash:free",
        "messages": [{"role": "user", "content": "reply with OK"}],
        "stream": True,
        "max_tokens": 10,
    }

    with httpx.stream("POST", url, json=payload_turn1, headers=headers, timeout=30) as resp:
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        lines = [line for line in resp.iter_lines() if line]
        assert len(lines) > 0, "Expected non-empty SSE stream"

    payload_turn2 = {
        "model": "openrouter/inclusionai/ling-3.0-flash:free",
        "messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "Thinking... \n\nHello!"},
            {"role": "user", "content": "reply with OK"},
        ],
        "stream": False,
        "max_tokens": 10,
    }

    resp2 = httpx.post(url, json=payload_turn2, headers=headers, timeout=30)
    assert resp2.status_code == 200, f"Turn 2 expected 200, got {resp2.status_code}: {resp2.text[:200]}"
    data = resp2.json()
    assert "choices" in data and len(data["choices"]) > 0
