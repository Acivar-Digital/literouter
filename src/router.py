"""
router.py — Redis-backed round-robin API key router for LiteRouter.

Per-provider round-robin key rotation with Redis persistence for counters,
cooldowns (exponential backoff), and quarantine lists. Falls back to
in-memory state if Redis is unavailable.
"""

import hashlib
import logging
import time
from typing import Optional

from src.config import ProviderConfig
from src.redis_client import get_redis_client, redis_available

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────────

COOLDOWN_TTL = 3600  # 1 hour max TTL for cooldown keys
BASE_COOLDOWN_SEC = 60  # initial cooldown for 429
MAX_COOLDOWN_SEC = 3600  # 1 hour cap

# ── In-memory fallback state ───────────────────────────────────────────────────

_mem_counters: dict[str, int] = {}
_mem_cooldowns: dict[str, dict[str, float]] = {}  # provider -> {sha -> expiry_ts}
_mem_quarantine: dict[str, set[str]] = {}  # provider -> set of sha


# ── Helpers ────────────────────────────────────────────────────────────────────


def _sha256(key: str) -> str:
    """Return a 12-char hex SHA-256 hash of an API key."""
    return hashlib.sha256(key.encode()).hexdigest()[:12]


def _counter_key(provider: str) -> str:
    return f"literouter:counter:{provider}"


def _cooldown_key(provider: str, key_sha: str) -> str:
    return f"literouter:cooldown:{provider}:{key_sha}"


def _quarantine_key(provider: str) -> str:
    return f"literouter:quarantine:{provider}"


# ── RedisRouter ────────────────────────────────────────────────────────────────


