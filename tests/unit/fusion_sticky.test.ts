import { beforeEach, describe, expect, it } from "bun:test";
import type { FusionTier } from "../../src/config/schema";
import { StickyPositionCache } from "../../src/fusion/sticky";

describe("Fusion Sticky Cache — 5-Minute Fallback Position", () => {
  let cache: StickyPositionCache;

  beforeEach(() => {
    cache = new StickyPositionCache();
  });

  const tier1: FusionTier = { priority: 1, apikey: "lr-or-cl-ms-no", model: "anthropic/claude-3.7-sonnet" };
  const tier2: FusionTier = { priority: 2, apikey: "lr-an-cl-ms-no", model: "claude-3-7-sonnet-20250219" };
  const tierDeepseek: FusionTier = { priority: 1, apikey: "lr-nv-oa-ch-dp", model: "deepseek-ai/deepseek-r1" };

  it("returns null when no sticky position is cached", () => {
    const tier = cache.getStickyTier("quad", "anthropic/claude-3.7-sonnet");
    expect(tier).toBeNull();
  });

  it("stores and returns sticky tier position on fallback", () => {
    cache.setStickyTier("quad", "anthropic/claude-3.7-sonnet", tier2);
    const pos = cache.getStickyTier("quad", "anthropic/claude-3.7-sonnet");
    expect(pos).not.toBeNull();
    expect(pos?.tierPriority).toBe(2);
    expect(pos?.apikey).toBe("lr-an-cl-ms-no");
    expect(pos?.model).toBe("claude-3-7-sonnet-20250219");
  });

  it("isolates sticky positions across distinct models", () => {
    cache.setStickyTier("quad", "anthropic/claude-3.7-sonnet", tier2);
    cache.setStickyTier("quad", "deepseek/deepseek-r1", tierDeepseek);

    expect(cache.getStickyTier("quad", "anthropic/claude-3.7-sonnet")?.tierPriority).toBe(2);
    expect(cache.getStickyTier("quad", "deepseek/deepseek-r1")?.tierPriority).toBe(1);
    expect(cache.getStickyTier("quad", "gemini-2.5-pro")).toBeNull();
  });

  it("expires sticky position after 5-minute TTL", () => {
    const pastEpoch = Date.now() - 301000;
    cache.setStickyTier("quad", "gemini-2.5-pro", tier1, 300000, pastEpoch);

    const pos = cache.getStickyTier("quad", "gemini-2.5-pro", Date.now());
    expect(pos).toBeNull();
  });

  it("clears sticky tier when primary recovery succeeds", () => {
    cache.setStickyTier("pydn", "deepseek/deepseek-r1", tierDeepseek);
    expect(cache.getStickyTier("pydn", "deepseek/deepseek-r1")).not.toBeNull();

    cache.clearStickyTier("pydn", "deepseek/deepseek-r1");
    expect(cache.getStickyTier("pydn", "deepseek/deepseek-r1")).toBeNull();
  });

  it("resets all sticky entries on clearAll", () => {
    cache.setStickyTier("quad", "m1", tier1);
    cache.setStickyTier("fast", "m2", tier2);
    cache.clearAll();

    expect(cache.getStickyTier("quad", "m1")).toBeNull();
    expect(cache.getStickyTier("fast", "m2")).toBeNull();
  });
});
