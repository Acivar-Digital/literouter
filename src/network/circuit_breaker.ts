export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  readonly failureThreshold: number; // e.g. 5 consecutive 5xx/529
  readonly cooldownMs: number; // e.g. 60_000ms
  readonly maxCanaryDurationMs?: number; // e.g. 60_000ms
}

export class ProviderCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private nextProbeTimeMs = 0;
  private isCanaryInFlight = false;
  private canaryLockTimestampMs = 0;
  private readonly maxCanaryDurationMs: number;

  constructor(
    public readonly providerName: string,
    private readonly config: CircuitBreakerConfig = { failureThreshold: 5, cooldownMs: 60000 }
  ) {
    this.maxCanaryDurationMs = config.maxCanaryDurationMs ?? 60000;
  }

  /**
   * Evaluates if traffic is allowed.
   * In HALF_OPEN, permits ONLY ONE concurrent canary request with a 60s expiring lease.
   */
  public isAvailable(): boolean {
    const now = Date.now();
    if (this.state === "OPEN") {
      if (now >= this.nextProbeTimeMs) {
        this.state = "HALF_OPEN";
        this.isCanaryInFlight = true;
        this.canaryLockTimestampMs = now;
        return true; // Designated single canary probe
      }
      return false; // Circuit still open
    }

    if (this.state === "HALF_OPEN") {
      // Lease check: if canary in flight has exceeded max duration, forcibly grant new lease
      const isLeaseExpired = now - this.canaryLockTimestampMs > this.maxCanaryDurationMs;
      if (!this.isCanaryInFlight || isLeaseExpired) {
        this.isCanaryInFlight = true;
        this.canaryLockTimestampMs = now;
        return true;
      }
      // Another active canary is currently testing upstream; route other calls to fallback
      return false;
    }

    return true; // CLOSED - healthy
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.state = "CLOSED";
    this.isCanaryInFlight = false;
    this.canaryLockTimestampMs = 0;
  }

  public recordFailure(isCritical5xx: boolean): void {
    if (!isCritical5xx) {
      if (this.state === "HALF_OPEN") {
        this.isCanaryInFlight = false;
        this.canaryLockTimestampMs = 0;
      }
      return;
    }

    this.failureCount += 1;
    this.isCanaryInFlight = false;
    this.canaryLockTimestampMs = 0;

    // In HALF_OPEN, a single failure immediately kicks back to OPEN with full cooldown
    if (this.state === "HALF_OPEN" || this.failureCount >= this.config.failureThreshold) {
      this.state = "OPEN";
      this.nextProbeTimeMs = Date.now() + this.config.cooldownMs;
    }
  }

  public getState(): CircuitState {
    // If state is OPEN but probe time has passed, report HALF_OPEN
    if (this.state === "OPEN" && Date.now() >= this.nextProbeTimeMs) {
      return "HALF_OPEN";
    }
    return this.state;
  }

  public getStats() {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      nextProbeTimeMs: this.nextProbeTimeMs,
      isCanaryInFlight: this.isCanaryInFlight,
    };
  }

  public reset(): void {
    this.state = "CLOSED";
    this.failureCount = 0;
    this.nextProbeTimeMs = 0;
    this.isCanaryInFlight = false;
    this.canaryLockTimestampMs = 0;
  }
}

// Global registry for provider circuit breakers
const breakerRegistry = new Map<string, ProviderCircuitBreaker>();

export function getCircuitBreakerForProvider(
  provider: string,
  config?: Partial<CircuitBreakerConfig>
): ProviderCircuitBreaker {
  let breaker = breakerRegistry.get(provider);
  if (!breaker) {
    breaker = new ProviderCircuitBreaker(provider, {
      failureThreshold: config?.failureThreshold ?? 5,
      cooldownMs: config?.cooldownMs ?? 60000,
      maxCanaryDurationMs: config?.maxCanaryDurationMs ?? 60000,
    });
    breakerRegistry.set(provider, breaker);
  }
  return breaker;
}

export function getAllCircuitBreakers(): Map<string, ProviderCircuitBreaker> {
  return breakerRegistry;
}

export function clearCircuitBreakerRegistry(): void {
  breakerRegistry.clear();
}
