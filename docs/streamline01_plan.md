# Engineering Execution Plan: Tactical Zen HTTP/2 Fix & Telemetry Rectification

> **Date:** September 7, 2026  
> **Author:** Antigravity Engineering & Production Operations  
> **Status:** Approved for Implementation (Tactical Scope)  
> **Tracking Bead:** `literouter-0ibs` (Zen H2 Wire Negotiation & Telemetry)  
> **Document Role:** Standalone Intern Build Plan & Operational Playbook  
> **Mandate:** Zero Architectural Sprawl. Zero Monolith Rewrites. Zero Key/`.env.local` Touches.

---

## 1. Executive Summary & Root Cause Analysis

### 1.1 The Symptom
When clients send requests to LiteRouter:
- **OpenRouter (`or`)** negotiates **`HTTP/2`** upstream.
- **Zen (`zn`)** negotiates **`HTTP/1.1`** upstream.
- Telemetry logs in terminal display `[Upstream: HTTP/1.1]`, leading operators to believe Zen's edge servers do not support HTTP/2.

### 1.2 The Empirical Ground Truth (Check Findings)
A live TLS ALPN probe conducted on September 7, 2026 proved that Zen's servers **fully support HTTP/2**:
```bash
openssl s_client -connect opencode.ai:443 -alpn h2,http/1.1 -servername opencode.ai 2>/dev/null | grep "ALPN protocol"
# Output: ALPN protocol: h2
```
All primary upstream providers (`opencode.ai`, `openrouter.ai`, `integrate.api.nvidia.com`, `generativelanguage.googleapis.com`) successfully negotiate `h2` under TLS.

### 1.3 The Precise Technical Cause
The protocol split is caused by internal handler divergence inside LiteRouter:
1. **`/v1/chat/completions`** routes to `src/handlers/openai_compat.ts:291`, which calls `fetchWithTtftGuard(fetchOpts)`. That function invokes `executeH2Fetch()`, connecting to the global HTTP/2 session pool (`src/network/h2_pool.ts`).
2. **`/v1/responses`** routes to `src/handlers/openai_original.ts:806`, which calls `executeUpstreamFetch()`:
   ```typescript
   // src/handlers/openai_original.ts:590-602
   async function executeUpstreamFetch(
     url: string,
     headers: Record<string, string>,
     body: string,
     signal: AbortSignal
   ): Promise<Response> {
     return fetch(url, { // <-- NAKED global fetch() FORCES HTTP/1.1 BY CONSTRUCTION!
       method: "POST",
       headers,
       body: body.length > 0 ? body : undefined,
       signal,
     });
   }
   ```
   Because Zen requests in OpenCode typically target the Responses API format, they are processed by `openai_original.ts` and locked to HTTP/1.1.
3. **Telemetry Inversion Bug:**
   In `src/handlers/openai_original.ts:964`:
   ```typescript
   const protocol = req.headers.get("x-http-version") ?? "HTTP/1.1";
   ```
   At line 1015, this `protocol` variable is passed to `logTtft`:
   ```typescript
   logTtft(reqId, ttftMs, isStream ? "Stream established" : "First chunk streamed downstream", protocol);
   ```
   This passes the **inbound client's** HTTP version and falsely prints it as the upstream protocol!

---

## 2. Architectural Evaluation: Scalability & Provider Extensibility

### 2.1 Why We Reject the Monolithic Refactor
We explicitly **reject** combining this bug fix with a total repository overhaul (the `ProviderFetcher` rewrite and `.env` overhaul). 

#### The Supervisor's Audit Decisions:
1. **Separation of Blast Radius:** Combining a single transport bug fix with an architectural rewrite across 4 handlers and 66 configuration keys violates production safety. If an outage occurs, on-call engineers cannot isolate the fault.
2. **Re-Streaming Risk Avoidance:** Rewriting streaming pipelines from scratch creates risks of SSE delimiter corruption (`data: ...\n\n`), buffer truncation, and broken tool calling in Claude Code / OpenCode.
3. **Speed to Value:** This tactical fix solves the user's immediate problem in **under 45 lines of code** in a single file (`src/handlers/openai_original.ts`), without risking system stability.

