import asyncio
import httpx
import json

GATEWAY_URL = "http://localhost:7766"
AUTH_TOKEN = "sk-lr-8f2a9e3b1c4d7e5f"
MODEL_ID = "openrouter/nvidia/nemotron-3-nano-30b-a3b:free"

headers = {
    "Authorization": f"Bearer {AUTH_TOKEN}",
    "Content-Type": "application/json"
}

openai_tools = [{
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a location",
        "parameters": {
            "type": "object",
            "properties": {
                "location": {"type": "string", "description": "The city and state, e.g. Singapore"}
            },
            "required": ["location"]
        }
    }
}]

async def execute_test(stream: bool, use_tools: bool) -> bool:
    test_name = f"Stream: {stream} | Tools: {use_tools}"
    print(f"\n--- Running: {test_name} ---")
    
    payload = {
        "model": MODEL_ID,
        "stream": stream,
        "messages": [{"role": "user", "content": "What is the weather in Singapore?" if use_tools else "Say ok"}]
    }
    if use_tools:
        payload["tools"] = openai_tools

    try:
        async with httpx.AsyncClient() as client:
            if stream:
                async with client.stream("POST", f"{GATEWAY_URL}/v1/chat/completions", headers=headers, json=payload, timeout=30.0) as response:
                    if response.status_code != 200:
                        print(f"FAIL: HTTP {response.status_code}")
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
                    
                    if use_tools:
                        if has_tool_call:
                            print("PASS: Stream returned tool calls.")
                            return True
                        else:
                            print("FAIL: Stream did not return tool calls.")
                            return False
                    else:
                        if has_content:
                            print("PASS: Stream returned content.")
                            return True
                        else:
                            print("FAIL: Stream returned no content.")
                            return False
            else:
                resp = await client.post(f"{GATEWAY_URL}/v1/chat/completions", headers=headers, json=payload, timeout=30.0)
                if resp.status_code != 200:
                    print(f"FAIL: HTTP {resp.status_code} - {resp.text}")
                    return False
                
                data = resp.json()
                choices = data.get("choices", [])
                if not choices:
                    print("FAIL: No choices returned")
                    return False
                
                message = choices[0].get("message", {})
                if use_tools:
                    if "tool_calls" in message:
                        print("PASS: Non-stream returned tool calls.")
                        return True
                    else:
                        print("FAIL: Non-stream did not return tool calls.")
                        return False
                else:
                    if message.get("content"):
                        print("PASS: Non-stream returned content.")
                        return True
                    else:
                        print("FAIL: Non-stream returned no content.")
                        return False

    except Exception as e:
        import traceback
        traceback.print_exc()
        return False

async def main():
    streaming_options = [False, True]
    tool_options = [False, True]
    
    results = {}
    
    for stream in streaming_options:
        for use_tools in tool_options:
            key = f"Stream={stream} | Tools={use_tools}"
            results[key] = await execute_test(stream, use_tools)
                
    print("\n" + "="*60)
    print("             NEMO MATRIX TEST SUMMARY")
    print("="*60)
    passed_count = 0
    for key, passed in results.items():
        status = "PASS" if passed else "FAIL"
        if passed:
            passed_count += 1
        print(f"{key}: {status}")
    print("="*60)
    print(f"Total: {passed_count}/4 passed.")

if __name__ == "__main__":
    asyncio.run(main())
