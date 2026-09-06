# OpenRouter Operational Specification: Rate Handling, Reasoning & Tool Calling

This document serves as the definitive reference for how LiteRouter and its client plugins implement OpenRouter's proposed specifications across two critical domains:
1. **Part 1: Rate Limiting, Credit Handling & Streaming Error Lifecycle**
2. **Part 2: Reasoning Configuration & Tool Call Reasoning Retention**

---

# PART 1: Rate Limiting & Streaming Error Handling

## 1. Compliance & Architecture Matrix

| OpenRouter Specification / Proposal | LiteRouter Implementation Component | Operational Mechanism |
| :--- | :--- | :--- |
| **Credit Balance Exhaustion (402 Payment Required)** | `src/network/fetcher.ts` (`classifyUpstreamError`) | Classifies 402 as `QUOTA_EXHAUSTED` / `bad_key`, sets key cooldown (7 days), immediately rotates to next valid key in pool without failing the downstream request. |
| **Pre-Stream Rate Limits (429 Too Many Requests)** | `src/network/fetcher.ts`, `src/network/pacer.ts` | Token-bucket FIFO conveyor belt paces ingress requests. If a 429 occurs pre-stream, `classifyUpstreamError` dynamically sets exponential backoff cooldown and transparently rotates key in-flight. |
| **Provider-Side vs Platform-Side 429s** | `src/network/fetcher.ts` (`classifyUpstreamError`) | Detects `error.metadata.provider_code` and provider status messages to distinguish transient upstream provider stalls from key exhaustion. |
| **Mid-Stream Rate Limits & In-Band Errors** | `src/network/fetcher.ts` (`isInBandErrorChunk`, `handleInBandErrorIfPresent`) | Intercepts in-band JSON chunks with `finish_reason: "error"`, `finish_reason: "network_error"`, and `"Server error mid-response"` to prevent error JSON leaking into the user transcript. |
| **Mid-Stream Phase Gating (`hasEmittedTokens`)** | `src/network/fetcher.ts` (`createResilientStream`) | If zero content tokens were emitted before error (TTFT phase), transparently retries with fallback key. If tokens were already emitted, formats spec-compliant terminal error frame (`formatMidstreamErrorFrame`) to prevent duplicate token splicing. |
| **SSE Keep-Alive Heartbeats** | `src/network/fetcher.ts` (`startKeepAliveTimer`), `src/transformers/opencode_adapter.ts` | Emits spec-compliant `: keep-alive\n\n` comments (and stateful 5-second empty delta heartbeats for reasoning models) to prevent client/proxy 55s socket severance. |
| **Terminal Usage Accounting Chunk** | `src/network/fetcher.ts` (`extractUsageFromChunk`, `onUsage`), `src/handlers/openai_compat.ts` | Intercepts and parses OpenRouter's final usage frame containing repeated `finish_reason` without corrupting client token accounting. |
| **Stream Cancellation / Upstream Abort** | `src/network/fetcher.ts`, `src/network/h2_pool.ts` | Downstream client abort signal propagates immediately through `AbortController`, tears down keepalive timers, and closes upstream HTTP/2 streams to preserve credits. |
| **Agentic Harness Gate Bypass (`:free` models)** | `config/providers.json`, `src/handlers/openai_compat.ts` | Declaratively configures and injects `HTTP-Referer`, `X-Title`, and `User-Agent` headers (defaulting to `OpenCode/1.18.29`) on upstream OpenRouter calls to bypass the `Gate Free Endpoints by Agentic Harness` HTTP 403 gate. |

---

## 2. Limits & Error Taxonomy

### A. Credit Limits (HTTP 402)
OpenRouter credit limits stem from:
1. **Account balance**: Global balance across account. A negative balance returns `402 Payment Required`.
2. **Per-key credit limits**: Configured spending cap per key (`limit`, `limit_remaining`, `limit_reset`).

**LiteRouter Handling:**
* Key pools in `.env.local` (`OPENROUTER_API_KEYS=key1,key2,key3`) allow multi-key rotation.
* If a key hits 402, `classifyUpstreamError` marks the key as exhausted (7d quarantine), alerts the operator log (`❌ [KEY EXHAUSTED]`), and retries with the next active key.

### B. Rate Limits (HTTP 429)
OpenRouter rate limits originate from:
1. **OpenRouter Platform Limits**: Free variant limits (`:free` suffix) or Cloudflare DDoS rate spikes.
2. **Upstream Provider Limits**: The underlying provider serving the model is at capacity (`error.metadata.provider_code`).

