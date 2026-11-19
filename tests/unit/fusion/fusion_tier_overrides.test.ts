import { describe, expect, it } from "bun:test";
import { FusionTierSchema, type FusionTier } from "../../../src/config/schema";

describe("Fusion Tier Overrides", () => {
  it("FusionTierSchema parses tier without overrides as backward-compatible", () => {
    const raw = {
      priority: 1,
      apikey: "lr-gq-oa-ch-no",
      model: "qwen/qwen3.8-27b",
    };
    const parsed = FusionTierSchema.parse(raw);
    expect(parsed.priority).toBe(1);
    expect(parsed.apikey).toBe("lr-gq-oa-ch-no");
    expect(parsed.model).toBe("qwen/qwen3.8-27b");
    expect(parsed.overrides).toBeUndefined();
  });

  it("FusionTierSchema parses tier with overrides (temperature, reasoning_effort, reasoning_format)", () => {
    const raw = {
      priority: 1,
      apikey: "lr-gq-oa-ch-no",
      model: "openai/gpt-oss-safeguard-20b",
      overrides: {
        temperature: 0.0,
        reasoning_effort: "low",
        reasoning_format: "hidden",
      },
    };
    const parsed = FusionTierSchema.parse(raw);
    expect(parsed.overrides).toBeDefined();
    expect(parsed.overrides?.temperature).toBe(0.0);
    expect(parsed.overrides?.reasoning_effort).toBe("low");
    expect(parsed.overrides?.reasoning_format).toBe("hidden");
  });

  it("applies overrides to tier body, overwriting downstream client parameters", () => {
    const tier: FusionTier = {
      priority: 1,
      apikey: "lr-gq-oa-ch-no",
      model: "openai/gpt-oss-20b",
      overrides: {
        temperature: 0.0,
        reasoning_effort: "low",
        reasoning_format: "hidden",
      },
    };

    const clientBody: Record<string, unknown> = {
      model: "safe",
      messages: [{ role: "user", content: "test" }],
      temperature: 0.8,
      reasoning_effort: "high",
    };

    const tierBody: Record<string, unknown> = { ...clientBody, model: tier.model };
    if (tier.overrides && typeof tier.overrides === "object") {
      Object.assign(tierBody, tier.overrides);
    }

    expect(tierBody.model).toBe("openai/gpt-oss-20b");
    expect(tierBody.temperature).toBe(0.0);
    expect(tierBody.reasoning_effort).toBe("low");
    expect(tierBody.reasoning_format).toBe("hidden");
  });

  it("applies overrides to tier body, inserting parameters when omitted by downstream client", () => {
    const tier: FusionTier = {
      priority: 1,
      apikey: "lr-gq-oa-ch-no",
      model: "qwen/qwen3.8-27b",
      overrides: {
        temperature: 0.0,
        reasoning_effort: "none",
        reasoning_format: "hidden",
      },
    };

    const clientBody: Record<string, unknown> = {
      model: "simple",
      messages: [{ role: "user", content: "test" }],
    };

    const tierBody: Record<string, unknown> = { ...clientBody, model: tier.model };
    if (tier.overrides && typeof tier.overrides === "object") {
      Object.assign(tierBody, tier.overrides);
    }

    expect(tierBody.model).toBe("qwen/qwen3.8-27b");
    expect(tierBody.temperature).toBe(0.0);
    expect(tierBody.reasoning_effort).toBe("none");
    expect(tierBody.reasoning_format).toBe("hidden");
  });
});
