"""
Tests for embedding cache (src/embed_cache.py).

BUG CATEGORY H: Tests for cache hit/miss and Redis unavailability.
"""

import os
import sys
from unittest.mock import patch, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestEmbedCache:
    """Tests for embedding and query result cache."""

    def test_cache_miss_returns_none(self):
        """
        BUG PROBE: Cache miss should return None, not crash.
        With no Redis, all cache operations should gracefully return None.
        """
        with patch("src.embed_cache.get_redis_client", return_value=None):
            from src.embed_cache import get_cached_embedding
            result = get_cached_embedding("some text")
            assert result is None

    def test_cache_hit_returns_data(self):
        """
        BUG PROBE: Cache hit should return the correct data.
        """
        import json
        mock_client = MagicMock()
        mock_client.get.return_value = json.dumps([0.1, 0.2, 0.3])

        with patch("src.embed_cache.get_redis_client", return_value=mock_client):
            from src.embed_cache import get_cached_embedding, cache_embedding

            # First cache it
            cache_embedding("hello", [0.1, 0.2, 0.3])

            # Then retrieve it
            result = get_cached_embedding("hello")
            assert result == [0.1, 0.2, 0.3]

    def test_redis_unavailable_all_noop(self):
        """
        BUG PROBE: When Redis is unavailable, all cache functions should
        be no-ops and return None without raising exceptions.
        """
        with patch("src.embed_cache.get_redis_client", return_value=None):
            from src.embed_cache import (
                cache_embedding,
                get_cached_embedding,
                cache_query_result,
                get_cached_query_result,
                clear_cache,
            )

            # All should be no-ops
            cache_embedding("text", [0.1])
            assert get_cached_embedding("text") is None
            cache_query_result("query", [{"result": "data"}])
            assert get_cached_query_result("query") is None
            clear_cache()  # Should not raise

    def test_cache_different_texts_different_keys(self):
        """
        BUG PROBE: Different texts should produce different cache keys.
        """
        from src.embed_cache import _embed_key
        key1 = _embed_key("hello")
        key2 = _embed_key("world")
        assert key1 != key2

    def test_cache_same_text_same_key(self):
        """
        BUG PROBE: Same text should produce the same cache key (deterministic).
        """
        from src.embed_cache import _embed_key
        key1 = _embed_key("hello")
        key2 = _embed_key("hello")
        assert key1 == key2

    def test_query_cache_miss(self):
        """
        BUG PROBE: Query cache miss should return None.
        """
        mock_client = MagicMock()
        mock_client.get.return_value = None

        with patch("src.embed_cache.get_redis_client", return_value=mock_client):
            from src.embed_cache import get_cached_query_result
            result = get_cached_query_result("unknown query")
            assert result is None

    def test_query_cache_hit(self):
        """
        BUG PROBE: Query cache hit should return correct data.
        """
        import json
        expected = [{"id": 1, "score": 0.95}]
        mock_client = MagicMock()
        mock_client.get.return_value = json.dumps(expected)

        with patch("src.embed_cache.get_redis_client", return_value=mock_client):
            from src.embed_cache import get_cached_query_result
            result = get_cached_query_result("known query")
            assert result == expected

    def test_redis_exception_returns_none(self):
        """
        BUG PROBE: Redis exceptions should be caught and return None.
        """
        mock_client = MagicMock()
        mock_client.get.side_effect = Exception("Connection lost")

        with patch("src.embed_cache.get_redis_client", return_value=mock_client):
            from src.embed_cache import get_cached_embedding
            result = get_cached_embedding("text")
            assert result is None
