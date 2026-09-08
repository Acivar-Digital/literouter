import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { handleAppRequest, resetAllState } from "../../src/lib";

interface GoogleMockState {
  server: Server<unknown> | null;
  port: number;
  lastUrl: string;
  lastHeaders: Headers | null;
  receivedKeys: string[];
  failCount: number;
}

const state: GoogleMockState = {
  server: null,
  port: 19803,
  lastUrl: "",
  lastHeaders: null,
  receivedKeys: [],
  failCount: 0,
};

async function handleGoogleMock(req: Request): Promise<Response> {
  state.lastUrl = req.url;
  state.lastHeaders = new Headers(req.headers);
  const apiKey = req.headers.get("x-goog-api-key");
  if (apiKey) {
    state.receivedKeys.push(apiKey);
  }

  if (state.failCount > 0) {
    state.failCount--;
    return new Response(JSON.stringify({ error: { message: "Resource exhausted", code: 429 } }), {
      status: 429,
      headers: { "Content-Type": "application/json" },
    });
  }

  const isStream = req.url.includes(":streamGenerateContent");
  if (isStream) {
    const sse =
      'data: {"candidates":[{"content":{"parts":[{"text":"Streamed native"}]}}]}\n\n' +
      'data: {"candidates":[{"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":12,"candidatesTokenCount":8,"totalTokenCount":20}}\n\n';
    return new Response(sse, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "transfer-encoding": "chunked",
      },
    });
  }

  const isGenerateContent = req.url.includes(":generateContent");
  if (isGenerateContent) {
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: "model",
              parts: [{ text: "Gemini native response" }],
            },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 15,
          candidatesTokenCount: 5,
          totalTokenCount: 20,
        },
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "transfer-encoding": "chunked",
        },
      }
    );
  }

  return new Response(
    JSON.stringify({
      id: "chatcmpl-gg-beta-1",
      object: "chat.completion",
      created: 1740000000,
      model: "gemini-2.5-flash",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "Google OpenAI-beta response" },
          finish_reason: "stop",
        },
      ],
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
    fetch: handleGoogleMock,
  });
}

function stopMockServer(): void {
  if (state.server) {
    state.server.stop(true);
    state.server = null;
  }
}

describe("Google Native & Beta Endpoints Integration", () => {
  beforeEach(() => {
    process.env.MOCK_GG_PORT = "19803";
    resetAllState();
    state.lastUrl = "";
    state.lastHeaders = null;
    state.receivedKeys = [];
    state.failCount = 0;
    startMockServer();
  });

  afterEach(() => {
    delete process.env.MOCK_GG_PORT;
    stopMockServer();
  });

  it("handles native /v1beta/models/*:generateContent with ?key= query auth", async () => {
    const url =
      "http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent?key=lr-gg-gg-gc-no";
    const req = new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Explain quantum computing" }] }],
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.candidates).toBeDefined();
    expect(Array.isArray(data.candidates)).toBe(true);
  });

  it("handles OpenAI-compatible beta /v1beta/openai/chat/completions", async () => {
    const url = "http://localhost:7766/v1beta/openai/chat/completions";
    const req = new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-gg-oa-ob-dp",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Hello Gemini" }],
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const data = (await res.json()) as Record<string, unknown>;
    expect(data.choices).toBeDefined();
  });

  it("rejects unauthorized native requests with 401", async () => {
    const url =
      "http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent?key=invalid_key";
    const req = new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(401);
  });

  it("handles native /v1beta/models/*:streamGenerateContent with ?alt=sse and header sanitization", async () => {
    const url =
      "http://localhost:7766/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse";
    const req = new Request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer lr-gg-gg-gc-no",
        "X-Goog-Api-Key": "client-passed-key",
      },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Stream this" }] }],
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).toContain("Streamed native");
    expect(text).toContain("finishReason");
    expect(text).toContain("usageMetadata");

    // Downstream headers should strip content-encoding and transfer-encoding
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("transfer-encoding")).toBeNull();

    // Upstream headers received by mock should have authorization stripped, accept-encoding set, x-goog-api-key injected
    expect(state.lastHeaders).not.toBeNull();
    expect(state.lastHeaders?.get("authorization")).toBeNull();
    expect(state.lastHeaders?.get("accept-encoding")).toBe("identity");
    expect(state.lastHeaders?.get("x-goog-api-key")).not.toBe("client-passed-key");
    expect(state.lastHeaders?.get("x-goog-api-key")).toBeDefined();
    expect(state.lastUrl).toContain(":streamGenerateContent?alt=sse");
  });

  it("rotates keys and retries on 429", async () => {
    state.failCount = 1; // 1 failure then success
    const url =
      "http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent?key=lr-gg-gg-gc-no";
    const req = new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: "Retry test" }] }],
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);
    expect(state.receivedKeys.length).toBe(2);
    // Keys should rotate
    expect(state.receivedKeys[0]).not.toBe(state.receivedKeys[1]);
  });
});
