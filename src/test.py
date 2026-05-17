"""
test.py — Preflight test for LiteRouter.

Tests all configured API keys against their providers.
Usage: uv run python src/test.py
"""

import asyncio
import logging
import time
from typing import Any

import httpx

from src.config import get_config, is_gemini_provider

logging.basicConfig(level=logging.WARNING)


async def run_preflight_test(log_progress: bool = True) -> dict[str, Any]:
    """Test all provider API keys and return stats.

    Returns a dict with keys:
        - healthy: number of healthy keys
        - failed: number of failed keys
        - test_results: list of per-key test result dicts
    """
    config = get_config()

    if log_progress:
        providers_str = ", ".join(config.providers.keys())
        print("\n  LITEROUTER PREFLIGHT TEST\n")
        print(f"  Providers: {providers_str}")

    healthy = 0
    failed = 0
    test_results: list[dict] = []

    async with httpx.AsyncClient(timeout=10.0) as client:
        for provider_name, provider in config.providers.items():
            if log_progress:
                print(f"\n  {provider_name} ({provider.base_url})")

            if not provider.api_keys:
                if log_progress:
                    print("    No API keys configured.")
                continue

            model_config = config.model_params.get(provider_name)
            use_gemini = is_gemini_provider(provider)

            for i, key in enumerate(provider.api_keys):
                key_display = f"Key {i + 1} ({key[:8]}...)"

                if log_progress:
                    print(f"    Testing {key_display}...", end="", flush=True)

                start = time.time()
                try:
                    if use_gemini:
                        default_model = "gemini-2.5-flash"
                        if model_config:
                            test_model = model_config.get("model", default_model)
                        else:
                            test_model = default_model
                        resp = await client.post(
                            f"{provider.base_url}/models/{test_model}:generateContent",
                            json={
                                "contents": [{"role": "user", "parts": [{"text": "hello"}]}],
                                "generationConfig": {"maxOutputTokens": 1},
                            },
                            params={"key": key},
                        )
                    else:
                        default_model = "gpt-3.5-turbo"
                        if model_config:
                            test_model = model_config.get("model", default_model)
                        else:
                            test_model = default_model
                        resp = await client.post(
                            f"{provider.base_url}/chat/completions",
                            json={
                                "model": test_model,
                                "messages": [{"role": "user", "content": "hello"}],
                                "max_tokens": 1,
                            },
                            headers={
                                "Content-Type": "application/json",
                                "Authorization": f"Bearer {key}",
                            },
                        )

                    latency_ms = int((time.time() - start) * 1000)

                    if resp.status_code == 200:
                        healthy += 1
                        test_results.append({
                            "provider": provider_name,
                            "key": key_display,
                            "status": "healthy",
                            "latencyMs": latency_ms,
                        })
                        if log_progress:
                            print(f"\r    ✓ {key_display} healthy {latency_ms}ms")
                    elif resp.status_code == 429:
                        healthy += 1
                        test_results.append({
                            "provider": provider_name,
                            "key": key_display,
                            "status": "rate-limited",
                            "latencyMs": latency_ms,
                        })
                        if log_progress:
                            print(f"\r    ⚡ {key_display} valid (rate limited) {latency_ms}ms")
                    else:
                        failed += 1
                        err_text = resp.text[:100]
                        test_results.append({
                            "provider": provider_name,
                            "key": key_display,
                            "status": "error",
                            "error": f"HTTP {resp.status_code}",
                            "latencyMs": latency_ms,
                        })
                        if log_progress:
                            print(
                                f"\r    ✗ {key_display} HTTP {resp.status_code} "
                                f"{latency_ms}ms - {err_text}",
                            )

                except Exception as exc:
                    failed += 1
                    latency_ms = int((time.time() - start) * 1000)
                    err_msg = str(exc)
                    test_results.append({
                        "provider": provider_name,
                        "key": key_display,
                        "status": "error",
                        "error": err_msg,
                        "latencyMs": latency_ms,
                    })
                    if log_progress:
                        print(f"\r    ✗ {key_display} {err_msg} {latency_ms}ms")

    total_keys = sum(len(p.api_keys) for p in config.providers.values())

    if log_progress:
        print(f"\n{'─' * 50}")
        fail_msg = f" {failed} failed." if failed > 0 else ""
        print(f"  {healthy}/{total_keys} keys healthy.{fail_msg}")
        print(f"{'─' * 50}\n")

    return {"healthy": healthy, "failed": failed, "test_results": test_results}


if __name__ == "__main__":
    asyncio.run(run_preflight_test())
