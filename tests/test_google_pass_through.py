import httpx
import pytest
from httpx import ASGITransport, AsyncClient

from src.config import get_config
from src.main import app, router


@pytest.mark.anyio
async def test_google_pass_through_endpoint(monkeypatch):
    # Disable Redis/Valkey router state for this test instance to avoid local redis pollution
    monkeypatch.setattr(router, "_is_redis", lambda: False)
    
    # Clear in-memory router states to avoid persistent cooldowns/quarantines from previous test runs
    import src.router as router_mod
    router_mod._mem_cooldowns.clear()
    router_mod._mem_quarantine.clear()
    
    # Setup mock provider in config
    config = get_config()
    # Add dummy provider config for google
    config.providers["google"] = type("ProviderConfigMock", (), {
        "base_url": "https://generativelanguage.googleapis.com",
        "api_keys": ["AIzaSyMockKey1234567890"],
        "min_delay_ms": 0,
        "extra_params": {"key_as_query_param": "True"},
        "allowed_models": []
    })()
    # Set auth_key to None or mock value for test predictability
    monkeypatch.setattr(config, "auth_key", "test_auth_key")
    
    mock_called = False
    original_send = httpx.AsyncClient.send

    async def mock_send(self, request, *args, **kwargs):
        url_str = str(request.url)
        print(f"DEBUG: mock_send URL: {url_str}")
        if "generativelanguage.googleapis.com" in url_str:
            nonlocal mock_called
            mock_called = True
            assert "key=AIzaSyMockKey1234567890" in url_str
            assert "models/gemma-4-26-a4b-it:generateContent" in url_str or "models/gemma-4-26-a4b-it:streamGenerateContent" in url_str
            assert "/v1beta/" in url_str or "/v1/" in url_str
            content = b'{"candidates": [{"content": {"parts": [{"text": "Hello world"}]}}]}'
            return httpx.Response(200, content=content, request=request)
        return await original_send(self, request, *args, **kwargs)

    monkeypatch.setattr(httpx.AsyncClient, "send", mock_send)


    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Test 1: Standard /v1beta/models/google/...
        resp = await ac.post(
            "/v1beta/models/google/gemma-4-26-a4b-it:generateContent",
            json={"contents": [{"parts": [{"text": "Hi"}]}]},
            headers={"x-goog-api-key": "test_auth_key"}
        )
        assert resp.status_code == 200
        assert resp.json()["candidates"][0]["content"]["parts"][0]["text"] == "Hello world"
        assert mock_called

        # Test 2: Singular /v1/google/model/... and percent-encoded %3A
        mock_called = False
        resp = await ac.post(
            "/v1/google/model/gemma-4-26-a4b-it%3AstreamGenerateContent",
            json={"contents": [{"parts": [{"text": "Hi"}]}]},
            headers={"x-goog-api-key": "test_auth_key"}
        )
        assert resp.status_code == 200
        assert mock_called

        # Test 3 removed as freetier fallback is deprecated.
        pass

