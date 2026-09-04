import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetEnvCache } from "../../src/config/env";
import { globalKeyPool } from "../../src/handlers/openai_compat";
import { handleAppRequest, resetAllState } from "../../src/lib";

interface FetchCallRecord {
  readonly url: string;
  readonly authHeader: string | null;
  readonly googKeyHeader: string | null;
}

interface MockSuccessPayload {
  readonly id: string;
  readonly object: string;
  readonly created: number;
  readonly model: string;
  readonly choices: readonly {
    readonly index: number;
    readonly message: { readonly role: string; readonly content: string };
    readonly finish_reason: string;
  }[];
  readonly usage: {
    readonly prompt_tokens: number;
    readonly completion_tokens: number;
    readonly total_tokens: number;
  };
}

interface MockErrorPayload {
  readonly error: {
    readonly message: string;
    readonly code?: string | number;
    readonly type?: string;
  };
}

function createGcpRequest(model = "gemma-2-27b-it"): Request {
  return new Request("http://localhost:7766/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer lr-gc-oa-ch-no",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Hello Gemma" }],
      stream: false,
    }),
  });
}

function createNvRequest(): Request {
  return new Request("http://localhost:7766/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: "Bearer lr-nv-oa-ch-no",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "nvidia/llama-3.1-nemotron-70b-instruct",
      messages: [{ role: "user", content: "Hello NV" }],
      stream: false,
    }),
  });
}

