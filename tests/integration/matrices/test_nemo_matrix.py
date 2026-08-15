import asyncio
import json
import os
import traceback

import httpx

GATEWAY_URL = os.environ.get("LITEROUTER_BASE_URL", "http://localhost:7766")
AUTH_TOKEN = os.environ.get("LITEROUTER_AUTH_KEY")
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


def build_payload(stream: bool, use_tools: bool) -> dict[str, object]:
    payload: dict[str, object] = {
        "model": MODEL_ID,
        "stream": stream,
        "messages": [{"role": "user", "content": "What is the weather in Singapore?" if use_tools else "Say ok"}]
    }
    if use_tools:
        payload["tools"] = openai_tools
    return payload


def parse_stream_line(line: str) -> tuple[bool, bool]:
    has_content = False
    has_tool_call = False
    try:
        data = json.loads(line)
        choices = data.get("choices", [])
        if choices:
            delta = choices[0].get("delta", {})
            has_content = bool(delta.get("content"))
            has_tool_call = bool(delta.get("tool_calls"))
    except Exception:
        traceback.print_exc()
    return has_content, has_tool_call


def eval_stream_results(has_content: bool, has_tool_call: bool, use_tools: bool) -> bool:
    if use_tools:
        if has_tool_call:
            print("PASS: Stream returned tool calls.")
            return True
        print("FAIL: Stream did not return tool calls.")
        return False
    if has_content:
        print("PASS: Stream returned content.")
        return True
    print("FAIL: Stream returned no content.")
    return False


def _process_stream_line(line: str) -> tuple[bool, bool, bool]:
    if not line.startswith("data:"):
        return False, False, True
    stripped = line[5:].strip()
    if stripped == "[DONE]":
        return False, False, False
    content, tool = parse_stream_line(stripped)
    return content, tool, True


async def _collect_stream_flags(response: httpx.Response) -> tuple[bool, bool]:
    has_content = False
    has_tool_call = False
    async for line in response.aiter_lines():
        content, tool, cont = _process_stream_line(line)
        if not cont:
            break
        has_content = has_content or content
        has_tool_call = has_tool_call or tool
    return has_content, has_tool_call


async def stream_request(client: httpx.AsyncClient, payload: dict[str, object]) -> bool:
    use_tools = "tools" in payload
    async with client.stream(
        "POST",
        f"{GATEWAY_URL}/v1/chat/completions",
        headers=headers,
        json=payload,
        timeout=30.0,
    ) as response:
        if response.status_code != 200:
            print(f"FAIL: HTTP {response.status_code}")
            return False
        has_content, has_tool_call = await _collect_stream_flags(response)
    return eval_stream_results(has_content, has_tool_call, use_tools)



def eval_non_stream_results(message: dict[str, object], use_tools: bool) -> bool:
    if use_tools:
        if "tool_calls" in message:
            print("PASS: Non-stream returned tool calls.")
            return True
        print("FAIL: Non-stream did not return tool calls.")
        return False
    if message.get("content"):
        print("PASS: Non-stream returned content.")
        return True
    print("FAIL: Non-stream returned no content.")
    return False


async def non_stream_request(client: httpx.AsyncClient, payload: dict[str, object]) -> bool:
    resp = await client.post(
        f"{GATEWAY_URL}/v1/chat/completions",
        headers=headers,
        json=payload,
        timeout=30.0,
    )
    if resp.status_code != 200:
        print(f"FAIL: HTTP {resp.status_code} - {resp.text}")
        return False
    data = resp.json()
    choices = data.get("choices", [])
    if not choices:
        print("FAIL: No choices returned")
        return False
    message = choices[0].get("message", {})
    use_tools = "tools" in payload
    return eval_non_stream_results(message, use_tools)


async def execute_test(stream: bool, use_tools: bool) -> bool:
    test_name = f"Stream: {stream} | Tools: {use_tools}"
    print(f"\n--- Running: {test_name} ---")
    payload = build_payload(stream, use_tools)
    try:
        async with httpx.AsyncClient(http2=True) as client:
            if stream:
                return await stream_request(client, payload)
            return await non_stream_request(client, payload)
    except Exception:
        traceback.print_exc()
        return False


def print_summary(results: dict[str, bool]) -> None:
    print("\n" + "="*60)
    print("             NEMO MATRIX TEST SUMMARY")
    print("="*60)
    passed_count = 0
    for key, passed in results.items():
        status = "PASS" if passed else "FAIL"
        passed_count += 1 if passed else 0
        print(f"{key}: {status}")
    print("="*60)
    print(f"Total: {passed_count}/4 passed.")


async def main() -> None:
    options = [False, True]
    results: dict[str, bool] = {}
    for stream in options:
        for use_tools in options:
            key = f"Stream={stream} | Tools={use_tools}"
            results[key] = await execute_test(stream, use_tools)
    print_summary(results)

if __name__ == "__main__":
    asyncio.run(main())
