import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetEnvCache } from "../../../src/config/env";
import {
  initProviderRegistry,
  getProviderConfig,
} from "../../../src/config/providers";
import { ProvidersConfigSchema } from "../../../src/config/schema";
import type { ParsedDirective } from "../../../src/directive/types";
import {
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  getCircuitBreaker,
  resetCircuitBreakers,
} from "../../../src/engine/circuit_breaker";
import {
  executeDispatchPipeline,
  type DispatchRequest,
  type OutboundWirePayload,
  type PayloadTransformerContract,
} from "../../../src/engine/dispatch";
import {
  getStrategy,
  initStrategyRegistry,
  resetStrategyRegistry,
} from "../../../src/engine/strategy_registry";
import { GcpGuardedStrategy } from "../../../src/engine/strategies/gcp_guarded";
import { NativeCascadeStrategy } from "../../../src/engine/strategies/native_cascade";
import { StandardStrategy } from "../../../src/engine/strategies/standard";
import { ZenSingleFlightStrategy } from "../../../src/engine/strategies/zen_single_flight";
import { globalKeyPool } from "../../../src/handlers/openai_compat";
import { handleAppRequest, resetAllState } from "../../../src/index";

const STUB_KEY_1 = "sk-test-stub-0001-padded-to-look-like-real";
const STUB_KEY_2 = "sk-test-stub-0002-padded-to-look-like-real";

const mockDirective: ParsedDirective = {
  type: "direct",
  raw: "lr-or-oa-ch-no",
  provider: "or",
  payload: "oa",
  wire: "oa",
  completion: "ch",
  endpoint: "ch",
  nuances: ["no"],
};

const mockTransformer: PayloadTransformerContract = {
  transformClientToWire(body) {
    return {
      endpointKey: "ch",
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      isStreaming: false,
    };
  },
  transformWireToClient(upstreamJson) {
    return { transformed: upstreamJson };
  },
  createWireToClientStream() {
    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
    });
  },
};

function buildRequest(overrides?: Partial<DispatchRequest>): DispatchRequest {
  const outbound: OutboundWirePayload = {
    endpointKey: "ch",
    method: "POST",
    headers: { "content-type": "application/json" },
    body: { model: "test-model", messages: [{ role: "user", content: "hi" }] },
    isStreaming: false,
  };

  return {
    reqId: "test-req-batch1",
    method: "POST",
    path: "/v1/chat/completions",
    directive: mockDirective,
    rawInboundBody: { model: "test-model" },
    outboundPayload: outbound,
    clientSignal: new AbortController().signal,
    clientHeaders: new Headers({ "user-agent": "OpenCode/1.0" }),
    transformer: mockTransformer,
    ...overrides,
  };
}

