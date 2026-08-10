from __future__ import annotations

import asyncio
import os

import pytest
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.google import GoogleProvider

GATEWAY_URL = "http://127.0.0.1:7766"
AUTH_TOKEN = os.environ.get("LITEROUTER_AUTH_KEY")
MODEL = "gemini-3.1-flash-lite"

if not AUTH_TOKEN:
    pytest.skip("LITEROUTER_AUTH_KEY not set", allow_module_level=True)

provider = GoogleProvider(api_key=AUTH_TOKEN, base_url=GATEWAY_URL)
model = GoogleModel(MODEL, provider=provider)
agent = Agent(model=model, system_prompt="You are a helpful assistant.")


@agent.tool
async def get_weather(ctx: RunContext[object], /, location: str) -> str:
    return f"The weather in {location} is 22°C and sunny."


@pytest.mark.anyio
async def test_gemini_flash_tool_call_via_native() -> None:
    result = await agent.run("What is the weather in Singapore? Use the get_weather tool.")
    assert result.output, f"No output: {result}"
    print(f"\nOutput: {result.output}")
    print(f"Usage: {result.usage}")
    assert any(w in result.output.lower() for w in ["22", "sunny", "singapore"])


@pytest.mark.anyio
async def test_gemini_flash_tool_call_via_openai_compat() -> None:
    """Tool call through OpenAI-compat route — requires thought_signature fix."""
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider

    p = OpenAIProvider(base_url="http://127.0.0.1:7766/v1", api_key=os.environ.get("LITEROUTER_AUTH_KEY"))
    m = OpenAIChatModel("google/gemini-3.1-flash-lite", provider=p)
    ag = Agent(model=m, system_prompt="You are a helpful assistant.")

    @ag.tool
    async def get_weather(ctx: RunContext[object], /, location: str) -> str:
        return f"The weather in {location} is 22°C and sunny."

    result = await ag.run("What is the weather in Singapore? Use the get_weather tool.")
    assert result.output, f"No output: {result}"
    print(f"\nOutput: {result.output}")
    assert any(w in result.output.lower() for w in ["22", "sunny", "singapore"])


if __name__ == "__main__":
    async def main() -> None:
        result = await agent.run("What is the weather in Singapore? Use the get_weather tool.")
        print(f"Output: {result.output}")
        print(f"Usage: {result.usage}")

    asyncio.run(main())
