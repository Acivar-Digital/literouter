import { describe, expect, it } from "bun:test";
import rawProviders from "../../../config/providers.json";
import {
  CircuitBreakerConfigSchema,
  ConserveRuleSchema,
  KeyCooldownSchema,
  ProviderConfigEntrySchema,
  ProviderPacerConfigSchema,
  ProvidersConfigSchema,
  ProviderStrategySchema,
  RequestRetryDelaySchema,
  RequestRetrySchema,
} from "../../../src/config/schema";

describe("RequestRetryDelaySchema", () => {
  it("requires min_ms and max_ms explicitly", () => {
    expect(RequestRetryDelaySchema.safeParse({}).success).toBe(false);
  });

  it("accepts valid explicit bounds where max_ms > min_ms", () => {
    const parsed = RequestRetryDelaySchema.parse({ min_ms: 50, max_ms: 500 });
    expect(parsed).toEqual({ min_ms: 50, max_ms: 500 });
  });

  it("accepts equal bounds where max_ms === min_ms", () => {
    const parsed = RequestRetryDelaySchema.parse({ min_ms: 200, max_ms: 200 });
    expect(parsed).toEqual({ min_ms: 200, max_ms: 200 });
  });

  it("rejects invalid bounds where max_ms < min_ms", () => {
    const result = RequestRetryDelaySchema.safeParse({ min_ms: 500, max_ms: 200 });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("max_ms must be >= min_ms");
      expect(result.error.issues[0]?.path).toEqual(["max_ms"]);
    }
  });

  it("rejects negative min_ms and max_ms values", () => {
    expect(RequestRetryDelaySchema.safeParse({ min_ms: -1, max_ms: 300 }).success).toBe(false);
    expect(RequestRetryDelaySchema.safeParse({ min_ms: 100, max_ms: -10 }).success).toBe(false);
  });

  it("rejects non-integer millisecond values", () => {
    expect(RequestRetryDelaySchema.safeParse({ min_ms: 150.5, max_ms: 300 }).success).toBe(false);
    expect(RequestRetryDelaySchema.safeParse({ min_ms: 150, max_ms: 300.9 }).success).toBe(false);
  });
});

describe("RequestRetrySchema", () => {
  it("rejects empty object when required fields are missing", () => {
    expect(RequestRetrySchema.safeParse({}).success).toBe(false);
  });

  it("accepts custom retry configurations", () => {
    const parsed = RequestRetrySchema.parse({
      enabled: false,
      max_attempts: 5,
      delay: { min_ms: 100, max_ms: 400 },
    });
    expect(parsed).toEqual({
      enabled: false,
      max_attempts: 5,
      delay: { min_ms: 100, max_ms: 400 },
    });
  });

  it("rejects non-positive max_attempts", () => {
    expect(RequestRetrySchema.safeParse({ max_attempts: 0 }).success).toBe(false);
    expect(RequestRetrySchema.safeParse({ max_attempts: -1 }).success).toBe(false);
  });

  it("propagates inner delay refinement error when max_ms < min_ms", () => {
    const result = RequestRetrySchema.safeParse({
      enabled: true,
      max_attempts: 3,
      delay: { min_ms: 500, max_ms: 100 },
    });
    expect(result.success).toBe(false);
  });
});

describe("KeyCooldownSchema", () => {
  it("rejects empty object when required fields are missing", () => {
    expect(KeyCooldownSchema.safeParse({}).success).toBe(false);
  });

  it("accepts custom key cooldown overrides", () => {
    const parsed = KeyCooldownSchema.parse({
      enabled: false,
      initial_cooldown_ms: 5000,
      backoff_factor: 2.0,
      max_cooldown_ms: 120000,
      max_consecutive_failures: 3,
      jitter_percent: 10,
      respect_retry_after: false,
      reset_after_success: false,
    });
    expect(parsed).toEqual({
      enabled: false,
      initial_cooldown_ms: 5000,
      backoff_factor: 2.0,
      max_cooldown_ms: 120000,
      max_consecutive_failures: 3,
      jitter_percent: 10,
      respect_retry_after: false,
      reset_after_success: false,
    });
  });

  it("validates jitter_percent bounds [0, 50]", () => {
    const base = {
      enabled: true,
      initial_cooldown_ms: 10000,
      max_cooldown_ms: 60000,
    };
    expect(KeyCooldownSchema.safeParse({ ...base, jitter_percent: 0 }).success).toBe(true);
    expect(KeyCooldownSchema.safeParse({ ...base, jitter_percent: 50 }).success).toBe(true);
    expect(KeyCooldownSchema.safeParse({ ...base, jitter_percent: -1 }).success).toBe(false);
    expect(KeyCooldownSchema.safeParse({ ...base, jitter_percent: 51 }).success).toBe(false);
  });

  it("rejects non-positive cooldown durations and counts", () => {
    expect(KeyCooldownSchema.safeParse({ initial_cooldown_ms: 0 }).success).toBe(false);
    expect(KeyCooldownSchema.safeParse({ backoff_factor: 0 }).success).toBe(false);
    expect(KeyCooldownSchema.safeParse({ max_cooldown_ms: -100 }).success).toBe(false);
    expect(KeyCooldownSchema.safeParse({ max_consecutive_failures: 0 }).success).toBe(false);
  });
});

