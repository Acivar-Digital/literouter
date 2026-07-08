"""
Live API Key Validation Probe Gate (Gate 2)
"""

import argparse
import asyncio
import logging
import os
import sys

import httpx

# Ensure the root directory is in sys.path when executed directly
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from src.config import GOOGLE_API_KEYS, NVIDIA_API_KEYS, OPENROUTER_API_KEYS, ZEN_API_KEYS

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("doctor")

async def probe_google_key(key: str) -> bool:
    """
    Verifies viability of Google keys using minimal native execution request parameters.
    Setting maxOutputTokens to 100 prevents backend engine crashes on reasoning pipelines.
    Using gemini-3.1-flash-lite since it is universally available on these keys under v1beta.
    """
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key={key}"
    payload = {
        "contents": [{"parts": [{"text": "ping"}]}],
        "generationConfig": {
            "maxOutputTokens": 100
        }
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(url, json=payload)
            if resp.status_code == 200:
                logger.info(f"[GOOGLE] Key '{key[:6]}...{key[-4:]}' is healthy (200 OK).")
                return True
            elif resp.status_code in (401, 403):
                logger.error(f"[GOOGLE] Key '{key[:6]}...{key[-4:]}' failed Gate 2 with status {resp.status_code} (UNAUTHORIZED).")
                return False
            elif resp.status_code == 429:
                logger.warning(f"[GOOGLE] Key '{key[:6]}...{key[-4:]}' is rate-limited (429) but validated as operational.")
                return True
            else:
                logger.warning(f"[GOOGLE] Key '{key[:6]}...{key[-4:]}' warning status {resp.status_code}: {resp.text[:100]}")
                return True
        except httpx.RequestError as exc:
            logger.warning(f"[GOOGLE] Connection error for key '{key[:6]}...{key[-4:]}': {exc}. Treating as warnings.")
            return True

async def probe_nvidia_key(key: str) -> bool:
    """
    Verifies viability of NVIDIA keys.
    """
    url = "https://integrate.api.nvidia.com/v1/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": "meta/llama-3.1-8b-instruct",
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 100
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                logger.info(f"[NVIDIA] Key '{key[:6]}...{key[-4:]}' is healthy (200 OK).")
                return True
            elif resp.status_code in (401, 403):
                logger.error(f"[NVIDIA] Key '{key[:6]}...{key[-4:]}' failed Gate 2 with status {resp.status_code} (UNAUTHORIZED).")
                return False
            elif resp.status_code == 429:
                logger.warning(f"[NVIDIA] Key '{key[:6]}...{key[-4:]}' is rate-limited (429) but validated as operational.")
                return True
            else:
                logger.warning(f"[NVIDIA] Key '{key[:6]}...{key[-4:]}' warning status {resp.status_code}.")
                return True
        except httpx.RequestError as exc:
            logger.warning(f"[NVIDIA] Connection error: {exc}.")
            return True

async def probe_openrouter_key(key: str) -> bool:
    """
    Verifies viability of OpenRouter keys.
    """
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": "nvidia/nemotron-3-nano-30b-a3b:free",
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 100
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                logger.info(f"[OPENROUTER] Key '{key[:6]}...{key[-4:]}' is healthy (200 OK).")
                return True
            elif resp.status_code in (401, 403):
                logger.error(f"[OPENROUTER] Key '{key[:6]}...{key[-4:]}' failed Gate 2 with status {resp.status_code} (UNAUTHORIZED).")
                return False
            elif resp.status_code == 429:
                logger.warning(f"[OPENROUTER] Key '{key[:6]}...{key[-4:]}' is rate-limited (429) but validated as operational.")
                return True
            else:
                logger.warning(f"[OPENROUTER] Key '{key[:6]}...{key[-4:]}' warning status {resp.status_code}.")
                return True
        except httpx.RequestError as exc:
            logger.warning(f"[OPENROUTER] Connection error: {exc}.")
            return True

async def probe_zen_key(key: str) -> bool:
    """
    Verifies viability of Zen keys.
    """
    url = "https://opencode.ai/zen/v1/chat/completions"
    headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    payload = {
        "model": "deepseek-v4-flash-free",
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 100
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        try:
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code == 200:
                logger.info(f"[ZEN] Key '{key[:6]}...{key[-4:]}' is healthy (200 OK).")
                return True
            elif resp.status_code in (401, 403):
                logger.error(f"[ZEN] Key '{key[:6]}...{key[-4:]}' failed Gate 2 with status {resp.status_code} (UNAUTHORIZED).")
                return False
            elif resp.status_code == 429:
                logger.warning(f"[ZEN] Key '{key[:6]}...{key[-4:]}' is rate-limited (429) but validated as operational.")
                return True
            else:
                logger.warning(f"[ZEN] Key '{key[:6]}...{key[-4:]}' warning status {resp.status_code}.")
                return True
        except httpx.RequestError as exc:
            logger.warning(f"[ZEN] Connection error: {exc}.")
            return True

async def run_diagnostics(force: bool) -> None:
    """
    Orchestrates Gate 2 live diagnostic evaluation across active key pools in parallel.
    """
    logger.info("Starting Gate 2 Parallel Live Validation Probes...")

    tasks = []

    for key in GOOGLE_API_KEYS:
        tasks.append(probe_google_key(key))
    for key in NVIDIA_API_KEYS:
        tasks.append(probe_nvidia_key(key))
    for key in OPENROUTER_API_KEYS:
        tasks.append(probe_openrouter_key(key))
    for key in ZEN_API_KEYS:
        tasks.append(probe_zen_key(key))

    if not tasks:
        logger.warning("No active keys configured to execute live diagnostics.")
        return

    results = await asyncio.gather(*tasks)

    failures = results.count(False)
    if failures > 0:
        logger.error(f"Gate 2 Live Validation failed. {failures} key(s) returned fatal authentication failures.")
        if not force:
            logger.critical("Aborting server start up due to key validation failures. Set --force to override.")
            sys.exit(1)
        else:
            logger.warning("Boot validation failures detected, but override option '--force' is set. Proceeding to boot...")
    else:
        logger.info("Gate 2 Diagnostics complete. All keys validated successfully.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="LiteRouter Boot Diagnostics Gate")
    parser.add_argument("--force", action="store_true", help="Bypass validation failures and start gateway anyways")
    args = parser.parse_args()

    asyncio.run(run_diagnostics(args.force))