### 2.2 Mental Model Alignment: "Handlers Should Only Handle"
A critical architectural inquiry is whether this design allows LiteRouter to scale horizontally with new providers (e.g. DeepSeek, Groq, Cerebras, Mistral, Moonshot, xAI) while preserving the principle that **handlers should only handle**.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DOWNSTREAM CLIENTS                              │
│         (OpenCode, Claude Code, Antigravity, Curl, SDKs)               │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    HANDLER LAYER: PURE HANDLING                        │
│      openai_compat.ts | openai_original.ts | anthropic_compat.ts       │
│                                                                        │
│  Responsibilities:                                                     │
│  • Directive routing (`lr-deepseek-...`, `lr-groq-...`)                │
│  • Wire-format translation (ChatCompletions ↔ Responses ↔ Messages)    │
│  • Key rotation & Quota cooldowns (`globalKeyPool`)                    │
│  • Downstream client SSE emission & telemetry (`logTtft`, `logServed`) │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Pure Request Contract
                                    │ (url, headers, body, signal)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                    NETWORK LAYER: PURE TRANSPORT                       │
│                src/network/fetcher.ts & h2_pool.ts                     │
│                                                                        │
│  Inherited by EVERY provider automatically:                            │
│  • HTTP/2 Multiplexing & Connection Pooling                            │
│  • ALPN Wire Negotiation & Graceful HTTP/1.1 Keep-Alive Fallback       │
│  • TTFT Sentry & Socket Liveness Verification                          │
│  • Byte-for-Byte Stream Reassembly (`reassembleResponse`)              │
│  • Dynamic Pacer rate-limiting & Circuit Breaker tripwires             │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        UPSTREAM AI PROVIDERS                           │
│   OpenAI │ OpenRouter │ NVIDIA NIM │ Google Vertex │ Zen │ DeepSeek    │
└────────────────────────────────────────────────────────────────────────┘
```

#### How This Enables O(1) Provider Scaling:
1. **Zero-Plumbing Onboarding:** New providers do not require bespoke socket handlers, chunk stream listeners, or protocol negotiation logic. Any new provider routed through `fetchWithTtftGuard` automatically inherits HTTP/2 connection pooling, sub-millisecond connection reuse, and TTFT monitoring.
2. **Centralized Transport Evolution:** Upgrading the wire transport (e.g. adding HTTP/3 / QUIC, socket pre-warming, or multiplex concurrency caps) happens strictly inside `src/network/fetcher.ts` and `h2_pool.ts`. All 10+ providers gain that upgrade simultaneously with zero edits to route handlers.
3. **Stream Memory Safety:** Placing `reassembleResponse` in the network layer ensures chunk buffering and reader-cancel propagation are validated once, eliminating duplicate stream-stitching bugs across handlers.

---

## 3. Surgical Implementation Specification

This section provides the exact instructions for an engineer or intern to execute the fix safely.

### 3.1 Scope & Affected Files
- **Target File:** `src/handlers/openai_original.ts` ONLY.
- **Test File:** `tests/unit/openai_original_h2.test.ts` (new isolated test) and `tests/unit/visual_telemetry.test.ts`.
- **Untouched Files:** All `.env*` files, `.env.local`, API keys, `providers.json`, `openai_compat.ts`, `anthropic_compat.ts`, and `gcp_compat.ts` are **STRICTLY OFF-LIMITS**.

---

### 3.2 Step-by-Step Build Plan

#### Step 1: Reconstruct Response Stream from First Chunk (`openai_original.ts`)
When `fetchWithTtftGuard` reads the first chunk to verify the socket and measure TTFT, it returns:
`{ response, ttftMs, firstChunk, rawReader, protocol }`.

To ensure the downstream streaming handlers (`createStreamingResponse` / `createNonStreamingResponse`) receive the exact same body bytes without losing the first chunk, we construct a combined `ReadableStream`:

```typescript
function reassembleResponse(
  originalResponse: Response,
  firstChunk: Uint8Array,
  rawReader: ReadableStreamDefaultReader<Uint8Array>
): Response {
  let firstChunkYielded = false;
  const combinedStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!firstChunkYielded) {
        firstChunkYielded = true;
        if (firstChunk.length > 0) {
          controller.enqueue(firstChunk);
          return;
        }
      }
      try {
        const { done, value } = await rawReader.read();
        if (done) {
          controller.close();
        } else if (value) {
          controller.enqueue(value);
        }
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      return rawReader.cancel(reason);
    },
  });

  return new Response(combinedStream, {
    status: originalResponse.status,
    statusText: originalResponse.statusText,
    headers: originalResponse.headers,
  });
}
```

#### Step 2: Replace `executeUpstreamFetch` with `fetchWithTtftGuard`
Update `executeUpstreamFetch` or invoke `fetchWithTtftGuard` inside `dispatchUpstreamFetch`:
```typescript
// Replace naked fetch with fetchWithTtftGuard
const fetchOpts: FetcherOptions = {
  url: route.upstreamUrl,
  method: "POST",
  headers: upstreamHeaders,
  body: bodyText.length > 0 ? bodyText : undefined,
  clientSignal: signal,
  provider: route.provider,
  keyIndex: currentKeyIndex,
  model: undefined, // Responses payload
};

