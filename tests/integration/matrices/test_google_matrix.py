import asyncio
import json
import logging
import os
from typing import Any

import httpx

GATEWAY_URL = "http://127.0.0.1:7766"
AUTH_TOKEN = os.environ.get("LITEROUTER_AUTH_KEY")

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

def _build_google_payload(use_tools: bool) -> dict[str, Any]:
    """Build the Google REST API payload."""
    text = "What is the weather in Singapore?" if use_tools else "Say ok"
    payload: dict[str, Any] = {
        "contents": [{"parts": [{"text": text}]}],
        "generationConfig": {"maxOutputTokens": 100}
    }
    if use_tools:
        payload["tools"] = google_tools
    return payload

def _get_google_candidates(data: dict[str, Any]) -> list[Any]:
    """Extract candidates from Google REST response."""
    return list(data.get("candidates", []))

def _validate_google_non_stream(data: dict[str, Any], use_tools: bool) -> bool:
    """Validate non-streaming Google REST response."""
    candidates = _get_google_candidates(data)
    if not candidates:
        return False
    parts = candidates[0].get("content", {}).get("parts", [])
    if not parts:
        return False
    if use_tools:
        return "functionCall" in parts[0]
    return bool(parts[0].get("text"))

def _validate_google_stream(full_body: str, use_tools: bool) -> bool:
    """Validate streaming Google REST response."""
    if use_tools:
        return "functionCall" in full_body
    return "text" in full_body

async def _google_rest_stream(url: str, payload: dict[str, Any], use_tools: bool) -> bool:
    """Execute streaming Google REST request."""
    async with httpx.AsyncClient() as client:
        async with client.stream("POST", url, json=payload, timeout=20.0) as response:
            if response.status_code != 200:
                return False
            full_body = ""
            async for chunk in response.aiter_text():
                full_body += chunk
            return _validate_google_stream(full_body, use_tools)

async def _google_rest_non_stream(url: str, payload: dict[str, Any], use_tools: bool) -> bool:
    """Execute non-streaming Google REST request."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, json=payload, timeout=20.0)
        if resp.status_code != 200:
            return False
        return _validate_google_non_stream(resp.json(), use_tools)

async def execute_google_rest(model: str, stream: bool, use_tools: bool) -> bool:
    action = "streamGenerateContent" if stream else "generateContent"
    url = f"{GATEWAY_URL}/v1beta/models/{model}:{action}?key={AUTH_TOKEN}"
    payload = _build_google_payload(use_tools)
    try:
        if stream:
            return await _google_rest_stream(url, payload, use_tools)
        return await _google_rest_non_stream(url, payload, use_tools)
    except Exception:
        return False

def _build_openai_payload(model: str, stream: bool, use_tools: bool) -> dict[str, Any]:
    """Build the OpenAI-compatible API payload."""
    text = "What is the weather in Singapore?" if use_tools else "Say ok"
    payload: dict[str, Any] = {
        "model": model,
        "stream": stream,
        "messages": [{"role": "user", "content": text}]
    }
    if use_tools:
        payload["tools"] = openai_tools
    return payload

def _parse_stream_delta(data: dict[str, Any]) -> tuple[bool, bool]:
    """Extract content and tool_call presence from a delta."""
    choices = data.get("choices", [])
    if not choices:
        return False, False
    delta = choices[0].get("delta", {})
    has_content = bool(delta.get("content"))
    has_tool_call = bool(delta.get("tool_calls"))
    return has_content, has_tool_call

def _try_update_delta(line: str, has_content: bool, has_tool_call: bool) -> tuple[bool, bool]:
    """Parse and apply a single SSE data line."""
    try:
        new_content, new_tools = _parse_stream_delta(json.loads(line))
        return has_content or new_content, has_tool_call or new_tools
    except Exception as e:
        logging.warning("Parse failure on stream line: %s", e)
        return has_content, has_tool_call

def _process_stream_line(line: str, has_content: bool, has_tool_call: bool) -> tuple[bool, bool]:
    """Process a single SSE line from streaming OpenAI response."""
    if not line.startswith("data:"):
        return has_content, has_tool_call
    line = line[5:].strip()
    if line == "[DONE]":
        return has_content, has_tool_call
    return _try_update_delta(line, has_content, has_tool_call)

def _get_openai_choices(data: dict[str, Any]) -> list[Any]:
    """Extract choices from OpenAI response."""
    return list(data.get("choices", []))

def _validate_openai_non_stream(data: dict[str, Any], use_tools: bool) -> bool:
    """Validate non-streaming OpenAI response."""
    choices = _get_openai_choices(data)
    if not choices:
        return False
    message = choices[0].get("message", {})
    if use_tools:
        return "tool_calls" in message
    return bool(message.get("content"))

async def _openai_stream(url: str, headers: dict[str, str], payload: dict[str, Any], use_tools: bool) -> bool:
    """Execute streaming OpenAI request."""
    async with httpx.AsyncClient() as client:
        async with client.stream("POST", url, headers=headers, json=payload, timeout=20.0) as response:
            if response.status_code != 200:
                return False
            has_content = False
            has_tool_call = False
            async for line in response.aiter_lines():
                has_content, has_tool_call = _process_stream_line(
                    line, has_content, has_tool_call
                )
            return has_tool_call if use_tools else has_content

async def _openai_non_stream(url: str, headers: dict[str, str], payload: dict[str, Any], use_tools: bool) -> bool:
    """Execute non-streaming OpenAI request."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(url, headers=headers, json=payload, timeout=20.0)
        if resp.status_code != 200:
            return False
        return _validate_openai_non_stream(resp.json(), use_tools)

