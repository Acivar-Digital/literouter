"""
queue.py — Redis-backed sequential request queue for LiteRouter.

Provides enqueue, dequeue, processing tracking, and expired-job reclaim
using Redis LIST + ZSET. Falls back to an in-memory deque when Redis is
unavailable.

Redis key schema:
    literouter:queue        LIST   pending requests (JSON serialized)
    literouter:processing   ZSET   in-progress jobs (score = visibility timeout)
"""

import json
import logging
import time
import uuid
from collections import deque

from src.redis_client import get_redis_client

logger = logging.getLogger(__name__)

QUEUE_KEY = "literouter:queue"
PROCESSING_KEY = "literouter:processing"

# ── In-memory fallback ────────────────────────────────────────────────────────

_memory_queue: deque[tuple[str, dict]] = deque()
_memory_processing: dict[str, float] = {}  # job_id -> expiry timestamp


def enqueue_request(request_data: dict) -> str:
    """Push a request onto the pending queue and return its job_id.

    Serialises *request_data* as JSON and RPUSHes it onto the Redis list.
    If Redis is unavailable, stores the payload in an in-memory deque.
    """
    job_id = str(uuid.uuid4())
    payload = json.dumps({"job_id": job_id, **request_data})

    client = get_redis_client()
    if client is not None:
        try:
            client.rpush(QUEUE_KEY, payload)
            logger.info(f"[Queue] Enqueued {job_id}")
            return job_id
        except Exception as exc:
            logger.warning(f"[Queue] Redis RPUSH failed, using memory fallback: {exc}")

    _memory_queue.append((job_id, request_data))
    logger.info(f"[Queue] Enqueued {job_id} (memory fallback)")
    return job_id


def dequeue_request() -> dict | None:
    """Pop the oldest pending request from the queue.

    Returns the deserialized dict (including ``job_id``) or ``None`` when
    the queue is empty.
    """
    client = get_redis_client()
    if client is not None:
        try:
            raw = client.lpop(QUEUE_KEY)
            if raw is not None:
                return json.loads(raw)
        except Exception as exc:
            logger.warning(f"[Queue] Redis LPOP failed, using memory fallback: {exc}")

    if _memory_queue:
        job_id, data = _memory_queue.popleft()
        return {"job_id": job_id, **data}
    return None


def mark_processing(job_id: str, timeout_sec: int = 300) -> None:
    """Record *job_id* as in-progress with a visibility timeout.

    Adds the job to the processing ZSET with score = current time + timeout.
    Jobs whose score is in the past are considered expired and eligible for
    reclaim.
    """
    score = time.time() + timeout_sec

    client = get_redis_client()
    if client is not None:
        try:
            client.zadd(PROCESSING_KEY, {job_id: score})
            logger.debug(f"[Queue] Marked {job_id} as processing (timeout={timeout_sec}s)")
            return
        except Exception as exc:
            logger.warning(f"[Queue] Redis ZADD failed, using memory fallback: {exc}")

    _memory_processing[job_id] = score


def reclaim_expired() -> list[str]:
    """Reclaim jobs whose visibility timeout has elapsed.

    Finds all entries in the processing ZSET with score <= now, pushes them
    back onto the pending queue, and removes them from the processing set.
    Returns the list of reclaimed job_ids.
    """
    now = time.time()
    reclaimed: list[str] = []

    client = get_redis_client()
    if client is not None:
        try:
            expired = client.zrangebyscore(PROCESSING_KEY, 0, now)
            if expired:
                pipe = client.pipeline()
                for job_id in expired:
                    pipe.rpush(QUEUE_KEY, job_id)
                    pipe.zrem(PROCESSING_KEY, job_id)
                pipe.execute()
                reclaimed = list(expired)
                logger.info(f"[Queue] Reclaimed {len(reclaimed)} expired jobs")
            return reclaimed
        except Exception as exc:
            logger.warning(f"[Queue] Redis reclaim failed, using memory fallback: {exc}")

    expired_ids = [jid for jid, expiry in _memory_processing.items() if expiry <= now]
    for jid in expired_ids:
        del _memory_processing[jid]
        if jid.startswith("mem-"):
            pass
    reclaimed = expired_ids
    if reclaimed:
        logger.info(f"[Queue] Reclaimed {len(reclaimed)} expired jobs (memory)")
    return reclaimed


def get_queue_status() -> dict:
    """Return current queue lengths for pending and processing sets."""
    client = get_redis_client()
    if client is not None:
        try:
            return {
                "pending": client.llen(QUEUE_KEY),
                "processing": client.zcard(PROCESSING_KEY),
            }
        except Exception as exc:
            logger.warning(f"[Queue] Redis status failed, using memory fallback: {exc}")

    return {
        "pending": len(_memory_queue),
        "processing": len(_memory_processing),
    }
