"""
redis_client.py — Redis connection layer for LiteRouter.

Provides sync + async dual support following the baziRAG graceful degradation pattern.
If Redis is unavailable, clients return None and all operations check for None.
"""

import logging
import os
from typing import Any, Optional

import redis
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

REDIS_HOST = os.getenv("REDIS_HOST", "")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", "")

_sync_client: Optional["redis.Redis"] = None
_async_client: Optional["redis.asyncio.Redis"] = None


# ── Sync client ────────────────────────────────────────────────────────────────


def get_redis_client() -> Optional["redis.Redis"]:
    """Return a cached sync Redis client, or None if Redis is unavailable.

    Uses connection pooling with socket timeouts. On first call, attempts a
    ping() to verify connectivity. If the ping fails, returns None and all
    subsequent calls also return None (graceful degradation).
    """
    global _sync_client
    if _sync_client is not None:
        return _sync_client

    try:
        _sync_client = redis.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            db=REDIS_DB,
            password=REDIS_PASSWORD or None,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        _sync_client.ping()
        logger.info(f"Redis sync connected at {REDIS_HOST}:{REDIS_PORT}")
    except Exception as exc:
        logger.warning(f"Redis sync unavailable ({exc}) — operations disabled")
        _sync_client = None
    return _sync_client


# ── Async client ───────────────────────────────────────────────────────────────


async def get_async_redis_client() -> Optional["redis.asyncio.Redis"]:
    """Return a cached async Redis client, or None if Redis is unavailable.

    Mirrors the sync client pattern using redis.asyncio.
    """
    global _async_client
    if _async_client is not None:
        return _async_client

    import redis.asyncio as redis_async

    try:
        _async_client = redis_async.Redis(
            host=REDIS_HOST,
            port=REDIS_PORT,
            db=REDIS_DB,
            password=REDIS_PASSWORD or None,
            decode_responses=True,
            socket_connect_timeout=2,
            socket_timeout=2,
        )
        await _async_client.ping()
        logger.info(f"Redis async connected at {REDIS_HOST}:{REDIS_PORT}")
    except Exception as exc:
        logger.warning(f"Redis async unavailable ({exc}) — operations disabled")
        _async_client = None
    return _async_client


# ── Health / info ──────────────────────────────────────────────────────────────


def redis_available() -> bool:
    """Return True if a sync Redis client is connected and responsive."""
    client = get_redis_client()
    if client is None:
        return False
    try:
        return client.ping()
    except Exception:
        return False


def get_redis_info() -> dict[str, Any]:
    """Return Redis server info as a dict, or empty dict if unavailable."""
    client = get_redis_client()
    if client is None:
        return {}
    try:
        info = client.info()
        return {
            "redis_version": info.get("redis_version", "unknown"),
            "connected_clients": info.get("connected_clients", 0),
            "used_memory_human": info.get("used_memory_human", "unknown"),
            "uptime_in_seconds": info.get("uptime_in_seconds", 0),
        }
    except Exception as exc:
        logger.debug(f"Failed to get Redis info: {exc}")
        return {}
