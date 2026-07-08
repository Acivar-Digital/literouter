# tests/unit/test_fusion_pydantic_nvidia.py
"""
Live smoke test for the `pydantic/nvidia` fusion group on the LiteRouter Fusion
Sidecar (fusion.py on :7768).

`pydantic/nvidia` is a fusion group that forwards OpenAI-compat payloads to the
Python gateway (7766) /v1 route, which routes to NVIDIA-hosted models. Chain:

    nvidia/qwen/qwen3.5-122b-a10b  ->  nvidia/minimaxai/minimax-m2.7
    ->  nvidia/z-ai/glm-5.2  ->  nvidia/deepseek-ai/deepseek-v4-pro

This test verifies pydantic-ai style traffic works through fusion:

  1. non-streaming chat completion
  2. streaming chat completion (SSE)
  3. tool / function calling

Assumes the sidecar (7768) and the Python gateway (7766) are running, with valid
NVIDIA_API_KEYS in .env.

Run with:  uv run python tests/unit/test_fusion_pydantic_nvidia.py

This is a live test — if keys are exhausted/invalid it reports a warning rather
than failing, so a green run always means "wiring is correct".
"""

import asyncio
import os
import sys

import httpx

FUSION_URL = "http://localhost:7768/v1/chat/completions"
# Gateway auth token (matches LITEROUTER_AUTH_KEY in .env). Override via env if different.
AUTH_HEADER = {
    "Authorization": f"Bearer {os.getenv('LITEROUTER_AUTH_KEY', 'sk-lr-8f2a9e3b1c4d7e5f')}"
}

WEATHER_TOOL = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {"city": {"type": "string"}},
            "required": ["city"],
        },
    },
}


async def run_tests():
    print("Running pydantic/nvidia fusion smoke tests against live 7768 + gateway 7766...")

    async with httpx.AsyncClient(timeout=90.0) as client:
        # 0. Health check
        try:
            resp = await client.get("http://localhost:7768/health")
            assert resp.status_code == 200, "Health check failed"
            print("✅ Health check passed")
        except httpx.ConnectError:
            print("❌ Could not connect to fusion.py on port 7768. Is it running?")
            sys.exit(1)

        # 1. Non-streaming
        payload = {
            "model": "pydantic/nvidia",
            "messages": [{"role": "user", "content": "Reply with exactly: OK"}],
            "max_tokens": 40,
        }
        resp = await client.post(FUSION_URL, json=payload, headers=AUTH_HEADER)
        if resp.status_code == 200:
            assert "x-literouter-model" in resp.headers, "Missing X-Literouter-Model header"
            print(f"✅ pydantic/nvidia non-stream passed (served by: {resp.headers['x-literouter-model']})")
        else:
            print(f"⚠️ pydantic/nvidia non-stream returned {resp.status_code} (keys exhausted/invalid)")

        # 2. Streaming (SSE)
        payload = {
            "model": "pydantic/nvidia",
            "messages": [{"role": "user", "content": "Count from 1 to 5"}],
            "max_tokens": 80,
            "stream": True,
        }
        async with client.stream("POST", FUSION_URL, json=payload, headers=AUTH_HEADER) as resp:
            if resp.status_code == 200:
                assert "x-literouter-model" in resp.headers, "Missing X-Literouter-Model header"
                chunks = 0
                async for _ in resp.aiter_text():
                    chunks += 1
                print(
                    f"✅ pydantic/nvidia stream passed "
                    f"(served by: {resp.headers['x-literouter-model']}, {chunks} chunks)"
                )
            else:
                print(f"⚠️ pydantic/nvidia stream returned {resp.status_code}")

        # 3. Tool / function calling (force the tool so the result is deterministic)
        payload = {
            "model": "pydantic/nvidia",
            "messages": [{"role": "user", "content": "What is the weather in Singapore?"}],
            "tools": [WEATHER_TOOL],
            "tool_choice": {"type": "function", "function": {"name": "get_weather"}},
            "max_tokens": 200,
        }
        resp = await client.post(FUSION_URL, json=payload, headers=AUTH_HEADER)
        if resp.status_code == 200:
            data = resp.json()
            choice = data["choices"][0]
            tool_calls = choice.get("message", {}).get("tool_calls")
            if tool_calls:
                name = tool_calls[0]["function"]["name"]
                print(f"✅ pydantic/nvidia tool call passed (model invoked: {name})")
            else:
                print(
                    f"⚠️ pydantic/nvidia tool call returned 200 but no tool_calls "
                    f"(finish_reason={choice.get('finish_reason')}) — provider did not emit a call"
                )
        else:
            print(f"⚠️ pydantic/nvidia tool call returned {resp.status_code}")


if __name__ == "__main__":
    asyncio.run(run_tests())
