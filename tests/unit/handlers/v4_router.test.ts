import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { dispatchV4 } from "../../../src/handlers/v4/router";
import { traceBuffer, type SanitizedTrace } from "../../../src/telemetry/ring_buffer";
import { traceWriter } from "../../../src/telemetry/trace_writer";
import { initProviderRegistry } from "../../../src/config/providers";
import { initStrategyRegistry } from "../../../src/engine/strategy_registry";

function createMockTrace(reqId: string, status = 200): SanitizedTrace {
  return {
    reqId,
    createdAt: Date.now(),
    provider: "openrouter",
    model: "test-model",
    status,
    durationMs: 120,
    ttftMs: 45,
    tokensPrompt: 10,
    tokensCompletion: 20,
    legs: {
      clientInbound: '{"prompt":"hello"}',
      upstreamOutbound: '{"model":"test-model"}',
      upstreamInbound: '{"choices":[]}',
      clientOutbound: '{"result":"ok"}',
    },
  };
}

describe("v4 router dispatcher", () => {
  beforeEach(() => {
    initProviderRegistry();
    initStrategyRegistry();
    traceBuffer.clear();
  });

  afterEach(() => {
    traceBuffer.clear();
    traceWriter.drainSync();
  });

  describe("thin handler routing", () => {
    it("dispatches POST /v1/chat/completions to openai_chat handler", async () => {
      const req = new Request("http://localhost:7766/v1/chat/completions", {
        method: "POST",
        body: "{malformed-json",
      });
      const res = await dispatchV4(req, "lr-or-oa-ch-no", "req-chat-1");
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Invalid JSON");
    });

    it("dispatches POST /v1/messages and /messages to anthropic_messages handler", async () => {
      const req1 = new Request("http://localhost:7766/v1/messages", {
        method: "POST",
        body: "{malformed-json",
      });
      const res1 = await dispatchV4(req1, "lr-an-cl-ms-no", "req-msg-1");
      expect(res1.status).toBe(400);

      const req2 = new Request("http://localhost:7766/messages", {
        method: "POST",
        body: "{malformed-json",
      });
      const res2 = await dispatchV4(req2, "lr-an-cl-ms-no", "req-msg-2");
      expect(res2.status).toBe(400);
    });

    it("dispatches POST /v1/responses to openai_responses handler", async () => {
      const req = new Request("http://localhost:7766/v1/responses", {
        method: "POST",
        body: "{malformed-json",
      });
      const res = await dispatchV4(req, "lr-zn-oo-rs-no", "req-resp-1");
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Invalid JSON");
    });

    it("dispatches POST /v1beta/models/*:generateContent and stream to google_native handler", async () => {
      const req1 = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
        method: "POST",
        body: "{malformed-json",
      });
      const res1 = await dispatchV4(req1, "lr-gg-gg-gc-no", "req-gg-1");
      expect(res1.status).toBe(400);

      const req2 = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:streamGenerateContent", {
        method: "POST",
        body: "{malformed-json",
      });
      const res2 = await dispatchV4(req2, "lr-gg-gg-gc-no", "req-gg-2");
      expect(res2.status).toBe(400);
    });

    it("dispatches POST /v1beta/openai/* to gcp_compat handler", async () => {
      const req = new Request("http://localhost:7766/v1beta/openai/chat/completions", {
        method: "POST",
        body: "{malformed-json",
      });
      const res = await dispatchV4(req, "lr-gc-oa-ch-no", "req-gcp-1");
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Invalid JSON");
    });
  });

  describe("trace inspection endpoints", () => {
    it("returns 401 when accessing traces without valid directive key", async () => {
      const req1 = new Request("http://localhost:7766/v1/traces");
      const res1 = await dispatchV4(req1, "", "req-t1");
      expect(res1.status).toBe(401);
      const json1 = await res1.json();
      expect(json1.error.code).toBe("unauthorized");
      expect(json1.error.type).toBe("authentication_error");

      const req2 = new Request("http://localhost:7766/v1/traces/req-123");
      const res2 = await dispatchV4(req2, "invalid-key", "req-t2");
      expect(res2.status).toBe(401);
      const json2 = await res2.json();
      expect(json2.error.code).toBe("unauthorized");
    });

    it("returns trace from RAM when present", async () => {
      const trace = createMockTrace("req-ram-test-1", 200);
      traceBuffer.push(trace);

      const req = new Request("http://localhost:7766/v1/traces/req-ram-test-1");
      const res = await dispatchV4(req, "lr-or-oa-ch-no", "req-caller");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.reqId).toBe("req-ram-test-1");
      expect(json.durationMs).toBe(120);
    });

    it("returns trace from SQLite when evicted from RAM", async () => {
      traceWriter.init(":memory:");
      const trace = createMockTrace("req-sqlite-1", 200);
      traceWriter.enqueue(trace);
      traceWriter.flush();
      traceBuffer.clear();

      const req = new Request("http://localhost:7766/v1/traces/req-sqlite-1");
      const res = await dispatchV4(req, "lr-or-oa-ch-no", "req-caller");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.reqId).toBe("req-sqlite-1");
    });

    it("returns 404 when trace is neither in RAM nor SQLite", async () => {
      const req = new Request("http://localhost:7766/v1/traces/req-missing");
      const res = await dispatchV4(req, "lr-or-oa-ch-no", "req-caller");
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("not_found");
      expect(json.error.message).toContain("req-missing");
    });

    it("returns recent traces list for GET /v1/traces", async () => {
      traceBuffer.push(createMockTrace("trace-1", 200));
      traceBuffer.push(createMockTrace("trace-2", 500));

      const req = new Request("http://localhost:7766/v1/traces");
      const res = await dispatchV4(req, "lr-or-oa-ch-no", "req-caller");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.traces)).toBe(true);
      expect(json.traces.length).toBe(2);
    });

    it("filters errors when requested via GET /v1/traces?errors=true&n=5", async () => {
      traceBuffer.push(createMockTrace("trace-ok-1", 200));
      traceBuffer.push(createMockTrace("trace-err-1", 500));
      traceBuffer.push(createMockTrace("trace-ok-2", 200));
      traceBuffer.push(createMockTrace("trace-err-2", 429));

      const req = new Request("http://localhost:7766/v1/traces?errors=true&n=5");
      const res = await dispatchV4(req, "lr-or-oa-ch-no", "req-caller");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.traces.length).toBe(2);
      expect(json.traces.every((t: SanitizedTrace) => t.status >= 400)).toBe(true);
    });
  });

  describe("unknown route handling", () => {
    it("returns 404 for unknown path", async () => {
      const req = new Request("http://localhost:7766/v1/unknown", { method: "POST" });
      const res = await dispatchV4(req, "lr-or-oa-ch-no", "req-unk");
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("not_found");
      expect(json.error.message).toBe("Route not found: POST /v1/unknown");
    });

    it("returns 404 when HTTP method is not allowed on handler path", async () => {
      const req = new Request("http://localhost:7766/v1/chat/completions", { method: "GET" });
      const res = await dispatchV4(req, "lr-or-oa-ch-no", "req-method");
      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("not_found");
      expect(json.error.message).toBe("Route not found: GET /v1/chat/completions");
    });
  });
});
