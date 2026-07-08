"""
Valkey Quota & Model-First Cooldown Manager
"""

import hashlib
import logging
import os
import time
from typing import List, Optional

import redis.asyncio as redis
import redis.exceptions

from src.config import REDIS_HOST, REDIS_PASSWORD, REDIS_PORT, REDIS_DB, get_model_limits

logger = logging.getLogger("router")

QUOTA_CHECK_SCRIPT = """
local key = KEYS[1]
local now = tonumber(ARGV[1])
local max_rpm = tonumber(ARGV[2])
local max_tpm = tonumber(ARGV[3])
local estimated_tokens = tonumber(ARGV[4])
local member_string = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - 60)
local members = redis.call('ZRANGEBYSCORE', key, now - 60, now)

local current_rpm = #members
local current_tpm = 0

for i=1, #members do
    local mem = members[i]
    local colon_idx = string.find(mem, ":")
    if colon_idx then
        local tokens = tonumber(string.sub(mem, colon_idx + 1))
        if tokens then
            current_tpm = current_tpm + tokens
        end
    end
end

if current_rpm >= max_rpm or (current_tpm + estimated_tokens) > max_tpm then
    return {0, current_rpm, current_tpm}
else
    redis.call('ZADD', key, now, member_string)
    redis.call('EXPIRE', key, 120)
    return {1, current_rpm, current_tpm}
end
"""

class NoDeploymentsAvailable(Exception):
    """Raised when no active keys remain eligible for use."""
    pass

