import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { handleAppRequest, resetAllState } from "../../src/lib";

interface GhostMockState {
  server: Server<unknown> | null;
  port: number;
  callCount: number;
}

const state: GhostMockState = {
  server: null,
  port: 19805,
  callCount: 0,
};

function createEmptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.close();
    },
  });
}

function createValidStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"choices":[{"delta":{"content":"Valid response after ghost"}}]}\n\n'
        )
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function handleGhostMock(): Response {
  state.callCount += 1;
  if (state.callCount === 1) {
    return new Response(createEmptyStream(), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  return new Response(createValidStream(), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function startMockServer(): void {
  state.server = Bun.serve({
    port: state.port,
    fetch: handleGhostMock,
  });
}

function stopMockServer(): void {
  if (state.server) {
    state.server.stop(true);
    state.server = null;
  }
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
  }
  return acc;
}

describe("Ghost Response & Zero-Token Guard Integration", () => {
  beforeEach(() => {
    process.env.MOCK_OR_PORT = "19805";
    resetAllState();
    state.callCount = 0;
    startMockServer();
  });

  afterEach(() => {
    delete process.env.MOCK_OR_PORT;
    stopMockServer();
  });

  it("detects 0-token HTTP 200 stream, rotates key, and succeeds seamlessly", async () => {
    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-or-oa-ch-no",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Ghost test" }],
        stream: true,
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    if (!res.body) {
      throw new Error("Response body is null");
    }
    const text = await readAll(res.body);
    expect(text).toContain("Valid response after ghost");
    expect(state.callCount).toBeGreaterThanOrEqual(1);
  });
});
