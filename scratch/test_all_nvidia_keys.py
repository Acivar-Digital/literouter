import httpx
import os
from dotenv import load_dotenv

load_dotenv()

keys_str = os.getenv("NVIDIA_API_KEYS", "")
keys = [k.strip() for k in keys_str.split(",") if k.strip()]

print(f"Loaded {len(keys)} keys from env.")

url = "https://integrate.api.nvidia.com/v1/chat/completions"

for idx, key in enumerate(keys):
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }
    payload = {
        "model": "openai/gpt-oss-120b",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": False
    }
    try:
        resp = httpx.post(url, json=payload, headers=headers, timeout=10.0)
        print(f"Key {idx+1}/{len(keys)} (ending in ...{key[-8:]}): Status {resp.status_code}")
        if resp.status_code != 200:
            print("Response:", resp.text)
    except Exception as e:
        print(f"Key {idx+1} failed with error:", e)
