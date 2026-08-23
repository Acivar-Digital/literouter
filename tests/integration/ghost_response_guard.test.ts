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

  it("does NOT falsely flag non-streaming tool call with null content as ghost response", async () => {
    stopMockServer();
    state.server = Bun.serve({
      port: state.port,
      fetch: () => {
        state.callCount += 1;
        return Response.json({
          id: "chatcmpl-tool-test",
          object: "chat.completion",
          created: 1700000000,
          model: "openai/gpt-4o",
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_abc123",
                    type: "function",
                    function: {
                      name: "get_current_weather",
                      arguments: '{"location":"San Francisco"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
          usage: {
            prompt_tokens: 15,
            completion_tokens: 25,
            total_tokens: 40,
          },
        });
      },
    });

    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-or-oa-ch-no",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "What is the weather?" }],
        stream: false,
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const json = (await res.json()) as Record<string, unknown>;
    const choices = json.choices as Array<{ message?: { content?: unknown; tool_calls?: Array<{ id: string }> } }>;
    expect(choices).toBeDefined();
    const firstChoice = choices?.[0];
    expect(firstChoice).toBeDefined();
    expect(firstChoice?.message?.content).toBeNull();
    expect(firstChoice?.message?.tool_calls).toBeDefined();
    expect(firstChoice?.message?.tool_calls?.[0]?.id).toBe("call_abc123");
    // Should succeed on the very first attempt without false-positive key rotation
    expect(state.callCount).toBe(1);
  });

  it("does NOT falsely flag streaming tool call delta without content as ghost response", async () => {
    stopMockServer();
    state.server = Bun.serve({
      port: state.port,
      fetch: () => {
        state.callCount += 1;
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_xyz789","type":"function","function":{"name":"fetch_stock","arguments":""}}]}}]}\n\n'
                )
              );
              controller.enqueue(
                encoder.encode(
                  'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"ticker\\":\\"NVDA\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n'
                )
              );
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              controller.close();
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          }
        );
      },
    });

    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-or-oa-ch-no",
      },
      body: JSON.stringify({
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Check NVDA stock" }],
        stream: true,
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    if (!res.body) {
      throw new Error("Response body is null");
    }
    const text = await readAll(res.body);
    expect(text).toContain("fetch_stock");
    expect(text).toContain("call_xyz789");
    expect(state.callCount).toBe(1);
  });
});
