import { describe, expect, it } from "bun:test";
import type { KeyCooldownConfig } from "../../../src/config/schema";
import { calculateCooldownMs } from "../../../src/engine/cooldown";
import { calculateRetryDelay } from "../../../src/engine/retry";
import {
  defaultClassifyFailure,
  FAIL_FAST_STATUSES,
  KEY_ROTATION_STATUSES,
  TRANSIENT_RETRY_STATUSES,
} from "../../../src/engine/status_classify";

describe("Slice 3.1: Math & Status Classification Utilities", () => {
  describe("calculateRetryDelay()", () => {
    it("returns deterministic value when min_ms === max_ms", () => {
      const delay = calculateRetryDelay({ min_ms: 250, max_ms: 250 }, 1);
      expect(delay).toBe(250);
    });

    it("handles inverted bounds where min_ms > max_ms", () => {
      for (let i = 0; i < 50; i++) {
        const delay = calculateRetryDelay({ min_ms: 300, max_ms: 150 }, i);
        expect(delay).toBeGreaterThanOrEqual(150);
        expect(delay).toBeLessThanOrEqual(300);
      }
    });

    it("1,000 statistical samples respect uniform bounds [min_ms, max_ms] and span interval", () => {
      const min_ms = 100;
      const max_ms = 500;
      const samples: number[] = [];
      const buckets = 5;
      const bucketCounts = new Array(buckets).fill(0);
      const bucketSize = (max_ms - min_ms) / buckets;

      for (let i = 0; i < 2000; i++) {
        const sample = calculateRetryDelay({ min_ms, max_ms }, i % 5);
        expect(sample).toBeGreaterThanOrEqual(min_ms);
        expect(sample).toBeLessThanOrEqual(max_ms);
        samples.push(sample);

        const bucketIdx = Math.min(
          buckets - 1,
          Math.floor((sample - min_ms) / bucketSize)
        );
        bucketCounts[bucketIdx]++;
      }

      // Check min and max observed span across interval
      const minObserved = Math.min(...samples);
      const maxObserved = Math.max(...samples);
      expect(minObserved).toBeLessThanOrEqual(min_ms + 25);
      expect(maxObserved).toBeGreaterThanOrEqual(max_ms - 25);

      // Verify distribution spans all buckets roughly uniformly (each bucket >= 10% of 2000 = 200)
      for (let b = 0; b < buckets; b++) {
        expect(bucketCounts[b]).toBeGreaterThan(250);
      }
    });
  });

  describe("calculateCooldownMs()", () => {
    const baseConfig: KeyCooldownConfig = {
      enabled: true,
      initial_cooldown_ms: 10000,
      backoff_factor: 2.0,
      max_cooldown_ms: 60000,
      max_consecutive_failures: 5,
      jitter_percent: 20,
      respect_retry_after: true,
      reset_after_success: true,
    };

    it("respects retryAfterMs when respect_retry_after is true", () => {
      const result = calculateCooldownMs(baseConfig, 1, 45000);
      expect(result).toBe(45000);
    });

    it("ignores retryAfterMs when respect_retry_after is false", () => {
      const noRespectConfig: KeyCooldownConfig = {
        ...baseConfig,
        respect_retry_after: false,
      };
      const result = calculateCooldownMs(noRespectConfig, 0, 45000);
      // Raw: 10000 * 2^0 = 10000. Jitter: +/- 20% -> [8000, 12000]
      expect(result).toBeGreaterThanOrEqual(8000);
      expect(result).toBeLessThanOrEqual(12000);
    });

    it("exhibits exponential growth across consecutive failures", () => {
      const zeroJitterConfig: KeyCooldownConfig = {
        ...baseConfig,
        jitter_percent: 0,
      };

      expect(calculateCooldownMs(zeroJitterConfig, 0)).toBe(10000);
      expect(calculateCooldownMs(zeroJitterConfig, 1)).toBe(20000);
      expect(calculateCooldownMs(zeroJitterConfig, 2)).toBe(40000);
      expect(calculateCooldownMs(zeroJitterConfig, 3)).toBe(60000); // capped
    });

    it("strictly caps backoff at max_cooldown_ms before jitter", () => {
      const zeroJitterConfig: KeyCooldownConfig = {
        ...baseConfig,
        jitter_percent: 0,
      };
      const result = calculateCooldownMs(zeroJitterConfig, 10);
      expect(result).toBe(60000);
    });

    it("applies jitter strictly within bounds [capped - jitter, capped + jitter]", () => {
      // capped = 60000, jitter 20% = 12000 -> [48000, 72000]
      for (let i = 0; i < 500; i++) {
        const result = calculateCooldownMs(baseConfig, 5);
        expect(result).toBeGreaterThanOrEqual(48000);
        expect(result).toBeLessThanOrEqual(72000);
      }
    });

    it("guards against negative cooldown results", () => {
      const extremeConfig: KeyCooldownConfig = {
        ...baseConfig,
        initial_cooldown_ms: 100,
        jitter_percent: 50,
      };
      const result = calculateCooldownMs(extremeConfig, 0);
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe("defaultClassifyFailure()", () => {
    it("correctly classifies all FAIL_FAST_STATUSES", () => {
      const expectedList = [400, 404, 413, 414, 422, 451, 501, 505];
      for (const status of expectedList) {
        expect(FAIL_FAST_STATUSES.has(status)).toBe(true);
        expect(defaultClassifyFailure(status)).toBe("fail_fast");
      }
    });

    it("correctly classifies all KEY_ROTATION_STATUSES", () => {
      const expectedList = [401, 403, 429];
      for (const status of expectedList) {
        expect(KEY_ROTATION_STATUSES.has(status)).toBe(true);
        expect(defaultClassifyFailure(status)).toBe("retry_same_target");
      }
    });

    it("correctly classifies all TRANSIENT_RETRY_STATUSES", () => {
      const expectedList = [
        500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526,
      ];
      for (const status of expectedList) {
        expect(TRANSIENT_RETRY_STATUSES.has(status)).toBe(true);
        expect(defaultClassifyFailure(status)).toBe("retry_same_target");
      }
    });

    it("defaults unknown status codes to fail_fast", () => {
      const unknownStatuses = [200, 204, 301, 302, 418, 499, 599, 999];
      for (const status of unknownStatuses) {
        expect(defaultClassifyFailure(status)).toBe("fail_fast");
      }
    });
  });
});
