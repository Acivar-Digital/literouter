import { describe, it, expect, beforeEach, spyOn } from "bun:test";
import { initProviderRegistry } from "../../../src/config/providers";
import { RequestTelemetry, type TelemetryInit, type UsageRecord } from "../../../src/telemetry/session";
import { type MetricsHook, noopMetrics } from "../../../src/telemetry/hooks";
import { getProviderDisplayNameCompat } from "../../../src/ui/logger";

describe("RequestTelemetry & Metrics Contract", () => {
  beforeEach(() => {
    initProviderRegistry();
  });

  describe("getProviderDisplayNameCompat", () => {
    it("resolves known static provider codes case-insensitively", () => {
      expect(getProviderDisplayNameCompat("or")).toBe("OpenRouter");
      expect(getProviderDisplayNameCompat("OR")).toBe("OpenRouter");
      expect(getProviderDisplayNameCompat("nv")).toBe("NVIDIA NIM");
      expect(getProviderDisplayNameCompat("gg")).toBe("Google");
      expect(getProviderDisplayNameCompat("zn")).toBe("Zen");
    });

    it("falls back to provider registry when not in static map", () => {
      // tp is in providers.json registry as "Loopback Double" (or TestProvider in map)
      expect(getProviderDisplayNameCompat("tp")).toBe("TestProvider");
    });

    it("falls back to uppercase for unregistered provider codes", () => {
      expect(getProviderDisplayNameCompat("custom_unknown")).toBe("CUSTOM_UNKNOWN");
    });
  });

  describe("TTFT & Monotonic Timings", () => {
    const baseInit: TelemetryInit = {
      reqId: "REQ-test-ttft-1",
      method: "POST",
      path: "/v1/chat/completions",
      clientAgent: "OpenCode/2.0",
      directiveStr: "lr-or-oa-ch-no",
      targetProvider: "or",
      wireFormat: "oa",
      endpoint: "/v1/chat/completions",
      model: "openrouter/auto",
      keyIndex: 0,
      totalKeys: 3,
    };

    it("reports undefined TTFT before markTtft is called", () => {
      const tel = new RequestTelemetry(baseInit);
      expect(tel.getTtftMs()).toBeUndefined();
    });

    it("records TTFT and is strictly idempotent on subsequent calls", async () => {
      const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
      const tel = new RequestTelemetry(baseInit);

      await Bun.sleep(10);
      tel.markTtft("HTTP/2");

      const firstTtft = tel.getTtftMs();
      expect(firstTtft).toBeDefined();
      expect(firstTtft!).toBeGreaterThanOrEqual(8);

      await Bun.sleep(15);
      // Second call should be ignored
      tel.markTtft("HTTP/1.1");
      const secondTtft = tel.getTtftMs();

      expect(secondTtft).toBe(firstTtft);
      expect(consoleSpy).toHaveBeenCalledTimes(1);
      const logLine = String(consoleSpy.mock.calls[0]?.[0] ?? "");
      expect(logLine).toContain("[TTFT REQ-test-ttft-1]");
      expect(logLine).toContain("HTTP/2");
      consoleSpy.mockRestore();
    });

    it("duration increases monotonically", async () => {
      const tel = new RequestTelemetry(baseInit);
      const d1 = tel.getDurationMs();
      await Bun.sleep(15);
      const d2 = tel.getDurationMs();
      expect(d2).toBeGreaterThanOrEqual(d1);
    });
  });

  describe("recordUsage and Speed Calculation", () => {
    it("computes tokens/sec speed accurately and emits usage banner", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const tel = new RequestTelemetry({
        reqId: "REQ-test-usage-1",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "OpenCode/2.0",
        targetProvider: "or",
        keyIndex: 0,
        totalKeys: 2,
      });

      // Wait a deterministic slice to ensure non-zero duration
      await Bun.sleep(20);

      const usage: UsageRecord = {
        promptTokens: 100,
        completionTokens: 50,
        reasoningTokens: 10,
        totalTokens: 150,
      };
      tel.recordUsage(usage);

      expect(logSpy).toHaveBeenCalled();
      const calls = logSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes("[USAGE REQ-test-usage-1] OpenRouter (Key #1/2)"))).toBe(true);
      expect(calls.some((c) => c.includes("Tokens: Prompt=100 | Reasoning=10 | Completion=50 | Total=150 | Speed="))).toBe(true);
      logSpy.mockRestore();
    });

    it("emits truncation warning when finish_reason is length", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const tel = new RequestTelemetry({
        reqId: "REQ-test-trunc-1",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "OpenCode/2.0",
        targetProvider: "or",
      });

      tel.recordUsage({
        promptTokens: 50,
        completionTokens: 2048,
        finishReason: "length",
      });

      expect(warnSpy).toHaveBeenCalled();
      const calls = warnSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes("Upstream token truncation occurred (finish_reason=length)"))).toBe(true);
      warnSpy.mockRestore();
    });
  });

  describe("toTraceMetrics", () => {
    it("returns expected structured snapshot without usage", () => {
      const tel = new RequestTelemetry({
        reqId: "REQ-trace-1",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "Claude-Code/1.0",
        targetProvider: "nv",
        model: "deepseek-ai/deepseek-r1",
      });

      const metrics = tel.toTraceMetrics();
      expect(metrics.reqId).toBe("REQ-trace-1");
      expect(metrics.provider).toBe("nv");
      expect(metrics.model).toBe("deepseek-ai/deepseek-r1");
      expect(metrics.durationMs).toBeGreaterThanOrEqual(0);
      expect(metrics.ttftMs).toBeUndefined();
      expect(metrics.promptTokens).toBeUndefined();
    });

    it("returns complete structured snapshot with TTFT and token usage", () => {
      const tel = new RequestTelemetry({
        reqId: "REQ-trace-2",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "Claude-Code/1.0",
        targetProvider: "nv",
        model: "meta/llama-3.3-70b-instruct",
      });

      tel.markTtft();
      tel.recordUsage({
        promptTokens: 250,
        completionTokens: 75,
        totalTokens: 325,
      });

      const metrics = tel.toTraceMetrics();
      expect(metrics.reqId).toBe("REQ-trace-2");
      expect(metrics.provider).toBe("nv");
      expect(metrics.model).toBe("meta/llama-3.3-70b-instruct");
      expect(metrics.ttftMs).toBeDefined();
      expect(metrics.promptTokens).toBe(250);
      expect(metrics.completionTokens).toBe(75);
      expect(metrics.totalTokens).toBe(325);
    });
  });

  describe("Lifecycle Methods & Banners", () => {
    it("emits inbound banner with directive and model details", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const tel = new RequestTelemetry({
        reqId: "REQ-inbound-1",
        method: "POST",
        path: "/v1/messages",
        clientAgent: "Claude-Code/1.0",
        directiveStr: "lr-or-cl-ms-no",
        targetProvider: "or",
        wireFormat: "cl",
        endpoint: "/api/v1/messages",
        model: "anthropic/claude-3.7-sonnet",
        keyIndex: 0,
        totalKeys: 5,
        nuances: ["no"],
      });

      tel.emitInbound();
      expect(logSpy).toHaveBeenCalled();
      const calls = logSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes("Inbound POST /v1/messages from Claude-Code/1.0"))).toBe(true);
      expect(calls.some((c) => c.includes("Directive: lr-or-cl-ms-no -> Target: OpenRouter | Wire: Claude | EP: /api/v1/messages"))).toBe(true);
      expect(calls.some((c) => c.includes("Model: anthropic/claude-3.7-sonnet | Key: OpenRouter [Key #1/5]"))).toBe(true);
      logSpy.mockRestore();
    });

    it("emits key rotation banner", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const tel = new RequestTelemetry({
        reqId: "REQ-rotate-1",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "OpenCode/2.0",
        targetProvider: "nv",
        keyIndex: 0,
        totalKeys: 3,
      });

      tel.rotateKey({
        fromIndex: 0,
        toIndex: 1,
        totalKeys: 3,
        attempt: 1,
        maxAttempts: 3,
      });

      expect(logSpy).toHaveBeenCalled();
      const calls = logSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes("[ROTATE REQ-rotate-1] Advancing to NVIDIA NIM [Key #2/3] -> Retrying immediately (Attempt 1/3)"))).toBe(true);
      logSpy.mockRestore();
    });

    it("handles toIndex < 0 in rotateKey without printing Key #0 or corrupting key index", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const tel = new RequestTelemetry({
        reqId: "REQ-rotate-neg",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "OpenCode/2.0",
        targetProvider: "or",
        keyIndex: 1,
        totalKeys: 2,
      });

      tel.rotateKey({
        fromIndex: 1,
        toIndex: -1,
        totalKeys: 2,
        attempt: 2,
        maxAttempts: 3,
      });

      const logCalls = logSpy.mock.calls.map((c) => c[0]);
      expect(logCalls.some((c) => c.includes("Key #0"))).toBe(false);
      expect(logCalls.some((c) => c.includes("[ROTATE REQ-rotate-neg] Advancing to OpenRouter -> Retrying immediately (Attempt 2/3)"))).toBe(true);

      tel.recordLimit({
        status: 429,
        retryAfterSec: 5,
      });

      const warnCalls = warnSpy.mock.calls.map((c) => c[0]);
      expect(warnCalls.some((c) => c.includes("Key #0"))).toBe(false);
      expect(warnCalls.some((c) => c.includes("[LIMIT REQ-rotate-neg] OpenRouter [Key #2/2] returned 429"))).toBe(true);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("updates keyIndex and totalKeys via setKeyIndex", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const tel = new RequestTelemetry({
        reqId: "REQ-setkey-1",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "OpenCode/2.0",
        targetProvider: "nv",
        keyIndex: 0,
        totalKeys: 2,
      });

      tel.setKeyIndex(2, 4);

      tel.recordLimit({
        status: 429,
        retryAfterSec: 10,
      });

      const calls = warnSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes("[LIMIT REQ-setkey-1] NVIDIA NIM [Key #3/4] returned 429"))).toBe(true);
      expect(calls.some((c) => c.includes("Quarantined Key #3 for 10s"))).toBe(true);
      warnSpy.mockRestore();
    });

    it("emits limit warning banner with retry-after and raw upstream message", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const tel = new RequestTelemetry({
        reqId: "REQ-limit-1",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "OpenCode/2.0",
        targetProvider: "nv",
        keyIndex: 1,
        totalKeys: 3,
      });

      tel.recordLimit({
        status: 429,
        retryAfterSec: 45,
        totalKeys: 3,
        rawMessage: "Rate limit reached for requests per minute",
      });

      expect(warnSpy).toHaveBeenCalled();
      const calls = warnSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes("[LIMIT REQ-limit-1] NVIDIA NIM [Key #2/3] returned 429 Too Many Requests"))).toBe(true);
      expect(calls.some((c) => c.includes("Parsed Retry-After: 45s -> Quarantined Key #2 for 45s"))).toBe(true);
      expect(calls.some((c) => c.includes('Upstream Error: "Rate limit reached for requests per minute"'))).toBe(true);
      warnSpy.mockRestore();
    });

    it("suppresses Parsed Retry-After when hasUpstreamRetryAfter is false", () => {
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
      const tel = new RequestTelemetry({
        reqId: "REQ-limit-suppressed",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "OpenCode/2.0",
        targetProvider: "nv",
        keyIndex: 0,
        totalKeys: 3,
      });

      tel.recordLimit({
        status: 429,
        retryAfterSec: 15,
        hasUpstreamRetryAfter: false,
        rawMessage: "Quota exceeded",
      });

      const calls = warnSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes("[LIMIT REQ-limit-suppressed] NVIDIA NIM [Key #1/3] returned 429"))).toBe(true);
      expect(calls.some((c) => c.includes("Parsed Retry-After"))).toBe(false);
      expect(calls.some((c) => c.includes('Upstream Error: "Quota exceeded"'))).toBe(true);
      warnSpy.mockRestore();
    });

    it("emits served banner for 200 OK and 500 error", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      const telOk = new RequestTelemetry({
        reqId: "REQ-served-200",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "OpenCode/2.0",
      });
      telOk.served(200);

      const telErr = new RequestTelemetry({
        reqId: "REQ-served-500",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "OpenCode/2.0",
      });
      telErr.served(500, 2, 3);

      expect(logSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      const logCalls = logSpy.mock.calls.map((c) => c[0]);
      const warnCalls = warnSpy.mock.calls.map((c) => c[0]);

      expect(logCalls.some((c) => c.includes("[SERVED REQ-served-200] HTTP 200 in"))).toBe(true);
      expect(warnCalls.some((c) => c.includes("[SERVED REQ-served-500] HTTP 500 in") && c.includes("(attempt 2/3)"))).toBe(true);

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("emits error banner", () => {
      const errorSpy = spyOn(console, "error").mockImplementation(() => {});
      const tel = new RequestTelemetry({
        reqId: "REQ-error-1",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "OpenCode/2.0",
      });

      tel.error("Failed to connect to upstream", new Error("ECONNREFUSED"));
      expect(errorSpy).toHaveBeenCalled();
      const calls = errorSpy.mock.calls.map((c) => c[0]);
      expect(calls.some((c) => c.includes("[ERROR REQ-error-1] Failed to connect to upstream - ECONNREFUSED"))).toBe(true);
      errorSpy.mockRestore();
    });
  });

  describe("MetricsHook Invocation", () => {
    it("invokes MetricsHook callbacks through lifecycle", () => {
      const calls: string[] = [];
      const hook: MetricsHook = {
        onRequestStart(reqId, provider, model) {
          calls.push(`start:${reqId}:${provider}:${model}`);
        },
        onRequestEnd(reqId, status, durationMs, ttftMs) {
          calls.push(`end:${reqId}:${status}:${typeof durationMs}:${typeof ttftMs}`);
        },
        onKeyRotation(reqId, provider, fromKey, toKey) {
          calls.push(`rotate:${reqId}:${provider}:${fromKey}->${toKey}`);
        },
        onCircuitBreakerStateChange(provider, oldState, newState) {
          calls.push(`cb:${provider}:${oldState}->${newState}`);
        },
      };

      const tel = new RequestTelemetry({
        reqId: "REQ-hook-1",
        method: "POST",
        path: "/v1/chat/completions",
        clientAgent: "OpenCode/2.0",
        targetProvider: "or",
        model: "openrouter/auto",
        metricsHook: hook,
      });

      tel.emitInbound();
      tel.markTtft();
      tel.rotateKey({ fromIndex: 0, toIndex: 1 });
      tel.served(200);

      expect(calls).toEqual([
        "start:REQ-hook-1:or:openrouter/auto",
        "rotate:REQ-hook-1:or:0->1",
        "end:REQ-hook-1:200:number:number",
      ]);
    });

    it("noopMetrics does not throw when invoked", () => {
      expect(() => {
        noopMetrics.onRequestStart("r1", "or", "m1");
        noopMetrics.onRequestEnd("r1", 200, 100, 50);
        noopMetrics.onKeyRotation("r1", "or", 0, 1);
        noopMetrics.onCircuitBreakerStateChange("or", "closed", "open");
      }).not.toThrow();
    });
  });
});
