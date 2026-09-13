import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetEnvCache } from "../../src/config/env";
import {
  CooldownManager,
  RATE_LIMIT_DEFAULT_SEC,
  calculateMidnightUtcSec,
  computeStatusTtlSec,
  parseResetDelay,
  resolveConserveTtlSec,
} from "../../src/network/cooldown";

let originalTtl: string | undefined;

beforeEach(() => {
  originalTtl = process.env.COOLDOWN_RATE_LIMIT_TTL_SEC;
  resetEnvCache();
});

afterEach(() => {
  if (originalTtl === undefined) {
    delete process.env.COOLDOWN_RATE_LIMIT_TTL_SEC;
  } else {
    process.env.COOLDOWN_RATE_LIMIT_TTL_SEC = originalTtl;
  }
  resetEnvCache();
});

describe("Cooldown Manager — Status Code Reason-Aware Mapping", () => {
  it("assigns 0s default cooldown on HTTP 429 rate limit (purged 65s reactive lockout)", () => {
    const ttl = computeStatusTtlSec(429);
    expect(ttl).toBe(0);
    expect(RATE_LIMIT_DEFAULT_SEC).toBe(0);
  });

  it("respects explicit configuredTtlSec on HTTP 429 rate limit", () => {
    expect(computeStatusTtlSec(429, 30)).toBe(30);
    expect(computeStatusTtlSec(429, 0)).toBe(0);
  });

  it("assigns 10s cooldown on transient 5xx server errors", () => {
    expect(computeStatusTtlSec(500)).toBe(10);
    expect(computeStatusTtlSec(502)).toBe(10);
    expect(computeStatusTtlSec(503)).toBe(10);
    expect(computeStatusTtlSec(504)).toBe(10);
  });

  it("assigns 0s cooldown on 401/403 auth errors (fatal fail fast, no quarantine)", () => {
    expect(computeStatusTtlSec(401)).toBe(0);
    expect(computeStatusTtlSec(403)).toBe(0);
  });

  it("assigns 0s cooldown on 400/404 client errors (no penalty on key)", () => {
    expect(computeStatusTtlSec(400)).toBe(0);
    expect(computeStatusTtlSec(404)).toBe(0);
  });

  it("assigns baseline 30s cooldown for unknown errors", () => {
    expect(computeStatusTtlSec(418)).toBe(30);
  });
});

describe("Cooldown Manager — Retry-After & Google Delay Parsing", () => {
  it("parses numeric Retry-After header", () => {
    const headers = new Headers({ "retry-after": "120" });
    const parsed = parseResetDelay(headers);
    expect(parsed.delayMs).toBe(120000);
    expect(parsed.isGraceRetry).toBe(false);
  });

  it("clamps sub-minimum delay to 5s min threshold", () => {
    const headers = new Headers({ "retry-after": "3" });
    const parsed = parseResetDelay(headers);
    expect(parsed.delayMs).toBe(5000);
  });

  it("does not clamp excessive delay to 7200s (2-hour clamp purged)", () => {
    const headers = new Headers({ "retry-after": "999999" });
    const parsed = parseResetDelay(headers);
    expect(parsed.delayMs).toBe(999999000);
  });

  it("parses Google JSON error quotaResetDelay string", () => {
    const headers = new Headers();
    const errorBody = JSON.stringify({
      error: {
        message: "Resource has been exhausted (e.g. check quota). quotaResetDelay: 45s",
      },
    });
    const parsed = parseResetDelay(headers, errorBody);
    expect(parsed.delayMs).toBe(45000);
    expect(parsed.isGraceRetry).toBe(false);
  });

  it("parses Google JSON error retryDelay field in details", () => {
    const headers = new Headers();
    const errorBody = JSON.stringify({
      error: {
        message: "retry-after: 15s",
      },
    });
    const parsed = parseResetDelay(headers, errorBody);
    expect(parsed.delayMs).toBe(15000);
  });

  it("flags sub-2s reset delays for immediate grace retry", () => {
    const headers = new Headers();
    const errorBody = JSON.stringify({
      error: { message: "quotaResetDelay: 1.5s" },
    });
    const parsed = parseResetDelay(headers, errorBody);
    expect(parsed.isGraceRetry).toBe(true);
    expect(parsed.delayMs).toBe(1500);
  });

  it("defaults to 0ms when no headers or body delay present (generic 429)", () => {
    const parsed = parseResetDelay();
    expect(parsed.delayMs).toBe(0);
    expect(parsed.isGraceRetry).toBe(false);
  });

  it("respects configuredTtlSec when no headers or body delay present", () => {
    const parsed = parseResetDelay(undefined, undefined, 45);
    expect(parsed.delayMs).toBe(45000);
    expect(parsed.isGraceRetry).toBe(false);
  });

  it("disables delay when configuredTtlSec is 0", () => {
    const parsed = parseResetDelay(undefined, undefined, 0);
    expect(parsed.delayMs).toBe(0);
    expect(parsed.isGraceRetry).toBe(false);
  });
});

