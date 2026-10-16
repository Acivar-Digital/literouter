import { describe, expect, it } from "bun:test";
import {
  getCachedFusionEngine,
  resetCachedFusionEngine,
  resetProvidersRegistryCache,
} from "../../src/handlers/openai_compat";
import { resetAllState } from "../../src/index";
import type { FusionTier } from "../../src/config/schema";

describe("Singleton FusionEngine & StickyPositionCache Persistence", () => {
  it("maintains the same FusionEngine instance across requests", () => {
    resetCachedFusionEngine();
    const instance1 = getCachedFusionEngine();
    const instance2 = getCachedFusionEngine();

    expect(instance1).toBe(instance2);
  });

  it("persists sticky fallback positions across multiple requests on the singleton instance", () => {
    resetCachedFusionEngine();
    const engine = getCachedFusionEngine();

    const tier: FusionTier = {
      priority: 2,
      apikey: "lr-an-cl-ms-no",
      model: "claude-3-7-sonnet-20250219",
    };

    engine.handleTierSuccess("quad", "anthropic/claude-3.7-sonnet", tier);

    // On a separate request fetching the cached engine
    const nextEngine = getCachedFusionEngine();
    expect(nextEngine).toBe(engine);

    // Position cache is preserved across requests
    const cachedTier = nextEngine.getStickyCache().getStickyTier("quad", "anthropic/claude-3.7-sonnet");
    expect(cachedTier).not.toBeNull();
    expect(cachedTier?.model).toBe("claude-3-7-sonnet-20250219");
  });

  it("invalidates singleton instance on resetCachedFusionEngine()", () => {
    const instance1 = getCachedFusionEngine();
    resetCachedFusionEngine();
    const instance2 = getCachedFusionEngine();

    expect(instance1).not.toBe(instance2);
  });

  it("invalidates singleton instance on resetProvidersRegistryCache()", () => {
    const instance1 = getCachedFusionEngine();
    resetProvidersRegistryCache();
    const instance2 = getCachedFusionEngine();

    expect(instance1).not.toBe(instance2);
  });

  it("invalidates singleton instance on resetAllState()", () => {
    const instance1 = getCachedFusionEngine();
    resetAllState();
    const instance2 = getCachedFusionEngine();

    expect(instance1).not.toBe(instance2);
  });
});
