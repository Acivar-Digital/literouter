"""
embed_cache.py — Embedding and query result cache backed by Redis.

Follows the RedisVL pattern with graceful degradation: if Redis is
unavailable, all functions return None / no-op.

Key schema:
    literouter:embed:{sha256}  — embedding vectors (24h TTL)
    literouter:query:{sha256}  — query results (1h TTL)
"""

import hashlib
import json
import logging
from typing import Optional

from src.redis_client import get_async_redis_client, get_redis_client

logger = logging.getLogger(__name__)

EMBED_TTL = 86400  # 24 hours
QUERY_TTL = 3600   # 1 hour


def _hash_text(text: str) -> str:
    """Return the hex SHA-256 digest of *text*."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _embed_key(text: str) -> str:
    return f"literouter:embed:{_hash_text(text)}"


def _query_key(query: str) -> str:
    return f"literouter:query:{_hash_text(query)}"


# ── Sync embedding cache ──────────────────────────────────────────────────────


def cache_embedding(text: str, vector: list[float]) -> None:
    """Cache an embedding vector for *text* with a 24-hour TTL.

    No-op if Redis is unavailable.
    """
    client = get_redis_client()
    if client is None:
        return
    try:
        key = _embed_key(text)
        client.setex(key, EMBED_TTL, json.dumps(vector))
    except Exception as exc:
        logger.debug("cache_embedding failed: %s", exc)


def get_cached_embedding(text: str) -> Optional[list[float]]:
    """Return a cached embedding for *text*, or None if not found.

    Returns None if Redis is unavailable.
    """
    client = get_redis_client()
    if client is None:
        return None
    try:
        key = _embed_key(text)
        raw = client.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.debug("get_cached_embedding failed: %s", exc)
        return None


# ── Async embedding cache ─────────────────────────────────────────────────────


async def async_cache_embedding(text: str, vector: list[float]) -> None:
    """Async variant of ``cache_embedding``."""
    client = await get_async_redis_client()
    if client is None:
        return
    try:
        key = _embed_key(text)
        await client.setex(key, EMBED_TTL, json.dumps(vector))
    except Exception as exc:
        logger.debug("async_cache_embedding failed: %s", exc)


async def async_get_cached_embedding(text: str) -> Optional[list[float]]:
    """Async variant of ``get_cached_embedding``."""
    client = await get_async_redis_client()
    if client is None:
        return None
    try:
        key = _embed_key(text)
        raw = await client.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.debug("async_get_cached_embedding failed: %s", exc)
        return None


# ── Sync query result cache ───────────────────────────────────────────────────


def cache_query_result(query: str, result: list[dict]) -> None:
    """Cache a query result for *query* with a 1-hour TTL.

    No-op if Redis is unavailable.
    """
    client = get_redis_client()
    if client is None:
        return
    try:
        key = _query_key(query)
        client.setex(key, QUERY_TTL, json.dumps(result))
    except Exception as exc:
        logger.debug("cache_query_result failed: %s", exc)


def get_cached_query_result(query: str) -> Optional[list[dict]]:
    """Return a cached query result for *query*, or None if not found.

    Returns None if Redis is unavailable.
    """
    client = get_redis_client()
    if client is None:
        return None
    try:
        key = _query_key(query)
        raw = client.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.debug("get_cached_query_result failed: %s", exc)
        return None


# ── Async query result cache ──────────────────────────────────────────────────


async def async_cache_query_result(query: str, result: list[dict]) -> None:
    """Async variant of ``cache_query_result``."""
    client = await get_async_redis_client()
    if client is None:
        return
    try:
        key = _query_key(query)
        await client.setex(key, QUERY_TTL, json.dumps(result))
    except Exception as exc:
        logger.debug("async_cache_query_result failed: %s", exc)


async def async_get_cached_query_result(query: str) -> Optional[list[dict]]:
    """Async variant of ``get_cached_query_result``."""
    client = await get_async_redis_client()
    if client is None:
        return None
    try:
        key = _query_key(query)
        raw = await client.get(key)
        if raw is None:
            return None
        return json.loads(raw)
    except Exception as exc:
        logger.debug("async_get_cached_query_result failed: %s", exc)
        return None


# ── Cache management ──────────────────────────────────────────────────────────


def clear_cache() -> None:
    """Delete all embedding and query cache keys.

    No-op if Redis is unavailable.
    """
    client = get_redis_client()
    if client is None:
        return
    try:
        _delete_pattern(client, "literouter:embed:*")
        _delete_pattern(client, "literouter:query:*")
        logger.info("Embedding cache cleared")
    except Exception as exc:
        logger.debug("clear_cache failed: %s", exc)


def _delete_pattern(client, pattern: str) -> None:
    """Delete all keys matching *pattern* using SCAN + DELETE."""
    cursor = 0
    while True:
        cursor, keys = client.scan(cursor, match=pattern, count=100)
        if keys:
            client.delete(*keys)
        if cursor == 0:
            break


async def async_clear_cache() -> None:
    """Async variant of ``clear_cache``."""
    client = await get_async_redis_client()
    if client is None:
        return
    try:
        await _async_delete_pattern(client, "literouter:embed:*")
        await _async_delete_pattern(client, "literouter:query:*")
        logger.info("Embedding cache cleared (async)")
    except Exception as exc:
        logger.debug("async_clear_cache failed: %s", exc)


async def _async_delete_pattern(client, pattern: str) -> None:
    """Async delete all keys matching *pattern*."""
    cursor = 0
    while True:
        cursor, keys = await client.scan(cursor, match=pattern, count=100)
        if keys:
            await client.delete(*keys)
        if cursor == 0:
            break


def redis_available() -> bool:
    """Return True if the sync Redis client is connected."""
    client = get_redis_client()
    if client is None:
        return False
    try:
        return client.ping()
    except Exception:
        return False
