import { describe, expect, it, beforeEach, afterAll, mock, spyOn } from "bun:test";

mock.module("../../../src/engine/pacer_adapter", () => ({
  acquirePacer: async () => {},
  calculatePacerIntervalMs: () => 0,
}));

import { initProviderRegistry } from "../../../src/config/providers";
import type { ParsedDirective } from "../../../src/directive/types";
import { getCircuitBreaker, resetCircuitBreakers } from "../../../src/engine/circuit_breaker";
import {
  executeDispatchPipeline,
  mergeOutboundHeaders,
  type DispatchRequest,
  type OutboundWirePayload,
  type PayloadTransformerContract,
} from "../../../src/engine/dispatch";
import {
  initStrategyRegistry,
  registerStrategyFactory,
  resetStrategyRegistry,
} from "../../../src/engine/strategy_registry";
import type { ProviderExecutionStrategy } from "../../../src/engine/strategy";
import { globalKeyPool } from "../../../src/handlers/openai_compat";
import {
  drainInFlight,
  getInFlightCount,
  resetDrainState,
  trackInFlight,
} from "../../../src/lifecycle/shutdown";
import { RequestTelemetry } from "../../../src/telemetry/session";
import { traceWriter } from "../../../src/telemetry/trace_writer";
import { resetAllState } from "../../../src/index";

const mockDirective: ParsedDirective = {
  type: "direct",
  raw: "lr-or-oa-ch-no",
  provider: "or",
  payload: "oa",
  wire: "oa",
  completion: "ch",
  endpoint: "ch",
  nuances: ["no"],
};

const mockTransformer: PayloadTransformerContract = {
  transformClientToWire(body) {
    return {
      endpointKey: "ch",
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      isStreaming: false,
    };
  },
  transformWireToClient(upstreamJson) {
    return { transformed: upstreamJson };
  },
  createWireToClientStream() {
    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
    });
  },
};

function buildRequest(overrides?: Partial<DispatchRequest>): DispatchRequest {
  const outbound: OutboundWirePayload = {
    endpointKey: "ch",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
    isStreaming: false,
  };

  return {
    reqId: "test-req-123",
    method: "POST",
    path: "/v1/chat/completions",
    directive: mockDirective,
    rawInboundBody: { model: "test-model" },
    outboundPayload: outbound,
    clientSignal: new AbortController().signal,
    clientHeaders: new Headers({ "user-agent": "OpenCode/1.0" }),
    transformer: mockTransformer,
    ...overrides,
  };
}

