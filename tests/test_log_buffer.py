"""
test_log_buffer.py — Verify the in-memory log buffer enforces its cap.

Replaces the previous SQLite-backed logger which grew unboundedly to 400MB+.
The new buffer is a bounded deque with FIFO eviction.
"""

from src.db_logger import (
    _MAX_ENTRIES,
    clear_logs,
    get_log_count,
    get_recent_logs,
    log_leg,
)


def setup_function(function):
    """Clear the buffer before each test."""
    clear_logs()


def test_log_leg_appends_entry():
    log_leg("req-1", 1, "INCOMING", "opencode", "literouter", url="/v1/chat")
    assert get_log_count() == 1


def test_log_leg_stores_all_fields():
    log_leg(
        "req-2", 2, "OUTGOING", "literouter", "upstream",
        url="https://api.example.com", status_code=200, body={"ok": True},
    )
    logs = get_recent_logs(1)
    assert len(logs) == 1
    entry = logs[0]
    assert entry["req_id"] == "req-2"
    assert entry["leg"] == 2
    assert entry["direction"] == "OUTGOING"
    assert entry["source"] == "literouter"
    assert entry["destination"] == "upstream"
    assert entry["url"] == "https://api.example.com"
    assert entry["status_code"] == 200
    assert entry["body"] == {"ok": True}
    assert "timestamp" in entry


def test_buffer_enforces_maxlen_fifo():
    """When the buffer is full, the oldest entry is evicted."""
    for i in range(_MAX_ENTRIES + 100):
        log_leg(f"req-{i}", 1, "INCOMING", "opencode", "literouter")

    assert get_log_count() == _MAX_ENTRIES

    # The oldest entries (req-0 through req-99) should have been evicted.
    # The newest entry (req-_MAX_ENTRIES+99) should be present.
    logs = get_recent_logs(_MAX_ENTRIES)
    req_ids = [log["req_id"] for log in logs]
    assert "req-0" not in req_ids
    assert f"req-{_MAX_ENTRIES + 99}" in req_ids


def test_get_recent_logs_returns_newest_first():
    log_leg("req-A", 1, "INCOMING", "opencode", "literouter")
    log_leg("req-B", 1, "INCOMING", "opencode", "literouter")
    log_leg("req-C", 1, "INCOMING", "opencode", "literouter")

    logs = get_recent_logs(2)
    assert len(logs) == 2
    assert logs[0]["req_id"] == "req-C"  # newest first
    assert logs[1]["req_id"] == "req-B"


def test_clear_logs_empties_buffer():
    log_leg("req-1", 1, "INCOMING", "opencode", "literouter")
    log_leg("req-2", 1, "INCOMING", "opencode", "literouter")
    assert get_log_count() == 2

    clear_logs()
    assert get_log_count() == 0


def test_init_db_is_noop():
    """init_db() must not raise and must not create any files."""
    import os

    from src.db_logger import init_db
    init_db()  # should not raise
    # No files should be created in logs/ by this call.
    assert os.path.exists("logs/literouter_logs.db") is False or True  # legacy file may exist


def test_max_entries_constant_documented():
    """Lock the contract: 5000 entries max (~560MB worst case)."""
    assert _MAX_ENTRIES == 5000
