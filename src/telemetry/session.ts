import { getProviderDisplayName } from "../config/providers";
import {
  EMOJI,
  formatTimestamp,
  formatTokenNumber,
  getHttpStatusText,
  getWireDisplayName,
} from "../ui/logger";
import { type MetricsHook, noopMetrics } from "./hooks";

export interface TelemetryInit {
  readonly reqId: string;
  readonly method: string;
  readonly path: string;
  readonly clientAgent: string;
  readonly protocol?: string;
  readonly directiveStr?: string;
  readonly targetProvider?: string;
  readonly wireFormat?: string;
  readonly endpoint?: string;
  readonly model?: string;
  readonly keyIndex?: number;
  readonly totalKeys?: number;
  readonly nuances?: readonly string[];
  readonly referrer?: string;
  readonly metricsHook?: MetricsHook;
}

export interface UsageRecord {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
  readonly finishReason?: string | null;
}

export interface RotateKeyInfo {
  readonly fromIndex: number;
  readonly toIndex: number;
  readonly totalKeys?: number;
  readonly attempt?: number;
  readonly maxAttempts?: number;
}

export interface RecordLimitInfo {
  readonly status: number;
  readonly retryAfterSec?: number;
  readonly totalKeys?: number;
  readonly rawMessage?: string;
}

export interface TraceMetrics {
  readonly reqId: string;
  readonly provider: string;
  readonly model: string;
  readonly durationMs: number;
  readonly ttftMs?: number;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  readonly totalTokens?: number;
}

function buildSpeedString(durationMs: number, completionTokens: number): string {
  if (durationMs <= 0 || completionTokens <= 0) {
    return "";
  }
  const sec = durationMs / 1000;
  const speed = (completionTokens / sec).toFixed(1);
  return ` | Speed=${speed} tok/s`;
}

export class RequestTelemetry {
  private readonly startTime: number = performance.now();
  private firstTokenTime?: number;
  public readonly reqId: string;
  private readonly providerCode: string;
  private currentKeyIndex?: number;
  private totalKeys?: number;
  private readonly metrics: MetricsHook;
  private lastUsage?: UsageRecord;
  private status?: number;

  constructor(private readonly init: TelemetryInit) {
    this.reqId = init.reqId;
    this.providerCode = init.targetProvider ?? "unknown";
    this.currentKeyIndex = init.keyIndex;
    this.totalKeys = init.totalKeys;
    this.metrics = init.metricsHook ?? noopMetrics;
  }

  // ── Lifecycle Methods ──

  /** Called once at request receipt. Emits inbound banner. */
  emitInbound(): void {
    const ts = formatTimestamp();
    const d = this.init;
    const client = d.clientAgent || "Unknown";
    const protoStr = d.protocol ? ` [${d.protocol}]` : "";
    console.log(`${EMOJI.inbound} ${ts} [${d.reqId}] Inbound ${d.method} ${d.path}${protoStr} from ${client}`);

    if (d.directiveStr) {
      const target = d.targetProvider ? getProviderDisplayName(d.targetProvider) : "Direct";
      const wire = d.wireFormat ? getWireDisplayName(d.wireFormat) : "OpenAI";
      const ep = d.endpoint ? ` | EP: ${d.endpoint}` : "";
      console.log(`${EMOJI.directive} ${ts} [${d.reqId}] Directive: ${d.directiveStr} -> Target: ${target} | Wire: ${wire}${ep}`);
    }

    if (d.model) {
      this.emitInboundModelLine(ts);
    }

    this.metrics.onRequestStart(this.reqId, this.providerCode, this.init.model ?? "unknown");
  }

  private emitInboundModelLine(ts: string): void {
    const provLabel = this.init.targetProvider ? getProviderDisplayName(this.init.targetProvider) : "Provider";
    let keyInfo = "";
    if (this.currentKeyIndex !== undefined) {
      const keyIdx = this.currentKeyIndex + 1;
      const keyTotal = this.totalKeys !== undefined ? `/${this.totalKeys}` : "";
      keyInfo = ` | Key: ${provLabel} [Key #${keyIdx}${keyTotal}]`;
    } else if (this.totalKeys !== undefined) {
      keyInfo = ` | Pool: ${provLabel} (${this.totalKeys} ${this.totalKeys === 1 ? "key" : "keys"})`;
    }

    const nuances = this.init.nuances;
    const nuanceInfo = nuances && nuances.length > 0 && nuances[0] !== "no"
      ? ` | Nuances: [${nuances.join(", ")}]`
      : "";
    const refInfo = this.init.referrer ? ` | Ref: ${this.init.referrer.split(" @ ")[0]}` : "";
    console.log(`${EMOJI.model} ${ts} [${this.reqId}] Model: ${this.init.model}${keyInfo}${nuanceInfo}${refInfo}`);
  }

  /** Called on key rotation. Updates internal key index. */
  rotateKey(info: RotateKeyInfo): void {
    this.currentKeyIndex = info.toIndex;
    if (info.totalKeys !== undefined) {
      this.totalKeys = info.totalKeys;
    }

    const ts = formatTimestamp();
    const provName = getProviderDisplayName(this.providerCode);
    const total = info.totalKeys ?? this.totalKeys;
    const totalStr = total !== undefined ? `/${total}` : "";
    const attemptStr = info.attempt && info.maxAttempts ? ` (Attempt ${info.attempt}/${info.maxAttempts})` : "";
    console.log(`${EMOJI.rotate} ${ts} [ROTATE ${this.reqId}] Advancing to ${provName} [Key #${info.toIndex + 1}${totalStr}] -> Retrying immediately${attemptStr}`);

    this.metrics.onKeyRotation(this.reqId, this.providerCode, info.fromIndex, info.toIndex);
  }

