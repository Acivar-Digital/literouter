import { describe, expect, it } from "bun:test";
import {
  clearPacerRegistry,
  FastFifoQueue,
  getPacerForProvider,
  PacerQueueOverflowError,
  RequestPacer,
} from "../../src/network/pacer";

describe("Pure FIFO Conveyor Belt Pacer & Anti-429 Queue", () => {
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

    it("clears all elements properly", () => {
      const q = new FastFifoQueue<string>();
      q.enqueue("a");
      q.enqueue("b");
      expect(q.size).toBe(2);
      q.clear();
      expect(q.size).toBe(0);
      expect(q.dequeue()).toBeUndefined();
    });
  });

  describe("RequestPacer conveyor belt pacing & rate limiting", () => {
    it("allows immediate acquisition on cold start or when idle longer than minInterval", async () => {
      const pacer = new RequestPacer({
        minIntervalMs: 20,
        maxQueueDepth: 10,
      });

      // Cold start: immediate dispatch
      const r1 = await pacer.acquire();
      expect(r1.queueDwellMs).toBe(0);
      expect(pacer.getStats().queueDepth).toBe(0);

      // Wait longer than minIntervalMs -> next request is also immediate
      await new Promise((res) => setTimeout(res, 30));
      const r2 = await pacer.acquire();
      expect(r2.queueDwellMs).toBe(0);
      expect(pacer.getStats().queueDepth).toBe(0);
    });

    it("enforces minimum interval spacing between consecutive requests", async () => {
      const pacer = new RequestPacer({
        minIntervalMs: 50, // 50ms minimum spacing between requests
        maxQueueDepth: 5,
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

    it("releases multiple queued requests one by one at strict intervals in strict FIFO order", async () => {
      const pacer = new RequestPacer({
        minIntervalMs: 30,
        maxQueueDepth: 10,
      });

      const timestamps: number[] = [];
      const order: number[] = [];

      const p0 = pacer.acquire().then(() => {
        timestamps.push(Date.now());
        order.push(0);
      });
      const p1 = pacer.acquire().then(() => {
        timestamps.push(Date.now());
        order.push(1);
      });
      const p2 = pacer.acquire().then(() => {
        timestamps.push(Date.now());
        order.push(2);
      });
      const p3 = pacer.acquire().then(() => {
        timestamps.push(Date.now());
        order.push(3);
      });

      await Promise.all([p0, p1, p2, p3]);

      expect(order).toEqual([0, 1, 2, 3]);
      expect(timestamps.length).toBe(4);

      // Ensure interval spacing between successive requests
      for (let i = 1; i < timestamps.length; i++) {
        const curr = timestamps[i] ?? 0;
        const prev = timestamps[i - 1] ?? 0;
        const delta = curr - prev;
        expect(delta).toBeGreaterThanOrEqual(25); // allowing small timer jitter
      }
    });

    it("throws PacerQueueOverflowError when max queue depth is exceeded", async () => {
      const pacer = new RequestPacer({
        minIntervalMs: 100,
        maxQueueDepth: 2,
      });

      // 1st item consumes slot and starts pacing window
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

    it("cancels queued request when client signal is aborted and removes from queue in O(1)", async () => {
      const pacer = new RequestPacer({
        minIntervalMs: 500,
        maxQueueDepth: 5,
      });

      await pacer.acquire(); // Starts pacing window

      const controller = new AbortController();
      const acquirePromise = pacer.acquire(controller.signal);
      expect(pacer.getStats().queueDepth).toBe(1);

      controller.abort();
      await expect(acquirePromise).rejects.toThrow("Request aborted while queued in LiteRouter pacer");
      expect(pacer.getStats().queueDepth).toBe(0);
    });

    it("rejects immediately if signal is already aborted before acquire", async () => {
      const pacer = new RequestPacer({
        minIntervalMs: 100,
        maxQueueDepth: 5,
      });

      const controller = new AbortController();
      controller.abort();

      await expect(pacer.acquire(controller.signal)).rejects.toThrow(
        "Request aborted while queued in LiteRouter pacer"
      );
      expect(pacer.getStats().queueDepth).toBe(0);
    });

    it("tracks accurate stats reporting (queueDepth and avgDwellTimeMs)", async () => {
      const pacer = new RequestPacer({
        minIntervalMs: 40,
        maxQueueDepth: 5,
      });

      const initialStats = pacer.getStats();
      expect(initialStats.queueDepth).toBe(0);
      expect(initialStats.avgDwellTimeMs).toBe(0);

      // 1st request immediate: dwell = 0
      await pacer.acquire();
      expect(pacer.getStats().queueDepth).toBe(0);

      // Queue 2 requests
      const p1 = pacer.acquire();
      const p2 = pacer.acquire();
      expect(pacer.getStats().queueDepth).toBe(2);

      const res1 = await p1;
      expect(res1.queueDwellMs).toBeGreaterThanOrEqual(30);

      const res2 = await p2;
      expect(res2.queueDwellMs).toBeGreaterThanOrEqual(60);

      const endStats = pacer.getStats();
      expect(endStats.queueDepth).toBe(0);
      expect(endStats.avgDwellTimeMs).toBeGreaterThan(0);
    });

    it("applies fallback calculations from maxRpm if minIntervalMs is not set", () => {
      const pacer = new RequestPacer({
        maxRpm: 60, // 60 RPM -> 1000ms interval
      });
      expect(pacer.getMinInterval()).toBe(1000);

      const highRpmPacer = new RequestPacer({
        maxRpm: 60000, // min clamp is 10ms
      });
      expect(highRpmPacer.getMinInterval()).toBe(10);
    });

    it("applies provider delays from registry and clears properly", () => {
      clearPacerRegistry();
      const ggPacer = getPacerForProvider("gg", 0);
      expect(ggPacer.getMinInterval()).toBe(200);

      const orPacer = getPacerForProvider("or", 0);
      expect(orPacer.getMinInterval()).toBeGreaterThanOrEqual(0);

      const gcPacer = getPacerForProvider("gc", 0);
      expect(gcPacer.getMinInterval()).toBe(2000);

      const unknownPacer = getPacerForProvider("unknown_prov", 0);
      expect(unknownPacer.getMinInterval()).toBe(200);

      const overriddenPacer = getPacerForProvider("custom_prov", 0, { minIntervalMs: 50 });
      expect(overriddenPacer.getMinInterval()).toBe(50);

      const sameGg = getPacerForProvider("gg", 1);
      expect(sameGg).toBe(ggPacer); // single pipe per provider

      clearPacerRegistry();
    });

    it("ensures getPacerForProvider('zn') and getPacerForProvider('or') operate completely independently", async () => {
      clearPacerRegistry();
      try {
        const znPacer = getPacerForProvider("zn", 0, { minIntervalMs: 50, maxConcurrency: 1 });
        const orPacer = getPacerForProvider("or", 0, { minIntervalMs: 0, maxConcurrency: 1 });

        expect(znPacer).not.toBe(orPacer);

        // zn acquires request 1 (in flight)
        const znLease1 = await znPacer.acquire();
        expect(znPacer.getStats().currentTokens).toBe(1);

        // zn enqueues request 2 (queued because maxConcurrency = 1)
        let zn2Resolved = false;
        const znReq2 = znPacer.acquire().then((lease) => {
          zn2Resolved = true;
          return lease;
        });

        // Small delay to verify zn2 is indeed blocked in queue
        await new Promise((res) => setTimeout(res, 10));
        expect(zn2Resolved).toBe(false);
        expect(znPacer.getStats().queueDepth).toBe(1);

        // or request should dispatch IMMEDIATELY without delay or blocking from zn
        const orStart = Date.now();
        const orLease1 = await orPacer.acquire();
        const orElapsed = Date.now() - orStart;

        expect(orLease1.queueDwellMs).toBe(0);
        expect(orElapsed).toBeLessThan(25);
        expect(orPacer.getStats().currentTokens).toBe(1);
        expect(orPacer.getStats().queueDepth).toBe(0);

        // zn2 is STILL queued and not dispatched
        expect(zn2Resolved).toBe(false);
        expect(znPacer.getStats().queueDepth).toBe(1);

        // Releasing zn1 immediately dispatches zn2
        znLease1.release();
        const znLease2 = await znReq2;
        expect(zn2Resolved).toBe(true);

        // Clean up
        znLease2.release();
        orLease1.release();
      } finally {
        clearPacerRegistry();
      }
    });

    it("enforces maxConcurrency: 1 and tracks activeInFlight via currentTokens", async () => {
      const pacer = new RequestPacer({
        minIntervalMs: 0,
        maxConcurrency: 1,
        maxQueueDepth: 10,
      });

      expect(pacer.getStats().currentTokens).toBe(0);

      // Request 1 is dispatched immediately
      const lease1 = await pacer.acquire();
      expect(lease1.queueDwellMs).toBe(0);
      expect(pacer.getStats().currentTokens).toBe(1); // activeInFlight = 1
      expect(pacer.getStats().queueDepth).toBe(0);

      // Request 2 is enqueued and does not dispatch while Request 1 is in-flight
      let req2Dispatched = false;
      const p2 = pacer.acquire().then((lease) => {
        req2Dispatched = true;
        return lease;
      });

      await new Promise((res) => setTimeout(res, 20));
      expect(req2Dispatched).toBe(false);
      expect(pacer.getStats().queueDepth).toBe(1);
      expect(pacer.getStats().currentTokens).toBe(1);

      // Invoking release() on Request 1's lease immediately dispatches Request 2
      lease1.release();

      const lease2 = await p2;
      expect(req2Dispatched).toBe(true);
      expect(pacer.getStats().queueDepth).toBe(0);
      expect(pacer.getStats().currentTokens).toBe(1); // tracks Request 2 active

      // Invoking release() on Request 2 returns activeInFlight to 0
      lease2.release();
      expect(pacer.getStats().currentTokens).toBe(0);
      expect(pacer.getStats().queueDepth).toBe(0);
    });

    it("dispatches multiple queued requests in strict FIFO order as leases are released", async () => {
      const pacer = new RequestPacer({
        minIntervalMs: 0,
        maxConcurrency: 1,
        maxQueueDepth: 10,
      });

      // Lease 0 acquires immediately and blocks queue
      const lease0 = await pacer.acquire();
      expect(pacer.getStats().currentTokens).toBe(1);

      const dispatchOrder: number[] = [];
      const leases: Array<() => void> = [];

      // Queue requests 1, 2, 3, 4
      const p1 = pacer.acquire().then((res) => {
        dispatchOrder.push(1);
        leases.push(res.release);
      });
      const p2 = pacer.acquire().then((res) => {
        dispatchOrder.push(2);
        leases.push(res.release);
      });
      const p3 = pacer.acquire().then((res) => {
        dispatchOrder.push(3);
        leases.push(res.release);
      });
      const p4 = pacer.acquire().then((res) => {
        dispatchOrder.push(4);
        leases.push(res.release);
      });

      expect(pacer.getStats().queueDepth).toBe(4);
      expect(dispatchOrder).toEqual([]);

      // Releasing lease0 allows request 1 to dispatch
      lease0.release();
      await new Promise((res) => setTimeout(res, 10));
      expect(dispatchOrder).toEqual([1]);
      expect(pacer.getStats().queueDepth).toBe(3);

      // Releasing request 1 allows request 2 to dispatch
      leases[0]!();
      await new Promise((res) => setTimeout(res, 10));
      expect(dispatchOrder).toEqual([1, 2]);
      expect(pacer.getStats().queueDepth).toBe(2);

      // Releasing request 2 allows request 3 to dispatch
      leases[1]!();
      await new Promise((res) => setTimeout(res, 10));
      expect(dispatchOrder).toEqual([1, 2, 3]);
      expect(pacer.getStats().queueDepth).toBe(1);

      // Releasing request 3 allows request 4 to dispatch
      leases[2]!();
      await p4;
      expect(dispatchOrder).toEqual([1, 2, 3, 4]);
      expect(pacer.getStats().queueDepth).toBe(0);

      // Final release
      leases[3]!();
      expect(pacer.getStats().currentTokens).toBe(0);
    });

    it("ensures calling release() multiple times is idempotent and does not decrement below 0 or double-trigger drains", async () => {
      const pacer = new RequestPacer({
        minIntervalMs: 0,
        maxConcurrency: 1,
        maxQueueDepth: 10,
      });

      const r1 = await pacer.acquire();
      expect(pacer.getStats().currentTokens).toBe(1);

      // Queue request 2
      let r2DispatchedCount = 0;
      const p2 = pacer.acquire().then((res) => {
        r2DispatchedCount++;
        return res;
      });

      // Call r1.release() 5 times consecutively
      r1.release();
      r1.release();
      r1.release();
      r1.release();
      r1.release();

      const r2 = await p2;
      expect(r2DispatchedCount).toBe(1);
      // currentTokens should be exactly 1 for r2, not corrupted into negative or zero
      expect(pacer.getStats().currentTokens).toBe(1);

      // Call r2.release() multiple times
      r2.release();
      r2.release();
      r2.release();

      expect(pacer.getStats().currentTokens).toBe(0);
      expect(pacer.getStats().queueDepth).toBe(0);
    });

  });
});
