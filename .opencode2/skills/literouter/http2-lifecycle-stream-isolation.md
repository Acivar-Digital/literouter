# LiteRouter HTTP/2 & HTTP/1.1 Server Lifecycle, Stream Isolation, and Connection Pooling

This operational and architectural guide documents the inbound downstream request/response lifecycle, outbound multiplexed HTTP/2 connection pooling, anti-pinning socket aging, and the critical event traps that must be avoided in LiteRouter.

---

## 1. Downstream Server Lifecycle & The Request Event Traps

LiteRouter runs a dual-ALPN (`h2` + `http/1.1`) server via Node.js `http2.createSecureServer({ allowHTTP1: true })`. Understanding the exact event semantics of `nodeReq` (`Http2ServerRequest`) and `nodeRes` (`Http2ServerResponse`) is critical to preventing hanging requests and premature aborts.

### ⛔ The `nodeReq.on("close")` Trap
- In Node.js and Bun HTTP servers, `nodeReq` is the **readable stream representing the client's request body upload**.
- As soon as the client finishes uploading its payload (e.g. JSON prompt payload) and `nodeReq.on("end")` emits, **`nodeReq` emits `"close"` and transitions to `nodeReq.destroyed = true`**.
- **The Fatal Anti-Pattern**:
  ```ts
  // ❌ WRONG: nodeReq emits "close" when the upload finishes, before upstream responds!
  // This causes onAbort() to fire instantly on every request, aborting the gateway turn!
  nodeReq.once("close", () => {
    if (!nodeRes.writableEnded) abortController.abort();
  });
  ```
- **The Consequence**: The gateway immediately aborts its internal `AbortController.signal` before upstream tokens can return. The client waits forever for headers/data that will never arrive.

### 🟢 True Downstream Client Disconnect Detection
To reliably detect when a downstream client (e.g. OpenCode, Claude Code, Python `httpx`, Pydantic AI) hangs up or cancels mid-turn:
```ts
// ✅ CORRECT: Only listen to genuine client disconnect events
const abortController = new AbortController();
const onAbort = () => {
  if (!nodeRes.writableEnded) {
    abortController.abort();
  }
};

nodeReq.once("aborted", onAbort);
nodeRes.once("close", onAbort);
```

---

## 2. Response Streaming & Backpressure Piping (`pipeWebResponseToNode`)

When piping the web-standard `Response` body (`ReadableStream<Uint8Array>`) back to Node's `nodeRes`:

### ⛔ The `nodeReq.destroyed` Trap
- Never check `if (nodeReq.destroyed) return;` at the start of response piping.
- `nodeReq.destroyed` is **expected** to be `true` after the request body has been fully parsed into memory.
- Checking `nodeReq.destroyed` causes `pipeWebResponseToNode` to return early with 0 bytes written, freezing the client socket indefinitely.

### 🟢 Robust Response Piping Implementation
```ts
async function pipeWebResponseToNode(
  webRes: Response,
  _nodeReq: http2.Http2ServerRequest,
  nodeRes: http2.Http2ServerResponse
): Promise<void> {
  if (nodeRes.destroyed || nodeRes.writableEnded) {
    return;
  }

  nodeRes.statusCode = webRes.status;
  webRes.headers.forEach((val, key) => {
    const lower = key.toLowerCase();
    if (lower !== "transfer-encoding" && lower !== "connection") {
      nodeRes.setHeader(key, val);
    }
  });

  if (!webRes.body) {
    if (!nodeRes.writableEnded && !nodeRes.destroyed) {
      nodeRes.end();
    }
    return;
  }

  const reader = webRes.body.getReader();
  let isAborted = false;

  const cancelReader = () => {
    if (isAborted) return;
    isAborted = true;
    reader.cancel().catch((err: unknown) => {
      console.debug("[H2 Server] Reader cancel error:", err);
    });
  };

  const onResClose = () => {
    if (!nodeRes.writableEnded) {
      cancelReader();
    }
  };

  nodeRes.once("close", onResClose);

  try {
    while (!isAborted && !nodeRes.destroyed && !nodeRes.writableEnded) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value && !nodeRes.destroyed && !nodeRes.writableEnded) {
        const canContinue = nodeRes.write(value);
        if (!canContinue && !nodeRes.destroyed && !nodeRes.writableEnded) {
          await new Promise<void>((resolve) => nodeRes.once("drain", resolve));
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    const isStreamAbort =
      isAborted ||
      nodeRes.destroyed ||
      msg.includes("The pending stream has been canceled") ||
      msg.includes("ERR_HTTP2_STREAM_CANCEL") ||
      msg.includes("aborted");

    if (!isStreamAbort) {
      logError("STREAM", "Stream read error during HTTP/2 response piping", err);
    }
    if (!nodeRes.destroyed && !nodeRes.writableEnded) {
      try {
        nodeRes.destroy(err instanceof Error ? err : new Error(String(err)));
      } catch (destroyErr: unknown) {
        console.debug("[H2 Server] Error destroying nodeRes stream:", destroyErr);
      }
    }
  } finally {
    nodeRes.removeListener("close", onResClose);
    if (!nodeRes.writableEnded && !nodeRes.destroyed) {
      try {
        nodeRes.end();
      } catch (endErr: unknown) {
        console.debug("[H2 Server] Error ending nodeRes stream:", endErr);
      }
    }
  }
}
```

