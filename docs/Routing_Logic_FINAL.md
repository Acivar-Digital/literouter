# LiteRouter Production Routing & Dispatch Specification (Hardened)

This document defines the production architecture, traffic scheduling, error classification, and in-flight dispatch mechanics for LiteRouter. It incorporates datacenter-grade edge-case handling, dynamic inference guards, rate-paced multi-tenant FIFO queuing, and wire-compliant protocol formatting.

---

## 1. Core Architectural Invariants

1. **Elimination of Greedy Cascades**: A failing request must never synchronously consume multiple healthy keys in a tight loop. When an upstream key fails, it is quarantined, and the request yields immediately to allow queued requests to access remaining healthy keys.
2. **Zero Poison Pill Amplification**: Deterministic client errors (HTTP 400 with invalid schemas, malformed JSON, prompt length exceeding platform limits, or global HTTP 404s) fail fast and are strictly prohibited from re-entering the queue.
3. **Bounded Lifespan & Proactive Load Shedding**:
   * Hard total wall-clock lifespan deadline: `MAX_QUEUE_WAIT_MS = 20,000ms` from initial ingress.
   * **Fast Load Shedding**: If all provider keys are quarantined and the shortest cooldown TTL exceeds remaining queue dwell time (`min(quarantine_TTL) > (MAX_QUEUE_WAIT_MS - current_dwell_time)`), the gateway immediately returns HTTP `503 Service Unavailable` / `429 Too Many Requests` rather than letting requests rot in memory.
4. **Active Client Abort Pruning ($O(1)$)**: Listening on `req.signal.onabort` ensures disconnected clients are pruned from the FIFO queue immediately, preventing memory bloat and phantom upstream billing.
5. **Downstream Protocol Integrity (Pre-TTFT vs. Post-TTFT)**:
   * **Pre-TTFT (0 bytes sent)**: Safe to re-queue at the tail of the FIFO pipe.
   * **Post-TTFT (Stream active)**: Clean termination via wire-specific SSE error frames (OpenAI vs. Anthropic) to maintain client AST parser compliance.

---

## 2. Inbound Classification Matrix (Transient vs. Deterministic)

Every upstream response and transport exception is evaluated by the Error Classifier (`src/network/classifier.ts`) before any dispatch decision is made.

| Status / Error Pattern | Error Class | Action | Re-Queue at Tail? | Key Quarantine Duration | Rationale |
| :--- | :--- | :--- | :---: | :---: | :--- |
| **HTTP 400 (`context_length_exceeded`, `prompt too long`)** | Deterministic | `fail_fast` | ❌ **NO** | 0s | Client prompt exceeds model capacity; retrying on another key will fail identically. |
| **HTTP 400 (Invalid JSON, Schema Error, Bad Param)** | Deterministic | `fail_fast` | ❌ **NO** | 0s | Malformed request body; must be corrected by downstream caller. |
| **HTTP 401 / 403 (Invalid Key, Revoked, Unauthorized)** | Key Defect | `rotate_key` | ✅ **YES** | 7 Days (`604,800s`) | Specific key is bad/revoked. Quarantines key long-term; request rejoins queue to be served by remaining healthy keys in pool. |
| **HTTP 404 (Model Not Found / Route Missing)** | Deterministic | `fail_fast` | ❌ **NO** | 0s | Target upstream route or model identifier does not exist on public providers (OpenRouter, NVIDIA, Google, Zen). |
| **HTTP 429 (Rate Limit: RPM / TPM / Concurrency)** | Transient | `retry_requeue` | ✅ **YES** | Dynamic / `Retry-After` (or 60s) | Upstream provider throttle. Honors upstream header or sets standard cooldown. |
| **HTTP 429 (Quota / Balance Exhausted)** | Key Defect | `rotate_key` | ✅ **YES** | 7 Days (`604,800s`) | Specific key balance is empty. Quarantines key; request re-enters queue for another key. |
| **HTTP 500 / 502 / 503 / 504 (Server Overload / Outage)** | Transient | `retry_requeue` | ✅ **YES** | 10s | Transient server or gateway error at provider edge. |
| **TTFT Timeout (Dynamic: >5s standard, >60s reasoning)** | Transient | `retry_requeue` | ✅ **YES** | 60s | Upstream accepted socket but stalled without generating first token. |
| **TCP RST / Socket EOF / ConnectTimeout (Pre-TTFT)** | Transient | `retry_requeue` | ✅ **YES** | **2,000ms** | Applies a brief 2s cooldown to prevent tight CPU retry loops during edge restarts. |
| **Client Disconnect (`req.signal.aborted`)** | Cancelation | `abort` | ❌ **NO** | 0s | Downstream caller aborted (e.g. user pressed Ctrl+C); immediately prune from queue. |

---

## 3. Modern Inference & Dynamic TTFT Guards

Standard models emit tokens rapidly, whereas reasoning models spend tens of seconds in internal thinking loops before outputting the first byte. The TTFT guard dynamically scales according to the target model string:

```ts
function resolveTtftTimeout(model: string, envTimeoutMs: number): number {
  const isReasoningModel = /o1|o3|deepseek-reasoner|r1|thinking|claude-3-7.*thought/i.test(model);
  if (isReasoningModel) {
    return Math.max(60000, envTimeoutMs); // 60s for reasoning models
  }
  return envTimeoutMs || 5000; // 5s default for standard models
}
```