describe("ProviderPacerConfigSchema", () => {
  it("rejects empty object when required fields are missing", () => {
    expect(ProviderPacerConfigSchema.safeParse({}).success).toBe(false);
  });

  it("accepts valid explicit bounds where max_delay_ms >= min_delay_ms", () => {
    const parsed = ProviderPacerConfigSchema.parse({
      enabled: true,
      min_delay_ms: 300,
      max_delay_ms: 300,
      max_queue_depth: 50,
      max_queue_wait_ms: 30000,
    });
    expect(parsed.min_delay_ms).toBe(300);
    expect(parsed.max_delay_ms).toBe(300);
  });

  it("rejects invalid bounds where max_delay_ms < min_delay_ms", () => {
    const result = ProviderPacerConfigSchema.safeParse({
      enabled: true,
      min_delay_ms: 1000,
      max_delay_ms: 500,
      max_queue_depth: 100,
      max_queue_wait_ms: 15000,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("max_delay_ms must be >= min_delay_ms");
      expect(result.error.issues[0]?.path).toEqual(["max_delay_ms"]);
    }
  });

  it("rejects negative delay or non-positive queue limits", () => {
    expect(ProviderPacerConfigSchema.safeParse({ min_delay_ms: -10 }).success).toBe(false);
    expect(ProviderPacerConfigSchema.safeParse({ max_queue_depth: 0 }).success).toBe(false);
    expect(ProviderPacerConfigSchema.safeParse({ max_queue_wait_ms: -1 }).success).toBe(false);
  });
});

describe("CircuitBreakerConfigSchema", () => {
  it("rejects empty object when required fields are missing", () => {
    expect(CircuitBreakerConfigSchema.safeParse({}).success).toBe(false);
  });

  it("accepts custom circuit breaker configurations", () => {
    const parsed = CircuitBreakerConfigSchema.parse({
      enabled: false,
      failure_threshold: 10,
      failure_window_ms: 120000,
      open_duration_ms: 45000,
      half_open_max_probes: 3,
      success_threshold_to_close: 1,
    });
    expect(parsed).toEqual({
      enabled: false,
      failure_threshold: 10,
      failure_window_ms: 120000,
      open_duration_ms: 45000,
      half_open_max_probes: 3,
      success_threshold_to_close: 1,
    });
  });

  it("rejects non-positive thresholds and probe counts", () => {
    expect(CircuitBreakerConfigSchema.safeParse({ failure_threshold: 0 }).success).toBe(false);
    expect(CircuitBreakerConfigSchema.safeParse({ half_open_max_probes: 0 }).success).toBe(false);
    expect(CircuitBreakerConfigSchema.safeParse({ success_threshold_to_close: -1 }).success).toBe(false);
  });
});

describe("ConserveRuleSchema", () => {
  it("parses valid rule with default ttl ('midnight_utc')", () => {
    const parsed = ConserveRuleSchema.parse({
      status: 429,
      contains: "quota_exceeded",
      reason: "daily_quota_limit",
    });
    expect(parsed).toEqual({
      status: 429,
      contains: "quota_exceeded",
      ttl: "midnight_utc",
      reason: "daily_quota_limit",
    });
  });

  it("accepts all valid ttl enum values", () => {
    const validTtls = ["midnight_utc", "midnight_pacific", "indefinite", "1h", "24h"] as const;
    for (const ttl of validTtls) {
      const parsed = ConserveRuleSchema.parse({
        status: 429,
        contains: "rate_limit",
        ttl,
        reason: `test_${ttl}`,
      });
      expect(parsed.ttl).toBe(ttl);
    }
  });

  it("rejects unsupported ttl enum values", () => {
    const result = ConserveRuleSchema.safeParse({
      status: 429,
      contains: "rate_limit",
      ttl: "12h",
      reason: "invalid_ttl",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty contains or reason strings", () => {
    expect(
      ConserveRuleSchema.safeParse({
        status: 429,
        contains: "",
        reason: "valid_reason",
      }).success
    ).toBe(false);

    expect(
      ConserveRuleSchema.safeParse({
        status: 429,
        contains: "valid_contains",
        reason: "",
      }).success
    ).toBe(false);
  });

  it("rejects non-integer HTTP status codes", () => {
    expect(
      ConserveRuleSchema.safeParse({
        status: 429.5,
        contains: "rate_limit",
        reason: "float_status",
      }).success
    ).toBe(false);
  });
});

describe("ProviderStrategySchema", () => {
  it("defaults to 'standard' when undefined", () => {
    expect(ProviderStrategySchema.parse(undefined)).toBe("standard");
  });

  it("accepts all valid strategy enum values", () => {
    const validStrategies = [
      "standard",
      "native_cascade",
      "gcp_guarded",
      "anthropic_direct",
    ] as const;

    for (const strategy of validStrategies) {
      expect(ProviderStrategySchema.parse(strategy)).toBe(strategy);
    }
  });

  it("rejects invalid strategy identifiers", () => {
    expect(ProviderStrategySchema.safeParse("unknown_strategy").success).toBe(false);
    expect(ProviderStrategySchema.safeParse("smart").success).toBe(false);
    expect(ProviderStrategySchema.safeParse("zen_single_flight").success).toBe(false);
  });
});

describe("ProviderConfigEntrySchema", () => {
  const validTestOperationalKnobs = {
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

  it("parses an entry with fully specified operational knobs", () => {
    const full = {
      code: "nv",
      name: "NVIDIA NIM",
      env_key: "NVIDIA_API_KEYS",
      strategy: "standard",
      base_url: "https://integrate.api.nvidia.com",
      auth_header: "Bearer",
      endpoints: {
        ch: "/v1/chat/completions",
        em: "/v1/embeddings",
      },
      limits: {
        default: { rpm: 60, rpd: 50000, tpm: 10000000 },
      },
      conserve_rules: [
        {
          status: 429,
          contains: "quota_exceeded",
          ttl: "midnight_utc",
          reason: "nvidia_daily_limit",
        },
      ],
      request_retry: {
        enabled: true,
        max_attempts: 2,
        delay: { min_ms: 200, max_ms: 400 },
      },
      key_cooldown: {
        enabled: false,
        initial_cooldown_ms: 10000,
        max_cooldown_ms: 60000,
      },
      pacer: {
        enabled: true,
        min_delay_ms: 250,
        max_delay_ms: 600,
        max_queue_depth: 80,
        max_queue_wait_ms: 20000,
      },
      circuit_breaker: {
        enabled: false,
        failure_threshold: 5,
        failure_window_ms: 60000,
        open_duration_ms: 30000,
      },
    };

    const parsed = ProviderConfigEntrySchema.parse(full);
    expect(parsed.name).toBe("NVIDIA NIM");
    expect(parsed.env_key).toBe("NVIDIA_API_KEYS");
    expect(parsed.strategy).toBe("standard");
    expect(parsed.pacer?.min_delay_ms).toBe(250);
    expect(parsed.conserve_rules.length).toBe(1);
    expect(parsed.conserve_rules[0]?.contains).toBe("quota_exceeded");
  });

  it("validates code format against 2-6 lowercase alphanumeric characters", () => {
    const validCodes = ["or", "nv", "gg", "custom", "g1", "tp123"];
    for (const code of validCodes) {
      const result = ProviderConfigEntrySchema.safeParse({
        code,
        base_url: "https://example.com",
        endpoints: { ch: "/chat" },
        ...validTestOperationalKnobs,
      });
      expect(result.success).toBe(true);
    }

    const invalidCodes = ["a", "toolongcode", "UPPER", "inv@lid", ""];
    for (const code of invalidCodes) {
      const result = ProviderConfigEntrySchema.safeParse({
        code,
        base_url: "https://example.com",
        endpoints: { ch: "/chat" },
        ...validTestOperationalKnobs,
      });
      expect(result.success).toBe(false);
    }
  });

  it("validates existing config/providers.json with zero errors", () => {
    const parsed = ProvidersConfigSchema.safeParse(rawProviders);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const providers = parsed.data.providers;
      expect(Object.keys(providers).length).toBeGreaterThanOrEqual(13);

      // Verify openrouter specific headers & conserve_rules
      const or = providers.openrouter;
      expect(or).toBeDefined();
      expect(or?.code).toBe("or");
      expect(or?.headers?.["User-Agent"]).toBe("OpenCode/1.18.29");
      expect(or?.conserve_rules.length).toBe(1);
      expect(or?.conserve_rules[0]?.contains).toBe("free-models-per-day");
      expect(or?.conserve_rules[0]?.ttl).toBe("midnight_utc");

      // Verify key providers have their explicit strategies and names
      expect(providers.openrouter?.name).toBe("OpenRouter");
      expect(providers.openrouter?.strategy).toBe("standard");
      expect(providers.nvidia?.name).toBe("NVIDIA NIM");
      expect(providers.nvidia?.strategy).toBe("standard");
      expect(providers.google?.name).toBe("Google AI Studio");
      expect(providers.google?.strategy).toBe("native_cascade");
      expect(providers.google?.circuit_breaker.enabled).toBe(false);
      expect(providers.zen?.name).toBe("Zen");
      expect(providers.zen?.strategy).toBe("standard");
      expect(providers.zen?.request_retry.max_attempts).toBe(3);
      expect(providers.zen?.circuit_breaker.enabled).toBe(false);
      expect(providers.gcp?.name).toBe("Google Cloud (GCP)");
      expect(providers.gcp?.strategy).toBe("gcp_guarded");
      expect(providers.gcp?.circuit_breaker.enabled).toBe(false);

      // Verify all providers have valid applied operational configurations
      for (const provider of Object.values(providers)) {
        expect(provider.strategy).toBeDefined();
        expect(provider.request_retry).toBeDefined();
        expect(provider.circuit_breaker).toBeDefined();
        expect(typeof provider.key_cooldown.enabled).toBe("boolean");
      }
    }
  });
});
