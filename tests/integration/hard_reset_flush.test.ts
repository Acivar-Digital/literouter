import { beforeEach, describe, expect, it, spyOn } from "bun:test";
import {
  getCooldownState,
  handleAppRequest,
  handleHardReset,
  resetAllState,
} from "../../src/lib";
import * as providersModule from "../../src/config/providers";

describe("Operational Hard Reset & Flush Integration", () => {
  beforeEach(() => {
    resetAllState();
  });

  it("handles GET /reset and flushes all rate limits and quarantines", async () => {
    const req = new Request("http://localhost:7766/reset", {
      method: "GET",
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");

    const cooldowns = getCooldownState();
    expect(Object.keys(cooldowns).length).toBe(0);
  });

  it("handles POST /reset unfreezing quarantined key states and reloading registry", async () => {
    const req = new Request("http://localhost:7766/reset", {
      method: "POST",
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");

    // Verify registry is loaded and healthy
    const allProviders = providersModule.getAllProviders();
    expect(allProviders.length).toBeGreaterThanOrEqual(13);
    expect(providersModule.isRegisteredProvider("or")).toBe(true);
  });

  it("returns 500 and preserves previous registry when provider registry reload fails", () => {
    // Ensure initial registry is intact
    expect(providersModule.isRegisteredProvider("or")).toBe(true);
    const beforeConfig = providersModule.getProviderConfig("or");

    // Force initProviderRegistry to fail
    const originalInit = providersModule.initProviderRegistry;
    const initSpy = spyOn(providersModule, "initProviderRegistry").mockImplementation(() => {
      throw new Error("Simulated schema parse error on reload");
    });

    try {
      const res = handleHardReset();
      expect(res.status).toBe(500);

      // Previous config remains intact and active
      expect(providersModule.isRegisteredProvider("or")).toBe(true);
      const afterConfig = providersModule.getProviderConfig("or");
      expect(afterConfig.code).toBe(beforeConfig.code);
    } finally {
      initSpy.mockRestore();
      // Restore valid registry
      originalInit();
    }
  });
});
