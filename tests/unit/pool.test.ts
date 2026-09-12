import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initProviderRegistry } from "../../src/config/providers";
import { KeyPool, isProviderQuarantineEnabled } from "../../src/network/pool";

describe("KeyPool & Dynamic Provider Quarantine", () => {
  let pool: KeyPool;

  beforeEach(() => {
    initProviderRegistry();
    pool = new KeyPool();
  });

  afterEach(() => {
    pool.reset();
    initProviderRegistry();
  });

  const mockOperationalKnobs = {
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

  describe("isProviderQuarantineEnabled", () => {
    it("dynamically respects providers.json settings for registered providers", () => {
      // or, nv, oa, an, gg, gc, zn all have key_cooldown enabled in providers.json
      expect(isProviderQuarantineEnabled("or")).toBe(true);
      expect(isProviderQuarantineEnabled("nv")).toBe(true);
      expect(isProviderQuarantineEnabled("oa")).toBe(true);
      expect(isProviderQuarantineEnabled("an")).toBe(true);

      // gg, gc and zn have key_cooldown.enabled: true configured in providers.json
      expect(isProviderQuarantineEnabled("gg")).toBe(true);
      expect(pool.isQuarantineEnabled("gg")).toBe(true);

      expect(isProviderQuarantineEnabled("gc")).toBe(true);
      expect(pool.isQuarantineEnabled("gc")).toBe(true);

      expect(isProviderQuarantineEnabled("zn")).toBe(true);
      expect(pool.isQuarantineEnabled("zn")).toBe(true);
    });

    it("handles case-insensitive provider codes", () => {
      expect(isProviderQuarantineEnabled("OR")).toBe(true);
      expect(isProviderQuarantineEnabled("NV")).toBe(true);
      expect(isProviderQuarantineEnabled("Gg")).toBe(true);
      expect(isProviderQuarantineEnabled("zN")).toBe(true);
      expect(isProviderQuarantineEnabled("gC")).toBe(true);
    });

    it("returns true for unregistered providers as default fallback", () => {
      expect(isProviderQuarantineEnabled("nonexistent_provider")).toBe(true);
      expect(isProviderQuarantineEnabled("unknown_xyz")).toBe(true);
    });

    it("still returns true when circuit_breaker is disabled if key_cooldown is enabled", () => {
      initProviderRegistry({
        providers: {
          testprov: {
            code: "tp",
            base_url: "https://example.com",
            endpoints: { ch: "/v1/chat/completions" },
            ...mockOperationalKnobs,
            circuit_breaker: {
              ...mockOperationalKnobs.circuit_breaker,
              enabled: false,
            },
            key_cooldown: {
              ...mockOperationalKnobs.key_cooldown,
              enabled: true,
            },
          },
        },
      });

      expect(isProviderQuarantineEnabled("tp")).toBe(true);
      expect(pool.isQuarantineEnabled("tp")).toBe(true);
    });

    it("dynamically returns false when key_cooldown is disabled in provider config", () => {
      initProviderRegistry({
        providers: {
          testprov: {
            code: "tp",
            base_url: "https://example.com",
            endpoints: { ch: "/v1/chat/completions" },
            ...mockOperationalKnobs,
            key_cooldown: {
              ...mockOperationalKnobs.key_cooldown,
              enabled: false,
            },
          },
        },
      });

      expect(isProviderQuarantineEnabled("tp")).toBe(false);
      expect(pool.isQuarantineEnabled("tp")).toBe(false);
    });

    it("dynamically returns true when both circuit_breaker and key_cooldown are enabled", () => {
      initProviderRegistry({
        providers: {
          testprov: {
            code: "tp",
            base_url: "https://example.com",
            endpoints: { ch: "/v1/chat/completions" },
            ...mockOperationalKnobs,
            circuit_breaker: {
              ...mockOperationalKnobs.circuit_breaker,
              enabled: true,
            },
            key_cooldown: {
              ...mockOperationalKnobs.key_cooldown,
              enabled: true,
            },
          },
        },
      });

      expect(isProviderQuarantineEnabled("tp")).toBe(true);
      expect(pool.isQuarantineEnabled("tp")).toBe(true);
    });
  });

  describe("KeyPool Lifecycle with Dynamic Quarantine", () => {
    it("selects keys round-robin and advances pointers", () => {
      pool.setPool("tp", ["key-1", "key-2"]);
      const first = pool.selectNextKey("tp");
      const second = pool.selectNextKey("tp");
      const third = pool.selectNextKey("tp");

      expect(first?.key).toBe("key-1");
      expect(first?.index).toBe(0);
      expect(second?.key).toBe("key-2");
      expect(second?.index).toBe(1);
      expect(third?.key).toBe("key-1");
      expect(third?.index).toBe(0);
    });

    it("bypasses quarantine when provider quarantine is disabled", () => {
      initProviderRegistry({
        providers: {
          testprov: {
            code: "tp",
            base_url: "https://example.com",
            endpoints: { ch: "/v1/chat/completions" },
            ...mockOperationalKnobs,
            key_cooldown: {
              ...mockOperationalKnobs.key_cooldown,
              enabled: false,
            },
          },
        },
      });

      pool.setPool("tp", ["key-1"]);
      const failureState = pool.reportFailure("tp", 0, 429);

      expect(failureState.reason).toBe("quarantine_disabled");
      expect(failureState.quarantinedUntil).toBe(0);
      expect(pool.getCooldownManager().isQuarantined("tp:0")).toBe(false);

      const next = pool.selectNextKey("tp");
      expect(next?.key).toBe("key-1");
    });

    it("quarantines keys on failure when provider quarantine is enabled", () => {
      initProviderRegistry({
        providers: {
          testprov: {
            code: "tp",
            base_url: "https://example.com",
            endpoints: { ch: "/v1/chat/completions" },
            ...mockOperationalKnobs,
            circuit_breaker: {
              ...mockOperationalKnobs.circuit_breaker,
              enabled: true,
            },
            key_cooldown: {
              ...mockOperationalKnobs.key_cooldown,
              enabled: true,
            },
          },
        },
      });

      pool.setPool("tp", ["key-1", "key-2"]);
      const now = Date.now();
      pool.reportFailure("tp", 0, 429, undefined, undefined, now, 60);

      expect(pool.getCooldownManager().isQuarantined("tp:0", now)).toBe(true);
      const next = pool.selectNextKey("tp", now);
      expect(next?.key).toBe("key-2");
    });

    it("accurately reports pool status for active and quarantined keys", () => {
      pool.setPool("tp", ["key-1", "key-2", "key-3"]);
      const now = Date.now();

      pool.quarantineKey("tp", 0, 60, "rate_limit", 429, now);
      const status = pool.getStatus("tp", now);

      expect(status.total).toBe(3);
      expect(status.active).toBe(2);
      expect(status.quarantined).toBe(1);
    });

    it("resets cooldowns and state on pool.reset()", () => {
      pool.setPool("tp", ["key-1"]);
      const now = Date.now();
      pool.quarantineKey("tp", 0, 60, "rate_limit", 429, now);

      expect(pool.getStatus("tp", now).quarantined).toBe(1);
      pool.reset("tp");
      expect(pool.getStatus("tp", now).quarantined).toBe(0);
      expect(pool.selectNextKey("tp", now)?.key).toBe("key-1");
    });
  });
});