class RedisRouter:
    """Redis-backed round-robin API key router with in-memory fallback."""

    def __init__(self) -> None:
        self._redis = get_redis_client()

    def _is_redis(self) -> bool:
        return self._redis is not None and redis_available()

    # ── get_next_key ───────────────────────────────────────────────────────

    def get_next_key(
        self, provider_name: str, api_keys: list[str]
    ) -> Optional[str]:
        """Return the next available API key for *provider_name* using round-robin.

        Filters out quarantined keys and keys on cooldown.  Returns ``None``
        when every key is unavailable.
        """
        if not api_keys:
            return None

        if self._is_redis():
            return self._get_next_key_redis(provider_name, api_keys)
        return self._get_next_key_mem(provider_name, api_keys)

    # ── Redis path ─────────────────────────────────────────────────────────

    def _get_next_key_redis(
        self, provider_name: str, api_keys: list[str]
    ) -> Optional[str]:
        assert self._redis is not None
        now = time.time()

        # Build sha -> key mapping and filter quarantined / cooldown keys
        sha_map: dict[str, str] = {}
        alive_shas: list[str] = []
        pipe = self._redis.pipeline()

        for key in api_keys:
            sha = _sha256(key)
            sha_map[sha] = key
            pipe.sismember(_quarantine_key(provider_name), sha)
            pipe.get(_cooldown_key(provider_name, sha))

        results = pipe.execute()

        for i, key in enumerate(api_keys):
            sha = _sha256(key)
            is_quarantined = bool(results[i * 2])
            cooldown_raw = results[i * 2 + 1]

            if is_quarantined:
                continue

            if cooldown_raw is not None:
                cooldown_expiry = float(cooldown_raw)
                if now < cooldown_expiry:
                    continue

            alive_shas.append(sha)

        if not alive_shas:
            return None

        # Get / increment counter
        counter_raw = self._redis.get(_counter_key(provider_name))
        counter = int(counter_raw) if counter_raw is not None else 0

        start = counter % len(alive_shas)
        for i in range(len(alive_shas)):
            idx = (start + i) % len(alive_shas)
            chosen_sha = alive_shas[idx]
            # Verify once more that the key is still available (race condition)
            is_quarantined = self._redis.sismember(
                _quarantine_key(provider_name), chosen_sha
            )
            if is_quarantined:
                continue
            cooldown_raw = self._redis.get(
                _cooldown_key(provider_name, chosen_sha)
            )
            if cooldown_raw is not None and time.time() < float(cooldown_raw):
                continue

            self._redis.incr(_counter_key(provider_name))
            return sha_map[chosen_sha]

        return None

    # ── In-memory fallback ─────────────────────────────────────────────────

    def _get_next_key_mem(
        self, provider_name: str, api_keys: list[str]
    ) -> Optional[str]:
        now = time.time()

        if provider_name not in _mem_counters:
            _mem_counters[provider_name] = 0
        if provider_name not in _mem_cooldowns:
            _mem_cooldowns[provider_name] = {}
        if provider_name not in _mem_quarantine:
            _mem_quarantine[provider_name] = set()

        quarantined = _mem_quarantine[provider_name]
        cooldowns = _mem_cooldowns[provider_name]

        alive: list[str] = []
        for key in api_keys:
            sha = _sha256(key)
            if sha in quarantined:
                continue
            if sha in cooldowns and now < cooldowns[sha]:
                continue
            alive.append(key)

        if not alive:
            return None

        counter = _mem_counters[provider_name]
        start = counter % len(alive)

        for i in range(len(alive)):
            idx = (start + i) % len(alive)
            key = alive[idx]
            sha = _sha256(key)
            if sha in cooldowns and now < cooldowns[sha]:
                continue
            _mem_counters[provider_name] = (start + i + 1) % len(alive)
            return key

        return None

    # ── report_error ───────────────────────────────────────────────────────

    def report_error(self, provider_name: str, key: str, status: int) -> None:
        """Handle an upstream error for *key*.

        - 429 → exponential backoff cooldown (60 s → 120 s → … → 1 h max)
        - 401 / 403 → permanent quarantine
        """
        sha = _sha256(key)

        if self._is_redis():
            self._report_error_redis(provider_name, key, sha, status)
        else:
            self._report_error_mem(provider_name, key, sha, status)

    def _report_error_redis(
        self, provider_name: str, key: str, sha: str, status: int
    ) -> None:
        assert self._redis is not None
        now = time.time()

        if status == 429:
            cooldown_raw = self._redis.get(_cooldown_key(provider_name, sha))
            base_delay = BASE_COOLDOWN_SEC

            if cooldown_raw is not None:
                remaining = float(cooldown_raw) - now
                if remaining > 0:
                    base_delay = min(remaining * 2, MAX_COOLDOWN_SEC)

            expiry = now + base_delay
            self._redis.setex(
                _cooldown_key(provider_name, sha), COOLDOWN_TTL, str(expiry)
            )
            logger.info(
                f"[{provider_name}] 429 for key {key[:10]}... | "
                f"{int(base_delay)}s cooldown"
            )
        elif status in (401, 403):
            self._redis.sadd(_quarantine_key(provider_name), sha)
            logger.warning(
                f"[{provider_name}] {status} for key {key[:10]}... | "
                f"Quarantined permanently"
            )

    def _report_error_mem(
        self, provider_name: str, key: str, sha: str, status: int
    ) -> None:
        now = time.time()

        if provider_name not in _mem_cooldowns:
            _mem_cooldowns[provider_name] = {}
        if provider_name not in _mem_quarantine:
            _mem_quarantine[provider_name] = set()

        if status == 429:
            cooldowns = _mem_cooldowns[provider_name]
            existing = cooldowns.get(sha, 0.0)
            base_delay = BASE_COOLDOWN_SEC
            if existing > now:
                base_delay = min((existing - now) * 2, MAX_COOLDOWN_SEC)
            cooldowns[sha] = now + base_delay
            logger.info(
                f"[{provider_name}] 429 for key {key[:10]}... | "
                f"{int(base_delay)}s cooldown (memory)"
            )
        elif status in (401, 403):
            _mem_quarantine[provider_name].add(sha)
            logger.warning(
                f"[{provider_name}] {status} for key {key[:10]}... | "
                f"Quarantined permanently (memory)"
            )

    # ── get_router_status ──────────────────────────────────────────────────

    def get_router_status(
        self, providers: dict[str, ProviderConfig]
    ) -> dict:
        """Return per-provider router status (total keys, quarantine, cooldowns)."""
        if self._is_redis():
            return self._get_status_redis(providers)
        return self._get_status_mem(providers)

    def _get_status_redis(
        self, providers: dict[str, ProviderConfig]
    ) -> dict:
        assert self._redis is not None
        now = time.time()
        status: dict = {}

        for name, provider in providers.items():
            quarantine_members = self._redis.smembers(
                _quarantine_key(name)
            )
            quarantined_count = len(quarantine_members)

            # Scan cooldown keys for this provider
            cooldowns: list[dict] = []
            cursor = 0
            prefix = f"literouter:cooldown:{name}:"
            while True:
                cursor, keys = self._redis.scan(
                    cursor, match=f"{prefix}*", count=100
                )
                for ck in keys:
                    sha = ck.replace(prefix, "")
                    val = self._redis.get(ck)
                    if val is not None:
                        expiry = float(val)
                        if expiry > now:
                            cooldowns.append(
                                {
                                    "key": f"{sha}...",
                                    "remainingSec": int(expiry - now),
                                }
                            )
                if cursor == 0:
                    break

            counter_raw = self._redis.get(_counter_key(name))
            counter = int(counter_raw) if counter_raw is not None else 0

            status[name] = {
                "totalKeys": len(provider.api_keys),
                "deadKeysCount": quarantined_count,
                "quarantinedKeys": [
                    f"{m[:10]}..." for m in quarantine_members
                ],
                "activeCooldowns": cooldowns,
                "counterPosition": counter,
            }

        return status

    def _get_status_mem(
        self, providers: dict[str, ProviderConfig]
    ) -> dict:
        now = time.time()
        status: dict = {}

        for name, provider in providers.items():
            quarantined = _mem_quarantine.get(name, set())
            cooldowns = _mem_cooldowns.get(name, {})

            active_cooldowns = [
                {"key": f"{sha}...", "remainingSec": int(exp - now)}
                for sha, exp in cooldowns.items()
                if exp > now
            ]

            status[name] = {
                "totalKeys": len(provider.api_keys),
                "deadKeysCount": len(quarantined),
                "quarantinedKeys": [f"{m[:10]}..." for m in quarantined],
                "activeCooldowns": active_cooldowns,
                "counterPosition": _mem_counters.get(name, 0),
            }

        return status


# ── Singleton ──────────────────────────────────────────────────────────────────

_router: Optional[RedisRouter] = None


def get_router() -> RedisRouter:
    """Return the singleton RedisRouter instance."""
    global _router
    if _router is None:
        _router = RedisRouter()
    return _router
