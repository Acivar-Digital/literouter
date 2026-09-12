import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetEnvCache } from "../../../../src/config/env";
import { ZenSingleFlightStrategy } from "../../../../src/engine/strategies/zen_single_flight";
import type { DispatchContext } from "../../../../src/engine/strategy";

function createMockContext(): DispatchContext {
  return {
    reqId: "req-zen-123",
    directive: {
      provider: "zn",
      payload: "oa",
      completion: "ch",
      nuance: "no",
      model: "big-pickle",
    } as any,
    providerConfig: {
      code: "zn",
      name: "Zen",
      env_key: "ZEN_API_KEYS",
      strategy: "zen_single_flight",
      base_url: "https://opencode.ai/zen",
      auth_header: "Bearer",
      endpoints: {
        ch: "/api/v1/chat/completions",
      },
    } as any,
    telemetry: {} as any,
    clientSignal: new AbortController().signal,
    selectedKey: { key: "zen-token", index: 0, poolSize: 1 },
    attempt: 1,
    maxAttempts: 3,
  };
}

describe("Slice 3.4: ZenSingleFlightStrategy", () => {
  const strategy = new ZenSingleFlightStrategy();
  const originalRetries = process.env.ZEN_ENABLE_RETRIES;

  beforeEach(() => {
    delete process.env.ZEN_ENABLE_RETRIES;
    resetEnvCache();
  });

  afterEach(() => {
    if (originalRetries !== undefined) {
      process.env.ZEN_ENABLE_RETRIES = originalRetries;
    } else {
      delete process.env.ZEN_ENABLE_RETRIES;
    }
    resetEnvCache();
  });

  it("injects a valid v4 UUID x-session-id into headers while preserving existing headers", () => {
    const ctx = createMockContext();
    const existingHeaders = {
      Authorization: "Bearer zen-key",
      "Content-Type": "application/json",
      "x-custom-foo": "bar",
    };

    const injected = strategy.injectHeaders(ctx, existingHeaders);

    expect(injected.Authorization).toBe("Bearer zen-key");
    expect(injected["Content-Type"]).toBe("application/json");
    expect(injected["x-custom-foo"]).toBe("bar");
    expect(injected["x-session-id"]).toBeDefined();

    // Standard UUID v4 regex validation
    const uuidV4Regex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(injected["x-session-id"]).toMatch(uuidV4Regex);
  });

  it("injects unique session IDs for different invocations", () => {
    const ctx = createMockContext();
    const headers1 = strategy.injectHeaders(ctx, {});
    const headers2 = strategy.injectHeaders(ctx, {});

    expect(headers1["x-session-id"]).not.toBe(headers2["x-session-id"]);
  });

  it("classifies 429 and 500-504 as retry_same_target when retries enabled (default true)", () => {
    process.env.ZEN_ENABLE_RETRIES = "true";
    resetEnvCache();

    const ctx = createMockContext();

    expect(strategy.classifyFailure(ctx, 429)).toBe("retry_same_target");
    expect(strategy.classifyFailure(ctx, 500)).toBe("retry_same_target");
    expect(strategy.classifyFailure(ctx, 502)).toBe("retry_same_target");
    expect(strategy.classifyFailure(ctx, 503)).toBe("retry_same_target");
    expect(strategy.classifyFailure(ctx, 504)).toBe("retry_same_target");

    expect(strategy.classifyFailure(ctx, 400)).toBe("fail_fast");
    expect(strategy.classifyFailure(ctx, 401)).toBe("fail_fast");
    expect(strategy.classifyFailure(ctx, 404)).toBe("fail_fast");
  });

  it("classifies all status codes as fail_fast when ZEN_ENABLE_RETRIES is false", () => {
    process.env.ZEN_ENABLE_RETRIES = "false";
    resetEnvCache();

    const ctx = createMockContext();

    expect(strategy.classifyFailure(ctx, 429)).toBe("fail_fast");
    expect(strategy.classifyFailure(ctx, 500)).toBe("fail_fast");
    expect(strategy.classifyFailure(ctx, 502)).toBe("fail_fast");
    expect(strategy.classifyFailure(ctx, 503)).toBe("fail_fast");
    expect(strategy.classifyFailure(ctx, 504)).toBe("fail_fast");
    expect(strategy.classifyFailure(ctx, 400)).toBe("fail_fast");
  });
});