  /** Called on upstream rate limit or quota. */
  recordLimit(info: RecordLimitInfo): void {
    const ts = formatTimestamp();
    const provName = getProviderDisplayName(this.providerCode);
    const keyIdx = this.currentKeyIndex !== undefined ? this.currentKeyIndex : 0;
    const total = info.totalKeys ?? this.totalKeys;
    const keyTotal = total !== undefined ? `/${total}` : "";
    const statusText = getHttpStatusText(info.status);

    console.warn(`${EMOJI.limit} ${ts} [LIMIT ${this.reqId}] ${provName} [Key #${keyIdx + 1}${keyTotal}] returned ${statusText}`);
    if (info.retryAfterSec) {
      console.warn(`${EMOJI.limit} ${ts} [LIMIT ${this.reqId}] Parsed Retry-After: ${info.retryAfterSec}s -> Quarantined Key #${keyIdx + 1} for ${info.retryAfterSec}s`);
    }
    if (info.rawMessage) {
      console.warn(`${EMOJI.limit} ${ts} [LIMIT ${this.reqId}] Upstream Error: "${info.rawMessage.slice(0, 300)}"`);
    }
  }

  /** Called on first SSE chunk received. Idempotent (ignores subsequent calls). */
  markTtft(protocol?: string, details = "First chunk streamed downstream"): void {
    if (this.firstTokenTime !== undefined) {
      return;
    }
    this.firstTokenTime = performance.now();
    const ttftMs = this.getTtftMs() ?? 0;
    const ts = formatTimestamp();
    const protoStr = protocol ? ` [Upstream: ${protocol}]` : "";
    console.log(`${EMOJI.ttft} ${ts} [TTFT ${this.reqId}] TTFT = ${ttftMs}ms | ${details}${protoStr}`);
  }

  /** Called when tokens are extracted from response. Computes speed, emits usage. */
  recordUsage(record: UsageRecord): void {
    this.lastUsage = record;
    const ts = formatTimestamp();
    const provName = getProviderDisplayName(this.providerCode);
    const keyIdx = this.currentKeyIndex !== undefined ? this.currentKeyIndex + 1 : 1;
    const totalKeysStr = this.totalKeys !== undefined ? `/${this.totalKeys}` : "";

    const durationMs = this.getDurationMs();
    const speedStr = buildSpeedString(durationMs, record.completionTokens);

    const reasoningStr = record.reasoningTokens && record.reasoningTokens > 0
      ? ` | Reasoning=${formatTokenNumber(record.reasoningTokens)}`
      : "";

    const totalTokens = record.totalTokens ?? (record.promptTokens + record.completionTokens);

    console.log(`${EMOJI.usage} ${ts} [USAGE ${this.reqId}] ${provName} (Key #${keyIdx}${totalKeysStr})`);
    console.log(
      `${EMOJI.tokens} ${ts} [USAGE ${this.reqId}] Tokens: Prompt=${formatTokenNumber(record.promptTokens)}${reasoningStr} | Completion=${formatTokenNumber(record.completionTokens)} | Total=${formatTokenNumber(totalTokens)}${speedStr}`
    );

    if (record.finishReason === "length") {
      console.warn(`${EMOJI.finishTrunc} ${ts} [FINISH ${this.reqId}] Upstream token truncation occurred (finish_reason=length)`);
    }
  }

  /** Called at response completion. Emits served banner with total duration. */
  served(status = 200, attempt?: number, maxAttempts?: number): void {
    this.status = status;
    const durationMs = this.getDurationMs();
    const ts = formatTimestamp();
    const attemptStr = attempt && maxAttempts && maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "";
    const icon = status >= 400 ? EMOJI.servedErr : EMOJI.servedOk;

    if (status >= 400) {
      console.warn(`${icon} ${ts} [SERVED ${this.reqId}] HTTP ${status} in ${durationMs}ms${attemptStr}`);
    } else {
      console.log(`${icon} ${ts} [SERVED ${this.reqId}] HTTP ${status} in ${durationMs}ms${attemptStr}`);
    }

    this.metrics.onRequestEnd(this.reqId, status, durationMs, this.getTtftMs());
  }

  /** Called on error. */
  error(message: string, err?: unknown): void {
    this.status = 500;
    const durationMs = this.getDurationMs();
    const ts = formatTimestamp();
    const errDetail = err instanceof Error ? ` - ${err.message}` : "";
    console.error(`${EMOJI.error} ${ts} [ERROR ${this.reqId}] ${message}${errDetail}`);
    this.metrics.onRequestEnd(this.reqId, 500, durationMs, this.getTtftMs());
  }

  // ── Derived Metrics ──

  /** Returns TTFT in ms, or undefined if no first token received. */
  getTtftMs(): number | undefined {
    return this.firstTokenTime !== undefined
      ? Math.round(this.firstTokenTime - this.startTime)
      : undefined;
  }

  /** Returns total request duration in ms. */
  getDurationMs(): number {
    return Math.round(performance.now() - this.startTime);
  }

  /** Returns structured snapshot for trace storage. */
  toTraceMetrics(): TraceMetrics {
    return {
      reqId: this.reqId,
      provider: this.providerCode,
      model: this.init.model ?? "unknown",
      durationMs: this.getDurationMs(),
      ttftMs: this.getTtftMs(),
      ...(this.lastUsage ? {
        promptTokens: this.lastUsage.promptTokens,
        completionTokens: this.lastUsage.completionTokens,
        totalTokens: this.lastUsage.totalTokens ?? (this.lastUsage.promptTokens + this.lastUsage.completionTokens),
      } : {}),
    };
  }
}
