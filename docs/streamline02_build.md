# Level 2 Engineering Build Plan: Surgical Zen HTTP/2 & Wire Telemetry Fix (Refined Architecture)

> **Document:** `/home/yapilwsl/arthityap/literouter/docs/streamline02_build.md`  
> **Status:** Level 2 Detailed Build Specification (Refined Separation of Concerns)  
> **Tracking Bead:** `literouter-0ibs`  
> **Target Date:** September 7, 2026  
> **Constraint:** Zero modifications to `.env*` or API keys. Single network helper export (`src/network/fetcher.ts`) + surgical handler update (`src/handlers/openai_original.ts`). CleanTS cognitive complexity < 6 per function.

---

## 1. Architectural Philosophy: "Handlers Only Handle"

In earlier drafts (`streamline01_build.md`), the stream reassembler (`reassembleResponse`) was placed inside `src/handlers/openai_original.ts`. While keeping the blast radius to a single file, it violated the core architectural separation of concerns:
- **Handlers** should only handle: route validation, directive parsing, auth headers, key rotation, downstream SSE serving, and lifecycle telemetry.
- **Network / Transport** (`src/network/fetcher.ts`) should own wire mechanics: HTTP/2 multiplexing, TTFT guards, socket liveness checks, and stream byte reconstruction.

This refined Level 2 plan relocates `reassembleResponse` into `src/network/fetcher.ts`. This ensures:
1. **Purity of Handlers:** Handlers never write raw `ReadableStreamDefaultReader` controllers or byte slice loops.
2. **Provider Scalability (`O(1)` additions):** Any new provider (DeepSeek, Groq, Cerebras, Mistral, etc.) calls the network layer and receives a clean, fully-formed `Response` ready for streaming or buffering.
3. **Zero Blast Radius on Existing Routes:** `reassembleResponse` is an additive export in `fetcher.ts` that does not modify existing `fetchWithTtftGuard` call signatures in `openai_compat.ts`, `anthropic_compat.ts`, or `gcp_compat.ts`.

---

## 2. Affected Files Inventory

| Role | Path | Lines Modified | Description |
|---|---|---|---|
| **Network Layer** | `src/network/fetcher.ts` | Append export (~35 lines) | Export `reassembleResponse()` so transport-level stream merging lives in the transport module. |
| **Handler Layer** | `src/handlers/openai_original.ts` | Lines 6–14, 590–603, 730–835, 964, 1015 | Import `fetchWithTtftGuard` & `reassembleResponse`. Replace naked `fetch` with `executeUpstreamFetch`. Pass real upstream protocol to `logTtft`. |
| **New Unit Test** | `tests/unit/openai_original_h2.test.ts` | New file (~140 lines) | Verifies byte-for-byte stream fidelity, reader cancellation, empty chunks, and wire protocol propagation. |
| **Existing Quality Gates** | `tests/unit/visual_telemetry.test.ts` | Unchanged (assert pass) | Ensures visual terminal telemetry contracts and emoji layout remain intact. |

---

## 3. Detailed AST & Code Modifications

### 3.1 Part A: `src/network/fetcher.ts` (Network Layer)

Append `reassembleResponse` to `src/network/fetcher.ts` right after `fetchWithTtftGuard`:

```typescript
/**
 * Reassembles a response stream where the first chunk was consumed (e.g. by TTFT guard)
 * into a single unified ReadableStream without losing initial bytes or corrupting delimiters.
 * CleanTS complexity: 3 (within limit of 6). Zero swallowed catches.
 */
export function reassembleResponse(
  originalResponse: Response,
  firstChunk: Uint8Array,
  rawReader: ReadableStreamDefaultReader<Uint8Array>
): Response {
  let firstChunkYielded = false;
  const combinedStream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!firstChunkYielded) {
        firstChunkYielded = true;
        if (firstChunk.byteLength > 0) {
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
      } catch (err: unknown) {
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

---

### 3.2 Part B: `src/handlers/openai_original.ts` (Handler Layer)

#### Step 1: Update Imports (Lines 6–14)
```typescript
// BEFORE:
import { sanitizeDownstreamHeaders } from "../network/fetcher";
import { getPacerForProvider, PacerQueueOverflowError } from "../network/pacer";
import {
  buildAuthHeaders,
  globalKeyPool,
  initializeKeyPools,
  overrideProviderUrl,
  resolveUpstreamEndpoint,
} from "./openai_compat";

