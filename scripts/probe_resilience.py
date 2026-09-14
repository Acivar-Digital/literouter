#!/usr/bin/env python3
"""
probe_resilience.py - Resilient LLM Client & LiteRouter Multi-Provider Probe

Demonstrates Senior QA / Production-Grade resilience patterns:
1. Async non-blocking HTTPX I/O (no thread pool starvation)
2. Tenacity retry with Dynamic Retry-After header parsing + Exponential Jitter fallback
3. LiteRouter Multi-Provider Probing:
   - NVIDIA NIM (lr-nv-oa-ch-no)
   - OpenRouter (lr-or-oa-ch-no)
   - Zen (lr-zn-oa-ch-no)
   - Google Gemini (lr-gg-oa-ob-no)
   - Fusion Preset (lr-fse-fast)
"""

import asyncio
import os
import random
import sys
import time
from dataclasses import dataclass
from typing import Any

import httpx
from tenacity import (
    RetryError,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
)
from tenacity.wait import wait_base

# Configuration
LITEROUTER_BASE_URL = os.getenv("LITEROUTER_URL", "https://localhost:7766")
MAX_RETRIES = 4
INITIAL_BACKOFF = 1.0
MAX_BACKOFF = 10.0


# -----------------------------------------------------------------------------
# Exceptions & Classification
# -----------------------------------------------------------------------------
class LLMClientException(Exception):
    """Base exception for LLM API failures."""


class RateLimitException(LLMClientException):
    """Raised on HTTP 429 Too Many Requests."""

    def __init__(self, message: str, retry_after: float | None = None, status_code: int = 429):
        super().__init__(message)
        self.retry_after = retry_after
        self.status_code = status_code


class ServerErrorException(LLMClientException):
    """Raised on 5xx transient upstream server errors."""

    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.status_code = status_code


# -----------------------------------------------------------------------------
# Senior QA Strategy: Dynamic Retry-After + Exponential Jitter Wait
# -----------------------------------------------------------------------------
class DynamicRetryAfterWait(wait_base):
    """
    Intelligent wait strategy:
    1. If the upstream provider returned an explicit 'Retry-After' header, wait that exact duration
       (plus a small 200ms safety buffer to prevent edge-of-window collisions).
    2. Otherwise, fall back to Exponential Backoff with Full Random Jitter to defeat Thundering Herd.
    """

    def __init__(self, initial: float = 1.0, max_wait: float = 10.0):
        self.initial = initial
        self.max_wait = max_wait

    def __call__(self, retry_state) -> float:
        outcome = retry_state.outcome
        if outcome and outcome.failed:
            exc = outcome.exception()
            if isinstance(exc, RateLimitException) and exc.retry_after is not None and exc.retry_after > 0:
                wait_sec = exc.retry_after + 0.2
                print(f"      ⏳ [Tenacity] Upstream specified Retry-After: {exc.retry_after:.2f}s -> {wait_sec:.2f}s")
                return wait_sec

        # Exponential backoff with full jitter: Uniform(0.1, min(max_wait, initial * 2^(attempt - 1)))
        attempt = retry_state.attempt_number
        exp_ceiling = min(self.max_wait, self.initial * (2 ** (attempt - 1)))
        jittered_wait = random.uniform(0.1, exp_ceiling)
        print(f"      ⏳ [Tenacity] Jittered exponential backoff (attempt {attempt}): sleeping {jittered_wait:.2f}s")
        return jittered_wait


# -----------------------------------------------------------------------------
# Resilient Async Call Execution
# -----------------------------------------------------------------------------
@retry(
    retry=retry_if_exception_type((RateLimitException, ServerErrorException, httpx.TransportError)),
    wait=DynamicRetryAfterWait(initial=INITIAL_BACKOFF, max_wait=MAX_BACKOFF),
    stop=stop_after_attempt(MAX_RETRIES),
    reraise=True,
)
async def resilient_chat_completion(
    client: httpx.AsyncClient,
    directive_key: str,
    model: str,
    prompt: str = "Reply with 'OK' and identify yourself in 5 words.",
) -> tuple[dict[str, Any], float, int]:
    """
    Sends an OpenAI-compatible chat completion through LiteRouter using the directive key.
    Measures latency and parses Retry-After headers on 429s.
    """
    url = f"{LITEROUTER_BASE_URL}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {directive_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": 25,
        "temperature": 0.1,
    }

    t0 = time.perf_counter()
    try:
        response = await client.post(url, json=payload, headers=headers, timeout=25.0)
    except httpx.TimeoutException as exc:
        print(f"      ⚠️ Request timed out: {exc}")
        raise ServerErrorException("Request timeout", status_code=504) from exc
    except httpx.TransportError as exc:
        print(f"      ⚠️ Transport/Connection error: {exc}")
        raise

    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    if response.status_code == 429:
        retry_after_hdr = response.headers.get("Retry-After")
        retry_after_val: float | None = None
        if retry_after_hdr:
            try:
                retry_after_val = float(retry_after_hdr)
            except ValueError:
                retry_after_val = None
        print(f"      ⚠️ Hit HTTP 429 Too Many Requests! (Retry-After: {retry_after_hdr})")
        raise RateLimitException("Rate limited by upstream", retry_after=retry_after_val)

    if response.status_code >= 500:
        print(f"      ⚠️ Hit HTTP {response.status_code} Upstream Server Error!")
        raise ServerErrorException(f"Upstream server error {response.status_code}", status_code=response.status_code)

    if response.status_code != 200:
        print(f"      ❌ HTTP {response.status_code}: {response.text[:120]}")
        response.raise_for_status()

    return response.json(), elapsed_ms, response.status_code


