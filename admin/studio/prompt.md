# Instruction: Build LiteRouter TypeScript/Bun Proxy (Port 7767)

You are tasked with implementing a TypeScript port of the LiteRouter API Gateway to run natively on the **Bun** runtime on port **7767**.

---

## Core Architectural Requirements

1. **Runtime & Framework:** Use **pure `Bun.serve`** (do not use Elysia, Hono, or any external framework). Implement native HTTP request/response piping and Web Streams.
2. **Port Configuration:** Listen on port **7767**.
3. **Dynamic Configuration via `models.json`:**
   - The TypeScript proxy must **not** hardcode the `MODEL_REGISTRY` mapping.
   - Instead, load `models.json` from the root directory dynamically on startup.
   - The schema of `models.json` is a JSON array of objects:
     ```json
     {
       "system_id": "nvidia/deepseek-ai/deepseek-v4-flash",
       "provider": "nvidia",
       "upstream_id": "deepseek-ai/deepseek-v4-flash",
       "context": 1048576,
       "max_output": 65535
     }
     ```
   - Resolve the target `api_url` dynamically on startup by matching the `provider` and constructing it using the environment variable base URLs (e.g. `NVIDIA_BASE_URL + "/chat/completions"`, `OPENROUTER_BASE_URL + "/chat/completions"`, or `ZEN_BASE_URL + "/chat/completions"`).
4. **API Key & State Rotation (Valkey/Redis):** 
   - Connect to the same Valkey/Redis instance (`REDIS_HOST` defaulting to `127.0.0.1`, `REDIS_PORT` to `6379`).
   - **Must share the exact same DB keys and namespace format** as the Python version:
     - Cooldown key: `cooldown:${provider}:${key_hash}:${model_name}`
     - Minute TPM quota: `quota:${provider}:${key_hash}:${model_name}:tpm:${minute_ts}`
     - Minute RPM quota: `quota:${provider}:${key_hash}:${model_name}:rpm:${minute_ts}`
   - This ensures rotation, cooldown, and quarantine states are fully synchronized in real-time between the Python (7766) and TS (7767) ports.
5. **Configurable Rotation Retry Delay:**
   - Load `LITEROUTER_ROTATE_DELAY_MS` from `.env` (default to 2000ms if missing).
   - If `NoDeploymentsAvailable` is raised (all keys in cooldown or exhausted), the failover retry loop should sleep for `LITEROUTER_ROTATE_DELAY_MS / 1000` seconds before making the next attempt.
6. **Coordinated Start & End (Orchestration):**
   - Create startup and shutdown scripts to manage **both** the Python (7766) and TypeScript (7767) processes together (Option A).
   - Flush Valkey once at coordinated startup, and once at coordinated shutdown.
7. **Isolated & Automated Log Cleaning:**
   - Keep log outputs strictly isolated:
     - Python logs to `logs/literouter.log`
     - TypeScript/Bun logs to `logs/literouter-ts.log`
   - Every time the coordinated shutdown/stop script is executed, automatically clean the entire `logs/` directory (`rm -f logs/*.log logs/*.db`) so that the workspace files remain lean and don't bloat the context window of AI agents.
8. **Protocols:** Support standard OpenAI `/v1/chat/completions` requests. Route correctly, sanitize message payloads (e.g., merging consecutive messages with identical roles, cleaning LaTeX symbols, and handling reasoning formats), and proxy upstream.
9. **No External LLM Calls:** Since LiteRouter is a transparent proxy, it does not perform LLM calls itself (so it does not use `pydantic-ai` or `instructor`). However, it must cleanly forward standard Server-Sent Events (SSE) stream chunks and tool call payloads so that downstream clients using `instructor` or `vercel-ai-sdk` can parse them.

---

## Code Base Reference (Python Context)

The original Python codebase is staged in `admin/studio/upload/`:
- `config.py`: Contains static key validation, model limit definitions, and the `MODEL_REGISTRY` mapping.
- `router.py`: Implements the key rotation, cooldown tracking, error reporting, and Valkey transaction pipeline.
- `main.py`: Implements FastAPI routing, message cleansing, streaming SSE transformations, and failover/retry loop logic.
- `models.json`: The dynamic registry database source of truth.

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
