---
name: literouter
description: Use when managing the local LiteRouter API key rotator proxy, starting/stopping the backend service, configuring path routing, testing key rotation, or resolving endpoint format compatibility with OpenCode TUI.
---

# LiteRouter Skill

This skill provides workflow guidance for managing, testing, and debugging the `literouter` local proxy service.

## Core Architecture

LiteRouter acts as a local proxy between client applications (like OpenCode TUI) and upstream LLM providers (like OpenRouter). It performs:
- Load balancing and rotation across a pool of API keys.
- Input body translation (e.g. mapping OpenAI or Responses API payloads to Anthropic Messages formats).
- Graceful degradation to in-memory mode when the Redis distributed state server is unavailable.

## Configuration & Run Commands

- **Start LiteRouter**:
  ```bash
  nohup uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 > logs/literouter.log 2>&1 & echo $! > .literouter.pid
  ```
- **Stop LiteRouter**:
  ```bash
  bash scripts/stop.sh
  ```
- **Check Status**:
  ```bash
  bash scripts/status.sh
  ```
- **View Logs**:
  ```bash
  tail -f logs/literouter.log
  ```

## Mandatory Testing Guidelines
Whenever you are writing, modifying, or testing the LiteRouter proxy service, you MUST read and execute the guidelines in `tests/right-way-test.md` to perform live end-to-end streaming checks against the actual running daemon. DO NOT rely solely on mocked test suites.

## Endpoint Overrides
- **Chat completions**: `/v1/chat/completions` (OpenAI format)
- **Responses API**: `/v1/responses` (OpenCode format; translated to messages format internally)
- **Models**: `/v1/models` (returns OpenRouter's model database)
- **Health**: `/health` (system metadata and key stats)

## Adding New Models

LiteRouter forwards the `model` field from the request to the upstream provider unchanged. To make a model readily usable:

1. **Set a default model for a provider** (optional) via an env var `<PROVIDER>_MODEL`. Example for OpenRouter:
   ```bash
   OPENROUTER_MODEL=minimaxai/minimax-m3
   ```
   This value appears in the `/v1/models` response under the provider’s `model` entry.

2. **Specify additional model parameters** (temperature, max_tokens, top_p, etc.) using the same `<PROVIDER>_` prefix. For example:
   ```bash
   OPENROUTER_TEMPERATURE=1.00
   OPENROUTER_MAX_TOKENS=8192
   OPENROUTER_TOP_P=0.95
   ```
   These are merged into every request for that provider unless overridden by the client payload.

3. **Use arbitrary model identifiers**: clients can send any model name string (e.g., `moonshotai/kimi-k2.6`, `stepfun-ai/step-3.7-flash`). LiteRouter will forward it directly to the upstream service, provided the provider’s API supports it.

4. **Multiple models**: If you need distinct defaults for several models, create additional provider entries with their own base URLs and API keys (e.g., `MINIMAXAI_BASE_URL=...`, `MINIMAXAI_API_KEYS=...`). Then reference them with the prefix `minimaxai` in the model name (`minimaxai/minimax-m3`).

5. **Verify**: After updating `.env`, reload the config or restart LiteRouter, then call `/v1/models` to see the default model listed and confirm the provider appears with the correct key count.
