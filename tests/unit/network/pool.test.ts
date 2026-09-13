import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  CooldownManager,
  RATE_LIMIT_DEFAULT_SEC,
  calculateMidnightUtcSec,
  computeStatusTtlSec,
  parseResetDelay,
} from "../../../src/network/cooldown";
import {
  FatalAuthError,
  KeyPool,
  isFatalAuthError,
} from "../../../src/network/pool";

describe("KeyPool & Cooldown — Fail-Fast 401/403 and Purged 65s Quarantine", () => {
  let pool: KeyPool;

  beforeEach(() => {
    pool = new KeyPool();
  });

  afterEach(() => {
    pool.reset();
  });

  describe("1. Fatal Auth Failures (401 & 403) — Fail-Fast with Zero Quarantine Lockout", () => {
    it("immediately throws FatalAuthError on 401 Unauthorized", () => {
      pool.setPool("prov", ["sk-key-1", "sk-key-2"]);

      expect(() => {
        pool.reportFailure("prov", 0, 401);
      }).toThrow(FatalAuthError);
    });

    it("immediately throws FatalAuthError on 403 Forbidden", () => {
      pool.setPool("prov", ["sk-key-1", "sk-key-2"]);

      expect(() => {
        pool.reportFailure("prov", 0, 403);
      }).toThrow(FatalAuthError);
    });

    it("does NOT quarantine the key for 24 hours on 401 or 403", () => {
      pool.setPool("prov", ["sk-key-1", "sk-key-2"]);
      const now = 1000000;

      try {
        pool.reportFailure("prov", 0, 401, undefined, undefined, now);
      } catch (err) {
        expect(isFatalAuthError(err)).toBe(true);
      }

      // The key MUST NOT be quarantined in CooldownManager
      expect(pool.getCooldownManager().isQuarantined("prov:0", now)).toBe(false);
      expect(pool.getCooldownManager().getRemainingMs("prov:0", now)).toBe(0);

      // Key 0 must remain selectable and not locked out for 24h
      const selected = pool.selectNextKey("prov", now);
      expect(selected?.key).toBe("sk-key-1");
      expect(selected?.index).toBe(0);
    });

    it("does NOT escalate through a 24-hour lockout table (300s -> 1800s -> 86400s)", () => {
      pool.setPool("prov", ["sk-key-1"]);
      const now = 2000000;

      // Consecutive auth failures
      for (let i = 0; i < 5; i++) {
        expect(() => {
          pool.reportFailure("prov", 0, 401, undefined, undefined, now);
        }).toThrow(FatalAuthError);

        expect(pool.getCooldownManager().isQuarantined("prov:0", now)).toBe(false);
        expect(pool.getConsecutiveAuthFailures("prov", 0)).toBe(0);
      }
    });

    it("validates isFatalAuthError helper on FatalAuthError instances", () => {
      const err401 = new FatalAuthError("testprov", 1, 401);
      expect(err401.status).toBe(401);
      expect(err401.provider).toBe("testprov");
      expect(err401.keyIndex).toBe(1);
      expect(err401.isFatal).toBe(true);
      expect(isFatalAuthError(err401)).toBe(true);

      const standardError = new Error("Generic failure");
      expect(isFatalAuthError(standardError)).toBe(false);
      expect(isFatalAuthError(null)).toBe(false);
      expect(isFatalAuthError(undefined)).toBe(false);
    });
  });

  describe("2. Generic 429 Rate Limits — Zero Reactive 65s Quarantine Lockout", () => {
    it("has RATE_LIMIT_DEFAULT_SEC = 0", () => {
      expect(RATE_LIMIT_DEFAULT_SEC).toBe(0);
      expect(computeStatusTtlSec(429)).toBe(0);
    });

    it("does NOT quarantine keys on generic HTTP 429 without Retry-After", () => {
      pool.setPool("prov", ["sk-key-1", "sk-key-2"]);
      const now = 3000000;

      const state = pool.reportFailure("prov", 0, 429, undefined, undefined, now);

      // Quarantine duration must be 0 ms
      expect(state.quarantinedUntil).toBe(now);
      expect(pool.getCooldownManager().isQuarantined("prov:0", now)).toBe(false);
      expect(pool.getCooldownManager().getRemainingMs("prov:0", now)).toBe(0);

      // Key 0 must not be locked out and can be selected immediately
      const nextKey = pool.selectNextKey("prov", now);
      expect(nextKey?.key).toBe("sk-key-1");
    });

    it("returns delayMs = 0 in parseResetDelay for generic 429 without headers or body", () => {
      const parsed = parseResetDelay();
      expect(parsed.delayMs).toBe(0);
      expect(parsed.isGraceRetry).toBe(false);
    });
  });

  describe("3. Explicit 429 Delays & Clamps — Respects Explicit Directives", () => {
    it("respects explicit Retry-After numeric header", () => {
      pool.setPool("prov", ["sk-key-1"]);
      const now = 4000000;
      const headers = new Headers({ "retry-after": "120" });

      const state = pool.reportFailure("prov", 0, 429, headers, undefined, now);

      expect(state.quarantinedUntil).toBe(now + 120000);
      expect(pool.getCooldownManager().isQuarantined("prov:0", now)).toBe(true);
      expect(pool.getCooldownManager().getRemainingMs("prov:0", now)).toBe(120000);
    });

    it("respects explicit customTtlSec parameter on reportFailure", () => {
      pool.setPool("prov", ["sk-key-1", "sk-key-2"]);
      const now = 5000000;

      const state = pool.reportFailure("prov", 0, 429, undefined, undefined, now, 45);

      expect(state.quarantinedUntil).toBe(now + 45000);
      expect(pool.getCooldownManager().isQuarantined("prov:0", now)).toBe(true);
      expect(pool.getCooldownManager().getRemainingMs("prov:0", now)).toBe(45000);

      // Key 1 should be selected since Key 0 is explicitly quarantined
      const nextKey = pool.selectNextKey("prov", now);
      expect(nextKey?.key).toBe("sk-key-2");
    });

    it("clamps sub-minimum delay to 5s min threshold", () => {
      const headers = new Headers({ "retry-after": "3" });
      const parsed = parseResetDelay(headers);
      expect(parsed.delayMs).toBe(5000);
    });

    it("flags sub-2s delay for immediate grace retry", () => {
      const headers = new Headers({ "retry-after": "1.5" });
      const parsed = parseResetDelay(headers);
      expect(parsed.delayMs).toBe(1500);
      expect(parsed.isGraceRetry).toBe(true);
    });

    it("purges 2-hour clamp so large delays are not capped to 7200s", () => {
      const headers = new Headers({ "retry-after": "999999" });
      const parsed = parseResetDelay(headers);
      // Previously clamped to 7200000ms; now unconstrained
      expect(parsed.delayMs).toBe(999999000);
    });
  });

  describe("4. Explicit Conserve Rules — conserveKey Functionality", () => {
    it("retains conserveKey for explicit quota exhaustion (e.g. OpenRouter)", () => {
      pool.setPool("openrouter", ["sk-or-key-1", "sk-or-key-2"]);
      const now = 6000000;

      const state = pool.conserveKey("openrouter", 0, 3600, "daily_quota_exhausted", 429, now);

      expect(state.quarantinedUntil).toBe(now + 3600000);
      expect(state.reason).toBe("daily_quota_exhausted");
      expect(pool.getCooldownManager().isQuarantined("openrouter:0", now)).toBe(true);
      expect(pool.getCooldownManager().getRemainingMs("openrouter:0", now)).toBe(3600000);

      // Key 1 is selected
      const selected = pool.selectNextKey("openrouter", now);
      expect(selected?.key).toBe("sk-or-key-2");
    });

    it("calculates midnight UTC sec with 60s buffer via calculateMidnightUtcSec", () => {
      const testDateMs = Date.UTC(2026, 8, 13, 23, 59, 0, 0);
      const ttlSec = calculateMidnightUtcSec(testDateMs);
      expect(ttlSec).toBe(120); // 60s to midnight + 60s buffer
    });

    it("integrates calculateMidnightUtcSec with conserveKey", () => {
      pool.setPool("openrouter", ["sk-or-key-1"]);
      const now = Date.UTC(2026, 8, 13, 23, 50, 0, 0); // 10 mins before midnight
      const ttlSec = calculateMidnightUtcSec(now); // 600s + 60s = 660s

      const state = pool.conserveKey("openrouter", 0, ttlSec, "midnight_conserve", 429, now);
      expect(state.quarantinedUntil).toBe(now + 660000);
      expect(pool.getCooldownManager().isQuarantined("openrouter:0", now)).toBe(true);
    });
  });

  describe("5. Pool Lifecycle, Round-Robin and Reset", () => {
    it("round-robins across active non-quarantined keys", () => {
      pool.setPool("prov", ["k1", "k2", "k3"]);

      expect(pool.selectNextKey("prov")?.key).toBe("k1");
      expect(pool.selectNextKey("prov")?.key).toBe("k2");
      expect(pool.selectNextKey("prov")?.key).toBe("k3");
      expect(pool.selectNextKey("prov")?.key).toBe("k1");
    });

    it("clears all quarantined state on reset()", () => {
      pool.setPool("prov", ["k1"]);
      const now = 7000000;
      pool.conserveKey("prov", 0, 300, "conserve", 429, now);

      expect(pool.getCooldownManager().isQuarantined("prov:0", now)).toBe(true);
      pool.reset();
      expect(pool.getCooldownManager().isQuarantined("prov:0", now)).toBe(false);
    });
  });
});
