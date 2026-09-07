export interface TokenUsageMetrics {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens?: number;
  readonly totalTokens: number;
  readonly durationMs: number;
  readonly tokensPerSecond?: number;
}

export interface RequestTrace {
  readonly reqId: string;
  readonly timestamp: string;
  readonly inbound: {
    readonly method: string;
    readonly url: string;
    readonly headers: Record<string, string>;
    readonly body?: unknown;
  };
  readonly directive?: unknown;
  readonly provider?: string;
  readonly model?: string;
  readonly outbound?: {
    readonly url: string;
    readonly status: number;
    readonly durationMs: number;
    readonly ttftMs?: number;
  };
  readonly usage?: TokenUsageMetrics;
  readonly error?: string;
}

export class TelemetrySink {
  private static readonly ttftStore = new Map<string, number>();

  public static recordTtft(reqId: string, ttftMs: number): void {
    this.ttftStore.set(reqId, ttftMs);
  }

  public static getTtft(reqId: string): number | undefined {
    return this.ttftStore.get(reqId);
  }

  public static clearTtft(reqId: string): void {
    this.ttftStore.delete(reqId);
  }

  public static calculateTokPerSec(tokens: number, durationMs: number): number {
    if (durationMs <= 0) {
      return 0;
    }
    const sec = durationMs / 1000;
    return Number.parseFloat((tokens / sec).toFixed(1));
  }
}
