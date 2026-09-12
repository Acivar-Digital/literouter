import { describe, expect, it, beforeEach } from "bun:test";
import {
  MAX_LEG_BYTES,
  MAX_TOTAL_BYTES,
  MAX_TRACES,
  type SanitizedTrace,
  TraceRingBuffer,
  traceBuffer,
} from "../../../src/telemetry/ring_buffer";

function createTrace(id: string, overrides: Partial<SanitizedTrace> = {}): SanitizedTrace {
  return {
    reqId: id,
    createdAt: Date.now(),
    provider: "zen",
    model: "big-pickle",
    status: 200,
    durationMs: 100,
    ttftMs: 30,
    tokensPrompt: 15,
    tokensCompletion: 20,
    legs: {
      clientInbound: '{"prompt":"test"}',
      upstreamOutbound: '{"prompt":"test"}',
      upstreamInbound: '{"choices":[]}',
      clientOutbound: '{"choices":[]}',
    },
    ...overrides,
  };
}

describe("TraceRingBuffer", () => {
  beforeEach(() => {
    traceBuffer.clear();
  });

  it("exports default singleton traceBuffer with default limits", () => {
    expect(traceBuffer).toBeInstanceOf(TraceRingBuffer);
    expect(traceBuffer.maxTraces).toBe(MAX_TRACES);
    expect(traceBuffer.maxTotalBytes).toBe(MAX_TOTAL_BYTES);
    expect(traceBuffer.maxLegBytes).toBe(MAX_LEG_BYTES);
    expect(traceBuffer.size()).toBe(0);
    expect(traceBuffer.byteSize()).toBe(0);
  });

  it("stores and retrieves traces by reqId with get()", () => {
    const buffer = new TraceRingBuffer();
    const trace = createTrace("req-001");
    buffer.push(trace);

    expect(buffer.size()).toBe(1);
    expect(buffer.get("req-001")).toEqual(trace);
    expect(buffer.get("non-existent")).toBeUndefined();
  });

  it("enforces FIFO eviction when exceeding MAX_TRACES (100 items)", () => {
    const buffer = new TraceRingBuffer();

    for (let i = 1; i <= 105; i++) {
      buffer.push(createTrace(`req-${i}`));
    }

    expect(buffer.size()).toBe(100);
    // Oldest 5 (req-1 through req-5) should be evicted
    for (let i = 1; i <= 5; i++) {
      expect(buffer.get(`req-${i}`)).toBeUndefined();
    }
    // Items req-6 through req-105 should be present
    for (let i = 6; i <= 105; i++) {
      expect(buffer.get(`req-${i}`)).toBeDefined();
    }
  });

  it("enforces memory constraint eviction under large synthetic payloads", () => {
    // Buffer with small total byte cap to verify memory-driven FIFO eviction
    const maxTotalBytes = 5000;
    const buffer = new TraceRingBuffer({ maxTotalBytes });

    // Each trace with 1000 bytes payload across legs + 512 overhead = ~1512 bytes
    const legPayload = "a".repeat(250); // 4 legs * 250 = 1000 chars
    const t1 = createTrace("t1", {
      legs: {
        clientInbound: legPayload,
        upstreamOutbound: legPayload,
        upstreamInbound: legPayload,
        clientOutbound: legPayload,
      },
    });
    const t2 = createTrace("t2", {
      legs: {
        clientInbound: legPayload,
        upstreamOutbound: legPayload,
        upstreamInbound: legPayload,
        clientOutbound: legPayload,
      },
    });
    const t3 = createTrace("t3", {
      legs: {
        clientInbound: legPayload,
        upstreamOutbound: legPayload,
        upstreamInbound: legPayload,
        clientOutbound: legPayload,
      },
    });

    buffer.push(t1);
    buffer.push(t2);
    buffer.push(t3);

    // With ~1512 bytes each, 3 traces ~ 4536 bytes <= 5000 bytes
    expect(buffer.size()).toBe(3);
    expect(buffer.byteSize()).toBeLessThanOrEqual(maxTotalBytes);

    // Pushing t4 should cause t1 to be evicted to remain under 5000 bytes
    const t4 = createTrace("t4", {
      legs: {
        clientInbound: legPayload,
        upstreamOutbound: legPayload,
        upstreamInbound: legPayload,
        clientOutbound: legPayload,
      },
    });
    buffer.push(t4);

    expect(buffer.get("t1")).toBeUndefined();
    expect(buffer.get("t2")).toBeDefined();
    expect(buffer.get("t3")).toBeDefined();
    expect(buffer.get("t4")).toBeDefined();
    expect(buffer.byteSize()).toBeLessThanOrEqual(maxTotalBytes);
  });

  it("truncates leg payloads exceeding MAX_LEG_BYTES (64KB)", () => {
    const buffer = new TraceRingBuffer();
    const oversizedLength = 65 * 1024; // 65KB
    const oversizedString = "x".repeat(oversizedLength);

    const trace = createTrace("req-oversized", {
      legs: {
        clientInbound: oversizedString,
        upstreamOutbound: "normal",
        upstreamInbound: oversizedString,
        clientOutbound: "normal",
      },
    });

    buffer.push(trace);

    const stored = buffer.get("req-oversized")!;
    expect(stored).toBeDefined();

    const expectedSuffix = `\n... [TRUNCATED: original ${oversizedLength} bytes]`;
    expect(stored.legs.clientInbound.startsWith("x".repeat(MAX_LEG_BYTES))).toBe(true);
    expect(stored.legs.clientInbound.endsWith(expectedSuffix)).toBe(true);
    expect(stored.legs.upstreamInbound.startsWith("x".repeat(MAX_LEG_BYTES))).toBe(true);
    expect(stored.legs.upstreamInbound.endsWith(expectedSuffix)).toBe(true);
    expect(stored.legs.upstreamOutbound).toBe("normal");
    expect(stored.legs.clientOutbound).toBe("normal");
  });

  it("supports getRecent(n) returning newest traces in reverse chronological order", () => {
    const buffer = new TraceRingBuffer();
    buffer.push(createTrace("req-1"));
    buffer.push(createTrace("req-2"));
    buffer.push(createTrace("req-3"));

    const recent2 = buffer.getRecent(2);
    expect(recent2.map((t) => t.reqId)).toEqual(["req-3", "req-2"]);

    const recentAll = buffer.getRecent(10);
    expect(recentAll.map((t) => t.reqId)).toEqual(["req-3", "req-2", "req-1"]);

    expect(buffer.getRecent(0)).toEqual([]);
    expect(buffer.getRecent(-5)).toEqual([]);
  });

  it("supports getErrors(n) returning newest error traces with status >= 400", () => {
    const buffer = new TraceRingBuffer();
    buffer.push(createTrace("req-ok-1", { status: 200 }));
    buffer.push(createTrace("req-err-1", { status: 429 }));
    buffer.push(createTrace("req-ok-2", { status: 200 }));
    buffer.push(createTrace("req-err-2", { status: 500 }));
    buffer.push(createTrace("req-err-3", { status: 400 }));

    const errors = buffer.getErrors(2);
    expect(errors.map((t) => t.reqId)).toEqual(["req-err-3", "req-err-2"]);

    const allErrors = buffer.getErrors(10);
    expect(allErrors.map((t) => t.reqId)).toEqual(["req-err-3", "req-err-2", "req-err-1"]);

    expect(buffer.getErrors(0)).toEqual([]);
    expect(buffer.getErrors(-1)).toEqual([]);
  });

  it("handles duplicate reqId push cleanly by updating trace without duplicating in order", () => {
    const buffer = new TraceRingBuffer();
    buffer.push(createTrace("req-dup", { status: 200, durationMs: 50 }));
    const initialByteSize = buffer.byteSize();

    buffer.push(createTrace("req-dup", { status: 500, durationMs: 150 }));

    expect(buffer.size()).toBe(1);
    expect(buffer.get("req-dup")?.status).toBe(500);
    expect(buffer.get("req-dup")?.durationMs).toBe(150);
    expect(buffer.getRecent(5).map((t) => t.reqId)).toEqual(["req-dup"]);
    expect(buffer.byteSize()).toBe(initialByteSize);
  });

  it("clears all traces and resets bytes on clear()", () => {
    const buffer = new TraceRingBuffer();
    buffer.push(createTrace("req-1"));
    buffer.push(createTrace("req-2"));

    expect(buffer.size()).toBe(2);
    expect(buffer.byteSize()).toBeGreaterThan(0);

    buffer.clear();

    expect(buffer.size()).toBe(0);
    expect(buffer.byteSize()).toBe(0);
    expect(buffer.get("req-1")).toBeUndefined();
    expect(buffer.getRecent(5)).toEqual([]);
    expect(buffer.getErrors(5)).toEqual([]);
  });
});
