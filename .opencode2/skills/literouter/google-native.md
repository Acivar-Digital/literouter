# Google Native Dumb Forwarder — Architecture, HTTP/2 Pooling, Key Rotation & Runbook

> **CANONICAL LOCATION:** `/home/yapilwsl/arthityap/literouter/.opencode2/skills/literouter/google-native.md`  
> **PURPOSE:** Load this reference whenever troubleshooting or configuring the **Google Native Dumb Forwarder** (`gg`), native Gemini API requests (`/v1beta/models/*`), `@ai-sdk/google` integration, free-tier key pool rotation across `GOOGLE_API_KEYS`, HTTP/2 outbound session pooling, or related streaming telemetry.  
> **ZERO GREP MANDATE:** When diagnosing issues, an engineer or LLM does NOT need to grep or glob the repository; all paths, file lines, schemas, headers, and failure modes are documented here.

---

## 1. Executive Summary & Directive Key

The **Google Native Dumb Forwarder** provides high-throughput, low-latency pass-through for native Google Gemini REST API requests without OpenAI-format schema transformation overhead. It sits between client SDKs (such as Vercel AI SDK `@ai-sdk/google` or the official Google GenAI SDK) and Google's production endpoints at `https://generativelanguage.googleapis.com`.

### Canonical Directive Key

```
lr-gg-gg-gc-no
```

| Segment | Value | Description |
|---|---|---|
| **Provider** | `gg` | Google upstream provider |
| **Payload (Wire)** | `gg` | Native Google Gemini JSON payload format (untouched pass-through) |
| **Endpoint** | `gc` | `generateContent` / `streamGenerateContent` |
| **Nuances** | `no` | Standard nuance (no forced reasoning stripping or special filters) |

### Inbound & Upstream Endpoints

- **Inbound Gateway URLs** (Port `7766`):
  - Streaming: `https://localhost:7766/v1beta/models/{model}:streamGenerateContent?alt=sse`
  - Non-streaming: `https://localhost:7766/v1beta/models/{model}:generateContent`
- **Upstream Target**:
  - `https://generativelanguage.googleapis.com/v1beta/models/{model}:streamGenerateContent?alt=sse`
  - `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- **Key Authentication Delivery**: Client sends the directive key `lr-gg-gg-gc-no` in `Authorization: Bearer lr-gg-gg-gc-no`, in header `x-goog-api-key: lr-gg-gg-gc-no`, or in query parameter `?key=lr-gg-gg-gc-no`. LiteRouter intercepts this directive, strips client authorization headers, and injects a real rotated API key into `x-goog-api-key` upstream.

---

## 2. Architecture & Core Files Map

No searching or guessing required. These are the definitive components governing the Google Native subsystem:

| File | Exact Line / Symbol | Architectural Responsibility |
|---|---|---|
| **`src/handlers/google_native.ts`** | `handleGoogleNative` (`:534`)<br>`attemptNativeForward` (`:508`)<br>`createMonitoredStream` (`:355`) | **The Main Forwarder Engine**: Validates `lr-gg-*` directive, buffers request body upfront for replay, executes attempt loop (up to 3 attempts), sanitizes headers, pacing, dispatches upstream, and wraps the response in a monitored stream. |
| **`src/index.ts`** | `dispatchRoute` (`:204-206`) | **Inbound Route Dispatcher**: Intercepts all paths starting with `/v1beta/models/` and routes them directly to `handleGoogleNative(req, rawKey, reqId)`. |
| **`src/network/fetcher.ts`** | `fetchWithTtftGuard` (`:104`)<br>`executeH2Fetch` (`:407`) | **Transport & TTFT Guard**: Executes the fetch via persistent HTTP/2 session pool, monitors Time-To-First-Token (5s TTFT guard), and tags negotiated protocol (`[Upstream: HTTP/2]`). |
| **`src/network/h2_pool.ts`** | `Http2Pool.acquireSession` (`:61`)<br>`poolKey` calculation (`fetcher.ts:414`) | **HTTP/2 Connection Pooling**: Maintains persistent H2 multiplexed sockets keyed by `https://generativelanguage.googleapis.com#gg:<keyIndex>`. Each key gets its own persistent H2 socket supporting up to 80 concurrent streams with 180s anti-pinning aging. |
| **`src/network/pacer.ts`** | `acquireNativePacer` (`google_native.ts:140`)<br>`getPacerForProvider("gg")` | **Token-Bucket Rate Pacer**: Enforces 2000ms conveyor pacing with bounded dwell to avoid burst 429s on Google Free Tier. |
| **`src/ui/logger.ts`** | `logInbound` (`:97`), `logTtft` (`:143`),<br>`logFinishReason` (`:372`), `logUsage` (`:170`),<br>`logServed` (`:316`), `logLimit` (`:253`) | **Unified Terminal Telemetry**: Emits timestamped column-0 telemetry for incoming directives, upstream TTFT, model tokens, throughput speed (tok/s), and finish reasons. |
| **`config/providers.json`** | `"google"` block (`:43-78`) | **Registry Specification**: Maps base URL `https://generativelanguage.googleapis.com`, endpoint templates, and default RPM/RPD/TPM limits. |

