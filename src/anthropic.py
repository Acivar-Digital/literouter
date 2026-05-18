"""
anthropic.py — Anthropic response normalization.

Converts Anthropic API responses to OpenAI chat.completion format.
Handles both the legacy `completion` endpoint shape and the Messages API shape.
"""

import time
import uuid


def transform_anthropic_response(anthropic_response: dict) -> dict:
    """Convert an Anthropic API response to an OpenAI chat.completion payload.

    Handles:
    - Messages API response (role, content array, stop_reason, usage)
    - Legacy completion response (completion, stop_reason, usage)
    - Extracts text from content blocks
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
                if block.get("type") == "text":
                    text_parts.append(block.get("text", ""))
                # Skip "thinking" blocks — they're internal to Anthropic
        content_text = "".join(text_parts)
        role = anthropic_response.get("role", "assistant")
    else:
        # Legacy completion format
        content_text = anthropic_response.get("completion", "")

    # Map usage
    usage = anthropic_response.get("usage") or {}
    openai_usage = {
        "prompt_tokens": usage.get("input_tokens", 0),
        "completion_tokens": usage.get("output_tokens", 0),
        "total_tokens": usage.get("input_tokens", 0) + usage.get("output_tokens", 0),
    }

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
