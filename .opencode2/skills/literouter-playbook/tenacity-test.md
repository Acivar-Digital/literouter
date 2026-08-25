# Tenacity Resilience & Multi-Provider Pacing Guide

This guide covers production-grade LLM client resilience, upstream rate-limit calibration mathematics, and multi-provider probing across LiteRouter.

---

## 1. Gateway Key Pooling vs Client-Side Backoff

In high-velocity LLM workloads (agent loops, automated coding harnesses), **client-side sleep is a last-resort fallback, not the primary defense**.

```
[ Downstream Client Worker ]
         │ (POST /v1/chat/completions - Zero-wait execution)
         ▼
[ LiteRouter Gateway :7766 ]
         │
         ├── 1. Proactive Key Pool Round-Robin (NVIDIA, Google, OpenRouter, Zen)
         ├── 2. Reactive 429 Interception:
         │      - Key #1 hits 429 -> Isolated to Cooldown Map
         │      - Request instantly dispatched to Key #2 (0ms client delay)
         └── 3. Fusion Sticky Fallback:
                - If entire provider key pool exhausted -> Cascade to fallback provider
```

---

## 2. Pacing Calibration Mathematics: Never Guess Timing

Rate limits in upstream providers use **token buckets** and **leaky buckets**. To prevent hitting HTTP 429s entirely, the minimum delay between consecutive requests must match pool capacity.

### The Formulas:

1. **Per-Key Safe Interval ($T_{\text{key}}$):**
   $$T_{\text{key}} = \frac{60{,}000\text{ ms}}{\text{Key RPM}}$$

2. **Gateway Minimum Pacing Delay ($T_{\text{gateway}}$ / `MIN_DELAY_MS`):**
   $$T_{\text{gateway}} = \frac{T_{\text{key}}}{N} = \frac{60{,}000\text{ ms}}{N \times \text{Key RPM}}$$
   *(where $N$ is the number of healthy, active keys in `.env.local`)*

### Calibrated Operational Baseline:

| Provider | Active Keys ($N$) | Upstream RPM | Per-Key Rest ($T_{\text{key}}$) | Calibrated `MIN_DELAY_MS` |
|---|---|---|---|---|
| **Google Gemini** | 5 | 15 RPM | 4,000 ms | **`2000ms`** (safe for flash/pro models) |
| **NVIDIA NIM** | 6 | 40 RPM | 1,500 ms | **`250ms`** |
| **OpenRouter** | 10 | 20 RPM | 3,000 ms | **`300ms`** |
| **Zen** | 7 | 30 RPM | 2,000 ms | **`250ms`** |

> **Rule of Thumb:** `MIN_DELAY_MS` should **never** be smaller than $\frac{T_{\text{key}}}{N}$. If faster pacing (e.g. 100ms) is required, **add more keys to `.env.local`** rather than lowering the pacer delay.

---

## 3. Senior QA Client Resilience Pattern: `DynamicRetryAfterWait`

When writing Python client applications that call LLM APIs directly or via LiteRouter, standard naive exponential backoff fails if upstream imposes long cooldown windows (e.g. 30s–60s).

### Production Implementation:

```python
import random
import time
from typing import Any
import httpx
from tenacity import (
    RetryError,
    retry,
    retry_if_exception_type,
    stop_after_attempt,
)
from tenacity.wait import wait_base

class RateLimitException(Exception):
    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after

class DynamicRetryAfterWait(wait_base):
    """
    1. If upstream returns an explicit 'Retry-After' header, wait that exact duration + 200ms buffer.
    2. Otherwise, fall back to Exponential Backoff with Full Random Jitter.
    """
    def __init__(self, initial: float = 1.0, max_wait: float = 10.0):
        self.initial = initial
        self.max_wait = max_wait

    def __call__(self, retry_state) -> float:
        outcome = retry_state.outcome
        if outcome and outcome.failed:
            exc = outcome.exception()
            if isinstance(exc, RateLimitException) and exc.retry_after is not None and exc.retry_after > 0:
                return exc.retry_after + 0.2

        attempt = retry_state.attempt_number
        exp_ceiling = min(self.max_wait, self.initial * (2 ** (attempt - 1)))
        return random.uniform(0.1, exp_ceiling)

@retry(
    retry=retry_if_exception_type((RateLimitException, httpx.TransportError)),
    wait=DynamicRetryAfterWait(initial=1.0, max_wait=10.0),
    stop=stop_after_attempt(4),
    reraise=True,
)
async def resilient_call(client: httpx.AsyncClient, url: str, payload: dict, headers: dict) -> dict:
    response = await client.post(url, json=payload, headers=headers, timeout=20.0)
    if response.status_code == 429:
        retry_after = response.headers.get("Retry-After")
        retry_val = float(retry_after) if retry_after else None
        raise RateLimitException("Rate limited", retry_after=retry_val)
    response.raise_for_status()
    return response.json()
```

---

## 4. Multi-Provider Probe Suite: `scripts/probe_resilience.py`

The repository includes an end-to-end multi-provider probe script that tests key pool routing, latency, and status across all major providers.

### Execution:

```bash
uv run python scripts/probe_resilience.py
```

### Probed Targets:

1. **NVIDIA NIM** (`Authorization: Bearer lr-nv-oa-ch-no`, model: `meta/llama-3.1-8b-instruct`)
2. **OpenRouter** (`Authorization: Bearer lr-or-oa-ch-no`, model: `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free`)
3. **Zen** (`Authorization: Bearer lr-zn-oa-ch-no`, model: `hy3-free`)
4. **Google Gemini** (`Authorization: Bearer lr-gg-oa-ob-no`, model: `gemini-3.1-flash-lite`)
5. **Fusion Sticky Fallback** (`Authorization: Bearer lr-fse-fast`, model: `gemini-3.1-flash-lite`)
