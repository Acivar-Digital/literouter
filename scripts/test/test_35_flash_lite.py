import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

env_path = Path(__file__).resolve().parent.parent / ".env"
load_dotenv(dotenv_path=env_path)

raw_keys = os.getenv("GOOGLE_API_KEYS", "")
keys = [k.strip() for k in raw_keys.split(",") if k.strip()]
aiza_keys = [k for k in keys if k.startswith("AIza")]

print(f"Testing gemini-3.5-flash-lite across {len(aiza_keys)} AI Studio keys...\n")

model_names = ["gemini-3.5-flash-lite", "models/gemini-3.5-flash-lite"]

for idx, key in enumerate(aiza_keys):
    print(f"=== Testing Key #{idx+1} ({key[:12]}...) ===")

    # 1. Standard REST generateContent
    for m in model_names:
        time.sleep(2.0)
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={key}"
        payload = json.dumps({"contents": [{"parts": [{"text": "Hello world"}]}]}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                txt = data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "").strip()
                print(f"  ✅ REST generateContent ({m}): SUCCESS -> {txt}")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")[:120]
            print(f"  ❌ REST generateContent ({m}): HTTP {e.code} -> {body}")
        except Exception as e:
            print(f"  ❌ REST generateContent ({m}): Error -> {e}")

    # 2. Interactions API (/v1beta/interactions)
    for m in model_names:
        time.sleep(2.0)
        url = "https://generativelanguage.googleapis.com/v1beta/interactions"
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": key,
        }
        payload = json.dumps({"model": m, "input": "Hello world"}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                print(f"  ✅ Interactions API ({m}): SUCCESS -> {json.dumps(data)[:150]}")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")[:120]
            print(f"  ❌ Interactions API ({m}): HTTP {e.code} -> {body}")
        except Exception as e:
            print(f"  ❌ Interactions API ({m}): Error -> {e}")

    # 3. OpenAI-compat endpoint
    for m in model_names:
        time.sleep(2.0)
        url = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {key}",
        }
        payload = json.dumps({"model": m, "messages": [{"role": "user", "content": "Hello world"}]}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
                txt = data.get("choices", [{}])[0].get("message", {}).get("content", "").strip()
                print(f"  ✅ OpenAI-compat ({m}): SUCCESS -> {txt}")
        except urllib.error.HTTPError as e:
            body = e.read().decode("utf-8", errors="ignore")[:120]
            print(f"  ❌ OpenAI-compat ({m}): HTTP {e.code} -> {body}")
        except Exception as e:
            print(f"  ❌ OpenAI-compat ({m}): Error -> {e}")
