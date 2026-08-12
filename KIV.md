# 📌 KIV (Keep In View) - Deferred Features & Community Proposals

This document tracks candidate features that are **not currently part of LiteRouter core**, but are kept in view for potential future adoption if there is sufficient community interest and clean pull requests.

---

## 🤝 Contribution & PR Policy

LiteRouter is intentionally designed as a lean, sub-millisecond, zero-dependency Bun proxy with Valkey-backed multi-key rotation. 

- **Want a feature listed here?** If there is enough community demand, open an issue or submit a Pull Request.
- **PR Criteria**: PRs must not introduce heavy external dependencies, ORMs, or degrade streaming proxy latency. All PRs must pass `bun test` and strict code hygiene gates.

---

## 📋 Feature Candidates in View

### 1. Native Anthropic Messages API (`/v1/messages` / `/anthropic/v1/messages`)

* **Current LiteRouter Status**: LiteRouter primarily routes OpenAI-compatible chat completions (`/v1/chat/completions`) and Google Gemini native interactions. Clients using Claude typically connect via OpenRouter or standard OpenAI compatibility bridges.
* **Proposal**: Add a direct translator / handler for the Anthropic Messages API schema (`/v1/messages`) allowing tools like Claude Code to connect directly using `@anthropic-ai/sdk`.

#### 🤖 AI Builder Prompt for Users & Contributors
If you or your team need native Anthropic Messages support immediately, copy and paste the prompt below into your AI coding assistant (Cursor, OpenCode, Claude Code, Windsurf) to generate the implementation for your fork or to prepare a PR:

```text
Act as a Principal TypeScript Engineer working on the LiteRouter codebase (Bun + TypeScript).
Task: Implement a native Anthropic Messages endpoint (/v1/messages and /anthropic/v1/messages) in src/index.ts or src/transformers/anthropic.ts.

Requirements:
1. Accept requests matching Anthropic Messages API specification:
   - Body format: { model: string, messages: Array<{ role: string, content: string | Array<any> }>, system?: string, stream?: boolean, max_tokens: number }
   - Headers: x-api-key or Authorization: Bearer, anthropic-version
2. Support two execution modes:
   - Direct Pass-Through: If provider is Anthropic (ANTHROPIC_API_KEYS configured), inject rotated x-api-key and forward directly to https://api.anthropic.com/v1/messages.
   - Cross-Provider Translation: If model targets an OpenAI/OpenRouter model, translate Anthropic schema to OpenAI chat completion schema, stream back SSE translated to Anthropic message_start, content_block_delta, message_stop events.
3. Zero new npm dependencies: Use Bun native fetch and TransformStream.
4. Ensure full compatibility with Valkey/Redis multi-key rotation and cooldown tracking.
5. Add comprehensive unit tests in tests/unit/core/anthropic.test.ts verifying both streaming and non-streaming responses.
```

---

### 2. Upstream Latency-Aware Best-Fit Routing

* **Proposal**: Track rolling P95 response latencies per provider key and route non-streaming requests to the lowest-latency healthy endpoint.
* **Tradeoff**: Adds Valkey ZADD score computations per request. Under evaluation for high-concurrency multi-region deployments.
