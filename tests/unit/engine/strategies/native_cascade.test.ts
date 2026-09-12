import { beforeEach, describe, expect, it } from "bun:test";
import { NativeCascadeStrategy } from "../../../../src/engine/strategies/native_cascade";
import type { DispatchContext } from "../../../../src/engine/strategy";
import {
  getNativeTierIndex,
  resetNativeTierIndices,
  setNativeTierIndex,
} from "../../../../src/handlers/google_native";

function createMockContext(overrides?: Partial<DispatchContext>): DispatchContext {
  return {
    reqId: "req-native-123",
    directive: {
      type: "direct",
      provider: "gg",
      payload: "gg",
      completion: "gc",
      nuance: "no",
      model: "gemini-flash",
      ...overrides?.directive,
    } as any,
    providerConfig: {
      code: "gg",
      name: "Google AI Studio",
      env_key: "GOOGLE_API_KEYS",
      strategy: "native_cascade",
      base_url: "https://generativelanguage.googleapis.com",
      auth_header: "Bearer",
      endpoints: {
        gc: "/v1beta/models/{model}:generateContent",
        ob: "/v1beta/openai/chat/completions",
      },
      ...overrides?.providerConfig,
    } as any,
    telemetry: {} as any,
    clientSignal: new AbortController().signal,
    selectedKey: { key: "mock-goog-token", index: 0, poolSize: 1 },
    attempt: 1,
    maxAttempts: 3,
    ...overrides,
  };
}

describe("Slice 3.4: NativeCascadeStrategy", () => {
  beforeEach(() => {
    resetNativeTierIndices();
  });

  it("builds auth headers using x-goog-api-key and Content-Type: application/json", () => {
    const strategy = new NativeCascadeStrategy();
    const headers = strategy.buildAuthHeaders("my-goog-secret");

    expect(headers).toEqual({
      "x-goog-api-key": "my-goog-secret",
      "Content-Type": "application/json",
    });
  });

  it("resolves active sticky tier model, upstream URL, and extra headers with constructor chains", () => {
    const customChains = {
      "gemini-flash": [
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
      ],
    };
    const strategy = new NativeCascadeStrategy(customChains);
    const ctx = createMockContext();

    setNativeTierIndex("gemini-flash", 0);
    const resolvedTier0 = strategy.resolveTarget(ctx, { model: "gemini-flash" });

    expect(resolvedTier0.model).toBe("gemini-2.5-flash");
    expect(resolvedTier0.upstreamUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    );
    expect(resolvedTier0.extraHeaders).toEqual({
      "x-literouter-chain": "gemini-flash",
      "x-literouter-tier": "1/3",
    });

    setNativeTierIndex("gemini-flash", 1);
    const resolvedTier1 = strategy.resolveTarget(ctx, { model: "gemini-flash" });
    expect(resolvedTier1.model).toBe("gemini-2.0-flash");
    expect(resolvedTier1.extraHeaders?.["x-literouter-tier"]).toBe("2/3");
  });

  it("falls back to dynamic getNativeChain when chains are not provided to constructor", () => {
    const strategy = new NativeCascadeStrategy();
    const ctx = createMockContext();

    setNativeTierIndex("gemini-flash", 0);
    const resolved = strategy.resolveTarget(ctx, { model: "gemini-flash" });

    expect(resolved.model).toContain("gemini-");
    expect(resolved.upstreamUrl).toContain("/v1beta/models/");
    expect(resolved.extraHeaders?.["x-literouter-chain"]).toBe("gemini-flash");
    expect(resolved.extraHeaders?.["x-literouter-tier"]).toBeDefined();
  });

  it("passes through non-chain models as-is without extra cascade headers", () => {
    const strategy = new NativeCascadeStrategy();
    const ctx = createMockContext({
      directive: {
        provider: "gg",
        payload: "gg",
        completion: "gc",
        nuance: "no",
        model: "text-embedding-004",
      } as any,
    });

    const resolved = strategy.resolveTarget(ctx, { model: "text-embedding-004" });
    expect(resolved.model).toBe("text-embedding-004");
    expect(resolved.upstreamUrl).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:generateContent"
    );
    expect(resolved.extraHeaders).toBeUndefined();
  });

  it("advances sticky tier index and returns advance_target on HTTP 404 for chain models", () => {
    const chains = {
      "gemini-flash": ["tier-0-model", "tier-1-model", "tier-2-model"],
    };
    const strategy = new NativeCascadeStrategy(chains);
    const ctx = createMockContext({
      directive: {
        provider: "gg",
        payload: "gg",
        completion: "gc",
        nuance: "no",
        model: "gemini-flash",
      } as any,
    });

    setNativeTierIndex("gemini-flash", 0);
    expect(getNativeTierIndex("gemini-flash")).toBe(0);

    const action1 = strategy.classifyFailure(ctx, 404);
    expect(action1).toBe("advance_target");
    expect(getNativeTierIndex("gemini-flash")).toBe(1);

    const action2 = strategy.classifyFailure(ctx, 404);
    expect(action2).toBe("advance_target");
    expect(getNativeTierIndex("gemini-flash")).toBe(2);

    const action3 = strategy.classifyFailure(ctx, 404);
    expect(action3).toBe("advance_target");
    expect(getNativeTierIndex("gemini-flash")).toBe(0); // wraps around
  });

  it("classifies 429 and 500-504 as retry_same_target, and other errors as fail_fast", () => {
    const strategy = new NativeCascadeStrategy();
    const ctx = createMockContext();

    expect(strategy.classifyFailure(ctx, 429)).toBe("retry_same_target");
    expect(strategy.classifyFailure(ctx, 500)).toBe("retry_same_target");
    expect(strategy.classifyFailure(ctx, 502)).toBe("retry_same_target");
    expect(strategy.classifyFailure(ctx, 503)).toBe("retry_same_target");
    expect(strategy.classifyFailure(ctx, 504)).toBe("retry_same_target");

    expect(strategy.classifyFailure(ctx, 400)).toBe("fail_fast");
    expect(strategy.classifyFailure(ctx, 401)).toBe("fail_fast");
    expect(strategy.classifyFailure(ctx, 403)).toBe("fail_fast");
  });

  it("throws error when endpoint template is missing for completion code", () => {
    const strategy = new NativeCascadeStrategy();
    const ctx = createMockContext({
      directive: {
        type: "direct",
        provider: "gg",
        payload: "gg",
        completion: "missing_endpoint" as any,
        nuance: "no",
        model: "custom-model",
      } as any,
    });

    expect(() => strategy.resolveTarget(ctx, { model: "custom-model" })).toThrow(
      /No endpoint for completion code/
    );
  });
});