const { response: guardResponse, ttftMs: attemptTtft, firstChunk, rawReader, protocol: upstreamProtocol } =
  await fetchWithTtftGuard(fetchOpts);

const res = reassembleResponse(guardResponse, firstChunk, rawReader);
```

#### Step 3: Return Negotiated Upstream Protocol in Fetch Result
In `dispatchUpstreamFetch`, return `upstreamProtocol` alongside `response`:
```typescript
return { 
  response: res, 
  keyIndex: currentKeyIndex,
  upstreamProtocol, // "HTTP/2" or "HTTP/1.1"
  measuredTtftMs: attemptTtft
};
```

#### Step 4: Fix Telemetry Logging Bug
In `handleOpenAiOriginal` (around lines 964–1015):
1. Rename the client protocol variable to clarify its meaning:
   ```typescript
   const clientProtocol = req.headers.get("x-http-version") ?? "HTTP/1.1";
   ```
2. In `logInbound`, retain `clientProtocol` to accurately reflect client ingress.
3. In `logTtft` (line 1015), pass the **actual negotiated upstream protocol** returned from `dispatchUpstreamFetch`:
   ```typescript
   const actualProtocol = fetchResult.upstreamProtocol ?? "HTTP/1.1";
   logTtft(reqId, ttftMs, isStream ? "Stream established" : "First chunk streamed downstream", actualProtocol);
   ```

---

## 4. Verification & Testing Playbook

An intern must complete this exact verification sequence before requesting approval.

### 4.1 Automated Unit Tests
Create `tests/unit/openai_original_h2.test.ts` to test:
1. **Stream Byte Fidelity:** Provide a stream with 3 mock SSE chunks (`data: {"chunk":1}\n\n`, `data: {"chunk":2}\n\n`, `data: [DONE]\n\n`). Assert that `reassembleResponse` emits all 3 chunks without character drops or missing newlines.
2. **HTTP/2 Transport Engagement:** Mock `executeH2Fetch` to verify it is called when `LITEROUTER_H2_OUTBOUND=true`.
3. **HTTP/1.1 Fallback:** Simulate an HTTP/2 connection timeout or ALPN failure. Assert that `fetchWithTtftGuard` falls back cleanly to HTTP/1.1 without dropping the client connection.
4. **Client Abort Propagation:** Verify that aborting `req.signal` cancels `rawReader` cleanly.

Run command:
```bash
bun test tests/unit/openai_original_h2.test.ts
```

### 4.2 Full Quality Gates
Execute standard project gates:
```bash
bun run typecheck
node node_modules/clean_ts/dist/cli.js validate src/handlers/openai_original.ts
bun test
uv run pytest tests/integration/
```

### 4.3 Live Telemetry Verification (The Visual Proof)
1. Start the gateway: `bash scripts/restart.sh`
2. Send a request to `/v1/responses` with a `zn` directive:
   ```bash
   curl -X POST http://localhost:7766/v1/responses \
     -H "Authorization: Bearer sk-lr-test" \
     -H "x-api-key: zn" \
     -H "Content-Type: application/json" \
     -d '{"model":"zen/default","input":"Say test"}'
   ```
3. Inspect `logs/access.log` or console output.
   **Expected Terminal Telemetry:**
   ```
   🔵 Inbound       | POST /v1/responses | ...
   🎯 Directive     | Directive: Direct: zn | Wire: rs
   🤖 Model: ...    | Key: #1 | Ref: OpenCode/1.18.29
   📦 PREP          | Model: ...
   🔌 UPSTREAM      | zn -> https://opencode.ai/zen/v1/responses
   🟢 [TTFT]        | 342ms | Stream established [Upstream: HTTP/2]
   🏁 [FINISH]      | Completed
   ```
   Confirm that **`[Upstream: HTTP/2]`** is printed.

---

## 5. Rollback Procedure

If any issue arises in staging or production:
1. Revert the commit in `src/handlers/openai_original.ts`.
2. Run `bash scripts/restart.sh`.
3. The gateway immediately returns to its previous state with zero configuration or database drift.

---

## 6. Intern Sign-Off Checklist

Before submitting for Senior Engineer review, verify:
- [ ] Only `src/handlers/openai_original.ts` and test files were modified.
- [ ] Zero changes made to `.env`, `.env.local`, or `config/providers.json`.
- [ ] TypeScript typecheck passes with 0 errors.
- [ ] All 625+ unit tests pass.
- [ ] SSE chunks pass through `reassembleResponse` with byte-for-byte fidelity.
- [ ] Live terminal output shows `[Upstream: HTTP/2]` for Zen on `/v1/responses`.
- [ ] Fallback to `HTTP/1.1` works when HTTP/2 is disabled.
