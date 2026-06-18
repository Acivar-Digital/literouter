"""
conftest.py — Shared fixtures for LiteRouter tests.

Resets singletons and global state between tests to ensure isolation.
"""

import os
import sys
from unittest.mock import patch

import pytest

# Ensure src is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


@pytest.fixture(autouse=True)
def reset_singletons():
    """Reset all singleton caches before each test."""
    import sys
    for module_name in ["src.main", "src.config", "src.router", "src.rate_limiter", "src.metrics"]:
        if module_name in sys.modules:
            del sys.modules[module_name]

    import src.config as config_mod
    import src.metrics as metrics_mod
    import src.rate_limiter as rl_mod
    import src.redis_client as redis_mod
    import src.router as router_mod

    # Reset config singleton
    config_mod._cached_config = None

    # Reset router singleton and in-memory state
    router_mod._router = None
    router_mod._mem_counters.clear()
    router_mod._mem_cooldowns.clear()
    router_mod._mem_quarantine.clear()

    # Reset rate limiter singleton and in-memory state
    rl_mod._limiter = None
    rl_mod._mem_last_calls.clear()

    # Reset metrics singleton and in-memory state
    metrics_mod._metrics = None
    metrics_mod._mem_metrics["requests_total"] = 0
    metrics_mod._mem_metrics["requests_success"] = 0
    metrics_mod._mem_metrics["requests_error"] = 0
    metrics_mod._mem_metrics["key_usage"] = {}
    metrics_mod._mem_metrics["error_by_status"] = {}
    metrics_mod._mem_metrics["latency_sum"] = 0
    metrics_mod._mem_metrics["latency_count"] = 0
    metrics_mod._mem_metrics["ratelimit_waits"] = 0
    metrics_mod._mem_metrics["ratelimit_wait_total_ms"] = 0

    # Reset Redis clients
    redis_mod._sync_client = None
    redis_mod._async_client = None

    yield


@pytest.fixture
def no_redis():
    """Ensure Redis is unavailable (all Redis operations use in-memory fallback)."""
    with patch("src.redis_client.get_redis_client", return_value=None):
        with patch("src.redis_client.redis_available", return_value=False):
            yield


@pytest.fixture
def mock_env_openrouter(tmp_path, monkeypatch):
    """Set up environment for a single OpenRouter provider."""
    env_file = tmp_path / ".env"
    env_file.write_text(
        "OPENROUTER_BASE_URL=https://openrouter.ai/api/v1\n"
        "OPENROUTER_API_KEYS=sk-test-stub-0001-padded-to-look-like-real,sk-test-stub-0002-padded-to-look-like-real,sk-test-stub-0003-padded-to-look-like-real\n"
    )
    monkeypatch.chdir(tmp_path)
    # Also set env vars directly for the config scanner
    monkeypatch.setenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("OPENROUTER_API_KEYS", "sk-test-stub-0001-padded-to-look-like-real,sk-test-stub-0002-padded-to-look-like-real,sk-test-stub-0003-padded-to-look-like-real")
    return tmp_path


@pytest.fixture
def mock_env_anthropic(tmp_path, monkeypatch):
    """Set up environment for a single Anthropic provider."""
    env_file = tmp_path / ".env"
    env_file.write_text(
        "ANTHROPIC_BASE_URL=https://api.anthropic.com\n"
        "ANTHROPIC_API_KEYS=sk-ant-test-stub-0001-padded-padded,sk-ant-test-stub-0002-padded-padded\n"
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
    monkeypatch.setenv("ANTHROPIC_API_KEYS", "sk-ant-test-stub-0001-padded-padded,sk-ant-test-stub-0002-padded-padded")
    return tmp_path


@pytest.fixture
def mock_env_gemini(tmp_path, monkeypatch):
    """Set up environment for a Gemini provider."""
    env_file = tmp_path / ".env"
    env_file.write_text(
        "GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta\n"
        "GEMINI_API_KEYS=gemini-test-stub-0001-padded-padded,gemini-test-stub-0002-padded-padded\n"
    )
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
    monkeypatch.setenv("GEMINI_API_KEYS", "gemini-test-stub-0001-padded-padded,gemini-test-stub-0002-padded-padded")
    return tmp_path
