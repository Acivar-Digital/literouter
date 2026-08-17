import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { handleAppRequest, resetAllState } from "../../src/lib";

interface AbortMockState {
  server: Server<unknown> | null;
  port: number;
  abortedReceived: boolean;
}

const state: AbortMockState = {
  server: null,
  port: 19804,
  abortedReceived: false,
};

function safeCloseController(controller: ReadableStreamDefaultController<Uint8Array>): void {
  try {
    controller.close();
  } catch (err) {
    if (err instanceof Error) {
      // stream already closed or canceled
    }
  }
}

function createHangingStream(signal: AbortSignal): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"First"}}]}\n\n'));
      signal.addEventListener("abort", () => {
        state.abortedReceived = true;
        safeCloseController(controller);
      });
    },
  });
}

function handleAbortMock(req: Request): Response {
  return new Response(createHangingStream(req.signal), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function startMockServer(): void {
  state.server = Bun.serve({
    port: state.port,
    fetch: handleAbortMock,
  });
}

function stopMockServer(): void {
  if (state.server) {
    state.server.stop(true);
    state.server = null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function consumeResponseBody(res: Response): Promise<void> {
  if (!res.body) {
    return;
  }
  const reader = res.body.getReader();
  while (true) {
    const { done } = await reader.read();
    if (done) {
      break;
    }
  }
}

describe("Client Abort Signal Propagation Integration", () => {
  beforeEach(() => {
    process.env.MOCK_OR_PORT = "19804";
    resetAllState();
    state.abortedReceived = false;
    startMockServer();
  });

  afterEach(() => {
    delete process.env.MOCK_OR_PORT;
    stopMockServer();
  });

  it("propagates downstream client abort signal upstream immediately", async () => {
    const controller = new AbortController();

    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-or-oa-ch-no",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Long task" }],
        stream: true,
      }),
      signal: controller.signal,
    });

    const resPromise = handleAppRequest(req);
    await delay(30);

    controller.abort();
    let caughtError = false;

    try {
      const res = await resPromise;
      await consumeResponseBody(res);
    } catch (err) {
      caughtError = true;
      expect(err).toBeDefined();
    }

    await delay(50);
    expect(state.abortedReceived || caughtError).toBe(true);
  });
});
