import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { Server } from "bun";
import { handleAppRequest, resetAllState } from "../../src/lib";

interface MockServerState {
  server: Server<unknown> | null;
  port: number;
  lastHeaders: Headers | null;
  lastBody: Record<string, unknown> | null;
  statusOverride?: number;
}

const state: MockServerState = {
  server: null,
  port: 19801,
  lastHeaders: null,
  lastBody: null,
  statusOverride: undefined,
};

function createJsonResponse(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createSseStream(): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(
          'data: {"id":"chat-1","choices":[{"delta":{"content":"Hi"}}]}\n\n'
        )
      );
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

async function handleMockRequest(req: Request): Promise<Response> {
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
        error: {
          message: "Upstream error message",
          type: "invalid_request_error",
          code: state.statusOverride,
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
    return new Response(createSseStream(), {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  return createJsonResponse({
    id: "chatcmpl-mock-1",
    object: "chat.completion",
    created: 1740000000,
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Hello from mock upstream!" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 6, total_tokens: 16 },
  });
}

function startMockServer(): void {
  state.server = Bun.serve({
    port: state.port,
    fetch: handleMockRequest,
  });
}

function stopMockServer(): void {
  if (state.server) {
    state.server.stop(true);
    state.server = null;
  }
}

async function readAllStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    result += decoder.decode(value, { stream: true });
  }
  return result;
}

describe("OpenAI Compatibility Handler Integration", () => {
  beforeEach(() => {
    state.statusOverride = undefined;
    process.env.MOCK_OR_PORT = "19801";
    resetAllState();
    startMockServer();
  });

  afterEach(() => {
    delete process.env.MOCK_OR_PORT;
    stopMockServer();
  });

  it("handles non-streaming POST /v1/chat/completions successfully", async () => {
    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-or-oa-ch-no",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Ping" }],
        stream: false,
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.id).toBeDefined();
    expect(Array.isArray(data.choices)).toBe(true);
  });

  it("handles streaming POST /v1/chat/completions with SSE", async () => {
    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-or-oa-ch-no",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Stream me" }],
        stream: true,
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/event-stream");

    if (!res.body) {
      throw new Error("Response body is null");
    }
    const output = await readAllStream(res.body);
    expect(output).toContain("data:");
    expect(output).toContain("[DONE]");
  });

  it("returns 401 when API key directive is missing or malformed", async () => {
    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer invalid-directive-key",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hi" }],
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(401);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBeDefined();
  });

  it("does not log TTFT when upstream returns 4xx/5xx error", async () => {
    state.statusOverride = 404;
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-or-oa-ch-no",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Fail please" }],
        stream: true,
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(404);

    const logCalls = logSpy.mock.calls.map((c) => String(c[0]));
    const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));

    // Verify TTFT is not logged
    expect(logCalls.some((c) => c.includes("[TTFT"))).toBe(false);
    expect(logCalls.some((c) => c.includes("Stream established"))).toBe(false);

    // Verify error was logged via warn with ⚠️
    expect(warnCalls.some((c) => c.includes("⚠️") && c.includes("[SERVED") && c.includes("HTTP 404"))).toBe(true);

    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("returns 503 load shed when all provider keys are quarantined beyond wait budget", async () => {
    const { globalKeyPool } = await import("../../src/handlers/openai_compat");
    const poolSize = globalKeyPool.getPoolSize("or");
    for (let i = 0; i < poolSize; i++) {
      globalKeyPool.reportFailure("or", i, 429, undefined, "Rate limit", Date.now(), 600);
    }

    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-or-oa-ch-no",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Load shed test" }],
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(503);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.error).toBeDefined();
  });

  it("handles transient cooldown with dwell and does not emit phantom logLimit", async () => {
    const { globalKeyPool } = await import("../../src/handlers/openai_compat");
    globalKeyPool.reset();
    globalKeyPool.setPool("or", ["sk-mock-key-1"]);
    // Quarantine with a short TTL (100ms)
    globalKeyPool.reportFailure("or", 0, 0, undefined, "transport timeout", Date.now(), 0.1);

    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-or-oa-ch-no",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Dwell test" }],
      }),
    });

    const res = await handleAppRequest(req);
    // After dwell wait, key became available and mock handler was called
    expect(res.status).toBe(200);

    const warnCalls = warnSpy.mock.calls.map((c) => String(c[0]));
    // Ensure NO phantom 429 was logged
    expect(warnCalls.some((c) => c.includes("[LIMIT") && c.includes("429"))).toBe(false);

    warnSpy.mockRestore();
    errorSpy.mockRestore();
    globalKeyPool.reset();
  });
});
