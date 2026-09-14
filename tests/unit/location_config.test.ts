import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { loadLocationConfig, LocationConfigSchema } from "../../src/config/location";

describe("Location Config - loadLocationConfig", () => {
  const testDir = "/tmp/opencode/test_location_config";
  const validCustomPath = join(testDir, "valid_location.json");
  const missingFieldPath = join(testDir, "missing_field.json");
  const invalidPortPath = join(testDir, "invalid_port.json");
  const malformedJsonPath = join(testDir, "malformed.json");

  beforeAll(() => {
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    writeFileSync(
      validCustomPath,
      JSON.stringify({
        host: "127.0.0.1",
        port: 8080,
        tls_enabled: true,
      })
    );

    writeFileSync(
      missingFieldPath,
      JSON.stringify({
        host: "127.0.0.1",
        port: 8080,
        // tls_enabled missing
      })
    );

    writeFileSync(
      invalidPortPath,
      JSON.stringify({
        host: "127.0.0.1",
        port: 99999, // out of range 1-65535
        tls_enabled: false,
      })
    );

    writeFileSync(malformedJsonPath, "{ not-valid-json }");
  });

  afterAll(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it("reads config/location.json successfully with valid fields", () => {
    const config = loadLocationConfig();
    expect(config).toBeDefined();
    expect(typeof config.host).toBe("string");
    expect(config.host.length).toBeGreaterThan(0);
    expect(typeof config.port).toBe("number");
    expect(config.port).toBeGreaterThanOrEqual(1);
    expect(config.port).toBeLessThanOrEqual(65535);
    expect(typeof config.tls_enabled).toBe("boolean");
  });

  it("reads a custom valid location configuration file successfully", () => {
    const config = loadLocationConfig(validCustomPath);
    expect(config).toEqual({
      host: "127.0.0.1",
      port: 8080,
      tls_enabled: true,
    });
  });

  it("throws [FATAL] Missing or invalid when given a path that doesn't exist", () => {
    expect(() => {
      loadLocationConfig("non/existent/path/location.json");
    }).toThrow(/\[FATAL\] Missing or invalid/);
  });

  it("throws [FATAL] Missing or invalid when missing required fields", () => {
    expect(() => {
      loadLocationConfig(missingFieldPath);
    }).toThrow(/\[FATAL\] Missing or invalid/);
  });

  it("throws [FATAL] Missing or invalid when given an invalid port", () => {
    expect(() => {
      loadLocationConfig(invalidPortPath);
    }).toThrow(/\[FATAL\] Missing or invalid/);
  });

  it("throws [FATAL] Missing or invalid when JSON is malformed", () => {
    expect(() => {
      loadLocationConfig(malformedJsonPath);
    }).toThrow(/\[FATAL\] Missing or invalid/);
  });

  describe("LocationConfigSchema validation directly", () => {
    it("accepts valid location config objects", () => {
      const valid = { host: "localhost", port: 7766, tls_enabled: false };
      expect(LocationConfigSchema.parse(valid)).toEqual(valid);
    });

    it("rejects empty host string", () => {
      const invalid = { host: "", port: 7766, tls_enabled: false };
      expect(() => LocationConfigSchema.parse(invalid)).toThrow();
    });

    it("rejects port 0 and negative ports", () => {
      expect(() =>
        LocationConfigSchema.parse({ host: "localhost", port: 0, tls_enabled: false })
      ).toThrow();
      expect(() =>
        LocationConfigSchema.parse({ host: "localhost", port: -1, tls_enabled: false })
      ).toThrow();
    });

    it("rejects non-integer ports", () => {
      expect(() =>
        LocationConfigSchema.parse({ host: "localhost", port: 80.5, tls_enabled: false })
      ).toThrow();
    });
  });
});