def estimate_tokens(prompt_text: str, max_tokens: int = 2048) -> int:
    """
    Token-estimation heuristic based on prompt characters and requested outputs.
    """
    return (len(prompt_text) // 4) + max_tokens

class ModelFirstRouter:
    def __init__(self, google_keys: List[str], nvidia_keys: List[str], openrouter_keys: List[str], zen_keys: List[str]):
        self.keys = {
            "google": google_keys,
            "nvidia": nvidia_keys,
            "openrouter": openrouter_keys,
            "zen": zen_keys
        }
        self.redis: Optional[redis.Redis] = None
        self._last_used: dict[str, float] = {}
        self._next_index: dict[str, int] = {}

    @staticmethod
    def _get_min_delay_ms(provider: str) -> int:
        per_provider = os.getenv(f"{provider.upper()}_MIN_DELAY_MS")
        if per_provider is not None:
            return int(per_provider)
        return int(os.getenv("LITEROUTER_ROTATE_DELAY_MS", "10000"))

    async def connect(self):
        """Initialize Redis/Valkey async connection client."""
        if not self.redis:
            self.redis = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                password=REDIS_PASSWORD,
                db=REDIS_DB,
                decode_responses=True
            )
            await self.redis.ping()
            self._quota_script_sha = await self.redis.script_load(QUOTA_CHECK_SCRIPT)
            logger.info("Successfully connected to Valkey/Redis instance.")

    async def disconnect(self):
        """Close Redis connection resources."""
        if self.redis:
            await self.redis.close()
            self.redis = None

    def _hash_key(self, api_key: str) -> str:
        """Hash key to prevent leak of raw API keys in Redis/Valkey logs."""
        return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:16]

    async def _check_quota(self, rolling_key: str, now: float, max_rpm: int,
                           max_tpm: int, estimated_tokens: int) -> tuple[int, int, int]:
        """Atomic quota check+record via Redis Lua script. Returns (status, rpm, tpm)."""
        member = f"{time.time_ns()}:{estimated_tokens}"
        try:
            res = await self.redis.evalsha(
                self._quota_script_sha, 1, rolling_key,
                now, max_rpm, max_tpm, estimated_tokens, member
            )
        except redis.exceptions.NoScriptError:
            res = await self.redis.eval(
                QUOTA_CHECK_SCRIPT, 1, rolling_key,
                now, max_rpm, max_tpm, estimated_tokens, member
            )
        status, current_rpm, current_tpm = res
        return status, current_rpm, current_tpm

    async def get_available_key(self, provider: str, model_name: str, estimated_tokens: int) -> str:
        """
        Retrieves the next available key with round-robin rotation and per-key min-delay enforcement.
        Distributes load across all keys and prevents thundering a single key.
        """
        if not self.redis:
            await self.connect()

        candidate_keys = self.keys.get(provider.lower(), [])
        if not candidate_keys:
            raise NoDeploymentsAvailable(f"No keys configured for provider: {provider}")

        limits = get_model_limits(model_name, provider)
        max_tpm = limits["max_tpm"]
        max_rpm = limits["max_rpm"]

        now = time.time()
        min_delay = self._get_min_delay_ms(provider) / 1000.0

        start_idx = self._next_index.get(provider, 0)
        n = len(candidate_keys)

        lru_candidate: tuple[str, int, float] | None = None

        for i in range(n):
            idx = (start_idx + i) % n
            key = candidate_keys[idx]
            key_hash = self._hash_key(key)
            last_used_key = f"{provider}:{key_hash}"
            cooldown_key = f"cooldown:{provider}:{key_hash}:{model_name}"

            is_cooldown = await self.redis.exists(cooldown_key)
            if is_cooldown:
                continue

            last_used_time = self._last_used.get(last_used_key, 0.0)
            elapsed = now - last_used_time

            if elapsed < min_delay:
                if lru_candidate is None or last_used_time < lru_candidate[2]:
                    lru_candidate = (key, idx, last_used_time)
                continue

            rolling_key = f"rolling:{provider}:{key_hash}:{model_name}"
            status, current_rpm, current_tpm = await self._check_quota(
                rolling_key, now, max_rpm, max_tpm, estimated_tokens
            )

            if status == 0:
                logger.warning(
                    f"[{provider.upper()}] Key {key_hash} skipped due to quota limits for {model_name}. "
                    f"TPM: {current_tpm}/{max_tpm}, RPM: {current_rpm}/{max_rpm}."
                )
                continue

            self._last_used[last_used_key] = now
            self._next_index[provider] = (idx + 1) % n
            logger.info(
                f"[{provider.upper()}] Key {key_hash} selected for {model_name} "
                f"(idx={idx}, delay={min_delay}s, rpm={current_rpm + 1}/{max_rpm})"
            )
            return key

        if lru_candidate is not None:
            key, idx, _ = lru_candidate
            key_hash = self._hash_key(key)
            rolling_key = f"rolling:{provider}:{key_hash}:{model_name}"
            status, current_rpm, current_tpm = await self._check_quota(
                rolling_key, now, max_rpm, max_tpm, estimated_tokens
            )

            if status == 1:
                self._last_used[f"{provider}:{key_hash}"] = now
                self._next_index[provider] = (idx + 1) % n
                logger.warning(
                    f"[{provider.upper()}] Key {key_hash} reused before min_delay for {model_name} "
                    f"(all keys in window, relaxing constraint)"
                )
                return key
            else:
                logger.warning(
                    f"[{provider.upper()}] LRU candidate key {key_hash} skipped due to quota limits for {model_name}. "
                    f"TPM: {current_tpm}/{max_tpm}, RPM: {current_rpm}/{max_rpm}."
                )

        raise NoDeploymentsAvailable(
            f"All keys for {provider} are in cooldown or have exhausted quota for model {model_name}."
        )

    async def report_error(self, provider: str, key: str, error_type: str, model_name: str):
        """
        Reports error to initiate model-scoped cooldown or quarantine state.
        """
        if not self.redis:
            await self.connect()

        key_hash = self._hash_key(key)
        cooldown_key = f"cooldown:{provider}:{key_hash}:{model_name}"

        if error_type in ("429", "rate_limit"):
            ttl = 65
            state = "rate_limited"
        elif error_type in ("timeout", "503", "504"):
            ttl = 10
            state = "timed_out"
        elif error_type in ("401", "403", "auth", "permission_denied"):
            ttl = 604800
            state = "quarantined"
        else:
            ttl = 30
            state = f"error_{error_type}"

        await self.redis.set(cooldown_key, state, ex=ttl)
        logger.error(
            f"[{provider.upper()}] Placed key {key_hash} on {state} cooldown for model {model_name} "
            f"with TTL {ttl}s."
        )
