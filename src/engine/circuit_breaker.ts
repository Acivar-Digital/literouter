import type { CircuitBreakerConfig } from "../config/schema";

export type CircuitBreakerState = "CLOSED" | "OPEN" | "HALF_OPEN";

export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
  enabled: true,
  failure_threshold: 5,
  failure_window_ms: 60000,
  open_duration_ms: 30000,
  half_open_max_probes: 2,
  success_threshold_to_close: 2,
};

function isStatusFailure(status: number): boolean {
  if (status === 0) {
    return true;
  }
  if (status >= 520 && status <= 526) {
    return true;
  }
  return status === 500 || status === 502 || status === 503 || status === 504;
}

export function isCircuitBreakerFailure(status: number | Error): boolean {
  if (status instanceof Error) {
    return true;
  }
  if (typeof status !== "number") {
    return false;
  }
  return isStatusFailure(status);
}

export class CircuitBreaker {
  public readonly config: CircuitBreakerConfig;
  private state: CircuitBreakerState = "CLOSED";
  private failureTimestamps: number[] = [];
  private openStartedAt = 0;
  private activeProbes = 0;
  private consecutiveSuccesses = 0;

  constructor(
    public readonly providerCode: string,
    config?: Partial<CircuitBreakerConfig>,
    private readonly clock: () => number = Date.now
  ) {
    this.config = { ...DEFAULT_CIRCUIT_BREAKER_CONFIG, ...config };
  }

  private now(): number {
    return this.clock();
  }

  private pruneFailures(now: number): void {
    const windowStart = now - this.config.failure_window_ms;
    this.failureTimestamps = this.failureTimestamps.filter((t) => t >= windowStart);
  }

  private transitionToHalfOpen(): void {
    this.state = "HALF_OPEN";
    this.activeProbes = 0;
    this.consecutiveSuccesses = 0;
  }

  private transitionToOpen(now: number): void {
    this.state = "OPEN";
    this.openStartedAt = now;
    this.activeProbes = 0;
    this.consecutiveSuccesses = 0;
  }

  private transitionToClosed(): void {
    this.state = "CLOSED";
    this.failureTimestamps = [];
    this.activeProbes = 0;
    this.consecutiveSuccesses = 0;
  }

  private refreshState(now: number): CircuitBreakerState {
    if (!this.config.enabled) {
      this.state = "CLOSED";
      return "CLOSED";
    }
    if (this.state === "OPEN" && now - this.openStartedAt >= this.config.open_duration_ms) {
      this.transitionToHalfOpen();
    }
    return this.state;
  }

  public getState(): CircuitBreakerState {
    return this.refreshState(this.now());
  }

  public isOpen(): boolean {
    if (!this.config.enabled) {
      return false;
    }
    return this.refreshState(this.now()) === "OPEN";
  }

  public canProbe(): boolean {
    if (!this.config.enabled) {
      return true;
    }
    if (this.refreshState(this.now()) !== "HALF_OPEN") {
      return false;
    }
    if (this.activeProbes >= this.config.half_open_max_probes) {
      return false;
    }
    this.activeProbes += 1;
    return true;
  }

  private releaseProbe(): void {
    if (this.state === "HALF_OPEN") {
      this.activeProbes = Math.max(0, this.activeProbes - 1);
    }
  }

  public recordSuccess(): void {
    if (!this.config.enabled || this.refreshState(this.now()) !== "HALF_OPEN") {
      return;
    }
    this.activeProbes = Math.max(0, this.activeProbes - 1);
    this.consecutiveSuccesses += 1;
    if (this.consecutiveSuccesses >= this.config.success_threshold_to_close) {
      this.transitionToClosed();
    }
  }

  private handleClosedFailure(now: number): void {
    this.pruneFailures(now);
    this.failureTimestamps.push(now);
    if (this.failureTimestamps.length >= this.config.failure_threshold) {
      this.transitionToOpen(now);
    }
  }

  public recordFailure(status: number | Error): void {
    if (!this.config.enabled) {
      return;
    }
    if (!isCircuitBreakerFailure(status)) {
      this.releaseProbe();
      return;
    }

    const now = this.now();
    const currentState = this.refreshState(now);
    if (currentState === "HALF_OPEN") {
      this.transitionToOpen(now);
      return;
    }
    if (currentState === "CLOSED") {
      this.handleClosedFailure(now);
    }
  }

  public rejectResponse(providerName: string): Response {
    const now = this.now();
    const remainingMs = Math.max(0, this.openStartedAt + this.config.open_duration_ms - now);
    const retryAfterSec = Math.ceil(remainingMs / 1000);

    return new Response(
      JSON.stringify({
        error: {
          code: "circuit_breaker_open",
          message: `Provider ${providerName} circuit breaker is open. Retry after ${remainingMs}ms.`,
          type: "service_unavailable",
        },
      }),
      {
        status: 503,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfterSec),
        },
      }
    );
  }

  public getFailureCount(): number {
    this.pruneFailures(this.now());
    return this.failureTimestamps.length;
  }

  public getActiveProbes(): number {
    return this.activeProbes;
  }

  public getConsecutiveSuccesses(): number {
    return this.consecutiveSuccesses;
  }

  public reset(): void {
    this.transitionToClosed();
    this.openStartedAt = 0;
  }
}

const breakerRegistry = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(
  providerCode: string,
  config?: CircuitBreakerConfig
): CircuitBreaker {
  const norm = providerCode.toLowerCase();
  let breaker = breakerRegistry.get(norm);
  if (!breaker) {
    breaker = new CircuitBreaker(norm, config);
    breakerRegistry.set(norm, breaker);
  }
  return breaker;
}

export function resetCircuitBreakers(): void {
  breakerRegistry.clear();
}
