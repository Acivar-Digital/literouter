import { describe, test, expect } from "bun:test";
import { sanitizeBody } from "../../src/telemetry/sanitize";
import { estimateTraceSize, MAX_LEG_BYTES, type SanitizedTrace } from "../../src/telemetry/ring_buffer";

describe("Phase 5: Trace Payload Truncation & Memory Safety", () => {
  test("sanitizeBody caps payload length when maxBytes is provided", () => {
    const hugeString = "A".repeat(100_000);
    const sanitized = sanitizeBody(hugeString, 1024);
    expect(sanitized.length).toBeLessThan(1024 + 50);
    expect(sanitized).toContain("[TRUNCATED FOR TRACE]");
  });

  test("sanitizeBody preserves full content when maxBytes is omitted", () => {
    const largeError = "Error: " + "X".repeat(10_000);
    const sanitized = sanitizeBody(largeError);
    expect(sanitized).toBe(largeError);
    expect(sanitized).not.toContain("[TRUNCATED FOR TRACE]");
  });

  test("sanitizeBody scrubs sensitive tokens even when truncated", () => {
    const secret = "sk-ant-api03-1234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890";
    const payload = secret + " " + "B".repeat(100_000);
    const sanitized = sanitizeBody(payload, 500);
    expect(sanitized).not.toContain(secret);
    expect(sanitized).toContain("[REDACTED_KEY]");
    expect(sanitized).toContain("[TRUNCATED FOR TRACE]");
  });

  test("estimateTraceSize calculates byte size without JSON.stringify overhead", () => {
    const sampleTrace: SanitizedTrace = {
      reqId: "req_test_123",
      createdAt: Date.now(),
      provider: "google",
      model: "gemini-2.5-flash",
      status: 200,
      durationMs: 450,
      ttftMs: 120,
      tokensPrompt: 50,
      tokensCompletion: 100,
      legs: {
        clientInbound: "hello world",
        upstreamOutbound: "outbound wire data",
        upstreamInbound: "inbound wire data",
        clientOutbound: "response",
      },
    };

    const estimated = estimateTraceSize(sampleTrace);
    const actualJson = JSON.stringify(sampleTrace).length;
    // Estimated accounts for base envelope overhead and string leg lengths
    expect(estimated).toBeGreaterThan(0);
    expect(Math.abs(estimated - actualJson)).toBeLessThan(300);
  });

  test("MAX_LEG_BYTES is defined and 64KB", () => {
    expect(MAX_LEG_BYTES).toBe(64 * 1024);
  });
});
