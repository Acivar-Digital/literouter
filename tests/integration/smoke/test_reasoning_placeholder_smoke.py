import json
import httpx
import pytest

GATEWAY_URL = "http://127.0.0.1:7766"
AUTH_TOKEN = "sk-lr-8f2a9e3b1c4d7e5f"
MODEL = "openrouter/inclusionai/ling-3.0-flash:free"

def _consume_stream(resp: httpx.Response):
    chunks_content = []
    has_static_placeholder = False
    has_empty_role_chunks = False
    has_thought_open = False
    has_thought_close = False

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
                if "<thought>" in content:
                    has_thought_open = True
                if "</thought>" in content:
                    has_thought_close = True
        except Exception:
            pass

    full_text = "".join(chunks_content)
    return full_text, has_static_placeholder, has_empty_role_chunks, has_thought_open, has_thought_close


def test_reasoning_collapsible_streaming_multi_turn():
    url = f"{GATEWAY_URL}/v1/chat/completions"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {AUTH_TOKEN}",
    }

    # Turn 1: Natural streaming prompt without artificial max_tokens
    payload_turn1 = {
        "model": MODEL,
        "messages": [{"role": "user", "content": "Explain 1+1 in one sentence."}],
        "stream": True,
    }

    with httpx.stream("POST", url, json=payload_turn1, headers=headers, timeout=30) as resp1:
        assert resp1.status_code == 200, f"Turn 1 expected 200, got {resp1.status_code}"
        text1, bad_placeholder1, empty_chunks1, thought_open1, thought_close1 = _consume_stream(resp1)

    assert not bad_placeholder1, "Turn 1 FAIL: Found static 'Thinking... \\n\\n' string!"
    assert not empty_chunks1, "Turn 1 FAIL: Found empty {'delta':{'role':'assistant'}} discarded chunks!"
    assert len(text1) > 0, "Turn 1 FAIL: 0 content tokens returned!"
    assert thought_open1, "Turn 1 FAIL: Expected <thought> tag to open on reasoning stream!"

    # Turn 2: Natural streaming multi-turn prompt with <thought> tags in assistant history
    payload_turn2 = {
        "model": MODEL,
        "messages": [
            {"role": "user", "content": "hi"},
            {"role": "assistant", "content": "<thought>\nlet me think...\n</thought>\nHello!"},
            {"role": "user", "content": "Explain 2+2 in one sentence."},
        ],
        "stream": True,
    }

    with httpx.stream("POST", url, json=payload_turn2, headers=headers, timeout=30) as resp2:
        assert resp2.status_code == 200, f"Turn 2 expected 200, got {resp2.status_code}"
        text2, bad_placeholder2, empty_chunks2, _, _ = _consume_stream(resp2)

    assert not bad_placeholder2, "Turn 2 FAIL: Found static 'Thinking... \\n\\n' string!"
    assert not empty_chunks2, "Turn 2 FAIL: Found empty {'delta':{'role':'assistant'}} discarded chunks!"
    assert len(text2) > 0, "Turn 2 FAIL: 0 content tokens returned!"
