# OpenCode2 Streaming & Deep-Reasoning Troubleshooting Runbook

> **Trigger:** Load this file ONLY when troubleshooting OpenCode2 agentic streaming hangs, `network_error` crashes, 429 cascades, TTFT timeouts, or deep-reasoning stalls with models like `stealth/ox-alpha`.

---

## 1. Fast Diagnostic Runbook (<1s Pinpoint Commands)

When diagnosing OpenCode2 streaming failures or agent stalls, run these pinpoint commands immediately without scanning the entire disk:

| Target | Instant Command | What It Verifies |
|---|---|---|
| **Auto-Patcher & Binary Status** | `bash scripts/opencode2_autopatch.sh -v` | Verifies `@opencode-ai/cli` symlinks, permissions, `.bak` backups, and applied patch markers (`.patch_tool_format_applied`, `.patch_network_error_applied`). (<5ms) |
| **Reasoning Stream Filter & Nuances** | `bun test tests/unit/opencode_reasoning_filter.test.ts` | Runs unit tests verifying `isOpenCodeClient`, `filterReasoningFromChunk`, `createOpenCodeReasoningFilterStreamTransformer`, `stripReasoningFromResponseBody`, and `ts`/`sb` nuance overrides. (~15ms) |
| **Inbound History Payload Scrubber** | `bun test tests/unit/inbound_reasoning_scrubber.test.ts` | Tests stripping of reasoning parts and metadata from multi-turn assistant messages (`scrubReasoningFromMessages`). (~10ms) |
| **Tool Message Stream Regression** | `bun test tests/unit/tool_call_stream_regression.test.ts` | Tests tool message array content normalization, metadata stripping, and incremental tool call delta handling. (~12ms) |
| **Full Diagnostic Suite** | `python tests/e2e/streaming_kit/run_diagnostics.py` | 4-stage automated diagnostic kit: SQLite turn extractor & replay, strict Vercel Zod validator probe, inter-chunk cadence audit. |
| **Live Gateway Health & Key Pools** | `bun run scripts/doctor.ts` | Non-blocking live health probe for all provider keys across Google, NVIDIA, OpenRouter, and Zen. |

---

## 2. The 4 Breakdown Vectors in OpenCode2 Agentic Streaming

When running deep-reasoning models (such as `stealth/ox-alpha` or DeepSeek-R1) via OpenCode2, streaming sessions can fail due to four specific protocol breakdown vectors:

### Vector 1: Zod Schema `content: null` Breakdown
- **Mechanism:** Strict downstream client parsers (such as `@ai-sdk/provider-utils` or Vercel AI SDK within OpenCode2) validate chunk deltas using strict Zod schemas (`content: z.string().optional()`). When upstream providers emit `{ "delta": { "content": null, "reasoning_content": "..." } }`, passing `content: null` downstream causes an unhandled Zod `TypeError: Expected string, received null`.
- **Result:** Downstream client immediately terminates the stream at 21ms with `rawFinish: "network_error"`.
- **LiteRouter Fix:** `sanitizeDelta` in `src/transformers/opencode_adapter.ts` strips `delta.content` if it is `null` or `undefined`, preventing schema mismatch.

### Vector 2: Discarded SSE Comments & 55s Inactivity Timeouts
- **Mechanism:** During extended reasoning phases (30–60s of pure chain-of-thought), upstream providers emit continuous reasoning chunks or SSE comments (`: keep-alive\n\n`). If LiteRouter strips reasoning chunks to prevent SQLite history bloat, downstream receives 0 data frames. Standard SSE comment frames are parsed as comments, not data events.
- **Result:** The downstream client stream reader's 55s inactivity timer triggers, causing mid-turn freezes and requiring manual "continue" prompts.
- **LiteRouter Fix:** Throttled synthetic heartbeats (`FILTER_HEARTBEAT_INTERVAL_MS = 5000`). Whenever stripped reasoning chunks or SSE comments are processed, LiteRouter synthesizes a valid empty delta frame (`data: {"choices":[{"index":0,"delta":{}}]}`) every 5 seconds, resetting client-side stream inactivity timers without cluttering message text.

### Vector 3: Tool Message Array Formatting
- **Mechanism:** OpenCode2 internal agents store multi-modal or structured tool execution responses as arrays of content parts: `role: "tool", content: [{ "type": "text", "text": "..." }]` alongside proprietary client metadata (`id`, `name`, `providerState`, `state`, `createdAt`). Strict OpenAI-compatible upstream providers reject content arrays on `role: "tool"` with HTTP 400 Bad Request.
- **Result:** Subsequent turns fail immediately with HTTP 400 validation errors.
- **LiteRouter Fix:** `normalizeToolContent` flattens array-based tool content into flat string payloads and `stripToolMetadata` scrubs proprietary client properties prior to upstream dispatch.

