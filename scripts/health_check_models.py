import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

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


async def check_model(client: httpx.AsyncClient, model_id: str) -> dict[str, Any]:
    url = f"{GATEWAY_URL}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {AUTH_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model_id,
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 10,
    }
    try:
        resp = await client.post(url, json=payload, headers=headers, timeout=15.0)
        served_model = resp.headers.get("X-Literouter-Model", "N/A")
        return {
            "model": model_id,
            "status": resp.status_code,
            "served": served_model,
            "alive": resp.status_code == 200,
        }
    except Exception as e:
        return {
            "model": model_id,
            "status": "ERROR",
            "served": "N/A",
            "alive": False,
            "error": str(e),
        }


def validate_auth_key() -> bool:
    if not AUTH_KEY:
        print("Error: LITEROUTER_AUTH_KEY not found in .env")
        return False
    return True


def validate_models_file() -> bool:
    if not MODELS_JSON.exists():
        print(f"Error: {MODELS_JSON} not found")
        return False
    return True


def load_model_ids() -> list[str]:
    with open(MODELS_JSON) as f:
        models_list = json.load(f)
    return [m["system_id"] for m in models_list]


def print_result(r: dict[str, Any]) -> None:
    status = r["status"]
    served = r["served"]
    alive = "✅" if r["alive"] else "❌"
    print(f"{r['model']:<50} | {status:<10} | {served:<40} | {alive}")


async def main() -> None:
    if not validate_auth_key():
        return
    if not validate_models_file():
        return

    model_ids = load_model_ids()

    print(f"Checking {len(model_ids)} models against {GATEWAY_URL}...")
    print(f"{'Model ID':<50} | {'Status':<10} | {'Served Model':<40} | {'Alive'}")
    print("-" * 115)

    async with httpx.AsyncClient() as client:
        tasks = [check_model(client, mid) for mid in model_ids]
        results = await asyncio.gather(*tasks)
        for r in results:
            print_result(r)


if __name__ == "__main__":
    asyncio.run(main())
