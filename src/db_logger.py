"""
log_buffer.py — In-memory bounded request log for LiteRouter.

Replaces the previous SQLite-backed logger (src/db_logger.py) which grew
unboundedly to 400MB+ and caused RAM sluggishness. Logs are now kept in
a bounded deque with FIFO eviction — no disk writes, no SQLite overhead.

Trade-off: logs are lost on daemon restart. This is acceptable because:
1. The logs were never queried by the application (write-only).
2. The /health endpoint exposes live metrics, not historical logs.
3. RAM is the constraint we're optimizing for.

Cap: 5,000 entries. At ~112KB/row worst case (full request body), this is
~560MB max — well under the 1GB budget. Tune via _MAX_ENTRIES if needed.
"""

import time
from collections import deque
from typing import Optional

_MAX_ENTRIES = 5000

_log_buffer: deque = deque(maxlen=_MAX_ENTRIES)


def init_db() -> None:
    """No-op. Kept for backward compatibility with main.py startup hook."""
    pass


def log_leg(
    req_id: str,
    leg: int,
    direction: str,
    source: str,
    destination: str,
    url: Optional[str] = None,
    status_code: Optional[int] = None,
    body: Optional[dict] = None,
) -> None:
    """Append a request leg to the in-memory ring buffer.

    When the buffer is full, the oldest entry is evicted automatically
    (deque maxlen enforces FIFO).
    """
    _log_buffer.append({
        "req_id": req_id,
        "leg": leg,
        "timestamp": time.time(),
        "direction": direction,
        "source": source,
        "destination": destination,
        "url": url,
        "status_code": status_code,
        "body": body,
    })


def get_recent_logs(n: int = 100) -> list:
    """Return the most recent N log entries (newest first)."""
    return list(reversed(list(_log_buffer)[-n:]))


def get_log_count() -> int:
    """Return the current number of entries in the buffer."""
    return len(_log_buffer)


def clear_logs() -> None:
    """Clear all log entries. Useful for tests."""
    _log_buffer.clear()