---

## 3. Detailed Business Logic & Mechanics

### 3.1. Upfront Buffer Replay (`req.arrayBuffer()`)
In standard Web API / Fetch specifications, a `Request.body` is a `ReadableStream` that can only be locked and consumed once.
- **Why it matters**: If attempt 1 fails with a retryable error (such as HTTP `429 Too Many Requests` or `503 Service Unavailable`), the forwarder must retry against the next API key in the pool. If the body was streamed directly, attempt 2 would crash with `TypeError: Body has already been consumed`.
- **Implementation** (`src/handlers/google_native.ts:552`):
  ```ts
  bodyBuffer: await req.arrayBuffer(),
  ```
  The request body is buffered into memory once upon entry into `handleGoogleNative`. Subsequent attempts convert this buffer into a reusable payload via `getRequestBody(context.req.method, context.bodyBuffer)`.

### 3.2. Authentication & Header Sanitization
Google Generative Language API is extremely sensitive to mismatched authentication headers. If an OAuth2 `Authorization: Bearer ...` token is passed alongside an API key, Google returns `401 ACCESS_TOKEN_TYPE_UNSUPPORTED`.
- **Upstream Header Stripping** (`src/handlers/google_native.ts:21-26, 93-103`):
  ```ts
  const STRIPPED_UPSTREAM_HEADERS = new Set([
    "authorization",
    "x-goog-api-key",
    "host",
    "content-length",
  ]);
  ```
  Client directive tokens (`lr-gg-gg-gc-no`) are stripped from `authorization` and `x-goog-api-key`.
- **Key Injection**: The rotated real key from `GOOGLE_API_KEYS` is injected upstream via `x-goog-api-key: <rotated_key>`.
- **Identity Encoding**: `accept-encoding: identity` is forced upstream to prevent gzip/brotli chunk compression, ensuring the internal telemetry scanner can inspect raw SSE JSON text.
- **Downstream Header Stripping** (`src/handlers/google_native.ts:27-31, 105-113`):
  ```ts
  const STRIPPED_DOWNSTREAM_HEADERS = new Set([
    "content-encoding",
    "content-length",
    "transfer-encoding",
  ]);
  ```
  Hop-by-hop headers and compression lengths from upstream are removed so downstream clients receive a clean streaming chunk flow without content length mismatches.

### 3.3. Key Rotation & Retry Loop
The forwarder integrates with `globalKeyPool` to rotate keys automatically:
- **Max Attempts**: Up to `MAX_NATIVE_ATTEMPTS = 3` attempts per request.
- **Retryable Statuses**: `429`, `500`, `502`, `503`, `504`.
- **Failure Classification & Cooldown**:
  - On retryable status: `logLimit` is logged to terminal, `globalKeyPool.reportFailure("gg", selected.index, res.status)` applies cooldown/quarantine, the upstream reader is explicitly cancelled (`await cancelRawReader(rawReader, "retry")`), and the next key is selected.
  - If attempts are exhausted: Returns the last received upstream error or HTTP 503 if the key pool is completely exhausted (`createPoolExhaustedResponse`).
  - On success: `globalKeyPool.reportSuccess("gg", selected.index)` resets failure counters.