---

## 3. Outbound HTTP/2 Connection Pool Architecture (`src/network/h2_pool.ts`)

LiteRouter multiplexes outbound requests across multiple upstream TCP connections using Node.js `node:http2`.

### Core Pool Invariants
1. **Multi-Session Balancing (`sessionsPerOrigin = 4`)**:
   - Spawns up to 4 parallel `ClientHttp2Session` connections per upstream origin (e.g. `https://openrouter.ai`).
   - Dispatches new requests using a least-loaded algorithm (`activeStreams < maxStreamsPerSession`).
2. **Staggered Socket Aging & Anti-Pinning 429 Protection**:
   - **The L4 Pinning Problem**: Persistent HTTP/2 sockets remain pinned to a single upstream Cloudflare edge blade. High-throughput turns exhaust that blade's local rate-limit token bucket, returning false `429 Too Many Requests`.
   - **The Solution**: Sessions age out after `maxSessionAgeMs = 180s ± 15s jitter`.
   - When a session reaches its age limit, it marks `isDraining = true`. No new streams attach to it, and it gracefully closes when existing streams complete. New requests spawn fresh TCP connections with new ephemeral ports and full rate-limit quotas.
3. **Stream Isolation vs. Session Purge**:
   - **Stream-Level Errors**: If an individual stream aborts or is canceled (`ERR_HTTP2_STREAM_CANCEL`), call `stream.destroy()`. Do **not** destroy the parent session. Neighboring streams on the same socket continue uninterrupted.
   - **Session-Level Purging**: `pool.purgeSession(origin, session)` is strictly gated to true transport fatalities:
     - `!pool.isSessionHealthy(session)`
     - `session.destroyed === true`
     - `session.closed === true`
     - `session.on("error")` or unrecoverable `GOAWAY` frames.

---

## 4. Upstream Error Classification & Zero-Quarantine Rules (`src/network/classifier.ts`)

When an upstream connection resets or a stream cancels mid-flight:
1. **0s Quarantine TTL (`action: retry_rotate`)**:
   - Transport resets (`"The pending stream has been canceled"`, `"ERR_HTTP2_STREAM_CANCEL"`, `"RST_STREAM"`, `ECONNRESET`, `ECONNREFUSED`) are recognized as network blips, not key exhaustion.
   - `classifyTransportError` assigns `quarantineTtlSec = 0` and `action = "retry_rotate"`.
2. **Dynamic Handler Retries**:
   - `openai_compat.ts` and `anthropic_compat.ts` inspect `classifyTransportError` rather than applying hardcoded 60s key penalties.
   - Valid keys remain available in the pool for subsequent turns.

---

## 5. Diagnostic & Verification Checklist

When diagnosing stream or transport issues:
- [ ] Run `bun run typecheck` (`tsc --noEmit`).
- [ ] Run `bun test` to verify unit tests for `h2_pool`, `classifier`, and `pacer`.
- [ ] Run `uv run pytest tests/integration/` to verify live streaming and dual-ALPN handshakes.
- [ ] Verify gateway status: `bash scripts/status.sh` or `tmux attach -t literouter`.
- [ ] Restart gateway after edits: `bash scripts/restart.sh`.