describe("Unified Dispatch Pipeline (Slice 3.5)", () => {
  beforeEach(() => {
    resetCircuitBreakers();
    resetStrategyRegistry();
    resetDrainState();
    initProviderRegistry();
    initStrategyRegistry();
    globalKeyPool.reset();
    globalKeyPool.setPool("or", ["sk-or-test-key-1", "sk-or-test-key-2"]);
  });

  it("returns 503 circuit breaker open rejection without calling fetch", async () => {
    const breaker = getCircuitBreaker("or");
    // Trip breaker with 5 failures
    for (let i = 0; i < 5; i += 1) {
      breaker.recordFailure(500);
    }
    expect(breaker.isOpen()).toBe(true);

    let fetchCalled = false;
    const fetchFn = async () => {
      fetchCalled = true;
      return new Response("OK", { status: 200 });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(503);
    expect(fetchCalled).toBe(false);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("circuit_breaker_open");
  });

  it("short-circuits when strategy preDispatch returns a Response", async () => {
    const customStrategy: ProviderExecutionStrategy = {
      preDispatch: () => {
        return new Response(JSON.stringify({ error: "Forbidden guardrail" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      },
    };
    registerStrategyFactory("standard", () => customStrategy);
    initStrategyRegistry();

    let fetchCalled = false;
    const fetchFn = async () => {
      fetchCalled = true;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(403);
    expect(fetchCalled).toBe(false);
  });

  it("merges mandatory provider attribution headers onto outbound request", async () => {
    let capturedHeaders: Headers | Record<string, string> | undefined;

    const fetchFn = async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ id: "ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(200);
    expect(capturedHeaders).toBeDefined();
    const headersRecord = capturedHeaders as Record<string, string>;
    // OpenRouter headers from providers.json include HTTP-Referer and X-Title
    expect(headersRecord["HTTP-Referer"]).toBe("https://opencode.ai");
    expect(headersRecord["X-Title"]).toBe("OpenCode");
    expect(headersRecord.Authorization).toBe("Bearer sk-or-test-key-1");
  });

  it("rotates key and retries on 429 without tripping circuit breaker", async () => {
    const breaker = getCircuitBreaker("or");
    let fetchCount = 0;
    const usedKeys: string[] = [];

    const fetchFn = async (_url: unknown, init?: RequestInit) => {
      fetchCount += 1;
      const headers = init?.headers as Record<string, string>;
      const auth = headers.Authorization;
      if (auth) {
        usedKeys.push(auth);
      }

      if (fetchCount === 1) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "1" },
        });
      }

      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(200);
    expect(fetchCount).toBe(2);
    // Verified 2 different keys were used
    expect(usedKeys[0]).toBe("Bearer sk-or-test-key-1");
    expect(usedKeys[1]).toBe("Bearer sk-or-test-key-2");
    // 429 should NOT trip circuit breaker
    expect(breaker.getFailureCount()).toBe(0);
    expect(breaker.isOpen()).toBe(false);
  });

  it("caps retry-after delay at 15000ms when retrying on 429", async () => {
    let fetchCount = 0;
    const sleepSpy = spyOn(Bun, "sleep").mockImplementation(async () => {});

    const fetchFn = async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "60" },
        });
      }

      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(200);
    expect(fetchCount).toBe(2);
    expect(sleepSpy).toHaveBeenCalledWith(15000);
    sleepSpy.mockRestore();
  });

  it("fails fast immediately on status 400 without retrying", async () => {
    let fetchCount = 0;

    const fetchFn = async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({ error: "Invalid model" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(400);
    expect(fetchCount).toBe(1);
  });

  it("strips content-encoding, content-length, and transfer-encoding on upstream error responses", async () => {
    const fetchFn = async () => {
      return new Response(JSON.stringify({ error: { message: "Gzip error test" } }), {
        status: 400,
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "content-length": "123",
          "transfer-encoding": "chunked",
        },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(400);
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("transfer-encoding")).toBeNull();
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Gzip error test");
  });

  it("does not quarantine key on 429 retry flow", async () => {
    const quarantineSpy = spyOn(globalKeyPool, "quarantineKey");
    let fetchCount = 0;

    const fetchFn = async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({ error: { message: "Rate limit reached" } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "1" },
        });
      }
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(200);
    expect(quarantineSpy).not.toHaveBeenCalled();
    quarantineSpy.mockRestore();
  });

  it("executes transformer and records breaker success on successful non-streaming response", async () => {
    const breaker = getCircuitBreaker("or");
    let recordedSuccess = false;
    const originalRecordSuccess = breaker.recordSuccess.bind(breaker);
    breaker.recordSuccess = () => {
      recordedSuccess = true;
      originalRecordSuccess();
    };

    const fetchFn = async () => {
      return new Response(JSON.stringify({ id: "resp-1", usage: { prompt_tokens: 10, completion_tokens: 20 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(200);
    const json = (await res.json()) as { transformed: { id: string } };
    expect(json.transformed.id).toBe("resp-1");
    expect(recordedSuccess).toBe(true);
  });

  it("handles streaming response and applies mid-stream cutoff with [DONE] on failure", async () => {
    const encoder = new TextEncoder();
    const faultyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"test\":\"chunk1\"}\n\n"));
        // Encounter error mid-stream
        controller.error(new Error("Upstream socket closed abruptly"));
      },
    });

    const fetchFn = async () => {
      return new Response(faultyStream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    };

    const req = buildRequest({
      outboundPayload: {
        endpointKey: "ch",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: { model: "test-model", stream: true },
        isStreaming: true,
      },
    });

    const res = await executeDispatchPipeline(req, fetchFn);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();

    const decoder = new TextDecoder();
    let accumulated = "";

    while (reader) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulated += decoder.decode(value);
    }

    // Must cleanly terminate with [DONE] instead of throwing unhandled error to client
    expect(accumulated).toContain("data: [DONE]\n\n");
  });

  it("returns 429 when all keys in keypool are exhausted/quarantined", async () => {
    // Empty pool
    globalKeyPool.setPool("or", []);

    const fetchFn = async () => new Response("OK", { status: 200 });
    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("keys_exhausted");
  });
});

