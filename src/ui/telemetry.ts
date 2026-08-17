import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { logError, logTrace } from "./logger";

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

  private static ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  public static async saveTrace(trace: RequestTrace): Promise<string | null> {
    const tracesDir = resolve(process.cwd(), "logs", "traces");
    try {
      this.ensureDir(tracesDir);
      const fileName = `${trace.reqId}.json`;
      const filePath = join(tracesDir, fileName);
      const content = JSON.stringify(trace, null, 2);

      writeFileSync(filePath, content, { encoding: "utf-8", mode: 0o600 });
      chmodSync(filePath, 0o600);

      logTrace(trace.reqId, filePath);
      return filePath;
    } catch (err) {
      logError(trace.reqId, "Failed to write trace file", err);
      return null;
    }
  }
}