# -----------------------------------------------------------------------------
# Test Harness & Multi-Provider Matrix
# -----------------------------------------------------------------------------
@dataclass
class ProviderProbeTarget:
    name: str
    directive_key: str
    model: str
    description: str


PROBE_TARGETS = [
    ProviderProbeTarget(
        name="NVIDIA NIM",
        directive_key="lr-nv-oa-ch-no",
        model="meta/llama-3.1-8b-instruct",
        description="NVIDIA NIM key pool (Direct Chat Completions)",
    ),
    ProviderProbeTarget(
        name="OpenRouter",
        directive_key="lr-or-oa-ch-no",
        model="nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        description="OpenRouter key pool (Free tier model)",
    ),
    ProviderProbeTarget(
        name="Zen",
        directive_key="lr-zn-oa-ch-no",
        model="hy3-free",
        description="Zen API key pool (Fast inference)",
    ),
    ProviderProbeTarget(
        name="Google Gemini",
        directive_key="lr-gg-oa-ob-no",
        model="gemini-3.1-flash-lite",
        description="Google Gemini AI Studio key pool (OpenAI Beta bridge)",
    ),
    ProviderProbeTarget(
        name="Fusion Preset",
        directive_key="lr-fse-fast",
        model="gemini-3.1-flash-lite",
        description="LiteRouter Fusion Sticky Fallback (Multi-provider cascade)",
    ),
]


def extract_content(data: dict[str, Any]) -> str:
    """Extracts completion content or reasoning from OpenAI/LiteRouter JSON payload."""
    if "choices" in data and len(data["choices"]) > 0:
        choice = data["choices"][0]
        msg = choice.get("message", {})
        content = msg.get("content") or msg.get("reasoning") or msg.get("reasoning_content") or ""
        return str(content).strip()
    return ""


async def run_probes() -> None:
    print("=" * 80)
    print("🚀 LITEROUTER RESILIENCE & MULTI-PROVIDER PROBE SUITE")
    print(f"   Target Gateway: {LITEROUTER_BASE_URL}")
    print(f"   Tenacity Policy: Dynamic Retry-After + Exponential Jitter (Max {MAX_RETRIES} attempts)")
    print("=" * 80)

    transport = httpx.AsyncHTTPTransport(verify=False)
    results: list[dict[str, Any]] = []

    async with httpx.AsyncClient(transport=transport) as client:
        # 1. Gateway Health Probe
        try:
            health_res = await client.get(f"{LITEROUTER_BASE_URL}/health", timeout=5.0)
            if health_res.status_code == 200:
                print("🟢 Gateway Health: ONLINE & HEALTHY\n")
            else:
                print(f"⚠️ Gateway Health returned HTTP {health_res.status_code}\n")
        except Exception as exc:
            print(f"❌ Gateway is unreachable on {LITEROUTER_BASE_URL}: {exc}")
            print("   Please start LiteRouter via `bash scripts/start.sh` first.")
            sys.exit(1)

        # 2. Sequential Probes across all 4 requested providers + Fusion
        for target in PROBE_TARGETS:
            print(f"📡 Testing Provider: [{target.name}]")
            print(f"   Directive Key: {target.directive_key}")
            print(f"   Model:         {target.model}")
            print(f"   Context:       {target.description}")

            try:
                data, elapsed_ms, status_code = await resilient_chat_completion(
                    client=client,
                    directive_key=target.directive_key,
                    model=target.model,
                )

                content = extract_content(data)
                print(f"   ✅ SUCCESS ({status_code} OK) | Latency: {elapsed_ms:.1f}ms")
                print(f"   💬 Response: \"{content[:100]}\"")
                results.append({
                    "provider": target.name,
                    "status": "PASS",
                    "code": status_code,
                    "latency_ms": f"{elapsed_ms:.1f}ms",
                    "snippet": content[:40].replace("\n", " "),
                })

            except RetryError as exc:
                print(f"   ❌ FAILED after {MAX_RETRIES} retries: {exc}")
                results.append({
                    "provider": target.name,
                    "status": "FAIL (Retries Exhausted)",
                    "code": "429/5xx",
                    "latency_ms": "TIMEOUT",
                    "snippet": str(exc)[:40],
                })
            except Exception as exc:
                print(f"   ❌ FAILED: {exc}")
                results.append({
                    "provider": target.name,
                    "status": "FAIL",
                    "code": getattr(exc, "status_code", "ERROR"),
                    "latency_ms": "ERR",
                    "snippet": str(exc)[:40],
                })

            print("-" * 80)

    # 3. Print Summary Matrix
    print("\n" + "=" * 80)
    print("📊 MULTI-PROVIDER PROBE SUMMARY MATRIX")
    print("=" * 80)
    fmt = "{:<16} | {:<16} | {:<10} | {:<12} | {:<22}"
    print(fmt.format("Provider", "Status", "HTTP Code", "Latency", "Output Preview"))
    print("-" * 80)
    for r in results:
        status_icon = "🟢" if "PASS" in r["status"] else "🔴"
        status_str = f"{status_icon} {r['status']}"
        print(fmt.format(r["provider"], status_str, str(r["code"]), r["latency_ms"], r["snippet"]))
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(run_probes())
