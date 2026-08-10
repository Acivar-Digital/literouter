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

from __future__ import annotations

import asyncio
import json
import os
import statistics
import time
from typing import Any

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


def _parse_chunk(line: str) -> Any | None:
    """Extract JSON from a data: line, or None if not parseable."""
    if not line.startswith("data:"):
        return None
    payload = line[len("data:"):].strip()
    if payload in ("[DONE]", ""):
        return None
    try:
        return json.loads(payload)
    except json.JSONDecodeError:
        return None


def _parse_usage_tokens(raw: Any) -> int | None:
    """Extract completion_tokens from a parsed JSON usage chunk."""
    if isinstance(raw, dict):
        usg = raw.get("usage")
        if usg and "completion_tokens" in usg:
            tok: int = usg["completion_tokens"]
            return tok
    return None


def _parse_final_usage(lines: list[str]) -> int | None:
    """Best-effort: extract completion_tokens from a final SSE `usage` chunk."""
    for raw in reversed(lines):
        obj = _parse_chunk(raw)
        if obj is None:
            continue
        tok = _parse_usage_tokens(obj)
        if tok is not None:
            return tok
    return None


def _collect_sse_text(lines: list[str]) -> str:
    """Join all data: lines except [DONE] into a single string."""
    return "\n".join(
        line for line in lines if line.startswith("data:") and "[DONE]" not in line
    )


def _collect_data_parts(chunk: str, lines: list[str]) -> bool:
    """Extract data: lines from a chunk. Returns True if first line seen."""
    first_seen = False
    for part in chunk.split("\n"):
        part = part.strip()
        if part.startswith("data:"):
            lines.append(part)
            if len(lines) == 1:
                first_seen = True
    return first_seen


async def _stream_sse_lines(
    client: httpx.AsyncClient, payload: dict[str, Any]
) -> tuple[list[str], float] | None:
    """Stream SSE response. Returns (lines, t_first) or None on non-200."""
    lines: list[str] = []
    t_first = 0.0
    async with client.stream("POST", GATEWAY_URL, json=payload, headers=AUTH_HEADER) as resp:
        if resp.status_code != 200:
            body = (await resp.aread()).decode("utf-8", errors="replace")
            print(f"  ⚠️ {payload['model']} returned {resp.status_code}: {body[:120]!r}")
            return None
        async for chunk in resp.aiter_text():
            if _collect_data_parts(chunk, lines) and t_first == 0.0:
                t_first = time.perf_counter()
    return lines, t_first


async def _bench_single(
    client: httpx.AsyncClient, model: str, payload: dict[str, Any]
) -> dict[str, float] | None:
    t0 = time.perf_counter()
    result = await _stream_sse_lines(client, payload)
    if result is None:
        return None
    lines, t_first = result
    t_last = time.perf_counter()
    usage_tokens = _parse_final_usage(lines)
    text = _collect_sse_text(lines)
    est_tokens = usage_tokens if usage_tokens is not None else max(1, len(text) // 4)
    ttft = t_first - t0
    gen = max(1e-6, t_last - t_first)
    return {"ttft": ttft, "tps": est_tokens / gen, "total": t_last - t0, "tokens": est_tokens}


async def bench_model(client: httpx.AsyncClient, model: str) -> dict[str, Any] | None:
    ttfts: list[float] = []
    tps_list: list[float] = []
    totals: list[float] = []
    est_tokens = 0.0
    for _ in range(ITERATIONS + 1):  # +1 so we can drop cold start
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": PROMPT}],
            "max_tokens": MAX_TOKENS,
            "stream": True,
        }
        result = await _bench_single(client, model, payload)
        if result is None:
            continue
        ttfts.append(result["ttft"])
        tps_list.append(result["tps"])
        totals.append(result["total"])
        est_tokens = result["tokens"]
    # drop the first (cold start) sample
    if not ttfts:
        return None
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


def _print_result_row(r: dict[str, Any]) -> None:
    print(f"  {r['model']}: TTFT={r['ttft']:.2f}s  TPS={r['tps']:.1f}  total={r['total']:.2f}s")


def _print_ranked_table(ranked: list[dict[str, Any]]) -> None:
    print("\n=== RANKED BY THROUGHPUT (TPS, highest first) ===")
    print(f"{'#':<3}{'MODEL':<42}{'TPS':>8}{'TTFT':>9}{'TOTAL':>9}")
    for i, r in enumerate(ranked, 1):
        print(f"{i:<3}{r['model']:<42}{r['tps']:>8.1f}{r['ttft']:>9.2f}{r['total']:>9.2f}")
    print("\nSuggested fusion.json `chain` order (fastest first):")
    print("  " + "\n  ".join(r["model"] for r in ranked))


async def _run_benchmarks() -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    async with httpx.AsyncClient(timeout=120.0) as client:
        for m in MODELS:
            r = await bench_model(client, m)
            if r:
                results.append(r)
                _print_result_row(r)
    return results


async def main() -> None:
    print(f"Benchmarking {len(MODELS)} NVIDIA models x {ITERATIONS} iters (cold start dropped)...")
    print(f"Gateway: {GATEWAY_URL}  max_tokens={MAX_TOKENS}\n")
    results = await _run_benchmarks()
    if not results:
        print("No successful runs.")
        return
    ranked = sorted(results, key=lambda x: x["tps"], reverse=True)
    _print_ranked_table(ranked)


if __name__ == "__main__":
    asyncio.run(main())
