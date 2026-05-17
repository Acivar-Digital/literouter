"""
metrics.py — Redis-backed metrics collection for LiteRouter.

Uses Redis HASHes for atomic counter operations. Falls back to in-memory
dicts when Redis is unavailable.
"""

import logging
import time
from typing import Optional

from src.redis_client import get_redis_client, redis_available

logger = logging.getLogger(__name__)

# ── Redis key constants ───────────────────────────────────────────────────────

KEY_REQUESTS = "literouter:metrics:requests"
KEY_LATENCY = "literouter:metrics:latency"
KEY_KEYS = "literouter:metrics:keys"
KEY_ERRORS = "literouter:metrics:errors"
KEY_RATELIMIT = "literouter:metrics:ratelimit"

# ── In-memory fallback state ──────────────────────────────────────────────────

_mem_metrics: dict = {
    "requests_total": 0,
    "requests_success": 0,
    "requests_error": 0,
    "key_usage": {},
    "error_by_status": {},
    "latency_sum": 0,
    "latency_count": 0,
    "ratelimit_waits": 0,
    "ratelimit_wait_total_ms": 0,
}
_mem_start_time = time.time()


# ── RedisMetrics ──────────────────────────────────────────────────────────────


class RedisMetrics:
    """Redis-backed metrics collector with in-memory fallback."""

    def __init__(self) -> None:
        self._redis = get_redis_client()
        self._start_time = time.time()

    def _is_redis(self) -> bool:
        return self._redis is not None and redis_available()

    # ── Request counters ───────────────────────────────────────────────────

    def increment_request(self) -> None:
        """Increment the total request counter."""
        if self._is_redis():
            assert self._redis is not None
            self._redis.hincrby(KEY_REQUESTS, "total", 1)
        else:
            _mem_metrics["requests_total"] += 1

    def increment_success(self) -> None:
        """Increment the success counter."""
        if self._is_redis():
            assert self._redis is not None
            self._redis.hincrby(KEY_REQUESTS, "success", 1)
        else:
            _mem_metrics["requests_success"] += 1

    def increment_error(self) -> None:
        """Increment the error counter."""
        if self._is_redis():
            assert self._redis is not None
            self._redis.hincrby(KEY_REQUESTS, "error", 1)
        else:
            _mem_metrics["requests_error"] += 1

    def increment_error_by_status(self, status: int) -> None:
        """Increment the error counter for a specific HTTP status code."""
        if self._is_redis():
            assert self._redis is not None
            self._redis.hincrby(KEY_ERRORS, str(status), 1)
        else:
            status_str = str(status)
            _mem_metrics["error_by_status"][status_str] = (
                _mem_metrics["error_by_status"].get(status_str, 0) + 1
            )

    # ── Latency ────────────────────────────────────────────────────────────

    def add_latency(self, latency_ms: int) -> None:
        """Record a request latency measurement."""
        if self._is_redis():
            assert self._redis is not None
            pipe = self._redis.pipeline()
            pipe.hincrby(KEY_LATENCY, "sum", latency_ms)
            pipe.hincrby(KEY_LATENCY, "count", 1)
            pipe.execute()
        else:
            _mem_metrics["latency_sum"] += latency_ms
            _mem_metrics["latency_count"] += 1

    # ── Key usage ──────────────────────────────────────────────────────────

    def increment_key_usage(self, key: str) -> None:
        """Increment usage counter for an API key (tracked by 10-char prefix)."""
        key_prefix = key[:10] + "..."
        if self._is_redis():
            assert self._redis is not None
            self._redis.hincrby(KEY_KEYS, key_prefix, 1)
        else:
            _mem_metrics["key_usage"][key_prefix] = (
                _mem_metrics["key_usage"].get(key_prefix, 0) + 1
            )

    # ── Rate limit tracking ────────────────────────────────────────────────

    def increment_rate_limit_wait(self) -> None:
        """Increment the count of rate-limit waits."""
        if self._is_redis():
            assert self._redis is not None
            self._redis.hincrby(KEY_RATELIMIT, "waits", 1)
        else:
            _mem_metrics["ratelimit_waits"] += 1

    def add_rate_limit_wait_ms(self, ms: int) -> None:
        """Add milliseconds spent waiting for rate limits."""
        if self._is_redis():
            assert self._redis is not None
            self._redis.hincrby(KEY_RATELIMIT, "total_wait_ms", ms)
        else:
            _mem_metrics["ratelimit_wait_total_ms"] += ms

    # ── get_metrics ────────────────────────────────────────────────────────

    def get_metrics(self) -> dict:
        """Return a comprehensive metrics snapshot with computed fields.

        Includes uptime, requests per second, error rate, and average latency.
        """
        if self._is_redis():
            return self._get_metrics_redis()
        return self._get_metrics_mem()

    def _get_metrics_redis(self) -> dict:
        assert self._redis is not None
        pipe = self._redis.pipeline()
        pipe.hgetall(KEY_REQUESTS)
        pipe.hgetall(KEY_LATENCY)
        pipe.hgetall(KEY_KEYS)
        pipe.hgetall(KEY_ERRORS)
        pipe.hgetall(KEY_RATELIMIT)
        results = pipe.execute()

        requests = results[0] or {}
        latency = results[1] or {}
        keys = results[2] or {}
        errors = results[3] or {}
        ratelimit = results[4] or {}

        total = int(requests.get("total", 0))
        success = int(requests.get("success", 0))
        error = int(requests.get("error", 0))
        latency_sum = int(latency.get("sum", 0))
        latency_count = int(latency.get("count", 0))
        avg_latency = latency_sum / latency_count if latency_count > 0 else 0

        uptime = time.time() - self._start_time
        rps = total / uptime if uptime > 0 else 0
        error_rate = error / total if total > 0 else 0

        return {
            "requestsTotal": total,
            "requestsSuccess": success,
            "requestsError": error,
            "keyUsage": keys,
            "errorByStatus": {k: int(v) for k, v in errors.items()},
            "latencySum": latency_sum,
            "latencyCount": latency_count,
            "rateLimitWaits": int(ratelimit.get("waits", 0)),
            "rateLimitWaitTotalMs": int(ratelimit.get("total_wait_ms", 0)),
            "uptimeSeconds": int(uptime),
            "requestsPerSecond": round(rps, 4),
            "errorRate": round(error_rate, 4),
            "averageLatencyMs": round(avg_latency, 2),
        }

    def _get_metrics_mem(self) -> dict:
        total = _mem_metrics["requests_total"]
        error = _mem_metrics["requests_error"]
        latency_sum = _mem_metrics["latency_sum"]
        latency_count = _mem_metrics["latency_count"]
        avg_latency = latency_sum / latency_count if latency_count > 0 else 0

        uptime = time.time() - _mem_start_time
        rps = total / uptime if uptime > 0 else 0
        error_rate = error / total if total > 0 else 0

        return {
            "requestsTotal": total,
            "requestsSuccess": _mem_metrics["requests_success"],
            "requestsError": error,
            "keyUsage": dict(_mem_metrics["key_usage"]),
            "errorByStatus": dict(_mem_metrics["error_by_status"]),
            "latencySum": latency_sum,
            "latencyCount": latency_count,
            "rateLimitWaits": _mem_metrics["ratelimit_waits"],
            "rateLimitWaitTotalMs": _mem_metrics["ratelimit_wait_total_ms"],
            "uptimeSeconds": int(uptime),
            "requestsPerSecond": round(rps, 4),
            "errorRate": round(error_rate, 4),
            "averageLatencyMs": round(avg_latency, 2),
        }

    # ── reset ──────────────────────────────────────────────────────────────

    def reset(self) -> None:
        """Clear all metrics counters."""
        if self._is_redis():
            assert self._redis is not None
            pipe = self._redis.pipeline()
            pipe.delete(KEY_REQUESTS)
            pipe.delete(KEY_LATENCY)
            pipe.delete(KEY_KEYS)
            pipe.delete(KEY_ERRORS)
            pipe.delete(KEY_RATELIMIT)
            pipe.execute()
        else:
            _mem_metrics["requests_total"] = 0
            _mem_metrics["requests_success"] = 0
            _mem_metrics["requests_error"] = 0
            _mem_metrics["key_usage"] = {}
            _mem_metrics["error_by_status"] = {}
            _mem_metrics["latency_sum"] = 0
            _mem_metrics["latency_count"] = 0
            _mem_metrics["ratelimit_waits"] = 0
            _mem_metrics["ratelimit_wait_total_ms"] = 0

        self._start_time = time.time()


# ── Singleton ──────────────────────────────────────────────────────────────────

_metrics: Optional[RedisMetrics] = None


def get_metrics() -> RedisMetrics:
    """Return the singleton RedisMetrics instance."""
    global _metrics
    if _metrics is None:
        _metrics = RedisMetrics()
    return _metrics
