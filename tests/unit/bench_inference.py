# tests/unit/bench_inference.py
"""
Inference benchmark + ranking for the NVIDIA-hosted models in the
`pydantic/nvidia` fusion chain.

Measures, per model (hit directly on the Python gateway 7766, no fusion chain
interference):
  - TTFT  (time to first token, seconds)   -> latency / responsiveness
  - TPS   (generated tokens / generation time) -> raw inference throughput
  - total latency (first -> last chunk)

Runs N iterations per model, drops the cold-start outlier, and prints a table
ranked by TPS (highest throughput first). Use it to reorder the fusion.json
`chain` array so the fastest model serves first.

Assumes the gateway (7766) is running with valid NVIDIA_API_KEYS in .env.

Run with:  uv run python tests/unit/bench_inference.py
Override models/env with env vars:
  BENCH_MODELS="m1,m2,..."  BENCH_ITER=3  BENCH_MAX_TOKENS=256  BENCH_URL=...
"""

import asyncio
import os
import statistics
import time

import httpx

GATEWAY_URL = os.getenv("BENCH_URL", "http://localhost:7766/v1/chat/completions")
AUTH_HEADER = {
    "Authorization": f"Bearer {os.getenv('LITEROUTER_AUTH_KEY')}"
}
ITERATIONS = int(os.getenv("BENCH_ITER", "3"))
MAX_TOKENS = int(os.getenv("BENCH_MAX_TOKENS", "256"))
DEFAULT_MODELS = [
    "nvidia/qwen/qwen3.5-122b-a10b",
    "nvidia/minimaxai/minimax-m2.7",
    "nvidia/z-ai/glm-5.2",
    "nvidia/deepseek-ai/deepseek-v4-pro",
]
MODELS = os.getenv("BENCH_MODELS", ",".join(DEFAULT_MODELS)).split(",")
PROMPT = (
    "Write a detailed, step-by-step explanation of how quicksort works, "
    "including its time complexity in the best, average, and worst cases. "
    "Be thorough and use concrete examples."
)


def _parse_final_usage(lines):
    """Best-effort: extract completion_tokens from a final SSE `usage` chunk."""
    for raw in reversed(lines):
        if not raw.startswith("data:"):
            continue
        payload = raw[len("data:"):].strip()
        if payload in ("[DONE]", ""):
            continue
        try:
            obj = __import__("json").loads(payload)
        except Exception:
            continue
        usage = obj.get("usage")
        if usage and "completion_tokens" in usage:
            return usage["completion_tokens"]
    return None


async def bench_model(client, model):
    ttfts, tps_list, totals = [], [], []
    for _ in range(ITERATIONS + 1):  # +1 so we can drop cold start
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": PROMPT}],
            "max_tokens": MAX_TOKENS,
            "stream": True,
        }
        lines: list[str] = []
        est_tokens = 0
        t0 = time.perf_counter()
        t_first = 0.0
        first_seen = False
        async with client.stream("POST", GATEWAY_URL, json=payload, headers=AUTH_HEADER) as resp:
            if resp.status_code != 200:
                body = await resp.aread()
                print(f"  ⚠️ {model} returned {resp.status_code}: {body[:120]}")
                return None
            async for chunk in resp.aiter_text():
                for part in chunk.split("\n"):
                    part = part.strip()
                    if not part.startswith("data:"):
                        continue
                    lines.append(part)
                    if not first_seen:
                        t_first = time.perf_counter()
                        first_seen = True
        t_last = time.perf_counter()
        usage_tokens = _parse_final_usage(lines)
        text = "\n".join(
            line for line in lines if line.startswith("data:") and "[DONE]" not in line
        )
        est_tokens = usage_tokens if usage_tokens is not None else max(1, len(text) // 4)
        ttft = t_first - t0
        gen = max(1e-6, t_last - t_first)
        ttfts.append(ttft)
        tps_list.append(est_tokens / gen)
        totals.append(t_last - t0)
    # drop the first (cold start) sample
    ttfts.pop(0)
    tps_list.pop(0)
    totals.pop(0)
    return {
        "model": model,
        "ttft": statistics.mean(ttfts),
        "tps": statistics.mean(tps_list),
        "total": statistics.mean(totals),
        "tokens": est_tokens,
    }


async def main():
    print(f"Benchmarking {len(MODELS)} NVIDIA models x {ITERATIONS} iters (cold start dropped)...")
    print(f"Gateway: {GATEWAY_URL}  max_tokens={MAX_TOKENS}\n")
    results = []
    async with httpx.AsyncClient(timeout=120.0) as client:
        for m in MODELS:
            r = await bench_model(client, m)
            if r:
                results.append(r)
                print(f"  {m}: TTFT={r['ttft']:.2f}s  TPS={r['tps']:.1f}  total={r['total']:.2f}s")
    if not results:
        print("No successful runs.")
        return
    ranked = sorted(results, key=lambda x: x["tps"], reverse=True)
    print("\n=== RANKED BY THROUGHPUT (TPS, highest first) ===")
    print(f"{'#':<3}{'MODEL':<42}{'TPS':>8}{'TTFT':>9}{'TOTAL':>9}")
    for i, r in enumerate(ranked, 1):
        print(f"{i:<3}{r['model']:<42}{r['tps']:>8.1f}{r['ttft']:>9.2f}{r['total']:>9.2f}")
    print("\nSuggested fusion.json `chain` order (fastest first):")
    print("  " + "\n  ".join(r["model"] for r in ranked))


if __name__ == "__main__":
    asyncio.run(main())
