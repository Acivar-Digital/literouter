"""
Valkey Quota & Model-First Cooldown Manager
"""

import hashlib
import logging
import time
from typing import List, Optional

import redis.asyncio as redis

from src.config import REDIS_HOST, REDIS_PASSWORD, REDIS_PORT, get_model_limits

logger = logging.getLogger("router")

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

    async def connect(self):
        """Initialize Redis/Valkey async connection client."""
        if not self.redis:
            self.redis = redis.Redis(
                host=REDIS_HOST,
                port=REDIS_PORT,
                password=REDIS_PASSWORD,
                decode_responses=True
            )
            # Verify connectivity
            await self.redis.ping()
            logger.info("Successfully connected to Valkey/Redis instance.")

    async def disconnect(self):
        """Close Redis connection resources."""
        if self.redis:
            await self.redis.close()
            self.redis = None

    def _hash_key(self, api_key: str) -> str:
        """Hash key to prevent leak of raw API keys in Redis/Valkey logs."""
        return hashlib.sha256(api_key.encode("utf-8")).hexdigest()[:16]

    async def get_available_key(self, provider: str, model_name: str, estimated_tokens: int) -> str:
        """
        Retrieves the next available key that is not in cooldown and has remaining RPM/TPM quota.
        """
        if not self.redis:
            await self.connect()

        candidate_keys = self.keys.get(provider.lower(), [])
        if not candidate_keys:
            raise NoDeploymentsAvailable(f"No keys configured for provider: {provider}")

        limits = get_model_limits(model_name, provider)
        max_tpm = limits["max_tpm"]
        max_rpm = limits["max_rpm"]

        minute_ts = int(time.time() // 60)

        for key in candidate_keys:
            key_hash = self._hash_key(key)
            cooldown_key = f"cooldown:{provider}:{key_hash}:{model_name}"

            # Check model-specific cooldown/quarantine status
            is_cooldown = await self.redis.exists(cooldown_key)
            if is_cooldown:
                continue

            tpm_key = f"quota:{provider}:{key_hash}:{model_name}:tpm:{minute_ts}"
            rpm_key = f"quota:{provider}:{key_hash}:{model_name}:rpm:{minute_ts}"

            # Fetch active metric counters
            usage = await self.redis.mget(tpm_key, rpm_key)
            current_tpm = int(usage[0]) if usage[0] is not None else 0
            current_rpm = int(usage[1]) if usage[1] is not None else 0

            # Verify budget bounds
            if current_rpm >= max_rpm or (current_tpm + estimated_tokens) > max_tpm:
                logger.warning(
                    f"[{provider.upper()}] Key {key_hash} skipped due to quota limits for {model_name}. "
                    f"TPM: {current_tpm}/{max_tpm}, RPM: {current_rpm}/{max_rpm}."
                )
                continue

            # Update counters atomically
            pipe = self.redis.pipeline()
            pipe.incrby(tpm_key, estimated_tokens)
            pipe.expire(tpm_key, 60)
            pipe.incr(rpm_key)
            pipe.expire(rpm_key, 60)
            await pipe.execute()

            return key

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

        # Classify severity and configure quarantine durations
        if error_type in ("429", "rate_limit"):
            ttl = 60
            state = "rate_limited"
        elif error_type in ("timeout", "503", "504"):
            ttl = 10
            state = "timed_out"
        elif error_type in ("401", "403", "auth", "permission_denied"):
            ttl = 604800  # 7 days quarantine for authorization failures
            state = "quarantined"
        else:
            ttl = 30
            state = f"error_{error_type}"

        await self.redis.set(cooldown_key, state, ex=ttl)
        logger.error(
            f"[{provider.upper()}] Placed key {key_hash} on {state} cooldown for model {model_name} "
            f"with TTL {ttl}s."
        )
