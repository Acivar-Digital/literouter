"""
Tests for rate limiter (src/rate_limiter.py).

BUG CATEGORY F: Tests for in-memory rate limiting fallback.
"""

import time
from unittest.mock import patch


class TestRateLimiter:
    """Tests for RedisRateLimiter with in-memory fallback."""

    def setup_method(self):
        """Create a fresh rate limiter with no Redis."""
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                from src.rate_limiter import RedisRateLimiter
                self.limiter = RedisRateLimiter()
                import src.rate_limiter as rl_mod
                rl_mod._mem_last_calls.clear()

    def test_first_call_always_ready(self):
        """
        BUG PROBE: First call to can_call should always return ready=True.
        No prior calls means no rate limit delay.
        """
        result = self.limiter.can_call("test-provider", 5000)
        assert result["ready"] is True
        assert result["wait_ms"] == 0

    def test_second_call_within_delay(self):
        """
        BUG PROBE: Second call within min_delay_ms should return ready=False.
        With min_delay_ms=5000, the second immediate call should be rate-limited.
        """
        self.limiter.can_call("test-provider", 5000)
        result = self.limiter.can_call("test-provider", 5000)
        assert result["ready"] is False
        assert result["wait_ms"] > 0

    def test_call_after_delay_expires(self):
        """
        BUG PROBE: After the delay expires, can_call should return ready=True.
        We mock time to advance past the delay.
        """
        # First call at t=0
        with patch("src.rate_limiter.time") as mock_time:
            mock_time.time.return_value = 1000.0
            mock_time.return_value = 1000.0
            result = self.limiter.can_call("test-provider", 5000)
            assert result["ready"] is True

        # Second call at t=6 (6000ms later, past the 5000ms delay)
        with patch("src.rate_limiter.time") as mock_time:
            mock_time.time.return_value = 1006.0
            mock_time.return_value = 1006.0
            result = self.limiter.can_call("test-provider", 5000)
            print("DEBUG RESULT:", result)
            assert result["ready"] is True

    def test_memory_fallback_isolated_providers(self):
        """
        BUG PROBE: Rate limiting should be per-provider.
        Two different providers should not share rate limit state.
        """
        result_a = self.limiter.can_call("provider-a", 5000)
        result_b = self.limiter.can_call("provider-b", 5000)

        assert result_a["ready"] is True
        assert result_b["ready"] is True

    def test_mark_call_updates_timestamp(self):
        """
        BUG PROBE: mark_call should update the last call timestamp.
        After mark_call, the next can_call should see the updated time.
        """
        self.limiter.can_call("test-provider", 100)
        self.limiter.mark_call("test-provider")

        # Immediately after mark_call, should be rate-limited
        result = self.limiter.can_call("test-provider", 100)
        assert result["ready"] is False

    def test_reset_clears_state(self):
        """
        BUG PROBE: reset() should clear rate limit state.
        After reset, the next call should be ready=True.
        """
        self.limiter.can_call("test-provider", 5000)
        result = self.limiter.can_call("test-provider", 5000)
        assert result["ready"] is False

        self.limiter.reset("test-provider")
        result = self.limiter.can_call("test-provider", 5000)
        assert result["ready"] is True

    def test_get_status(self):
        """
        BUG PROBE: get_status should return tracked providers.
        """
        self.limiter.can_call("test-provider", 5000)
        status = self.limiter.get_status()
        assert "test-provider" in status

    def test_wait_ms_calculation(self):
        """
        BUG PROBE: wait_ms should reflect the remaining time accurately.
        With min_delay_ms=5000 and 2000ms elapsed, wait_ms should be ~3000.
        """
        # First call at t=0
        self.limiter.can_call("test-provider", 5000)

        # Second call: manually set last call to 2000ms ago
        import src.rate_limiter as rl_mod
        rl_mod._mem_last_calls["test-provider"] = (time.time() - 2.0) * 1000

        result = self.limiter.can_call("test-provider", 5000)
        assert result["ready"] is False
        # wait_ms should be approximately 3000 (5000 - 2000)
        assert 2500 <= result["wait_ms"] <= 3500, f"wait_ms was {result['wait_ms']}, expected ~3000"

    def test_zero_delay_always_ready(self):
        """
        BUG PROBE: min_delay_ms=0 should always be ready.
        """
        for _ in range(10):
            result = self.limiter.can_call("test-provider", 0)
            assert result["ready"] is True
