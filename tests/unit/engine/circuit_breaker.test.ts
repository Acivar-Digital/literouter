import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  CircuitBreaker,
  getCircuitBreaker,
  isCircuitBreakerFailure,
  resetCircuitBreakers,
} from "../../../src/engine/circuit_breaker";

describe("Slice 3.2: Circuit Breaker State Machine", () => {
  beforeEach(() => {
    resetCircuitBreakers();
  });

  afterEach(() => {
    resetCircuitBreakers();
  });

  describe("Initial State & Basic Transitions", () => {
    it("starts in CLOSED state and allows traffic", () => {
      const breaker = new CircuitBreaker("test-provider");
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getFailureCount()).toBe(0);
    });

    it("stays CLOSED when failures are below failure_threshold", () => {
      const breaker = new CircuitBreaker("test-provider", {
        failure_threshold: 5,
        failure_window_ms: 60000,
      });

      breaker.recordFailure(500);
      breaker.recordFailure(502);
      breaker.recordFailure(503);
      breaker.recordFailure(504);

      expect(breaker.getFailureCount()).toBe(4);
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.isOpen()).toBe(false);
    });

    it("transitions to OPEN when failures reach failure_threshold within window", () => {
      console.log(
        "🧪 [TEST SIMULATION] Executing resilience gate test: tripping circuit breaker with threshold failures..."
      );

      const breaker = new CircuitBreaker("test-provider", {
        failure_threshold: 3,
        failure_window_ms: 60000,
      });

      breaker.recordFailure(500);
      breaker.recordFailure(502);
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.isOpen()).toBe(false);

      breaker.recordFailure(503); // 3rd failure trips the breaker
      expect(breaker.getState()).toBe("OPEN");
      expect(breaker.isOpen()).toBe(true);
    });
  });

  describe("Sliding Window & Failure Pruning", () => {
    it("prunes expired failures outside failure_window_ms", () => {
      let mockTime = 100000;
      const clock = () => mockTime;

      const breaker = new CircuitBreaker(
        "test-provider",
        {
          failure_threshold: 5,
          failure_window_ms: 60000,
        },
        clock
      );

      // Record 4 failures at mockTime = 100000
      breaker.recordFailure(500);
      breaker.recordFailure(500);
      breaker.recordFailure(500);
      breaker.recordFailure(500);
      expect(breaker.getFailureCount()).toBe(4);

      // Advance time by 61 seconds (past 60s window)
      mockTime += 61000;

      // Next failure should prune previous 4 and result in failureCount = 1
      breaker.recordFailure(500);
      expect(breaker.getFailureCount()).toBe(1);
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.isOpen()).toBe(false);
    });

    it("retains failures that are still inside sliding window", () => {
      let mockTime = 100000;
      const clock = () => mockTime;

      const breaker = new CircuitBreaker(
        "test-provider",
        {
          failure_threshold: 3,
          failure_window_ms: 60000,
        },
        clock
      );

      breaker.recordFailure(500); // at t = 100000
      mockTime += 20000; // t = 120000
      breaker.recordFailure(502); // at t = 120000
      mockTime += 20000; // t = 140000 (40s after first, still within 60s)
      breaker.recordFailure(503); // at t = 140000 -> trips!

      expect(breaker.getState()).toBe("OPEN");
      expect(breaker.isOpen()).toBe(true);
    });
  });

  describe("Status Code Failure Classification", () => {
    it("explicitly excludes 429 from circuit breaker failures", () => {
      const breaker = new CircuitBreaker("test-provider", {
        failure_threshold: 2,
      });

      for (let i = 0; i < 10; i++) {
        breaker.recordFailure(429);
      }

      expect(breaker.getFailureCount()).toBe(0);
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.isOpen()).toBe(false);
      expect(isCircuitBreakerFailure(429)).toBe(false);
    });

    it("excludes 4xx client errors (400, 401, 403, 404, 422)", () => {
      const breaker = new CircuitBreaker("test-provider", {
        failure_threshold: 2,
      });

      const clientErrors = [400, 401, 403, 404, 422];
      for (const status of clientErrors) {
        breaker.recordFailure(status);
        expect(isCircuitBreakerFailure(status)).toBe(false);
      }

      expect(breaker.getFailureCount()).toBe(0);
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.isOpen()).toBe(false);
    });

    it("counts standard 5xx errors (500, 502, 503, 504) as failures", () => {
      const statuses = [500, 502, 503, 504];
      for (const status of statuses) {
        expect(isCircuitBreakerFailure(status)).toBe(true);
      }
    });

    it("counts Cloudflare errors 520 through 526 as failures", () => {
      for (let status = 520; status <= 526; status++) {
        expect(isCircuitBreakerFailure(status)).toBe(true);
      }
    });

    it("counts status 0 and Error instances (TTFT timeouts, network errors) as failures", () => {
      expect(isCircuitBreakerFailure(0)).toBe(true);
      expect(isCircuitBreakerFailure(new Error("TTFT timeout after 120000ms"))).toBe(true);
      expect(isCircuitBreakerFailure(new TypeError("Network connection refused"))).toBe(true);
    });

    it("excludes non-failure statuses like 200 and non-transient 501", () => {
      expect(isCircuitBreakerFailure(200)).toBe(false);
      expect(isCircuitBreakerFailure(501)).toBe(false);
    });
  });

  describe("Rejection Response (OPEN State)", () => {
    it("returns HTTP 503 with proper JSON payload and Retry-After header", async () => {
      let mockTime = 100000;
      const clock = () => mockTime;

      const breaker = new CircuitBreaker(
        "zen",
        {
          failure_threshold: 1,
          open_duration_ms: 30000,
        },
        clock
      );

      breaker.recordFailure(500);
      expect(breaker.isOpen()).toBe(true);

      const response = breaker.rejectResponse("Zen");
      expect(response.status).toBe(503);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(response.headers.get("Retry-After")).toBe("30");

      const body = (await response.json()) as {
        error: { code: string; message: string; type: string };
      };

      expect(body.error.code).toBe("circuit_breaker_open");
      expect(body.error.type).toBe("service_unavailable");
      expect(body.error.message).toBe(
        "Provider Zen circuit breaker is open. Retry after 30000ms."
      );
    });

    it("dynamically decreases Retry-After as time advances in OPEN state", () => {
      let mockTime = 100000;
      const clock = () => mockTime;

      const breaker = new CircuitBreaker(
        "zen",
        {
          failure_threshold: 1,
          open_duration_ms: 30000,
        },
        clock
      );

      breaker.recordFailure(500); // at t = 100000, remaining = 30000ms

      mockTime += 12500; // remaining = 17500ms
      const response = breaker.rejectResponse("Zen");
      // Math.ceil(17500 / 1000) = 18
      expect(response.headers.get("Retry-After")).toBe("18");
    });
  });

  describe("HALF_OPEN State & Probing", () => {
    it("transitions from OPEN to HALF_OPEN after open_duration_ms elapses", () => {
      let mockTime = 100000;
      const clock = () => mockTime;

      const breaker = new CircuitBreaker(
        "test-provider",
        {
          failure_threshold: 1,
          open_duration_ms: 30000,
        },
        clock
      );

      breaker.recordFailure(500);
      expect(breaker.getState()).toBe("OPEN");
      expect(breaker.isOpen()).toBe(true);

      mockTime += 29999;
      expect(breaker.getState()).toBe("OPEN");
      expect(breaker.isOpen()).toBe(true);

      mockTime += 1; // 30000ms elapsed
      expect(breaker.getState()).toBe("HALF_OPEN");
      expect(breaker.isOpen()).toBe(false);
    });

    it("permits up to half_open_max_probes in HALF_OPEN and rejects excess with 503", () => {
      let mockTime = 100000;
      const clock = () => mockTime;

      const breaker = new CircuitBreaker(
        "test-provider",
        {
          failure_threshold: 1,
          open_duration_ms: 30000,
          half_open_max_probes: 2,
        },
        clock
      );

      breaker.recordFailure(500);
      mockTime += 30000; // enter HALF_OPEN

      expect(breaker.getState()).toBe("HALF_OPEN");
      expect(breaker.canProbe()).toBe(true); // Probe 1
      expect(breaker.canProbe()).toBe(true); // Probe 2
      expect(breaker.canProbe()).toBe(false); // Exceeded max probes!

      // Extra request receives 503 reject response
      const rejected = breaker.rejectResponse("test-provider");
      expect(rejected.status).toBe(503);
    });

    it("releases probe slot on non-failure status (429 or 400) in HALF_OPEN", () => {
      let mockTime = 100000;
      const clock = () => mockTime;

      const breaker = new CircuitBreaker(
        "test-provider",
        {
          failure_threshold: 1,
          open_duration_ms: 30000,
          half_open_max_probes: 1,
        },
        clock
      );

      breaker.recordFailure(500);
      mockTime += 30000;

      expect(breaker.canProbe()).toBe(true);
      expect(breaker.canProbe()).toBe(false);

      // A 429 or 400 is not a breaker failure, so it frees the active probe
      breaker.recordFailure(429);
      expect(breaker.getState()).toBe("HALF_OPEN");
      expect(breaker.canProbe()).toBe(true);
    });

    it("transitions from HALF_OPEN to CLOSED after success_threshold_to_close successes", () => {
      let mockTime = 100000;
      const clock = () => mockTime;

      const breaker = new CircuitBreaker(
        "test-provider",
        {
          failure_threshold: 1,
          open_duration_ms: 30000,
          half_open_max_probes: 2,
          success_threshold_to_close: 2,
        },
        clock
      );

      breaker.recordFailure(500);
      mockTime += 30000;

      expect(breaker.getState()).toBe("HALF_OPEN");
      expect(breaker.canProbe()).toBe(true);
      breaker.recordSuccess(); // 1st success
      expect(breaker.getState()).toBe("HALF_OPEN");
      expect(breaker.getConsecutiveSuccesses()).toBe(1);

      expect(breaker.canProbe()).toBe(true);
      breaker.recordSuccess(); // 2nd success -> closes breaker!
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getFailureCount()).toBe(0);
      expect(breaker.getActiveProbes()).toBe(0);
    });

    it("transitions from HALF_OPEN back to OPEN immediately on a single failure and resets open timer", () => {
      let mockTime = 100000;
      const clock = () => mockTime;

      const breaker = new CircuitBreaker(
        "test-provider",
        {
          failure_threshold: 1,
          open_duration_ms: 30000,
          half_open_max_probes: 2,
        },
        clock
      );

      breaker.recordFailure(500); // t = 100000
      mockTime += 30000; // t = 130000, transitions to HALF_OPEN
      expect(breaker.getState()).toBe("HALF_OPEN");

      expect(breaker.canProbe()).toBe(true);
      mockTime += 5000; // t = 135000, probe fails with 503
      breaker.recordFailure(503);

      expect(breaker.getState()).toBe("OPEN");
      expect(breaker.isOpen()).toBe(true);

      // Must wait another 30000ms from t = 135000
      mockTime += 20000; // t = 155000 (< 165000)
      expect(breaker.getState()).toBe("OPEN");

      mockTime += 10000; // t = 165000
      expect(breaker.getState()).toBe("HALF_OPEN");
    });
  });

  describe("Special Behaviors & Registry", () => {
    it("recordSuccess() in CLOSED state is a harmless no-op", () => {
      const breaker = new CircuitBreaker("test-provider");
      expect(breaker.getState()).toBe("CLOSED");
      breaker.recordSuccess();
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.getConsecutiveSuccesses()).toBe(0);
    });

    it("config enabled: false completely bypasses breaker", () => {
      const breaker = new CircuitBreaker("test-provider", {
        enabled: false,
        failure_threshold: 1,
      });

      for (let i = 0; i < 10; i++) {
        breaker.recordFailure(500);
      }

      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.canProbe()).toBe(true);
    });

    it("reset() restores breaker to CLOSED state and clears failures", () => {
      const breaker = new CircuitBreaker("test-provider", {
        failure_threshold: 1,
      });

      breaker.recordFailure(500);
      expect(breaker.getState()).toBe("OPEN");

      breaker.reset();
      expect(breaker.getState()).toBe("CLOSED");
      expect(breaker.isOpen()).toBe(false);
      expect(breaker.getFailureCount()).toBe(0);
    });

    it("getCircuitBreaker() returns singleton per providerCode (case-insensitive)", () => {
      const b1 = getCircuitBreaker("OpenRouter");
      const b2 = getCircuitBreaker("openrouter");
      expect(b1).toBe(b2);

      b1.recordFailure(500);
      expect(b2.getFailureCount()).toBe(1);
    });

    it("resetCircuitBreakers() clears the registry", () => {
      const b1 = getCircuitBreaker("provider-a");
      resetCircuitBreakers();
      const b2 = getCircuitBreaker("provider-a");
      expect(b1).not.toBe(b2);
    });
  });
});
