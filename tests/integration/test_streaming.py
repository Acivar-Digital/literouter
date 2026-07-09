"""
Tests for streaming support (src/main.py).

BUG CATEGORY B: Tests for stream=True/False paths, error handling in streams,
and model name handling during streaming.
"""

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _setup_app(tmp_path, monkeypatch):
    """Helper to set up a fresh app with OpenRouter provider."""
    monkeypatch.setenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
    monkeypatch.setenv("OPENROUTER_API_KEYS", "sk-or-test-stub-0001-padded-padded")
    monkeypatch.delenv("LITEROUTER_AUTH_KEY", raising=False)
    monkeypatch.chdir(tmp_path)

    import src.metrics as metrics_mod
    import src.rate_limiter as rl_mod
    import src.redis_client as redis_mod

    import src.config as config_mod
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


class TestStreamingSupport:
    """Tests for the streaming code path."""

    def test_stream_true_returns_streaming_response(self, tmp_path, monkeypatch):
        """
        BUG PROBE: stream=True should return a StreamingResponse with
        media_type="text/event-stream".
        """
        app = _setup_app(tmp_path, monkeypatch)

        # Mock the httpx AsyncClient.stream to return a mock response
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.is_success = True

        async def mock_aiter_bytes():
            yield b'data: {"choices": [{"delta": {"content": "Hello"}}]}\n\n'
            yield b'data: [DONE]\n\n'

        mock_response.aiter_bytes = mock_aiter_bytes

        mock_stream_context = MagicMock()
        mock_stream_context.__aenter__ = AsyncMock(return_value=mock_response)
        mock_stream_context.__aexit__ = AsyncMock(return_value=False)

        mock_client = MagicMock()
        mock_client.stream = MagicMock(return_value=mock_stream_context)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with patch("httpx.AsyncClient", return_value=mock_client):
                    with TestClient(app) as client:
                        response = client.post(
                            "/v1/chat/completions",
                            json={
                                "model": "openrouter",
                                "messages": [{"role": "user", "content": "hi"}],
                                "stream": True,
                            },
                        )
                        assert response.status_code == 200
                        assert "text/event-stream" in response.headers.get("content-type", "")

    def test_stream_false_returns_json(self, tmp_path, monkeypatch):
        """
        BUG PROBE: stream=False should return a JSONResponse.
        """
        app = _setup_app(tmp_path, monkeypatch)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.is_success = True
        mock_response.json.return_value = {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 1234567890,
            "model": "test-model",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hello!"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }

        mock_client = MagicMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with patch("httpx.AsyncClient", return_value=mock_client):
                    with TestClient(app) as client:
                        response = client.post(
                            "/v1/chat/completions",
                            json={
                                "model": "openrouter",
                                "messages": [{"role": "user", "content": "hi"}],
                                "stream": False,
                            },
                        )
                        assert response.status_code == 200
                        data = response.json()
                        assert data["object"] == "chat.completion"
                        assert data["choices"][0]["message"]["content"] == "Hello!"

    def test_stream_default_is_false(self, tmp_path, monkeypatch):
        """
        BUG PROBE: When stream is not specified, should default to False (non-streaming).
        """
        app = _setup_app(tmp_path, monkeypatch)

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.is_success = True
        mock_response.json.return_value = {
            "id": "chatcmpl-test",
            "object": "chat.completion",
            "created": 1234567890,
            "model": "test-model",
            "choices": [
                {
                    "index": 0,
                    "message": {"role": "assistant", "content": "Hi!"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
        }

        mock_client = MagicMock()
        mock_client.post = AsyncMock(return_value=mock_response)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with patch("httpx.AsyncClient", return_value=mock_client):
                    with TestClient(app) as client:
                        response = client.post(
                            "/v1/chat/completions",
                            json={
                                "model": "openrouter",
                                "messages": [{"role": "user", "content": "hi"}],
                                # No stream field — should default to False
                            },
                        )
                        assert response.status_code == 200
                        # Should be JSON, not SSE
                        assert "text/event-stream" not in response.headers.get("content-type", "")

    def test_stream_with_upstream_error(self, tmp_path, monkeypatch):
        """
        BUG PROBE: When upstream returns 429/500 during stream,
        the error should be yielded as SSE data, not crash.
        """
        app = _setup_app(tmp_path, monkeypatch)

        mock_response = MagicMock()
        mock_response.status_code = 429
        mock_response.is_success = False
        mock_response.text = "Rate limited"

        mock_stream_context = MagicMock()
        mock_stream_context.__aenter__ = AsyncMock(return_value=mock_response)
        mock_stream_context.__aexit__ = AsyncMock(return_value=False)

        mock_client = MagicMock()
        mock_client.stream = MagicMock(return_value=mock_stream_context)
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with patch("httpx.AsyncClient", return_value=mock_client):
                    with TestClient(app) as client:
                        response = client.post(
                            "/v1/chat/completions",
                            json={
                                "model": "openrouter",
                                "messages": [{"role": "user", "content": "hi"}],
                                "stream": True,
                            },
                        )
                        assert response.status_code == 200
                        # The response should contain error data as SSE
                        content = response.content.decode()
                        assert "error" in content or "upstream_error" in content

    def test_stream_with_timeout(self, tmp_path, monkeypatch):
        """
        BUG PROBE: When upstream times out during stream,
        the error handling should yield an SSE error, not crash.
        """
        app = _setup_app(tmp_path, monkeypatch)

        mock_client = MagicMock()

        async def mock_stream(*args, **kwargs):
            raise httpx.TimeoutException("Connection timed out")

        mock_client.stream = MagicMock(side_effect=httpx.TimeoutException("timeout"))
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with patch("httpx.AsyncClient", return_value=mock_client):
                    with TestClient(app) as client:
                        # The stream generator catches TimeoutException internally
                        response = client.post(
                            "/v1/chat/completions",
                            json={
                                "model": "openrouter",
                                "messages": [{"role": "user", "content": "hi"}],
                                "stream": True,
                            },
                        )
                        # Should still return 200 (the error is in the stream body)
                        assert response.status_code == 200

    def test_stream_model_prefix_stripped(self, tmp_path, monkeypatch):
        """
        BUG PROBE: Model prefix should be stripped before sending upstream
        even when streaming.
        """
        app = _setup_app(tmp_path, monkeypatch)

        # Track what URL and payload were sent
        captured_payload = {}

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.is_success = True

        async def mock_aiter_bytes():
            yield b'data: [DONE]\n\n'

        mock_response.aiter_bytes = mock_aiter_bytes

        mock_stream_context = MagicMock()
        mock_stream_context.__aenter__ = AsyncMock(return_value=mock_response)
        mock_stream_context.__aexit__ = AsyncMock(return_value=False)

        mock_client = MagicMock()

        def capture_stream(method, url, json=None, **kwargs):
            captured_payload["json"] = json
            return mock_stream_context

        mock_client.stream = capture_stream
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with patch("httpx.AsyncClient", return_value=mock_client):
                    with TestClient(app) as client:
                        response = client.post(
                            "/v1/chat/completions",
                            json={
                                "model": "openrouter/owl-alpha",
                                "messages": [{"role": "user", "content": "hi"}],
                                "stream": True,
                            },
                        )
                        assert response.status_code == 200
                        # Provider prefix is stripped before forwarding upstream
                        # per commit 0a7f621 (strip_prefix behavior is intentional).
                        assert captured_payload["json"]["model"] == "owl-alpha"

    def test_stream_with_connection_error(self, tmp_path, monkeypatch):
        """
        BUG PROBE: Connection error during stream should yield SSE error.
        """
        app = _setup_app(tmp_path, monkeypatch)

        mock_client = MagicMock()
        mock_client.stream = MagicMock(
            side_effect=httpx.ConnectError("Connection refused")
        )
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)

        with patch("src.redis_client.get_redis_client", return_value=None):
            with patch("src.redis_client.redis_available", return_value=False):
                with patch("httpx.AsyncClient", return_value=mock_client):
                    with TestClient(app) as client:
                        response = client.post(
                            "/v1/chat/completions",
                            json={
                                "model": "openrouter",
                                "messages": [{"role": "user", "content": "hi"}],
                                "stream": True,
                            },
                        )
                        assert response.status_code == 200
                        content = response.content.decode()
                        assert "error" in content or "connection" in content.lower()
