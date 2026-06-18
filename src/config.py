"""
config.py — Environment-based configuration loader for LiteRouter.

Three routing pathways (set in .env):
  LITEROUTER_TEMPLATE + LITEROUTER_PROVIDER
  ─────────────────────────────────────────
  anthropic + anthropic  → Native Anthropic SDK → api.anthropic.com
  anthropic + openrouter → Anthropic format → OpenRouter /messages
  openai    + openrouter → OpenAI format → OpenRouter /chat/completions
"""

import logging
from typing import Any, Optional

from dotenv import load_dotenv
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

load_dotenv()

logger = logging.getLogger(__name__)

VALID_TEMPLATES = ("openai", "anthropic")
VALID_PROVIDERS = ("openrouter", "anthropic")


# ── Models ─────────────────────────────────────────────────────────────────────


class ProviderConfig(BaseModel):
    base_url: str
    api_keys: list[str]
    model: str = ""
    temperature: float = 0.0
    min_delay_ms: int = 2000
    extra_params: dict[str, Any] = Field(default_factory=dict)


class LiteRouterConfig(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="LITEROUTER_", env_file=".env", extra="allow")

    host: str = "0.0.0.0"
    port: int = 7766
    auth_key: Optional[str] = None
    rotate_delay_ms: int = 2000
    template: str = "openai"
    provider: str = "openrouter"

    providers: dict[str, ProviderConfig] = Field(default_factory=dict)
    model_params: dict[str, dict[str, Any]] = Field(default_factory=dict)
    provider_min_delays: dict[str, int] = Field(default_factory=dict)

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._validate_routing()
        self._scan_providers()

    def _validate_routing(self) -> None:
        """Validate the template+provider combination."""
        if self.template not in VALID_TEMPLATES:
            logger.warning(
                "[Config] Invalid template '%s', falling back to 'openai'. Valid: %s",
                self.template, VALID_TEMPLATES,
            )
            self.template = "openai"
        if self.provider not in VALID_PROVIDERS:
            logger.warning(
                "[Config] Invalid provider '%s', falling back to 'openrouter'. Valid: %s",
                self.provider, VALID_PROVIDERS,
            )
            self.provider = "openrouter"
        if self.template == "anthropic" and self.provider == "openrouter":
            logger.info("[Config] Pathway: anthropic template → OpenRouter /messages")
        elif self.template == "anthropic" and self.provider == "anthropic":
            logger.info("[Config] Pathway: anthropic template → Native Anthropic API")
        elif self.template == "openai" and self.provider == "openrouter":
            logger.info("[Config] Pathway: OpenAI template → OpenRouter /chat/completions")

    def _scan_providers(self) -> None:
        """Scan os.environ for *_BASE_URL vars and build provider configs."""
        import os

        # Handle provider inheritance (e.g., MINIMAXAI_INHERITS=NVIDIA)
        for env_key, env_val in list(os.environ.items()):
            if env_key.endswith("_INHERITS"):
                prefix = env_key.replace("_INHERITS", "")
                parent = env_val.strip()
                if f"{prefix}_BASE_URL" not in os.environ and f"{parent}_BASE_URL" in os.environ:
                    os.environ[f"{prefix}_BASE_URL"] = os.environ[f"{parent}_BASE_URL"]
                if f"{prefix}_API_KEYS" not in os.environ and f"{parent}_API_KEYS" in os.environ:
                    os.environ[f"{prefix}_API_KEYS"] = os.environ[f"{parent}_API_KEYS"]

        for env_key in [k for k in os.environ if k.endswith("_BASE_URL")]:
            prefix = env_key.replace("_BASE_URL", "")
            provider_name = prefix.lower()
            base_url = os.environ.get(env_key, "").rstrip("/")
            api_keys = [
                k.strip()
                for k in os.environ.get(f"{prefix}_API_KEYS", "").split(",")
                if k.strip()
            ]

            if not base_url:
                logger.warning("[Config] %s is empty, skipping '%s'", env_key, provider_name)
                continue
            if not api_keys:
                logger.warning(
                    "[Config] %s_API_KEYS empty for '%s' — skipping",
                    prefix, provider_name,
                )
                continue

            min_delay = int(os.environ.get(f"{prefix}_MIN_DELAY_MS", "0")) or None
            model = os.environ.get(f"{prefix}_MODEL", "")
            temperature = float(os.environ.get(f"{prefix}_TEMPERATURE", "0.0"))

            extra: dict[str, Any] = {}
            skip = {"BASE_URL", "API_KEYS", "API_KEY", "MIN_DELAY_MS", "MODEL", "TEMPERATURE"}
            for k, v in os.environ.items():
                if k.startswith(f"{prefix}_") and k.replace(f"{prefix}_", "") not in skip:
                    extra[k.replace(f"{prefix}_", "").lower()] = v

            self.providers[provider_name] = ProviderConfig(
                base_url=base_url,
                api_keys=api_keys,
                model=model,
                temperature=temperature,
                min_delay_ms=min_delay if min_delay else self.rotate_delay_ms,
                extra_params=extra,
            )
            self.provider_min_delays[provider_name] = (
                min_delay if min_delay else self.rotate_delay_ms
            )
            if model:
                params: dict[str, Any] = {"model": model, "temperature": temperature}
                params.update(extra)
                self.model_params[provider_name] = params

        if not self.providers:
            logger.warning("[Config] No providers defined in environment variables")


# ── Singleton ──────────────────────────────────────────────────────────────────

_cached_config: Optional[LiteRouterConfig] = None


def get_config() -> LiteRouterConfig:
    global _cached_config
    if _cached_config is None:
        _cached_config = LiteRouterConfig()
    return _cached_config


# ── Helpers ────────────────────────────────────────────────────────────────────


def is_gemini_provider(provider: ProviderConfig) -> bool:
    return "generativelanguage.googleapis.com" in provider.base_url


def is_anthropic_provider(provider: ProviderConfig) -> bool:
    return "api.anthropic.com" in provider.base_url


def is_openrouter_provider(provider: ProviderConfig) -> bool:
    return "openrouter.ai" in provider.base_url


def is_anthropic_model(model: str | None) -> bool:
    """Return True if the model identifier indicates an Anthropic model."""
    if not model:
        return False
    model_lower = model.lower()
    return (
        model_lower.startswith("anthropic/")
        or model_lower.startswith("claude-")
        or "claude" in model_lower
    )
