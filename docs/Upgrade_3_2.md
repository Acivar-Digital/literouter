# LiteRouter Version 3.2 Architecture: Engine Logic, Resilience & Model Execution

## Executive Overview

Part 2 details the internal runtime execution engine of LiteRouter v3. Rebuilt from the ground up in Bun/TypeScript, the engine is responsible for:
- Protocol translation and exact completion path routing.
- Network resilience, multi-stage timeouts, ghost-response detection, and mid-stream stall recovery.
- Key pool rotation with reason-aware smart cooldowns, `Retry-After` parsing, and sub-2s grace retries.
- Fusion Sticky Engine (FSE) with 5-minute sticky positions and automatic recovery.
- Global and model-specific reasoning/thought stripping and translation.
- Model discovery (`GET /v1/models` & `GET /v1beta/models`) tailored dynamically to the API key.
- Master model constraints catalog (Dots XML parsing, Thought Signatures, Gemma prompt/turn merging, Dot-prompts).
- Zero-hardcoding configuration architecture (`.env`, `.env.local`, `providers.json`, `fusion.json`).

---

## 1. Explicit Completion Path Resolution (No Hardcoding / Zero Magic Joins)

LiteRouter enforces **Zero Hardcoding** of upstream URLs and completion endpoints:
- The TypeScript engine performs **no string concatenation guessing or ad-hoc URL massaging**.
- Every 2-letter completion code (`ch`, `ms`, `ob`, `gc`, `im`, `em`, `md`) maps to an **exact, fully-qualified completion path** defined in `providers.json`.

### 1.1 `providers.json` Master Registry

```json
{
  "providers": {
    "openrouter": {
      "code": "or",
      "base_url": "https://openrouter.ai",
      "endpoints": {
        "ch": "/api/v1/chat/completions",
        "ms": "/api/v1/messages",
        "em": "/api/v1/embeddings",
        "md": "/api/v1/models"
      },
      "limits": {
        "default": { "rpm": 20, "rpd": 1000, "tpm": 1000000 }
      }
    },
    "nvidia": {
      "code": "nv",
      "base_url": "https://integrate.api.nvidia.com",
      "endpoints": {
        "ch": "/v1/chat/completions",
        "em": "/v1/embeddings",
        "md": "/v1/models"
      },
      "limits": {
        "default": { "rpm": 40, "rpd": 10000, "tpm": 1000000 }
      }
    },
    "zen": {
      "code": "zn",
      "base_url": "https://api.zen.ai",
      "endpoints": {
        "ch": "/v1/chat/completions",
        "md": "/v1/models"
      },
      "limits": {
        "default": { "rpm": 30, "rpd": 5000, "tpm": 1000000 }
      }
    },
    "google": {
      "code": "gg",
      "base_url": "https://generativelanguage.googleapis.com",
      "endpoints": {
        "ob": "/v1beta/openai/chat/completions",
        "gc": "/v1beta/models/{model}:generateContent",
        "em": "/v1beta/models/{model}:embedContent",
        "md": "/v1beta/models"
      },
      "limits": {
        "gemini-2.5-pro": { "rpm": 5, "rpd": 100, "tpm": 250000 },
        "gemini-2.0-flash": { "rpm": 15, "rpd": 1500, "tpm": 1000000 },
        "default": { "rpm": 15, "rpd": 1500, "tpm": 1000000 }
      }
    },
    "anthropic": {
      "code": "an",
      "base_url": "https://api.anthropic.com",
      "endpoints": {
        "ms": "/v1/messages",
        "md": "/v1/models"
      },
      "limits": {
        "default": { "rpm": 50, "rpd": 10000, "tpm": 1000000 }
      }
    }
  }
}
```

---

## 1.2 Inbound Extraction & Outbound Forwarding: Bearer vs URL Methods

LiteRouter bridges the structural difference between HTTP Header authentication and URL query parameter authentication:

