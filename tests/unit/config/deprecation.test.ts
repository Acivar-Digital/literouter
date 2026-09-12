import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { emitEnvDeprecationWarnings, DEPRECATED_ENV_VARS } from "../../../src/config/deprecation";
import { resetEnvCache } from "../../../src/config/env";

describe("Deprecation Warnings — v4.1 vs Legacy Engine", () => {
  const originalEnv = { ...process.env };
  let warnSpy: ReturnType<typeof spyOn>;
  let warningsEmitted: string[] = [];

  beforeEach(() => {
    resetEnvCache();
    warningsEmitted = [];
    warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
      warningsEmitted.push(args.map(String).join(" "));
    });
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env = { ...originalEnv };
    resetEnvCache();
  });

  it("emits no warnings in legacy mode even if deprecated env vars are set", () => {
    process.env.LITEROUTER_ENGINE = "legacy";
    process.env.LITEROUTER_AUTH_KEY = "test-legacy-auth-key";
    process.env.OPENROUTER_BASE_URL = "https://custom.openrouter.test";
    process.env.GCP_ENABLE_RETRIES = "true";
    resetEnvCache();

    emitEnvDeprecationWarnings();

    expect(warningsEmitted.length).toBe(0);
  });

  it("emits warnings in v4.1 mode when deprecated env vars are present", () => {
    process.env.LITEROUTER_ENGINE = "v4.1";
    process.env.LITEROUTER_AUTH_KEY = "test-auth-key";
    process.env.LITEROUTER_PACER_MAX_RPM = "1200";
    process.env.ZEN_ENABLE_RETRIES = "true";
    resetEnvCache();

    emitEnvDeprecationWarnings();

    expect(warningsEmitted.length).toBeGreaterThanOrEqual(3);

    const authWarning = warningsEmitted.find((msg) =>
      msg.includes("LITEROUTER_AUTH_KEY")
    );
    expect(authWarning).toBeDefined();
    expect(authWarning).toContain("⚠️  [DEPRECATION]");
    expect(authWarning).toContain("IGNORED in v4.1 engine");
    expect(authWarning).toContain(DEPRECATED_ENV_VARS.LITEROUTER_AUTH_KEY);

    const pacerWarning = warningsEmitted.find((msg) =>
      msg.includes("LITEROUTER_PACER_MAX_RPM")
    );
    expect(pacerWarning).toBeDefined();
    expect(pacerWarning).toContain(DEPRECATED_ENV_VARS.LITEROUTER_PACER_MAX_RPM);

    const zenWarning = warningsEmitted.find((msg) =>
      msg.includes("ZEN_ENABLE_RETRIES")
    );
    expect(zenWarning).toBeDefined();
    expect(zenWarning).toContain(DEPRECATED_ENV_VARS.ZEN_ENABLE_RETRIES);
  });

  it("emits no warnings in v4.1 mode when no deprecated env vars are set", () => {
    process.env.LITEROUTER_ENGINE = "v4.1";
    // Delete any deprecated env var that might exist in environment
    for (const key of Object.keys(DEPRECATED_ENV_VARS)) {
      delete process.env[key];
    }
    resetEnvCache();

    emitEnvDeprecationWarnings();

    expect(warningsEmitted.length).toBe(0);
  });

  it("emits exactly one warning per deprecated var set", () => {
    process.env.LITEROUTER_ENGINE = "v4.1";
    for (const key of Object.keys(DEPRECATED_ENV_VARS)) {
      delete process.env[key];
    }
    process.env.LITEROUTER_AUTH_KEY = "test-auth-key";
    process.env.LITEROUTER_PACER_ENABLED = "false";
    process.env.COOLDOWN_SERVER_ERROR_TTL_SEC = "30";
    resetEnvCache();

    emitEnvDeprecationWarnings();

    expect(warningsEmitted.length).toBe(3);
    expect(warningsEmitted.some((msg) => msg.includes("LITEROUTER_AUTH_KEY"))).toBe(true);
    expect(warningsEmitted.some((msg) => msg.includes("LITEROUTER_PACER_ENABLED"))).toBe(true);
    expect(warningsEmitted.some((msg) => msg.includes("COOLDOWN_SERVER_ERROR_TTL_SEC"))).toBe(true);
  });

  it("emits the correct migration message for LITEROUTER_PACER_ENABLED", () => {
    process.env.LITEROUTER_ENGINE = "v4.1";
    for (const key of Object.keys(DEPRECATED_ENV_VARS)) {
      delete process.env[key];
    }
    process.env.LITEROUTER_PACER_ENABLED = "false";
    resetEnvCache();

    emitEnvDeprecationWarnings();

    expect(warningsEmitted.length).toBe(1);
    expect(warningsEmitted[0]).toContain("LITEROUTER_PACER_ENABLED");
    expect(warningsEmitted[0]).toContain(DEPRECATED_ENV_VARS.LITEROUTER_PACER_ENABLED);
  });

  it("emits warnings under the default engine without LITEROUTER_ENGINE set", () => {
    delete process.env.LITEROUTER_ENGINE;
    for (const key of Object.keys(DEPRECATED_ENV_VARS)) {
      delete process.env[key];
    }
    process.env.ZEN_ENABLE_PACER = "false";
    resetEnvCache();

    emitEnvDeprecationWarnings();

    expect(warningsEmitted.length).toBe(1);
    expect(warningsEmitted[0]).toContain("ZEN_ENABLE_PACER");
    expect(warningsEmitted[0]).toContain(DEPRECATED_ENV_VARS.ZEN_ENABLE_PACER);
  });
});