### Vector 4: Midstream Drops & Controller Race Conditions
- **Mechanism:** When network hiccups, upstream timeouts, or client aborts occur mid-stream, standard stream pipelines often invoke `controller.close()` or `controller.enqueue()` on an already terminated or canceled stream controller.
- **Result:** Bun runtime crashes with `ERR_INVALID_STATE: Controller is already closed`, polluting error logs and tearing down active socket pools.
- **LiteRouter Fix:** Idempotent stream teardown via `safeEnqueue`, `safeClose`, and `safeError` with shared `isClosedRef` guards in `src/network/fetcher.ts`.

---

## 3. LiteRouter Zen-Parity OpenCode Adapter (`src/transformers/opencode_adapter.ts`)

LiteRouter consolidates all OpenCode-specific transformations into a dedicated transformer layer that achieves complete behavioral parity with Zen gateway:

```
Inbound Request
  │
  ├──► isOpenCodeClient(...) ?
  │       ├─► YES: scrubReasoningFromMessages(messages)
  │       │        normalizeToolContent(tool messages)
  │       │        stripToolMetadata / stripClientMetadata
  │       └─► NO:  100% Pass-Through (Pydantic AI / SDKs untouched)
  ▼
Upstream Dispatch
  ▼
SSE Streaming Response
  │
  ├──► isOpenCodeClient(...) ?
  │       ├─► YES: createOpenCodeReasoningFilterStreamTransformer()
  │       │        • deleteReasoningKeys (9 variants)
  │       │        • sanitizeDelta (remove null content, empty tool_calls)
  │       │        • 5s Synthetic Data Heartbeats (FILTER_HEARTBEAT_INTERVAL_MS)
  │       │        • sanitizeRawControlChars (\r -> \\r)
  │       └─► NO:  100% Raw Stream (Reasoning deltas fully preserved)
  ▼
Client Delivery
```

### Key Functions
- **`isOpenCodeClient(userAgent, headers, nuances)`**: Detects OpenCode via `User-Agent: opencode*`, `x-opencode` header, or `x-client-name: opencode*`. Respects nuance overrides (`ts` disables stripping, `sb` forces stripping across all clients).
- **`sanitizeDelta(rawDelta)`**: Strips all 9 reasoning key variants (`reasoning`, `reasoning_content`, `reasoning_details`, `reasoningDetails`, `thought`, `thoughts`, `thinking`, `thinking_content`, `think`), strips `content` if `null`/`undefined`, and drops empty `tool_calls` arrays.
- **`createSyntheticHeartbeatChunk()`**: Generates standard OpenAI chunk `data: {"id":"chatcmpl-heartbeat","object":"chat.completion.chunk",...}` to maintain stream liveness.
- **`scrubReasoningFromMessages(messages)`**: Strips reasoning content parts and client metadata from multi-turn assistant messages prior to upstream serialization, preventing SQLite context bloat (from 40K to 300K+ tokens).
- **`normalizeToolContent(content)`**: Flattens `role: "tool"` content arrays into single strings.

---

## 4. Post-TTFT Stream Drop Safety & False Quarantine Prevention

Once Time-To-First-Token (TTFT) has elapsed and content tokens have started streaming downstream to the client:

1. **Halt In-Flight Key Rotation:**
   - Pre-TTFT errors trigger automatic key rotation across pooled keys.
   - Once content tokens have reached the downstream client, the HTTP response header (HTTP 200) and partial body have already been committed. Attempting key rotation mid-stream would inject disjointed stream fragments into the client.
2. **Prevent False 60s Key Quarantines:**
   - Midstream network drops or client disconnects must **not** penalize the upstream API key with a 60-second rate-limit quarantine.
   - LiteRouter assigns transient transport drops and midstream socket errors a 2-second transient retry quarantine (`quarantineTtlSec: 2`) or leaves active keys unaffected when the disconnect originates downstream.
3. **Idempotent Stream Controller Protection:**
   - `safeEnqueue`, `safeClose`, and `safeError` inspect `isClosedRef.isClosed` and `controller.desiredSize === null` before performing operations.
   - Client disconnects silently mark `isClosedRef.isClosed = true` and tear down background keepalive timers without throwing unhandled runtime exceptions.

---

## 5. Pydantic AI & Standard SDK Pass-Through Isolation

LiteRouter guarantees strict client isolation:

| Client Type | Detection Method | Reasoning Deltas | Message Scrubbing | Synthetic Heartbeats |
|---|---|---|---|---|
| **OpenCode / OpenCode2** | `isOpenCodeClient` == true (unless `ts` nuance) | Stripped in-flight | Full scrub & tool flatten | Active (5s interval) |
| **Pydantic AI** | `isOpenCodeClient` == false | **100% Preserved** | Untouched | Not attached |
| **OpenAI / Anthropic SDK** | `isOpenCodeClient` == false | **100% Preserved** | Untouched | Not attached |
| **Curl / Generic Requests** | `isOpenCodeClient` == false | **100% Preserved** | Untouched | Not attached |
| **Explicit Nuance `ts`** | Directive has `+ts` (e.g. `lr-or-oa-ch-ts`) | **Preserved for OpenCode** | Preserved | Not attached |
| **Explicit Nuance `sb`** | Directive has `+sb` (e.g. `lr-or-oa-ch-sb`) | **Stripped for all clients** | Full scrub & tool flatten | Active (5s interval) |
