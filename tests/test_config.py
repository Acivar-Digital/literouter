"""
Tests for configuration loading and provider detection (src/config.py).

BUG CATEGORY D, G: Tests for provider detection helpers and config loading.
"""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestProviderDetection:
    """Tests for is_anthropic_model, is_openrouter_provider, is_gemini_provider."""

    def test_is_anthropic_model_with_anthropic_prefix(self):
        """'anthropic/claude-sonnet-4.6' should be detected as Anthropic."""
        from src.config import is_anthropic_model
        assert is_anthropic_model("anthropic/claude-sonnet-4.6") is True

    def test_is_anthropic_model_with_claude_prefix(self):
        """'claude-3-opus' should be detected as Anthropic."""
        from src.config import is_anthropic_model
        assert is_anthropic_model("claude-3-opus") is True

    def test_is_anthropic_model_non_anthropic(self):
        """'owl-alpha' should NOT be detected as Anthropic."""
        from src.config import is_anthropic_model
        assert is_anthropic_model("owl-alpha") is False

    def test_is_anthropic_model_empty_string(self):
        """Empty string should return False."""
        from src.config import is_anthropic_model
        assert is_anthropic_model("") is False

    def test_is_anthropic_model_none(self):
        """None should return False (falsy check)."""
        from src.config import is_anthropic_model
        assert is_anthropic_model(None) is False

    def test_is_anthropic_model_case_insensitive(self):
        """'ANTHROPIC/CLAUDE' should be detected (case insensitive)."""
        from src.config import is_anthropic_model
        assert is_anthropic_model("ANTHROPIC/CLAUDE") is True

    def test_is_anthropic_model_contains_claude(self):
        """'openrouter/anthropic/claude' should be detected (contains 'claude')."""
        from src.config import is_anthropic_model
        assert is_anthropic_model("openrouter/anthropic/claude") is True

    def test_is_anthropic_model_partial_match(self):
        """'claudex' contains 'claude' — should this match? Testing the 'in' check."""
        from src.config import is_anthropic_model
        # BUG: "claudex" contains "claude" so it matches. This may be
        # overly broad — a model named "claudex" would be misidentified.
        assert is_anthropic_model("claudex") is True

    def test_is_openrouter_provider(self):
        """Provider with openrouter.ai URL should be detected."""
        from src.config import ProviderConfig, is_openrouter_provider
        provider = ProviderConfig(
            base_url="https://openrouter.ai/api/v1",
            api_keys=["key1"],
        )
        assert is_openrouter_provider(provider) is True

    def test_is_openrouter_provider_other(self):
        """Provider with non-OpenRouter URL should return False."""
        from src.config import ProviderConfig, is_openrouter_provider
        provider = ProviderConfig(
            base_url="https://api.anthropic.com",
            api_keys=["key1"],
        )
        assert is_openrouter_provider(provider) is False

    def test_is_gemini_provider(self):
        """Provider with generativelanguage.googleapis.com should be detected."""
        from src.config import ProviderConfig, is_gemini_provider
        provider = ProviderConfig(
            base_url="https://generativelanguage.googleapis.com/v1beta",
            api_keys=["key1"],
        )
        assert is_gemini_provider(provider) is True

    def test_is_gemini_provider_other(self):
        """Provider with non-Gemini URL should return False."""
        from src.config import ProviderConfig, is_gemini_provider
        provider = ProviderConfig(
            base_url="https://api.openai.com/v1",
            api_keys=["key1"],
        )
        assert is_gemini_provider(provider) is False