### 3.4. HTTP/2 Connection Pooling (`src/network/h2_pool.ts`)
Outbound calls to `generativelanguage.googleapis.com` are executed over multiplexed HTTP/2 sessions:
- **Pool Keying Isolation**: In `src/network/fetcher.ts:413-416`:
  ```ts
  const poolKey =
    options.provider !== undefined && options.keyIndex !== undefined
      ? `${origin}#${options.provider}:${options.keyIndex}`
      : origin;
  ```
  For Google Native, the pool key is:
  `https://generativelanguage.googleapis.com#gg:<keyIndex>`
- **Multiplexing**: Each rotating API key maintains 1 persistent TCP/TLS socket supporting up to **80 concurrent streams** (`maxStreamsPerSession: 80`).
- **Anti-Pinning Aging**: Connections age out every 180s ($\pm 15\text{s}$ jitter). When aging triggers, `isDraining = true` ensures existing streams finish gracefully to EOF before closing, while new requests spin up a fresh TCP session on a new ephemeral port, preventing upstream IP/blade rate-limit pinning.

### 3.5. Telemetry & Stream Tapping (`createMonitoredStream`)
Rather than buffering the whole response, `src/handlers/google_native.ts:355-378` wraps the response in a non-destructive stream tap with a 64KB sliding text buffer:
1. **First Chunk Handling**: Emits `logTtft` upon first byte receipt (`Stream established` or `First chunk streamed downstream`) with `[Upstream: HTTP/2]`.
2. **Finish Reason Detection**: Scans SSE lines for `"finishReason": "STOP"` or `"SAFETY"` and calls `logFinishReason(reqId, reason)`.
3. **Usage Parsing**: Scans for `usageMetadata` (`promptTokenCount`, `candidatesTokenCount`, `totalTokenCount`). When found, calls `logUsage(...)` to log prompt tokens, completion tokens, duration, and calculated generation speed (`tok/s`).
4. **Stream Completion**: When the stream completes or the client aborts (`cancel()`), calls `emitStreamEndTelemetry` -> `logServed(reqId, durationMs, status, attempt, MAX_NATIVE_ATTEMPTS)` and prints a visual delimiter `logSeparator()`.

---

## 4. OpenCode2 Client Setup

To route OpenCode2 directly through LiteRouter's Google Native forwarder using `@ai-sdk/google`:

### Configuration: `~/.config/opencode2/config.json`

Add the following provider block to the `"providers"` object in `~/.config/opencode2/config.json`:

```json
{
  "$schema": "./schema.json",
  "providers": {
    "lr-gg": {
      "package": "aisdk:@ai-sdk/google",
      "npm": "@ai-sdk/google",
      "name": "LiteRouter Google Native",
      "settings": {
        "baseURL": "https://localhost:7766/v1beta",
        "apiKey": "lr-gg-gg-gc-no",
        "chunkTimeout": 30000
      },
      "options": {
        "baseURL": "https://localhost:7766/v1beta",
        "apiKey": "lr-gg-gg-gc-no",
        "chunkTimeout": 30000
      },
      "models": {
        "gemini-3.5-flash-lite": {
          "name": "Gemini 3.5 Flash Lite",
          "limit": {
            "context": 200000,
            "output": 65535
          }
        },
        "gemini-3.1-flash-lite": {
          "name": "Gemini 3.1 Flash Lite",
          "limit": {
            "context": 200000,
            "output": 65535
          }
        },
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash",
          "limit": {
            "context": 1048576,
            "output": 65536
          }
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro",
          "limit": {
            "context": 2097152,
            "output": 65536
          }
        }
      }
    }
  }
}
```

### Key Configuration Directives:
- **`baseURL`**: Must point to `https://localhost:7766/v1beta`. The client SDK will automatically append `/models/{model}:streamGenerateContent?alt=sse`.
- **`apiKey`**: Set to `lr-gg-gg-gc-no`.
- **`chunkTimeout`**: Set to `30000` (30 seconds) to match LiteRouter's internal streaming keep-alive cadence (`LITEROUTER_STREAM_IDLE_TIMEOUT=30`).

---

## 5. Troubleshooting Runbook (Quick Diagnosis Matrix)

Use this matrix to pinpoint and resolve errors immediately without searching the codebase:

