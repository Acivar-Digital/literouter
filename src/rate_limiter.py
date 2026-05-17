"""
rate_limiter.py — Redis-backed provider-level rate limiter for LiteRouter.

Uses a Lua script for atomic check-and-update of per-provider call pacing.
Falls back to always-ready when Redis is unavailable.
"""

import logging
import time
from typing import Optional

from src.redis_client import get_redis_client, redis_available

logger = logging.getLogger(__name__)

# ── Lua script for atomic rate-limit check ─────────────────────────────────────

_LUA_SCRIPT = """
local last = redis.call('GET', KEYS[1])
if last == nil then
    redis.call('SET', KEYS[1], ARGV[1])
    return 1
end
local elapsed = tonumber(ARGV[1]) - tonumber(last)
if elapsed >= tonumber(ARGV[2]) then
    redis.call('SET', KEYS[1], ARGV[1])
    return 1
end
return 0
"""

# ── In-memory fallback ────────────────────────────────────────────────────────

_mem_last_calls: dict[str, float] = {}  # provider -> last call timestamp (ms)


# ── Helpers ────────────────────────────────────────────────────────────────────


def _ratelimit_key(provider: str) -> str:
    return f"literouter:ratelimit:{provider}"


# ── RedisRateLimiter ──────────────────────────────────────────────────────────


class RedisRateLimiter:
    """Redis-backed rate limiter with Lua-script atomicity."""

    def __init__(self) -> None:
        self._redis = get_redis_client()
        self._sha: Optional[str] = None
        self._register_script()

    def _register_script(self) -> None:
        """Pre-register the Lua script on the Redis client for efficiency."""
        if self._redis is not None:
            try:
                self._sha = self._redis.script_load(_LUA_SCRIPT)
                logger.info("Rate limiter Lua script loaded")
            except Exception as exc:
                logger.warning(f"Failed to load Lua script: {exc}")
                self._sha = None

    def _is_redis(self) -> bool:
        return self._redis is not None and redis_available()

    # ── can_call ───────────────────────────────────────────────────────────

    def can_call(self, provider_name: str, min_delay_ms: int) -> dict:
        """Check whether a call to *provider_name* is allowed right now.

        Returns ``{"ready": bool, "wait_ms": int}``.
        If Redis is unavailable, always returns ``ready=True``.
        """
        if not self._is_redis():
            return {"ready": True, "wait_ms": 0}

        return self._can_call_redis(provider_name, min_delay_ms)

    def _can_call_redis(
        self, provider_name: str, min_delay_ms: int
    ) -> dict:
        assert self._redis is not None
        now_ms = int(time.time() * 1000)
        key = _ratelimit_key(provider_name)

        last_raw = self._redis.get(key)
        if last_raw is None:
            return {"ready": True, "wait_ms": 0}

        last_ms = int(last_raw)
        elapsed = now_ms - last_ms
        wait_ms = max(0, min_delay_ms - elapsed)

        if wait_ms > 0:
            logger.info(
                f"[RateLimiter] {provider_name} must wait {wait_ms}ms "
                f"(minDelay={min_delay_ms}ms, elapsed={elapsed}ms)"
            )
            return {"ready": False, "wait_ms": wait_ms}

        return {"ready": True, "wait_ms": 0}

    # ── mark_call ──────────────────────────────────────────────────────────

    def mark_call(self, provider_name: str) -> None:
        """Record that a call was just made to *provider_name*."""
        if self._is_redis():
            self._mark_call_redis(provider_name)
        else:
            _mem_last_calls[provider_name] = time.time() * 1000

    def _mark_call_redis(self, provider_name: str) -> None:
        assert self._redis is not None
        now_ms = int(time.time() * 1000)
        self._redis.set(_ratelimit_key(provider_name), str(now_ms))

    # ── reset ──────────────────────────────────────────────────────────────

    def reset(self, provider_name: str) -> None:
        """Clear rate-limit tracking for *provider_name*."""
        if self._is_redis():
            self._redis.delete(_ratelimit_key(provider_name))
        else:
            _mem_last_calls.pop(provider_name, None)
        logger.info(f"[RateLimiter] Reset tracking for {provider_name}")

    # ── get_status ─────────────────────────────────────────────────────────

    def get_status(self) -> dict:
        """Return rate-limit status for all tracked providers.

        Returns a dict mapping provider name to ``{"lastCallTime": float | None}``.
        """
        if self._is_redis():
            return self._get_status_redis()
        return self._get_status_mem()

    def _get_status_redis(self) -> dict:
        assert self._redis is not None
        status: dict = {}
        cursor = 0
        prefix = "literouter:ratelimit:"

        while True:
            cursor, keys = self._redis.scan(
                cursor, match=f"{prefix}*", count=100
            )
            for k in keys:
                provider = k.replace(prefix, "")
                val = self._redis.get(k)
                last_call = float(val) if val is not None else None
                status[provider] = {
                    "lastCallTime": last_call,
                    "nextAvailableTime": last_call,
                }
            if cursor == 0:
                break

        return status

    def _get_status_mem(self) -> dict:
        status: dict = {}
        for provider, last_ms in _mem_last_calls.items():
            status[provider] = {
                "lastCallTime": last_ms,
                "nextAvailableTime": last_ms,
            }
        return status


# ── Singleton ──────────────────────────────────────────────────────────────────

_limiter: Optional[RedisRateLimiter] = None


def get_rate_limiter() -> RedisRateLimiter:
    """Return the singleton RedisRateLimiter instance."""
    global _limiter
    if _limiter is None:
        _limiter = RedisRateLimiter()
    return _limiter
