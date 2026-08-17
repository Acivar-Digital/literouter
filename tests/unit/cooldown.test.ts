import { beforeEach, describe, expect, it } from "bun:test";
import {
  CooldownManager,
  computeStatusTtlSec,
  getExhaustionBackoffMs,
  parseResetDelay,
} from "../../src/network/cooldown";

describe("Cooldown Manager — Status Code Reason-Aware Mapping", () => {
  it("assigns 65s default cooldown on HTTP 429 rate limit", () => {
    const ttl = computeStatusTtlSec(429);
    expect(ttl).toBe(65);
  });

  it("assigns 10s cooldown on transient 5xx server errors", () => {
    expect(computeStatusTtlSec(500)).toBe(10);
    expect(computeStatusTtlSec(502)).toBe(10);
    expect(computeStatusTtlSec(503)).toBe(10);
    expect(computeStatusTtlSec(504)).toBe(10);
  });

  it("assigns 7 days cooldown on 401/403 auth errors", () => {
    expect(computeStatusTtlSec(401)).toBe(604800);
    expect(computeStatusTtlSec(403)).toBe(604800);
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

  it("clamps excessive delay to 7200s max threshold", () => {
    const headers = new Headers({ "retry-after": "999999" });
    const parsed = parseResetDelay(headers);
    expect(parsed.delayMs).toBe(7200000);
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
});

describe("Cooldown Manager — Pool Exhaustion Ladder Backoff", () => {
  it("calculates 3-step ladder backoff delays", () => {
    expect(getExhaustionBackoffMs(0)).toBe(65000);
    expect(getExhaustionBackoffMs(1)).toBe(90000);
    expect(getExhaustionBackoffMs(2)).toBe(120000);
    expect(getExhaustionBackoffMs(3)).toBe(120000);
  });
});

describe("Cooldown Manager — In-Memory Key State Management", () => {
  let manager: CooldownManager;

  beforeEach(() => {
    manager = new CooldownManager();
  });

  it("quarantines key and tracks remaining cooldown ms", () => {
    expect(manager.isQuarantined("openrouter:0")).toBe(false);

    manager.quarantineKey("openrouter:0", 429);
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
    manager.quarantineKey("google:0", 429);
    manager.quarantineKey("google:1", 429);
    expect(manager.isQuarantined("google:0")).toBe(true);

    manager.clearAll();
    expect(manager.isQuarantined("google:0")).toBe(false);
    expect(manager.isQuarantined("google:1")).toBe(false);
  });
});
