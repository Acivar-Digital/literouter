import asyncio
import json

import httpx

GATEWAY_URL = "http://127.0.0.1:7766"
AUTH_TOKEN = "sk-lr-8f2a9e3b1c4d7e5f"

google_tools = [{
    "functionDeclarations": [{
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "OBJECT",
            "properties": {
                "location": {"type": "STRING", "description": "The city name"}
            },
            "required": ["location"]
        }
    }]
}]

openai_tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get current weather for a city",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "The city name"}
            },
            "required": ["location"]
        }
    }
}]

async def test_google_rest(model: str, stream: bool, use_tools: bool) -> bool:
    action = "streamGenerateContent" if stream else "generateContent"
    url = f"{GATEWAY_URL}/v1beta/models/{model}:{action}?key={AUTH_TOKEN}"
    
    payload = {
        "contents": [{"parts": [{"text": "What is the weather in Singapore?" if use_tools else "Say ok"}]}],
        "generationConfig": {"maxOutputTokens": 100}
    }
    if use_tools:
        payload["tools"] = google_tools

    try:
        async with httpx.AsyncClient() as client:
            if stream:
                async with client.stream("POST", url, json=payload, timeout=20.0) as response:
                    if response.status_code != 200:
                        return False
                    
                    full_body = ""
                    async for chunk in response.aiter_text():
                        full_body += chunk
                    
                    if use_tools:
                        return "functionCall" in full_body
                    else:
                        return "text" in full_body
            else:
                resp = await client.post(url, json=payload, timeout=20.0)
                if resp.status_code != 200:
                    return False
                
                data = resp.json()
                candidates = data.get("candidates", [])
                if not candidates:
                    return False
                
                parts = candidates[0].get("content", {}).get("parts", [])
                if not parts:
                    return False
                
                if use_tools:
                    return "functionCall" in parts[0]
                else:
                    return bool(parts[0].get("text"))
                    
    except Exception:
        return False

async def test_openai(model: str, stream: bool, use_tools: bool) -> bool:
    url = f"{GATEWAY_URL}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {AUTH_TOKEN}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": model,
        "stream": stream,
        "messages": [{"role": "user", "content": "What is the weather in Singapore?" if use_tools else "Say ok"}]
    }
    if use_tools:
        payload["tools"] = openai_tools

    try:
        async with httpx.AsyncClient() as client:
            if stream:
                async with client.stream("POST", url, headers=headers, json=payload, timeout=20.0) as response:
                    if response.status_code != 200:
                        return False
                    
                    has_content = False
                    has_tool_call = False
                    async for line in response.aiter_lines():
                        if line.startswith("data:"):
                            line = line[5:].strip()
                            if line == "[DONE]":
                                break
                            try:
                                data = json.loads(line)
                                choices = data.get("choices", [])
                                if choices:
                                    delta = choices[0].get("delta", {})
                                    if delta.get("content"):
                                        has_content = True
                                    if delta.get("tool_calls"):
                                        has_tool_call = True
                            except Exception:
                                pass
                    
                    return has_tool_call if use_tools else has_content
            else:
                resp = await client.post(url, headers=headers, json=payload, timeout=20.0)
                if resp.status_code != 200:
                    return False
                
                data = resp.json()
                choices = data.get("choices", [])
                if not choices:
                    return False
                
                message = choices[0].get("message", {})
                if use_tools:
                    return "tool_calls" in message
                else:
                    return bool(message.get("content"))
                    
    except Exception:
        return False

async def main():
    models = [
        "gemini-3.1-flash-lite",
        "freetier/gemma-4-31b-it",
        "freetier/gemma-4-26b-a4b-it"
    ]
    templates = ["Google-REST", "OpenAI-Compat"]
    streaming_options = [False, True]
    tool_options = [False, True]
    
    results = {}
    
    # Total tests = 3 * 2 * 2 * 2 = 24
    for model in models:
        for template in templates:
            for stream in streaming_options:
                for use_tools in tool_options:
                    key = f"Model: {model} | Template: {template} | Stream: {stream} | Tools: {use_tools}"
                    
                    print(f"Running: {key}...")
                    if template == "Google-REST":
                        passed = await test_google_rest(model, stream, use_tools)
                    else:
                        passed = await test_openai(model, stream, use_tools)
                        
                    results[key] = passed
                    print(f"Result: {'PASS' if passed else 'FAIL'}\n")
                    
    print("\n" + "="*80)
    print("                24-TEST PERMUTATION SUMMARY")
    print("="*80)
    passed_count = 0
    for key, passed in results.items():
        status = "PASS" if passed else "FAIL"
        if passed:
            passed_count += 1
        print(f"{key}: {status}")
    print("="*80)
    print(f"Total: {passed_count}/24 passed.")

if __name__ == "__main__":
    asyncio.run(main())
