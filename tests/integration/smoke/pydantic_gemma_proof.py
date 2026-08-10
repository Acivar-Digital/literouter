from __future__ import annotations

import asyncio
import os

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings

GATEWAY = "http://localhost:7766/v1"
AUTH = os.environ.get("LITEROUTER_AUTH_KEY")


def gemma_4_31b_it() -> Agent:
    model = OpenAIChatModel(
        "google/gemma-4-31b-it",
        provider=OpenAIProvider(base_url=GATEWAY, api_key=AUTH),
        settings=ModelSettings(
            temperature=0.1,
            max_tokens=16000,
            extra_body={
                "google": {
                    "thinking_config": {
                        "thinking_level": "minimal",
                        "include_thoughts": False,
                    }
                }
            },
        ),
    )
    return Agent(model)


async def main() -> None:
    agent = gemma_4_31b_it()
    try:
        r = await agent.run("Say OK in one word.")
        print("RESULT 200 OK")
        print("OUTPUT:", repr(r.output[:120]))
    except Exception as e:
        print("RESULT ERROR:", type(e).__name__, str(e)[:400])


if __name__ == "__main__":
    asyncio.run(main())