describe("Graceful Shutdown & Drain (src/lifecycle/shutdown.ts)", () => {
  beforeEach(() => {
    resetDrainState();
  });

  it("tracks in-flight promises and drains correctly", async () => {
    expect(getInFlightCount()).toBe(0);

    let resolveP1!: () => void;
    let resolveP2!: () => void;

    const p1 = new Promise<void>((res) => {
      resolveP1 = res;
    });
    const p2 = new Promise<void>((res) => {
      resolveP2 = res;
    });

    trackInFlight(p1);
    trackInFlight(p2);

    expect(getInFlightCount()).toBe(2);

    let drained = false;
    const drainPromise = drainInFlight(5000).then(() => {
      drained = true;
    });

    expect(drained).toBe(false);

    resolveP1();
    await Promise.resolve(); // tick microtask
    expect(getInFlightCount()).toBe(1);
    expect(drained).toBe(false);

    resolveP2();
    await drainPromise;
    expect(drained).toBe(true);
    expect(getInFlightCount()).toBe(0);
  });

  it("drainInFlight resolves immediately if nothing in-flight", async () => {
    expect(getInFlightCount()).toBe(0);
    await drainInFlight(1000);
    expect(getInFlightCount()).toBe(0);
  });
});

describe("Outbound Header Case-Insensitive Deduplication", () => {
  beforeEach(() => {
    resetCircuitBreakers();
    resetStrategyRegistry();
    resetDrainState();
    initProviderRegistry();
    initStrategyRegistry();
    globalKeyPool.reset();
    globalKeyPool.setPool("or", ["sk-or-test-key-1", "sk-or-test-key-2"]);
  });

  it("deduplicates Content-Type case-insensitively and never emits both content-type and Content-Type", () => {
    const authHeaders = { Authorization: "Bearer sk-test" };
    const injectedHeaders = { "Content-Type": "application/json" };
    const provHeaders = { "X-Title": "TestGateway" };

    const merged = mergeOutboundHeaders(authHeaders, injectedHeaders, provHeaders);

    const keys = Object.keys(merged);
    const contentTypeKeys = keys.filter((k) => k.toLowerCase() === "content-type");

    expect(contentTypeKeys).toHaveLength(1);
    expect(contentTypeKeys[0]).toBe("Content-Type");
    expect(merged["Content-Type"]).toBe("application/json");
    expect(merged["content-type"]).toBeUndefined();
  });

  it("ensures provider declarative headers win and replace case-variant keys", () => {
    const authHeaders = { authorization: "Bearer auth-token" };
    const injectedHeaders = { "content-type": "application/json; charset=utf-8" };
    const provHeaders = {
      Authorization: "Bearer prov-token",
      "Content-Type": "application/json",
    };
    const targetExtra = { "x-custom": "1" };
    const payloadHeaders = { "x-payload-custom": "2" };

    const merged = mergeOutboundHeaders(
      authHeaders,
      injectedHeaders,
      provHeaders,
      targetExtra,
      payloadHeaders
    );

    const keys = Object.keys(merged);
    expect(keys.filter((k) => k.toLowerCase() === "authorization")).toEqual(["Authorization"]);
    expect(keys.filter((k) => k.toLowerCase() === "content-type")).toEqual(["Content-Type"]);
    expect(merged.Authorization).toBe("Bearer prov-token");
    expect(merged["Content-Type"]).toBe("application/json");
    expect(merged["x-payload-custom"]).toBe("2");
    expect(merged["x-custom"]).toBe("1");
  });

  it("merges req.outboundPayload.headers before provider declarative headers in dispatch pipeline", async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const fetchFn = async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const req = buildRequest({
      outboundPayload: {
        endpointKey: "ch",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Pipeline-Header": "pipeline-value",
        },
        body: { model: "test-model" },
        isStreaming: false,
      },
    });

    const res = await executeDispatchPipeline(req, fetchFn);
    expect(res.status).toBe(200);
    expect(capturedHeaders).toBeDefined();

    const keys = Object.keys(capturedHeaders!);
    const contentTypeKeys = keys.filter((k) => k.toLowerCase() === "content-type");
    expect(contentTypeKeys).toHaveLength(1);
    expect(capturedHeaders!["X-Pipeline-Header"]).toBe("pipeline-value");
  });

  it("strips host and hop-by-hop headers present in payloadHeaders", () => {
    const authHeaders = { Authorization: "Bearer test-token" };
    const injectedHeaders = { "X-Trace-Id": "trace-123" };
    const provHeaders = { "HTTP-Referer": "https://opencode.ai" };
    const targetExtra = { "x-custom": "1" };
    const payloadHeaders = {
      Host: "localhost:7766",
      host: "localhost:7766",
      connection: "keep-alive",
      "Keep-Alive": "timeout=5",
      "proxy-authenticate": "basic",
      "proxy-authorization": "basic token",
      te: "trailers",
      trailer: "custom-trailer",
      "transfer-encoding": "chunked",
      upgrade: "websocket",
      "content-encoding": "gzip",
      "content-length": "42",
      "x-allowed-client-header": "pass-through",
    };

    const merged = mergeOutboundHeaders(
      authHeaders,
      injectedHeaders,
      provHeaders,
      targetExtra,
      payloadHeaders
    );

    const lowerKeys = Object.keys(merged).map((k) => k.toLowerCase());

    expect(lowerKeys).not.toContain("host");
    expect(lowerKeys).not.toContain("connection");
    expect(lowerKeys).not.toContain("keep-alive");
    expect(lowerKeys).not.toContain("proxy-authenticate");
    expect(lowerKeys).not.toContain("proxy-authorization");
    expect(lowerKeys).not.toContain("te");
    expect(lowerKeys).not.toContain("trailer");
    expect(lowerKeys).not.toContain("transfer-encoding");
    expect(lowerKeys).not.toContain("upgrade");
    expect(lowerKeys).not.toContain("content-encoding");
    expect(lowerKeys).not.toContain("content-length");

    expect(merged["x-allowed-client-header"]).toBe("pass-through");
    expect(merged.Authorization).toBe("Bearer test-token");
    expect(merged["HTTP-Referer"]).toBe("https://opencode.ai");
  });

  it("never forwards Host or hop-by-hop headers from outboundPayload.headers in dispatch pipeline", async () => {
    let capturedHeaders: Record<string, string> | undefined;

    const fetchFn = async (_url: unknown, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    const req = buildRequest({
      outboundPayload: {
        endpointKey: "ch",
        method: "POST",
        headers: {
          Host: "localhost:7766",
          Connection: "close",
          "Content-Length": "999",
          "X-Safe-Header": "ok",
        },
        body: { model: "test-model" },
        isStreaming: false,
      },
    });

    const res = await executeDispatchPipeline(req, fetchFn);
    expect(res.status).toBe(200);
    expect(capturedHeaders).toBeDefined();

    const lowerKeys = Object.keys(capturedHeaders!).map((k) => k.toLowerCase());
    expect(lowerKeys).not.toContain("host");
    expect(lowerKeys).not.toContain("connection");
    expect(lowerKeys).not.toContain("content-length");
    expect(capturedHeaders!["X-Safe-Header"]).toBe("ok");
  });
});

