import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  computeStatusTtlSec,
  globalCooldownManager,
  globalKeyPool,
  handleAppRequest,
  NoResponseError,
  resetAllState,
  waitAndSelectKey,
} from "../../src/lib";

describe("Pacer Cooldown Integration, Load-Shedding & Transport Error Classification", () => {
  const originalFetch = globalThis.fetch;
  const originalEnvOpenAi = process.env.OPENAI_API_KEYS;

  const mockSuccessPayload = {
    id: "chatcmpl-pacer-int-test",
    object: "chat.completion",
    created: Date.now(),
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: "Pacer dwell succeeded" },
        finish_reason: "stop",
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };

  beforeEach(() => {
    process.env.OPENAI_API_KEYS = "sk-test-key-pacer-1,sk-test-key-pacer-2";
    resetAllState();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnvOpenAi !== undefined) {
      process.env.OPENAI_API_KEYS = originalEnvOpenAi;
    } else {
      delete process.env.OPENAI_API_KEYS;
    }
    resetAllState();
  });

  function createTestRequest(signal?: AbortSignal): Request {
    return new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        Authorization: "Bearer lr-oa-oa-ch-no",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Integration probe" }],
        stream: false,
      }),
    });
  }

  describe("1. Pacer FIFO Queue & Cooldown Dwell Integration", () => {
    it("dwells during 1-second cooldown and successfully selects key once expired", async () => {
      process.env.OPENAI_API_KEYS = "sk-test-key-single";
      resetAllState();

      globalKeyPool.quarantineKey("oa", 0, 1, "Temporary 1s cooldown", 429);
      expect(globalKeyPool.selectNextKey("oa")).toBeNull();

      const startTime = Date.now();
      const selected = await waitAndSelectKey("oa", startTime, 5000);

      const elapsed = Date.now() - startTime;
      expect(selected).not.toBeNull();
      expect(selected?.key).toBe("sk-test-key-single");
      expect(selected?.index).toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(950);
    });

    it("handles inbound HTTP request dwelling during 1s cooldown and succeeds with 200 OK", async () => {
      process.env.OPENAI_API_KEYS = "sk-test-key-single";
      resetAllState();

      globalThis.fetch = (async () => {
        return new Response(JSON.stringify(mockSuccessPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      globalKeyPool.quarantineKey("oa", 0, 1, "Short 1s burst penalty", 429);

      const startTime = Date.now();
      const req = createTestRequest();
      const res = await handleAppRequest(req);
      const elapsed = Date.now() - startTime;

      expect(res.status).toBe(200);
      expect(elapsed).toBeGreaterThanOrEqual(950);

      const body = (await res.json()) as typeof mockSuccessPayload;
      expect(body.choices[0]?.message.content).toBe("Pacer dwell succeeded");
    });

    it("returns null if client aborts while waitAndSelectKey is dwelling", async () => {
      process.env.OPENAI_API_KEYS = "sk-test-key-single";
      resetAllState();

      globalKeyPool.quarantineKey("oa", 0, 2, "2s cooldown", 429);

      const controller = new AbortController();
      setTimeout(() => controller.abort(), 100);

      const startTime = Date.now();
      const selected = await waitAndSelectKey("oa", startTime, 5000, controller.signal);

      expect(selected).toBeNull();
    });
  });

  describe("2. Load-Shedding on Long Cooldown Budget Overrun", () => {
    it("shouldLoadShed returns true immediately when cooldown exceeds wait budget", () => {
      process.env.OPENAI_API_KEYS = "sk-test-key-long-cd";
      resetAllState();

      globalKeyPool.quarantineKey("oa", 0, 60, "Heavy rate limit", 429);

      const shedResult = globalKeyPool.shouldLoadShed("oa", 0, 20000);
      expect(shedResult).toBe(true);
    });

    it("shouldLoadShed returns false when active keys are available", () => {
      const shedResult = globalKeyPool.shouldLoadShed("oa", 0, 20000);
      expect(shedResult).toBe(false);
    });

    it("triggers 503 load-shedding response immediately on 60s cooldown without hanging", async () => {
      process.env.OPENAI_API_KEYS = "sk-test-key-long-cd";
      resetAllState();

      globalKeyPool.quarantineKey("oa", 0, 60, "Extended 60s rate limit", 429);

      const startTime = Date.now();
      const req = createTestRequest();
      const res = await handleAppRequest(req);
      const elapsed = Date.now() - startTime;

      expect(res.status).toBe(503);
      expect(elapsed).toBeLessThan(500);

      const body = (await res.json()) as { error: { message: string; type: string } };
      expect(body.error.type).toBe("service_unavailable");
      expect(body.error.message).toContain("all keys in cooldown exceed wait budget");
    });
  });

  describe("3. Transport Error & TTFT Timeout Quarantine Classification", () => {
    it("applies 2-second transport quarantine on NoResponseError, NOT 60-second rate limit", async () => {
      const fetchCalls: string[] = [];

      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);
        const auth = headers.get("Authorization") || "";
        fetchCalls.push(auth);

        if (auth.includes("sk-test-key-pacer-1")) {
          throw new NoResponseError("TTFT exceeded 15000ms");
        }

        return new Response(JSON.stringify(mockSuccessPayload), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      const req = createTestRequest();
      const res = await handleAppRequest(req);

      expect(res.status).toBe(200);
      expect(fetchCalls.length).toBe(2);

      // Verify that after 2 seconds elapsed during pacer retry, Key 0 is already cleared
      // whereas a 60s/65s rate limit would have ~58s remaining.
      const rateLimitCooldown = computeStatusTtlSec(429);
      expect(rateLimitCooldown).toBe(65);

      const key0Remaining = globalCooldownManager.getRemainingMs("oa:0");
      expect(key0Remaining).toBeLessThanOrEqual(2000);
    });

    it("quarantines key for exactly 2 seconds when reportFailure is invoked with customTtlSec 2", () => {
      const now = Date.now();
      const state = globalKeyPool.reportFailure("oa", 0, 0, undefined, "Transport timeout", now, 2);

      expect(state.quarantinedUntil - now).toBe(2000);
      expect(state.reason).toBe("HTTP 0");

      const remaining = globalCooldownManager.getRemainingMs("oa:0", now);
      expect(remaining).toBe(2000);
    });

    it("verifies 429 status defaults to 65s rate limit quarantine while transport timeout is 2s", () => {
      const now = Date.now();

      // Standard HTTP 429 rate limit failure -> 65s
      const rateLimitState = globalKeyPool.reportFailure("oa", 0, 429, undefined, "Rate limit", now);
      expect(rateLimitState.quarantinedUntil - now).toBe(65000);

      // Transport / NoResponseError failure -> 2s
      const transportState = globalKeyPool.reportFailure("oa", 1, 0, undefined, "TTFT timeout", now, 2);
      expect(transportState.quarantinedUntil - now).toBe(2000);
    });
  });
});
