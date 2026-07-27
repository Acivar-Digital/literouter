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

print(f"Loaded {len(keys)} total Google keys ({len(aiza_keys)} AI Studio AIza keys).\n")

candidates = [
    ("Gemini 2.5 Flash", "gemini-2.5-flash"),
    ("Gemini 2.5 Flash Lite", "gemini-2.5-flash-lite"),
    ("Gemini 3 Flash", "gemini-3-flash"),
    ("Gemini 3 Flash (preview)", "gemini-3-flash-preview"),
    ("Gemini 3.5 Flash", "gemini-3.5-flash"),
    ("Gemini 3.5 Flash Lite", "gemini-3.5-flash-lite"),
    ("Gemini 3.6 Flash", "gemini-3.6-flash"),
    ("Antigravity", "antigravity-preview-05-2026"),
]

for label, model in candidates:
    print(f"Testing [{label}] (id: {model})...")
    success = False
    test_keys = aiza_keys if aiza_keys else keys

    endpoints = [
        (
            "v1beta native",
            f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={{key}}",
            "native",
        ),
        (
            "v1 native",
            f"https://generativelanguage.googleapis.com/v1/models/{model}:generateContent?key={{key}}",
            "native",
        ),
        (
            "v1beta openai",
            "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
            "openai",
        ),
        (
            "v1 openai",
            "https://generativelanguage.googleapis.com/v1/openai/chat/completions",
            "openai",
        ),
    ]

    for idx, key in enumerate(test_keys):
        for ep_name, ep_url_tmpl, ep_type in endpoints:
            time.sleep(2.0)  # Rate-limit safety pause
            if ep_type == "native":
                url = ep_url_tmpl.format(key=key)
                headers = {"Content-Type": "application/json"}
                payload = json.dumps({"contents": [{"parts": [{"text": "Reply with OK"}]}]}).encode("utf-8")
            else:
                url = ep_url_tmpl
                headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
                payload_dict = {"model": model, "messages": [{"role": "user", "content": "Reply with OK"}]}
                payload = json.dumps(payload_dict).encode("utf-8")

            req = urllib.request.Request(url, data=payload, headers=headers, method="POST")

            try:
                with urllib.request.urlopen(req, timeout=15) as resp:
                    res_data = json.loads(resp.read().decode("utf-8"))
                    if ep_type == "native":
                        parts = res_data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])
                        txt = parts[0].get("text", "").strip() if parts else ""
                    else:
                        choices = res_data.get("choices", [{}])
                        txt = choices[0].get("message", {}).get("content", "").strip() if choices else ""
                    print(f"  ✅ Key #{idx+1} [{ep_name}]: SUCCESS (response: {txt})")
                    success = True
                    break
            except urllib.error.HTTPError as e:
                body = e.read().decode("utf-8", errors="ignore")
                try:
                    err_msg = json.loads(body).get("error", {}).get("message", body[:100])
                except Exception:
                    err_msg = body[:100]
                print(f"  ❌ Key #{idx+1} [{ep_name}]: HTTP {e.code} - {err_msg}")
            except Exception as e:
                print(f"  ❌ Key #{idx+1} [{ep_name}]: Error - {e}")
        if success:
            break

    if not success:
        print(f"  ➡️ Model {model} UNSUPPORTED on all endpoints.\n")
    else:
        print()
