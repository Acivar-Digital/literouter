"""
Tests for round-robin API key router (src/router.py).

BUG CATEGORY E: Tests for round-robin distribution, cooldowns, quarantine,
and edge cases. Uses in-memory fallback (no Redis).
"""

import time
from unittest.mock import patch

from src.config import ProviderConfig


class TestRoundRobin:
    """Tests for round-robin key selection."""

    def setup_method(self):
        """Create a fresh router with no Redis."""
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                from src.router import RedisRouter
                self.router = RedisRouter()

    def test_round_robin_distribution(self):
        """
        BUG PROBE: With 3 keys, verify each key gets selected in rotation.
        The counter increments and wraps around the alive keys list.
        """
        keys = ["key-a", "key-b", "key-c"]
        result1 = self.router.get_next_key("test", keys)
        result2 = self.router.get_next_key("test", keys)
        result3 = self.router.get_next_key("test", keys)
        result4 = self.router.get_next_key("test", keys)  # Should wrap

        assert result1 == "key-a"
        assert result2 == "key-b"
        assert result3 == "key-c"
        assert result4 == "key-a"  # Wraps around

    def test_all_keys_quarantined(self):
        """
        BUG PROBE: All keys quarantined should return None.
        """
        keys = ["key-a", "key-b"]
        for key in keys:
            self.router.report_error("test", key, 401)

        result = self.router.get_next_key("test", keys)
        assert result is None

    def test_all_keys_on_cooldown(self):
        """
        BUG PROBE: All keys on cooldown should return None.
        """
        keys = ["key-a", "key-b"]
        for key in keys:
            self.router.report_error("test", key, 429)

        result = self.router.get_next_key("test", keys)
        assert result is None

    def test_single_key(self):
        """
        BUG PROBE: Single key should always be returned.
        """
        keys = ["only-key"]
        for _ in range(5):
            result = self.router.get_next_key("test", keys)
            assert result == "only-key"

    def test_empty_key_list(self):
        """
        BUG PROBE: Empty key list should return None, not crash.
        """
        result = self.router.get_next_key("test", [])
        assert result is None

    def test_cooldown_expiry(self):
        """
        BUG PROBE: Key on cooldown should become available after expiry.
        We set a cooldown, then manually expire it by manipulating time.
        """
        keys = ["key-a"]
        self.router.report_error("test", "key-a", 429)

        # Key should be on cooldown now
        result = self.router.get_next_key("test", keys)
        assert result is None

        # Manually expire the cooldown by setting it to the past
        import src.router as router_mod
        sha = None
        for k in keys:
            from src.router import _sha256
            sha = _sha256(k)
            break

        router_mod._mem_cooldowns["test"][sha] = time.time() - 1

        result = self.router.get_next_key("test", keys)
        assert result == "key-a"

    def test_exponential_backoff(self):
        """
        BUG PROBE: Two consecutive 429s should double the cooldown.
        First 429: 60s cooldown. Second 429: 120s cooldown.
        """
        keys = ["key-a"]
        import src.router as router_mod
        from src.router import _sha256

        sha = _sha256("key-a")

        # First 429
        self.router.report_error("test", "key-a", 429)
        first_expiry = router_mod._mem_cooldowns["test"].get(sha, 0)
        first_cooldown = first_expiry - time.time()
        assert 55 <= first_cooldown <= 65, f"First cooldown was {first_cooldown}s, expected ~60s"

        # Second 429 (consecutive, immediately after)
        self.router.report_error("test", "key-a", 429)
        second_expiry = router_mod._mem_cooldowns["test"].get(sha, 0)
        second_cooldown = second_expiry - time.time()
        assert 110 <= second_cooldown <= 130, f"Second cooldown was {second_cooldown}s, expected ~120s"

    def test_quarantine_is_permanent(self):
        """
        BUG PROBE: 401 should permanently quarantine a key.
        The key should stay quarantined across multiple get_next_key calls.
        """
        keys = ["key-a", "key-b"]
        self.router.report_error("test", "key-a", 401)

        for _ in range(5):
            result = self.router.get_next_key("test", keys)
            assert result == "key-b", "key-a should be permanently quarantined"

    def test_403_also_quarantines(self):
        """
        BUG PROBE: 403 should also permanently quarantine (same as 401).
        """
        keys = ["key-a", "key-b"]
        self.router.report_error("test", "key-a", 403)

        result = self.router.get_next_key("test", keys)
        assert result == "key-b"

    def test_cooldown_does_not_quarantine(self):
        """
        BUG PROBE: 429 cooldown should NOT permanently quarantine.
        After cooldown expires, key should be available again.
        """
        keys = ["key-a"]
        self.router.report_error("test", "key-a", 429)

        # Expire cooldown
        import src.router as router_mod
        from src.router import _sha256
        sha = _sha256("key-a")
        router_mod._mem_cooldowns["test"][sha] = time.time() - 1

        result = self.router.get_next_key("test", keys)
        assert result == "key-a"

    def test_mixed_quarantine_and_cooldown(self):
        """
        BUG PROBE: One key quarantined, one on cooldown.
        Should return None (no available keys).
        """
        keys = ["key-a", "key-b"]
        self.router.report_error("test", "key-a", 401)  # Quarantined
        self.router.report_error("test", "key-b", 429)  # Cooldown

        result = self.router.get_next_key("test", keys)
        assert result is None

    def test_round_robin_skips_unavailable(self):
        """
        BUG PROBE: Round-robin should skip unavailable keys.
        With 3 keys where key-b is unavailable, should alternate a, c, a, c...
        """
        keys = ["key-a", "key-b", "key-c"]
        self.router.report_error("test", "key-b", 401)  # Quarantine key-b

        r1 = self.router.get_next_key("test", keys)
        r2 = self.router.get_next_key("test", keys)
        r3 = self.router.get_next_key("test", keys)

        assert r1 in ("key-a", "key-c")
        assert r2 in ("key-a", "key-c")
        assert r3 in ("key-a", "key-c")
        assert r1 != r2  # Should alternate

    def test_get_router_status(self):
        """
        BUG PROBE: get_router_status should return correct counts.
        """
        keys = ["key-a", "key-b", "key-c"]
        providers = {
            "test": ProviderConfig(
                base_url="https://api.test.com",
                api_keys=keys,
            )
        }

        self.router.report_error("test", "key-a", 401)
        self.router.report_error("test", "key-b", 429)

        status = self.router.get_router_status(providers)
        assert "test" in status
        assert status["test"]["totalKeys"] == 3
        assert status["test"]["deadKeysCount"] == 1  # Only key-a quarantined

    def test_unknown_error_status_ignored(self):
        """
        BUG PROBE: Error status that's not 429/401/403 should be ignored.
        e.g., 500 should not affect key availability.
        """
        keys = ["key-a"]
        self.router.report_error("test", "key-a", 500)

        result = self.router.get_next_key("test", keys)
        assert result == "key-a"  # Should still be available

    def test_max_cooldown_cap(self):
        """
        BUG PROBE: Cooldown should be capped at MAX_COOLDOWN_SEC (3600).
        After many 429s, cooldown should never exceed 3600s.
        """
        import src.router as router_mod
        from src.router import _sha256

        keys = ["key-a"]
        sha = _sha256("key-a")

        # Simulate many 429s
        for _ in range(20):
            self.router.report_error("test", "key-a", 429)

        expiry = router_mod._mem_cooldowns["test"].get(sha, 0)
        cooldown = expiry - time.time()
        assert cooldown <= 3600, f"Cooldown exceeded max: {cooldown}s"
