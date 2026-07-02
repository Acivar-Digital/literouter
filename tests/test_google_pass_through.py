import pytest
from httpx import AsyncClient, ASGITransport
import httpx
from src.main import app
from src.config import get_config

@pytest.mark.anyio
async def test_google_pass_through_endpoint(monkeypatch):
    # Setup mock provider in config
    config = get_config()
    # Add dummy provider config for google
    config.providers["google"] = type("ProviderConfigMock", (), {
        "base_url": "https://generativelanguage.googleapis.com",
        "api_keys": ["AIzaSyMockKey1234567890"],
        "min_delay_ms": 0,
        "extra_params": {},
        "allowed_models": []
    })()
    # Set auth_key to None or mock value for test predictability
    monkeypatch.setattr(config, "auth_key", "test_auth_key")
    
    mock_called = False
    original_post = httpx.AsyncClient.post
    
    async def mock_post(self, url, **kwargs):
        nonlocal mock_called
        if "generativelanguage.googleapis.com" in str(url):
            mock_called = True
            assert "key=AIzaSyMockKey1234567890" in str(url)
            assert "models/gemma-4-26-a4b-it:generateContent" in str(url)
            assert "/v1beta/" in str(url) or "/v1/" in str(url)
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": "Hello world"}]}}]}, request=httpx.Request("POST", url))
        return await original_post(self, url, **kwargs)
        
    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        # Test with /v1beta/ prefix
        resp = await ac.post(
            "/v1beta/models/google/gemma-4-26-a4b-it:generateContent",
            json={"contents": [{"parts": [{"text": "Hi"}]}]},
            headers={"x-goog-api-key": "test_auth_key"}
        )
        assert resp.status_code == 200
        assert resp.json()["candidates"][0]["content"]["parts"][0]["text"] == "Hello world"
        assert mock_called

        # Reset and test with /v1/v1beta/ prefix
        mock_called = False
        resp = await ac.post(
            "/v1/v1beta/models/google/gemma-4-26-a4b-it:generateContent",
            json={"contents": [{"parts": [{"text": "Hi"}]}]},
            headers={"x-goog-api-key": "test_auth_key"}
        )
        assert resp.status_code == 200
        assert resp.json()["candidates"][0]["content"]["parts"][0]["text"] == "Hello world"
        assert mock_called
