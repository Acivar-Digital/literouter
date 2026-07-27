import asyncio
import os

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider
from pydantic_ai.settings import ModelSettings

# Direct to Google's v1beta/openai endpoint (NOT LiteRouter)
GOOGLE_KEY = os.environ["GOOGLE_API_KEYS"].split(",")[0].strip()
BASE = "https://generativelanguage.googleapis.com/v1beta/openai"


def gemma_4_31b_it() -> Agent:
    model = OpenAIChatModel(
        "gemma-4-31b-it",
        provider=OpenAIProvider(base_url=BASE, api_key=GOOGLE_KEY),
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


async def main():
    agent = gemma_4_31b_it()
    try:
        r = await agent.run("Say OK in one word.")
        print("DIRECT GOOGLE v1beta/openai -> 200 OK")
        print("OUTPUT:", repr(r.output[:150]))
    except Exception as e:
        print("DIRECT GOOGLE v1beta/openai -> ERROR:", type(e).__name__, str(e)[:500])


if __name__ == "__main__":
    asyncio.run(main())