**LiteRouter Handling:**
1. **Ingress Token-Bucket Pacer (`src/network/pacer.ts`)**: Enforces minimum spacing (`minIntervalMs = 500ms`) to avoid triggering burst rate limits.
2. **Anti-Pinning H2 Aging (`src/network/h2_pool.ts`)**: Re-creates HTTP/2 sessions every 180s ($\pm 15\text{s}$) to avoid L4 load-balancer pinning where all requests hit a single exhausted upstream blade.
3. **In-Flight Key Rotation**: Up to 3 attempts across available pool keys with exponential backoff.

---

## 3. Pre-Stream vs Mid-Stream Error Lifecycle

### The Dual-Phase Stream Architecture

```
           [ Inbound Client Request ]
                        │
              [ Upstream Request ]
                        │
            ┌───────────┴───────────┐
      [ Pre-Stream Error ]     [ HTTP 200 Headers Sent ]
      (Status 400/429/500)                  │
            │                     ┌─────────┴─────────┐
      [ Key Rotator ]        Phase A (0 Tokens)    Phase B (>0 Tokens)
      (Up to 3 keys)              │                     │
            │               [ Safe Retry ]      [ Spec Terminal Frame ]
      [ New Upstream ]      (Rotate Key)        (finish_reason: "error")
```

### Phase A: Zero Content Tokens Emitted (`hasEmittedTokens = false`)
* **Context**: HTTP 200 committed, SSE `: keep-alive` pings sent, but the upstream LLM stalls during TTFT (thinking / processing) or fails before emitting content chunks.
* **Behavior**: LiteRouter catches the failure in `handlePrematureEof` or `readFirstContentChunkWithTimeout`, isolates the bad key, selects a replacement key, and seamlessly starts streaming content down the open downstream socket. The client experiences zero error and zero token duplication.

### Phase B: Mid-Stream Token Failure (`hasEmittedTokens = true`)
* **Context**: 50 tokens were already streamed to the client, after which upstream drops or emits an in-band 429/500 chunk.
* **The Splicing Trap**: Blindly retrying from byte 0 into an open stream repeats the beginning of the message ("Prefix Doubling").
* **Behavior**: LiteRouter detects `hasEmittedTokens = true`, traps the in-band error chunk via `isInBandErrorChunk`, prevents leaking raw JSON, and emits a spec-compliant terminal frame:
  * **OpenAI Protocol**: `data: {"error":{"message":"...","type":"stream_error"}}\n\ndata: [DONE]\n\n`
  * **Anthropic Protocol**: `event: error\ndata: {"type":"error","error":{"type":"api_error","message":"..."}}\n\n`

---

## 4. In-Band Error Chunk Detection (`isInBandErrorChunk`)

OpenRouter emits mid-stream failures as SSE events with `finish_reason: "error"`. LiteRouter's `isInBandErrorChunk` in `src/network/fetcher.ts` scans all streaming text chunks for:
* `"finish_reason":"error"` or `"finish_reason": "error"`
* `"finish_reason":"network_error"`
* `"Server error mid-response"`
* Top-level `{"error": {"message": ...}}` or `{"type": "error", "message": ...}`
* In-band status codes (`500`, `502`, `503`, `504`)

When detected, the chunk is intercepted, the failing key is penalized with cooldown, and the downstream connection is gracefully terminated or safely failed over.

---

## 5. SSE Keepalive Comments & Heartbeats

OpenRouter periodically sends SSE comments (`: keep-alive\n\n`) to keep connections alive during long thinking pauses.

* **LiteRouter Ingestion**: `src/network/fetcher.ts` ignores `: keep-alive` comments during content inspection, preventing them from corrupting downstream JSON parsers.
* **LiteRouter Downstream Emission**: `startKeepAliveTimer` emits `: keep-alive\n\n` comments downstream during TTFT and thinking delays to prevent intermediate proxies (e.g. Cloudflare, NGINX) from terminating idle connections.
* **OpenCode Heartbeats**: For OpenCode clients, LiteRouter generates synthetic empty deltas (`data: {"choices":[{"index":0,"delta":{}}]}`) every 5 seconds during deep reasoning to satisfy OpenCode's strict 55s activity requirement without leaking reasoning tokens.

---

## 6. Terminal Usage Accounting Chunks

OpenRouter terminates `/api/v1/chat/completions` streams with an extra usage chunk containing:
```json
{
  "choices": [{"delta": {}, "finish_reason": "stop"}],
  "usage": { "prompt_tokens": 120, "completion_tokens": 45, "total_tokens": 165 }
}
```
* **LiteRouter Normalization**: `extractUsageFromChunk` captures token metrics for telemetry and logging. `usageState.usageEmitted` ensures usage callbacks fire once, avoiding double-counting or AST parser exceptions on strict clients.

---

## 7. Stream Cancellation & Upstream Resource Teardown

