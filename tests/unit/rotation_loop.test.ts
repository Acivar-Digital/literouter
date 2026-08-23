import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  globalCooldownManager,
  handleAppRequest,
  resetAllState,
} from "../../src/lib";

describe("In-Flight Retry & Rotation Loop", () => {
  const originalFetch = globalThis.fetch;
  const originalEnvOpenAi = process.env.OPENAI_API_KEYS;

  const mockSuccessJson = {
    id: "chatcmpl-test-123",
    object: "chat.completion",
    created: Date.now(),
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Hello from rotated key!" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };

  beforeEach(() => {
    process.env.OPENAI_API_KEYS = "sk-mock-key-1,sk-mock-key-2";
    resetAllState();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnvOpenAi !== undefined) {
      process.env.OPENAI_API_KEYS = originalEnvOpenAi;
    } else {
      delete process.env.OPENAI_API_KEYS;
    }
    resetAllState();
  });

  function createTestRequest(signal?: AbortSignal): Request {
    return new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        Authorization: "Bearer lr-oa-oa-ch-no",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello world" }],
        stream: false,
      }),
    });
  }

  it("retries on Key 2 when Key 1 returns 400 'no available provider' and succeeds with 200", async () => {
    const fetchCalls: { url: string; authHeader: string | null }[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization") || headers.get("api-key");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, authHeader });

      if (authHeader?.includes("sk-mock-key-1")) {
        return new Response(
          JSON.stringify({
            error: { message: "No available provider for the requested model" },
          }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (authHeader?.includes("sk-mock-key-2")) {
        return new Response(JSON.stringify(mockSuccessJson), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Unauthorized", { status: 401 });
    }) as typeof fetch;

    const response = await handleAppRequest(createTestRequest());
    expect(response.status).toBe(200);

    const body = (await response.json()) as typeof mockSuccessJson;
    expect(body.choices[0]?.message.content).toBe("Hello from rotated key!");
    expect(fetchCalls.length).toBe(2);
    expect(fetchCalls[0]?.authHeader).toContain("sk-mock-key-1");
    expect(fetchCalls[1]?.authHeader).toContain("sk-mock-key-2");
  });

  it("fails fast on 400 'maximum context length' without trying Key 2", async () => {
    const fetchCalls: { url: string; authHeader: string | null }[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization") || headers.get("api-key");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, authHeader });

      return new Response(
        JSON.stringify({
          error: {
            message: "This model's maximum context length is 8192 tokens. However, you requested 10000 tokens.",
            code: "context_length_exceeded",
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }) as typeof fetch;

    const response = await handleAppRequest(createTestRequest());
    expect(response.status).toBe(400);

    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0]?.authHeader).toContain("sk-mock-key-1");
  });

  it("retries on Key 2 when Key 1 returns 429 Rate Limit and succeeds with 200", async () => {
    const fetchCalls: { url: string; authHeader: string | null }[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization") || headers.get("api-key");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, authHeader });

      if (authHeader?.includes("sk-mock-key-1")) {
        return new Response(
          JSON.stringify({
            error: { message: "Rate limit reached for requests" },
          }),
          {
            status: 429,
            headers: { "Content-Type": "application/json", "retry-after": "30" },
          }
        );
      }

      if (authHeader?.includes("sk-mock-key-2")) {
        return new Response(JSON.stringify(mockSuccessJson), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Unauthorized", { status: 401 });
    }) as typeof fetch;

    const response = await handleAppRequest(createTestRequest());
    expect(response.status).toBe(200);

    const body = (await response.json()) as typeof mockSuccessJson;
    expect(body.choices[0]?.message.content).toBe("Hello from rotated key!");
    expect(fetchCalls.length).toBe(2);
    expect(fetchCalls[0]?.authHeader).toContain("sk-mock-key-1");
    expect(fetchCalls[1]?.authHeader).toContain("sk-mock-key-2");
  });

  it("quarantines Key 1 on 401 (tiered quarantine: 300s for 1st failure) and succeeds with Key 2", async () => {
    const fetchCalls: { url: string; authHeader: string | null }[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization") || headers.get("api-key");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, authHeader });

      if (authHeader?.includes("sk-mock-key-1")) {
        return new Response(
          JSON.stringify({
            error: { message: "Incorrect API key provided" },
          }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }
        );
      }

      if (authHeader?.includes("sk-mock-key-2")) {
        return new Response(JSON.stringify(mockSuccessJson), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Unauthorized", { status: 401 });
    }) as typeof fetch;

    const response = await handleAppRequest(createTestRequest());
    expect(response.status).toBe(200);

    const body = (await response.json()) as typeof mockSuccessJson;
    expect(body.choices[0]?.message.content).toBe("Hello from rotated key!");
    expect(fetchCalls.length).toBe(2);
    expect(fetchCalls[0]?.authHeader).toContain("sk-mock-key-1");
    expect(fetchCalls[1]?.authHeader).toContain("sk-mock-key-2");

    // Key 1 (index 0 of "oa") should be quarantined for 300s (300,000ms) on 1st auth failure
    expect(globalCooldownManager.isQuarantined("oa:0")).toBe(true);
    const remainingMs = globalCooldownManager.getRemainingMs("oa:0");
    expect(remainingMs).toBeGreaterThan(290 * 1000);
    expect(remainingMs).toBeLessThanOrEqual(300 * 1000);
  });

  it("retries on Key 2 when Key 1 encounters a raw socket transport error (e.g. 'The connection was closed') and succeeds with 200", async () => {
    const fetchCalls: { url: string; authHeader: string | null }[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization") || headers.get("api-key");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, authHeader });

      if (authHeader?.includes("sk-mock-key-1")) {
        throw new Error("The connection was closed");
      }

      if (authHeader?.includes("sk-mock-key-2")) {
        return new Response(JSON.stringify(mockSuccessJson), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Unauthorized", { status: 401 });
    }) as typeof fetch;

    const response = await handleAppRequest(createTestRequest());
    expect(response.status).toBe(200);

    const body = (await response.json()) as typeof mockSuccessJson;
    expect(body.choices[0]?.message.content).toBe("Hello from rotated key!");
    expect(fetchCalls.length).toBe(2);
    expect(fetchCalls[0]?.authHeader).toContain("sk-mock-key-1");
    expect(fetchCalls[1]?.authHeader).toContain("sk-mock-key-2");
  });

  it("does not retry on Key 2 and propagates abort when clientSignal is aborted", async () => {
    const fetchCalls: { url: string; authHeader: string | null }[] = [];
    const controller = new AbortController();

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization") || headers.get("api-key");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, authHeader });

      if (authHeader?.includes("sk-mock-key-1")) {
        controller.abort();
        const abortErr = new Error("The operation was aborted");
        abortErr.name = "AbortError";
        throw abortErr;
      }

      if (authHeader?.includes("sk-mock-key-2")) {
        return new Response(JSON.stringify(mockSuccessJson), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Unauthorized", { status: 401 });
    }) as typeof fetch;

    const response = await handleAppRequest(createTestRequest(controller.signal));
    expect(response.status).not.toBe(200);

    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0]?.authHeader).toContain("sk-mock-key-1");
  });
});
