# LiteRouter Test Suite

This directory contains the testing suite for the LiteRouter Bun gateway (port 7766).

## Directory Structure

* `unit/core/gateway.test.ts` — **Bun/TypeScript Unit Tests**: Pure gateway logic from `src/lib.ts` (no network, no server). Run with `bun test`.
* `integration/` — **Live Gateway Tests**: Tests requiring a running LiteRouter gateway (port 7766).
    * `smoke/`: Dual-downstream smoke checks — pydantic-ai OpenAI-compat (`/v1/chat/completions`) and OpenCode native (`/v1beta/models/<model>:generateContent`). Skip automatically if the gateway is down or keys are absent.
    * `matrices/`: Model-specific permutations and pass-through matrices.
    * `auth/`: Key validation and rate-limiting behaviors.

## How to Run

### Unit tests (TypeScript, no network)
```bash
bun test                        # all bun tests
bun test tests/unit/core/      # gateway pure-logic suite
```

### Integration smoke (requires running gateway)
```bash
uv run pytest tests/integration/                       # all integration
uv run pytest tests/integration/smoke/                 # dual-downstream smoke
# Env: LITEROUTER_BASE_URL (default http://localhost:7766), LITEROUTER_AUTH_KEY
```
