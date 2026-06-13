"""
anthropic.py — Anthropic provider adapter for LiteRouter.

Two functions:
1. build_anthropic_request_body() — Converts OpenAI chat.completions format to
   Anthropic Messages API request format.
2. transform_anthropic_response() — Converts Anthropic Messages API response
   to OpenAI chat.completion format.
"""

import time
import uuid


def build_anthropic_request_body(body: dict) -> dict:
    """Convert an OpenAI chat.completions request to Anthropic Messages API format.

    Maps:
    - system message -> top-level ``system`` string
    - messages -> Anthropic ``messages`` array (user/assistant roles only)
    - temperature, top_p, max_tokens, stop -> Anthropic equivalents
    - stream -> passed through
    """
    anthropic_body: dict = {
        "model": body.get("model", ""),
        "max_tokens": body.get("max_tokens", 4096),
        "messages": [],
    }

    # Extract system message
    system_content = ""
    messages = []
    for msg in body.get("messages", []):
        role = msg.get("role", "")
        content = msg.get("content", "")
        if role == "system":
            if isinstance(content, list):
                # Handle multi-part system content
                parts = []
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        parts.append(part.get("text", ""))
                system_content = " ".join(parts)
            else:
                system_content = str(content)
        elif role in ("user", "assistant"):
            # Handle list-based content and convert 'input_text' blocks to 'text'
            if isinstance(content, list):
                anthropic_content = []
                for block in content:
                    if isinstance(block, dict):
                        block_copy = dict(block)
                        if block_copy.get("type") == "input_text":
                            block_copy["type"] = "text"
                        anthropic_content.append(block_copy)
                    else:
                        anthropic_content.append(block)
                content = anthropic_content

            anthropic_msg: dict = {"role": role, "content": content}
            # Handle tool_calls for assistant messages
            if role == "assistant" and "tool_calls" in msg:
                tool_use_blocks = []
                for tc in msg["tool_calls"]:
                    function = tc.get("function", {})
                    tool_use_blocks.append({
                        "type": "tool_use",
                        "id": tc.get("id", ""),
                        "name": function.get("name", ""),
                        "input": _parse_tool_input(function.get("arguments", "{}")),
                    })
                if isinstance(content, str) and content:
                    anthropic_msg["content"] = [
                        {"type": "text", "text": content},
                        *tool_use_blocks,
                    ]
                else:
                    anthropic_msg["content"] = tool_use_blocks
            messages.append(anthropic_msg)

    if system_content:
        anthropic_body["system"] = system_content

    anthropic_body["messages"] = messages

    # Map optional parameters
    if "temperature" in body:
        anthropic_body["temperature"] = body["temperature"]
    if "top_p" in body:
        anthropic_body["top_p"] = body["top_p"]
    if "max_tokens" in body:
        anthropic_body["max_tokens"] = body["max_tokens"]
    if "stop" in body and body["stop"]:
        stop = body["stop"]
        anthropic_body["stop_sequences"] = stop if isinstance(stop, list) else [stop]
    if "stream" in body:
        anthropic_body["stream"] = body["stream"]

    return anthropic_body


def _parse_tool_input(arguments: str) -> dict:
    """Parse a tool call arguments string into a dict."""
    import json
    if isinstance(arguments, dict):
        return arguments
    try:
        return json.loads(arguments)
    except Exception:
        return {"raw": arguments}


def transform_anthropic_response(anthropic_response: dict) -> dict:
    """Convert an Anthropic API response to an OpenAI chat.completion payload.

    Handles:
    - Messages API response (role, content array, stop_reason, usage)
    - Legacy completion response (completion, stop_reason, usage)
    - Extracts text from content blocks, skips thinking/tool_use blocks
    - Maps usage.input_tokens/output_tokens to prompt_tokens/completion_tokens
    - Maps stop_reason to finish_reason
    - Preserves reasoning_tokens from usage if present
    """
    # Determine the content text
    content_text = ""
    role = "assistant"
    stop_reason = anthropic_response.get("stop_reason", "stop")

    # Messages API format: content is an array of blocks
    content_blocks = anthropic_response.get("content")
    if isinstance(content_blocks, list):
        text_parts = []
        for block in content_blocks:
            if isinstance(block, dict):
                block_type = block.get("type", "")
                if block_type == "text":
                    text_parts.append(block.get("text", ""))
                # Skip "thinking", "tool_use", and other non-text blocks
        content_text = "".join(text_parts)
        role = anthropic_response.get("role", "assistant")
    elif isinstance(content_blocks, str):
        # Anthropic sometimes returns content as a plain string
        content_text = content_blocks
    else:
        # Legacy completion format
        content_text = anthropic_response.get("completion", "")

    # Map usage
    usage = anthropic_response.get("usage") or {}
    input_tokens = usage.get("input_tokens", 0) or 0
    output_tokens = usage.get("output_tokens", 0) or 0
    openai_usage = {
        "prompt_tokens": input_tokens,
        "completion_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens,
    }
    # Preserve reasoning_tokens if present
    reasoning_tokens = usage.get("reasoning_tokens") or usage.get("cache_creation_input_tokens")
    if reasoning_tokens:
        openai_usage["reasoning_tokens"] = reasoning_tokens

    # Map stop_reason to finish_reason
    finish_reason_map = {
        "end_turn": "stop",
        "max_tokens": "length",
        "stop_sequence": "stop",
        "tool_use": "tool_calls",
    }
    finish_reason = finish_reason_map.get(stop_reason, "stop")

    # Build OpenAI-compatible response
    openai_response = {
        "id": anthropic_response.get("id") or f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": anthropic_response.get("model", "anthropic"),
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": role,
                    "content": content_text,
                },
                "finish_reason": finish_reason,
            }
        ],
        "usage": openai_usage,
    }

    return openai_response
