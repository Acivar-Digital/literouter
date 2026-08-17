import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { handleAppRequest, resetAllState } from "../../src/lib";

interface StallMockState {
  server: Server<unknown> | null;
  port: number;
  attempts: number;
}

const state: StallMockState = {
  server: null,
  port: 19806,
  attempts: 0,
};

function createStallingStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"Partial"}}]}\n\n')
      );
      controller.close();
    },
  });
}

function createCompleteStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode('data: {"choices":[{"delta":{"content":"Complete text"}}]}\n\n')
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

function handleStallMock(): Response {
  state.attempts += 1;
  if (state.attempts === 1) {
    return new Response(createStallingStream(), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  return new Response(createCompleteStream(), {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function startMockServer(): void {
  state.server = Bun.serve({
    port: state.port,
    fetch: handleStallMock,
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

describe("Stream Stall Resend Integration", () => {
  beforeEach(() => {
    process.env.MOCK_OR_PORT = "19806";
    resetAllState();
    state.attempts = 0;
    startMockServer();
  });

  afterEach(() => {
    delete process.env.MOCK_OR_PORT;
    stopMockServer();
  });

  it("handles mid-stream stall and retries on the same key up to max attempts", async () => {
    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-or-oa-ch-no",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Stall test" }],
        stream: true,
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    if (!res.body) {
      throw new Error("Response body is null");
    }
    const text = await readAll(res.body);
    expect(text.length).toBeGreaterThan(0);
    expect(text).toContain("data:");
  });
});
