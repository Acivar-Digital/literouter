import { describe, expect, it, spyOn } from "bun:test";
import {
  formatTimestamp,
  formatTokenNumber,
  getProviderDisplayName,
  getWireDisplayName,
  logAmber,
  logExhausted,
  logFusion,
  logInbound,
  logLimit,
  logRetry,
  logRotate,
  logSeparator,
  logServed,
  logTrace,
  logTtft,
  logUsage,
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
      keyIndex: 0,
      totalKeys: 5,
      nuances: ["no"],
    });

    expect(consoleSpy).toHaveBeenCalled();
    const calls = consoleSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("Inbound POST /v1/messages from Claude-Code/1.0"))).toBe(true);
    expect(calls.some((c) => c.includes("Directive : lr-or-cl-ms-no -> Target: OpenRouter | Wire: Claude | EP: /api/v1/messages"))).toBe(true);
    expect(calls.some((c) => c.includes("Model     : anthropic/claude-3.7-sonnet | Key: OpenRouter [Key #1/5]"))).toBe(true);
    consoleSpy.mockRestore();
  });

  it("logs TTFT and token usage with tok/s speed calculation", () => {
    const consoleSpy = spyOn(console, "log").mockImplementation(() => {});
    logTtft("REQ-89f2a", 315, "First chunk streamed downstream");
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
    expect(calls.some((c) => c.includes("[TTFT REQ-89f2a] TTFT = 315ms | First chunk streamed downstream"))).toBe(true);
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

  it("logs key rotation with attempt count", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    logRotate("REQ-89f2b", "nv", 1, 2, 3, 2, 3);
    expect(logSpy).toHaveBeenCalled();
    const calls = logSpy.mock.calls.map((c) => c[0]);
    expect(calls.some((c) => c.includes("[ROTATE REQ-89f2b] Advancing to NVIDIA NIM [Key #3/3] -> Retrying immediately (Attempt 2/3)"))).toBe(true);
    logSpy.mockRestore();
  });

  it("logs separator line", () => {
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    logSeparator();
    expect(logSpy).toHaveBeenCalledWith("────────────────────────────────────────────────────────────────────────────────");
    logSpy.mockRestore();
  });
});
