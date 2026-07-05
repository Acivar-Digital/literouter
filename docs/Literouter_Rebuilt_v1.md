You are a senior principal systems engineer specializing in high-performance Python ASGI architectures, asyncio networking, and API gateways.

### IMPORTANT: Implementation Plan Required First
Before outputting any code, you MUST first write a detailed, step-by-step implementation plan. 
In your plan, outline exactly:
1. How you will handle model-first cooldown keys in `src/router.py` (specifically making rate-limits, timeouts, and auth credentials errors model-aware since some keys have restricted permissions that only grant access to specific models).
2. How you will handle the differentiated routing behaviors:
   - **Google SDK Route (`/v1beta/models/...`)**: Pure, dumb pass-through proxy. Only rotates keys and strips `thinkingConfig` for Gemma requests. Do NOT intercept, modify, or format response bytes. Do NOT try to parse or modify tool calling payloads/chunks.
   - **OpenAI Compatibility Route (`/v1/chat/completions`)**: Intercepts and parses SSE streams to extract Gemini reasoning (`thought`, `reasoning_content`, `thought_summary` inside candidate parts) and translates it to standard OpenAI `choices[0].delta.reasoning_content` delta property.
3. How you will support the **Reasoning Collapsing Toggle** (`LITEROUTER_COLLAPSE_REASONING`) on the `/v1/chat/completions` route to merge reasoning text directly into the standard `content` delta to prevent client-side SDK (like `@ai-sdk/openai-compatible`) crashes if the client lacks reasoning parsing support.
4. How you will handle the **API Key Validation Gates**:
   - **Gate 1 (Static Validator)** in `src/config.py` to discard placeholder configurations at startup.
   - **Gate 2 (Live validation Doctor)** in `src/doctor.py` to probe keys against upstream APIs in parallel before booting.
5. How you will handle Gemma payload cleaning, same-role message block merging, client query parameter forwarding, and memory leak prevention in `src/main.py`.
6. The exact structure and signature of your helper methods.
Do NOT write any code until the implementation plan is fully laid out and completed.

Your task is to write a complete, production-ready, highly optimized first draft of our API Key Rotator proxy named **LiteRouter**. 

Write the implementation across four clean files:
1. `src/config.py` (Configuration & Model Limits)
2. `src/router.py` (Valkey Quota & Model-First Cooldown Manager)
3. `src/main.py` (FastAPI Core, Streaming Normalization, Client Pool, & Failover Loop)
4. `src/doctor.py` (Live API Key Validation Probe Gate)

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
   * `LITEROUTER_COLLAPSE_REASONING` (default: "false") - if "true", automatically merges thought/reasoning blocks into standard content deltas.
   * `{PROVIDER}_API_KEYS`: Comma-separated list of keys loaded dynamically. E.g. `GOOGLE_API_KEYS`, `NVIDIA_API_KEYS`, `OPENROUTER_API_KEYS`.
3. **API Key Static Validator (Gate 1)**:
   * When loading keys from environment arrays, implement a cheap static checker that filters out placeholder or invalid keys.
   * Discard any key that matches common placeholder patterns (e.g., substring match on `"changeme"`, `"placeholder"`, `"your_key"`, `"todo"`, `"xxxx"`, containing `<` or `>`) or has a length of less than 30 characters. Logging statements should warn about any dropped placeholder keys.

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
3. **Google SDK Pass-Through Route (`/v1beta/models/{model_name}:streamGenerateContent` and `:generateContent`)**:
   * **The Dumb Pass-Through Philosophy**: Act as a **pure, transparent forwarding proxy** for response bytes.
   * Do NOT parse, strip, modify, or inspect the response stream bytes. Simply stream the raw bytes back to the client. This avoids corrupting native Google SDK payloads, streaming structures, or tool calling capabilities.
   * On the request side, rotate the key, forward all client query parameters (excluding the rotated `key` param), and strip `thinkingConfig`/`thinking_config` from the JSON body ONLY if the model is a Gemma variant (to prevent upstream engine crashes).
4. **OpenAI Route & Payload Sanitization (`/v1/chat/completions`)**:
   * **Merge Consecutive Messages**: Before sending payloads to Google native/OpenAI endpoints, scan messages and merge consecutive blocks with the identical roles (e.g. user-following-user) to prevent validation crashes.
   * **Streaming Interceptor & Normalizer**:
     - Capture and parse JSON stream chunks line-by-line.
     - Extract Gemini's thinking outputs (e.g. from `thought`, `reasoning_content`, or `thought_summary` attributes inside candidate parts).
     - **Normal Mode**: When `LITEROUTER_COLLAPSE_REASONING` is "false", map reasoning text to standard OpenAI `choices[0].delta.reasoning_content`.
     - **Collapse Mode**: When `LITEROUTER_COLLAPSE_REASONING` is "true", automatically wrap the reasoning text inside `<thought>\n...\n</thought>\n` and append it directly to `choices[0].delta.content` instead (with `choices[0].delta.reasoning_content` set to `None`).
     - **Tool Calling**: Pass through tool calling properties (`tool_calls`, `function_call`) untouched. Do NOT attempt to rewrite or filter them.
     - **Split Stream Yields**: Ensure the final `[DONE]` marker chunk (e.g., `data: [DONE]\n\n`) is yielded as a completely separate, subsequent stream packet rather than being fused with the last content delta packet.
5. **Failover Retry Loop**:
   * Wrap calls in a retry loop (up to 3 attempts).
   * If a key throws a timeout, 429, or auth error, catch it, call `router.report_error(provider, key, error_type, model_name)`, rotate to a new key, and try again seamlessly.
6. **Memory Leak Prevention**:
   * Do not use unbounded lists or dictionaries to record runtime latency or operational metrics history. Any logging or history cache must utilize a bounded deque (e.g. `collections.deque(maxlen=5000)`) to automatically discard older entries and maintain strict memory limits.

---

### File 4: `src/doctor.py`
This script acts as the **Gate 2 Live Validation Gate** and runs prior to server boot.
1. **Parallel Upstream Probing**:
   * Reads the configuration keys for all active providers.
   * Probes each key concurrently by executing a minimal chat completion or stream request against its respective provider endpoint.
2. **Gemini Probe Setup**:
   * When probing Gemini/Google keys, set `max_tokens` (or `maxOutputTokens`) to `100` instead of a low floor (like `1` or `0`) to prevent Google reasoning engines from throwing HTTP 500 error crashes on minimal completions.
3. **Response Classifications**:
   * HTTP `401` (Unauthorized) or `403` Forbidden credentials failures indicate revoked keys.
   * HTTP `429` (Rate-limited) or connection timeouts must NOT trigger a boot failure (they represent active keys that are simply hitting temporary limits).
4. **Enforcing the Gate**:
   * If any key fails Gate 2 live validation, exit with a non-zero exit status (`sys.exit(1)`) to abort server startup.
   * Support a `--force` CLI option to bypass failures and boot regardless.
   * Both `start.sh` and `restart.sh` must execute `uv run python src/doctor.py` and abort launch if it exits with error code 1.

---

Please provide the complete, functional code for all four files. Do not use placeholders or skip helper methods. Ensure that the code uses standard Python asyncio libraries, is clean, and contains descriptive docstrings explaining the integration logic.