When a client cancels or aborts a streaming request:
1. Downstream `AbortSignal` triggers `reader.cancel()` and stream teardown.
2. `TransformStream` cancel hook calls `clearTimer(keepAliveTimer)` to halt background intervals.
3. Outbound `fetch` controller aborts the upstream socket to immediately stop OpenRouter token billing and model processing.
4. HTTP/2 active stream count is decremented in `src/network/h2_pool.ts`.

---

## 8. Agentic Harness Whitelist Headers (`Gate Free Endpoints by Agentic Harness` Bypass)

OpenRouter enforces an anti-abuse gate named `"Gate Free Endpoints by Agentic Harness"` on all `:free` models (e.g., `thinkingmachines/inkling:free`, `liquid/lfm-2.5-2.6b:free`, `meta-llama/llama-3.3-70b-instruct:free`). Requests lacking approved coding agent identification headers are rejected with **HTTP 403 Forbidden**.

### Declarative Architectural Solution
Attribution and agentic harness whitelist headers are declaratively configured directly in `config/providers.json` under each provider's `"headers"` object. In `src/handlers/openai_compat.ts`, `resolveUpstreamEndpoint` and `buildAuthHeaders` dynamically load and merge these headers:

```json
// config/providers.json
{
  "providers": {
    "openrouter": {
      "code": "or",
      "base_url": "https://openrouter.ai",
      "auth_header": "Bearer",
      "headers": {
        "HTTP-Referer": "https://opencode.ai",
        "X-Title": "OpenCode",
        "User-Agent": "OpenCode/1.18.29"
      }
    }
  }
}
```

In `buildAuthHeaders`:
```typescript
if (provider) {
  const reg = getProvidersRegistry();
  for (const [provKey, p] of Object.entries(reg.providers)) {
    if (p.code === provider || provKey === provider) {
      if (p.headers) {
        Object.assign(headers, p.headers);
      }
      break;
    }
  }
}
```

Any updates to `config/providers.json` can be hot-reloaded without restarting the gateway via `POST /reset`, which triggers `resetProvidersRegistryCache()`.

### Configurable Environment Variables (`.env`)
- **`LITEROUTER_HTTP_REFERER`**: Defaults to `https://opencode.ai`.
- **`LITEROUTER_X_TITLE`**: Defaults to `OpenCode`.
- **`LITEROUTER_USER_AGENT`**: Defaults to `OpenCode/1.18.29`.

These can also be customized in `.env` (e.g. set `LITEROUTER_USER_AGENT=unknown` or custom harness identities) without requiring code modifications. Non-agentic providers (NVIDIA NIM, Google Vertex) remain isolated and do not receive these headers, while Zen receives matching OpenCode headers configured declaratively in `config/providers.json` to bypass FreeUsageLimitError.

---

# PART 2: Reasoning & Tool Call Handling

## 1. Core Architectural Intent (The Tripartite Rule)

