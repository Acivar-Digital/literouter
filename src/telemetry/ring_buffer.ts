export interface SanitizedTrace {
  reqId: string;
  createdAt: number;
  provider: string;
  model: string;
  status: number;
  durationMs: number;
  ttftMs?: number;
  tokensPrompt?: number;
  tokensCompletion?: number;
  legs: {
    clientInbound: string;    // Sanitized JSON, max 64KB
    upstreamOutbound: string;
    upstreamInbound: string;
    clientOutbound: string;
  };
}

export const MAX_TRACES = 100;
export const MAX_TOTAL_BYTES = 32 * 1024 * 1024;  // 32MB
export const MAX_LEG_BYTES = 64 * 1024;            // 64KB per leg

const LEG_KEYS = [
  "clientInbound",
  "upstreamOutbound",
  "upstreamInbound",
  "clientOutbound",
] as const;

export interface TraceRingBufferOptions {
  maxTraces?: number;
  maxTotalBytes?: number;
  maxLegBytes?: number;
}

export function estimateTraceSize(trace: SanitizedTrace): number {
  const cIn = trace.legs?.clientInbound?.length ?? 0;
  const uOut = trace.legs?.upstreamOutbound?.length ?? 0;
  const uIn = trace.legs?.upstreamInbound?.length ?? 0;
  const cOut = trace.legs?.clientOutbound?.length ?? 0;
  return cIn + uOut + uIn + cOut + 512; // metadata overhead
}

export class TraceRingBuffer {
  private readonly buffer = new Map<string, SanitizedTrace>();
  private readonly order: string[] = [];
  private totalBytes = 0;

  public readonly maxTraces: number;
  public readonly maxTotalBytes: number;
  public readonly maxLegBytes: number;

  constructor(options: TraceRingBufferOptions = {}) {
    this.maxTraces = options.maxTraces ?? MAX_TRACES;
    this.maxTotalBytes = options.maxTotalBytes ?? MAX_TOTAL_BYTES;
    this.maxLegBytes = options.maxLegBytes ?? MAX_LEG_BYTES;
  }

  push(trace: SanitizedTrace): void {
    if (this.buffer.has(trace.reqId)) {
      const existing = this.buffer.get(trace.reqId);
      if (existing) {
        this.totalBytes = Math.max(0, this.totalBytes - this.estimateSize(existing));
      }
      const existingIdx = this.order.indexOf(trace.reqId);
      if (existingIdx !== -1) {
        this.order.splice(existingIdx, 1);
      }
      this.buffer.delete(trace.reqId);
    }

    // Truncate oversized legs
    for (const legKey of LEG_KEYS) {
      const leg = trace.legs[legKey];
      if (leg && leg.length > this.maxLegBytes) {
        const originalSize = leg.length;
        trace.legs[legKey] =
          leg.slice(0, this.maxLegBytes) +
          `\n... [TRUNCATED: original ${originalSize} bytes]`;
      }
    }

    const traceSize = this.estimateSize(trace);

    // Evict oldest until within bounds
    while (
      (this.buffer.size >= this.maxTraces ||
        this.totalBytes + traceSize > this.maxTotalBytes) &&
      this.order.length > 0
    ) {
      this.evictOldest();
    }

    this.buffer.set(trace.reqId, trace);
    this.order.push(trace.reqId);
    this.totalBytes += traceSize;
  }

  get(reqId: string): SanitizedTrace | undefined {
    return this.buffer.get(reqId);
  }

  getRecent(n: number): SanitizedTrace[] {
    if (n <= 0) {
      return [];
    }
    return this.order
      .slice(-n)
      .reverse()
      .map((id) => this.buffer.get(id)!)
      .filter(Boolean);
  }

  getErrors(n: number): SanitizedTrace[] {
    if (n <= 0) {
      return [];
    }
    return this.getRecent(this.order.length)
      .filter((t) => t.status >= 400)
      .slice(0, n);
  }

  clear(): void {
    this.buffer.clear();
    this.order.length = 0;
    this.totalBytes = 0;
  }

  size(): number {
    return this.buffer.size;
  }

  byteSize(): number {
    return this.totalBytes;
  }

  estimateSize(trace: SanitizedTrace): number {
    return estimateTraceSize(trace);
  }

  private evictOldest(): void {
    const id = this.order.shift();
    if (id) {
      const trace = this.buffer.get(id);
      if (trace) {
        this.totalBytes = Math.max(0, this.totalBytes - this.estimateSize(trace));
        this.buffer.delete(id);
      }
    }
  }
}

export const traceBuffer = new TraceRingBuffer();
