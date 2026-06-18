"""
Integration tests for the full request flow (src/main.py).

BUG CATEGORY I: End-to-end tests using mocked upstream HTTP responses.
BUG CATEGORY B: Streaming support tests.
"""

import os
import sys
from unittest.mock import patch

import httpx
import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

@pytest.fixture(autouse=True)
def mock_httpx_client():
    with patch("httpx.AsyncClient") as mock:
        mock_instance = mock.return_value
        mock_instance.__aenter__.return_value = mock_instance
        # Simulate connection refused to speed up tests and mimic no real upstream
        mock_instance.post.side_effect = httpx.ConnectError("Connection refused")
        yield mock

# We need to set up env vars BEFORE importing main, since main.py
# creates singletons at module level. We'll use lazy imports.


@pytest.fixture
def app_with_openrouter(tmp_path, monkeypatch):
    """Create a test app with OpenRouter provider configured."""
    monkeypatch.setenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("OPENROUTER_API_KEYS", "sk-or-test-stub-0001-padded-padded,sk-or-test-stub-0002-padded-padded")
    monkeypatch.delenv("LITEROUTER_AUTH_KEY", raising=False)
    monkeypatch.chdir(tmp_path)

    # Reset all singletons
    import src.config as config_mod
    import src.metrics as metrics_mod
    import src.rate_limiter as rl_mod
    import src.redis_client as redis_mod
    import src.router as router_mod

    config_mod._cached_config = None
    router_mod._router = None
    router_mod._mem_counters.clear()
    router_mod._mem_cooldowns.clear()
    router_mod._mem_quarantine.clear()
    rl_mod._limiter = None
    rl_mod._mem_last_calls.clear()
    metrics_mod._metrics = None
    redis_mod._sync_client = None
    redis_mod._async_client = None

    from src.main import app
    return app


@pytest.fixture
def app_with_auth(tmp_path, monkeypatch):
    """Create a test app with auth enabled."""
    monkeypatch.setenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("OPENROUTER_API_KEYS", "sk-or-test-stub-0001-padded-padded")
    monkeypatch.setenv("LITEROUTER_AUTH_KEY", "my-secret-key")
    monkeypatch.chdir(tmp_path)

    import src.config as config_mod
    import src.metrics as metrics_mod
    import src.rate_limiter as rl_mod
    import src.redis_client as redis_mod
    import src.router as router_mod

    config_mod._cached_config = None
    router_mod._router = None
    router_mod._mem_counters.clear()
    router_mod._mem_cooldowns.clear()
    router_mod._mem_quarantine.clear()
    rl_mod._limiter = None
    rl_mod._mem_last_calls.clear()
    metrics_mod._metrics = None
    redis_mod._sync_client = None
    redis_mod._async_client = None

    from src.main import app
    return app


class TestHealthEndpoint:
    """Tests for the health endpoint."""

    def test_health_returns_valid_json(self, app_with_openrouter):
        """
        BUG PROBE: Health endpoint should return valid JSON with all expected keys.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with patch("src.main._redis_info_safe", return_value={}):
                    with TestClient(app_with_openrouter) as client:
                        response = client.get("/health")
                        assert response.status_code == 200
                        data = response.json()
                        assert data["status"] == "ok"
                        assert "timestamp" in data
                        assert "config" in data
                        assert "router" in data
                        assert "queue" in data
                        assert "rateLimiter" in data
                        assert "metrics" in data
                        assert "redis" in data

    def test_root_health(self, app_with_openrouter):
        """
        BUG PROBE: Root path / should also return health info.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with patch("src.main._redis_info_safe", return_value={}):
                    with TestClient(app_with_openrouter) as client:
                        response = client.get("/")
                        assert response.status_code == 200
                        data = response.json()
                        assert data["status"] == "ok"


