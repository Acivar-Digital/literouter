import sqlite3
import time

import httpx

print("Starting rotation test via curl/httpx directly to LiteRouter...")

# 1. Clear database logs so we can count keys precisely from this run
conn = sqlite3.connect("logs/literouter_logs.db")
conn.execute("DELETE FROM request_legs;")
conn.commit()
conn.close()

# 2. Fire 6 requests to OpenRouter (nemo-free)
print("\nFiring 6 requests to OpenRouter...")
for i in range(6):
    payload = {
        "model": "openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": False
    }
    headers = {
        "Authorization": "Bearer sk-lr-8f2a9e3b1c4d7e5f",
        "Content-Type": "application/json"
    }
    try:
        resp = httpx.post("http://localhost:7766/v1/chat/completions", json=payload, headers=headers, timeout=20.0)  # noqa: E501
        print(f"Request {i+1}/6: Status {resp.status_code}")
    except Exception as e:
        print(f"Request {i+1}/6: Failed with error: {e}")
    time.sleep(1)

# 3. Fire 6 requests to Nvidia (gpt-oss)
print("\nFiring 6 requests to Nvidia...")
for i in range(6):
    payload = {
        "model": "nvidia/openai/gpt-oss-120b",
        "messages": [{"role": "user", "content": "hi"}],
        "stream": False
    }
    headers = {
        "Authorization": "Bearer sk-lr-8f2a9e3b1c4d7e5f",
        "Content-Type": "application/json"
    }
    try:
        resp = httpx.post("http://localhost:7766/v1/chat/completions", json=payload, headers=headers, timeout=20.0)  # noqa: E501
        print(f"Request {i+1}/6: Status {resp.status_code}")
    except Exception as e:
        print(f"Request {i+1}/6: Failed with error: {e}")
    time.sleep(1)

# 4. Check the SQLite logs for the key rotation evidence
print("\nChecking SQLite logs for used keys...")
conn = sqlite3.connect("logs/literouter_logs.db")
cursor = conn.cursor()
cursor.execute("""
    SELECT 
        CASE 
            WHEN body LIKE '%openrouter.ai%' THEN 'OpenRouter'
            WHEN body LIKE '%integrate.api.nvidia.com%' THEN 'Nvidia'
            ELSE 'Unknown'
        END as provider,
        json_extract(body, '$.model') as model,
        req_id
    FROM request_legs 
    WHERE leg=2;
""")
rows = cursor.fetchall()
for r in rows:
    print(r)
conn.close()

print("\nFinished direct rotation test.")
