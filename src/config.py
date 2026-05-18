"""
config.py — Environment-based configuration loader for LiteRouter.

Uses Pydantic Settings to load from .env. Supports multiple providers
via dynamic env var parsing (e.g. OPENROUTER_BASE_URL, OPENROUTER_API_KEYS).
"""

import logging
from typing import Any, Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()

logger = logging.getLogger(__name__)


# ── Models ─────────────────────────────────────────────────────────────────────


class ProviderConfig(BaseModel):
    """Configuration for a single API provider."""

    base_url: str
    api_keys: list[str]
    model: str = ""
    temperature: float = 0.0
    min_delay_ms: int = 2000
    extra_params: dict[str, Any] = Field(default_factory=dict)


class ServerConfig(BaseModel):
    """Server-level configuration."""

    host: str = "0.0.0.0"
    port: int = 7766
    auth_key: Optional[str] = None
    rotate_delay_ms: int = 2000


class LiteRouterConfig(BaseSettings):
    """Top-level LiteRouter configuration loaded from environment variables.

    Provider definitions are discovered dynamically by scanning env vars
    that end with _BASE_URL. Companion vars (_API_KEYS, _MODEL, _TEMPERATURE,
    _MIN_DELAY_MS, and any other _*) are grouped under the same provider name.
    """

    model_config = SettingsConfigDict(env_prefix="LITEROUTER_", env_file=".env", extra="allow")

    host: str = "0.0.0.0"
    port: int = 7766
    auth_key: Optional[str] = None
    rotate_delay_ms: int = 2000

    # Populated at init time from env scanning
    providers: dict[str, ProviderConfig] = Field(default_factory=dict)
    model_params: dict[str, dict[str, Any]] = Field(default_factory=dict)
    provider_min_delays: dict[str, int] = Field(default_factory=dict)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._scan_providers()

    def _scan_providers(self) -> None:
        """Scan os.environ for *_BASE_URL vars and build provider configs."""
        import os

        base_url_keys = [k for k in os.environ if k.endswith("_BASE_URL")]

        for env_key in base_url_keys:
            prefix = env_key.replace("_BASE_URL", "")
            provider_name = prefix.lower()

            base_url = os.environ.get(env_key, "").rstrip("/")
            api_keys_raw = os.environ.get(f"{prefix}_API_KEYS", "")
            api_keys = [k.strip() for k in api_keys_raw.split(",") if k.strip()]

            if not base_url:
                logger.warning(f"[Config] {env_key} is empty, skipping provider '{provider_name}'")
                continue
            if not api_keys:
                logger.warning(
                    f"[Config] {prefix}_API_KEYS is empty "
                    f"for provider '{provider_name}'"
                )

            min_delay = int(os.environ.get(f"{prefix}_MIN_DELAY_MS", "0")) or None
            model = os.environ.get(f"{prefix}_MODEL", "")
            temperature = float(os.environ.get(f"{prefix}_TEMPERATURE", "0.0"))

            extra: dict[str, Any] = {}
            skip = {"BASE_URL", "API_KEYS", "MIN_DELAY_MS", "MODEL", "TEMPERATURE"}
            for k, v in os.environ.items():
                if k.startswith(f"{prefix}_") and k.replace(f"{prefix}_", "") not in skip:
                    extra_key = k.replace(f"{prefix}_", "").lower()
                    extra[extra_key] = v

            provider = ProviderConfig(
                base_url=base_url,
                api_keys=api_keys,
                model=model,
                temperature=temperature,
                min_delay_ms=min_delay if min_delay else self.rotate_delay_ms,
                extra_params=extra,
            )
            self.providers[provider_name] = provider

            if min_delay:
                self.provider_min_delays[provider_name] = min_delay
            else:
                self.provider_min_delays[provider_name] = self.rotate_delay_ms

            if model:
                params: dict[str, Any] = {"model": model, "temperature": temperature}
                params.update(extra)
                self.model_params[provider_name] = params

        if not self.providers:
            logger.warning("[Config] No providers defined in environment variables")


# ── Singleton ──────────────────────────────────────────────────────────────────

_cached_config: Optional[LiteRouterConfig] = None


def get_config() -> LiteRouterConfig:
    """Return a cached LiteRouterConfig instance.

    Loads from .env on first call and reuses the instance thereafter.
    """
    global _cached_config
    if _cached_config is None:
        _cached_config = LiteRouterConfig()
    return _cached_config


# ── Helpers ────────────────────────────────────────────────────────────────────


def is_gemini_provider(provider: ProviderConfig) -> bool:
    """Return True if the provider's base_url targets the Gemini API."""
    return "generativelanguage.googleapis.com" in provider.base_url


def is_anthropic_model(model: str) -> bool:
    """Return True if the model identifier indicates an Anthropic model.

    Checks if the model name starts with 'anthropic/' or if the
    provider prefix resolves to an Anthropic endpoint.
    """
    if not model:
        return False
    model_lower = model.lower()
    return (
        model_lower.startswith("anthropic/")
        or model_lower.startswith("claude-")
        or "claude" in model_lower
    )


def is_openrouter_provider(provider: ProviderConfig) -> bool:
    """Return True if the provider's base_url targets OpenRouter."""
    return "openrouter.ai" in provider.base_url
