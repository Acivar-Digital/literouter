import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { CooldownManager } from "../../src/network/cooldown";
import { KeyPool } from "../../src/network/pool";

describe("KeyPool — Event-Driven Key Availability & Lifecycle", () => {
  let pool: KeyPool;
  let cooldownManager: CooldownManager;

  beforeEach(() => {
    cooldownManager = new CooldownManager();
    pool = new KeyPool(cooldownManager);
  });

  afterEach(() => {
    pool.reset();
  });

  describe("Test 1: Event-driven key availability resolution without polling", () => {
    it("wakes up immediately when TTL timer expires without manual polling", async () => {
      const provider = "oa";
      pool.setPool(provider, ["sk-test-key-1"]);

      const startTime = Date.now();
      pool.quarantineKey(provider, 0, 0.1, "rate_limit", 429, startTime);

      expect(pool.selectNextKey(provider, startTime)).toBeNull();

      const waitPromise = pool.waitForKeyAvailable(provider, 1000, undefined, startTime);
      const selected = await waitPromise;

      const elapsedMs = Date.now() - startTime;
      expect(selected).not.toBeNull();
      expect(selected?.key).toBe("sk-test-key-1");
      expect(selected?.index).toBe(0);
      expect(elapsedMs).toBeGreaterThanOrEqual(80);
      expect(elapsedMs).toBeLessThan(600);
    });

    it("resolves immediately when a key is already available", async () => {
      const provider = "anthropic";
      pool.setPool(provider, ["sk-ant-test-key"]);

      const selected = await pool.waitForKeyAvailable(provider, 500);
      expect(selected).not.toBeNull();
      expect(selected?.key).toBe("sk-ant-test-key");
    });
  });

  describe("Test 2: Thundering-herd safety & concurrency", () => {
    it("handles 10 concurrent waiters gracefully without unhandled promise rejections", async () => {
      const provider = "google";
      pool.setPool(provider, ["gemini-key-1"]);

      const startTime = Date.now();
      pool.quarantineKey(provider, 0, 0.08, "rate_limit", 429, startTime);

      const concurrentRequests = 10;
      const promises: Promise<unknown>[] = [];

      for (let i = 0; i < concurrentRequests; i += 1) {
        promises.push(pool.waitForKeyAvailable(provider, 500, undefined, startTime));
      }

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      for (const res of results) {
        expect(res).not.toBeNull();
        expect((res as { key: string }).key).toBe("gemini-key-1");
      }
    });

    it("allows fast waiters to timeout while slower waiters acquire key on wake", async () => {
      const provider = "groq";
      pool.setPool(provider, ["gsk-test-key"]);

      const startTime = Date.now();
      pool.quarantineKey(provider, 0, 0.1, "rate_limit", 429, startTime);

      const shortTimeoutPromise = pool.waitForKeyAvailable(provider, 30, undefined, startTime);
      const longTimeoutPromise = pool.waitForKeyAvailable(provider, 300, undefined, startTime);

      const [shortResult, longResult] = await Promise.all([
        shortTimeoutPromise,
        longTimeoutPromise,
      ]);

      expect(shortResult).toBeNull();
      expect(longResult).not.toBeNull();
      expect(longResult?.key).toBe("gsk-test-key");
    });
  });

  describe("Test 3: AbortSignal cleanup & zero listener leaks", () => {
    it("cleans up event listeners upon AbortSignal trigger", async () => {
      const provider = "oa";
      pool.setPool(provider, ["sk-test-key"]);
      pool.quarantineKey(provider, 0, 10, "long_cooldown");

      const eventName = `available:${provider}`;
      const initialListeners = pool.listenerCount(eventName);
      expect(initialListeners).toBe(0);

      const abortController = new AbortController();
      const waitPromise = pool.waitForKeyAvailable(provider, 5000, abortController.signal);

      expect(pool.listenerCount(eventName)).toBe(1);

      abortController.abort();
      const result = await waitPromise;

      expect(result).toBeNull();
      expect(pool.listenerCount(eventName)).toBe(0);
    });

    it("cleans up event listeners upon timeout expiration", async () => {
      const provider = "oa";
      pool.setPool(provider, ["sk-test-key"]);
      pool.quarantineKey(provider, 0, 10, "long_cooldown");

      const eventName = `available:${provider}`;
      expect(pool.listenerCount(eventName)).toBe(0);

      const result = await pool.waitForKeyAvailable(provider, 50);

      expect(result).toBeNull();
      expect(pool.listenerCount(eventName)).toBe(0);
    });

    it("cleans up event listeners upon successful key acquisition after event wakeup", async () => {
      const provider = "oa";
      pool.setPool(provider, ["sk-test-key"]);
      pool.quarantineKey(provider, 0, 0.05, "short_cooldown");

      const eventName = `available:${provider}`;
      expect(pool.listenerCount(eventName)).toBe(0);

      const waitPromise = pool.waitForKeyAvailable(provider, 500);
      expect(pool.listenerCount(eventName)).toBe(1);

      const result = await waitPromise;
      expect(result).not.toBeNull();
      expect(pool.listenerCount(eventName)).toBe(0);
    });
  });

  describe("Test 4: Consecutive 401/403 auth failure quarantine escalation", () => {
    it("escalates quarantine through 300s -> 1800s -> 86400s on consecutive auth failures", () => {
      const provider = "deepseek";
      pool.setPool(provider, ["sk-ds-key-1"]);
      const now = 1000000;

      const state1 = pool.reportFailure(provider, 0, 401, undefined, undefined, now);
      expect(state1.quarantinedUntil).toBe(now + 300 * 1000);
      expect(pool.getConsecutiveAuthFailures(provider, 0)).toBe(1);

      const state2 = pool.reportFailure(provider, 0, 403, undefined, undefined, now);
      expect(state2.quarantinedUntil).toBe(now + 1800 * 1000);
      expect(pool.getConsecutiveAuthFailures(provider, 0)).toBe(2);

      const state3 = pool.reportFailure(provider, 0, 401, undefined, undefined, now);
      expect(state3.quarantinedUntil).toBe(now + 86400 * 1000);
      expect(pool.getConsecutiveAuthFailures(provider, 0)).toBe(3);

      const state4 = pool.reportFailure(provider, 0, 401, undefined, undefined, now);
      expect(state4.quarantinedUntil).toBe(now + 86400 * 1000);
      expect(pool.getConsecutiveAuthFailures(provider, 0)).toBe(4);
    });

    it("resets consecutive auth failures to 0 upon reportSuccess", () => {
      const provider = "deepseek";
      pool.setPool(provider, ["sk-ds-key-1"]);
      const now = 1000000;

      pool.reportFailure(provider, 0, 401, undefined, undefined, now);
      pool.reportFailure(provider, 0, 401, undefined, undefined, now);
      expect(pool.getConsecutiveAuthFailures(provider, 0)).toBe(2);

      pool.reportSuccess(provider, 0);
      expect(pool.getConsecutiveAuthFailures(provider, 0)).toBe(0);
      expect(cooldownManager.isQuarantined("deepseek:0", now)).toBe(false);

      const nextFailureState = pool.reportFailure(provider, 0, 401, undefined, undefined, now);
      expect(nextFailureState.quarantinedUntil).toBe(now + 300 * 1000);
      expect(pool.getConsecutiveAuthFailures(provider, 0)).toBe(1);
    });
  });

  describe("Test 5: Targeted reset(provider) isolation", () => {
    it("clears only specified provider cooldowns and timers while preserving other providers", () => {
      pool.setPool("oa", ["sk-oa-key-1", "sk-oa-key-2"]);
      pool.setPool("anthropic", ["sk-ant-key-1"]);
      const now = 2000000;

      pool.reportFailure("oa", 0, 401, undefined, undefined, now);
      pool.quarantineKey("oa", 1, 60, "rate_limit", 429, now);
      pool.reportFailure("anthropic", 0, 401, undefined, undefined, now);

      expect(cooldownManager.isQuarantined("oa:0", now)).toBe(true);
      expect(cooldownManager.isQuarantined("oa:1", now)).toBe(true);
      expect(cooldownManager.isQuarantined("anthropic:0", now)).toBe(true);
      expect(pool.getConsecutiveAuthFailures("oa", 0)).toBe(1);
      expect(pool.getConsecutiveAuthFailures("anthropic", 0)).toBe(1);

      let oaEventFired = false;
      let anthropicEventFired = false;
      pool.once("available:oa", () => {
        oaEventFired = true;
      });
      pool.once("available:anthropic", () => {
        anthropicEventFired = true;
      });

      pool.reset("oa");

      expect(oaEventFired).toBe(true);
      expect(anthropicEventFired).toBe(false);

      expect(cooldownManager.isQuarantined("oa:0", now)).toBe(false);
      expect(cooldownManager.isQuarantined("oa:1", now)).toBe(false);
      expect(pool.getConsecutiveAuthFailures("oa", 0)).toBe(0);

      expect(cooldownManager.isQuarantined("anthropic:0", now)).toBe(true);
      expect(pool.getConsecutiveAuthFailures("anthropic", 0)).toBe(1);
    });
  });
});
