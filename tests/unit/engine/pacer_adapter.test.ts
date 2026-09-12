import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { ProviderPacerConfig } from "../../../src/config/schema";
import { acquirePacer, calculatePacerIntervalMs } from "../../../src/engine/pacer_adapter";
import { clearPacerRegistry, PacerQueueOverflowError } from "../../../src/network/pacer";

describe("Slice 3.6: Pacer Adapter", () => {
  beforeEach(() => {
    clearPacerRegistry();
  });

  afterEach(() => {
    clearPacerRegistry();
  });

  describe("calculatePacerIntervalMs()", () => {
    it("returns deterministic min_delay_ms when min_delay_ms === max_delay_ms", () => {
      const interval = calculatePacerIntervalMs({
        min_delay_ms: 250,
        max_delay_ms: 250,
      });
      expect(interval).toBe(250);
    });

    it("returns min_delay_ms if max_delay_ms < min_delay_ms", () => {
      const interval = calculatePacerIntervalMs({
        min_delay_ms: 300,
        max_delay_ms: 200,
      });
      expect(interval).toBe(300);
    });

    it("respects jitter range [min_delay_ms, max_delay_ms] across statistical iterations", () => {
      const min_delay_ms = 100;
      const max_delay_ms = 400;

      for (let i = 0; i < 1000; i++) {
        const interval = calculatePacerIntervalMs({
          min_delay_ms,
          max_delay_ms,
        });
        expect(interval).toBeGreaterThanOrEqual(min_delay_ms);
        expect(interval).toBeLessThanOrEqual(max_delay_ms);
      }
    });
  });

  describe("acquirePacer()", () => {
    it("resolves immediately when pacerConfig is undefined", async () => {
      const start = Date.now();
      await acquirePacer("test-provider-undef", undefined);
      expect(Date.now() - start).toBeLessThan(50);
    });

    it("resolves immediately when pacerConfig.enabled is false", async () => {
      const config: ProviderPacerConfig = {
        enabled: false,
        min_delay_ms: 500,
        max_delay_ms: 1000,
        max_queue_depth: 10,
        max_queue_wait_ms: 5000,
        max_concurrency: 10,
      };

      const start = Date.now();
      await acquirePacer("test-provider-disabled", config);
      expect(Date.now() - start).toBeLessThan(50);
    });

    it("paces sequential requests according to pacerConfig when enabled", async () => {
      const config: ProviderPacerConfig = {
        enabled: true,
        min_delay_ms: 40,
        max_delay_ms: 40,
        max_queue_depth: 10,
        max_queue_wait_ms: 5000,
        max_concurrency: 10,
      };

      const start = Date.now();
      await acquirePacer("test-pacing", config);
      await acquirePacer("test-pacing", config);
      const elapsed = Date.now() - start;

      // Second request should wait at least min_delay_ms (40ms, allowing tiny timer slack)
      expect(elapsed).toBeGreaterThanOrEqual(35);
    });

    it("throws immediately when signal is already aborted", async () => {
      const config: ProviderPacerConfig = {
        enabled: true,
        min_delay_ms: 100,
        max_delay_ms: 100,
        max_queue_depth: 10,
        max_queue_wait_ms: 5000,
        max_concurrency: 10,
      };

      const controller = new AbortController();
      controller.abort();

      await expect(
        acquirePacer("test-aborted-early", config, controller.signal)
      ).rejects.toThrow("Request aborted while queued in LiteRouter pacer");
    });

    it("cancels waiting ticket when signal is aborted mid-queue", async () => {
      const config: ProviderPacerConfig = {
        enabled: true,
        min_delay_ms: 200,
        max_delay_ms: 200,
        max_queue_depth: 10,
        max_queue_wait_ms: 5000,
        max_concurrency: 10,
      };

      // Occupy pacer slot with initial call
      await acquirePacer("test-abort-mid", config);

      const controller = new AbortController();

      // Queue second call which must wait in queue
      const queuedPromise = acquirePacer("test-abort-mid", config, controller.signal);

      // Abort after a short delay
      setTimeout(() => controller.abort(), 20);

      await expect(queuedPromise).rejects.toThrow(
        "Request aborted while queued in LiteRouter pacer"
      );
    });

    it("rejects with PacerQueueOverflowError when max_queue_depth is exceeded", async () => {
      const config: ProviderPacerConfig = {
        enabled: true,
        min_delay_ms: 200,
        max_delay_ms: 200,
        max_queue_depth: 1,
        max_queue_wait_ms: 5000,
        max_concurrency: 10,
      };

      // 1st request occupies immediate dispatch slot
      await acquirePacer("test-overflow", config);

      // 2nd request enters queue (queue depth 1 == maxQueueDepth)
      const p1 = acquirePacer("test-overflow", config);

      // 3rd request overflows capacity
      expect(acquirePacer("test-overflow", config)).rejects.toThrow(PacerQueueOverflowError);

      await p1;
    });
  });
});