async def execute_openai(model: str, stream: bool, use_tools: bool) -> bool:
    url = f"{GATEWAY_URL}/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {AUTH_TOKEN}",
        "Content-Type": "application/json"
    }
    payload = _build_openai_payload(model, stream, use_tools)
    try:
        if stream:
            return await _openai_stream(url, headers, payload, use_tools)
        return await _openai_non_stream(url, headers, payload, use_tools)
    except Exception:
        return False

def _run_single_test(model: str, template: str, stream: bool, use_tools: bool) -> bool:
    """Execute a single test case and return the result."""
    if template == "Google-REST":
        return asyncio.run(execute_google_rest(model, stream, use_tools))
    return asyncio.run(execute_openai(model, stream, use_tools))

def _print_result_line(key: str, passed: bool) -> int:
    """Print a single result line. Returns 1 if passed."""
    status = "PASS" if passed else "FAIL"
    print(f"{key}: {status}")
    return 1 if passed else 0

def _print_results(results: dict[str, bool]) -> None:
    """Print the permutation summary."""
    print("\n" + "=" * 80)
    print("                24-TEST PERMUTATION SUMMARY")
    print("=" * 80)
    passed_count = sum(
        _print_result_line(key, passed)
        for key, passed in results.items()
    )
    print("=" * 80)
    print(f"Total: {passed_count}/24 passed.")

def _build_test_matrix() -> tuple[list[str], list[str], list[bool], list[bool]]:
    """Return the Cartesian product of test parameters."""
    models = [
        "gemini-3.1-flash-lite",
        "freetier/gemma-4-31b-it",
        "freetier/gemma-4-26b-a4b-it"
    ]
    templates = ["Google-REST", "OpenAI-Compat"]
    streaming_options = [False, True]
    tool_options = [False, True]
    return models, templates, streaming_options, tool_options

def _status_str(passed: bool) -> str:
    """Return 'PASS' or 'FAIL'."""
    return "PASS" if passed else "FAIL"

async def main() -> None:
    models, templates, streaming_options, tool_options = _build_test_matrix()
    results: dict[str, bool] = {}
    for model in models:
        for template in templates:
            for stream in streaming_options:
                for use_tools in tool_options:
                    key = f"Model: {model} | Template: {template} | Stream: {stream} | Tools: {use_tools}"
                    print(f"Running: {key}...")
                    passed = _run_single_test(model, template, stream, use_tools)
                    results[key] = passed
                    print(f"Result: {_status_str(passed)}\n")
    _print_results(results)

if __name__ == "__main__":
    asyncio.run(main())

if __name__ == "__main__":
    asyncio.run(main())
