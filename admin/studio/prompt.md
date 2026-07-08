# Instruction: Build LiteRouter TypeScript/Bun Proxy (Port 7767)

You are tasked with implementing a TypeScript port of the LiteRouter API Gateway to run natively on the **Bun** runtime on port **7767**.

## Core Architectural Requirements

1. **Runtime & Framework:** Use **pure `Bun.serve`** (do not use Elysia, Hono, or any external framework). Implement native HTTP request/response piping and Web Streams.
2. **Port Configuration:** Listen on port **7767**.
3. **API Key & State Rotation (Valkey/Redis):** 
   - Connect to the same Valkey/Redis instance (`REDIS_HOST` defaulting to `127.0.0.1`, `REDIS_PORT` to `6379`).
   - **Must share the exact same DB keys and namespace format** as the Python version:
     - Cooldown key: `cooldown:${provider}:${key_hash}:${model_name}`
     - Minute TPM quota: `quota:${provider}:${key_hash}:${model_name}:tpm:${minute_ts}`
     - Minute RPM quota: `quota:${provider}:${key_hash}:${model_name}:rpm:${minute_ts}`
   - This ensures rotation, cooldown, and quarantine states are fully synchronized in real-time between the Python (7766) and TS (7767) ports.
4. **Protocols:** Support standard OpenAI `/v1/chat/completions` requests. Route correctly, sanitize message payloads (e.g., merging consecutive messages with identical roles, cleaning LaTeX symbols, and handling reasoning formats), and proxy upstream.
5. **No External LLM Calls:** Since LiteRouter is a transparent proxy, it does not perform LLM calls itself (so it does not use `pydantic-ai` or `instructor`). However, it must cleanly forward standard Server-Sent Events (SSE) stream chunks and tool call payloads so that downstream clients using `instructor` or `vercel-ai-sdk` can parse them.

---

## Code Base Reference (Python Context)

The original Python codebase is staged in `admin/studio/upload/`:
- `config.py`: Contains static key validation, model limit definitions, and the `MODEL_REGISTRY` mapping.
- `router.py`: Implements the key rotation, cooldown tracking, error reporting, and Valkey transaction pipeline.
- `main.py`: Implements FastAPI routing, message cleansing, streaming SSE transformations, and failover/retry loop logic.

---

## Detailed Implementation Tasks

### 1. Configuration & Model Limits (`ts-src/src/config.ts`)
- Translate the Python `MODEL_REGISTRY`, `MODEL_LIMITS`, `PROVIDER_LIMITS`, and `DEFAULT_LIMITS` data structures.
- Implement `get_model_limits(model_name: string, provider?: string): ModelLimits` to prioritize specific model matching (e.g., `google/gemini-3.1-flash-lite`), then fallback to provider limits (40 RPM for `nvidia`, 20 RPM for `openrouter`), and finally default limits.
- Implement static validation of incoming API keys matching the logic in `static_validate_keys`.

### 2. Valkey Router (`ts-src/src/router.ts`)
- Implement `ModelFirstRouter` class using Bun's native Redis driver (`import { connect } from "bun"` or standard redis connection).
- Implement `getAvailableKey(provider: string, modelName: string, estimatedTokens: number): Promise<string>` matching the atomic pipeline increment (`incrby` TPM and `incr` RPM with 60s expiration).
- Implement `reportError(provider: string, key: string, errorType: string, modelName: string): Promise<void>` supporting standard cooldown mappings (Rate limited: 60s, Timeout/503/504: 10s, Auth/401: 7 days, other errors: 30s).

### 3. Server Core & Streaming (`ts-src/src/main.ts`)
- Implement pure `Bun.serve` startup.
- Validate `Authorization` headers against `LITEROUTER_AUTH_KEY`.
- Implement `_mergeConsecutiveMessages` and `_cleanLatexSymbols` converters.
- Implement the 3-attempt failover retry loop inside standard HTTP handler.
- Use Web Streams / ReadableStream to transform and yield SSE event streams (`data: ...\n\n`) safely, handling reasoning format extraction correctly.

---

## Outsource Compliance Checklist

- **Q1: Are they fully Pydantic v2.0+ compliant?**
  * *Answer:* This is a TypeScript port using pure Bun.serve, so Pydantic is not used. We use typed TypeScript interfaces to enforce safety.
- **Q2: Do scripts involving LLM operations use `pydantic-ai` v2.0+ or `instructor`?**
  * *Answer:* The proxy does not run LLM calls, but must fully support forwarding tool calls and streamed chunks so that downstream clients using `instructor` or `vercel-ai-sdk` can parse them.
- **Q3: Are we cleaning up dead code?**
  * *Answer:* Yes, all legacy, unused variables, and dead code pathways present in the Python reference must be skipped.
- **Q4: Have we considered the upstream and downstream scripts that might need refactoring?**
  * *Answer:* Yes, coordinated startup/shutdown scripts (Option A) will be created to manage both ports.
- **Q5: Under what conditions should we use or avoid Instructor?**
  * *Answer:* We avoid it here as it is a proxy, but we ensure all data streams are perfectly transparent for clients that do use it.