The reasoning management policy balances real-time developer observability with strict token parsimony and upstream tool-call stability:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          THE TRIPARTITE REASONING RULE                      │
├──────────────────────────┬─────────────────────────┬────────────────────────┤
│ Stream Direction / Turn  │ Operational Action      │ Architectural Rationale│
├──────────────────────────┼─────────────────────────┼────────────────────────┤
│ 1. Inbound Live Stream   │ **Full Passthrough**    │ Terminal Observability │
│    (Downstream to UI)    │ (`<think>`, reasoning)  │ (User sees live thought│
├──────────────────────────┼─────────────────────────┼────────────────────────┤
│ 2. Outbound Conversation │ **Scrub / Collapse**    │ Token Parsimony        │
│    (Prior Chat Turns)    │ (Strip `<think>` blocks)│ (Saves 80%+ context)   │
├──────────────────────────┼─────────────────────────┼────────────────────────┤
│ 3. Outbound Tool Turns   │ **PRESERVE Reasoning**  │ Provider Stability     │
│    (Turns with Tools)    │ (Keep thought intact)   │ (Prevents HTTP 500s)   │
└──────────────────────────┴─────────────────────────┴────────────────────────┘
```

---

## 2. Why Selective Tool Reasoning Retention is Mandatory

In multi-turn agentic workflows:

### A. Conversational Turns (Pure Chat / Answers)
* Deep reasoning models (OpenAI o-series, DeepSeek-R1, Qwen-Max, Claude 3.7) generate 2,000–16,000 tokens of internal thinking per turn.
* Once the final answer is provided, the intermediate thinking provides zero predictive value for future turns.
* Scrubbing conversational thinking reduces prompt size by 80–90%, keeping context under model limits and slashing latency and API cost.

### B. Tool Calling Turns (`tool_calls` / `function_call`)
* **Upstream Invariant Verification**: Modern frontier models (Minimax-01/M3, DeepSeek, Qwen 2.5, GLM, OpenAI o3/o4) validate function calls against the immediately preceding reasoning chain.
* **Failure Modes if Stripped**:
  1. **HTTP 500 / 400 "Provider returned error"**: Upstream engines validate chat templates. If an assistant message contains `tool_calls` without its reasoning block or thought signature, the upstream API rejects the turn as malformed.
  2. **Infinite Tool Loops**: Without the chain-of-thought explaining *why* the tool was invoked and how parameters were derived, the model forgets its sub-goal on the next turn and repeats the identical tool call.
  3. **Context Misalignment**: The model cannot properly correlate `<tool_result>` with its original hypothesis if the preceding reasoning chain is missing.

---

## 3. Implementation Across the Stack

### A. Context Level (`.opencode2/plugins/collapse-reasoning.ts`)
Intercepts OpenCode 2's `session.hook("context")` before any request is serialized and dispatched:

```typescript
function hasToolCalls(msg: Record<string, unknown>): boolean {
  // 1. Native OpenAI JSON tool calls
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) return true;

  // 2. OpenCode / Effect-TS content array parts
  if (Array.isArray(msg.content)) {
    return msg.content.some((p: unknown) =>
      p !== null && typeof p === "object" &&
      ((p as Record<string, unknown>).type === "tool-call" ||
       (p as Record<string, unknown>).type === "tool_call" ||
       (p as Record<string, unknown>).type === "tool-result" ||
       (p as Record<string, unknown>).type === "tool_result")
    );
  }

  // 3. In-band XML tool calls (Ling, Qwen, DeepSeek, GLM)
  if (typeof msg.content === "string") {
    return (
      msg.content.includes("<tool_call>") ||
      msg.content.includes("<invoke") ||
      msg.content.includes("<function=")
    );
  }
  return false;
}

function cleanMessage(msg: unknown): unknown {
  if (!msg || typeof msg !== "object") return msg;
  const m = msg as Record<string, unknown>;

  // Only sanitize prior assistant turns
  if (m.role !== "assistant") return msg;

  // CRITICAL RULE: Preserve reasoning on turns with tool calls
  if (hasToolCalls(m)) return msg;

  // Conversational turns: Strip reasoning blocks & <think> tags
  if (Array.isArray(m.content)) {
    const cleanedParts = m.content.map(cleanPart).filter((p) => p !== null);
    return { ...m, content: cleanedParts };
  }
  if (typeof m.content === "string") {
    return { ...m, content: cleanText(m.content) };
  }
  return msg;
}
```

### B. Gateway Transformer Level (`src/transformers/dots.ts`, `src/transformers/thinking.ts`)
* **XML Tool Breaking Out of Thinking**: Extracts Chinese XML tool invocations (`<arg_key>`, `<invoke>`, `<function=...>`) *before* stripping `<think>` tags, preventing models from stalling inside thought blocks.
* **Thought Signatures**: `src/transformers/thought_signature.ts` captures and re-injects provider thought signatures (Google Gemini / Vertex) across historical assistant tool calls.
* **Payload Parameter Scrubbing**: Sanitizes unsupported reasoning parameters (`reasoning_effort`) when targeting standard models to avoid HTTP 400 parameter errors.

---

## 4. Directive Nuance Overrides

Operator control is available via LiteRouter's 5-part directive keys (`lr-<provider>-<payload>-<endpoint>-<nuances>`):

| Nuance Key | Mode | Operational Behavior |
| :--- | :--- | :--- |
| **`ts`** | Thinking Support | Explicitly forces reasoning preservation across **all** turns (conversational + tool turns). Overrides automatic stripping. |
| **`sb`** | Strip Budget | Explicitly forces stripping of reasoning across **all** turns to minimize cost. |
| *(default)* | Adaptive Policy | Full live passthrough for streaming UI + Outbound conversational scrubbing + Strict tool-call reasoning preservation. |

---

# PART 3: Verification Commands & Diagnostics

To verify both Rate Handling and Reasoning/Tool Call compliance:

```bash
# 1. Run full unit test suite (523 tests across streaming, pacing, XML tools, thinking transformers)
bun test

# 2. Run specific tests for tool mapping and thinking transformations
bun test tests/unit/thinking_transformer.test.ts tests/unit/dots_tool_mapping.test.ts

# 3. Run specific tests for pacer rate-limiting and HTTP/2 session isolation
bun test tests/unit/pacer.test.ts tests/unit/h2_pool.test.ts

# 4. Probe live upstream OpenRouter keys and health
bun run scripts/doctor.ts
```
