import { describe, expect, it } from "bun:test";
import { buildAuthHeaders } from "../../src/handlers/openai_compat";
import { resetEnvCache } from "../../src/config/env";

describe("OpenRouter Whitelist & Attribution Headers", () => {
  it("injects OpenCode agentic whitelist headers for OpenRouter (provider 'or')", () => {
    resetEnvCache();
    const headers = buildAuthHeaders("Bearer", "sk-mock-or-key", "or");

    expect(headers["Authorization"]).toBe("Bearer sk-mock-or-key");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["Accept-Encoding"]).toBe("identity");
    expect(headers["HTTP-Referer"]).toBe("https://opencode.ai");
    expect(headers["X-Title"]).toBe("OpenCode");
    expect(headers["User-Agent"]).toBe("OpenCode/1.0.0");
  });

  it("injects headers when provider is 'openrouter'", () => {
    resetEnvCache();
    const headers = buildAuthHeaders("Bearer", "sk-mock-or-key", "openrouter");

    expect(headers["HTTP-Referer"]).toBe("https://opencode.ai");
    expect(headers["X-Title"]).toBe("OpenCode");
    expect(headers["User-Agent"]).toBe("OpenCode/1.0.0");
  });

  it("does not inject OpenRouter headers for other providers (nv, gg)", () => {
    resetEnvCache();
    const nvHeaders = buildAuthHeaders("Bearer", "nvapi-mock-key", "nv");
    expect(nvHeaders["HTTP-Referer"]).toBeUndefined();
    expect(nvHeaders["X-Title"]).toBeUndefined();
    expect(nvHeaders["User-Agent"]).toBeUndefined();

    const ggHeaders = buildAuthHeaders("Bearer", "AIza-mock-key", "gg");
    expect(ggHeaders["HTTP-Referer"]).toBeUndefined();
    expect(ggHeaders["X-Title"]).toBeUndefined();
    expect(ggHeaders["User-Agent"]).toBeUndefined();
    expect(ggHeaders["x-goog-api-key"]).toBe("AIza-mock-key");
  });

  it("injects OpenCode agentic headers for Zen (provider 'zn' and 'zen')", () => {
    resetEnvCache();
    const znHeaders = buildAuthHeaders("Bearer", "sk-zn-mock-key", "zn");
    expect(znHeaders["Authorization"]).toBe("Bearer sk-zn-mock-key");
    expect(znHeaders["Content-Type"]).toBe("application/json");
    expect(znHeaders["Accept-Encoding"]).toBe("identity");
    expect(znHeaders["HTTP-Referer"]).toBe("https://opencode.ai");
    expect(znHeaders["Referer"]).toBe("https://opencode.ai");
    expect(znHeaders["X-Title"]).toBe("OpenCode");
    expect(znHeaders["User-Agent"]).toBe("OpenCode/1.0.0");

    const zenHeaders = buildAuthHeaders("Bearer", "sk-zen-mock-key", "zen");
    expect(zenHeaders["Authorization"]).toBe("Bearer sk-zen-mock-key");
    expect(zenHeaders["HTTP-Referer"]).toBe("https://opencode.ai");
    expect(zenHeaders["Referer"]).toBe("https://opencode.ai");
    expect(zenHeaders["X-Title"]).toBe("OpenCode");
    expect(zenHeaders["User-Agent"]).toBe("OpenCode/1.0.0");
  });

  it("respects custom env configuration (e.g. unknown or custom harness)", () => {
    const originalRef = process.env.LITEROUTER_HTTP_REFERER;
    const originalTitle = process.env.LITEROUTER_X_TITLE;
    const originalUA = process.env.LITEROUTER_USER_AGENT;

    try {
      process.env.LITEROUTER_HTTP_REFERER = "https://example.com/custom";
      process.env.LITEROUTER_X_TITLE = "custom-agent";
      process.env.LITEROUTER_USER_AGENT = "unknown";
      resetEnvCache();

      const headers = buildAuthHeaders("Bearer", "sk-mock-or-key", "or");
      expect(headers["HTTP-Referer"]).toBe("https://example.com/custom");
      expect(headers["X-Title"]).toBe("custom-agent");
      expect(headers["User-Agent"]).toBe("unknown");
    } finally {
      if (originalRef !== undefined) process.env.LITEROUTER_HTTP_REFERER = originalRef;
      else delete process.env.LITEROUTER_HTTP_REFERER;

      if (originalTitle !== undefined) process.env.LITEROUTER_X_TITLE = originalTitle;
      else delete process.env.LITEROUTER_X_TITLE;

      if (originalUA !== undefined) process.env.LITEROUTER_USER_AGENT = originalUA;
      else delete process.env.LITEROUTER_USER_AGENT;

      resetEnvCache();
    }
  });
});
