import { test, expect } from "bun:test";
import { fetchWithFirstByteTimeout, NoResponseError } from "../../../src/lib";

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
