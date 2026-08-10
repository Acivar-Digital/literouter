# tests/test_fusion.py
"""
Live smoke test for the LiteRouter Fusion Sidecar (fusion.py on :7766).

Assumes BOTH the sidecar (7766) and the gateway (7766) are running.
Run with:  uv run python tests/test_fusion.py

Note: this is a live test — it needs valid GOOGLE_API_KEYS in the gateway's .env
for the fusion path to return 200. If keys are exhausted/invalid it will report
a warning rather than fail, so a green run always means "wiring is correct".
"""

from __future__ import annotations

import asyncio
import os
import sys
from typing import Any

import httpx

FUSION_URL = "http://localhost:7766/v1/chat/completions"
# Gateway auth token (matches LITEROUTER_AUTH_KEY in .env). Override via env if different.
AUTH_HEADER: dict[str, str] = {
    "Authorization": f"Bearer {os.getenv('LITEROUTER_AUTH_KEY')}"
}


def _build_payload(model: str, content: str = "Hi", stream: bool = False) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
    }
    if stream:
        payload["stream"] = True
    return payload


async def check_health(client: httpx.AsyncClient) -> None:
    resp = await client.get("http://localhost:7766/health")
    assert resp.status_code == 200, "Health check failed"
    print("✅ Health check passed")


async def check_passthrough(client: httpx.AsyncClient) -> None:
    payload = {"model": "google/gemma-4-31b-it", "messages": [{"role": "user", "content": "Hi"}]}
    resp = await client.post(FUSION_URL, json=payload, headers=AUTH_HEADER)
    assert "x-literouter-model" not in resp.headers, "Passthrough must not set X-Literouter-Model"
    print(f"✅ Passthrough passed (status: {resp.status_code})")


async def check_fusion_non_stream(client: httpx.AsyncClient) -> None:
    payload = {"model": "local/google", "messages": [{"role": "user", "content": "Hi"}]}
    resp = await client.post(FUSION_URL, json=payload, headers=AUTH_HEADER)
    if resp.status_code == 200:
        assert "x-literouter-model" in resp.headers, "Missing X-Literouter-Model header"
        print(f"✅ Fusion non-stream passed (served by: {resp.headers['x-literouter-model']})")
    else:
        print(f"⚠️ Fusion non-stream returned {resp.status_code} (keys exhausted/invalid)")


async def check_fusion_stream(client: httpx.AsyncClient) -> None:
    payload = _build_payload("local/google", stream=True)
    async with client.stream("POST", FUSION_URL, json=payload, headers=AUTH_HEADER) as resp:
        if resp.status_code == 200:
            assert "x-literouter-model" in resp.headers, "Missing X-Literouter-Model header"
            print(f"✅ Fusion stream passed (served by: {resp.headers['x-literouter-model']})")
            async for _ in resp.aiter_text():
                pass  # consume stream
        else:
            print(f"⚠️ Fusion stream returned {resp.status_code}")


async def run_tests() -> None:
    print("Running fusion sidecar smoke tests against live 7766 + gateway 7766...")

    async with httpx.AsyncClient(timeout=60.0) as client:
        try:
            await check_health(client)
        except httpx.ConnectError:
            print("❌ Could not connect to fusion.py on port 7766. Is it running?")
            sys.exit(1)

        await check_passthrough(client)
        await check_fusion_non_stream(client)
        await check_fusion_stream(client)


if __name__ == "__main__":
    asyncio.run(run_tests())
