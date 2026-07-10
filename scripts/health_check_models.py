import asyncio
import json
import logging
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Setup logging
logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("health_check")

load_dotenv()

# Config
GATEWAY_URL = os.getenv("LITEROUTER_URL", "http://localhost:7766")
AUTH_KEY = os.getenv("LITEROUTER_AUTH_KEY", "")
MODELS_JSON = Path(__file__).resolve().parent.parent / "models.json"

async def check_model(client, model_id):
    url = f"{GATEWAY_URL}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {AUTH_KEY}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 10
    }
    
    try:
        resp = await client.post(url, json=payload, headers=headers, timeout=15.0)
        served_model = resp.headers.get("X-Literouter-Model", "N/A")
        return {
            "model": model_id,
            "status": resp.status_code,
            "served": served_model,
            "alive": resp.status_code == 200
        }
    except Exception as e:
        return {
            "model": model_id,
            "status": "ERROR",
            "served": "N/A",
            "alive": False,
            "error": str(e)
        }

async def main():
    if not AUTH_KEY:
        print("Error: LITEROUTER_AUTH_KEY not found in .env")
        return

    if not MODELS_JSON.exists():
        print(f"Error: {MODELS_JSON} not found")
        return

    with open(MODELS_JSON) as f:
        models_list = json.load(f)
    
    model_ids = [m["system_id"] for m in models_list]
    
    print(f"Checking {len(model_ids)} models against {GATEWAY_URL}...")
    print(f"{'Model ID':<50} | {'Status':<10} | {'Served Model':<40} | {'Alive'}")
    print("-" * 115)
    
    async with httpx.AsyncClient() as client:
        tasks = [check_model(client, mid) for mid in model_ids]
        results = await asyncio.gather(*tasks)
        
        for r in results:
            status = r["status"]
            served = r["served"]
            alive = "✅" if r["alive"] else "❌"
            print(f"{r['model']:<50} | {status:<10} | {served:<40} | {alive}")

if __name__ == "__main__":
    asyncio.run(main())
