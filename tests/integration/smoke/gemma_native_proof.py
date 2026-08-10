from __future__ import annotations

import os
from typing import Any

from google import genai
from google.genai import types


def generate() -> None:
    client = genai.Client(
        api_key=os.environ.get("GEMINI_API_KEY"),
    )

    model = "gemma-4-31b-it"
    contents = [
        types.Content(
            role="user",
            parts=[
                types.Part.from_text(text="Say OK in one word."),
            ],
        ),
    ]
    tools: list[Any] = [
        types.Tool(google_search=types.GoogleSearch()),
    ]
    generate_content_config = types.GenerateContentConfig(
        thinking_config=types.ThinkingConfig(
            thinking_level=types.ThinkingLevel.MINIMAL,
        ),
        tools=tools,
    )

    out = []
    for chunk in client.models.generate_content_stream(
        model=model,
        contents=contents,
        config=generate_content_config,
    ):
        if text := chunk.text:
            out.append(text)
    print("".join(out)[:200])


if __name__ == "__main__":
    generate()