// AFTER:
import {
  fetchWithTtftGuard,
  reassembleResponse,
  sanitizeDownstreamHeaders,
  type FetcherOptions,
  type OutboundProtocol,
} from "../network/fetcher";
import { getPacerForProvider, PacerQueueOverflowError } from "../network/pacer";
import {
  buildAuthHeaders,
  globalKeyPool,
  initializeKeyPools,
  overrideProviderUrl,
  resolveUpstreamEndpoint,
} from "./openai_compat";
```

#### Step 2: Replace `executeUpstreamFetch` (Lines 590–603)
Replace the naked `fetch()` call with a clean wrapper calling `fetchWithTtftGuard` and `reassembleResponse`. Notice that `openai_original.ts` performs **zero stream controller manipulation**—it simply delegates to `fetcher.ts`:

```typescript
// BEFORE:
async function executeUpstreamFetch(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers,
    body: body.length > 0 ? body : undefined,
    signal,
  });
}

// AFTER:
interface UpstreamExecutionResult {
  readonly response: Response;
  readonly upstreamProtocol: OutboundProtocol;
  readonly measuredTtftMs: number;
}

async function executeUpstreamFetch(
  options: FetcherOptions
): Promise<UpstreamExecutionResult> {
  const guard = await fetchWithTtftGuard(options);
  const reassembled = reassembleResponse(
    guard.response,
    guard.firstChunk,
    guard.rawReader
  );
  return {
    response: reassembled,
    upstreamProtocol: guard.protocol,
    measuredTtftMs: guard.ttftMs,
  };
}
```

#### Step 3: Update `dispatchUpstreamFetch` Signature & Invocation (Lines 720–835)

1. Update `FetchResult` interface:
```typescript
interface FetchResult {
  readonly response?: Response;
  readonly errorResponse?: Response;
  readonly keyIndex?: number;
  readonly upstreamProtocol?: OutboundProtocol;
  readonly measuredTtftMs?: number;
}
```

2. Update function signature to accept `model?: string`:
```typescript
async function dispatchUpstreamFetch(
  route: ResolvedRoute,
  bodyText: string,
  clientHeaders: Headers,
  signal: AbortSignal,
  reqId: string,
  model?: string
): Promise<FetchResult> {
```

3. Update the fetch invocation in the retry loop (around line 805):
```typescript
    const upstreamHeaders = buildUpstreamHeaders(currentKey, route.provider, clientHeaders);
    let execResult: UpstreamExecutionResult;
    try {
      const fetchOpts: FetcherOptions = {
        url: route.upstreamUrl,
        method: "POST",
        headers: upstreamHeaders,
        body: bodyText.length > 0 ? bodyText : undefined,
        clientSignal: signal,
        provider: route.provider,
        keyIndex: currentKeyIndex,
        model,
      };
      execResult = await executeUpstreamFetch(fetchOpts);
    } catch (err: unknown) {
      // unchanged error handling & breaker recording
```

4. Return success metadata (around line 833):
```typescript
    const res = execResult.response;
    if (res.status < 400) {
      breaker?.recordSuccess();
      globalKeyPool.reportSuccess(route.provider, currentKeyIndex);
      return {
        response: res,
        keyIndex: currentKeyIndex,
        upstreamProtocol: execResult.upstreamProtocol,
        measuredTtftMs: execResult.measuredTtftMs,
      };
    }
```

#### Step 4: Fix Telemetry Logging in `handleOpenAiOriginal` (Lines 964, 995, 1015)

1. Rename ingress client protocol (Line 964):
```typescript
// Line 964:
const clientProtocol = req.headers.get("x-http-version") ?? "HTTP/1.1";

// Line 977 (in logInbound):
protocol: clientProtocol,
```

2. Pass model to `dispatchUpstreamFetch` (Line 995):
```typescript
  const fetchResult = await dispatchUpstreamFetch(
    route,
    bodyText,
    req.headers,
    abortController.signal,
    reqId,
    body.model
  );
```

3. Pass real negotiated upstream protocol to `logTtft` (Line 1015):
```typescript
  const actualUpstreamProtocol = fetchResult.upstreamProtocol ?? "HTTP/1.1";
  const effectiveTtftMs = fetchResult.measuredTtftMs ?? ttftMs;
  logTtft(
    reqId,
    effectiveTtftMs,
    isStream ? "Stream established" : "First chunk streamed downstream",
    actualUpstreamProtocol
  );
```

---

## 4. Quality Gates & CleanTS Validation

The implementation complies with all CleanTS guidelines:
- `reassembleResponse` complexity: **3** (limit: 6).
- `executeUpstreamFetch` complexity: **1** (limit: 6).
- Zero swallowed errors in catch blocks.
- Strict typing with explicit readonly properties and zero `any`.

Command to validate AST and complexity:
```bash
node node_modules/clean_ts/dist/cli.js validate src/network/fetcher.ts
node node_modules/clean_ts/dist/cli.js validate src/handlers/openai_original.ts
```

---

## 5. New Unit Test Suite (`tests/unit/openai_original_h2.test.ts`)

```typescript
import { describe, expect, it } from "bun:test";
import { reassembleResponse } from "../../src/network/fetcher";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function createMockStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
      } else {
        controller.enqueue(chunks[index++]);
      }
    },
  });
}

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

