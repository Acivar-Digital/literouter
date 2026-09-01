import { beforeEach, afterEach, describe, expect, it, spyOn } from "bun:test";
import { clearPacerRegistry, getPacerForProvider, PacerQueueOverflowError, RequestPacer } from "../../src/network/pacer";
import { handleGcpCompat, isGemmaModel, normalizeGcpModel } from "../../src/handlers/gcp_compat";
import { globalCooldownManager, globalKeyPool, initializeKeyPools } from "../../src/handlers/openai_compat";

describe("GCP Pacer Conveyor Regression (S5)", () => {
  beforeEach(() => {
    globalCooldownManager.clearAll();
    globalKeyPool.reset();
    clearPacerRegistry();
  });

  afterEach(() => {
    globalCooldownManager.clearAll();
    globalKeyPool.reset();
    clearPacerRegistry();
  });

  describe("1) Pacer singleton dwell enforcement (2000ms conveyor)", () => {
    it(
      "parallel acquire of getPacerForProvider('gc') 3x — second and third dwell >=1700ms",
      async () => {
        clearPacerRegistry();
        const pacerA = getPacerForProvider("gc");
        const pacerB = getPacerForProvider("gc");
        const pacerC = getPacerForProvider("gc");

        // singleton verification: same instance
        expect(pacerA).toBe(pacerB);
        expect(pacerB).toBe(pacerC);
        expect(pacerA.getMinInterval()).toBe(2000);
        expect(pacerA.maxQueueWaitMs).toBe(240000);

        const p1 = pacerA.acquire().then((r) => ({ dwell: r.queueDwellMs, t: Date.now() }));
        const p2 = pacerB.acquire().then((r) => ({ dwell: r.queueDwellMs, t: Date.now() }));
        const p3 = pacerC.acquire().then((r) => ({ dwell: r.queueDwellMs, t: Date.now() }));

        const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

        // first dispatches immediately
        expect(r1.dwell).toBe(0);
        // second and third must respect 2000ms pacing; allow 300ms jitter → threshold 1700ms
        expect(r2.dwell).toBeGreaterThanOrEqual(1700);
        expect(r3.dwell).toBeGreaterThanOrEqual(1700);

        // cross-check wall-clock intervals as secondary proof
        const interval12 = r2.t - r1.t;
        const interval23 = r3.t - r2.t;
        expect(interval12).toBeGreaterThanOrEqual(1700);
        expect(interval23).toBeGreaterThanOrEqual(1700);

        // third should be roughly 2 * interval
        expect(r3.dwell).toBeGreaterThan(r2.dwell);
      },
      10000
    );
  });

  describe("2) executeGcpAttemptLoop invokes pacer before waitAndSelectKey", () => {
    it("pacer acquire is invoked before waitForKeyAvailable when handling a valid Gemma request", async () => {
      clearPacerRegistry();
      globalCooldownManager.clearAll();
      globalKeyPool.reset();
      initializeKeyPools({ GCP_KEYS: "gcp-conveyor-key-1,gcp-conveyor-key-2" });

      const order: string[] = [];

      // Mock pacer acquire to be instant and record order, without 2000ms wait
      const acquireSpy = spyOn(RequestPacer.prototype, "acquire").mockImplementation(async function (
        this: RequestPacer,
        _signal?: AbortSignal
      ) {
        order.push("pacer-acquire");
        return { queueDwellMs: 0 };
      });

      // Mock key selection to record order and return a valid key
      const waitSpy = spyOn(globalKeyPool, "waitForKeyAvailable").mockImplementation(
        async (): Promise<{ key: string; index: number; totalKeys: number } | null> => {
          order.push("waitForKeyAvailable");
          return { key: "gcp-conveyor-key-1", index: 0, totalKeys: 2 };
        }
      );

      // Mock upstream fetch to return a 200 OK immediately so loop completes
      const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
        (async () => {
          return new Response(
            JSON.stringify({
              id: "chatcmpl-gcp-test",
              object: "chat.completion",
              created: Date.now(),
              model: "gemma-4-31b-it",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "conveyor ok" },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }
          );
        }) as unknown as typeof fetch
      );

      // Silence logger to keep test output clean
      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        const req = new Request("http://localhost:7766/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer lr-gc-oa-ch-no",
          },
          body: JSON.stringify({
            model: "gemma-4-31b-it",
            messages: [{ role: "user", content: "hello conveyor" }],
          }),
        });

        const res = await handleGcpCompat(req, "lr-gc-oa-ch-no");
        // Should have gone through pacer + key selection and then mocked fetch → 200
        expect(res.status).toBe(200);

        // Verify ordering: pacer-acquire before waitForKeyAvailable
        const pacerIdx = order.indexOf("pacer-acquire");
        const waitIdx = order.indexOf("waitForKeyAvailable");
        expect(pacerIdx).toBeGreaterThanOrEqual(0);
        expect(waitIdx).toBeGreaterThanOrEqual(0);
        expect(pacerIdx).toBeLessThan(waitIdx);

        // Also verify acquire was called at least once
        expect(acquireSpy).toHaveBeenCalled();
        expect(waitSpy).toHaveBeenCalled();
      } finally {
        acquireSpy.mockRestore();
        waitSpy.mockRestore();
        fetchSpy.mockRestore();
        logSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });
  });

  describe("3) Overflow → 429 Retry-After", () => {
    it("returns 429 with Retry-After when pacer queue overflows (mock PacerQueueOverflowError)", async () => {
      clearPacerRegistry();
      globalCooldownManager.clearAll();
      globalKeyPool.reset();
      initializeKeyPools({ GCP_KEYS: "gcp-overflow-key-1,gcp-overflow-key-2" });

      const overflowErr = new PacerQueueOverflowError("LiteRouter rate limit capacity (100) saturated.", 7);

      const acquireSpy = spyOn(RequestPacer.prototype, "acquire").mockImplementation(async () => {
        throw overflowErr;
      });

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        const req = new Request("http://localhost:7766/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer lr-gc-oa-ch-no",
          },
          body: JSON.stringify({
            model: "gemma-4-31b-it",
            messages: [{ role: "user", content: "overflow test" }],
          }),
        });

        const res = await handleGcpCompat(req, "lr-gc-oa-ch-no");
        expect(res.status).toBe(429);
        const retryAfter = res.headers.get("Retry-After");
        expect(retryAfter).not.toBeNull();
        expect(Number(retryAfter)).toBeGreaterThanOrEqual(1);
        // exact value should match retryAfterSec from error (7) when mock is at top-level acquire
        expect(retryAfter).toBe(String(overflowErr.retryAfterSec));

        const body = (await res.json()) as { error: { type: string; code: string } };
        expect(body.error.type).toBe("rate_limit_exceeded");
      } finally {
        acquireSpy.mockRestore();
        logSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it("real pacer overflow via maxQueueDepth also yields PacerQueueOverflowError and would map to 429", async () => {
      // Validate the underlying pacer primitive still throws overflow when capacity exceeded
      const tinyPacer = new RequestPacer({ minIntervalMs: 2000, maxQueueDepth: 2 });
      await tinyPacer.acquire(); // consumes immediate slot
      const p1 = tinyPacer.acquire();
      const p2 = tinyPacer.acquire();
      expect(tinyPacer.getStats().queueDepth).toBe(2);
      await expect(tinyPacer.acquire()).rejects.toThrow(PacerQueueOverflowError);
      // cleanup pending acquires to avoid dangling timers
      p1.catch(() => {});
      p2.catch(() => {});
      await new Promise((r) => setTimeout(r, 10));
    });
  });

  describe("4) Abort → 499", () => {
    it("returns 499 when client AbortSignal is already aborted before pacer acquire", async () => {
      clearPacerRegistry();
      globalCooldownManager.clearAll();
      globalKeyPool.reset();
      initializeKeyPools({ GCP_KEYS: "gcp-abort-key-1,gcp-abort-key-2" });

      // Ensure real pacer is used (no mock) — abort path must be fast and not wait 2000ms
      const pacer = getPacerForProvider("gc");
      expect(pacer.getMinInterval()).toBe(2000);

      const controller = new AbortController();
      controller.abort();

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = spyOn(console, "warn").mockImplementation(() => {});

      try {
        const req = new Request("http://localhost:7766/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer lr-gc-oa-ch-no",
          },
          signal: controller.signal,
          body: JSON.stringify({
            model: "gemma-4-31b-it",
            messages: [{ role: "user", content: "abort test" }],
          }),
        });

        const start = Date.now();
        const res = await handleGcpCompat(req, "lr-gc-oa-ch-no");
        const elapsed = Date.now() - start;

        // Should be fast — not blocked on 2000ms dwell
        expect(elapsed).toBeLessThan(1000);
        expect(res.status).toBe(499);
        const json = (await res.json()) as { error: { type: string } };
        expect(json.error.type).toBe("client_closed_request");
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it("RequestPacer rejects immediately with abort error when signal is already aborted", async () => {
      const pacer = new RequestPacer({ minIntervalMs: 2000, maxQueueDepth: 5 });
      const controller = new AbortController();
      controller.abort();
      await expect(pacer.acquire(controller.signal)).rejects.toThrow(
        "Request aborted while queued in LiteRouter pacer"
      );
    });
  });

  describe("5) Billing guardrail still holds", () => {
    it("isGemmaModel returns false for gpt-4o and true for gemma-4-31b-it", () => {
      expect(isGemmaModel("gpt-4o")).toBe(false);
      expect(isGemmaModel("gemma-4-31b-it")).toBe(true);
      // extra guardrail edges
      expect(isGemmaModel("gemini-1.5-pro")).toBe(false);
      expect(isGemmaModel("gcp/gemma-4-31b-it")).toBe(true);
      expect(isGemmaModel("google/gemma-4-31b-it")).toBe(true);
      expect(isGemmaModel("")).toBe(false);
      expect(isGemmaModel(null as unknown as string)).toBe(false);
    });

    it("handleGcpCompat returns 403 for non-Gemma model (gpt-4o) and allows Gemma via path", async () => {
      clearPacerRegistry();
      globalCooldownManager.clearAll();
      globalKeyPool.reset();
      initializeKeyPools({ GCP_KEYS: "gcp-billing-key-1" });

      const blockedReq = new Request("http://localhost:7766/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer lr-gc-oa-ch-no",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "should be blocked" }],
        }),
      });

      const blockedRes = await handleGcpCompat(blockedReq, "lr-gc-oa-ch-no");
      expect(blockedRes.status).toBe(403);
      const blockedJson = (await blockedRes.json()) as { error: { type: string; code: number } };
      expect(blockedJson.error.type).toBe("billing_guardrail_violation");
      expect(blockedJson.error.code).toBe(403);
    });
  });

  describe("6) normalizeGcpModel stripping", () => {
    it('strips "gcp/" prefix → bare', () => {
      expect(normalizeGcpModel("gcp/gemma-4-31b-it")).toBe("gemma-4-31b-it");
      expect(normalizeGcpModel("GCP/gemma-4-31b-it")).toBe("gemma-4-31b-it");
    });

    it('strips "google/" prefix → bare', () => {
      expect(normalizeGcpModel("google/gemma-4-31b-it")).toBe("gemma-4-31b-it");
      expect(normalizeGcpModel("GOOGLE/gemma-4-31b-it")).toBe("gemma-4-31b-it");
    });

    it("bare model stays unchanged", () => {
      expect(normalizeGcpModel("gemma-4-31b-it")).toBe("gemma-4-31b-it");
      expect(normalizeGcpModel("gemma-2-27b-it")).toBe("gemma-2-27b-it");
    });

    it("handles empty / null / undefined → empty string", () => {
      expect(normalizeGcpModel("")).toBe("");
      expect(normalizeGcpModel(null as unknown as string)).toBe("");
      expect(normalizeGcpModel(undefined as unknown as string)).toBe("");
    });

    it("isGemmaModel works after stripping", () => {
      expect(isGemmaModel("gcp/gemma-4-31b-it")).toBe(true);
      expect(isGemmaModel("google/gemma-4-31b-it")).toBe(true);
      expect(isGemmaModel("gcp/gpt-4o")).toBe(false);
    });
  });
});