describe("TraceWriter Server Lifecycle & Persistence", () => {
  it("initializes traceWriter and records traces to database", () => {
    resetAllState();
    expect(traceWriter.getDb()).not.toBeNull();

    const testReqId = `trace-test-req-${Date.now()}`;
    const sampleTrace = {
      reqId: testReqId,
      createdAt: Date.now(),
      provider: "openrouter",
      model: "test-model",
      status: 200,
      durationMs: 45,
      ttftMs: 12,
      tokensPrompt: 8,
      tokensCompletion: 16,
      legs: {
        clientInbound: "{}",
        upstreamOutbound: "{}",
        upstreamInbound: "{}",
        clientOutbound: "{}",
      },
    };

    traceWriter.enqueue(sampleTrace);
    traceWriter.flush();

    const db = traceWriter.getDb();
    expect(db).not.toBeNull();

    const row = db!
      .query<{ req_id: string; provider: string; model: string; status: number }, [string]>(
        "SELECT req_id, provider, model, status FROM request_traces WHERE req_id = ?"
      )
      .get(testReqId);

    expect(row).toBeDefined();
    expect(row?.req_id).toBe(testReqId);
    expect(row?.provider).toBe("openrouter");
    expect(row?.model).toBe("test-model");
    expect(row?.status).toBe(200);

    db!.run("DELETE FROM request_traces WHERE req_id = ?", [testReqId]);
  });

  afterAll(() => {
    traceWriter.drainSync();
  });
});

