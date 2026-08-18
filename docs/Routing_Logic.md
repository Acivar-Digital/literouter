# Summary Table: API Resilience & Routing Logic

LiteRouter employs an intelligent in-flight error classification and retry engine (`src/network/classifier.ts`) designed to maximize request success while preventing wasteful retries on deterministic client errors.

---

## 1. Network & Transport Layer (HTTP/2, Sockets, Bun Runtime)

All outbound transport exceptions occurring prior to stream establishment or byte delivery are caught in `fetchWithTtftGuard` and wrapped into a `NoResponseError`. The request handler catches this error, isolates the current key, and automatically rotates in-flight across pooled keys (up to 3 attempts).

| Status / Error | In-Flight Retry? | Retry Strategy | Quarantines Key? | Behavior / Notes |
| :--- | :--- | :--- | :--- | :--- |
| **`ConnectTimeout` / `ConnectError`** | ✅ **Yes (Rotate)** | Immediate rotation (max 3 tries) | ❌ No (0s) | Pre-stream handshake or DNS failure. Wrapped into `NoResponseError` and retried across pooled keys. |
| **`RemoteProtocolError` (HTTP/2 GOAWAY)** | ✅ **Yes (Rotate)** | Immediate rotation (max 3 tries) | ❌ No (0s) | Upstream edge/load-balancer socket rotation. Wrapped into `NoResponseError` and retried across pooled keys. |
| **`ReadError` (TCP RST / `ECONNRESET`)** | ✅ **Yes (Rotate)** | Immediate rotation (max 3 tries) | ❌ No (0s) | Pre-stream socket reset or connection drop before first byte delivery. Wrapped into `NoResponseError` and retried. |
| **Client Disconnect (`req.signal` Abort)** | ❌ **No** | Abort upstream immediately | ❌ No (0s) | Client cancelled the request. Propagates abort downstream $\to$ upstream immediately to prevent token burn. |

---

## 2. Application Layer (HTTP Status Codes & Body Classification)

Upstream HTTP errors are evaluated via `classifyUpstreamError`:

| Status / Error Body Pattern | In-Flight Retry Across Keys? | Action | Quarantine Duration | Rationale & Handling |
| :--- | :--- | :--- | :--- | :--- |
| **HTTP 400 (`provider returned error`, `no available provider`, `temporarily unavailable`)** | ✅ **Yes (3 tries)** | `retry_rotate` | ❌ **0s** | Upstream provider temporary routing failure or edge node outage. |
| **HTTP 400 (Context Length, Schema, Bad Param, Moderation/Safety)** | ❌ **No (Fail Fast)** | `fail_fast` | ❌ **0s** | Deterministic client request error. Returned immediately to caller. |
| **HTTP 401 / 403 (Invalid Key, Unauthorized, Forbidden)** | ✅ **Yes (3 tries)** | `retry_rotate` | ✅ **7 Days (`604,800s`)** | Bad or revoked API key. Quarantines key and rotates to next active key. |
| **HTTP 404 (Resource or Model Not Found)** | ❌ **No (Fail Fast)** | `fail_fast` | ❌ **0s** | Upstream model identifier or route does not exist. |
| **HTTP 429 (Quota / Credit Depletion: `insufficient_quota`, `credit_limit`, `out of balance`)** | ✅ **Yes (3 tries)** | `retry_rotate` | ✅ **7 Days (`604,800s`)** | Account credit/balance exhausted. Quarantines key long-term and rotates. |
| **HTTP 429 (Standard Rate Limit - TPM / RPM)** | ✅ **Yes (3 tries)** | `retry_rotate` | ✅ **Dynamic / `Retry-After`** | Rate limit reached. Honors `Retry-After` / `x-ratelimit-reset` or applies exponential backoff with jitter. |
| **HTTP 5xx (500, 502, 503, 504 Transient Server Errors)** | ✅ **Yes (3 tries)** | `retry_rotate` | ✅ **10s** | Upstream temporary server outage or gateway error. Quarantined for 10s. |
| **Other 4xx Client Errors (405, 422, etc.)** | ❌ **No (Fail Fast)** | `fail_fast` | ❌ **0s** | Unrecoverable client error; fail fast without burning other keys. |

---

## 3. Streaming & TTFT Guards

| Event | In-Flight Retry? | Action | Quarantine Duration | Behavior |
| :--- | :--- | :--- | :--- | :--- |
| **TTFT Timeout / First-Byte Ghost (>5s)** | ✅ **Yes (3 tries)** | `retry_rotate` | ✅ **60s** | Upstream accepted socket but produced no content tokens in 5s. |
| **0-Byte Response (Ghost HTTP 200)** | ✅ **Yes (3 tries)** | `retry_rotate` | ✅ **60s** | HTTP 200 returned with completely empty body/stream. |
| **Mid-Stream Stalls / Thinking Pauses** | N/A | SSE Keepalive | N/A | Periodic `: keep-alive\n\n` comments prevent client & Bun socket timeouts. |

---

## 4. Fusion Model Cascading

- When routing via Fusion directives (`lr-fse-<preset>`), request attempts progress across configured tiers (`Tier 1 -> Tier 2 -> Tier 3`).
- If all API keys in a given tier fail with retryable errors or trigger circuit breakers, the router automatically cascades to the next tier in the fallback group.
