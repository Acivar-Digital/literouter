import httpx
import json

url = "http://localhost:7766/v1/chat/completions"
headers = {
    "Authorization": "Bearer sk-lr-8f2a9e3b1c4d7e5f",
    "Content-Type": "application/json"
}

payload = {
    "model": "openrouter/owl-alpha",
    "messages": [
        {"role": "user", "content": "hi"}
    ],
    "stream": True
}

print("Testing streaming endpoint to verify JSON parsing...")
with httpx.stream("POST", url, headers=headers, json=payload, timeout=90.0) as response:
    print(f"Status: {response.status_code}")
    for chunk in response.iter_text():
        if chunk.strip():
            print(f"Chunk received:\n{chunk}")
