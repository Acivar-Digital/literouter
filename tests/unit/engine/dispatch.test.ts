import { describe, expect, it, beforeEach, mock } from "bun:test";
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
});