### Inbound Key Extraction (Downstream Client $\rightarrow$ LiteRouter)
Downstream clients can send the LiteRouter directive key via any standard mechanism:
1. **OpenAI / OpenCode / Cursor**: `Authorization: Bearer lr-or-oa-ch-no`
2. **Anthropic Claude Code**: `x-api-key: lr-or-cl-ms-no`
3. **Google SDK / Webhooks**: `http://localhost:7766/v1beta/models/...:generateContent?key=lr-gg-gg-gc-no`
4. **Generic Query Parameters**: `http://localhost:7766/v1/chat/completions?api_key=lr-or-oa-ch-no` or `?token=lr-...`

### Outbound Vendor Dispatch (LiteRouter $\rightarrow$ Upstream Vendor)
Once LiteRouter extracts the directive and selects a healthy rotated vendor key from `.env.local`, it transforms the authentication mechanism into **exactly what the upstream vendor requires**:
- **OpenRouter, NVIDIA, OpenAI, Zen**: Attaches `Authorization: Bearer <VENDOR_KEY>` header.
- **Anthropic Direct**: Attaches `x-api-key: <ANTHROPIC_KEY>` and `anthropic-version: 2023-06-01` headers.
- **Google OpenAI-Compat Beta (`/v1beta/openai`)**: Attaches `Authorization: Bearer <GOOGLE_KEY>` header.
- **Google Native RPC (`:generateContent`, `:embedContent`)**: Attaches `?key=<GOOGLE_KEY>` to the outbound Google API URL query parameters.

---

## 2. Dynamic Model Discovery (`GET /v1/models` & `GET /v1beta/models`)

When downstream developer tools (Claude Code, Cursor, OpenCode, LibreChat) boot, they query `GET /v1/models` to discover available models.

LiteRouter dynamically serves the model catalog based on the extracted API key:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       DYNAMIC MODEL DISCOVERY PIPELINE                      │
│                                                                             │
│  Inbound Request: GET http://localhost:7766/v1/models                       │
│  Auth Header: Bearer <key>                                                  │
│        │                                                                    │
│        ├── Key is Direct (e.g. lr-or-cl-ms-no)                              │
│        │     └── Returns models from OpenRouter catalog in OpenAI format    │
│        │                                                                    │
│        ├── Key is Direct (e.g. lr-gg-oa-ob-dp)                              │
│        │     └── Returns Google Gemini models catalog                       │
│        │                                                                    │
│        └── Key is Fusion (e.g. lr-fse-quad)                                 │
│              └── Returns the exact list of models configured under 'quad'   │
│                  inside fusion.json                                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Standardized Discovery Payload Format
Responses adhere to the universal OpenAI `/v1/models` specification:

```json
{
  "object": "list",
  "data": [
    {
      "id": "anthropic/claude-3.7-sonnet",
      "object": "model",
      "created": 1740000000,
      "owned_by": "openrouter",
      "permission": []
    },
    {
      "id": "deepseek/deepseek-r1",
      "object": "model",
      "created": 1740000000,
      "owned_by": "nvidia",
      "permission": []
    }
  ]
}
```

For Google native SDK clients calling `GET /v1beta/models`, LiteRouter returns the native Google JSON schema (`{ "models": [{ "name": "models/gemini-2.5-pro", "displayName": "Gemini 2.5 Pro", ... }] }`).

---

## 3. Reasoning & Thought Management (Stripping vs Translation)

LiteRouter handles thinking and reasoning content through both global defaults and model-specific granular controls.

### 3.1 Global vs Model-Specific Reasoning Behavior
- **Global Setting (`LITEROUTER_STRIP_REASONING=true` in `.env`)**:
  - By default, IDEs and code completions work best with clean code outputs without large thinking blocks polluting downstream context windows.
  - When `true`, LiteRouter removes reasoning blocks before sending responses back to downstream clients.
- **Key Nuance Overrides**:
  - `ts` (**Thought Signature / Preserve Reasoning**): Overrides global strip mode. Extracts reasoning tags (`<think>...</think>`, `reasoning_content`) and maps them to native Anthropic `type: "thinking_delta"` SSE events so Claude Code UI displays the collapsible thinking box.
  - `sb` (**Strip Budget / Force Strip**): Explicitly strips all thinking content and parameters, even if downstream requested it.

