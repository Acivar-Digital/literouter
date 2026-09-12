import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { initProviderRegistry } from "../../../src/config/providers";
import { AnthropicDirectStrategy } from "../../../src/engine/strategies/anthropic_direct";
import { GcpGuardedStrategy } from "../../../src/engine/strategies/gcp_guarded";
import { NativeCascadeStrategy } from "../../../src/engine/strategies/native_cascade";
import { StandardStrategy } from "../../../src/engine/strategies/standard";
import { ZenSingleFlightStrategy } from "../../../src/engine/strategies/zen_single_flight";
import type {
  DispatchContext,
  ProviderExecutionStrategy,
  SelectedKey,
  StrategyResult,
} from "../../../src/engine/strategy";
import {
  getStrategy,
  initStrategyRegistry,
  registerStrategyFactory,
  resetStrategyRegistry,
  unregisterStrategyFactory,
} from "../../../src/engine/strategy_registry";

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
    max_cooldown_ms: 60000,
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
  },
};

describe("Slice 3.3 & 3.4: Strategy Interface & Strategy Registry", () => {
  beforeEach(() => {
    resetStrategyRegistry();
  });

  afterEach(() => {
    resetStrategyRegistry();
  });

  describe("ProviderExecutionStrategy interface & StandardStrategy", () => {
    it("instantiates StandardStrategy and builds standard auth headers", () => {
      const strategy = new StandardStrategy();
      const headers = strategy.buildAuthHeaders("mock-key-12345");

      expect(headers).toEqual({
        Authorization: "Bearer mock-key-12345",
        "Content-Type": "application/json",
      });
    });

    it("accepts incomingHeaders parameter without altering default standard headers", () => {
      const strategy = new StandardStrategy();
      const incoming = new Headers({ "x-custom-header": "test-value" });
      const headers = strategy.buildAuthHeaders("mock-key-abc", incoming);

      expect(headers.Authorization).toBe("Bearer mock-key-abc");
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it("conforms to ProviderExecutionStrategy type contract", () => {
      const customStrategy: ProviderExecutionStrategy = {
        preDispatch: (_ctx: DispatchContext, _body: Record<string, unknown>) => null,
        resolveTarget: (_ctx: DispatchContext, body: Record<string, unknown>) => ({
          model: String(body.model ?? "default-model"),
          upstreamUrl: "https://upstream.test.local/v1/chat",
          extraHeaders: { "x-routed-by": "custom" },
        }),
        classifyFailure: (_ctx: DispatchContext, status: number) => {
          if (status === 429) return "retry_same_target";
          if (status === 404) return "advance_target";
          return "fail_fast";
        },
        buildAuthHeaders: (key: string) => ({
          "x-api-key": key,
        }),
        injectHeaders: (_ctx: DispatchContext, headers: Record<string, string>) => ({
          ...headers,
          "x-injected": "true",
        }),
      };

      const selectedKey: SelectedKey = {
        key: "stub-token",
        index: 0,
        poolSize: 1,
      };
      expect(selectedKey.key).toBe("stub-token");

      const result: StrategyResult = {
        response: new Response("ok", { status: 200 }),
        committed: false,
      };
      expect(result.committed).toBe(false);
      expect(result.response.status).toBe(200);

      expect(customStrategy.buildAuthHeaders?.("key1")["x-api-key"]).toBe("key1");
      expect(customStrategy.classifyFailure?.({} as DispatchContext, 429)).toBe(
        "retry_same_target"
      );
    });
  });

  describe("Strategy Registry (initStrategyRegistry, getStrategy, registerStrategyFactory)", () => {
    it("throws for unknown providers instead of silently returning StandardStrategy", () => {
      expect(() => getStrategy("unknown_prov_xyz")).toThrow(
        "No strategy registered"
      );
    });

    it("throws for 'nonexistent' provider code with descriptive message", () => {
      expect(() => getStrategy("nonexistent")).toThrow(
        '[StrategyRegistry] No strategy registered for provider "nonexistent"'
      );
    });

    it("returns a valid strategy for known provider 'or'", () => {
      const mockRawProviders = {
        providers: {
          openrouter: {
            code: "or",
            base_url: "https://openrouter.ai",
            auth_header: "Bearer",
            endpoints: {
              ch: "/v1/chat/completions",
            },
            strategy: "standard",
            env_key: "OPENROUTER_API_KEYS",
            request_retry: {
              enabled: true,
              max_attempts: 3,
              delay: { min_ms: 150, max_ms: 300 },
            },
            key_cooldown: {
              enabled: true,
              initial_cooldown_ms: 10000,
              max_cooldown_ms: 60000,
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
            },
          },
        },
      };

      initProviderRegistry(mockRawProviders);
      initStrategyRegistry();

      const strategy = getStrategy("or");
      expect(strategy).toBeInstanceOf(StandardStrategy);
    });

    it("returns case-insensitive strategies for registered providers", () => {
      const mockRawProviders = {
        providers: {
          mock_provider: {
            code: "mp",
            base_url: "https://mock.provider.local",
            auth_header: "Bearer",
            endpoints: {
              ch: "/v1/chat/completions",
            },
            strategy: "standard",
            env_key: "MOCK_API_KEYS",
            request_retry: {
              enabled: true,
              max_attempts: 3,
              delay: { min_ms: 150, max_ms: 300 },
            },
            key_cooldown: {
              enabled: true,
              initial_cooldown_ms: 10000,
              max_cooldown_ms: 60000,
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
            },
          },
        },
      };

      initProviderRegistry(mockRawProviders);
      initStrategyRegistry();

      const lowerStrategy = getStrategy("mp");
      const upperStrategy = getStrategy("MP");

      expect(lowerStrategy).toBeInstanceOf(StandardStrategy);
      expect(upperStrategy).toBe(lowerStrategy);
    });

    it("allows dynamic registration of new strategy factories via registerStrategyFactory", () => {
      class MockCascadeStrategy implements ProviderExecutionStrategy {
        classifyFailure(): "advance_target" {
          return "advance_target";
        }
      }

      registerStrategyFactory("native_cascade", () => new MockCascadeStrategy());

      const mockRawProviders = {
        providers: {
          google_native: {
            code: "gg",
            base_url: "https://generativelanguage.googleapis.com",
            auth_header: "Bearer",
            endpoints: {
              ch: "/v1beta/openai/chat/completions",
            },
            strategy: "native_cascade",
            env_key: "GOOGLE_API_KEYS",
            request_retry: {
              enabled: true,
              max_attempts: 3,
              delay: { min_ms: 150, max_ms: 300 },
            },
            key_cooldown: {
              enabled: true,
              initial_cooldown_ms: 10000,
              max_cooldown_ms: 60000,
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
            },
          },
        },
      };

      initProviderRegistry(mockRawProviders);
      initStrategyRegistry();

      const strat = getStrategy("gg");
      expect(strat).toBeInstanceOf(MockCascadeStrategy);
      expect(strat.classifyFailure?.({} as DispatchContext, 404)).toBe("advance_target");
    });

    it("registers built-in specialized strategies automatically in initStrategyRegistry", () => {
      const mockRawProviders = {
        providers: {
          google: {
            code: "gg",
            base_url: "https://generativelanguage.googleapis.com",
            endpoints: { gc: "/v1beta/models/{model}:generateContent" },
            strategy: "native_cascade",
            ...mockOperationalKnobs,
          },
          gcp: {
            code: "gc",
            base_url: "https://generativelanguage.googleapis.com",
            endpoints: { ch: "/v1beta/openai/chat/completions" },
            strategy: "gcp_guarded",
            ...mockOperationalKnobs,
          },
          zen: {
            code: "zn",
            base_url: "https://opencode.ai/zen",
            endpoints: { ch: "/api/v1/chat/completions" },
            strategy: "zen_single_flight",
            ...mockOperationalKnobs,
          },
          anthropic: {
            code: "an",
            base_url: "https://api.anthropic.com",
            endpoints: { ms: "/v1/messages" },
            strategy: "anthropic_direct",
            ...mockOperationalKnobs,
          },
        },
      };

      initProviderRegistry(mockRawProviders);
      initStrategyRegistry();

      expect(getStrategy("gg")).toBeInstanceOf(NativeCascadeStrategy);
      expect(getStrategy("gc")).toBeInstanceOf(GcpGuardedStrategy);
      expect(getStrategy("zn")).toBeInstanceOf(ZenSingleFlightStrategy);
      expect(getStrategy("an")).toBeInstanceOf(AnthropicDirectStrategy);
    });

    it("gracefully falls back to StandardStrategy when provider strategy factory is missing", () => {
      const mockRawProviders = {
        providers: {
          unregistered_strat_prov: {
            code: "up",
            base_url: "https://unregistered.local",
            auth_header: "Bearer",
            endpoints: {
              ch: "/v1/chat/completions",
            },
            strategy: "zen_single_flight",
            ...mockOperationalKnobs,
          },
        },
      };

      initProviderRegistry(mockRawProviders);
      unregisterStrategyFactory("zen_single_flight");
      // initStrategyRegistry re-populates missing default factories,
      // so "up" resolves to the default ZenSingleFlightStrategy.
      initStrategyRegistry();
      expect(getStrategy("up")).toBeInstanceOf(ZenSingleFlightStrategy);

      // Unknown provider codes throw instead of falling back to StandardStrategy
      expect(() => getStrategy("unknown_code")).toThrow(
        "No strategy registered"
      );
    });

    it("resetStrategyRegistry clears both instantiated strategies and registered factories", () => {
      class TempStrategy implements ProviderExecutionStrategy {}
      registerStrategyFactory("native_cascade", () => new TempStrategy());

      const mockRawProviders = {
        providers: {
          temp_prov: {
            code: "tp",
            base_url: "https://temp.local",
            auth_header: "Bearer",
            endpoints: {
              ch: "/v1/chat/completions",
            },
            strategy: "native_cascade",
            ...mockOperationalKnobs,
          },
        },
      };

      initProviderRegistry(mockRawProviders);
      initStrategyRegistry();
      expect(getStrategy("tp")).toBeInstanceOf(TempStrategy);

      resetStrategyRegistry();
      expect(() => getStrategy("tp")).toThrow("No strategy registered");

      // Re-init without custom factory should instantiate default NativeCascadeStrategy
      initStrategyRegistry();
      expect(getStrategy("tp")).toBeInstanceOf(NativeCascadeStrategy);
    });

    it("handles uninitialized provider store gracefully during initStrategyRegistry", () => {
      expect(() => initStrategyRegistry()).not.toThrow();
    });
  });
});
