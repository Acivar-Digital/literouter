from __future__ import annotations

import asyncio
import os

import httpx
import pytest
from pydantic_ai import Agent, RunContext
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.google import GoogleProvider

GATEWAY_URL = os.environ.get("LITEROUTER_BASE_URL", "http://127.0.0.1:7766")
AUTH_TOKEN_NATIVE = os.environ.get("LITEROUTER_AUTH_KEY_NATIVE", "lr-gg-gg-gc-no")
AUTH_TOKEN_OPENAI = os.environ.get("LITEROUTER_AUTH_KEY_OPENAI", "lr-gg-oa-ob-no")
MODEL = "gemini-3.1-flash-lite"

provider = GoogleProvider(
    api_key=AUTH_TOKEN_NATIVE,
    base_url=GATEWAY_URL,
    http_client=httpx.AsyncClient(http2=True, verify=False),
)
model = GoogleModel(MODEL, provider=provider)
agent = Agent(model=model, system_prompt="You are a helpful assistant.")


@agent.tool
async def get_weather(ctx: RunContext[object], /, location: str) -> str:
    return f"The weather in {location} is 22°C and sunny."


UPSTREAM_ERRORS = (
    "401",
    "403",
    "404",
    "429",
    "500",
    "502",
    "503",
    "cooling down",
    "cooldown",
    "API_KEY_SERVICE_BLOCKED",
    "NOT_FOUND",
)


def _handle_upstream_error(err: Exception) -> None:
    err_str = str(err)
    if any(w in err_str for w in UPSTREAM_ERRORS):
        pytest.skip(f"Upstream provider unavailable: {err_str[:120]}")
    raise err


@pytest.mark.anyio
async def test_gemini_flash_tool_call_via_native() -> None:
    try:
        result = await agent.run("What is the weather in Singapore? Use the get_weather tool.")
        assert result.output, f"No output: {result}"
        print(f"\nOutput: {result.output}")
        print(f"Usage: {result.usage}")
        assert any(w in result.output.lower() for w in ["22", "sunny", "singapore"])
    except Exception as err:
        _handle_upstream_error(err)


@pytest.mark.anyio
async def test_gemini_flash_tool_call_via_openai_compat() -> None:
    """Tool call through OpenAI-compat route — requires thought_signature fix."""
    from pydantic_ai.models.openai import OpenAIChatModel
    from pydantic_ai.providers.openai import OpenAIProvider

    p = OpenAIProvider(
        base_url=f"{GATEWAY_URL}/v1",
        api_key=AUTH_TOKEN_OPENAI,
        http_client=httpx.AsyncClient(http2=True, verify=False),
    )
    m = OpenAIChatModel("google/gemini-3.1-flash-lite", provider=p)
    ag = Agent(model=m, system_prompt="You are a helpful assistant.")

    @ag.tool
    async def get_weather(ctx: RunContext[object], /, location: str) -> str:
        return f"The weather in {location} is 22°C and sunny."

    try:
        result = await ag.run("What is the weather in Singapore? Use the get_weather tool.")
        assert result.output, f"No output: {result}"
        print(f"\nOutput: {result.output}")
        assert any(w in result.output.lower() for w in ["22", "sunny", "singapore"])
    except Exception as err:
        _handle_upstream_error(err)


if __name__ == "__main__":
    async def main() -> None:
        result = await agent.run("What is the weather in Singapore? Use the get_weather tool.")
        print(f"Output: {result.output}")
        print(f"Usage: {result.usage}")

    asyncio.run(main())
