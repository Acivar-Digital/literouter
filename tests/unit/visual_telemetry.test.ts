import { describe, expect, it, spyOn } from "bun:test";
import {
  extractErrorMessage,
  formatTimestamp,
  formatTokenNumber,
  getHttpStatusText,
  getProviderDisplayName,
  getWireDisplayName,
  logAmber,
  logExhausted,
  logFinishReason,
  logFusion,
  logInbound,
  logInfo,
  logLimit,
  logRetry,
  logRotate,
  logSeparator,
  logServed,
  logTrace,
  logTtft,
  logUsage,
  logWarn,
} from "../../src/ui/logger";

describe("Visual Telemetry & Terminal UI", () => {
  it("formats timestamps consistently in [MM-DD-HH:MM:SS:mmm] format", () => {
    const ts = formatTimestamp(new Date(2026, 7, 17, 14, 32, 1, 105));
    expect(ts).toBe("[08-17-14:32:01:105]");
  });

  it("resolves friendly provider and wire display names", () => {
    expect(getProviderDisplayName("or")).toBe("OpenRouter");
    expect(getProviderDisplayName("nv")).toBe("NVIDIA NIM");
    expect(getProviderDisplayName("gg")).toBe("Google");
    expect(getWireDisplayName("cl")).toBe("Claude");
    expect(getWireDisplayName("oa")).toBe("OpenAI");
  });

  it("formats token numbers with thousands commas", () => {
    expect(formatTokenNumber(1420)).toBe("1,420");
    expect(formatTokenNumber(2100500)).toBe("2,100,500");
  });

  it("logs rich multi-line inbound request telemetry", () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    logInbound({
      reqId: "REQ-89f2a",
      method: "POST",
      path: "/v1/messages",
      clientAgent: "Claude-Code/1.0",
      directiveStr: "lr-or-cl-ms-no",
      targetProvider: "or",
      wireFormat: "cl",
      endpoint: "/api/v1/messages",
      model: "anthropic/claude-3.7-sonnet",
      totalKeys: 5,
      nuances: ["no"],
    });

    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("Inbound POST /v1/messages from Claude-Code/1.0"))).toBe(true);
    expect(calls.some((c) => c.includes("Directive : lr-or-cl-ms-no -> Target: OpenRouter | Wire: Claude | EP: /api/v1/messages"))).toBe(true);
    expect(calls.some((c) => c.includes("Model     : anthropic/claude-3.7-sonnet | Pool: OpenRouter (5 keys)"))).toBe(true);
    consoleSpy.mockRestore();
  });

  it("logs TTFT and token usage with tok/s speed calculation", () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    logTtft("REQ-89f2a", 315, "First chunk streamed downstream", "HTTP/2");
    expect(consoleSpy).toHaveBeenCalled();

    logUsage({
      reqId: "REQ-89f2a",
      provider: "or",
      keyIndex: 0,
      totalKeys: 5,
      promptTokens: 1420,
      completionTokens: 680,
      totalTokens: 2100,
      durationMs: 3420,
    });

    const calls = consoleSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("[TTFT REQ-89f2a] TTFT = 315ms | First chunk streamed downstream [Upstream: HTTP/2]"))).toBe(true);
    expect(calls.some((c) => c.includes("[USAGE REQ-89f2a] OpenRouter (Key #1/5)"))).toBe(true);
    expect(calls.some((c) => c.includes("Tokens: Prompt=1,420 | Completion=680 | Total=2,100 | Speed=198.8 tok/s"))).toBe(true);
    consoleSpy.mockRestore();
  });

  it("logs limit warning with parsed retry-after", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    logLimit("REQ-89f2b", "nv", 1, 429, 60, 3);
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("[LIMIT REQ-89f2b] NVIDIA NIM [Key #2/3] returned 429 Too Many Requests"))).toBe(true);
    expect(calls.some((c) => c.includes("Parsed Retry-After: 60s -> Quarantined Key #2 for 60s"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("logs limit warning with raw upstream error message and accurate status texts", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    logLimit("REQ-89f2b-502", "or", 0, 502, 10, 2, "OpenRouter provider anthropic returned 502: Internal server error");
    logLimit("REQ-89f2b-500", "or", 0, 500, 10, 2, "Internal server error");
    logLimit("REQ-89f2b-503", "or", 0, 503, 10, 2, "Service unavailable");
    logLimit("REQ-89f2b-504", "or", 0, 504, 10, 2, "Gateway timeout");
    logLimit("REQ-89f2b-418", "or", 0, 418, undefined, 2, "I'm a teapot");

    const calls = warnSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("[LIMIT REQ-89f2b-502] OpenRouter [Key #1/2] returned 502 Bad Gateway"))).toBe(true);
    expect(calls.some((c) => c.includes('Upstream Error: "OpenRouter provider anthropic returned 502: Internal server error"'))).toBe(true);
    expect(calls.some((c) => c.includes("[LIMIT REQ-89f2b-500] OpenRouter [Key #1/2] returned 500 Internal Server Error"))).toBe(true);
    expect(calls.some((c) => c.includes("[LIMIT REQ-89f2b-503] OpenRouter [Key #1/2] returned 503 Service Unavailable"))).toBe(true);
    expect(calls.some((c) => c.includes("[LIMIT REQ-89f2b-504] OpenRouter [Key #1/2] returned 504 Gateway Timeout"))).toBe(true);
    expect(calls.some((c) => c.includes("[LIMIT REQ-89f2b-418] OpenRouter [Key #1/2] returned HTTP 418"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("extracts error message from various body structures", () => {
    expect(extractErrorMessage('{"error":{"message":"User quota exceeded"}}')).toBe("User quota exceeded");
    expect(extractErrorMessage('{"error":"Rate limit reached"}')).toBe("Rate limit reached");
    expect(extractErrorMessage('{"message":"Service degraded"}')).toBe("Service degraded");
    expect(extractErrorMessage('{"detail":"Validation error"}')).toBe("Validation error");
    expect(extractErrorMessage("502 Bad Gateway - upstream died")).toBe("502 Bad Gateway - upstream died");
    expect(extractErrorMessage(undefined)).toBeUndefined();
    expect(extractErrorMessage("")).toBeUndefined();
  });

  it("resolves accurate HTTP status texts with getHttpStatusText", () => {
    expect(getHttpStatusText(429)).toBe("429 Too Many Requests");
    expect(getHttpStatusText(500)).toBe("500 Internal Server Error");
    expect(getHttpStatusText(502)).toBe("502 Bad Gateway");
    expect(getHttpStatusText(503)).toBe("503 Service Unavailable");
    expect(getHttpStatusText(504)).toBe("504 Gateway Timeout");
    expect(getHttpStatusText(400)).toBe("HTTP 400");
    expect(getHttpStatusText(404)).toBe("HTTP 404");
  });

  it("logs key rotation with attempt count", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    logRotate("REQ-89f2b", "nv", 1, 2, 3, 2, 3);
    expect(logSpy).toHaveBeenCalled();
    const calls = logSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("[ROTATE REQ-89f2b] Advancing to NVIDIA NIM [Key #3/3] -> Retrying immediately (Attempt 2/3)"))).toBe(true);
    logSpy.mockRestore();
  });

  it("logs served response with green indicator for 2xx status", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    logServed("REQ-89f2c", 125, 200);
    expect(logSpy).toHaveBeenCalled();
    const calls = logSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("🟢") && c.includes("[SERVED REQ-89f2c] HTTP 200 in 125ms"))).toBe(true);
    logSpy.mockRestore();
  });

  it("logs served response with warning indicator for 4xx/5xx status", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    logServed("REQ-89f2d", 80, 404);
    logServed("REQ-89f2e", 95, 500, 1, 2);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    const calls = warnSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("⚠️") && c.includes("[SERVED REQ-89f2d] HTTP 404 in 80ms"))).toBe(true);
    expect(calls.some((c) => c.includes("⚠️") && c.includes("[SERVED REQ-89f2e] HTTP 500 in 95ms (attempt 1/2)"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("logs exhausted error with provider name and backoff ms", () => {
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});
    logExhausted("REQ-89f2f", "or", 2500);
    expect(errorSpy).toHaveBeenCalled();
    const calls = errorSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("🔴") && c.includes("[EXHAUSTED REQ-89f2f] All keys in OpenRouter cooling down. Applying backoff: 2500ms"))).toBe(true);
    errorSpy.mockRestore();
  });

  it("logs separator line", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    logSeparator();
    expect(logSpy).toHaveBeenCalledWith("────────────────────────────────────────────────────────────────────────────────");
    logSpy.mockRestore();
  });

  it("logs finish_reason telemetry for normal completion", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    logFinishReason("REQ-89f2g", "stop");
    logFinishReason("REQ-89f2h", "tool_calls");
    expect(logSpy).toHaveBeenCalledTimes(2);
    const calls = logSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("🏁") && c.includes("[FINISH REQ-89f2g] Stream finished: finish_reason=stop"))).toBe(true);
    expect(calls.some((c) => c.includes("🏁") && c.includes("[FINISH REQ-89f2h] Stream finished: finish_reason=tool_calls"))).toBe(true);
    logSpy.mockRestore();
  });

  it("logs warning telemetry on token truncation (finish_reason=length)", () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    logFinishReason("REQ-89f2i", "length");
    expect(warnSpy).toHaveBeenCalled();
    const calls = warnSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("⚠️") && c.includes("[FINISH REQ-89f2i] Upstream token truncation occurred (finish_reason=length)"))).toBe(true);
    warnSpy.mockRestore();
  });

  it("safely guards against null and undefined finish_reason", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    logFinishReason("REQ-89f2j", null);
    logFinishReason("REQ-89f2k", undefined);
    logFinishReason("REQ-89f2l", "" as any);
    expect(logSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("logs custom info and warning messages with logInfo and logWarn", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    logInfo("ℹ️", "Test info message");
    logWarn("⚠️", "Test warning message");
    expect(logSpy).toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    const logCalls = logSpy.mock.calls.map((c) => c[0]);
    const warnCalls = warnSpy.mock.calls.map((c) => c[0]);
    expect(logCalls.some((c) => c.includes("ℹ️") && c.includes("Test info message"))).toBe(true);
    expect(warnCalls.some((c) => c.includes("⚠️") && c.includes("Test warning message"))).toBe(true);
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
