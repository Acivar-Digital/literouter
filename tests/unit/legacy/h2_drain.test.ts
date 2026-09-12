import { afterEach, describe, expect, it } from "bun:test";
import type http2 from "node:http2";
import { Http2SessionPool, type PooledSession, resetHttp2Pool } from "../../../src/network/h2_pool";

function makeMockSession() {
  let destroyCalls = 0;
  let closeCalls = 0;
  const session = {
    closed: false,
    destroyed: false,
    connecting: false,
    destroy: () => {
      destroyCalls++;
    },
    close: () => {
      closeCalls++;
    },
  } as unknown as http2.ClientHttp2Session;
  return {
    session,
    calls: {
      get destroyCalls() {
        return destroyCalls;
      },
      get closeCalls() {
        return closeCalls;
      },
      get totalTeardownCalls() {
        return destroyCalls + closeCalls;
      },
    },
  };
}

describe("H2 drain regression: active streams survive age-out", () => {
  afterEach(() => {
    resetHttp2Pool();
  });

  it("(a) startDraining with activeStreams>0 sets isDraining, does NOT destroy, re-arms drainTimer", () => {
    const pool = new Http2SessionPool({ maxSessionAgeMs: 60000, drainTimeoutMs: 10000 });
    const { session, calls } = makeMockSession();
    const origin = "https://drain-regression.local";

    const pooledItem: PooledSession = {
      session,
      activeStreams: 2,
      origin,
      isDraining: false,
      ageTimer: setTimeout(() => {}, 60000),
    };
    (pool as any).sessions.set(origin, [pooledItem]);

    (pool as any).startDraining(origin, pooledItem);

    expect(pooledItem.isDraining).toBe(true);
    // Must NOT destroy while streams are in-flight
    expect(calls.totalTeardownCalls).toBe(0);
    // Session must survive in pool
    expect((pool as any).sessions.get(origin)?.length).toBe(1);
    // ageTimer cleared, drainTimer re-armed
    expect(pooledItem.ageTimer).toBeUndefined();
    expect(pooledItem.drainTimer).not.toBeUndefined();

    pool.closeAll();
  });

  it("(b) draining session destroys only after releaseStream drops counter to 0", () => {
    const pool = new Http2SessionPool({ maxSessionAgeMs: 60000, drainTimeoutMs: 10000 });
    const { session, calls } = makeMockSession();
    const origin = "https://drain-regression.local";

    const pooledItem: PooledSession = {
      session,
      activeStreams: 2,
      origin,
      isDraining: false,
      ageTimer: setTimeout(() => {}, 60000),
    };
    (pool as any).sessions.set(origin, [pooledItem]);

    (pool as any).startDraining(origin, pooledItem);
    expect(pooledItem.isDraining).toBe(true);
    expect(calls.totalTeardownCalls).toBe(0);

    // First release: 2 -> 1, session must survive
    pool.releaseStream(origin, session);
    expect(pooledItem.activeStreams).toBe(1);
    expect(calls.totalTeardownCalls).toBe(0);
    expect((pool as any).sessions.get(origin)?.length).toBe(1);

    // Second release: 1 -> 0, session must be destroyed + evicted
    pool.releaseStream(origin, session);
    expect(pooledItem.activeStreams).toBe(0);
    expect(calls.totalTeardownCalls).toBe(1);
    expect((pool as any).sessions.get(origin)).toBeUndefined();

    pool.closeAll();
  });

  it("(c) draining teardown uses an observable close path (close or destroy) only at zero streams", () => {
    const pool = new Http2SessionPool({ maxSessionAgeMs: 60000, drainTimeoutMs: 10000 });
    const { session, calls } = makeMockSession();
    const origin = "https://drain-regression.local";

    const pooledItem: PooledSession = {
      session,
      activeStreams: 1,
      origin,
      isDraining: false,
    };
    (pool as any).sessions.set(origin, [pooledItem]);

    (pool as any).startDraining(origin, pooledItem);

    // While draining with a live stream, neither close nor destroy may fire.
    expect(calls.destroyCalls).toBe(0);
    expect(calls.closeCalls).toBe(0);
    expect((pool as any).sessions.get(origin)?.length).toBe(1);

    pool.releaseStream(origin, session);

    // Forward-compatible: current destroySession prefers destroy(), a future
    // graceful-drain fix may prefer close() for draining sessions. Accept either,
    // but exactly one teardown signal must fire and the pool entry is evicted.
    expect(calls.totalTeardownCalls).toBe(1);
    expect((pool as any).sessions.get(origin)).toBeUndefined();

    pool.closeAll();
  });

  it("startDraining is idempotent and re-arms drainTimer while active streams remain", async () => {
    const pool = new Http2SessionPool({ maxSessionAgeMs: 60000, drainTimeoutMs: 20 });
    const { session, calls } = makeMockSession();
    const origin = "https://drain-regression.local";

    const pooledItem: PooledSession = {
      session,
      activeStreams: 1,
      origin,
      isDraining: false,
    };
    (pool as any).sessions.set(origin, [pooledItem]);

    (pool as any).startDraining(origin, pooledItem);
    const firstTimer = pooledItem.drainTimer;
    expect(firstTimer).not.toBeUndefined();

    // Second drain signal must be a no-op (no double timer, no destroy)
    (pool as any).startDraining(origin, pooledItem);
    expect(pooledItem.drainTimer).toBe(firstTimer);
    expect(calls.totalTeardownCalls).toBe(0);

    // After drainTimeout, if activeStreams > 0, startDraining re-arms rather than abruptly destroying
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(calls.totalTeardownCalls).toBe(0);
    expect(pooledItem.isDraining).toBe(true);
    expect((pool as any).sessions.get(origin)?.length).toBe(1);

    // Once the stream releases, teardown fires
    pool.releaseStream(origin, session);
    expect(calls.totalTeardownCalls).toBe(1);
    expect((pool as any).sessions.get(origin)).toBeUndefined();

    pool.closeAll();
  });
});
