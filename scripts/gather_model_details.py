import asyncio
import json
import os
import logging
from pathlib import Path
import httpx
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("gather_details")

load_dotenv()

# Config
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "")
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "")
MODELS_JSON = Path(__file__).resolve().parent.parent / "models.json"
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"

async def fetch_openrouter_details(client, model_id):
    """Fetch detailed info for a specific OpenRouter model (Public Endpoint)."""
    # Strip 'openrouter/' prefix for the API call
    api_id = model_id.replace("openrouter/", "", 1)
    url = f"https://openrouter.ai/api/v1/model/{api_id}"
    # OpenRouter model info is public; no auth required
    try:
        resp = await client.get(url, timeout=10.0)
        if resp.status_code == 200:
            return resp.json().get("data", {})
    except Exception as e:
        logger.error(f"Error fetching OpenRouter details for {model_id}: {e}")
    return {}

async def fetch_nvidia_models(client):
    """Fetch all available models from NVIDIA."""
    url = "https://integrate.api.nvidia.com/v1/models"
    headers = {}
    if NVIDIA_API_KEY:
        headers["Authorization"] = f"Bearer {NVIDIA_API_KEY}"
    
    try:
        resp = await client.get(url, headers=headers, timeout=10.0)
        if resp.status_code == 200:
            return resp.json().get("data", [])
    except Exception as e:
        logger.error(f"Error fetching NVIDIA models: {e}")
    return []

async def main():
    if not MODELS_JSON.exists():
        logger.error(f"models.json not found at {MODELS_JSON}")
        return

    with open(MODELS_JSON) as f:
        registry = json.load(f)

    # Build lookup: provider -> set of upstream_ids we care about
    known_ids = {}
    for m in registry:
        pid = m["upstream_id"]
        known_ids.setdefault(m["provider"], set()).add(pid)

    async with httpx.AsyncClient() as client:
        # 1. Process OpenRouter models
        or_models = [m["system_id"] for m in registry if m["provider"] == "openrouter"]
        logger.info(f"Fetching details for {len(or_models)} OpenRouter models (Public)...")
        
        or_dir = MODELS_DIR / "openrouter"
        or_dir.mkdir(parents=True, exist_ok=True)
        
        for sys_id in or_models:
            data = await fetch_openrouter_details(client, sys_id)
            if data:
                safe_id = sys_id.replace("/", "_").replace(":", "_")
                with open(or_dir / f"{safe_id}.json", "w") as f:
                    json.dump(data, f, indent=2)
            await asyncio.sleep(2)

        # 2. Process NVIDIA models — only save those in our registry
        wanted = known_ids.get("nvidia", set())
        logger.info(f"Fetching NVIDIA model list ({len(wanted)} models in registry)...")
        nv_models = await fetch_nvidia_models(client)
        
        nv_dir = MODELS_DIR / "nvidia"
        nv_dir.mkdir(parents=True, exist_ok=True)
        
        saved = 0
        for m in nv_models:
            api_id = m.get("id")
            if api_id and api_id in wanted:
                safe_id = api_id.replace("/", "_").replace(":", "_")
                with open(nv_dir / f"{safe_id}.json", "w") as f:
                    json.dump(m, f, indent=2)
                saved += 1
        logger.info(f"Saved details for {saved} NVIDIA models")

    logger.info(f"Successfully saved detailed model info to {MODELS_DIR}")

if __name__ == "__main__":
    asyncio.run(main())
