import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { initProviderRegistry } from "../../../src/config/providers";
import type { ParsedDirective } from "../../../src/directive/types";
import { getCircuitBreaker } from "../../../src/engine/circuit_breaker";
import {
  executeDispatchPipeline,
  type DispatchRequest,
  type OutboundWirePayload,
  type PayloadTransformerContract,
} from "../../../src/engine/dispatch";
import { globalKeyPool } from "../../../src/handlers/openai_compat";
import { resetAllState } from "../../../src/index";
import { RequestTelemetry } from "../../../src/telemetry/session";

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

function buildStreamingRequest(overrides?: Partial<DispatchRequest>): DispatchRequest {
  const outbound: OutboundWirePayload = {
    endpointKey: "ch",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { model: "test-model", stream: true },
    isStreaming: true,
  };
  return {
    reqId: "test-abort-req-1",
    method: "POST",
    path: "/v1/chat/completions",
    directive: mockDirective,
    rawInboundBody: { model: "test-model" },
    outboundPayload: outbound,
    clientSignal: new AbortController().signal,
    clientHeaders: new Headers({ "user-agent": "dispatch-abort-test" }),
    transformer: mockTransformer,
    ...overrides,
  };
}

function faultyUpstreamStream(err: unknown): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode("data: {\"test\":\"chunk1\"}\n\n"));
      controller.error(err);
    },
  });
}

async function drainStream(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) return "";
  const reader = stream.getReader();
  try {
    const decoder = new TextDecoder();
    let accumulated = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) accumulated += decoder.decode(value, { stream: true });
    }
    return accumulated;
  } finally {
    reader.releaseLock();
  }
}

let origTelemetryError: RequestTelemetry["error"];
let origTelemetryServed: RequestTelemetry["served"];
let telemetryErrorCalls: Array<{ message: string }>;
let telemetryServedStatuses: number[];

describe("Dispatch mid-stream abort discrimination (S1 cutoff)", () => {
  beforeEach(() => {
    resetAllState();
    globalKeyPool.setPool("or", ["sk-test-stub-or-01", "sk-test-stub-or-02"]);
    telemetryErrorCalls = [];
    telemetryServedStatuses = [];
    origTelemetryError = RequestTelemetry.prototype.error;
    origTelemetryServed = RequestTelemetry.prototype.served;
    RequestTelemetry.prototype.error = function (message: string, err?: unknown) {
      telemetryErrorCalls.push({ message });
      return origTelemetryError.call(this, message, err);
    };
    RequestTelemetry.prototype.served = function (status = 200, attempt?: number, maxAttempts?: number) {
      telemetryServedStatuses.push(status);
      return origTelemetryServed.call(this, status, attempt, maxAttempts);
    };
  });

  afterEach(() => {
    RequestTelemetry.prototype.error = origTelemetryError;
    RequestTelemetry.prototype.served = origTelemetryServed;
    resetAllState();
  });

  test("mid-stream AbortError (code 20) yields quiet close: no breaker failure, no telemetry 500, terminates", async () => {
    console.log(
      "🧪 [TEST SIMULATION] Injecting mock mid-stream AbortError (code 20) to verify quiet client-abort close..."
    );
    const abortErr = new Error("The operation was aborted.");
    abortErr.name = "AbortError";
    (abortErr as unknown as { code: number }).code = 20;
    const fetchFn = async () =>
      new Response(faultyUpstreamStream(abortErr), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });

    const req = buildStreamingRequest();
    const res = await executeDispatchPipeline(req, fetchFn);
    expect(res.status).toBe(200);

    const accumulated = await drainStream(res.body);
    expect(accumulated).not.toContain("data: [DONE]");

    const breaker = getCircuitBreaker("or");
    expect(breaker.getFailureCount()).toBe(0);
    expect(telemetryErrorCalls.filter((c) => c.message.includes("Mid-stream"))).toHaveLength(0);
    expect(telemetryServedStatuses.filter((s) => s >= 500)).toHaveLength(0);
  });

  test("mid-stream client abort (aborted signal) yields quiet close: zero breaker failures, stream terminates", async () => {
    console.log(
      "🧪 [TEST SIMULATION] Aborting client signal mid-stream to verify quiet close with zero breaker failures..."
    );
    const clientController = new AbortController();
    const fetchFn = async () =>
      new Response(faultyUpstreamStream(new Error("Upstream socket closed abruptly")), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });

    const req = buildStreamingRequest({ clientSignal: clientController.signal });
    const res = await executeDispatchPipeline(req, fetchFn);
    expect(res.status).toBe(200);

    clientController.abort();
    const accumulated = await drainStream(res.body);
    expect(accumulated).not.toContain("data: [DONE]");

    const breaker = getCircuitBreaker("or");
    expect(breaker.getFailureCount()).toBe(0);
    expect(telemetryErrorCalls.filter((c) => c.message.includes("Mid-stream"))).toHaveLength(0);
    expect(telemetryServedStatuses.filter((s) => s >= 500)).toHaveLength(0);
  });

  test("genuine mid-stream upstream error emits [DONE] and records breaker failure", async () => {
    console.log(
      "🧪 [TEST SIMULATION] Injecting mock mid-stream upstream socket error to verify [DONE] termination and breaker failure..."
    );
    const fetchFn = async () =>
      new Response(faultyUpstreamStream(new Error("Upstream socket closed abruptly")), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });

    const req = buildStreamingRequest();
    const res = await executeDispatchPipeline(req, fetchFn);
    expect(res.status).toBe(200);

    const accumulated = await drainStream(res.body);
    expect(accumulated).toContain("data: [DONE]");

    const breaker = getCircuitBreaker("or");
    expect(breaker.getFailureCount()).toBe(1);
    expect(telemetryErrorCalls.filter((c) => c.message.includes("Mid-stream"))).toHaveLength(1);
  });

  test("pull() never rejects when the controller is already closed", async () => {
    const encoder = new TextEncoder();
    const cleanStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"test\":\"chunk1\"}\n\n"));
        controller.close();
      },
    });
    const fetchFn = async () =>
      new Response(cleanStream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });

    const req = buildStreamingRequest();
    const res = await executeDispatchPipeline(req, fetchFn);
    expect(res.status).toBe(200);

    const reader = res.body?.getReader();
    expect(reader).toBeDefined();
    if (!reader) return;
    try {
      const decoder = new TextDecoder();
      let accumulated = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) accumulated += decoder.decode(value, { stream: true });
      }
      expect(accumulated).toContain("chunk1");
      const extraOne = await reader.read();
      expect(extraOne.done).toBe(true);
      const extraTwo = await reader.read();
      expect(extraTwo.done).toBe(true);
    } finally {
      reader.releaseLock();
    }

    const breaker = getCircuitBreaker("or");
    expect(breaker.getFailureCount()).toBe(0);
  });
});
