export interface MetricsHook {
  onRequestStart(reqId: string, provider: string, model: string): void;
  onRequestEnd(reqId: string, status: number, durationMs: number, ttftMs?: number): void;
  onKeyRotation(reqId: string, provider: string, fromKey: number, toKey: number): void;
  onCircuitBreakerStateChange(provider: string, oldState: string, newState: string): void;
}

export const noopMetrics: MetricsHook = Object.freeze({
  onRequestStart() {},
  onRequestEnd() {},
  onKeyRotation() {},
  onCircuitBreakerStateChange() {},
});
