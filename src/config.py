"""
Configuration & Model Limits Definitions
"""

import logging
import os

from dotenv import load_dotenv

# Setup basic logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("config")

load_dotenv()

LITEROUTER_HOST = os.getenv("LITEROUTER_HOST", "0.0.0.0")
LITEROUTER_PORT = int(os.getenv("LITEROUTER_PORT", "7766"))
LITEROUTER_AUTH_KEY = os.getenv("LITEROUTER_AUTH_KEY", "")
LITEROUTER_COLLAPSE_REASONING = os.getenv("LITEROUTER_COLLAPSE_REASONING", "false").lower() == "true"

REDIS_HOST = os.getenv("REDIS_HOST", "localhost")
REDIS_PORT = int(os.getenv("REDIS_PORT", "6379"))
REDIS_PASSWORD = os.getenv("REDIS_PASSWORD", None)

# Model Limits Database
MODEL_LIMITS = {
    "google/gemini-3.1-flash-lite": {
        "max_tpm": 250000,
        "max_rpm": 15,
        "context_window": 250000
    },
    "google/gemma": {
        "max_tpm": 100000000,  # No TPM limit (effectively unlimited)
        "max_rpm": 15,         # 15 RPM limit per key
        "context_window": 250000
    }
}

PROVIDER_LIMITS = {
    "nvidia": {
        "max_tpm": 1000000,
        "max_rpm": 40,
        "context_window": 1000000
    },
    "openrouter": {
        "max_tpm": 1000000,
        "max_rpm": 20,
        "context_window": 1000000
    }
}

DEFAULT_LIMITS = {
    "max_tpm": 1000000,
    "max_rpm": 15,
    "context_window": 1000000
}

def get_model_limits(model_name: str, provider: str = None) -> dict:
    """
    Retrieve model limit thresholds via provider prefix matching first,
    then fallback to provider limits.
    """
    if provider:
        provider_lower = provider.lower()
        for key, limits in MODEL_LIMITS.items():
            if "/" in key:
                key_prov, key_model = key.split("/", 1)
                if key_prov == provider_lower and key_model in model_name:
                    return limits

        if provider_lower in PROVIDER_LIMITS:
            return PROVIDER_LIMITS[provider_lower]

    # Backward compatibility / legacy matching (keys without a provider prefix)
    for key, limits in MODEL_LIMITS.items():
        if "/" not in key and key in model_name:
            return limits

    return DEFAULT_LIMITS

def static_validate_keys(provider: str, keys_str: str) -> list[str]:
    """
    Gate 1: Static Validator.
    Screens out placeholder and invalid credentials at initialization time.
    """
    if not keys_str:
        return []

    raw_keys = [k.strip() for k in keys_str.split(",") if k.strip()]
    valid_keys = []

    placeholders = ["changeme", "placeholder", "your_key", "todo", "xxxx"]

    for key in raw_keys:
        lower_key = key.lower()
        is_placeholder = any(p in lower_key for p in placeholders)
        has_angle_brackets = "<" in key or ">" in key
        too_short = len(key) < 30

        if is_placeholder or has_angle_brackets or too_short:
            masked = f"'{key[:6]}...{key[-4:] if len(key) > 10 else ''}'"
            logger.warning(
                f"[{provider}] Gate 1 Static Validator: Discarded placeholder/invalid key: {masked} "
                f"(reason: placeholder={is_placeholder}, brackets={has_angle_brackets}, length={len(key)}<30)"
            )
        else:
            valid_keys.append(key)

    return valid_keys

GOOGLE_API_KEYS = static_validate_keys("GOOGLE", os.getenv("GOOGLE_API_KEYS", ""))
NVIDIA_API_KEYS = static_validate_keys("NVIDIA", os.getenv("NVIDIA_API_KEYS", ""))
OPENROUTER_API_KEYS = static_validate_keys("OPENROUTER", os.getenv("OPENROUTER_API_KEYS", ""))
ZEN_API_KEYS = static_validate_keys("ZEN", os.getenv("ZEN_API_KEYS", ""))
ZEN_BASE_URL = os.getenv("ZEN_BASE_URL", "https://opencode.ai/zen/v1")

# Model Routing Registry Map
# Maps client model ID to its provider, upstream model name, and target API endpoint URL.
MODEL_REGISTRY = {
    # Google / Gemma (using native OpenAI compatibility endpoint)
    "gemma-4-31b-it": {
        "provider": "google",
        "upstream_model": "gemma-4-31b-it",
        "api_url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    },
    "gemma-4-26b-a4b-it": {
        "provider": "google",
        "upstream_model": "gemma-4-26b-a4b-it",
        "api_url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    },
    "gemini-3.1-flash-lite": {
        "provider": "google",
        "upstream_model": "gemini-3.1-flash-lite",
        "api_url": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
    },

    # Nvidia Models
    "nvidia/deepseek-ai/deepseek-v4-flash": {
        "provider": "nvidia",
        "upstream_model": "deepseek-ai/deepseek-v4-flash",
        "api_url": "https://integrate.api.nvidia.com/v1/chat/completions"
    },
    "nvidia/deepseek-ai/deepseek-v4-pro": {
        "provider": "nvidia",
        "upstream_model": "deepseek-ai/deepseek-v4-pro",
        "api_url": "https://integrate.api.nvidia.com/v1/chat/completions"
    },
    "nvidia/qwen/qwen3-next-80b-a3b-instruct": {
        "provider": "nvidia",
        "upstream_model": "qwen/qwen3-next-80b-a3b-instruct",
        "api_url": "https://integrate.api.nvidia.com/v1/chat/completions"
    },

    # Zen Models
    "zen/deepseek-v4-flash-free": {
        "provider": "zen",
        "upstream_model": "deepseek-v4-flash-free",
        "api_url": "{ZEN_BASE_URL}/chat/completions"
    },

    # OpenRouter Models
    "openrouter/nvidia/nemotron-3-nano-30b-a3b:free": {
        "provider": "openrouter",
        "upstream_model": "nvidia/nemotron-3-nano-30b-a3b:free",
        "api_url": "https://openrouter.ai/api/v1/chat/completions"
    }
}

