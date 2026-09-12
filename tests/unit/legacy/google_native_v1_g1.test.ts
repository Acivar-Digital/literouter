import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetAllState } from "../../../src/lib";
import { parseDirective } from "../../../src/directive/parser";
import { resolveUpstreamEndpoint } from "../../../src/handlers/openai_compat";
import { handleGoogleNative } from "../../../src/handlers/google_native";
import { dispatchRoute } from "../../../src/index";

describe("Google Native v1 & g1 Directive Unit Tests", () => {
  const originalFetch = globalThis.fetch;
  const originalEnvGoogle = process.env.GOOGLE_API_KEYS;
  const mockKeys = ["AIzaSyMockKey1-test-stub", "AIzaSyMockKey2-test-stub"];

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

  it("parses lr-gg-gg-g1-no directive successfully", () => {
    const directive = parseDirective("lr-gg-gg-g1-no");
    expect(directive).not.toBeNull();
    expect(directive?.type).toBe("direct");
    if (directive?.type === "direct") {
      expect(directive.provider).toBe("gg");
      expect(directive.payload).toBe("gg");
      expect(directive.completion).toBe("g1");
      expect(directive.nuances).toEqual(["no"]);
    }
  });

  it("resolves upstream endpoint for g1 completion code in config/providers.json", () => {
    const endpoint = resolveUpstreamEndpoint("gg", "g1", "gemini-3.5-flash-lite");
    expect(endpoint.url).toBe(
      "https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash-lite:generateContent"
    );
    expect(endpoint.rawPath).toBe("/v1/models/gemini-3.5-flash-lite:generateContent");
  });

  it("forwards /v1/models/* requests to upstream /v1/ with lr-gg-gg-g1-no", async () => {
    let capturedUrl = "";
    let capturedHeaders: Headers | undefined;

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      capturedHeaders = new Headers(init?.headers);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "v1 response" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const req = new Request(
      "http://localhost:7766/v1/models/gemini-3.5-flash-lite:generateContent?key=lr-gg-gg-g1-no",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
      }
    );

    const res = await dispatchRoute(req, "lr-gg-gg-g1-no", "req-v1-test");
    expect(res.status).toBe(200);
    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash-lite:generateContent"
    );
    expect(capturedHeaders?.get("x-goog-api-key")).toBe(mockKeys[0]);
  });

  it("preserves /v1beta/models/* upstream for lr-gg-gg-gc-no", async () => {
    let capturedUrl = "";

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      capturedUrl = typeof input === "string" ? input : input.toString();
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "v1beta response" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const req = new Request(
      "http://localhost:7766/v1beta/models/gemini-3.1-flash-lite:generateContent?key=lr-gg-gg-gc-no",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }),
      }
    );

    const res = await dispatchRoute(req, "lr-gg-gg-gc-no", "req-v1beta-test");
    expect(res.status).toBe(200);
    expect(capturedUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent"
    );
  });

  it("preserves /v1/ prefix across native fusion cascading", async () => {
    const fetchCalls: string[] = [];

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const urlStr = typeof input === "string" ? input : input.toString();
      fetchCalls.push(urlStr);

      // Simulate 404 for tier 1 (gemini-3.5-flash-lite) to trigger cascade to tier 2 (gemini-3.1-flash-lite)
      if (urlStr.includes("gemini-3.5-flash-lite")) {
        return new Response(
          JSON.stringify({ error: { code: 404, message: "Model not found" } }),
          { status: 404, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "cascaded tier 2 response" }] } }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as typeof fetch;

    const req = new Request(
      "http://localhost:7766/v1/models/gemini-flash-lite:generateContent?key=lr-gg-gg-g1-no",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: "ping" }] }] }),
      }
    );

    const res = await dispatchRoute(req, "lr-gg-gg-g1-no", "req-cascade-v1-test");
    expect(res.status).toBe(200);
    expect(res.headers.get("x-literouter-model")).toBe("gemini-3.1-flash-lite");
    expect(res.headers.get("x-literouter-tier")).toBe("2");

    // Verify both attempts preserved /v1/ instead of reverting to /v1beta/
    expect(fetchCalls.length).toBe(2);
    expect(fetchCalls[0]).toBe(
      "https://generativelanguage.googleapis.com/v1/models/gemini-3.5-flash-lite:generateContent"
    );
    expect(fetchCalls[1]).toBe(
      "https://generativelanguage.googleapis.com/v1/models/gemini-3.1-flash-lite:generateContent"
    );
  });

  it("continues serving GET /v1/models as discovery without interception", async () => {
    const req = new Request("http://localhost:7766/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer lr-or-oa-ch-no" },
    });

    const res = await dispatchRoute(req, "lr-or-oa-ch-no", "req-disc-test");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { object?: string; data?: unknown[] };
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
  });
});
