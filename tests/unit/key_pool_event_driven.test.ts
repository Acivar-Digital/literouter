import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import rawProviders from "../../config/providers.json";
import { initProviderRegistry } from "../../src/config/providers";
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
    it("throws FatalAuthError and does not quarantine on 401/403 auth failures", () => {
      const provider = "deepseek";
      pool.setPool(provider, ["sk-ds-key-1"]);
      const now = 1000000;

      expect(() => {
        pool.reportFailure(provider, 0, 401, undefined, undefined, now);
      }).toThrow();
      expect(cooldownManager.isQuarantined("deepseek:0", now)).toBe(false);

      expect(() => {
        pool.reportFailure(provider, 0, 403, undefined, undefined, now);
      }).toThrow();
      expect(cooldownManager.isQuarantined("deepseek:0", now)).toBe(false);
      expect(pool.getConsecutiveAuthFailures(provider, 0)).toBe(0);
    });

    it("resets key availability upon reportSuccess", () => {
      const provider = "deepseek";
      pool.setPool(provider, ["sk-ds-key-1"]);
      const now = 1000000;

      pool.quarantineKey(provider, 0, 60, "test", 500, now);
      expect(cooldownManager.isQuarantined("deepseek:0", now)).toBe(true);

      pool.reportSuccess(provider, 0);
      expect(pool.getConsecutiveAuthFailures(provider, 0)).toBe(0);
      expect(cooldownManager.isQuarantined("deepseek:0", now)).toBe(false);
    });
  });

  describe("Test 5: Targeted reset(provider) isolation", () => {
    it("clears only specified provider cooldowns and timers while preserving other providers", () => {
      pool.setPool("oa", ["sk-oa-key-1", "sk-oa-key-2"]);
      pool.setPool("anthropic", ["sk-ant-key-1"]);
      const now = 2000000;

      pool.quarantineKey("oa", 0, 60, "test", 500, now);
      pool.quarantineKey("oa", 1, 60, "rate_limit", 429, now);
      pool.quarantineKey("anthropic", 0, 60, "test", 500, now);

      expect(cooldownManager.isQuarantined("oa:0", now)).toBe(true);
      expect(cooldownManager.isQuarantined("oa:1", now)).toBe(true);
      expect(cooldownManager.isQuarantined("anthropic:0", now)).toBe(true);

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

      expect(cooldownManager.isQuarantined("anthropic:0", now)).toBe(true);
    });

    it("parks key via conserveKey even when provider quarantine is disabled", () => {
      const customProviders = JSON.parse(JSON.stringify(rawProviders));
      customProviders.providers.openrouter.key_cooldown = {
        enabled: false,
        initial_cooldown_ms: 10000,
        max_cooldown_ms: 60000,
      };
      initProviderRegistry(customProviders);
      try {
        pool.setPool("or", ["sk-or-key-1"]);
        const now = 3000000;
        // Normal quarantineKey returns disabled state
        const qState = pool.quarantineKey("or", 0, 60, "rate_limit", 429, now);
        expect(qState.quarantinedUntil).toBe(0);
        expect(cooldownManager.isQuarantined("or:0", now)).toBe(false);

        // conserveKey parks key regardless of isQuarantineEnabled
        const cState = pool.conserveKey("or", 0, 120, "openrouter_daily_free_quota_exhausted", 429, now);
        expect(cState.quarantinedUntil).toBe(now + 120000);
        expect(cooldownManager.isQuarantined("or:0", now)).toBe(true);
      } finally {
        initProviderRegistry();
      }
    });
  });
});
