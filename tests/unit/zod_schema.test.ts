import { describe, expect, it } from "bun:test";
import {
  EnvConfigSchema,
  FusionConfigSchema,
  ProvidersConfigSchema,
} from "../../src/config/schema";

describe("Zod Schema — providers.json Validation", () => {
  it("validates a conforming providers configuration", () => {
    const sample = {
      providers: {
        openrouter: {
          code: "or",
          base_url: "https://openrouter.ai",
          endpoints: {
            ch: "/api/v1/chat/completions",
            ms: "/api/v1/messages",
          },
          limits: {
            default: { rpm: 20, rpd: 1000, tpm: 1000000 },
          },
        },
      },
    };

    const parsed = ProvidersConfigSchema.safeParse(sample);
    expect(parsed.success).toBe(true);
  });

  it("rejects invalid base_url format in providers", () => {
    const invalid = {
      providers: {
        bad_provider: {
          code: "bp",
          base_url: "not-a-valid-url",
          endpoints: { ch: "/chat" },
        },
      },
    };

    const parsed = ProvidersConfigSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });

  it("rejects negative rate limits", () => {
    const invalid = {
      providers: {
        openrouter: {
          code: "or",
          base_url: "https://openrouter.ai",
          endpoints: { ch: "/v1/chat" },
          limits: {
            default: { rpm: -10, rpd: 1000, tpm: 1000000 },
          },
        },
      },
    };

    const parsed = ProvidersConfigSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });
});

describe("Zod Schema — fusion.json Validation", () => {
  it("validates a conforming fusion configuration with presets and tiers", () => {
    const sample = {
      version: "3.1",
      presets: {
        quad: {
          strategy: "sticky_fallback",
          timeout_ms: 30000,
          models: {
            "anthropic/claude-3.7-sonnet": {
              tiers: [
                {
                  priority: 1,
                  apikey: "lr-or-cl-ms-no",
                  model: "anthropic/claude-3.7-sonnet",
                },
                {
                  priority: 2,
                  apikey: "lr-an-cl-ms-no",
                  model: "claude-3-7-sonnet-20250219",
                },
              ],
            },
          },
        },
      },
    };

    const parsed = FusionConfigSchema.safeParse(sample);
    expect(parsed.success).toBe(true);
  });

  it("rejects tier missing apikey directive", () => {
    const invalid = {
      version: "3.1",
      presets: {
        quad: {
          strategy: "sticky_fallback",
          models: {
            "test/model": {
              tiers: [{ priority: 1, model: "test/model" }],
            },
          },
        },
      },
    };

    const parsed = FusionConfigSchema.safeParse(invalid);
    expect(parsed.success).toBe(false);
  });
});

describe("Zod Schema — Environment Variables Auto-Coercion & Defaults", () => {
  it("applies resilient defaults when optional env vars are omitted", () => {
    const parsed = EnvConfigSchema.parse({});
    expect(parsed.LITEROUTER_PORT).toBe(7766);
    expect(parsed.LITEROUTER_TTFT_TIMEOUT_MS).toBe(120000);
    expect(parsed.LITEROUTER_NO_RESPONSE_TIMEOUT_MS).toBe(120000);
    expect(parsed.LITEROUTER_STREAM_IDLE_TIMEOUT_MS).toBe(120000);
    expect(parsed.COOLDOWN_RATE_LIMIT_TTL_SEC).toBe(65);
    expect(parsed.LITEROUTER_STRIP_REASONING).toBe(false);
  });

  it("coerces string numbers and booleans properly", () => {
    const envInput = {
      LITEROUTER_PORT: "8080",
      LITEROUTER_TTFT_TIMEOUT_MS: "60000",
      LITEROUTER_NO_RESPONSE_TIMEOUT_MS: "3000",
      LITEROUTER_STRIP_REASONING: "false",
    };

    const parsed = EnvConfigSchema.parse(envInput);
    expect(parsed.LITEROUTER_PORT).toBe(8080);
    expect(parsed.LITEROUTER_TTFT_TIMEOUT_MS).toBe(60000);
    expect(parsed.LITEROUTER_NO_RESPONSE_TIMEOUT_MS).toBe(3000);
    expect(parsed.LITEROUTER_STRIP_REASONING).toBe(false);
  });
});