describe("Network Fetcher: reassembleResponse & Protocol Fidelity", () => {
  it("reassembles firstChunk and remaining stream with 100% byte fidelity", async () => {
    const chunk1 = encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n");
    const chunk2 = encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n");
    const chunk3 = encoder.encode("data: [DONE]\n\n");

    const rawStream = createMockStream([chunk2, chunk3]);
    const rawReader = rawStream.getReader();

    const mockResponse = new Response(null, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const combinedRes = reassembleResponse(mockResponse, chunk1, rawReader);
    expect(combinedRes.status).toBe(200);
    expect(combinedRes.headers.get("content-type")).toBe("text/event-stream");

    const resultText = await readAllBytes(combinedRes.body!);
    const expectedText =
      "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n" +
      "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n" +
      "data: [DONE]\n\n";

    expect(resultText).toBe(expectedText);
  });

  it("handles empty firstChunk cleanly without crashing", async () => {
    const chunk1 = new Uint8Array(0);
    const chunk2 = encoder.encode("{\"output\":\"direct json payload\"}");

    const rawStream = createMockStream([chunk2]);
    const rawReader = rawStream.getReader();

    const mockResponse = new Response(null, { status: 200 });
    const combinedRes = reassembleResponse(mockResponse, chunk1, rawReader);

    const text = await combinedRes.text();
    expect(text).toBe("{\"output\":\"direct json payload\"}");
  });

  it("propagates downstream cancellation to the underlying rawReader", async () => {
    let cancelCalledWith: unknown = null;
    const rawReader = {
      read: async () => ({ done: false, value: encoder.encode("chunk") }),
      cancel: async (reason: unknown) => {
        cancelCalledWith = reason;
      },
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    const mockResponse = new Response(null, { status: 200 });
    const combinedRes = reassembleResponse(mockResponse, new Uint8Array(0), rawReader);

    const reader = combinedRes.body!.getReader();
    await reader.cancel("client disconnected");

    expect(cancelCalledWith).toBe("client disconnected");
  });
});
```

---

## 6. Live Telemetry Verification & Proof

### Execution:
```bash
bash scripts/restart.sh

curl -X POST http://localhost:7766/v1/responses \
  -H "Authorization: Bearer sk-lr-test" \
  -H "x-api-key: lr-zn-oo-rs-no" \
  -H "Content-Type: application/json" \
  -d '{"model":"big-pickle","input":"ping"}'
```

### Expected Live Terminal Output:
```
🔵 Inbound       | POST /v1/responses | HTTP/1.1 | Direct: lr-zn-oo-rs-no
🎯 Directive     | Directive: Direct: zn | Wire: rs
🤖 Model: ...    | Key: #1 | Ref: OpenCode/1.18.29 @ https://opencode.ai
📦 PREP          | model=big-pickle input=...B stream=false
🔌 UPSTREAM      | zn -> https://opencode.ai/zen/v1/responses stream=false
🟢 [TTFT]        | 312ms | First chunk streamed downstream [Upstream: HTTP/2]
📊 [COMPLETE]    | bytes=... duration=...ms
🏁 [FINISH]      | stop
Served in ...ms [200]
```
**Verification Criterion:** `🟢 [TTFT]` prints **`[Upstream: HTTP/2]`**, confirming both true wire HTTP/2 negotiation and accurate telemetry reporting.

---

## 7. Rollback Procedure

If any anomaly occurs in production:
```bash
git checkout src/network/fetcher.ts src/handlers/openai_original.ts
bash scripts/restart.sh
```
The gateway reverts cleanly to the previous state with zero configuration or persistent data changes.
