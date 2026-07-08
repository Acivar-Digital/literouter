"""
Configuration & Model Limits Definitions
"""

import json
import logging
import os
from pathlib import Path

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
REDIS_DB = int(os.getenv("REDIS_DB", "0"))
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

# Provider → API URL mapping (single source for both proxies)
PROVIDER_API_URLS = {
    "nvidia": "https://integrate.api.nvidia.com/v1/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
    "google": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "zen": "{ZEN_BASE_URL}/chat/completions",
}

# Backward-compatible aliases for model IDs that changed in models.json
_OLD_MODEL_ALIASES = {
    "freetier/gemma-4-31b-it": "google/gemma-4-31b-it",
    "gemma-4-31b-it": "google/gemma-4-31b-it",
    "freetier/gemma-4-26b-a4b-it": "google/gemma-4-26b-a4b-it",
    "gemma-4-26b-a4b-it": "google/gemma-4-26b-a4b-it",
    "gemini-3.1-flash-lite": "google/gemini-3.1-flash-lite",
}


def _load_model_registry() -> dict:
    """Load models.json and build MODEL_REGISTRY dict.

    Reads the shared models.json (single source of truth used by both
    TS and Python proxies), translates array entries into the dict format
    expected by main.py, and registers backward aliases.
    """
    models_path = Path(__file__).resolve().parent.parent / "models.json"

    if not models_path.exists():
        logger.error(f"models.json not found at {models_path}")
        raise FileNotFoundError(f"models.json not found at {models_path}")

    with open(models_path) as f:
        models_list = json.load(f)

    registry: dict[str, dict] = {}

    for m in models_list:
        provider = m.get("provider", "").lower()
        system_id = m.get("system_id", "")
        upstream_id = m.get("upstream_id", "")

        if not provider or not system_id or not upstream_id:
            logger.warning(f"Skipping invalid model entry: {m}")
            continue

        api_url = PROVIDER_API_URLS.get(provider)
        if not api_url:
            logger.info(f"Skipping model {system_id}: unknown provider '{provider}'")
            continue

        registry[system_id] = {
            "provider": provider,
            "upstream_model": upstream_id,
            "api_url": api_url,
        }

    # Register backward-compatible aliases
    alias_count = 0
    for alias, target in _OLD_MODEL_ALIASES.items():
        if alias not in registry and target in registry:
            registry[alias] = registry[target]
            alias_count += 1

    if not registry:
        raise RuntimeError("Model registry is empty — no usable models found in models.json")

    n_canonical = len(registry) - alias_count
    logger.info(
        f"Loaded {len(registry)} model entries from models.json "
        f"({n_canonical} canonical + {alias_count} backward aliases)"
    )

    return registry


# Model Routing Registry Map
# Maps client model ID to its provider, upstream model name, and target API endpoint URL.
MODEL_REGISTRY = _load_model_registry()