| Symptom / Error Message | Root Cause | Immediate Diagnostic & Resolution |
|---|---|---|
| `HTTP 401 Unauthorized`<br>`ACCESS_TOKEN_TYPE_UNSUPPORTED` | Upstream received both an OAuth2 `Authorization: Bearer` header and an API key, or client sent an invalid key format. | 1. Check `src/handlers/google_native.ts:96-100`. Verify `authorization` is in `STRIPPED_UPSTREAM_HEADERS`.<br>2. Ensure the client sends `lr-gg-gg-gc-no` (starts with `lr-gg-`).<br>3. Verify `.env.local` contains valid `GOOGLE_API_KEYS`. |
| `HTTP 400 Bad Request`<br>`Invalid JSON payload received. Unknown name "store"` or `"stream_options"` | Client is sending OpenAI Chat Completions payload schema to Google's Native endpoint (`/v1beta/models/*`). | 1. Google Native endpoint expects Gemini payload schema (`contents`, `generationConfig`, etc.).<br>2. If using OpenAI SDK or `@ai-sdk/openai-compatible`, point to `https://localhost:7766/v1beta/openai` or `https://localhost:7766/v1` with `lr-gg-oa-ob-no`.<br>3. If using native Google SDK, ensure the package is `@ai-sdk/google`. |
| `HTTP 429 Too Many Requests`<br>`RESOURCE_EXHAUSTED` | An individual Google Free Tier API key has reached its 15 RPM or Daily quota. | 1. Check LiteRouter logs: `tmux attach -t literouter`. You will see `⚠️ [LIMIT reqId] gg:keyIndex [429]`.<br>2. Forwarder automatically rotates to key index + 1 up to 3 attempts.<br>3. If all keys fail, response is `503 Google key pool exhausted`. Add more keys to `GOOGLE_API_KEYS` in `.env.local` or wait for quota reset. |
| `HTTP 400 Bad Request`<br>`Google native requires a Google directive (lr-gg-*)` | Client sent a non-Google directive key (e.g. `lr-or-*` or `lr-nv-*`) to `/v1beta/models/*`. | Change client `apiKey` in `config.json` to `lr-gg-gg-gc-no`. |
| Downstream client streaming timeout or hang | Client chunk timeout is shorter than model response latency. | Ensure `"chunkTimeout": 30000` is present in both `"settings"` and `"options"` in `~/.config/opencode2/config.json`. |
| `HTTP 502 Bad Gateway`<br>`Upstream Google request failed` | Network connection timeout or TCP reset connecting to `generativelanguage.googleapis.com`. | Check ZeroTier/WAN connectivity. Test direct curl: `curl -I https://generativelanguage.googleapis.com`. |

---

## 6. Operational Commands & Verification

### Inspect Outbound HTTP/2 Pool Health
Run the health probe and check active persistent H2 sessions:
```bash
curl -sk https://localhost:7766/health | jq .h2_outbound
```
Expected output when `gg` connections are active:
```json
{
  "https://generativelanguage.googleapis.com#gg:0": {
    "activeStreams": 1,
    "isDraining": false,
    "ageMs": 12450
  }
}
```

### Observe Live Telemetry in Gateway Console
Attach to the LiteRouter tmux session:
```bash
tmux attach -t literouter
```
A typical Google Native request prints the following sequence:
```text
📥 [Inbound req_123] POST /v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse [HTTP/1.1]
🎯 [Inbound req_123] Directive: lr-gg-gg-gc-no (Provider: gg, Format: gg, Nuances: no)
🤖 [Inbound req_123] Model: gemini-2.5-flash | Provider: gg (Key 0/4)
🐢 [PACER req_123] Provider: gg | Dwell: 0ms | Depth: 1 | Avg: 0ms | Interval: 2000ms
🟢 [TTFT req_123] TTFT = 485ms | Stream established [Upstream: HTTP/2]
💬 [Finish req_123] finish_reason: stop
🟣 [USAGE req_123] gg:0/4 | Duration: 1420ms
💬 [USAGE req_123] Prompt: 125 | Completion: 84 | Total: 209 | Speed: 59.2 tok/s
 served in 1422ms (status: 200, attempt: 1/3)
────────────────────────────────────────────────────────────────────────────────
```

### Soft Reset & Hard Restart
- **Hot-reload key pool / reset cooldowns**:
  ```bash
  curl -sk -X POST https://localhost:7766/reset
  ```
- **Restart gateway process**:
  ```bash
  bash scripts/restart.sh
  ```
- **Verify status**:
  ```bash
  bash scripts/status.sh
  ```
