import { describe, expect, it } from "bun:test";
import {
  FastFifoQueue,
  getPacerForProvider,
  PacerQueueOverflowError,
  PacerQueueTimeoutError,
  RequestPacer,
} from "../../src/network/pacer";

describe("Token Bucket Pacer & Anti-429 Queue", () => {
  describe("FastFifoQueue (O(1) operations)", () => {
    it("enqueues and dequeues elements in FIFO order", () => {
      const q = new FastFifoQueue<string>();
      expect(q.size).toBe(0);
      expect(q.dequeue()).toBeUndefined();

      q.enqueue("first");
      q.enqueue("second");
      q.enqueue("third");
      expect(q.size).toBe(3);

      expect(q.dequeue()).toBe("first");
      expect(q.dequeue()).toBe("second");
      expect(q.size).toBe(1);

      expect(q.dequeue()).toBe("third");
      expect(q.size).toBe(0);
      expect(q.dequeue()).toBeUndefined();
    });

    it("removes arbitrary nodes from the middle cleanly", () => {
      const q = new FastFifoQueue<number>();
      const n1 = q.enqueue(10);
      const n2 = q.enqueue(20);
      const n3 = q.enqueue(30);

      expect(q.size).toBe(3);
      q.remove(n2);
      expect(q.size).toBe(2);

      expect(q.dequeue()).toBe(10);
      expect(q.dequeue()).toBe(30);
      expect(q.size).toBe(0);
    });

    it("removes head and tail nodes cleanly", () => {
      const q = new FastFifoQueue<number>();
      const n1 = q.enqueue(10);
      const n2 = q.enqueue(20);

      q.remove(n1); // remove head
      expect(q.size).toBe(1);
      expect(q.dequeue()).toBe(20);

      const n3 = q.enqueue(30);
      q.remove(n3); // remove tail
      expect(q.size).toBe(0);
    });
  });

  describe("RequestPacer token acquisition & rate limiting", () => {
    it("allows immediate acquisition on cold start", async () => {
      const pacer = new RequestPacer({
        maxRpm: 60,
        minIntervalMs: 10,
        maxQueueDepth: 10,
        maxQueueWaitMs: 5000,
      });

      const { queueDwellMs } = await pacer.acquire();
      expect(queueDwellMs).toBe(0);
      const stats = pacer.getStats();
      expect(stats.currentTokens).toBe(59);
      expect(stats.queueDepth).toBe(0);
    });

    it("enforces minimum interval spacing between consecutive requests", async () => {
      const pacer = new RequestPacer({
        maxRpm: 60,
        minIntervalMs: 50, // 50ms minimum spacing between requests
        maxQueueDepth: 5,
        maxQueueWaitMs: 2000,
      });

      // First request dispatches immediately
      const r1 = await pacer.acquire();
      expect(r1.queueDwellMs).toBe(0);

      // Second request sent immediately after must wait minIntervalMs
      const start = Date.now();
      const r2 = await pacer.acquire();
      const elapsed = Date.now() - start;

      expect(r2.queueDwellMs).toBeGreaterThanOrEqual(40);
      expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it("throws PacerQueueOverflowError when max queue depth is exceeded", async () => {
      const pacer = new RequestPacer({
        maxRpm: 60,
        minIntervalMs: 100,
        maxQueueDepth: 2,
        maxQueueWaitMs: 5000,
      });

      // 1st item consumes token and starts pacing window
      await pacer.acquire();

      // Next 2 items queue up (capacity = 2)
      const p1 = pacer.acquire();
      const p2 = pacer.acquire();
      expect(pacer.getStats().queueDepth).toBe(2);

      // 3rd queued item exceeds capacity
      await expect(pacer.acquire()).rejects.toThrow(PacerQueueOverflowError);

      p1.catch(() => {});
      p2.catch(() => {});
    });

    it("throws PacerQueueTimeoutError when queue wait exceeds maxQueueWaitMs", async () => {
      const pacer = new RequestPacer({
        maxRpm: 60,
        minIntervalMs: 200, // 200ms spacing
        maxQueueDepth: 5,
        maxQueueWaitMs: 50, // 50ms max queue wait -> times out!
      });

      await pacer.acquire();

      // Next request will wait 200ms, which exceeds 50ms max wait
      await expect(pacer.acquire()).rejects.toThrow(PacerQueueTimeoutError);
    });

    it("cancels queued request when client signal is aborted", async () => {
      const pacer = new RequestPacer({
        maxRpm: 60,
        minIntervalMs: 500,
        maxQueueDepth: 5,
        maxQueueWaitMs: 5000,
      });

      await pacer.acquire(); // Starts pacing window

      const controller = new AbortController();
      const acquirePromise = pacer.acquire(controller.signal);
      expect(pacer.getStats().queueDepth).toBe(1);

      controller.abort();
      await expect(acquirePromise).rejects.toThrow("Request aborted while queued in LiteRouter pacer");
      expect(pacer.getStats().queueDepth).toBe(0);
    });

    it("applies 2000ms minimum interval for Google provider by default", () => {
      const pacer = getPacerForProvider("gg", 0);
      expect(pacer.getMinInterval()).toBe(2000);
    });
  });
});
