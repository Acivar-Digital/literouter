import asyncio
import json
import os

from pydantic_ai import Agent
from pydantic_ai.models.openai import OpenAIChatModel
from pydantic_ai.providers.openai import OpenAIProvider

GATEWAY = "http://localhost:7766/v1"
AUTH = os.environ.get("LITEROUTER_AUTH_KEY", "sk-lr-8f2a9e3b1c4d7e5f")


def make_agent(model: str):
    m = OpenAIChatModel(
        model,
        provider=OpenAIProvider(base_url=GATEWAY, api_key=AUTH),
    )
    return Agent(m)


async def run_once(model: str, prompt: str, thinking=False, multi=False):
    agent = make_agent(model)
    settings = {"thinking": {"type": "enabled"}} if thinking else {}
    print(f"\n### model={model} thinking={thinking} multi={multi}")
    try:
        r1 = await agent.run(prompt, model_settings=settings if settings else None)
        print("  turn1 OK:", repr(r1.output[:80]))
        if multi:
            r2 = await agent.run(
                "now say the opposite",
                message_history=r1.new_messages(),
                model_settings=settings if settings else None,
            )
            print("  turn2 OK:", repr(r2.output[:80]))
    except Exception as e:
        print("  ERROR:", type(e).__name__, str(e)[:400])


async def main():
    # Gemma + thinking -> user worries about 500
    await run_once("google/gemma-4-26b-a4b-it", "say OK in one word", thinking=True)
    # Gemini-flash + thinking, multi-turn -> thought signature concern
    await run_once(
        "google/gemini-3.1-flash-lite",
        "say OK in one word",
        thinking=True,
        multi=True,
    )


if __name__ == "__main__":
    asyncio.run(main())
