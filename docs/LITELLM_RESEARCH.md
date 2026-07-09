# 🔬 LiteLLM Research: Stream Translation & Reasoning Normalization

We researched the open-source **[BerriAI/litellm](https://github.com/BerriAI/litellm)** repository to study how the industry standard normalizes streaming responses and handles thinking/reasoning tokens. Below is our architectural analysis and findings.

---

## 1. Streaming Normalization Pipeline

LiteLLM acts as a transparent translator. It takes streaming chunks from upstream providers (e.g. Gemini, Anthropic, Ollama) and maps them into a standard **OpenAI Chat Completion Chunk** structure before yielding them to clients.

### The Unified OpenAI Chunk Structure
LiteLLM transforms every outgoing chunk delta to strictly match this format:
```json
{
  "id": "chatcmpl-unique-id",
  "object": "chat.completion.chunk",
  "created": 1719600000,
  "model": "gemini-2.5-pro",
  "choices": [
    {
      "index": 0,
      "delta": {
        "role": "assistant",
        "content": "standard content output",
        "reasoning_content": "thinking process tokens"
      },
      "finish_reason": null
    }
  ]
}
```

---

## 2. How LiteLLM Handles Reasoning/Thinking Tokens

LiteLLM does **not** collapse reasoning tokens into the `content` field. Instead, it extracts thinking tokens from provider-specific response payloads and populates the native OpenAI parameter: **`reasoning_content`**.

### upstream Provider Implementations:

#### A. Gemini (`litellm/llms/gemini.py`)
In models supporting thinking (like Gemini 2.0 Flash/Pro with thinking mode enabled), Gemini streams thinking blocks inside the candidate parts. LiteLLM intercepts these and maps them:
* **Gemini Upstream Fields**: Checks `part.thought` or `part.text`.
* **LiteLLM Mapping**:
  ```python
  # If the part contains the 'thought' attribute, it is mapped to 'reasoning_content'
  if hasattr(part, "thought") and part.thought:
      delta["reasoning_content"] = part.thought
  # Standard output is mapped to 'content'
  elif hasattr(part, "text") and part.text:
      delta["content"] = part.text
  ```

#### B. OpenAI-Like / DeepSeek (`litellm/llms/openai.py`)
DeepSeek and other OpenAI-compatible APIs stream thinking tokens via `choices[0].delta.reasoning_content`. 
* LiteLLM passes `reasoning_content` directly through from the upstream response stream:
  ```python
  reasoning_content = choice.get("delta", {}).get("reasoning_content", None)
  if reasoning_content is not None:
      delta["reasoning_content"] = reasoning_content
  ```

---

## 3. How We Can Apply This to LiteRouter

Since we want to resolve client-side errors and make thinking mode work flawlessly, we should follow LiteLLM's normalization pattern.

### Step 1: Standardize our Generator (`src/main.py`)
Ensure `_fix_streaming_line()` is configured to support the standard `reasoning_content` field. This ensures that any upstream thinking tokens (from OpenRouter or Nvidia) are parsed and cleanly structured in the outgoing OpenAI chunk:

```python
# Extract reasoning content from upstream
delta = choice.get("delta", {})
reasoning = delta.get("reasoning") or delta.get("reasoning_content") or ""

# Map to standard OpenAI parameter
if reasoning:
    delta["reasoning_content"] = reasoning
```

### Step 2: Option to Collapse (For Non-Compatible Clients)
If your downstream client (e.g., OpenCode/Vercel AI SDK) does not support or render the `reasoning_content` block, we can provide a config setting (`LITEROUTER_COLLAPSE_REASONING=true`) to dynamically map it into `content`:

```python
# If collapsing is active, map reasoning directly to output text
if COLLAPSE_REASONING:
    delta["content"] = reasoning
else:
    delta["reasoning_content"] = reasoning
```

This dual-mode approach keeps LiteRouter's protocol clean while maintaining maximum flexibility for whatever client is consuming the stream.

---

## 4. How LiteLLM Handles Gemini's Thinking Signature Configuration

In Google's native Gemini API (using the `v1beta` models), enabling chain-of-thought/thinking mode requires translating standard request structures into Google-specific parameters inside the `generationConfig` payload.

### The Upstream Config Translation (`litellm/llms/gemini.py`)
LiteLLM intercepts the user's incoming request parameters (which typically use OpenAI-like or generic dict formatting under `thinking_config`) and translates them directly to target Gemini API specifications:

```python
# Extract and parse thinking parameters
if "thinking_config" in kwargs:
    thinking_config = kwargs["thinking_config"]
    
    # 1. Map include_thoughts parameter
    if "include_thoughts" in thinking_config:
        generation_config["include_thoughts"] = thinking_config["include_thoughts"]
        
    # 2. Map thinking token budget (translating budget_tokens -> thinking_budget)
    if "budget_tokens" in thinking_config:
        generation_config["thinking_budget"] = thinking_config["budget_tokens"]
```

### Key Differences & Mapping Matrix
When configuring LiteRouter or OpenCode endpoints to pass these settings, this is how parameters map downstream to upstream:

| Client Request Parameter (OpenAI style) | Translated Gemini API Parameter | Purpose |
| :--- | :--- | :--- |
| `thinking_config.include_thoughts` | `generationConfig.include_thoughts` | Boolean to toggle chain-of-thought streaming on/off. |
| `thinking_config.budget_tokens` | `generationConfig.thinking_budget` | Integer specifying the maximum token headroom allowed for reasoning. |

---

## 5. Concurrency Tracking Architecture

LiteLLM implements concurrency tracking to manage load distribution across API keys, preventing keys from being overwhelmed.

### A. Active Request Tracking
* **The Counter**: LiteLLM tracks the number of active, in-flight requests per individual API key/deployment.
* **Storage Backend**: It utilizes an in-memory dictionary for single-instance routing, or a Redis/Valkey hash (using atomic increments `HINCRBY`) when running in a distributed/multi-process proxy cluster environment.
* **Routing Strategy Integration**: In the `"least-busy"` routing strategy, LiteLLM queries the active request counts for all configured keys in a model group and routes the incoming request to the key with the lowest active request count.

---

## 6. Rotation, Cooldowns, and Failover Logic

LiteLLM handles key failures dynamically, incorporating automatic cooldown quarantines and retry mechanisms.

### A. Failure Detection & Error Mapping
When a request fails, LiteLLM catches the exception and inspects the error category:
* **429 (RateLimitError) / 503 (Temporary Overload)**: Places the key into a temporary cooldown state.
* **401 (AuthenticationError)**: Places the key into a permanent quarantine state.
* **Timeouts / Connection Failures**: Places the key into a short cooldown state.

### B. Cooldown Management
* **quarantine list**: Triggers `self.set_cooldown(deployment_id, cooldown_time)`.
* **State TTL**: Stores the cooldown state inside memory or Valkey with a Time-To-Live (TTL) matching the configured `cooldown_time` (e.g. 60 seconds).
* **Active Pool Filtering**: When the Router runs `get_available_deployment()`, it filters out any keys/deployments currently listed in the cooldown list. If all keys are locked, it raises a `NoDeploymentsAvailable` exception.

### C. Transparent Automatic Retries
If the client request specifies `num_retries` (e.g. 3 retries):
1. **Key Failure**: The router catches the request exception on Key A.
2. **Quarantine**: Key A is immediately added to the cooldown database.
3. **Failover**: The router dynamically selects Key B (which is not in cooldown) and re-executes the request.
4. **Transparency**: The client receives a successful response, completely unaware that a key failure occurred in the background.

---

## 7. Token Window & Max Output Token Management

LiteLLM implements static metadata lookups, client-side input validations, and parameter translations to manage model context bounds.

### A. Context Metadata Lookups
LiteLLM ships with a built-in model registry database (`model_prices_and_context_window.json`). For each model ID, it registers:
* **`max_tokens`**: The total input + output token budget (e.g. 1,000,000 for Gemini 1.5 Pro).
* **`max_output_tokens`**: The upper limit of tokens returned in a single response (e.g. 8,192).

### B. Fail-Fast Context Window Verification
Before submitting any request to upstream APIs, LiteLLM calculates prompt tokens using tiktoken (for OpenAI) or Hugging Face tokenizers:
$$\text{Calculated Prompt Tokens} + \text{max\_tokens (Requested)} > \text{Model Context Window Limit}$$
If this inequality holds true, LiteLLM immediately throws a `ContextWindowExceededError` client-side, bypassing the network request entirely to save API keys from failing or wasting billing quotas.

### C. Dynamic Parameter Translation
To standardise output limits, LiteLLM translates the standard OpenAI token limits to the target provider's custom parameter names:
| Standard Client Request Field | Target API Field | Provider |
| :--- | :--- | :--- |
| `max_tokens` or `max_completion_tokens` | `generationConfig.maxOutputTokens` | **Google Gemini** |
| `max_tokens` | `max_tokens` | **Anthropic** |
| `max_tokens` | `max_tokens` | **OpenAI** |

---

## 8. Token-Per-Minute (TPM) Quota Routing (Application to Gemma 31B)

For models with strict rate limits (such as Gemma-4-31B which enforces a 16K Token-Per-Minute limit per developer API key), LiteRouter can implement a local sliding window token-tracking limiter using Valkey to load-balance requests based on remaining token quota.

### A. Lightweight Token Estimation
To calculate request weight without loading heavy native tokenizers into the proxy memory, we can estimate input tokens using a standard heuristic:
$$\text{Estimated Request Tokens} = \frac{\text{len(Prompt Characters)}}{4} + \text{max\_tokens (Requested)}$$
This lightweight heuristic executes instantly (< 1ms) and provides a safe buffer threshold.

### B. Sliding Window Tracking via Valkey
We track rolling token consumption per API key in Valkey:
1. **Dynamic Quota Buckets**: Consumed tokens are recorded in key-value store hashes with keys structured as `quota:key_id:timestamp_minute` with a 60-second time-to-live (TTL).
2. **Pre-Flight Validation**: Before sending a request to key $K$, the router checks the current rolling token count:
   $$\text{Current Usage} + \text{Estimated Request Tokens} > 16,000$$
3. **Smart Failover**: If the limit is exceeded, Key $K$ is bypassed. The router tests subsequent keys in the rotation.
4. **Fail-Fast Rejection**: If all keys in the pool are exhausted, LiteRouter rejects the request immediately, returning a standard HTTP `429 Too Many Requests` warning to the IDE client without hitting or overloading the upstream provider.

---

## 9. Design Philosophy: Model-Centric Rules vs. Key-Centric Tracking

To implement quota-based routing cleanly, LiteRouter utilizes a **hybrid design pattern** that splits responsibilities between model characteristics and key performance metrics.

```
Incoming Request ──► [ Model-Centric Rules ] ──► Establishes limits (e.g. Gemma 31B = 16K TPM)
                             │
                             ▼
                     [ Key-Centric Router ]  ──► Filters & rotates keys based on rolling usage in Valkey
```

### A. Model-Centric Rules (The "What")
Rate limit boundaries and context size metrics are characteristics of the **model** itself, not the authorization key. 
* We define model characteristics (such as max TPM, max RPM, and context window limits) statically in the proxy configuration (e.g. `src/config.py`).
* This establishes the specific "rules" that must be applied to an incoming request based on the `model` parameter.

### B. Key-Centric Tracking (The "Who")
Upstream providers enforce quota usage at the **API key** level (not the model). Therefore, tracking, selection, and rotation must be executed at the key level.
* The router uses Valkey to record in-flight token metrics *per individual key ID*.
* When a request is received, the router:
  1. Inspects the requested model's rules (e.g., 16K limit).
  2. Queries Valkey to check the rolling usage of each key in the pool.
  3. Filters out any keys whose individual usage exceeds the model's limit threshold.
  4. Routes to the best available key and updates its usage statistics.

---

## 10. Concurrent I/O Write Handling

To maintain maximum throughput and avoid blocking request execution loops during metrics logging or database storage, LiteLLM utilizes a non-blocking asynchronous callback pipeline.

### A. Memory-First State Management
To track transient keys (such as active request counters, rotation indexes, and quarantine lists), LiteLLM **bypasses the disk filesystem entirely**:
* **Single Process**: Dict updates are handled directly inside Python's single-threaded event loop (`asyncio`), eliminating race conditions.
* **Distributed Clusters**: LiteLLM offloads state management to Valkey, employing **atomic commands** (such as `HINCRBY` and `EXPIRE`) to mutate counters without using synchronous application-level database locks.

### B. Asynchronous Telemetry Offloading (Callbacks)
For write operations targeting persistent stores (e.g. SQLite databases, Langfuse, or text logs):
* **Non-Blocking Futures**: LiteLLM decouples logging from response delivery. Once the LLM response is returned to the client, logging tasks are scheduled as background tasks using Python's `asyncio.create_task()`.
* **Latency Isolation**: The client never waits for file writes or database transactions to finish, isolating the request's critical path from disk/network I/O latency.

### C. Batched Buffered Writes
For high-traffic logging destinations:
* Metric items are accumulated in-memory within a queue buffer.
* A background event loop flushes these queues in batches (e.g. every 5 seconds or when the queue reaches 100 items), minimizing file system input/output operations (IOPS) and preventing disk write conflicts.

---

## 11. Async Framework Stack & Dependency Analysis (Celery vs. anyio vs. asyncio)

We analyzed the package dependencies and framework choices in LiteLLM to see how they structure their concurrency routines.

### A. Celery Exclusion (Zero External Worker Dependencies)
LiteLLM **does not use Celery** or other heavy distributed task queues (like RQ or Dramatiq). 
* **The Reason**: Celery requires installing and maintaining a message broker (like RabbitMQ) and running separate background worker processes.
* **Alternative Solution**: To keep the proxy ultra-lightweight and single-container compatible, LiteLLM relies entirely on Python's built-in **`asyncio` background tasks** and thread pools (`ThreadPoolExecutor`) to schedule non-blocking callbacks.

### B. anyio vs. asyncio (Sub-dependency Layer)
* **anyio Usage**: LiteLLM has `anyio` in its dependencies, but it is imported **implicitly** as a sub-dependency because they build their proxy server on **FastAPI** and **Starlette**.
* **Direct Implementation**: LiteLLM's developers write native Python **`asyncio`** code (`asyncio.create_task`, `asyncio.sleep`, `asyncio.Lock`, etc.) rather than writing direct `anyio` implementations.
* **Relevance to LiteRouter**: Since LiteRouter is also built on FastAPI, `anyio` is available natively in the workspace. However, writing native `asyncio` code is the preferred standard for direct, simple event loop concurrency.

---

## 12. LiteLLM Backend Module Structure & LiteRouter Gap Analysis

To understand what is missing from LiteRouter and plan our MVP upgrade, we mapped the key architectural modules of the LiteLLM backend:

```
[ Incoming Request ]
         │
         ▼
[ litellm/caching.py ] ──────► Matches cached prompt -> Returns response early
         │ (cache miss)
         ▼
[ litellm/router.py ]  ──────► Translates params & selects healthy rotation key
         │
         ▼
[ litellm/llms/ ]      ──────► Upstream API Call -> Catches provider errors
         │
         ▼
[ litellm/exceptions.py ] ──► Standardizes errors (e.g. Google 429 -> OpenAI RateLimitError)
```

### A. Core Technical Backend Modules

#### 1. Unified Exception Engine (`litellm/exceptions.py`)
* **What it does**: Maps every upstream error (e.g., Anthropic's specific JSON errors, Google Studio's `RESOURCE_EXHAUSTED` responses, or HTTP 403 blocks) into standard, unified exceptions that inherit from OpenAI's error class (like `RateLimitError` or `AuthenticationError`).
* **LiteRouter Gap**: We currently parse status codes directly in main routes. If an upstream provider responds with a successful HTTP status code but embeds an error payload in the response body, LiteRouter might fail to intercept it and skip the cooldown logic.

#### 2. Connection Pool Manager (`litellm/utils.py` / `litellm/router.py`)
* **What it does**: Reuses client instances (`httpx.AsyncClient`) across multiple incoming requests per provider group, leveraging connection pooling and TCP keep-alives.
* **LiteRouter Gap**: In `src/main.py:_stream_request`, we spin up a new `httpx.AsyncClient` context manager per request. Creating and destroying HTTP clients on every query adds a 50ms–150ms connection overhead. We should change this to use a persistent async connection pool.

#### 3. Response Caching Engine (`litellm/caching.py`)
* **What it does**: Intercepts requests before routing. If identical parameters are submitted, it retrieves the cached response directly from Redis/Valkey.
* **LiteRouter Gap**: We currently have no caching layer. Any prompt, even if repeated, is sent upstream to active keys, consuming key quotas.

#### 4. Fallback Router Pools (`litellm/router.py`)
* **What it does**: Allows model groups to have explicit fallbacks (e.g. if Gemma 31B is in full cooldown, fall back automatically to Gemini 3.1 Flash Lite).
* **LiteRouter Gap**: LiteRouter currently only rotates keys within a single provider group. We cannot automatically fall back to a different provider pool if all keys for a target model are rate-limited.

---

## 🏁 Detailed Implementation Plan for LiteRouter MVP Upgrades

We mapped out the concrete python code structures and file locations needed to implement these 4 critical upgrades in LiteRouter:

### 1. Persistent Connection Pool (Low Latency Handshakes)
* **Goal**: Reduce API request latency by 100ms–150ms by keeping TCP handshakes and keep-alives warm across requests.
* **Proposed Implementation (`src/main.py`)**:
  * Instead of using `async with httpx.AsyncClient() as client` inside every `_stream_request` and `_buffered_request` call, we instantiate a global shared client on application startup:
    ```python
    global_client = httpx.AsyncClient(
        limits=httpx.Limits(max_keepalive_connections=50, max_connections=100),
        timeout=httpx.Timeout(60.0, connect=10.0)
    )
    ```
  * During app shutdown, we close it cleanly: `await global_client.aclose()`.

---

### 2. Unified Error Handler & Cooldowns
* **Goal**: Standardise rate limit detection by capturing errors in both HTTP headers (e.g. 429 status codes) and response JSON payloads.
* **Proposed Implementation (`src/main.py` & `src/router.py`)**:
  * Wrap HTTP calls with unified try-except handlers:
    ```python
    def parse_upstream_error(status_code: int, response_text: str):
        # Inspect text for "quota exceeded" or "RESOURCE_EXHAUSTED"
        if status_code == 429 or "RESOURCE_EXHAUSTED" in response_text:
            return "RateLimitError"
        if status_code == 401:
            return "AuthenticationError"
        return "GenericError"
    ```
  * Call `router.report_error(provider, key, error_type)` to place the key on the correct cooldown TTL in Valkey based on the mapped error.

---

### 3. Optional Valkey Cache (Zero-Quota Repetitions)
* **Goal**: Prevent duplicate requests (like identical IDE tests) from eating into your API key token limits.
* **Proposed Implementation (`src/caching.py` & `src/main.py`)**:
  * Create a cache hashing function:
    ```python
    import hashlib
    import json

    def get_cache_key(messages: list, model: str) -> str:
        payload = json.dumps({"messages": messages, "model": model}, sort_keys=True)
        return f"cache:prompt:{hashlib.sha256(payload.encode()).hexdigest()}"
    ```
  * Check the cache in Valkey before routing the request. If the key exists, return it immediately. On successful completion, write the response to Valkey with a configurable TTL (e.g., 1 hour / 3600 seconds).

---

### 4. Transparent Failover & Retry Loop
* **Goal**: Enable automatic, client-invisible recovery when an active API key fails mid-flight or hits a rate limit.
* **Proposed Implementation (`src/main.py`)**:
  * Wrap routing brokers in a simple retry loop:
    ```python
    max_retries = 3
    for attempt in range(max_retries):
        key = router.get_key(provider)
        try:
            # Execute request
            response = await global_client.post(...)
            if response.status_code == 200:
                return response
            # Catch rate limit / error response
            error_type = parse_upstream_error(response.status_code, response.text)
            router.report_error(provider, key, error_type)
        except httpx.RequestError as e:
            router.report_error(provider, key, "TimeoutError")
            
    raise HTTPException(status_code=503, detail="All keys exhausted/cooled down.")
    ```

---

## 13. Pydantic AI 2.0+ Integration & Thought Signatures

We tested Pydantic AI 2.0+ (`pydantic-ai==2.4.0`) integration with Gemini 3.1 Flash Lite. Pydantic AI natively supports separating reasoning logs from the final text response.

### A. The Native Response Structure
When executing `agent.run()`, Pydantic AI splits the incoming chunk data stream into a structured array of parts:
1. **`ThinkingPart`**: Contains the raw chain-of-thought markdown text.
2. **`TextPart`**: Contains the final output string and a metadata field containing Google's cryptographic **`thought_signature`**.

```python
ModelResponse(
    parts=[
        ThinkingPart(content='**My Concise Explanation**\n\nphysics – Rayleigh scattering is the key...'),
        TextPart(
            content="The sky appears blue...", 
            provider_name='google', 
            provider_details={'thought_signature': 'EuIGCt8GAQw51sdLz94S3...'}
        )
    ]
)
```

### B. The Thought Signature Mechanism
When Google Gemini generates a response containing reasoning, it embeds a `thought_signature` token.
* **Why it matters**: In subsequent conversational turns, the client **must pass the `thought_signature` back to Google** inside the history payload. If the signature is dropped or modified, the model fails to continue the chat session or crashes with a validation error.
* **OpenAI Translation**: Since Pydantic AI communicates with proxies via standard OpenAI endpoints (where thinking is mapped to `reasoning_content`), our reconstructed proxy must ensure that it exposes `reasoning_content` in the standard completions response payload. Pydantic AI maps `reasoning_content` directly to its internal `ThinkingPart` parser.


---

## 14. Native Google v1beta Routing for Tool Calling & Thinking Mode (Option A)

When building complex agent workflows (e.g. OpenCode swarms, Pydantic AI systems) that require **tool calling** with Gemini 3.1 Flash/Pro, the standard OpenAI compatibility layer (`/v1/chat/completions`) has a protocol limitation: it lacks fields to carry Google's cryptographic `thought_signature` back and forth. Dropping the signature on subsequent turns leads to `400 Bad Request` validation errors.

To solve this, LiteRouter supports **Option A**: exposing a native Google API v1beta proxy.

### A. LiteRouter Architecture for Native Proxying
LiteRouter exposes a pass-through route for native Google SDK/client calls:
* Endpoint: `/v1beta/models/{model_name}:streamGenerateContent` (and `generateContent`)
* Flow: LiteRouter intercepts the native Google protocol request, fetches an active Google API key from the Valkey pool, appends it as a query parameter (`?key=...`), and forwards the raw bytes upstream. This preserves all internal payload structures, including tool calls and `thought_signature` metadata.

### B. Client Integration Guide (Pydantic AI)
When initializing models in client code, standard Google API calls must be routed to the LiteRouter proxy.

> [!WARNING]
> The Google GenAI Python SDK automatically appends `/v1beta` to the base URL string. Therefore, when setting up the provider in your code, you must specify the base URL as `http://localhost:7766` (excluding `/v1beta` at the end), otherwise the request path will double to `/v1beta/v1beta/...` and throw a 404.

Here is the correct configuration pattern:

```python
from pydantic_ai.models.google import GoogleModel
from pydantic_ai.providers.google import GoogleProvider

# 1. Define the provider pointing to LiteRouter (excluding /v1beta)
custom_provider = GoogleProvider(
    api_key="sk-lr-8f2a9e3b1c4d7e5f",  # LiteRouter authorization key
    base_url="http://localhost:7766"   # Proxy URL (SDK appends /v1beta)
)

# 2. Instantiate the GoogleModel using the custom provider
model = GoogleModel(
    'gemini-3.1-flash-lite',
    provider=custom_provider
)
```
