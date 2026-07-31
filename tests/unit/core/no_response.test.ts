import { test, expect } from "bun:test";
import {
  fetchWithFirstByteTimeout,
  NoResponseError,
  createStreamTransformer,
} from "../../../src/lib";

// A server that accepts the connection but NEVER sends a response — the
// "no signal, no response" ghost (e.g. NVIDIA black-holing the first request).
function startSilentServer() {
  return Bun.serve({
    port: 0,
    fetch() {
      // Return a promise that never resolves and never sends bytes.
      return new Promise<Response>(() => {});
    },
  });
}

test("fetchWithFirstByteTimeout throws NoResponseError on silent upstream (no 300s hang)", async () => {
  const server = startSilentServer();
  const url = `http://localhost:${server.port}/v1/chat/completions`;
  const start = Date.now();
  try {
    await fetchWithFirstByteTimeout(
      url,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      { noResponseTimeoutMs: 2000, totalTimeoutMs: 300_000 },
    );
    throw new Error("expected NoResponseError but fetch resolved");
  } catch (e: any) {
    expect(e).toBeInstanceOf(NoResponseError);
    // Must fail fast (within the 2s first-byte window), not after 300s.
    expect(Date.now() - start).toBeLessThan(10_000);
  } finally {
    server.stop(true);
  }
});

test("fetchWithFirstByteTimeout throws NoResponseError when 200 OK headers return but zero body chunks arrive", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      // Send 200 OK headers immediately, but never enqueue any body chunk
      return new Response(
        new ReadableStream({
          start() {
            // Never enqueue or close
          },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } },
      );
    },
  });
  const url = `http://localhost:${server.port}/`;
  const start = Date.now();
  try {
    await fetchWithFirstByteTimeout(
      url,
      { method: "POST", body: "{}" },
      { noResponseTimeoutMs: 1000, totalTimeoutMs: 300_000 },
    );
    throw new Error("expected NoResponseError on 200 OK ghosting body");
  } catch (e: any) {
    expect(e).toBeInstanceOf(NoResponseError);
    expect(Date.now() - start).toBeLessThan(5000);
  } finally {
    server.stop(true);
  }
});

test("createStreamTransformer handles mid-stream idle timeout cleanly and reports key error to router", async () => {
  let reported = false;
  const mockMeta = {
    reqId: "test-req-id",
    provider: "openrouter",
    modelName: "openrouter/inclusionai/ling-3.0-flash:free",
    upstream_model: "inclusionai/ling-3.0-flash:free",
    activeKey: "sk-or-v1-testkey",
    requestStart: Date.now(),
  };

  const transformer = createStreamTransformer(false, mockMeta, undefined, 200);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
      // Stalls here - no more chunks sent
    },
  }).pipeThrough(transformer);

  const reader = stream.getReader();
  const chunks: string[] = [];
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value));
  }

  const fullText = chunks.join("");
  expect(fullText).toContain("[DONE]");
  expect(fullText).not.toContain("upstream_idle_timeout");
});

test("fetchWithFirstByteTimeout returns a normal response when upstream answers", async () => {
  const server = Bun.serve({
    port: 0,
    fetch() {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const url = `http://localhost:${server.port}/`;
  try {
    const resp = await fetchWithFirstByteTimeout(
      url,
      { method: "GET" },
      { noResponseTimeoutMs: 2000, totalTimeoutMs: 300_000 },
    );
    expect(resp.status).toBe(200);
    const body = await resp.json();
    expect(body.ok).toBe(true);
  } finally {
    server.stop(true);
  }
});
