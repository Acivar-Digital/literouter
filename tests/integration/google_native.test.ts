import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Server } from "bun";
import { handleAppRequest, resetAllState } from "../../src/lib";

interface GoogleMockState {
  server: Server<unknown> | null;
  port: number;
  lastUrl: string;
}

const state: GoogleMockState = {
  server: null,
  port: 19803,
  lastUrl: "",
};

async function handleGoogleMock(req: Request): Promise<Response> {
  state.lastUrl = req.url;
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
        headers: { "Content-Type": "application/json" },
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
});
