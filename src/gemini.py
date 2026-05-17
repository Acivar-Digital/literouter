"""
gemini.py — OpenAI <-> Gemini request/response transformation.

Ports the TypeScript transformation logic from server.ts (lines 76-174)
into Python.  Handles conversion of OpenAI chat messages to Gemini's
contents + systemInstruction format and vice-versa for responses.
"""

import time
import uuid


def build_gemini_request_body(body: dict) -> dict:
    """Convert an OpenAI chat-completion body to a Gemini API request body.

    Maps:
    - ``system`` messages → ``systemInstruction``
    - ``user`` messages → contents with role ``"user"``
    - ``assistant`` messages → contents with role ``"model"``
    - Generation parameters (temperature, top_p, top_k, n, max_tokens, stop)
      → ``generationConfig`` with Gemini field names.

    Also supports a legacy ``prompt`` field (string or object with
    ``context`` / ``messages`` keys) for backwards compatibility.
    """
    request_body: dict = {}
    contents: list[dict] = []
    system_parts: list[str] = []
    generation_config: dict = {}

    def push_content(role: str, text: str) -> None:
        contents.append({"role": role, "parts": [{"text": text}]})

    def push_message(message: dict) -> None:
        raw = message.get("content", "")
        text = raw if isinstance(raw, str) else str(raw)

        role = message.get("role", "")
        if role == "system":
            system_parts.append(text)
        elif role == "assistant":
            push_content("model", text)
        else:
            push_content("user", text)

    messages = body.get("messages")
    if isinstance(messages, list):
        for msg in messages:
            push_message(msg)

    prompt = body.get("prompt")
    if isinstance(prompt, str):
        push_content("user", prompt)
    elif isinstance(prompt, dict):
        context = prompt.get("context")
        if isinstance(context, str):
            system_parts.append(context)
        prompt_messages = prompt.get("messages")
        if isinstance(prompt_messages, list):
            for msg in prompt_messages:
                push_message(msg)

    if contents:
        request_body["contents"] = contents

    if system_parts:
        request_body["systemInstruction"] = {
            "parts": [{"text": "\n\n".join(system_parts)}]
        }

    temp = body.get("temperature")
    if isinstance(temp, (int, float)):
        generation_config["temperature"] = temp

    top_p = body.get("top_p")
    if isinstance(top_p, (int, float)):
        generation_config["topP"] = top_p

    top_k = body.get("top_k")
    if isinstance(top_k, (int, float)):
        generation_config["topK"] = top_k

    n_val = body.get("n")
    if isinstance(n_val, (int, float)):
        generation_config["candidateCount"] = n_val

    max_tokens = body.get("max_tokens")
    if isinstance(max_tokens, (int, float)):
        generation_config["maxOutputTokens"] = max_tokens

    stop = body.get("stop")
    if stop is not None:
        generation_config["stopSequences"] = (
            stop if isinstance(stop, list) else [str(stop)]
        )

    if generation_config:
        request_body["generationConfig"] = generation_config

    return request_body


def transform_gemini_response(gemini_response: dict) -> dict:
    """Convert a Gemini API response to an OpenAI chat.completion payload.

    Extracts text from ``candidates[0].content.parts[].text``, maps
    ``usageMetadata`` to token counts, and normalises ``finishReason``.
    """
    usage_meta = gemini_response.get("usageMetadata") or {}

    openai_response: dict = {
        "id": gemini_response.get("responseId") or f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": gemini_response.get("modelVersion") or "gemini",
        "choices": [],
        "usage": {
            "prompt_tokens": usage_meta.get("promptTokenCount", 0),
            "completion_tokens": usage_meta.get("candidatesTokenCount", 0),
            "total_tokens": usage_meta.get("totalTokenCount", 0),
        },
    }

    candidates = gemini_response.get("candidates")
    if candidates and len(candidates) > 0:
        candidate = candidates[0]
        content_obj = candidate.get("content") or {}
        parts = content_obj.get("parts") or []
        text = "".join(part.get("text", "") for part in parts if isinstance(part, dict))

        finish_reason = candidate.get("finishReason", "stop")
        if isinstance(finish_reason, str):
            finish_reason = finish_reason.lower()

        openai_response["choices"].append({
            "index": candidate.get("index", 0),
            "message": {
                "role": "assistant",
                "content": text,
            },
            "finish_reason": finish_reason,
        })

    return openai_response