---

## 4. Queue Architecture, Concurrency & Anti-Thundering Herd

### 4.1 Proportional Dynamic Queue Capacity
To prevent head-of-line starvation when running on small key pools, the maximum queue depth scales with active healthy keys:
$$\text{Max Queue Capacity} = \max(10, \text{Active Keys} \times 10)$$
*(e.g., 10 keys $\rightarrow$ capacity 100; 1 key $\rightarrow$ capacity 10)*.

### 4.2 Rate-Paced Dispatch & Slow Start (Anti-Thundering Herd)
When a key exits its 60s cooldown quarantine, the dispatcher **does not** dump accumulated queue traffic onto it simultaneously. 
* Dispatch is metered via `RequestPacer` (`minIntervalMs` and max concurrent in-flight requests per key).
* Concurrency per individual key is capped at `1` in-flight request for free/strict keys, and up to `5` for tier-paid keys.

```
[ Inbound HTTP Request ]
          │
          ▼
[ Extract Provider Directive ] ──► (e.g., 'or' -> OpenRouter Pipeline)
          │
          ▼
[ Check Proportional Capacity ] ──(Full)──► [ Return 429 Too Many Requests (Retry-After: 5) ]
          │
          ▼
[ Check Total Outage / Load Shedding ]
    ├── Are all keys quarantined?
    └── Is `min(quarantine_TTL) > (MAX_QUEUE_WAIT_MS - dwell)`?
          │ (YES) ─────────────────────────► [ Return 503 / 429 Immediate Load Shed ]
          │ (NO)
          ▼
[ Enqueue into Provider FastFifoQueue ]
    ├── Record `enqueuedAt = Date.now()`
    ├── Attach `attemptCount = 1`
    └── Attach `req.signal.onabort -> queue.remove(node)`
          │
          ▼
[ Pump Dispatcher ]
```

### 4.3 Dispatch & Execution State Machine
```
                           [ FastFifoQueue: Head [Req A, Req B, Req C] Tail ]
                                                  │
                                                  ▼ (Dispatcher pops Req A)
                                    [ Select Next Active Healthy Key ]
                                                  │
                                                  ▼ (Key #1 assigned via Pacer)
                                       [ Execute Upstream Fetch ]
                                                  │
                            ┌─────────────────────┴─────────────────────┐
                            ▼                                           ▼
                   [ HTTP 200 First Chunk ]                     [ Transient Failure / 429 / 5xx / 401 ]
                            │                                           │
       [ Dynamic TTFT Guard Passed (5s / 60s) ]                         ├─► Quarantine Key #1 (TTL per Matrix)
                            │                                           ▼
             [ Lock Stream & Pipe Downstream ]              [ Check Guards: ]
                            │                               ├── Dwell Time < 20,000ms?
                         [ Done ]                           ├── Attempt Count < 3?
                                                            └── `req.signal.aborted === false`?
                                                                        │
                                                    ┌───────────────────┴───────────────────┐
                                                    ▼ (Passed Guards)                       ▼ (Failed Guards)
                                        [ Increment `attemptCount++` ]            [ Return Error to Client ]
                                        [ Re-queue at FIFO TAIL ]                 (429 / 502 / 504 Gateway Error)
                                        [ Trigger Pump Dispatcher ]
```

---

## 5. Downstream Protocol-Compliant Mid-Stream Interruption Handling

If an upstream connection drops after HTTP 200 headers and tokens have already been streamed to the client (Post-TTFT), LiteRouter flushes a protocol-compliant termination sequence matching the client wire format:

### 5.1 Anthropic Wire Protocol (`/v1/messages`)
```sse
event: error
data: {"type": "error", "error": {"type": "api_error", "message": "Upstream stream interrupted mid-generation"}}

```

### 5.2 OpenAI Wire Protocol (`/v1/chat/completions`)
```sse
data: {"error": {"message": "Upstream stream interrupted mid-generation", "type": "server_error"}}

data: [DONE]

```

This ensures downstream SDKs (e.g. OpenAI Python/Node SDK or Claude Code CLI) parse the termination cleanly and trigger turn-level idempotency without AST syntax crashes.

---

## 6. Observability, Telemetry & Structured Logging

```
🔵 [08-20-12:30:00:100] [req_abc123] Inbound POST /v1/messages | Provider: OpenRouter | Queue Depth: 4
⏳ [08-20-12:30:00:150] [req_abc123] Pacer Dispatch | Key #1/10 | Queue Dwell: 50ms | Dynamic TTFT: 60s (Reasoning Model)
⚠️ [08-20-12:30:01:200] [LIMIT req_abc123] OpenRouter [Key #1/10] returned 429 Too Many Requests -> Quarantined Key #1 for 60s
🔄 [08-20-12:30:01:205] [RE-QUEUE req_abc123] Pre-TTFT Failure -> Re-queued at Tail [Hop 1/3] | Queue Depth: 3
⏳ [08-20-12:30:01:300] [req_abc123] Pacer Dispatch | Key #2/10 | Total Dwell: 200ms
🟢 [08-20-12:30:02:500] [TTFT req_abc123] TTFT = 1200ms | Stream established via HTTP/2
```
