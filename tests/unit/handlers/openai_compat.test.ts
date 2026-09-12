import { describe, expect, it, beforeEach } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getProviderEndpointConfig,
  resetProvidersRegistryCache,
  resolveUpstreamEndpoint,
  buildAuthHeaders,
} from "../../../src/handlers/openai_compat";
import { getProviderConfig, isRegisteredProvider } from "../../../src/config/providers";

describe("openai_compat handler unit tests", () => {
  beforeEach(() => {
    resetProvidersRegistryCache();
  });

  describe("getProviderEndpointConfig", () => {
    it("returns configuration for registered providers", () => {
      const orConfig = getProviderEndpointConfig("or");
      expect(orConfig).toBeDefined();
      expect(orConfig?.code).toBe("or");
      expect(orConfig?.base_url).toBe("https://openrouter.ai");
      expect(orConfig?.conserve_rules).toBeDefined();
      expect(Array.isArray(orConfig?.conserve_rules)).toBe(true);

      const znConfig = getProviderEndpointConfig("zn");
      expect(znConfig).toBeDefined();
      expect(znConfig?.code).toBe("zn");
      expect(znConfig?.base_url).toBe("https://opencode.ai/zen");

      const nvConfig = getProviderEndpointConfig("nv");
      expect(nvConfig).toBeDefined();
      expect(nvConfig?.code).toBe("nv");
    });

    it("returns undefined for unregistered providers", () => {
      const unknown = getProviderEndpointConfig("nonexistent_provider_xyz");
      expect(unknown).toBeUndefined();
    });

    it("matches getProviderConfig output for valid providers", () => {
      const viaEndpointConfig = getProviderEndpointConfig("or");
      const viaProviderConfig = getProviderConfig("or");

      expect(viaEndpointConfig?.code).toBe(viaProviderConfig.code);
      expect(viaEndpointConfig?.base_url).toBe(viaProviderConfig.base_url);
      expect(viaEndpointConfig?.auth_header).toBe(viaProviderConfig.auth_header);
      expect(viaEndpointConfig?.endpoints).toEqual(viaProviderConfig.endpoints);
    });
  });

  describe("request_retry configuration and zero-hardcoding", () => {
    it("provides deterministic retry counts from providers.json without hardcoding", () => {
      const znConfig = getProviderConfig("zn");
      expect(znConfig.request_retry.enabled).toBe(true);
      expect(znConfig.request_retry.max_attempts).toBe(1);

      const orConfig = getProviderConfig("or");
      expect(orConfig.request_retry.enabled).toBe(true);
      expect(orConfig.request_retry.max_attempts).toBe(3);

      const nvConfig = getProviderConfig("nv");
      expect(nvConfig.request_retry.enabled).toBe(true);
      expect(nvConfig.request_retry.max_attempts).toBe(3);
    });

    it("contains valid retry delay bounds for jitter computation", () => {
      const providers = ["or", "nv", "gg", "zn", "gc"];
      for (const prov of providers) {
        if (isRegisteredProvider(prov)) {
          const config = getProviderConfig(prov);
          const { min_ms, max_ms } = config.request_retry.delay;
          expect(min_ms).toBeGreaterThanOrEqual(0);
          expect(max_ms).toBeGreaterThanOrEqual(min_ms);

          // Test jitter formula
          const delayMs =
            min_ms < max_ms
              ? min_ms + Math.floor(Math.random() * (max_ms - min_ms + 1))
              : min_ms;
          expect(delayMs).toBeGreaterThanOrEqual(min_ms);
          expect(delayMs).toBeLessThanOrEqual(max_ms);
        }
      }
    });

    it("verifies source code does not contain hardcoded Math.min(3, ...) in openai_compat.ts", () => {
      const sourcePath = resolve(import.meta.dir, "../../../src/handlers/openai_compat.ts");
      const source = readFileSync(sourcePath, "utf-8");

      expect(source.includes("Math.min(3,")).toBe(false);
      expect(source.includes("isZenLoop && !env.ZEN_ENABLE_RETRIES")).toBe(false);
      expect(source.includes("getProvidersRegistry")).toBe(false);
      expect(source.includes("cachedRegistry")).toBe(false);
    });
  });

  describe("resolveUpstreamEndpoint and buildAuthHeaders", () => {
    it("resolves endpoint with model substitution for known provider", () => {
      const endpoint = resolveUpstreamEndpoint("or", "ch", "deepseek/deepseek-r1");
      expect(endpoint.url).toContain("openrouter.ai");
      expect(endpoint.url).toContain("/api/v1/chat/completions");
      expect(endpoint.authHeader).toBe("Bearer");
    });

    it("falls back to openrouter default for unknown provider", () => {
      const fallback = resolveUpstreamEndpoint("unknown_code", "ch", "some-model");
      expect(fallback.url).toContain("openrouter.ai");
    });

    it("builds correct auth headers for bearer and api-key providers", () => {
      const bearerHeaders = buildAuthHeaders("Bearer", "test-token-123", "or");
      expect(bearerHeaders["Authorization"]).toBe("Bearer test-token-123");
      expect(bearerHeaders["Content-Type"]).toBe("application/json");

      const apiKeyHeaders = buildAuthHeaders("x-api-key", "test-token-456");
      expect(apiKeyHeaders["x-api-key"]).toBe("test-token-456");
      expect(apiKeyHeaders["anthropic-version"]).toBe("2023-06-01");
    });
  });
});