describe("Dispatch Error Handling, Retry Telemetry & Quarantine Prevention", () => {
  beforeEach(() => {
    resetCircuitBreakers();
    resetStrategyRegistry();
    resetDrainState();
    initProviderRegistry();
    initStrategyRegistry();
    globalKeyPool.reset();
    globalKeyPool.setPool("or", [
      "sk-or-test-key-1",
      "sk-or-test-key-2",
      "sk-or-test-key-3",
    ]);
  });

  it("strips stale content-encoding, content-length, and transfer-encoding headers on fail-fast error response (403)", async () => {
    const sleepSpy = spyOn(Bun, "sleep").mockImplementation(async () => {});
    const errorBody = JSON.stringify({
      error: { message: "Developer key invalid or forbidden", code: "key_invalid" },
    });

    const fetchFn = async () => {
      return new Response(errorBody, {
        status: 403,
        statusText: "Forbidden",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "content-length": "9999",
          "transfer-encoding": "chunked",
          "x-custom-header": "preserve-me",
        },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(403);
    // Header verification: compression and length headers are stripped to prevent ZlibError
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-length")).not.toBe("9999");
    expect(res.headers.get("transfer-encoding")).toBeNull();
    expect(res.headers.get("x-custom-header")).toBe("preserve-me");

    // Client can parse text and json cleanly without ZlibError
    const text = await res.text();
    expect(text).toBe(errorBody);
    const parsed = JSON.parse(text) as { error: { code: string } };
    expect(parsed.error.code).toBe("key_invalid");
    sleepSpy.mockRestore();
  });

  it("strips stale compression and length headers on exhausted retry error response (429)", async () => {
    const sleepSpy = spyOn(Bun, "sleep").mockImplementation(async () => {});
    const errorBody = JSON.stringify({
      error: { message: "Provider rate limit reached", code: "rate_limit_exceeded" },
    });

    let attempts = 0;
    const fetchFn = async () => {
      attempts += 1;
      return new Response(errorBody, {
        status: 429,
        statusText: "Too Many Requests",
        headers: {
          "content-type": "application/json",
          "content-encoding": "gzip",
          "content-length": "8888",
          "transfer-encoding": "chunked",
          "retry-after": "1",
        },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(429);
    expect(attempts).toBe(3); // OpenRouter default max_attempts is 3
    expect(res.headers.get("content-encoding")).toBeNull();
    expect(res.headers.get("content-length")).not.toBe("8888");
    expect(res.headers.get("transfer-encoding")).toBeNull();

    const text = await res.text();
    expect(text).toBe(errorBody);
    sleepSpy.mockRestore();
  });

  it("advances telemetry key index on retry attempts via setKeyIndex", async () => {
    const sleepSpy = spyOn(Bun, "sleep").mockImplementation(async () => {});
    const setKeyIndexSpy = spyOn(RequestTelemetry.prototype, "setKeyIndex");

    let attempts = 0;
    const fetchFn = async () => {
      attempts += 1;
      if (attempts < 3) {
        return new Response(JSON.stringify({ error: "Transient rate limit" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "1" },
        });
      }
      return new Response(JSON.stringify({ id: "success-on-key-3" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(200);
    expect(attempts).toBe(3);

    // Verify setKeyIndex was called for each attempt with the appropriate index
    expect(setKeyIndexSpy).toHaveBeenCalled();
    const calls = setKeyIndexSpy.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(3);
    // Key index advances across attempts: key 0 -> key 1 -> key 2
    expect(calls[0]?.[0]).toBe(0);
    expect(calls[1]?.[0]).toBe(1);
    expect(calls[2]?.[0]).toBe(2);

    setKeyIndexSpy.mockRestore();
    sleepSpy.mockRestore();
  });

  it("records upstream error message in telemetry on 4xx/5xx failures", async () => {
    const sleepSpy = spyOn(Bun, "sleep").mockImplementation(async () => {});
    const recordLimitSpy = spyOn(RequestTelemetry.prototype, "recordLimit");

    const upstreamErrorPayload = JSON.stringify({
      error: { message: "Model is currently experiencing high load", code: "overloaded" },
    });

    let attempts = 0;
    const fetchFn = async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(upstreamErrorPayload, {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "1" },
        });
      }
      return new Response(JSON.stringify({ id: "recovered" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(200);
    expect(recordLimitSpy).toHaveBeenCalled();
    const firstCall = recordLimitSpy.mock.calls[0]?.[0];
    expect(firstCall?.status).toBe(429);
    expect(firstCall?.rawMessage).toContain("Model is currently experiencing high load");

    recordLimitSpy.mockRestore();
    sleepSpy.mockRestore();
  });

  it("does not quarantine keys during retry attempts", async () => {
    const sleepSpy = spyOn(Bun, "sleep").mockImplementation(async () => {});
    const quarantineSpy = spyOn(globalKeyPool, "quarantineKey");

    let attempts = 0;
    const fetchFn = async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(JSON.stringify({ error: { message: "Temporary 429" } }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": "1" },
        });
      }
      return new Response(JSON.stringify({ choices: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const req = buildRequest();
    const res = await executeDispatchPipeline(req, fetchFn);

    expect(res.status).toBe(200);
    expect(attempts).toBe(2);

    // Mandate verification: globalKeyPool.quarantineKey is NOT invoked on retries
    expect(quarantineSpy).not.toHaveBeenCalled();

    quarantineSpy.mockRestore();
    sleepSpy.mockRestore();
  });
});
