import { describe, expect, it } from "bun:test";
import { ZodError } from "zod";
import rawProviders from "../../config/providers.json";
import { ProvidersConfigSchema } from "../../src/config/schema";
import { initProviderRegistry } from "../../src/config/providers";

describe("Strict Provider Schema Tamper & Fail-Loud Tests", () => {
  it("Test 1: Real config/providers.json passes validation cleanly", () => {
    const result = ProvidersConfigSchema.safeParse(rawProviders);
    expect(result.success).toBe(true);
    expect(() => initProviderRegistry(rawProviders)).not.toThrow();
  });

  it("Test 2: Deleting pacer from any provider causes validation to FAIL LOUDLY with ZodError", () => {
    const tampered = JSON.parse(JSON.stringify(rawProviders));
    delete tampered.providers.openrouter.pacer;

    const result = ProvidersConfigSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      const hasMissingPacer = result.error.issues.some(
        (issue) =>
          issue.path.join(".") === "providers.openrouter.pacer" &&
          issue.message === "Required"
      );
      expect(hasMissingPacer).toBe(true);
    }
    expect(() => initProviderRegistry(tampered)).toThrow(ZodError);
  });

  it("Test 3: Deleting circuit_breaker causes validation to FAIL LOUDLY with ZodError", () => {
    const tampered = JSON.parse(JSON.stringify(rawProviders));
    delete tampered.providers.nvidia.circuit_breaker;

    const result = ProvidersConfigSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      const hasMissingCb = result.error.issues.some(
        (issue) =>
          issue.path.join(".") === "providers.nvidia.circuit_breaker" &&
          issue.message === "Required"
      );
      expect(hasMissingCb).toBe(true);
    }
    expect(() => initProviderRegistry(tampered)).toThrow(ZodError);
  });

  it("Test 4: Deleting key_cooldown causes validation to FAIL LOUDLY with ZodError", () => {
    const tampered = JSON.parse(JSON.stringify(rawProviders));
    delete tampered.providers.google.key_cooldown;

    const result = ProvidersConfigSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      const hasMissingCooldown = result.error.issues.some(
        (issue) =>
          issue.path.join(".") === "providers.google.key_cooldown" &&
          issue.message === "Required"
      );
      expect(hasMissingCooldown).toBe(true);
    }
    expect(() => initProviderRegistry(tampered)).toThrow(ZodError);
  });

  it("Test 5: Deleting request_retry causes validation to FAIL LOUDLY with ZodError", () => {
    const tampered = JSON.parse(JSON.stringify(rawProviders));
    delete tampered.providers.zen.request_retry;

    const result = ProvidersConfigSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      const hasMissingRetry = result.error.issues.some(
        (issue) =>
          issue.path.join(".") === "providers.zen.request_retry" &&
          issue.message === "Required"
      );
      expect(hasMissingRetry).toBe(true);
    }
    expect(() => initProviderRegistry(tampered)).toThrow(ZodError);
  });

  it("Test 6: Deleting env_key causes validation to FAIL LOUDLY with ZodError", () => {
    const tampered = JSON.parse(JSON.stringify(rawProviders));
    delete tampered.providers.gcp.env_key;

    const result = ProvidersConfigSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      const hasMissingEnvKey = result.error.issues.some(
        (issue) =>
          issue.path.join(".") === "providers.gcp.env_key" &&
          issue.message === "Required"
      );
      expect(hasMissingEnvKey).toBe(true);
    }
    expect(() => initProviderRegistry(tampered)).toThrow(ZodError);
  });

  it("Test 7: Deleting min_delay_ms inside pacer causes validation to FAIL LOUDLY with ZodError", () => {
    const tampered = JSON.parse(JSON.stringify(rawProviders));
    delete tampered.providers.openrouter.pacer.min_delay_ms;

    const result = ProvidersConfigSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      const hasMissingMinDelay = result.error.issues.some(
        (issue) =>
          issue.path.join(".") === "providers.openrouter.pacer.min_delay_ms" &&
          issue.message === "Required"
      );
      expect(hasMissingMinDelay).toBe(true);
    }
    expect(() => initProviderRegistry(tampered)).toThrow(ZodError);
  });

  it("Test 8: Deleting max_attempts inside request_retry causes validation to FAIL LOUDLY with ZodError", () => {
    const tampered = JSON.parse(JSON.stringify(rawProviders));
    delete tampered.providers.nvidia.request_retry.max_attempts;

    const result = ProvidersConfigSchema.safeParse(tampered);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toBeInstanceOf(ZodError);
      const hasMissingAttempts = result.error.issues.some(
        (issue) =>
          issue.path.join(".") === "providers.nvidia.request_retry.max_attempts" &&
          issue.message === "Required"
      );
      expect(hasMissingAttempts).toBe(true);
    }
    expect(() => initProviderRegistry(tampered)).toThrow(ZodError);
  });
});
