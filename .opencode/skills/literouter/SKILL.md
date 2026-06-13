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
