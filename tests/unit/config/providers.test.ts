import { describe, it, expect, beforeEach } from "bun:test";
import {
  initProviderRegistry,
  getProviderConfig,
  getProviderDisplayName,
  isRegisteredProvider,
  getAllProviders,
} from "../../../src/config/providers";

describe("ProviderRegistry — In-Memory Store", () => {
  beforeEach(() => {
    // Reset to real default config/providers.json
    initProviderRegistry();
  });

  it("initializes successfully from config/providers.json", () => {
    const all = getAllProviders();
    expect(all.length).toBeGreaterThanOrEqual(13);

    expect(isRegisteredProvider("or")).toBe(true);
    expect(isRegisteredProvider("nv")).toBe(true);
    expect(isRegisteredProvider("gg")).toBe(true);
    expect(isRegisteredProvider("zn")).toBe(true);
    expect(isRegisteredProvider("tp")).toBe(true);
    expect(isRegisteredProvider("unknown_provider")).toBe(false);
  });

  it("resolves provider config by code (case-insensitive)", () => {
    const lower = getProviderConfig("or");
    const upper = getProviderConfig("OR");

    expect(lower.code).toBe("or");
    expect(upper.code).toBe("or");
    expect(lower.base_url).toBe("https://openrouter.ai");
  });

  it("resolves provider config by provider name (case-insensitive)", () => {
    const byNameLower = getProviderConfig("openrouter");
    const byNameUpper = getProviderConfig("OPENROUTER");

    expect(byNameLower.code).toBe("or");
    expect(byNameUpper.code).toBe("or");
  });

  it("throws informative error for unknown provider", () => {
    expect(() => getProviderConfig("nonexistent")).toThrow(
      '[ProviderRegistry] Unknown provider: "nonexistent"'
    );
  });

  it("returns correct display name for known and unknown providers", () => {
    // Known provider with code or name
    expect(getProviderDisplayName("or")).toBe("OpenRouter");
    expect(getProviderDisplayName("openrouter")).toBe("OpenRouter");

    // Unknown provider falls back to uppercase of input
    expect(getProviderDisplayName("foobar")).toBe("FOOBAR");
  });

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

  it("loads custom raw config object with explicit name", () => {
    const customConfig = {
      providers: {
        customprov: {
          code: "cp",
          name: "Custom Provider",
          base_url: "https://custom.provider.ai",
          auth_header: "Bearer",
          endpoints: {
            ch: "/v1/chat/completions",
          },
          ...validOperationalKnobs,
        },
      },
    };

    initProviderRegistry(customConfig);

    expect(isRegisteredProvider("cp")).toBe(true);
    expect(isRegisteredProvider("or")).toBe(false); // swapped out
    expect(getAllProviders().length).toBe(1);

    const entry = getProviderConfig("cp");
    expect(entry.code).toBe("cp");
    expect(entry.name).toBe("Custom Provider");
    expect(getProviderDisplayName("cp")).toBe("Custom Provider");
    expect(getProviderDisplayName("customprov")).toBe("Custom Provider");
  });

  it("guarantees atomic pointer swap and preserves previous registry on invalid config schema failure", () => {
    // 1. Initial valid state with custom config
    const validConfig = {
      providers: {
        p1: {
          code: "p1",
          name: "Provider One",
          base_url: "https://api.p1.com",
          auth_header: "Bearer",
          endpoints: {
            ch: "/v1/chat/completions",
          },
          ...validOperationalKnobs,
        },
      },
    };
    initProviderRegistry(validConfig);
    expect(isRegisteredProvider("p1")).toBe(true);
    expect(getAllProviders().length).toBe(1);

    // 2. Attempt to initialize with invalid config (missing base_url and endpoints)
    const invalidConfig = {
      providers: {
        broken: {
          code: "invalid-code-too-long-or-bad",
        },
      },
    };

    expect(() => initProviderRegistry(invalidConfig)).toThrow();

    // 3. Old registry must remain untouched and fully operational
    expect(isRegisteredProvider("p1")).toBe(true);
    const entry = getProviderConfig("p1");
    expect(entry.name).toBe("Provider One");
    expect(getAllProviders().length).toBe(1);
  });

  it("isRegisteredProvider() is case-insensitive and matches codes only", () => {
    expect(isRegisteredProvider("or")).toBe(true);
    expect(isRegisteredProvider("OR")).toBe(true);
    expect(isRegisteredProvider("Gg")).toBe(true);
    // Names are not codes — lookup by name must not register
    expect(isRegisteredProvider("openrouter")).toBe(false);
    expect(isRegisteredProvider("unknown_provider")).toBe(false);
    expect(isRegisteredProvider("")).toBe(false);
  });

  it("getAllProviders() returns every registered provider with required fields", () => {
    const all = getAllProviders();
    expect(all.length).toBeGreaterThanOrEqual(13);

    const codes = all.map((p) => p.code);
    expect(codes).toContain("or");
    expect(codes).toContain("nv");
    expect(codes).toContain("gg");
    expect(codes).toContain("gc");
    expect(codes).toContain("zn");

    for (const entry of all) {
      expect(entry.code).toMatch(/^[a-z0-9]{2,6}$/);
      expect(entry.base_url).toMatch(/^https?:\/\//);
      expect(Object.keys(entry.endpoints).length).toBeGreaterThan(0);
    }
  });

  it("getProviderConfig() returns the correct strategy per provider", () => {
    expect(getProviderConfig("or").strategy).toBe("standard");
    expect(getProviderConfig("gg").strategy).toBe("native_cascade");
    expect(getProviderConfig("gc").strategy).toBe("gcp_guarded");
    expect(getProviderConfig("zn").strategy).toBe("zen_single_flight");
    // Entries without an explicit strategy fall back to the schema default
    expect(getProviderConfig("oa").strategy).toBe("standard");
  });

  it("getProviderDisplayName() falls back to the raw key when name is absent", () => {
    const unnamedConfig = {
      providers: {
        unnamedprov: {
          code: "up",
          base_url: "https://unnamed.ai",
          endpoints: {
            ch: "/v1/chat/completions",
          },
          ...validOperationalKnobs,
        },
      },
    };
    initProviderRegistry(unnamedConfig);
    expect(getProviderConfig("up").name).toBe("unnamedprov");
    expect(getProviderDisplayName("up")).toBe("unnamedprov");
    expect(getProviderDisplayName("UP")).toBe("unnamedprov");
  });

  it("resolves explicit name and env_key for configured providers such as OpenAI and Anthropic", () => {
    expect(getProviderConfig("oa").name).toBe("OpenAI");
    expect(getProviderConfig("oa").env_key).toBe("OPENAI_API_KEYS");
    expect(getProviderDisplayName("oa")).toBe("OpenAI");
    expect(getProviderDisplayName("OA")).toBe("OpenAI");

    expect(getProviderConfig("an").name).toBe("Anthropic");
    expect(getProviderConfig("an").env_key).toBe("ANTHROPIC_API_KEYS");
    expect(getProviderConfig("an").strategy).toBe("anthropic_direct");
  });

  it("hot reload swaps the registry and queries return the new values", () => {
    const v1 = {
      providers: {
        myprov: {
          code: "mp",
          name: "My Provider v1",
          base_url: "https://v1.example.com",
          auth_header: "Bearer",
          endpoints: {
            ch: "/v1/chat/completions",
          },
          ...validOperationalKnobs,
        },
      },
    };
    initProviderRegistry(v1);
    expect(getProviderConfig("mp").name).toBe("My Provider v1");
    expect(getProviderConfig("mp").base_url).toBe("https://v1.example.com");

    const v2 = {
      providers: {
        myprov: {
          code: "mp",
          name: "My Provider v2",
          base_url: "https://v2.example.com",
          auth_header: "Bearer",
          endpoints: {
            ch: "/v1/chat/completions",
          },
          ...validOperationalKnobs,
        },
      },
    };
    initProviderRegistry(v2);
    expect(getProviderConfig("mp").name).toBe("My Provider v2");
    expect(getProviderConfig("mp").base_url).toBe("https://v2.example.com");
    expect(getProviderDisplayName("mp")).toBe("My Provider v2");
    expect(getAllProviders().length).toBe(1);
  });
});