class TestConfigLoading:
    """Tests for LiteRouterConfig loading from environment."""

    def test_no_providers_configured(self, monkeypatch, tmp_path):
        """
        BUG PROBE: No providers in environment.
        Config should load without crash, providers dict should be empty.
        """
        # Clear any provider-related env vars
        for key in list(os.environ.keys()):
            if "_BASE_URL" in key:
                monkeypatch.delenv(key, raising=False)
        monkeypatch.chdir(tmp_path)

        from src.config import LiteRouterConfig
        config = LiteRouterConfig()
        assert config.providers == {}

    def test_provider_with_empty_api_keys(self, monkeypatch, tmp_path):
        """
        Verify that provider with empty API keys is skipped.
        """
        monkeypatch.setenv("TEST_BASE_URL", "https://api.test.com")
        monkeypatch.setenv("TEST_API_KEYS", "")
        monkeypatch.chdir(tmp_path)

        from src.config import LiteRouterConfig
        config = LiteRouterConfig()
        assert "test" not in config.providers

    def test_provider_with_whitespace_api_keys(self, monkeypatch, tmp_path):
        """
        Verify that provider with whitespace API keys is skipped.
        """
        monkeypatch.setenv("TEST_BASE_URL", "https://api.test.com")
        monkeypatch.setenv("TEST_API_KEYS", "  ,  ,  ")
        monkeypatch.chdir(tmp_path)

        from src.config import LiteRouterConfig
        config = LiteRouterConfig()
        assert "test" not in config.providers

    def test_model_params_not_set(self, monkeypatch, tmp_path):
        """
        BUG PROBE: Provider without _MODEL env var.
        model_params should not contain an entry for this provider.
        """
        monkeypatch.setenv("TEST_BASE_URL", "https://api.test.com")
        monkeypatch.setenv("TEST_API_KEYS", "key1")
        # No TEST_MODEL set
        monkeypatch.chdir(tmp_path)

        from src.config import LiteRouterConfig
        config = LiteRouterConfig()
        assert "test" not in config.model_params

    def test_extra_env_vars_captured(self, monkeypatch, tmp_path):
        """
        BUG PROBE: Extra env vars beyond standard ones.
        Should be captured in extra_params dict.
        """
        monkeypatch.setenv("TEST_BASE_URL", "https://api.test.com")
        monkeypatch.setenv("TEST_API_KEYS", "key1")
        monkeypatch.setenv("TEST_CUSTOM_PARAM", "custom_value")
        monkeypatch.setenv("TEST_ANOTHER", "another_value")
        monkeypatch.chdir(tmp_path)

        from src.config import LiteRouterConfig
        config = LiteRouterConfig()
        assert "test" in config.providers
        assert config.providers["test"].extra_params.get("custom_param") == "custom_value"
        assert config.providers["test"].extra_params.get("another") == "another_value"

    def test_min_delay_default(self, monkeypatch, tmp_path):
        """
        BUG PROBE: Provider without _MIN_DELAY_MS.
        Should fall back to rotate_delay_ms (default 2000).
        """
        monkeypatch.setenv("TEST_BASE_URL", "https://api.test.com")
        monkeypatch.setenv("TEST_API_KEYS", "key1")
        monkeypatch.chdir(tmp_path)

        from src.config import LiteRouterConfig
        config = LiteRouterConfig()
        assert config.provider_min_delays["test"] == 2000

    def test_min_delay_custom(self, monkeypatch, tmp_path):
        """
        BUG PROBE: Provider with custom _MIN_DELAY_MS.
        """
        monkeypatch.setenv("TEST_BASE_URL", "https://api.test.com")
        monkeypatch.setenv("TEST_API_KEYS", "key1")
        monkeypatch.setenv("TEST_MIN_DELAY_MS", "5000")
        monkeypatch.chdir(tmp_path)

        from src.config import LiteRouterConfig
        config = LiteRouterConfig()
        assert config.provider_min_delays["test"] == 5000

    def test_min_delay_zero_falls_back(self, monkeypatch, tmp_path):
        """
        BUG PROBE: _MIN_DELAY_MS=0 should fall back to default.
        The code does `int(...) or None`, so 0 becomes None.
        """
        monkeypatch.setenv("TEST_BASE_URL", "https://api.test.com")
        monkeypatch.setenv("TEST_API_KEYS", "key1")
        monkeypatch.setenv("TEST_MIN_DELAY_MS", "0")
        monkeypatch.chdir(tmp_path)

        from src.config import LiteRouterConfig
        config = LiteRouterConfig()
        # 0 or None => None, then falls back to rotate_delay_ms
        assert config.provider_min_delays["test"] == 2000

    def test_multiple_providers(self, monkeypatch, tmp_path):
        """
        BUG PROBE: Multiple providers configured simultaneously.
        """
        monkeypatch.setenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
        monkeypatch.setenv("OPENROUTER_API_KEYS", "or-key1")
        monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://api.anthropic.com")
        monkeypatch.setenv("ANTHROPIC_API_KEYS", "ant-key1")
        monkeypatch.chdir(tmp_path)

        from src.config import LiteRouterConfig
        config = LiteRouterConfig()
        assert "openrouter" in config.providers
        assert "anthropic" in config.providers
        assert len(config.providers) == 2

    def test_base_url_trailing_slash_stripped(self, monkeypatch, tmp_path):
        """
        BUG PROBE: Base URL with trailing slash should be stripped.
        """
        monkeypatch.setenv("TEST_BASE_URL", "https://api.test.com/")
        monkeypatch.setenv("TEST_API_KEYS", "key1")
        monkeypatch.chdir(tmp_path)

        from src.config import LiteRouterConfig
        config = LiteRouterConfig()
        assert config.providers["test"].base_url == "https://api.test.com"

    def test_empty_base_url_skips_provider(self, monkeypatch, tmp_path):
        """
        BUG PROBE: Provider with empty BASE_URL should be skipped.
        """
        monkeypatch.setenv("TEST_BASE_URL", "")
        monkeypatch.setenv("TEST_API_KEYS", "key1")
        monkeypatch.chdir(tmp_path)

        from src.config import LiteRouterConfig
        config = LiteRouterConfig()
        assert "test" not in config.providers
