# LiteRouter ACP Protocol & API Key Routing Implementation

## Overall Architecture & Flow
LiteRouter acts as a proxy that translates modern AI SDK requests into standard upstream provider calls (like OpenRouter or Nvidia). 
The flow is:
1. **Client Request**: Receives a request on either `/v1/chat/completions` (standard OpenAI) or `/v1/responses` (ACP protocol).
2. **Provider Selection**: Routes the request based on the model name (e.g., `nemo` -> Nvidia, others -> OpenRouter).
3. **Key Rotation & Concurrency**: Uses an in-memory `KeyRotator` to cycle through available API keys. It employs `asyncio.Lock` per provider to prevent deadlocks and respect rate limits.
4. **Sanitization**: Standardizes input blocks (e.g., converting `input_text` to `text`).
5. **Streaming Translation**: Connects to the upstream provider, streams byte chunks, decodes them into lines, and translates the standard upstream SSE events into the requested protocol format before yielding them back to the client.

## Implementing API Key Routing
- We maintain a list of API keys for each provider (OpenRouter, Nvidia, Anthropic).
- `KeyRotator` cycles through these keys sequentially.
- **Concurrency Control**: A single global lock was causing deadlocks when one provider hung, stalling the other. We replaced this with provider-specific locks (`self.locks = defaultdict(asyncio.Lock)`), isolating provider queues so a bottleneck in OpenRouter doesn't impact Nvidia requests.
- **Rate Limiting**: `TokenBucketRateLimiter` enforces delays between requests to prevent upstream 429s.

## ACP Protocol (`/v1/responses`) Implementation
The ACP (Agentic Communication Protocol) requires a highly specific lifecycle for Server-Sent Events (SSE) that differs significantly from standard OpenAI streaming.

### What We Tried and What FAILED (Do Not Repeat)

1. **Chunk-based buffering string replacements (Failed)**
   - *Attempt*: Modifying `httpx` byte chunks directly with string `.replace()`.
   - *Failure*: Byte chunks can split valid JSON strings or UTF-8 characters arbitrarily. Replacing substrings inside random chunks resulted in invalid JSON lines and `JSON parse errors`.

2. **Shadowing Imports inside Generators (Failed)**
   - *Attempt*: Placing `import json` and `import codecs` inside error handling blocks within the `_upstream_stream` generator function.
   - *Failure*: Python scoping rules treat any `import X` inside a function as making `X` a local variable for the *entire* function. When the `is_responses` path tried to use `json.dumps()` before those exception blocks ran, it crashed with `UnboundLocalError: cannot access local variable 'json'`. This swallowed the stream and returned a 500 error that broke the Zod schemas.

3. **Suppressing Empty Lines in SSE (Failed)**
   - *Attempt*: Skipping empty string (`""`) processing by doing `if processed:` truthiness checks.
   - *Failure*: Empty lines are the required SSE delimiter (`\n\n`). By dropping empty strings, consecutive events were concatenated into a single unbroken string (e.g., `data: {...}data: {...}`), causing catastrophic JSON parsing failures in the client.

4. **Sending Deltas Without Announcing Items (Failed)**
   - *Attempt*: Sending `response.created`, immediately followed by `response.output_text.delta`, and ending with `response.completed`.
   - *Failure*: The client SDK requires the full ACP lifecycle. Without first registering the item and its content part, the client throws `"text part ... not found"` because the deltas have no parent structure to attach to.

### The Correct Method (What Works)

1. **Line-Buffered Decoding**:
   - Use `codecs.getincrementaldecoder("utf-8")()` and buffer the stream until a `\n` is encountered.
   - Only process **complete lines**, ensuring JSON parsing is always safe.

2. **Explicit Sentinel Returns**:
   - The sanitizer function must return `None` to explicitly signal "skip this line" vs `""` to signal "preserve this empty line (SSE delimiter)".

3. **Full ACP Lifecycle Implementation**:
   - To satisfy the ACP Zod schemas, the stream MUST emit events in this exact order with a stable `item_id`:
     1. `response.created` (Initialization)
     2. `response.output_item.added` (Announce the message block)
     3. `response.content_part.added` (Announce the text part inside the message)
     4. `response.output_text.delta` (N events - stream the actual tokens)
     5. `response.output_text.done` (Finalize text part with accumulated full text)
     6. `response.content_part.done` (Finalize content part)
     7. `response.output_item.done` (Finalize the message block)
     8. `response.completed` (Finalize the stream)

4. **Self-Terminating Events**:
   - Each yielded event must end with a clean `\n\n` to guarantee SSE separation, regardless of how the upstream chunks arrive.

## Configuration Standards
- **Client Identification**: Health checks and downstream API requests (like those in `doctor.py`) must include a proper `User-Agent` header (e.g., `User-Agent: LiteRouter/2.2`) to prevent upstream API gateways from rejecting the requests.
- **Model Metadata Trackers**: Experimental and free-tier "Zen models" are explicitly tracked using discrete JSON catalogs (e.g., `models/zen_models.json`) to prevent pollution of the core provider configurations. Ensure JSON configurations strictly follow standards (no trailing commas) as LiteRouter's strict parser will fail on malformed definitions.
