import { describe, expect, it } from "bun:test";
import {
  EnvConfigSchema,
  FusionConfigSchema,
  ProvidersConfigSchema,
} from "../../src/config/schema";

describe("Zod Schema — providers.json Validation", () => {
  const validOperationalKnobs = {
    env_key: "MOCK_API_KEYS",
    request_retry: {
      enabled: true,
      max_attempts: 3,
      delay: { min_ms: 150, max_ms: 300 },
    },
    key_cooldown: {
      enabled: true,
      initial_cooldown_ms: 10000,
      backoff_factor: 1.5,
      max_cooldown_ms: 60000,
      max_consecutive_failures: 5,
      jitter_percent: 20,
      respect_retry_after: true,
      reset_after_success: true,
    },
    pacer: {
      enabled: true,
      min_delay_ms: 100,
      max_delay_ms: 500,
      max_queue_depth: 100,
      max_queue_wait_ms: 15000,
    },
    circuit_breaker: {
      enabled: true,
      failure_threshold: 5,
      failure_window_ms: 60000,
      open_duration_ms: 30000,
      half_open_max_probes: 2,
      success_threshold_to_close: 2,
    },
  };

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
          ...validOperationalKnobs,
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
    expect(parsed.LITEROUTER_AO_STRIP_REASONING).toBe(true);
    expect(parsed.LITEROUTER_ENGINE).toBe("v4.1");
    expect(parsed.LITEROUTER_ENGINE_OVERRIDE).toBe(false);
  });

  it("coerces string numbers and booleans properly", () => {
    const envInput = {
      LITEROUTER_PORT: "8080",
      LITEROUTER_TTFT_TIMEOUT_MS: "60000",
      LITEROUTER_NO_RESPONSE_TIMEOUT_MS: "3000",
      LITEROUTER_STRIP_REASONING: "false",
      LITEROUTER_AO_STRIP_REASONING: "false",
      LITEROUTER_ENGINE: "v4.1",
      LITEROUTER_ENGINE_OVERRIDE: "true",
    };

    const parsed = EnvConfigSchema.parse(envInput);
    expect(parsed.LITEROUTER_PORT).toBe(8080);
    expect(parsed.LITEROUTER_TTFT_TIMEOUT_MS).toBe(60000);
    expect(parsed.LITEROUTER_NO_RESPONSE_TIMEOUT_MS).toBe(3000);
    expect(parsed.LITEROUTER_STRIP_REASONING).toBe(false);
    expect(parsed.LITEROUTER_AO_STRIP_REASONING).toBe(false);
    expect(parsed.LITEROUTER_ENGINE).toBe("v4.1");
    expect(parsed.LITEROUTER_ENGINE_OVERRIDE).toBe(true);
  });
});