describe("Cooldown Manager — In-Memory Key State Management", () => {
  let manager: CooldownManager;

  beforeEach(() => {
    manager = new CooldownManager();
  });

  it("does not quarantine key on generic 429 without Retry-After or custom TTL", () => {
    expect(manager.isQuarantined("openrouter:0")).toBe(false);

    manager.quarantineKey("openrouter:0", 429);
    expect(manager.isQuarantined("openrouter:0")).toBe(false);
    expect(manager.getRemainingMs("openrouter:0")).toBe(0);
  });

  it("quarantines key on 429 when explicit customTtlSec is passed", () => {
    expect(manager.isQuarantined("openrouter:0")).toBe(false);

    manager.quarantineKey("openrouter:0", 429, undefined, undefined, Date.now(), 65);
    expect(manager.isQuarantined("openrouter:0")).toBe(true);

    const remaining = manager.getRemainingMs("openrouter:0");
    expect(remaining).toBeGreaterThan(50000);
    expect(remaining).toBeLessThanOrEqual(65000);
  });

  it("reports unquarantined once cooldown epoch passes", () => {
    manager.quarantineKey("nvidia:1", 500, undefined, undefined, Date.now() - 20000);
    expect(manager.isQuarantined("nvidia:1")).toBe(false);
  });

  it("flushes all quarantined keys on clearAll", () => {
    manager.quarantineKey("google:0", 500);
    manager.quarantineKey("google:1", 500);
    expect(manager.isQuarantined("google:0")).toBe(true);

    manager.clearAll();
    expect(manager.isQuarantined("google:0")).toBe(false);
    expect(manager.isQuarantined("google:1")).toBe(false);
  });

  it("uses custom defaultRateLimitTtlSec from constructor", () => {
    const customManager = new CooldownManager(25);
    customManager.quarantineKey("provider:custom", 429);
    const remaining = customManager.getRemainingMs("provider:custom");
    expect(remaining).toBeGreaterThan(20000);
    expect(remaining).toBeLessThanOrEqual(25000);
  });
});

describe("Cooldown Manager — Midnight UTC & Conserve TTL Calculation", () => {
  it("calculates midnight UTC sec with 60s buffer", () => {
    // 2026-09-11T23:59:00.000Z is 60s before 2026-09-12T00:00:00.000Z
    const nowMs = Date.UTC(2026, 8, 11, 23, 59, 0, 0);
    const ttlSec = calculateMidnightUtcSec(nowMs);
    expect(ttlSec).toBe(120); // 60s diff + 60s buffer
  });

  it("calculates midnight UTC sec at noon UTC", () => {
    // 12 hours before midnight = 43200s + 60s buffer = 43260s
    const nowMs = Date.UTC(2026, 8, 11, 12, 0, 0, 0);
    const ttlSec = calculateMidnightUtcSec(nowMs);
    expect(ttlSec).toBe(43260);
  });

  it("resolves conserve TTL for midnight_utc", () => {
    const nowMs = Date.UTC(2026, 8, 11, 23, 59, 0, 0);
    expect(resolveConserveTtlSec("midnight_utc", nowMs)).toBe(120);
  });

  it("resolves conserve TTL for positive number", () => {
    expect(resolveConserveTtlSec(300)).toBe(300);
  });

  it("resolves conserve TTL fallback to midnight UTC for undefined or non-positive", () => {
    const nowMs = Date.UTC(2026, 8, 11, 23, 59, 0, 0);
    expect(resolveConserveTtlSec(undefined, nowMs)).toBe(120);
    expect(resolveConserveTtlSec(0, nowMs)).toBe(120);
    expect(resolveConserveTtlSec(-10, nowMs)).toBe(120);
  });
});
