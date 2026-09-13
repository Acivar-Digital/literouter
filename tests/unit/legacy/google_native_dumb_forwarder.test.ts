import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetAllState } from "../../../src/lib";
import { handleGoogleNative } from "../../../src/handlers/google_native";

describe("Google Native Dumb Forwarder Unit Tests", () => {
  const originalFetch = globalThis.fetch;
  const originalEnvGoogle = process.env.GOOGLE_API_KEYS;
  const mockKeys = ["AIzaSyMockKey1-test-stub", "AIzaSyMockKey2-test-stub", "AIzaSyMockKey3-test-stub"];

  beforeEach(() => {
    process.env.GOOGLE_API_KEYS = mockKeys.join(",");
    resetAllState();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnvGoogle !== undefined) {
      process.env.GOOGLE_API_KEYS = originalEnvGoogle;
    } else {
      delete process.env.GOOGLE_API_KEYS;
    }
    resetAllState();
  });

  it("rejects non-Google directives with HTTP 400", async () => {
    const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    const res = await handleGoogleNative(req, "lr-or-oa-ch-no", "req-test-non-gg");
    expect(res.status).toBe(400);

    const data = (await res.json()) as { error?: { message?: string } };
    expect(data.error?.message).toContain("Google native requires a Google directive");
  });

  it("rejects malformed or invalid directives with HTTP 401", async () => {
    const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    const res = await handleGoogleNative(req, "invalid-key-format", "req-test-invalid");
    expect(res.status).toBe(401);
  });

  it("sanitizes outgoing upstream headers and injects x-goog-api-key", async () => {
    let capturedUrl = "";
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      capturedUrl = input.toString();
      capturedHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const req = new Request(
      "http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent?key=lr-gg-gg-gc-no&param=1",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer lr-gg-gg-gc-no",
          "X-Goog-Api-Key": "client-supplied-key",
          "X-Custom-Client": "my-client",
          Host: "localhost:7766",
          "Content-Length": "999",
        },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "Hello" }] }] }),
      }
    );

    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-test-headers");
    expect(res.status).toBe(200);

    // Upstream URL should strip ?key= but keep ?param=1
    expect(capturedUrl).not.toContain("key=");
    expect(capturedUrl).toContain("param=1");
    expect(capturedUrl).toContain("/v1beta/models/gemini-2.5-flash:generateContent");

    // Check upstream headers
    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders?.get("authorization")).toBeNull();
    expect(capturedHeaders?.get("host")).toBeNull();
    expect(capturedHeaders?.get("content-length")).toBeNull();
    expect(capturedHeaders?.get("x-custom-client")).toBe("my-client");
    expect(capturedHeaders?.get("accept-encoding")).toBe("identity");

    const apiKey = capturedHeaders?.get("x-goog-api-key");
    expect(apiKey).toBeDefined();
    expect(mockKeys).toContain(apiKey!);
  });

  it("sanitizes downstream headers by removing hop-by-hop and encoding headers", async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          "Transfer-Encoding": "chunked",
          "Content-Length": "42",
          "X-Upstream-Header": "preserved",
        },
      });
    }) as unknown as typeof fetch;

    const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-test-downstream-headers");
    expect(res.status).toBe(200);

    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("transfer-encoding")).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("x-upstream-header")).toBe("preserved");
    expect(res.headers.get("content-type")).toBe("application/json");
  });

  it("passes SSE stream bytes transparently without modification", async () => {
    const ssePayload =
      'data: {"candidates":[{"content":{"parts":[{"text":"Chunk 1"}]}}]}\n\n' +
      'data: {"candidates":[{"content":{"parts":[{"text":"Chunk 2"}]}}]}\n\n';

    globalThis.fetch = (async () => {
      return new Response(ssePayload, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
        },
      });
    }) as unknown as typeof fetch;

    const req = new Request(
      "http://localhost:7766/v1beta/models/gemini-2.5-pro:streamGenerateContent?alt=sse",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer lr-gg-gg-gc-no",
        },
        body: JSON.stringify({ contents: [{ parts: [{ text: "Stream" }] }] }),
      }
    );

    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-test-sse");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const bodyText = await res.text();
    expect(bodyText).toBe(ssePayload);
  });

  it("rotates keys and retries in-flight on HTTP 429", async () => {
    const dispatchedKeys: string[] = [];

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const key = headers.get("x-goog-api-key") ?? "unknown";
      dispatchedKeys.push(key);

      if (dispatchedKeys.length === 1) {
        return new Response(JSON.stringify({ error: { code: 429, message: "Rate limit exceeded" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Recovered" }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-test-429-rotate");
    expect(res.status).toBe(200);
    expect(dispatchedKeys.length).toBe(2);
    expect(dispatchedKeys[0]).not.toBe(dispatchedKeys[1]);

    const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    expect(data.candidates?.[0]?.content?.parts?.[0]?.text).toBe("Recovered");
  });

  it("rotates keys and retries in-flight on HTTP 503", async () => {
    const dispatchedKeys: string[] = [];

    globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const key = headers.get("x-goog-api-key") ?? "unknown";
      dispatchedKeys.push(key);

      if (dispatchedKeys.length === 1) {
        return new Response(JSON.stringify({ error: { code: 503, message: "Backend overloaded" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Recovered 503" }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-test-503-rotate");
    expect(res.status).toBe(200);
    expect(dispatchedKeys.length).toBe(2);
    expect(dispatchedKeys[0]).not.toBe(dispatchedKeys[1]);
  });

  it("retries on fetch network errors and succeeds if next key works", async () => {
    let callCount = 0;

    globalThis.fetch = (async () => {
      callCount++;
      if (callCount === 1) {
        throw new Error("TCP RST connection dropped");
      }
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "Network retry success" }] } }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-test-net-err");
    expect(res.status).toBe(200);
    expect(callCount).toBe(2);
  });

  it("returns last upstream error after 3 attempts exhausted", async () => {
    let callCount = 0;

    globalThis.fetch = (async () => {
      callCount++;
      return new Response(JSON.stringify({ error: { code: 429, message: "Resource exhausted" } }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-test-exhausted");
    expect(res.status).toBe(429);
    expect(callCount).toBe(3);
  });

  it("returns HTTP 502 if all 3 attempts fail with network errors", async () => {
    let callCount = 0;

    globalThis.fetch = (async () => {
      callCount++;
      throw new Error("Network timeout");
    }) as unknown as typeof fetch;

    const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-test-all-net-err");
    expect(res.status).toBe(502);
    expect(callCount).toBe(3);
  });

  it("fails fast and loud on HTTP 401 with zero retries", async () => {
    let callCount = 0;

    globalThis.fetch = (async () => {
      callCount++;
      return new Response(JSON.stringify({ error: { code: 401, message: "API key not valid" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-test-401-failfast");
    expect(res.status).toBe(401);
    expect(callCount).toBe(1); // ZERO retries!
  });

  it("fails fast and loud on HTTP 403 with zero retries", async () => {
    let callCount = 0;

    globalThis.fetch = (async () => {
      callCount++;
      return new Response(JSON.stringify({ error: { code: 403, message: "Permission denied" } }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [] }),
    });

    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-test-403-failfast");
    expect(res.status).toBe(403);
    expect(callCount).toBe(1); // ZERO retries!
  });
});
