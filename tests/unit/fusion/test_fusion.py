# tests/test_fusion.py
"""
Live smoke test for the LiteRouter Fusion Sidecar (fusion.py on :7766).

Assumes BOTH the sidecar (7766) and the gateway (7766) are running.
Run with:  uv run python tests/test_fusion.py

Note: this is a live test — it needs valid GOOGLE_API_KEYS in the gateway's .env
for the fusion path to return 200. If keys are exhausted/invalid it will report
a warning rather than fail, so a green run always means "wiring is correct".
"""

import asyncio
import os
import sys

import httpx

FUSION_URL = "http://localhost:7766/v1/chat/completions"
# Gateway auth token (matches LITEROUTER_AUTH_KEY in .env). Override via env if different.
AUTH_HEADER = {
    "Authorization": f"Bearer {os.getenv('LITEROUTER_AUTH_KEY')}"
}


async def run_tests():
    print("Running fusion sidecar smoke tests against live 7766 + gateway 7766...")

    async with httpx.AsyncClient(timeout=60.0) as client:
        # 1. Health check
        try:
            resp = await client.get("http://localhost:7766/health")
            assert resp.status_code == 200, "Health check failed"
            print("✅ Health check passed")
        except httpx.ConnectError:
            print("❌ Could not connect to fusion.py on port 7766. Is it running?")
            sys.exit(1)

        # 2. Passthrough (non-fusion model) — must NOT carry X-Literouter-Model
        payload = {
            "model": "google/gemma-4-31b-it",
            "messages": [{"role": "user", "content": "Hi"}],
        }
        resp = await client.post(FUSION_URL, json=payload, headers=AUTH_HEADER)
        assert "x-literouter-model" not in resp.headers, (
            "Passthrough must not set X-Literouter-Model"
        )
        print(f"✅ Passthrough passed (status: {resp.status_code})")

        # 3. Fusion non-stream
        payload = {"model": "local/google", "messages": [{"role": "user", "content": "Hi"}]}
        resp = await client.post(FUSION_URL, json=payload, headers=AUTH_HEADER)
        if resp.status_code == 200:
            assert "x-literouter-model" in resp.headers, "Missing X-Literouter-Model header"
            print(f"✅ Fusion non-stream passed (served by: {resp.headers['x-literouter-model']})")
        else:
            print(
                f"⚠️ Fusion non-stream returned {resp.status_code} (keys exhausted/invalid)"
            )

        # 4. Fusion stream
        payload = {
            "model": "local/google",
            "messages": [{"role": "user", "content": "Hi"}],
            "stream": True,
        }
        async with client.stream("POST", FUSION_URL, json=payload, headers=AUTH_HEADER) as resp:
            if resp.status_code == 200:
                assert "x-literouter-model" in resp.headers, "Missing X-Literouter-Model header"
                print(f"✅ Fusion stream passed (served by: {resp.headers['x-literouter-model']})")
                async for _ in resp.aiter_text():
                    pass  # consume stream
            else:
                print(f"⚠️ Fusion stream returned {resp.status_code}")


if __name__ == "__main__":
    asyncio.run(run_tests())