### 3.2 Upstream Payload Cleansing (Preventing 400 Bad Request)
- Non-reasoning models (e.g. standard Gemma 2, Llama 3.1, GPT-4o) throw `400 Bad Request: unrecognized parameter` if downstream sends `thinkingConfig`, `thinking: { budget_tokens: 4096 }`, or `reasoning_effort`.
- **How LiteRouter handles this**:
  - Payload transformers check the target model against the model capabilities catalog.
  - If the target model does not support thinking, LiteRouter strips `thinkingConfig`, `reasoning_effort`, and `thinking` parameters before dispatching upstream.
  - If the target model IS a reasoning model (DeepSeek R1, Claude 3.7 Thinking, Gemini 2.5), LiteRouter translates the parameter into what the specific vendor expects (e.g. Anthropic `budget_tokens` $\leftrightarrow$ OpenAI `reasoning_effort` $\leftrightarrow$ Google `thinkingConfig`).

---

## 4. Network Fetcher Lifecycle & Resilience (`src/network/fetcher.ts`)

LiteRouter enforces a multi-tiered timeout and ghost-detection pipeline for all upstream network calls:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            HTTP REQUEST TIMELINE                            │
│                                                                             │
│ 0s                      5s                     30s                     300s │
│ ├───────────────────────┼──────────────────────┼─────────────────────────┤  │
│ ▲                       ▲                      ▲                         ▲  │
│ Request Dispatched      TTFT / First Byte      Stream Idle Timeout       Max│
│                         Timeout (Ghost Guard)  (Stall Resend Guard)      Req│
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Multi-Stage Timeouts
- **First-Byte / TTFT Timeout (`LITEROUTER_NO_RESPONSE_TIMEOUT_MS = 5000ms`)**:
  - Catches upstream connections that accept the TCP socket but hang without emitting any data.
- **Stream Idle / Stall Timeout (`LITEROUTER_STREAM_IDLE_TIMEOUT_MS = 30000ms`)**:
  - Monitored continuously on active SSE streams. If an upstream model stops emitting tokens mid-generation for >30s, the connection is deemed stalled.
- **Maximum Request Timeout (`LITEROUTER_HTTP_TIMEOUT_MS = 300000ms / 5 min`)**:
  - Hard cap on long-running generations.

### 4.2 Ghost Response & Zero-Token Guard
- Upstream APIs (especially under load) occasionally return HTTP 200 with an empty body or empty SSE streams without error messages.
- The fetcher inspects the first chunk buffer with `hasContentToken()`:
  - Validates presence of `delta.content`, `delta.reasoning_content`, `delta.thought`, `delta.tool_calls`, or Gemini `candidates[0].content.parts`.
  - If 0 content tokens are found despite HTTP 200, it throws `NoResponseError` and triggers immediate key rotation.

### 4.3 Ghosting & Mid-Stream Stall Recovery
- If an active stream goes silent for >30s mid-output:
  - The fetcher catches the `NoResponseError`.
  - Attempts seamless in-flight reconnect/resend (`STREAM_STALL_MAX_RESENDS = 2`) on the same key without tearing down the downstream client stream.
  - If retries fail, it closes the stream gracefully with `data: [DONE]\n\n` to prevent client hanging.

### 4.4 Client Abort & Signal Propagation
- Subscribes downstream `req.signal.onabort` (e.g. `Ctrl+C` in Claude Code, "Stop" in Cursor).
- Merges signals via `AbortSignal.any([clientSignal, AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS)])`.
- Aborts upstream `fetch()` instantly upon downstream disconnect, stopping token generation and saving quota.

### 4.5 SSE Keep-Alive Heartbeat
- For deep-thinking models (DeepSeek R1, Claude 3.7 Thinking) that may reason for 15–30 seconds before outputting the first token:
- Injects SSE comment lines (`: keep-alive\n\n`) every `KEEPALIVE_INTERVAL_MS = 15000ms` to prevent intermediate proxies, firewalls, and IDE clients from dropping the socket.

---

## 5. Key Pool Rotation & Smart Cooldown Architecture