describe("Batch1 Regression — strategy / probe-cap / TTFT / auth-negative", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetAllState();
    resetEnvCache();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    resetEnvCache();
    resetAllState();
  });

  it("B2: unknown strategy fails loud with its name — schema rejects it, all valid strategies init cleanly", () => {
    // Boundary 1 (reachable): the config layer rejects unknown strategy names
    // and preserves the offending name in the rejection (fails loud, never silent).
    const bad = {
      providers: {
        bogus: {
          code: "zz",
          base_url: "http://127.0.0.1:9/",
          endpoints: { ch: "/chat" },
          strategy: "bogus_strat_xyz",
        },
      },
    };
    const parsed = ProvidersConfigSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(JSON.stringify(parsed.error.issues)).toContain("bogus_strat_xyz");
    }

    // Boundary 2: every schema-admissible strategy resolves to a factory, so
    // initStrategyRegistry() never throws for valid configs. NOTE: the
    // `Unknown strategy ... for provider ...` throw in strategy_registry.ts
    // is unreachable via public API by design — zod admits only the 5 known
    // strategies and init re-registers their default factories first
    // (see strategy.test.ts "gracefully falls back" precedent).
    resetStrategyRegistry();
    initProviderRegistry();
    expect(() => initStrategyRegistry()).not.toThrow();
    expect(getStrategy("or")).toBeInstanceOf(StandardStrategy);
    expect(getStrategy("gg")).toBeInstanceOf(NativeCascadeStrategy);
    expect(getStrategy("gc")).toBeInstanceOf(GcpGuardedStrategy);
    expect(getStrategy("zn")).toBeInstanceOf(ZenSingleFlightStrategy);
  });

  it("B3: over-cap half-open probes get 503 without consuming fetch", async () => {
    console.log(
      "🧪 [TEST SIMULATION] Executing resilience gate test: exhausting half-open probes to verify 503 short-circuit without upstream fetch..."
    );
    resetCircuitBreakers();
    resetStrategyRegistry();
    initProviderRegistry();
    initStrategyRegistry();
    globalKeyPool.reset();
    globalKeyPool.setPool("or", [STUB_KEY_1, STUB_KEY_2]);

    const breaker = getCircuitBreaker("or", {
      ...DEFAULT_CIRCUIT_BREAKER_CONFIG,
      failure_threshold: 2,
      open_duration_ms: 1,
      half_open_max_probes: 1,
    });
    breaker.recordFailure(500);
    breaker.recordFailure(500);
    expect(breaker.isOpen()).toBe(true);

    await Bun.sleep(15);
    expect(breaker.getState()).toBe("HALF_OPEN");

    // Consume the single allowed probe so the dispatch-time probe is over cap.
    expect(breaker.canProbe()).toBe(true);

    let fetchCalled = false;
    const fetchFn = async () => {
      fetchCalled = true;
      return new Response("OK", { status: 200 });
    };

    const res = await executeDispatchPipeline(buildRequest(), fetchFn);
    expect(res.status).toBe(503);
    expect(fetchCalled).toBe(false);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("breaker_open");
  });

  it("B4: TTFT timeout releases slot via retryable path ending 504", async () => {
    console.log(
      "🧪 [TEST SIMULATION] Executing resilience gate test: hanging upstream to trigger TTFT guard through the retryable path to 504..."
    );
    process.env.LITEROUTER_TTFT_TIMEOUT_MS = "25";
    resetEnvCache();
    resetAllState();
    globalKeyPool.reset();
    globalKeyPool.setPool("or", [STUB_KEY_1, STUB_KEY_2]);

    const maxAttempts = getProviderConfig("or").request_retry.max_attempts;
    expect(maxAttempts).toBeGreaterThan(1);

    let fetchCount = 0;
    const fetchFn = async (
      _url: string | URL | Request,
      init?: RequestInit
    ): Promise<Response> => {
      fetchCount += 1;
      await new Promise<never>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) {
          reject(new DOMException("The operation was aborted.", "AbortError"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("The operation was aborted.", "AbortError")),
          { once: true }
        );
      });
      throw new Error("unreachable: TTFT guard must abort hanging fetch");
    };

    const res = await executeDispatchPipeline(buildRequest(), fetchFn);
    expect(res.status).toBe(504);
    expect(fetchCount).toBe(maxAttempts);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("ttft_timeout");
  });

  it("trace: empty and garbage directive keys return 401", async () => {
    process.env.LITEROUTER_ENGINE = "legacy";
    resetEnvCache();
    resetAllState();

    const emptyRes = await handleAppRequest(new Request("http://localhost:7766/v1/models"));
    expect(emptyRes.status).toBe(401);
    const emptyBody = (await emptyRes.json()) as {
      error: { code: string; message: string };
    };
    expect(emptyBody.error.code).toBe("invalid_api_key");
    expect(emptyBody.error.message).toContain("Missing API key directive");

    const garbageRes = await handleAppRequest(
      new Request("http://localhost:7766/v1/models", {
        headers: { Authorization: "Bearer garbage-key" },
      })
    );
    expect(garbageRes.status).toBe(401);
    const garbageBody = (await garbageRes.json()) as {
      error: { code: string; message: string };
    };
    expect(garbageBody.error.code).toBe("invalid_api_key");
    expect(garbageBody.error.message).toContain("Invalid API key directive");
  });
});
