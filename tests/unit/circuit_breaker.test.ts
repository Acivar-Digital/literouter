import { beforeEach, describe, expect, it } from "bun:test";
import {
  clearCircuitBreakerRegistry,
  getCircuitBreakerForProvider,
  ProviderCircuitBreaker,
} from "../../src/network/circuit_breaker";

describe("Provider Circuit Breaker with Strict Canary Lease", () => {
  beforeEach(() => {
    clearCircuitBreakerRegistry();
  });

  it("starts in CLOSED state and allows traffic", () => {
    const breaker = new ProviderCircuitBreaker("test-provider", {
      failureThreshold: 3,
      cooldownMs: 1000,
    });

    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.isAvailable()).toBe(true);
  });

  it("trips to OPEN state upon reaching failure threshold of 5xx errors", () => {
    const breaker = new ProviderCircuitBreaker("test-provider", {
      failureThreshold: 3,
      cooldownMs: 500,
    });

    breaker.recordFailure(true); // 1
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.isAvailable()).toBe(true);

    breaker.recordFailure(true); // 2
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.isAvailable()).toBe(true);

    breaker.recordFailure(true); // 3 -> TRIP!
    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.isAvailable()).toBe(false);
  });

  it("does not trip for non-critical 4xx errors", () => {
    const breaker = new ProviderCircuitBreaker("test-provider", {
      failureThreshold: 3,
      cooldownMs: 1000,
    });

    breaker.recordFailure(false); // 400 Bad Request
    breaker.recordFailure(false);
    breaker.recordFailure(false);
    breaker.recordFailure(false);

    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.isAvailable()).toBe(true);
  });

  it("transitions from OPEN to HALF_OPEN after cooldown and permits exactly ONE canary probe", async () => {
    const breaker = new ProviderCircuitBreaker("test-provider", {
      failureThreshold: 2,
      cooldownMs: 50, // Short cooldown for testing
    });

    breaker.recordFailure(true);
    breaker.recordFailure(true);
    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.isAvailable()).toBe(false);

    // Wait for cooldown to expire
    await new Promise((r) => setTimeout(r, 60));

    expect(breaker.getState()).toBe("HALF_OPEN");

    // First caller gets designated as the single canary probe
    const probe1 = breaker.isAvailable();
    expect(probe1).toBe(true);

    // Subsequent concurrent callers are rejected (must use fallback)
    const probe2 = breaker.isAvailable();
    expect(probe2).toBe(false);
    const probe3 = breaker.isAvailable();
    expect(probe3).toBe(false);

    // Canary probe succeeds -> returns to CLOSED
    breaker.recordSuccess();
    expect(breaker.getState()).toBe("CLOSED");
    expect(breaker.isAvailable()).toBe(true);
  });

  it("kicks back to OPEN immediately if canary probe fails", async () => {
    const breaker = new ProviderCircuitBreaker("test-provider", {
      failureThreshold: 2,
      cooldownMs: 50,
    });

    breaker.recordFailure(true);
    breaker.recordFailure(true);
    await new Promise((r) => setTimeout(r, 60));

    expect(breaker.isAvailable()).toBe(true); // Canary lease granted

    // Canary probe encounters 500 error
    breaker.recordFailure(true);
    expect(breaker.getState()).toBe("OPEN");
    expect(breaker.isAvailable()).toBe(false);
  });

  it("recovers canary lease if canary probe times out after maxCanaryDurationMs", async () => {
    const breaker = new ProviderCircuitBreaker("test-provider", {
      failureThreshold: 1,
      cooldownMs: 20,
      maxCanaryDurationMs: 50, // 50ms lease expiration for test
    });

    breaker.recordFailure(true);
    await new Promise((r) => setTimeout(r, 30));

    // First probe acquires canary lease
    expect(breaker.isAvailable()).toBe(true);

    // Second probe immediately rejected
    expect(breaker.isAvailable()).toBe(false);

    // Wait for canary lease to expire (> 50ms)
    await new Promise((r) => setTimeout(r, 60));

    // New probe successfully acquires fresh canary lease
    expect(breaker.isAvailable()).toBe(true);
  });

  it("retrieves and registers singleton breakers correctly via helper", () => {
    const b1 = getCircuitBreakerForProvider("openrouter");
    const b2 = getCircuitBreakerForProvider("openrouter");
    expect(b1).toBe(b2);
    expect(b1.providerName).toBe("openrouter");
  });
});
