import json
import httpx
import pytest

GATEWAY_URL = "http://127.0.0.1:7766"
AUTH_TOKEN = "sk-lr-8f2a9e3b1c4d7e5f"

def test_reasoning_collapsible_streaming_and_history_sanitization():
    url = f"{GATEWAY_URL}/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AUTH_TOKEN}",
    }

    payload_turn1 = {
        "model": "openrouter/inclusionai/ling-3.0-flash:free",
        "messages": [{"role": "user", "content": "reply with OK"}],
        "stream": True,
        "max_tokens": 20,
    }

    chunks_content = []
    has_static_placeholder = False
    has_empty_role_chunks = False

    with httpx.stream("POST", url, json=payload_turn1, headers=headers, timeout=30) as resp:
        assert resp.status_code == 200, f"Expected 200, got {resp.status_code}"
        for line in resp.iter_lines():
            line = line.strip() if hasattr(line, "strip") else line
            if not line or not line.startswith("data: ") or line == "data: [DONE]":
                continue
            try:
                data = json.loads(line[6:])
                choices = data.get("choices", [])
                if not choices:
                    continue
                delta = choices[0].get("delta", {})
                
                if delta.get("content") == "Thinking... \n\n":
                    has_static_placeholder = True
                if set(delta.keys()) == {"role"} and not delta.get("content"):
                    has_empty_role_chunks = True
                
                content = delta.get("content", "")
                if content:
                    chunks_content.append(content)
            except Exception:
                pass

    full_stream_text = "".join(chunks_content)
    assert not has_static_placeholder, "FAIL: Found hardcoded 'Thinking... \\n\\n' static string!"
    assert not has_empty_role_chunks, "FAIL: Found empty {'delta':{'role':'assistant'}} discarded token chunks!"
    assert len(full_stream_text) > 0, "FAIL: Stream produced 0 content tokens!"

    payload_turn2 = {
        "model": "openrouter/inclusionai/ling-3.0-flash:free",
        "messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "<thought>\nlet me think...\n</thought>\nHello!"},
            {"role": "user", "content": "reply with OK"},
        ],
        "stream": False,
        "max_tokens": 10,
    }

    resp2 = httpx.post(url, json=payload_turn2, headers=headers, timeout=30)
    assert resp2.status_code == 200, f"Turn 2 expected 200, got {resp2.status_code}: {resp2.text[:200]}"
    data = resp2.json()
    assert "choices" in data and len(data["choices"]) > 0
