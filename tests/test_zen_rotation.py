import json
import time
import urllib.request

MODELS = [
    "zen/deepseek-v4-flash-free",
    "zen/mimo-v2.5-free",
    "zen/north-mini-code-free",
    "zen/nemotron-3-ultra-free",
    "zen/deepseek-v4-flash-free",
]

LITE_URL = "http://localhost:7766/v1/chat/completions"

for i, model in enumerate(MODELS):
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "hi"}],
        "max_tokens": 10,
    }).encode()

    req = urllib.request.Request(
        LITE_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer sk-lr-8f2a9e3b1c4d7e5f",
        },
        method="POST",
    )
    try:
        t0 = time.time()
        resp = urllib.request.urlopen(req, timeout=30)
        body = json.loads(resp.read())
        content = body["choices"][0]["message"]["content"].strip()
        ms = int((time.time() - t0) * 1000)
        model_used = body.get("model", "?")
        print(f"[{i+1}] {model:38s}  OK  {ms:4d}ms  reply={content or '(empty)'}")
    except urllib.error.HTTPError as e:
        err = e.read().decode()[:100]
        print(f"[{i+1}] {model:38s}  FAIL HTTP {e.code}  {err}")
    except Exception as e:
        print(f"[{i+1}] {model:38s}  FAIL  {str(e)[:80]}")