LiteRouter manages rotated key pools per provider (`OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS`, `GOOGLE_API_KEYS`, `ZEN_API_KEYS`, etc.) with Valkey/Redis backed state tracking.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            KEY ROTATION WATERFALL                           │
│                                                                             │
│  Incoming Key Directive (e.g. lr-nv-oa-ch-dp)                               │
│        │                                                                    │
│        ▼                                                                    │
│  Select Provider Pool [NVIDIA_API_KEYS: Key #1, #2, #3, #4]                 │
│        │                                                                    │
│        ├── Key #1 (Active) ──► Upstream Call                                │
│        │                          │                                         │
│        │                     HTTP 429 / 5xx                                 │
│        │                          │                                         │
│        │                          ▼                                         │
│        │                    Parse Reset Delay                               │
│        │                    (Retry-After header / quotaResetDelay)          │
│        │                          │                                         │
│        │                    Quarantine Key #1 (Redis EX: computed TTL)      │
│        │                                                                    │
│        └── Rotate to Key #2 ──► Immediate Failover (Zero Client Error)      │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Reason-Aware Cooldown TTLs
When an upstream error occurs, `reportError()` assigns specific cooldown quarantines:

| Error Type | Status Codes | Quarantine Duration | Action |
|---|---|---|---|
| **Rate Limited** | `429`, `rate_limit_exceeded` | `65s` (or parsed `Retry-After`) | Key rotated immediately to next pool member |
| **Transient Server Error** | `500`, `502`, `503`, `504` | `10s` | Quick cooldown for temporary upstream glitch |
| **Auth / Key Revoked** | `401`, `403`, `permission_denied`| `604,800s` (7 days) | Hard quarantine; key marked dead |
| **Client Error** | `400`, `404`, `invalid_request` | **0s (No Cooldown)** | Passed directly to client; not a key fault |
| **Default Fallback** | Other uncategorized errors | `30s` | Safe baseline cooldown |

### 5.2 Upstream `Retry-After` & Google `quotaResetDelay` Parsing
- `parseResetDelay(headers, errText)` extracts precise reset deadlines from:
  1. Standard HTTP `Retry-After` header (seconds).
  2. Google error JSON: `quotaResetDelay` or `retryDelay` regex extraction.
- **Bound Clamping**: Clamped between `5s` (minimum) and `7200s` (2 hours) to avoid rogue upstream headers freezing a key indefinitely.
- **Sub-2s Grace Retry**: If the parsed reset delay is $\le 2\text{s}$, the engine waits via a short `setTimeout` and retries the **same key once** before advancing the rotation index, preventing unnecessary key churn.

### 5.3 Pool-Wide Exhaustion Backoff
- When **all keys** in a provider's pool are concurrently cooling down, the router engages ladder backoff:
  - Step 1: `65,000ms`
  - Step 2: `90,000ms`
  - Step 3: `120,000ms`
- Dispatches `503 Service Unavailable` with `Retry-After` matching the nearest expiring key in the pool.

---

## 6. Rate Limit Distribution (Zdist) & Quota Accounting

LiteRouter tracks rate limit consumption against configured vendor limits:

### 6.1 Rate Limit Tracking Metrics
- **RPM (Rounds / Requests Per Minute)**: Sliding 60-second window per key.
  - *OpenRouter Free/Default*: 20 RPM.
  - *NVIDIA NIM*: 40 RPM.
  - *Zen*: 30 RPM.
  - *Google Gemini*: Per-model (e.g. 5 RPM for 2.5 Pro, 15 RPM for 2.0 Flash).
- **RPD (Rounds / Requests Per Day)**: Daily quota resetting at 00:00 UTC.
  - *OpenRouter*: 1000 RPD.
  - *Google Gemini Free*: 100-1500 RPD depending on model.
- **TPM (Tokens Per Minute)**: Inbound prompt + completion token estimator.

When a specific key approaches its RPM/RPD ceiling, LiteRouter preemptively advances to the next healthy key in the pool before upstream triggers a 429.

---

### 6.2 Google Gemini Free-Tier Quota Registry (RPD > 0 Allowed Models)

Parsed directly from Google AI Studio specifications (`Upgrade_3_gemini.md`), filtering out models with `RPD = 0`:

| Model Name / Identifier | Category | Max RPM | Max TPM | Max RPD | Purpose / Endpoint |
|---|---|---|---|---|---|
| `gemini-3.1-flash-lite` | Text-out | 15 | 250K | 500 | Fast, high-volume code & chat (`ob`, `gc`) |
| `gemini-3.5-flash-lite` | Text-out | 15 | 250K | 500 | High-efficiency lightweight agent reasoning (`ob`, `gc`) |
| `antigravity` | Agents | 60 | 100K | 100 | High-rate agent orchestration |
| `gemini-2.5-flash` | Text-out | 5 | 250K | 20 | General multimodal & code generation |
| `gemini-2.5-flash-lite` | Text-out | 10 | 250K | 20 | Fast text generation |
| `gemini-3-flash` | Text-out | 5 | 250K | 20 | Next-gen fast reasoning |
| `gemini-3.5-flash` | Text-out | 5 | 250K | 20 | Advanced multimodal reasoning |
| `gemini-3.6-flash` | Text-out | 5 | 250K | 20 | Experimental flash reasoning |
| `gemini-3.7-flash` | Text-out | 5 | 250K | 20 | State-of-the-art fast reasoning |
| `gemma-4-26b` | Open Weights | 30 | 16K | 14,400 | Massive daily volume agent execution (`gm` nuance) |
| `gemma-4-31b` | Open Weights | 30 | 16K | 14,400 | Massive daily volume agent execution (`gm` nuance) |
| `text-embedding-004` (Embedding 1) | Embeddings | 100 | 30K | 1,000 | Vector search & embeddings (`em`) |
| `gemini-embedding-2` (Embedding 2) | Embeddings | 100 | 30K | 1,000 | Next-gen vector embeddings (`em`) |
| `gemini-2.5-flash-tts` | Audio TTS | 3 | 10K | 10 | Text-to-speech generation |
| `gemini-3.1-flash-tts` | Audio TTS | 3 | 10K | 10 | Next-gen text-to-speech generation |
| `gemini-robotics-er-1.5` | Robotics | 10 | 250K | 20 | Spatial & embodied reasoning |
| `gemini-robotics-er-1.6` | Robotics | 5 | 250K | 20 | Spatial & embodied reasoning |
| `gemini-robotics-er-2` | Robotics | 5 | 250K | 20 | Advanced spatial reasoning |
| `gemini-2.5-flash-native-audio` | Live API | Unlimited | 1M | Unlimited | Real-time audio streaming |
| `gemini-3-flash-live` | Live API | Unlimited | 65K | Unlimited | Real-time live interaction |
| `gemini-3.5-live-translate` | Live API | Unlimited | 20K | Unlimited | Real-time live translation |

*Note: All models with `RPD = 0` (such as Gemini 2.5 Pro Free or Deep Research Pro) are excluded from the free-tier pool.*

---

## 7. Fusion Sticky Engine (FSE) & Fallback Chains

For keys matching `lr-fse-<preset>`, LiteRouter activates the **Fusion Sticky Fallback** engine.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FUSION STICKY ENGINE (FSE)                          │
│                                                                             │
│  Request: lr-fse-quad (Model: anthropic/claude-3.7-sonnet)                  │
│                                                                             │
│  [Tier 1] OpenRouter (lr-or-cl-ms-no) ──► 429 Rate Limit                    │
│     │                                                                       │
│     ▼ Fallback                                                              │
│  [Tier 2] Anthropic Direct (lr-an-cl-ms-no) ──► 200 OK                      │
│     │                                                                       │
│     ├──► Set Sticky Position = Tier 2 (TTL: 300s / 5 mins)                  │
│     │                                                                       │
│     └──► Subsequent requests for 5 mins START AT TIER 2 directly            │
│          (Prevents repeated 429 battering on Tier 1)                        │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.1 Sticky Fallback Mechanics
- **Problem Solved**: Standard fallback systems retry Tier 1 on every single request. If Tier 1 is rate-limited, every request wastes 2-5 seconds hitting a doomed endpoint before falling back.
- **Sticky State**:
  - When Tier 1 fails and Tier 2 succeeds, LiteRouter sets `sticky_position[preset:model] = (Tier 2, expiry_timestamp)`.
  - **Sticky TTL**: `FUSION_STICKY_TTL_MS = 300000ms` (5 minutes).
  - All subsequent requests for that preset and model bypass Tier 1 and execute directly on Tier 2.
- **Sticky Recovery**:
  - When the 5-minute sticky TTL expires, the next request tests Tier 1 again.
  - If Tier 1 succeeds $\rightarrow$ Sticky state is cleared back to Tier 1.
  - If Tier 1 fails $\rightarrow$ Falls back to Tier 2 and resets the 5-minute sticky timer.

---

## 8. Master Model Constraints Catalog

LiteRouter isolates vendor-specific model constraints in dedicated transformers:

### 8.1 `dp` : Dot-Prompt Constraint
- **Constraint**: OpenAI-compatible wrappers for Gemini, DeepSeek, or NVIDIA reject payloads where `system` prompt is empty string `""` or where the message content is blank.
- **Transformer**: Injects a single dot `.` placeholder to satisfy strict JSON schema validations.

### 8.2 `ts` : Thought Signature Stitching
- **Constraint**: Google Gemini 2.0/2.5 Thinking models emit a cryptographic `extra_content.google.thought_signature` when performing tool calls. In multi-turn conversations, Google's API strictly rejects subsequent requests with `400 INVALID_ARGUMENT` if the previous assistant tool call is missing its signature.
- **Transformer**:
  - `extractThoughtSignature()`: Captures and indexes signatures in memory keyed by tool call ID.
  - `injectThoughtSignature()`: Automatically re-attaches saved thought signatures to all historical assistant tool calls before dispatching to Google.

### 8.3 `gm` : Gemma Turn Alternation & System Prompt Constraint
- **Constraint**: Gemma models strictly forbid the `system` role and disallow consecutive same-role messages (`user` followed by `user`, or `assistant` followed by `assistant`).
- **Transformer**:
  - **System Prompt $\rightarrow$ User Prompt**: Converts any `system` message into a prepended `[System Context: ...]` block inside the first `user` turn.
  - **Turn Merging**: Folds consecutive same-role messages into a single combined message block (`mergeConsecutiveMessages`).
  - **Unsupported Field Sanitizer**: Strips `presence_penalty`, `frequency_penalty`, `thinkingConfig`, and `logit_bias`.

### 8.4 Dots XML Function Calling Adapter
- **Constraint**: Certain open-source or legacy models output tool calls as raw XML text (`<invoke name="...">`, `<dots_function_call>`) instead of structured JSON objects.
- **Transformer**:
  - `parseDotsXml(content)`: Parses XML tool invocations from text in real-time.
  - `createDotsStreamTransformer()`: Intercepts streaming chunks, parses XML tags on the fly, and emits clean OpenAI `tool_calls` delta events while removing raw XML tags from `content`.

### 8.5 LaTeX Normalizer
- Replaces broken, double-escaped LaTeX math formulas (`\times`, `\rightarrow`) generated by certain upstreams into clean Unicode equivalents (`×`, `→`).

---

## 9. Telemetry, Usage & TTFT Tracking

For both streaming and non-streaming requests:

1. **TTFT (Time To First Token)**: Measured from request dispatch timestamp to the first non-empty content chunk received. Logged to console and metrics collector.
2. **Usage Tracking (`sinkUsage`)**:
   - Parses `usage` (OpenAI format) or `usageMetadata` (Google format) from final stream chunks.
   - Records `prompt_tokens`, `completion_tokens`, and `total_tokens` against `(provider, activeKey, modelName)`.
3. **Trace Archive (`logs/traces/`)**:
   - Stores detailed JSON audit traces of inbound requests and outbound responses under `logs/traces/<reqId>.json` (mode `0600`) with automatic directory sandboxing.

---

## 10. Operational Reset & Hard Flush (`GET /reset` or `--flush`)

LiteRouter provides an immediate hard reset mechanism:
- Clears all rate limit counters (RPM / RPD / TPM).
- Unfreezes all quarantined keys (rate-limited, timed out).
- Flushes the active cooldown cache and resets the rotation index to 0.
