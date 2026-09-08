import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetAllState } from "../../src/lib";
import {
  getCurrentFlashTierIndex,
  handleGoogleNative,
  loadAndCacheNativeChains,
  resetNativeFlashTierIndex,
} from "../../src/handlers/google_native";

interface MockFetchCall {
  readonly url: string;
  readonly method?: string;
  readonly headers: Headers;
  readonly key?: string;
  readonly modelInUrl?: string;
}

function getModelFromUrl(urlStr: string): string | undefined {
  const match = urlStr.match(/\/v1beta\/models\/([^:]+)/);
  return match?.[1];
}

function makeGoogleRequest(
  path = "/v1beta/models/gemini-flash:generateContent",
  body: Record<string, unknown> = { contents: [{ parts: [{ text: "Hello" }] }] },
  headers: Record<string, string> = {}
): Request {
  return new Request(`http://localhost:7766${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer lr-gg-gg-gc-no",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function createSuccessCandidateResponse(text = "ok", modelName = "gemini-3.7-flash"): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text }] },
          finishReason: "STOP",
        },
      ],
      modelVersion: modelName,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
}

function createErrorResponse(status: number, message: string, code = status): Response {
  return new Response(
    JSON.stringify({
      error: {
        code,
        message,
        status: status === 404 ? "NOT_FOUND" : status === 429 ? "RESOURCE_EXHAUSTED" : "ERROR",
      },
    }),
    {
      status,
      headers: { "Content-Type": "application/json" },
    }
  );
}

describe("Google Native gemini-flash Fusion Unit Tests", () => {
  const originalFetch = globalThis.fetch;
  const originalEnvGoogle = process.env.GOOGLE_API_KEYS;
  const mockKeys = [
    "AIzaSyMockKey1-flash-test",
    "AIzaSyMockKey2-flash-test",
    "AIzaSyMockKey3-flash-test",
  ];

  beforeEach(() => {
    process.env.GOOGLE_API_KEYS = mockKeys.join(",");
    resetAllState();
    resetNativeFlashTierIndex();
    loadAndCacheNativeChains();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnvGoogle !== undefined) {
      process.env.GOOGLE_API_KEYS = originalEnvGoogle;
    } else {
      delete process.env.GOOGLE_API_KEYS;
    }
    resetAllState();
    resetNativeFlashTierIndex();
  });

  // 1. Tier 1 returns 404 -> Fast-advances to Tier 2 (only 1 fetch against Tier 1, zero extra keys burned; asserts downstream headers x-literouter-model: gemini-3.7-flash, x-literouter-tier: 2)
  it("fast-advances to Tier 2 on 404 with 0 extra keys burned and sets downstream headers", async () => {
    const fetchCalls: MockFetchCall[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      const headers = new Headers(init?.headers);
      const key = headers.get("x-goog-api-key") ?? undefined;
      const modelInUrl = getModelFromUrl(url);
      fetchCalls.push({ url, method: init?.method, headers, key, modelInUrl });

      if (modelInUrl === "gemini-3.8-flash") {
        return createErrorResponse(404, "models/gemini-3.8-flash is not found");
      }
      if (modelInUrl === "gemini-3.7-flash") {
        return createSuccessCandidateResponse("Tier 2 response", "gemini-3.7-flash");
      }
      return createErrorResponse(500, "Unexpected model requested");
    }) as unknown as typeof fetch;

    const req = makeGoogleRequest("/v1beta/models/gemini-flash:generateContent");
    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-fusion-404-advance");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-literouter-model")).toBe("gemini-3.7-flash");
    expect(res.headers.get("x-literouter-tier")).toBe("2");

    const calls38 = fetchCalls.filter((c) => c.modelInUrl === "gemini-3.8-flash");
    const calls37 = fetchCalls.filter((c) => c.modelInUrl === "gemini-3.7-flash");

    expect(calls38.length).toBe(1);
    expect(calls37.length).toBe(1);
    expect(fetchCalls.length).toBe(2);
  });

  // 2. Subsequent request after 404 advance -> Starts directly at Tier 2 (persistent pointer)
  it("starts directly at Tier 2 on subsequent requests after a 404 advance (persistent pointer)", async () => {
    const fetchCalls: MockFetchCall[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      const headers = new Headers(init?.headers);
      const key = headers.get("x-goog-api-key") ?? undefined;
      const modelInUrl = getModelFromUrl(url);
      fetchCalls.push({ url, method: init?.method, headers, key, modelInUrl });

      if (modelInUrl === "gemini-3.8-flash") {
        return createErrorResponse(404, "models/gemini-3.8-flash not found");
      }
      if (modelInUrl === "gemini-3.7-flash") {
        return createSuccessCandidateResponse("Tier 2 response", "gemini-3.7-flash");
      }
      return createErrorResponse(500, "Unexpected model");
    }) as unknown as typeof fetch;

    // First request advances pointer from Tier 1 (3.8) to Tier 2 (3.7)
    const req1 = makeGoogleRequest("/v1beta/models/gemini-flash:generateContent");
    const res1 = await handleGoogleNative(req1, "lr-gg-gg-gc-no", "req-first-call");
    expect(res1.status).toBe(200);
    expect(getCurrentFlashTierIndex()).toBe(1);

    fetchCalls.length = 0; // Clear history

    // Second request should start directly at Tier 2 (3.7) without probing Tier 1 (3.8)
    const req2 = makeGoogleRequest("/v1beta/models/gemini-flash:generateContent");
    const res2 = await handleGoogleNative(req2, "lr-gg-gg-gc-no", "req-second-call");
    expect(res2.status).toBe(200);
    expect(res2.headers.get("x-literouter-model")).toBe("gemini-3.7-flash");
    expect(res2.headers.get("x-literouter-tier")).toBe("2");

    const calls38 = fetchCalls.filter((c) => c.modelInUrl === "gemini-3.8-flash");
    const calls37 = fetchCalls.filter((c) => c.modelInUrl === "gemini-3.7-flash");

    expect(calls38.length).toBe(0);
    expect(calls37.length).toBe(1);
    expect(getCurrentFlashTierIndex()).toBe(1);
  });

  // 3. All keys return 429 on Tier 1 -> Rotates through all keys before advancing to Tier 2
  it("rotates through all keys on Tier 1 before advancing to Tier 2 on 429 rate limit", async () => {
    const fetchCalls: MockFetchCall[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      const headers = new Headers(init?.headers);
      const key = headers.get("x-goog-api-key") ?? undefined;
      const modelInUrl = getModelFromUrl(url);
      fetchCalls.push({ url, method: init?.method, headers, key, modelInUrl });

      if (modelInUrl === "gemini-3.8-flash") {
        return createErrorResponse(429, "Rate limit exceeded");
      }
      if (modelInUrl === "gemini-3.7-flash") {
        return createSuccessCandidateResponse("Tier 2 after 429", "gemini-3.7-flash");
      }
      return createErrorResponse(500, "Unexpected model");
    }) as unknown as typeof fetch;

    const req = makeGoogleRequest("/v1beta/models/gemini-flash:generateContent");
    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-429-rotate");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-literouter-model")).toBe("gemini-3.7-flash");
    expect(res.headers.get("x-literouter-tier")).toBe("2");

    const calls38 = fetchCalls.filter((c) => c.modelInUrl === "gemini-3.8-flash");
    expect(calls38.length).toBeGreaterThanOrEqual(mockKeys.length);

    const keysUsedOn38 = new Set(calls38.map((c) => c.key));
    for (const k of mockKeys) {
      expect(keysUsedOn38.has(k)).toBe(true);
    }
  });

  // 4. All 4 tiers fail (global outage) -> Halts at 1 cycle, returns HTTP 503 Service Unavailable with error.type: "service_unavailable"
  it("halts at 1 cycle and returns HTTP 503 Service Unavailable when all 4 tiers fail", async () => {
    const fetchCalls: MockFetchCall[] = [];

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      const headers = new Headers(init?.headers);
      const key = headers.get("x-goog-api-key") ?? undefined;
      const modelInUrl = getModelFromUrl(url);
      fetchCalls.push({ url, method: init?.method, headers, key, modelInUrl });

      return createErrorResponse(404, `Model ${modelInUrl ?? "unknown"} not found`);
    }) as unknown as typeof fetch;

    const req = makeGoogleRequest("/v1beta/models/gemini-flash:generateContent");
    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-global-outage");

    expect(res.status).toBe(503);

    const body = (await res.json()) as { error?: { message?: string; type?: string } };
    expect(body.error?.type).toBe("service_unavailable");
    expect(body.error?.message).toContain("exhausted");

    // Exactly 4 calls made (1 per tier on 404 fast-advance, 1 cycle limit)
    expect(fetchCalls.length).toBe(4);
    const modelsCalled = fetchCalls.map((c) => c.modelInUrl);
    expect(modelsCalled).toEqual([
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash",
    ]);
  });

  // 5. Tier 1 = 404, Tier 2 = 200 -> Response is 200 with x-literouter-model: gemini-3.7-flash
  it("delivers successful 200 response with x-literouter-model: gemini-3.7-flash when Tier 1 is 404 and Tier 2 is 200", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input.toString();
      const modelInUrl = getModelFromUrl(url);

      if (modelInUrl === "gemini-3.8-flash") {
        return createErrorResponse(404, "models/gemini-3.8-flash not found");
      }
      if (modelInUrl === "gemini-3.7-flash") {
        return createSuccessCandidateResponse("Success candidate content", "gemini-3.7-flash");
      }
      return createErrorResponse(500, "Unexpected model");
    }) as unknown as typeof fetch;

    const req = makeGoogleRequest("/v1beta/models/gemini-flash:generateContent");
    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-tier1-404-tier2-200");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-literouter-model")).toBe("gemini-3.7-flash");
    expect(res.headers.get("x-literouter-tier")).toBe("2");

    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    expect(data.candidates?.[0]?.content?.parts?.[0]?.text).toBe("Success candidate content");
  });

  // 6. Non-fusion model (gemini-2.5-flash) -> Bypasses fusion entirely, behaves as dumb forwarder (no x-literouter-* headers)
  it("bypasses fusion entirely for non-fusion models and acts as dumb forwarder without x-literouter-* headers", async () => {
    let capturedUrl = "";

    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = input.toString();
      return createSuccessCandidateResponse("Dumb forwarder ok", "gemini-2.5-flash");
    }) as unknown as typeof fetch;

    const req = makeGoogleRequest("/v1beta/models/gemini-2.5-flash:generateContent");
    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-non-fusion");

    expect(res.status).toBe(200);
    expect(capturedUrl).toContain("/v1beta/models/gemini-2.5-flash:generateContent");
    expect(res.headers.get("x-literouter-model")).toBeNull();
    expect(res.headers.get("x-literouter-tier")).toBeNull();
    expect(getCurrentFlashTierIndex()).toBe(0);
  });

  // 7. Client error (400/401/403) on Tier 1 -> Passes through as-is, does NOT cascade
  it("passes client errors (400/401/403) through as-is without cascading to subsequent tiers", async () => {
    let fetchCount = 0;

    globalThis.fetch = (async () => {
      fetchCount++;
      return createErrorResponse(400, "Invalid argument: contents field required");
    }) as unknown as typeof fetch;

    const req = makeGoogleRequest("/v1beta/models/gemini-flash:generateContent");
    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-client-400");

    expect(res.status).toBe(400);
    expect(fetchCount).toBe(1);
    expect(getCurrentFlashTierIndex()).toBe(0);

    const data = (await res.json()) as { error?: { message?: string } };
    expect(data.error?.message).toContain("Invalid argument");
  });

  // 8. Hard reset -> resetNativeFlashTierIndex() resets tier pointer to 0
  it("resets tier pointer to 0 when resetNativeFlashTierIndex() is invoked", async () => {
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = input.toString();
      const modelInUrl = getModelFromUrl(url);

      if (modelInUrl === "gemini-3.8-flash" || modelInUrl === "gemini-3.7-flash") {
        return createErrorResponse(404, "Not found");
      }
      if (modelInUrl === "gemini-3.6-flash") {
        return createSuccessCandidateResponse("Tier 3 ok", "gemini-3.6-flash");
      }
      return createErrorResponse(500, "Unexpected model");
    }) as unknown as typeof fetch;

    const req = makeGoogleRequest("/v1beta/models/gemini-flash:generateContent");
    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-advance-to-tier3");

    expect(res.status).toBe(200);
    expect(res.headers.get("x-literouter-model")).toBe("gemini-3.6-flash");
    expect(getCurrentFlashTierIndex()).toBe(2);

    // Hard reset
    resetNativeFlashTierIndex();
    expect(getCurrentFlashTierIndex()).toBe(0);
  });

  // 9. google/gemini-flash prefix -> Strips prefix, triggers fusion correctly
  it("strips google/ prefix and triggers fusion with correctly rewritten upstream URL", async () => {
    let capturedUrl = "";

    globalThis.fetch = (async (input: string | URL | Request) => {
      capturedUrl = input.toString();
      return createSuccessCandidateResponse("Prefix stripped ok", "gemini-3.8-flash");
    }) as unknown as typeof fetch;

    const req = makeGoogleRequest("/v1beta/models/google/gemini-flash:generateContent");
    const res = await handleGoogleNative(req, "lr-gg-gg-gc-no", "req-prefix-strip");

    expect(res.status).toBe(200);
    expect(capturedUrl).toContain("/v1beta/models/gemini-3.8-flash:generateContent");
    expect(capturedUrl).not.toContain("google/");
    expect(res.headers.get("x-literouter-model")).toBe("gemini-3.8-flash");
    expect(res.headers.get("x-literouter-tier")).toBe("1");
  });

  // 10. Concurrency pinning -> Two requests pin startTier locally, computing (startTier + cycleStep) % totalTiers without skipping tiers
  it("pins startTier locally across concurrent requests without skipping tiers", async () => {
    const callsPerReq: Record<string, string[]> = {};

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString();
      const modelInUrl = getModelFromUrl(url) ?? "unknown";
      const headers = new Headers(init?.headers);
      const reqTag = headers.get("x-client-req-id") ?? "default";

      if (!callsPerReq[reqTag]) {
        callsPerReq[reqTag] = [];
      }
      callsPerReq[reqTag].push(modelInUrl);

      if (modelInUrl === "gemini-3.8-flash") {
        return createErrorResponse(404, "3.8 unreleased");
      }
      if (modelInUrl === "gemini-3.7-flash") {
        return createSuccessCandidateResponse("Concurrent Tier 2 ok", "gemini-3.7-flash");
      }
      return createErrorResponse(500, "Unexpected model");
    }) as unknown as typeof fetch;

    const reqA = makeGoogleRequest(
      "/v1beta/models/gemini-flash:generateContent",
      { contents: [{ parts: [{ text: "Request A" }] }] },
      { "x-client-req-id": "req-concurrent-A" }
    );
    const reqB = makeGoogleRequest(
      "/v1beta/models/gemini-flash:generateContent",
      { contents: [{ parts: [{ text: "Request B" }] }] },
      { "x-client-req-id": "req-concurrent-B" }
    );

    const [resA, resB] = await Promise.all([
      handleGoogleNative(reqA, "lr-gg-gg-gc-no", "req-concurrent-A"),
      handleGoogleNative(reqB, "lr-gg-gg-gc-no", "req-concurrent-B"),
    ]);

    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(resA.headers.get("x-literouter-model")).toBe("gemini-3.7-flash");
    expect(resB.headers.get("x-literouter-model")).toBe("gemini-3.7-flash");
    expect(resA.headers.get("x-literouter-tier")).toBe("2");
    expect(resB.headers.get("x-literouter-tier")).toBe("2");

    // Both requests evaluated Tier 1 (3.8) then Tier 2 (3.7)
    expect(callsPerReq["req-concurrent-A"]).toEqual(["gemini-3.8-flash", "gemini-3.7-flash"]);
    expect(callsPerReq["req-concurrent-B"]).toEqual(["gemini-3.8-flash", "gemini-3.7-flash"]);
  });
});
