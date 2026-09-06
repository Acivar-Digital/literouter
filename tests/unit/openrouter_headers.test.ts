import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as fs from "node:fs";
import {
  buildAuthHeaders,
  resetProvidersRegistryCache,
  resolveUpstreamEndpoint,
} from "../../src/handlers/openai_compat";

describe("Declarative Provider Headers & Cache Hot-Reload", () => {
  beforeEach(() => {
    resetProvidersRegistryCache();
  });

  afterEach(() => {
    resetProvidersRegistryCache();
  });

  describe("buildAuthHeaders", () => {
    it("injects declarative headers for OpenRouter (provider 'or' and 'openrouter')", () => {
      const orHeaders = buildAuthHeaders("Bearer", "sk-mock-or-key", "or");
      expect(orHeaders["Authorization"]).toBe("Bearer sk-mock-or-key");
      expect(orHeaders["Content-Type"]).toBe("application/json");
      expect(orHeaders["Accept-Encoding"]).toBe("identity");
      expect(orHeaders["HTTP-Referer"]).toBe("https://opencode.ai");
      expect(orHeaders["X-Title"]).toBe("OpenCode");
      expect(orHeaders["User-Agent"]).toBe("OpenCode/1.18.29");
      expect(orHeaders["Referer"]).toBeUndefined();

      const openrouterHeaders = buildAuthHeaders("Bearer", "sk-mock-or-key", "openrouter");
      expect(openrouterHeaders["Authorization"]).toBe("Bearer sk-mock-or-key");
      expect(openrouterHeaders["HTTP-Referer"]).toBe("https://opencode.ai");
      expect(openrouterHeaders["X-Title"]).toBe("OpenCode");
      expect(openrouterHeaders["User-Agent"]).toBe("OpenCode/1.18.29");
      expect(openrouterHeaders["Referer"]).toBeUndefined();
    });

    it("injects declarative headers for Zen (provider 'zn' and 'zen')", () => {
      const znHeaders = buildAuthHeaders("Bearer", "sk-mock-zn-key", "zn");
      expect(znHeaders["Authorization"]).toBe("Bearer sk-mock-zn-key");
      expect(znHeaders["Content-Type"]).toBe("application/json");
      expect(znHeaders["Accept-Encoding"]).toBe("identity");
      expect(znHeaders["HTTP-Referer"]).toBe("https://opencode.ai");
      expect(znHeaders["Referer"]).toBe("https://opencode.ai");
      expect(znHeaders["X-Title"]).toBe("OpenCode");
      expect(znHeaders["User-Agent"]).toBe("OpenCode/1.18.29");

      const zenHeaders = buildAuthHeaders("Bearer", "sk-mock-zen-key", "zen");
      expect(zenHeaders["Authorization"]).toBe("Bearer sk-mock-zen-key");
      expect(zenHeaders["HTTP-Referer"]).toBe("https://opencode.ai");
      expect(zenHeaders["Referer"]).toBe("https://opencode.ai");
      expect(zenHeaders["X-Title"]).toBe("OpenCode");
      expect(zenHeaders["User-Agent"]).toBe("OpenCode/1.18.29");
    });

    it("does not inject whitelist headers for non-configured providers ('nv', 'nvidia', 'gg', 'google')", () => {
      const nvHeaders = buildAuthHeaders("Bearer", "nvapi-mock-key", "nv");
      expect(nvHeaders["Authorization"]).toBe("Bearer nvapi-mock-key");
      expect(nvHeaders["HTTP-Referer"]).toBeUndefined();
      expect(nvHeaders["Referer"]).toBeUndefined();
      expect(nvHeaders["X-Title"]).toBeUndefined();
      expect(nvHeaders["User-Agent"]).toBeUndefined();

      const nvidiaHeaders = buildAuthHeaders("Bearer", "nvapi-mock-key", "nvidia");
      expect(nvidiaHeaders["Authorization"]).toBe("Bearer nvapi-mock-key");
      expect(nvidiaHeaders["HTTP-Referer"]).toBeUndefined();
      expect(nvidiaHeaders["Referer"]).toBeUndefined();
      expect(nvidiaHeaders["X-Title"]).toBeUndefined();
      expect(nvidiaHeaders["User-Agent"]).toBeUndefined();

      const ggHeaders = buildAuthHeaders("Bearer", "AIza-mock-key", "gg");
      expect(ggHeaders["Authorization"]).toBe("Bearer AIza-mock-key");
      expect(ggHeaders["x-goog-api-key"]).toBe("AIza-mock-key");
      expect(ggHeaders["HTTP-Referer"]).toBeUndefined();
      expect(ggHeaders["Referer"]).toBeUndefined();
      expect(ggHeaders["X-Title"]).toBeUndefined();
      expect(ggHeaders["User-Agent"]).toBeUndefined();

      const googleHeaders = buildAuthHeaders("Bearer", "AIza-mock-key", "google");
      expect(googleHeaders["Authorization"]).toBe("Bearer AIza-mock-key");
      expect(googleHeaders["HTTP-Referer"]).toBeUndefined();
      expect(googleHeaders["Referer"]).toBeUndefined();
      expect(googleHeaders["X-Title"]).toBeUndefined();
      expect(googleHeaders["User-Agent"]).toBeUndefined();
    });
  });

  describe("resolveUpstreamEndpoint", () => {
    it("returns headers dictionary matching config/providers.json for 'or'", () => {
      const endpoint = resolveUpstreamEndpoint("or", "ch", "openai/gpt-4o");
      expect(endpoint.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai",
        "X-Title": "OpenCode",
        "User-Agent": "OpenCode/1.18.29",
      });
    });

    it("returns headers dictionary matching config/providers.json for 'zn'", () => {
      const endpoint = resolveUpstreamEndpoint("zn", "ch", "big-pickle");
      expect(endpoint.headers).toEqual({
        "HTTP-Referer": "https://opencode.ai",
        "Referer": "https://opencode.ai",
        "X-Title": "OpenCode",
        "User-Agent": "OpenCode/1.18.29",
      });
    });

    it("returns empty headers dictionary for providers without custom headers ('nv', fallback)", () => {
      const nvEndpoint = resolveUpstreamEndpoint("nv", "ch", "nvidia/nemotron-3-super-120b-a12b");
      expect(nvEndpoint.headers).toEqual({});

      const unknownEndpoint = resolveUpstreamEndpoint("nonexistent-provider", "ch", "some-model");
      expect(unknownEndpoint.headers).toEqual({});
    });
  });

  describe("resetProvidersRegistryCache", () => {
    it("caches the registry across consecutive calls until reset", () => {
      let readCount = 0;
      const originalReadFileSync = fs.readFileSync;
      const fsSpy = (spyOn(fs, "readFileSync") as any).mockImplementation((...args: any[]) => {
        readCount++;
        return (originalReadFileSync as any)(...args);
      });

      try {
        resetProvidersRegistryCache();

        resolveUpstreamEndpoint("or", "ch", "test-model");
        expect(readCount).toBe(1);

        resolveUpstreamEndpoint("or", "ch", "test-model");
        expect(readCount).toBe(1);

        resetProvidersRegistryCache();

        resolveUpstreamEndpoint("or", "ch", "test-model");
        expect(readCount).toBe(2);
      } finally {
        fsSpy.mockRestore();
        resetProvidersRegistryCache();
      }
    });

    it("re-reads config/providers.json dynamically on demand after reset", () => {
      const mockCustomProviders = JSON.stringify({
        providers: {
          customprovider: {
            code: "cp",
            base_url: "https://api.customprovider.ai",
            auth_header: "Bearer",
            headers: {
              "X-Dynamic-Header": "dynamic-value-123",
              "User-Agent": "DynamicTester/1.0",
            },
            endpoints: {
              ch: "/v1/chat/completions",
            },
          },
        },
      });

      const fsSpy = spyOn(fs, "readFileSync").mockReturnValue(mockCustomProviders);

      try {
        resetProvidersRegistryCache();

        const endpoint = resolveUpstreamEndpoint("cp", "ch", "custom-model");
        expect(endpoint.headers).toEqual({
          "X-Dynamic-Header": "dynamic-value-123",
          "User-Agent": "DynamicTester/1.0",
        });

        const authHeaders = buildAuthHeaders("Bearer", "mock-custom-token", "cp");
        expect(authHeaders["X-Dynamic-Header"]).toBe("dynamic-value-123");
        expect(authHeaders["User-Agent"]).toBe("DynamicTester/1.0");
      } finally {
        fsSpy.mockRestore();
        resetProvidersRegistryCache();
      }
    });
  });
});
