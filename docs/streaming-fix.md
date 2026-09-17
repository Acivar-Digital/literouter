# LiteRouter Production Streaming & Dispatch: Long-Running Harness Specification (Fix_Streaming_01)

## Document Metadata
- **Status:** APPROVED & LOCKED INTO PROJECT MEMORY (`bd remember`)
- **Core Priority:** Long-Running Harness Survival & Pure Streaming Transparency
- **Target Subsystems:** `src/routes/openai_compat.ts`, `src/network/fetcher.ts`, `src/network/pacer.ts`

---

## 1. Architectural Foundation & Core Principles

LiteRouter is designed as a **long-running resilient proxy** for AI agent harnesses (OpenCode, Claude Code, Antigravity, etc.).

### 1.1 The Two Distinct Legs of Traffic
1. **Incoming Leg (Client ──► LiteRouter)**:
   * Managed via an **Ingress Conveyor Belt** (FIFO queue).
   * **Zero artificial socket timeouts**: The incoming client connection stays open for as long as the client requires. No arbitrary 5s/10s cutoffs.
   * Direct, unhindered stream connection to the downstream client.

2. **Outgoing Leg (LiteRouter ──► Upstream Provider)**:
   * Upstream dispatch rotates keys and providers across the pool.
   * **Re-send on drop (Long-Running Recovery)**: If an upstream provider drops, disconnects, or fails at any point (pre-generation or mid-stream), LiteRouter immediately grabs the next available healthy key from the pool and re-sends the request.
   * **Accepted Trade-off**: Terminal pollution or repeated output is explicitly accepted in exchange for guaranteeing that long-running agent workflows never stall, abort, or die mid-session.

---

## 2. Ingress & Egress Architecture

```
[ Downstream Client (Agent / Harness) ]
                 │
                 │  (Incoming Leg: Zero Timeouts, Permanent Socket)
                 ▼
    ┌──────────────────────────┐
    │  Ingress Conveyor Belt   │ ──► Sequences incoming traffic cleanly
    └────────────┬─────────────┘
                 │
                 ▼
    ┌──────────────────────────┐
    │ Outgoing Key Dispatcher  │ ◄─── Rotates healthy keys
    └────────────┬─────────────┘
                 │
                 ├──► [ Attempt 1: Key #A ] ──► (Drops / Fails)
                 │                                  │
                 │      ┌───────────────────────────┘
                 │      │  (Long-Running Re-Send)
                 ▼      ▼
    ┌──────────────────────────┐
    │ [ Attempt 2: Key #B ]    │ ──► Streams tokens to downstream socket
    └──────────────────────────┘
```

---

## 3. Streaming & Dispatch Mechanics

### 3.1 Incoming Leg (Ingress Conveyor Belt)
* Accepts the incoming client request and holds the connection open without artificial timeouts.
* Passes through client abort signals: If the human user explicitly cancels (Ctrl+C / disconnect), LiteRouter cleans up the in-flight upstream socket.
* Otherwise, the ingress leg remains patient for reasoning models and extended generation tasks.

### 3.2 Outgoing Leg & Resilient Replay
* When an upstream connection drops, throws an EOF, or returns a rate limit / error:
  1. The failed key is placed into quarantine per cooldown policy.
  2. The dispatcher immediately acquires the next active key from the pool.
  3. The request payload is sent again to resume the stream.
* Streaming chunks are piped directly to the downstream response stream without over-engineered parsing traps or blocking gates.

### 3.3 Transparent Stream Piping
* Direct byte-level passthrough of Server-Sent Events (SSE) chunks from upstream to downstream.
* Minimal transformation overhead: preserves full reasoning tags, tool call syntax, and text content as emitted by the active provider.

---

## 4. Implementation Directives for `openai_compat.ts`

1. **Remove Artificial Inbound Socket Guards**:
   * Ensure no gateway-level premature timeouts abort the client socket during long generations.

2. **Stream Re-Send on Upstream Failure**:
   * Enable the resilient stream reader to catch upstream network drops, select the next available key from the pool, and re-issue the upstream fetch.

3. **Conveyor Belt Ingress Queue**:
   * Maintain the FIFO pacer queue for orderly rate-paced dispatch to available keys.

---

## Appendix: Earlier two-leg explanation (from Fix_Streaming.md)

Earlier streaming latency investigations diagnosed redundant reasoning suppression across two distinct legs:
- **Leg 1 (Outbound Request Payload: Client ──► LiteRouter ──► Provider)**: LiteRouter strips reasoning history via `scrubReasoningFromMessages()` to prevent context bloat upstream.
- **Leg 2 (Inbound Streaming Response: Provider ──► LiteRouter ──► Client TUI)**: Runtime SSE chunk parsing (`JSON.parse` ──► strip reasoning keys ──► `JSON.stringify` + 5s synthetic heartbeats) caused severe terminal latency and frozen screens during reasoning.

To eliminate Leg 2 stalls while retaining essential Leg 1 history scrubbing, the runtime provides a bypass flag in `.env`:
```bash
# Bypass Leg 2 SSE parsing/filtering so raw chunks stream with zero delay to the TUI
LITEROUTER_STREAM_FILTER_REASONING=false
```
When set to `false` (default), SSE chunks stream directly through with zero delay or line-buffering latency.

---

## 5. Upstream Provider Streaming Error & SSE Framing Compliance

### 5.1 Spec-Compliant Mid-Stream Error Framing
When an upstream provider fails mid-stream after HTTP 200 headers have been committed and all retries are exhausted, LiteRouter synthesizes an SSE error frame before emitting `data: [DONE]`.

To ensure compatibility with strict OpenAI SDK and OpenRouter client stream parsers (preventing `TypeError: Cannot read properties of undefined (reading '0')`), the error frame strictly conforms to standard chunk shapes:
```json
data: {"id":"err-<timestamp>","object":"chat.completion.chunk","created":1234567890,"model":"error","error":{"message":"...","code":"server_error","type":"server_error"},"choices":[{"index":0,"delta":{"content":""},"finish_reason":"error"}]}

data: [DONE]
```

### 5.2 SSE Keep-Alive Comments vs. Content Tokens
Providers like OpenRouter emit SSE comment lines (e.g. `: OPENROUTER PROCESSING` or `: keep-alive`) to maintain TCP connections before token generation begins.
- `src/network/fetcher.ts` filters lines beginning with `:` so keep-alive comments are never falsely identified as model content tokens in `hasContentToken()`.
- `isInBandErrorChunk()` skips comment lines immediately, ensuring keep-alives never trigger false-positive error classifications.

### 5.3 Credit & Quota Exhaustion Detection
`src/network/classifier.ts` classifies credit exhaustion patterns across providers (including OpenRouter's `"out of credits"`, `"credits exhausted"`, `"insufficient credits"`, `"free limit exceeded"`, and `"account has no balance"`) into long-term quota quarantine (7 days or midnight UTC per provider conserve rules) rather than treating them as transient rate limits. Status 402 ("Payment Required") fails fast with 0s quarantine to prevent burning request budgets.

