import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Server } from "bun";
import { handleAppRequest, resetAllState } from "../../src/lib";

interface AnthropicMockState {
  server: Server<unknown> | null;
  port: number;
  lastHeaders: Headers | null;
  lastBody: Record<string, unknown> | null;
  statusOverride?: number;
}

const state: AnthropicMockState = {
  server: null,
  port: 19802,
  lastHeaders: null,
  lastBody: null,
  statusOverride: undefined,
};

function createAnthropicSseStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","content":[],"model":"claude-3-7-sonnet","stop_reason":null,"usage":{"input_tokens":15,"output_tokens":1}}}\n\n'
        )
      );
      controller.enqueue(
        encoder.encode(
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n'
        )
      );
      controller.enqueue(
        encoder.encode(
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello Claude!"}}\n\n'
        )
      );
      controller.enqueue(
        encoder.encode(
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n'
        )
      );
      controller.enqueue(
        encoder.encode(
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}\n\n'
        )
      );
      controller.enqueue(
        encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n')
      );
      controller.close();
    },
  });
}

async function handleMockAnthropic(req: Request): Promise<Response> {
  state.lastHeaders = req.headers;
  try {
    const text = await req.text();
    state.lastBody = JSON.parse(text) as Record<string, unknown>;
  } catch (err) {
    state.lastBody = { error: String(err) };
  }

  if (state.statusOverride && state.statusOverride >= 400) {
    return new Response(
      JSON.stringify({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Anthropic upstream mock error",
        },
      }),
      {
        status: state.statusOverride,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const isStream = state.lastBody?.stream === true;
  if (isStream) {
    return new Response(createAnthropicSseStream(), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  return new Response(
    JSON.stringify({
      id: "msg_mock_001",
      type: "message",
      role: "assistant",
      content: [{ type: "text", text: "Hello Claude non-stream!" }],
      model: "claude-3-7-sonnet-20250219",
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 8 },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function startMockServer(): void {
  state.server = Bun.serve({
    port: state.port,
    fetch: handleMockAnthropic,
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

describe("Anthropic Compatibility Handler Integration", () => {
  beforeEach(() => {
    process.env.MOCK_AN_PORT = "19802";
    resetAllState();
    startMockServer();
  });

  afterEach(() => {
    delete process.env.MOCK_AN_PORT;
    stopMockServer();
  });

  it("handles non-streaming POST /v1/messages with x-api-key header", async () => {
    const req = new Request("http://localhost:7766/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "lr-an-cl-ms-no",
      },
      body: JSON.stringify({
        model: "claude-3-7-sonnet-20250219",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 100,
        stream: false,
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);
    expect(res.headers.has("content-encoding")).toBe(false);
    expect(state.lastHeaders?.get("accept-encoding")).toBe("identity");

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.type).toBe("message");
    expect(data.role).toBe("assistant");
    expect(Array.isArray(data.content)).toBe(true);
  });

  it("handles streaming POST /v1/messages and emits SSE event stream", async () => {
    const req = new Request("http://localhost:7766/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "lr-an-cl-ms-no",
      },
      body: JSON.stringify({
        model: "claude-3-7-sonnet-20250219",
        messages: [{ role: "user", content: "Tell me a story" }],
        max_tokens: 200,
        stream: true,
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");
    expect(res.headers.has("content-encoding")).toBe(false);
    expect(state.lastHeaders?.get("accept-encoding")).toBe("identity");

    if (!res.body) {
      throw new Error("Response body is null");
    }
    const text = await readAll(res.body);
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("event: message_stop");
  });

  it("rejects unauthorized request with 401 when key is missing", async () => {
    const req = new Request("http://localhost:7766/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-3-7-sonnet-20250219",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(401);
  });

  it("does not log TTFT when upstream returns 4xx/5xx error", async () => {
    state.statusOverride = 500;
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const req = new Request("http://localhost:7766/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": "lr-an-cl-ms-no",
      },
      body: JSON.stringify({
        model: "claude-3-7-sonnet-20250219",
        messages: [{ role: "user", content: "Fail please" }],
        stream: true,
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(500);

    const logCalls = logSpy.mock.calls.map((c) => String(c[0]));
    const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));

    // Verify TTFT is not logged
    expect(logCalls.some((c) => c.includes("[TTFT"))).toBe(false);
    expect(logCalls.some((c) => c.includes("Stream established"))).toBe(false);

    // Verify error was logged via warn with ⚠️
    expect(warnCalls.some((c) => c.includes("⚠️") && c.includes("[SERVED") && c.includes("HTTP 500"))).toBe(true);

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
