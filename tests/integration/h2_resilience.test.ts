import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  clearCircuitBreakerRegistry,
  getCircuitBreakerForProvider,
} from "../../src/network/circuit_breaker";
import { clearPacerRegistry, getPacerForProvider } from "../../src/network/pacer";
import { handleAppRequest, resetAllState } from "../../src/lib";

describe("HTTP/2 & Resiliency End-to-End Integration", () => {
  beforeEach(() => {
    resetAllState();
    clearCircuitBreakerRegistry();
    clearPacerRegistry();
  });

  afterEach(() => {
    resetAllState();
    clearCircuitBreakerRegistry();
    clearPacerRegistry();
  });

  it("returns rich telemetry on /health including h2_outbound and circuit_breakers", async () => {
    // Trip one circuit breaker for testing
    const breaker = getCircuitBreakerForProvider("or");
    breaker.recordFailure(true);

    const req = new Request("http://localhost:7766/health", {
      method: "GET",
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.status).toBe("healthy");
    expect(json.h2_outbound).toBeDefined();
    expect(json.circuit_breakers).toBeDefined();
    expect(json.circuit_breakers.or).toBeDefined();
    expect(json.circuit_breakers.or.failureCount).toBe(1);
  });

  it("returns clean HTTP 429 when pacer queue is saturated", async () => {
    // Configure a small pacer for the provider
    const pacer = getPacerForProvider("nv", 0, {
      minIntervalMs: 500,
      maxQueueDepth: 1,
    });

    // Exhaust pacer tokens
    await pacer.acquire();

    // Fill queue to capacity
    pacer.acquire().catch(() => {});

    // Now send a request through LiteRouter - it should reject with clean 429
    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer lr-nv-oa-ch-no",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta/llama-3.3-70b-instruct",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeDefined();

    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe("rate_limit_exceeded");
  });

  it("fast-fails when circuit breaker is OPEN", async () => {
    const breaker = getCircuitBreakerForProvider("nv", {
      failureThreshold: 1,
      cooldownMs: 60000,
    });
    breaker.recordFailure(true); // Trip to OPEN
    expect(breaker.getState()).toBe("OPEN");

    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: "Bearer lr-nv-oa-ch-no",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta/llama-3.3-70b-instruct",
        messages: [{ role: "user", content: "Hello" }],
      }),
    });

    const res = await handleAppRequest(req);
    // When circuit breaker is open and attempts are exhausted, 503 is returned
    expect(res.status).toBe(503);
  });
});
