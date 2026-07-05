You are a senior principal systems engineer specializing in high-performance Python ASGI architectures, asyncio networking, and API gateways.

### IMPORTANT: Implementation Plan Required First
Before outputting any code, you MUST first write a detailed, step-by-step implementation plan. 
In your plan, outline exactly:
1. How you will handle model-first cooldown keys in `src/router.py` (specifically making rate-limits, timeouts, and auth credentials errors model-aware since some keys have restricted permissions that only grant access to specific models).
2. How you will handle Gemma payload cleaning, same-role message block merging, and client query parameter forwarding in `src/main.py`.
3. The exact structure and signature of your helper methods.
Do NOT write any code until the implementation plan is fully laid out and completed.

Your task is to write a complete, production-ready, highly optimized first draft of our API Key Rotator proxy named **LiteRouter**. 

Write the implementation across three clean files:
1. `src/config.py` (Configuration & Model Limits)
2. `src/router.py` (Valkey Quota & Model-First Cooldown Manager)
3. `src/main.py` (FastAPI Core, Streaming Normalization, Client Pool, & Failover Loop)

Here are the detailed technical specifications for each file:

---

### File 1: `src/config.py`
This file loads environment variables via `python-dotenv` and defines model characteristics:
1. **Model Limits Database**: A static dictionary mapping model groups to their limits:
   * `"gemma-4-31b"`: max_tpm = 16000, max_rpm = 15, context_window = 16384
   * `"gemini-3.1-flash-lite"`: max_tpm = 1000000, max_rpm = 15, context_window = 1000000
2. **Environment Variables**: Load from `.env`:
   * `LITEROUTER_HOST` (default: "0.0.0.0")
   * `LITEROUTER_PORT` (default: 7766)
   * `LITEROUTER_AUTH_KEY` (bearer key to authorize clients calling LiteRouter)
   * `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` (used to connect to the local Valkey instance)
   * `{PROVIDER}_API_KEYS`: Comma-separated list of keys loaded dynamically. E.g. `GOOGLE_API_KEYS`, `NVIDIA_API_KEYS`, `OPENROUTER_API_KEYS`.

---

### File 2: `src/router.py`
This class manages Key Rotation, Cooldown States, and Quota Limits. It uses the `valkey` (or `redis`) package to connect to Valkey.
1. **Sliding-Window Token Tracking**:
   * Implement a token-estimation heuristic: `estimated_tokens = len(prompt_characters) // 4 + max_tokens`.
   * For the chosen Key $K$ and specific model, write rolling token usage into Valkey keys named `quota:{provider}:{key_hash}:{model_name}:tpm:minute_timestamp` and `quota:{provider}:{key_hash}:{model_name}:rpm:minute_timestamp` with a 60s TTL.
2. **Model-First Cooldown & Quarantine**:
   * All cooldowns and quarantines are model-scoped: `report_error(provider, key, error_type, model_name)`.
   * **Model-Specific Cooldown**: For rate limit (`429`) or connection `timeout`, set cooldown strictly for that model: `cooldown:{provider}:{key_hash}:{model_name}` in Valkey/Redis with a TTL (60s for 429, 10s for timeout).
   * **Model-Specific Quarantine**: For auth or permissions failures (`401` or `403`), quarantine the key strictly for that model: `cooldown:{provider}:{key_hash}:{model_name}` with a 7-day TTL (604800s). This ensures a key that lacks access to one model is not tried again for that model, but remains available for other models it has access to.
3. **Get Available Key**:
   * `async def get_available_key(self, provider: str, model_name: str, estimated_tokens: int) -> str`
   * Check each candidate key's status. **Skip** the key if the model-specific cooldown key (`cooldown:{provider}:{key_hash}:{model_name}`) exists.
   * If the key is clean, check its rolling TPM/RPM usage for this model in Valkey against the limits configured in `src/config.py`.
   * Return the first key that has remaining quota. If all are exhausted or in cooldown, raise `NoDeploymentsAvailable`.

---

### File 3: `src/main.py`
The FastAPI application.
1. **Persistent Connection Pool**:
   * Define a global `httpx.AsyncClient` inside a FastAPI `lifespan` context manager to reuse a single connection pool.
2. **API Routes & Gateway Access**:
   * Secure all endpoints (`/v1/chat/completions`, native Google rest endpoints) using `LITEROUTER_AUTH_KEY` validation.
3. **Payload Sanitization & Merging for Google/Gemma**:
   * **Merge Consecutive Messages**: Before sending payloads to Google native/OpenAI endpoints, scan messages and merge consecutive blocks with the identical roles (e.g. user-following-user) to prevent validation crashes.
   * **Gemma Payload Fixes**: If the model is a Gemma variant, automatically strip `thinkingConfig` / `thinking_config` or `systemInstruction` parameters that cause Gemini engine errors, and prepend/merge system contents into standard user messages if needed.
4. **Query Parameter Forwarding**:
   * In native Google endpoints (`/v1beta/models/{model_name}:streamGenerateContent` and `:generateContent`), extract and forward all client query parameters (excluding the `key` parameter which is populated by rotation).
5. **Streaming Interceptor & Normalizer**:
   * Capture and parse JSON stream chunks line-by-line.
   * Normalize reasoning/thinking outputs to OpenAI's standard structure, mapping candidate parts `thought` or `reasoning_content` to `choices[0].delta.reasoning_content`.
6. **Failover Retry Loop**:
   * Wrap calls in a retry loop (up to 3 attempts).
   * If a key throws a timeout, 429, or auth error, catch it, call `router.report_error(provider, key, error_type, model_name)`, rotate to a new key, and try again seamlessly.

---

Please provide the complete, functional code for all three files. Do not use placeholders or skip helper methods. Ensure that the code uses standard Python asyncio libraries, is clean, and contains descriptive docstrings explaining the integration logic.