function createMockSuccessResponse(message: string): Response {
  const payload: MockSuccessPayload = {
    id: "chatcmpl-test-success",
    object: "chat.completion",
    created: Date.now(),
    model: "gemma-2-27b-it",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: message },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function createMockErrorResponse(status: number, message: string, code?: string): Response {
  const payload: MockErrorPayload = {
    error: {
      message,
      code,
    },
  };
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("GCP Retry Toggle & Resilience Handler (GCP_ENABLE_RETRIES & GCP_ENABLE_QUARANTINE)", () => {
  const originalFetch = globalThis.fetch;
  const originalGcpRetries = process.env.GCP_ENABLE_RETRIES;
  const originalGcpQuarantine = process.env.GCP_ENABLE_QUARANTINE;
  const originalGcpKeys = process.env.GCP_KEYS;
  const originalNvKeys = process.env.NVIDIA_API_KEYS;
  const originalPacer = process.env.LITEROUTER_PACER_ENABLED;

  beforeEach(() => {
    process.env.LITEROUTER_PACER_ENABLED = "false";
    resetEnvCache();
    resetAllState();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalGcpRetries !== undefined) {
      process.env.GCP_ENABLE_RETRIES = originalGcpRetries;
    } else {
      delete process.env.GCP_ENABLE_RETRIES;
    }
    if (originalGcpQuarantine !== undefined) {
      process.env.GCP_ENABLE_QUARANTINE = originalGcpQuarantine;
    } else {
      delete process.env.GCP_ENABLE_QUARANTINE;
    }
    if (originalGcpKeys !== undefined) {
      process.env.GCP_KEYS = originalGcpKeys;
    } else {
      delete process.env.GCP_KEYS;
    }
    if (originalNvKeys !== undefined) {
      process.env.NVIDIA_API_KEYS = originalNvKeys;
    } else {
      delete process.env.NVIDIA_API_KEYS;
    }
    if (originalPacer !== undefined) {
      process.env.LITEROUTER_PACER_ENABLED = originalPacer;
    } else {
      delete process.env.LITEROUTER_PACER_ENABLED;
    }
    resetEnvCache();
    resetAllState();
  });

  it("1. Default behavior (GCP_ENABLE_RETRIES unset/true): retries and rotates to next key on 429", async () => {
    delete process.env.GCP_ENABLE_RETRIES;
    process.env.GCP_KEYS = "mock-gcp-key-1,mock-gcp-key-2";
    resetEnvCache();
    resetAllState();

    const fetchCalls: FetchCallRecord[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization");
      const googKeyHeader = headers.get("x-goog-api-key");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, authHeader, googKeyHeader });

      if (authHeader?.includes("mock-gcp-key-1")) {
        return createMockErrorResponse(429, "Resource has been exhausted (rate limit key 1)");
      }
      if (authHeader?.includes("mock-gcp-key-2")) {
        return createMockSuccessResponse("Rotated to Key 2 successfully");
      }
      return new Response("Unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    const res = await handleAppRequest(createGcpRequest());
    expect(res.status).toBe(200);

    const data = (await res.json()) as MockSuccessPayload;
    expect(data.choices[0]?.message.content).toBe("Rotated to Key 2 successfully");
    expect(fetchCalls.length).toBe(2);
    expect(fetchCalls[0]?.authHeader).toContain("mock-gcp-key-1");
    expect(fetchCalls[1]?.authHeader).toContain("mock-gcp-key-2");
  });

  it("2. Single-flight behavior (GCP_ENABLE_RETRIES=false): terminates on attempt 1 and passes 429 verbatim", async () => {
    process.env.GCP_ENABLE_RETRIES = "false";
    process.env.GCP_KEYS = "mock-gcp-key-1,mock-gcp-key-2";
    resetEnvCache();
    resetAllState();

    const fetchCalls: FetchCallRecord[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization");
      const googKeyHeader = headers.get("x-goog-api-key");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, authHeader, googKeyHeader });

      if (authHeader?.includes("mock-gcp-key-1")) {
        return createMockErrorResponse(429, "Resource has been exhausted (rate limit key 1)");
      }
      if (authHeader?.includes("mock-gcp-key-2")) {
        return createMockSuccessResponse("Should not be called");
      }
      return new Response("Unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    const res = await handleAppRequest(createGcpRequest());
    expect(res.status).toBe(429);

    const data = (await res.json()) as MockErrorPayload;
    expect(data.error.message).toContain("Resource has been exhausted (rate limit key 1)");
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0]?.authHeader).toContain("mock-gcp-key-1");
  });

  it("3. Key quarantine preservation: records failure for key 0 so subsequent request picks key 1", async () => {
    process.env.GCP_ENABLE_RETRIES = "false";
    process.env.GCP_ENABLE_QUARANTINE = "true";
    process.env.GCP_KEYS = "mock-gcp-key-1,mock-gcp-key-2";
    resetEnvCache();
    resetAllState();

    const fetchCalls: FetchCallRecord[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization");
      const googKeyHeader = headers.get("x-goog-api-key");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, authHeader, googKeyHeader });

      if (authHeader?.includes("mock-gcp-key-1")) {
        return createMockErrorResponse(429, "Quota exhausted on key 1");
      }
      if (authHeader?.includes("mock-gcp-key-2")) {
        return createMockSuccessResponse("Success from Key 2 on second flight");
      }
      return new Response("Unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    const res1 = await handleAppRequest(createGcpRequest());
    expect(res1.status).toBe(429);
    expect(fetchCalls.length).toBe(1);
    expect(fetchCalls[0]?.authHeader).toContain("mock-gcp-key-1");

    // Key 0 must be in quarantine in globalKeyPool
    const status = globalKeyPool.getStatus("gc");
    expect(status.quarantined).toBe(1);
    expect(status.active).toBe(1);
    expect(globalKeyPool.getCooldownManager().isQuarantined("gc:0", Date.now())).toBe(true);

    const res2 = await handleAppRequest(createGcpRequest());
    expect(res2.status).toBe(200);

    const data2 = (await res2.json()) as MockSuccessPayload;
    expect(data2.choices[0]?.message.content).toBe("Success from Key 2 on second flight");
    expect(fetchCalls.length).toBe(2);
    expect(fetchCalls[1]?.authHeader).toContain("mock-gcp-key-2");
  });

  it("4. Transport fail-safe (NoResponseError -> 502): synthesizes HTTP 502 with JSON error structure", async () => {
    process.env.GCP_ENABLE_RETRIES = "false";
    process.env.GCP_KEYS = "mock-gcp-key-1,mock-gcp-key-2";
    resetEnvCache();
    resetAllState();

    globalThis.fetch = (async () => {
      throw new Error("ECONNRESET socket hang up");
    }) as unknown as typeof fetch;

    const res = await handleAppRequest(createGcpRequest());
    expect(res.status).toBe(502);

    const data = (await res.json()) as MockErrorPayload;
    expect(data.error.code).toBe(502);
    expect(data.error.type).toBe("upstream_connection_error");
    expect(data.error.message).toContain("GCP upstream connection failed");
    expect(data.error.message).toContain("ECONNRESET socket hang up");
  });

  it("5. Context length overflow pass-through (400): returns 400 immediately without auto-pruning", async () => {
    process.env.GCP_ENABLE_RETRIES = "false";
    process.env.GCP_KEYS = "mock-gcp-key-1,mock-gcp-key-2";
    resetEnvCache();
    resetAllState();

    const fetchCalls: FetchCallRecord[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization");
      const googKeyHeader = headers.get("x-goog-api-key");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, authHeader, googKeyHeader });

      return createMockErrorResponse(
        400,
        "This model's maximum context length is 8192 tokens. However, you requested 10000 tokens.",
        "context_length_exceeded"
      );
    }) as unknown as typeof fetch;

    const res = await handleAppRequest(createGcpRequest());
    expect(res.status).toBe(400);

    const data = (await res.json()) as MockErrorPayload;
    expect(data.error.code).toBe("context_length_exceeded");
    expect(data.error.message).toContain("maximum context length is 8192 tokens");
    expect(fetchCalls.length).toBe(1);
  });

  it("6. Non-GCP isolation: non-GCP routes (e.g. nv) still retry on 429 even when GCP_ENABLE_RETRIES=false", async () => {
    process.env.GCP_ENABLE_RETRIES = "false";
    process.env.NVIDIA_API_KEYS = "nvapi-mock-key-1,nvapi-mock-key-2";
    resetEnvCache();
    resetAllState();

    const fetchCalls: FetchCallRecord[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      const authHeader = headers.get("Authorization");
      const googKeyHeader = headers.get("x-goog-api-key");
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      fetchCalls.push({ url, authHeader, googKeyHeader });

      if (authHeader?.includes("nvapi-mock-key-1")) {
        return createMockErrorResponse(429, "NV rate limit exceeded on key 1");
      }
      if (authHeader?.includes("nvapi-mock-key-2")) {
        return createMockSuccessResponse("NV Key 2 Rotated Success");
      }
      return new Response("Unauthorized", { status: 401 });
    }) as unknown as typeof fetch;

    const res = await handleAppRequest(createNvRequest());
    expect(res.status).toBe(200);

    const data = (await res.json()) as MockSuccessPayload;
    expect(data.choices[0]?.message.content).toBe("NV Key 2 Rotated Success");
    expect(fetchCalls.length).toBe(2);
    expect(fetchCalls[0]?.authHeader).toContain("nvapi-mock-key-1");
    expect(fetchCalls[1]?.authHeader).toContain("nvapi-mock-key-2");
  });

  it("7. Dumb forwarder mode (GCP_ENABLE_QUARANTINE=false): fails key on 429 without placing key into quarantine", async () => {
    process.env.GCP_ENABLE_QUARANTINE = "false";
    process.env.GCP_KEYS = "mock-gcp-key-1,mock-gcp-key-2";
    resetEnvCache();
    resetAllState();

    globalThis.fetch = (async () => {
      return createMockErrorResponse(429, "Rate limit reached on key 1");
    }) as unknown as typeof fetch;

    const res = await handleAppRequest(createGcpRequest());
    expect(res.status).toBe(429);

    // CRITICAL: Neither key must be in quarantine
    const status = globalKeyPool.getStatus("gc");
    expect(status.total).toBe(2);
    expect(status.quarantined).toBe(0);
    expect(status.active).toBe(2);
  });

  it("8. Combined dumb forwarder (GCP_ENABLE_RETRIES=false + GCP_ENABLE_QUARANTINE=false): transparent pass-through without lockout", async () => {
    process.env.GCP_ENABLE_RETRIES = "false";
    process.env.GCP_ENABLE_QUARANTINE = "false";
    process.env.GCP_KEYS = "mock-single-gcp-key";
    resetEnvCache();
    resetAllState();

    let attempts = 0;
    globalThis.fetch = (async () => {
      attempts += 1;
      if (attempts === 1) {
        return createMockErrorResponse(429, "Temporary 1-second burst rate limit");
      }
      return createMockSuccessResponse("Immediate recovery without 503 load shedding");
    }) as unknown as typeof fetch;

    // Request 1: single flight, passes 429 directly downstream
    const res1 = await handleAppRequest(createGcpRequest());
    expect(res1.status).toBe(429);
    expect(attempts).toBe(1);

    // Key must NOT be quarantined
    const status = globalKeyPool.getStatus("gc");
    expect(status.total).toBe(1);
    expect(status.quarantined).toBe(0);
    expect(status.active).toBe(1);

    // Request 2: should immediately re-use the key rather than shedding load with 503
    const res2 = await handleAppRequest(createGcpRequest());
    expect(res2.status).toBe(200);
    expect(attempts).toBe(2);
    const data2 = (await res2.json()) as MockSuccessPayload;
    expect(data2.choices[0]?.message.content).toBe("Immediate recovery without 503 load shedding");
  });

  it("9. KeyPool provider isolation: GCP_ENABLE_QUARANTINE=false only disables quarantine for gc, not other providers", async () => {
    process.env.GCP_ENABLE_QUARANTINE = "false";
    resetEnvCache();
    resetAllState();

    globalKeyPool.setPool("gc", ["mock-gc-key"]);
    globalKeyPool.setPool("nv", ["mock-nv-key"]);

    // Report failure for GCP
    globalKeyPool.reportFailure("gc", 0, 429);
    const gcStatus = globalKeyPool.getStatus("gc");
    expect(gcStatus.quarantined).toBe(0);
    expect(gcStatus.active).toBe(1);

    // Report failure for NV
    globalKeyPool.reportFailure("nv", 0, 429);
    const nvStatus = globalKeyPool.getStatus("nv");
    expect(nvStatus.quarantined).toBe(1);
    expect(nvStatus.active).toBe(0);
  });

  it("10. Circuit breaker isolation (GCP_ENABLE_CIRCUIT_BREAKER=false): 5 consecutive 503s do not trip breaker or block subsequent requests", async () => {
    process.env.GCP_ENABLE_RETRIES = "false";
    process.env.GCP_ENABLE_QUARANTINE = "false";
    process.env.GCP_ENABLE_CIRCUIT_BREAKER = "false";
    process.env.GCP_KEYS = "mock-gcp-key";
    resetEnvCache();
    resetAllState();

    let calls = 0;
    globalThis.fetch = (async () => {
      calls += 1;
      if (calls <= 5) {
        return createMockErrorResponse(503, "High demand spike");
      }
      return createMockSuccessResponse("GCP recovered on call 6");
    }) as unknown as typeof fetch;

    // Send 5 requests that fail with 503
    for (let i = 0; i < 5; i++) {
      const res = await handleAppRequest(createGcpRequest());
      expect(res.status).toBe(503);
    }
    expect(calls).toBe(5);

    // Call 6: breaker must NOT be open, request must reach upstream and succeed
    const res6 = await handleAppRequest(createGcpRequest());
    expect(res6.status).toBe(200);
    expect(calls).toBe(6);
    const data6 = (await res6.json()) as MockSuccessPayload;
    expect(data6.choices[0]?.message.content).toBe("GCP recovered on call 6");
  });
});