class TestAuthCheck:
    """Tests for authentication."""

    def test_wrong_key_returns_401(self, app_with_auth):
        """
        BUG PROBE: Request with wrong API key should return 401.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_auth) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        json={
                            "model": "openrouter",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                        headers={"Authorization": "Bearer wrong-key"},
                    )
                    assert response.status_code == 401

    def test_no_key_when_auth_enabled_returns_401(self, app_with_auth):
        """
        BUG PROBE: Request without Authorization header when auth is enabled
        should return 401.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_auth) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        json={
                            "model": "openrouter",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
                    assert response.status_code == 401

    def test_correct_key_passes(self, app_with_auth):
        """
        BUG PROBE: Request with correct API key should pass auth check.
        (It may fail upstream, but should not return 401.)
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_auth) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        json={
                            "model": "openrouter",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                        headers={"Authorization": "Bearer my-secret-key"},
                    )
                    # Should NOT be 401 — may be 502/503 due to no real upstream
                    assert response.status_code != 401

    def test_no_auth_configured_allows_all(self, app_with_openrouter):
        """
        BUG PROBE: When no auth key is configured, all requests should pass.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_openrouter) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        json={
                            "model": "openrouter",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
                    # Should NOT be 401
                    assert response.status_code != 401


class TestHealthCheck:
    """Tests for health check (no messages)."""

    def test_no_messages_returns_health_check(self, app_with_openrouter):
        """
        BUG PROBE: Request with no messages should return health-check response.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_openrouter) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        json={"model": "openrouter"},
                    )
                    assert response.status_code == 200
                    data = response.json()
                    assert data["id"] == "health-check"
                    assert data["choices"][0]["message"]["content"] == "ok"

    def test_no_messages_with_model(self, app_with_openrouter):
        """
        BUG PROBE: Health check should include the requested model name.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_openrouter) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        json={"model": "openrouter/some-model"},
                    )
                    assert response.status_code == 200
                    data = response.json()
                    assert data["model"] == "openrouter/some-model"


class TestUnknownProvider:
    """Tests for unknown provider handling."""

    def test_unknown_provider_returns_400(self, app_with_openrouter):
        """
        BUG PROBE: Request with unknown provider should return 400.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_openrouter) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        json={
                            "model": "unknownprovider",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
                    assert response.status_code == 400
                    data = response.json()
                    assert "Unknown provider" in data["error"]["message"]

    def test_unknown_provider_with_slash(self, app_with_openrouter):
        """
        BUG PROBE: Model "unknown/model" should extract "unknown" as provider.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_openrouter) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        json={
                            "model": "unknown/model",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
                    assert response.status_code == 400


class TestProviderDetection:
    """Tests for provider name extraction from model field."""

    def test_provider_extraction_with_slash(self, app_with_openrouter):
        """
        BUG PROBE: Model "openrouter/some-model" should extract "openrouter".
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_openrouter) as client:
                    # This should NOT return 400 (unknown provider)
                    response = client.post(
                        "/v1/chat/completions",
                        json={
                            "model": "openrouter/some-model",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
                    # Should not be 400 — openrouter is a known provider
                    assert response.status_code != 400

    def test_model_without_slash_uses_as_provider(self, app_with_openrouter):
        """
        BUG PROBE: Model "openrouter" (no slash) should use "openrouter" as provider.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_openrouter) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        json={
                            "model": "openrouter",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
                    # Should not be 400
                    assert response.status_code != 400


class TestInvalidJson:
    """Tests for invalid request bodies."""

    def test_invalid_json_returns_400(self, app_with_openrouter):
        """
        BUG PROBE: Invalid JSON body should return 400.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_openrouter) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        content=b"not json",
                        headers={"Content-Type": "application/json"},
                    )
                    assert response.status_code == 400


class TestEmptyModel:
    """Tests for empty/missing model field."""

    def test_empty_model_uses_first_provider(self, app_with_openrouter):
        """
        BUG PROBE: Empty model should use the first configured provider.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_openrouter) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        json={
                            "model": "",
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
                    # Should not be 400 — should fall back to first provider
                    assert response.status_code != 400

    def test_missing_model_uses_first_provider(self, app_with_openrouter):
        """
        BUG PROBE: Missing model field should use the first configured provider.
        """
        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with TestClient(app_with_openrouter) as client:
                    response = client.post(
                        "/v1/chat/completions",
                        json={
                            "messages": [{"role": "user", "content": "hi"}],
                        },
                    )
                    # Should not be 400
                    assert response.status_code != 400
