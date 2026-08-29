import { afterEach, describe, expect, it } from "bun:test";
import http2 from "node:http2";
import { Http2SessionPool, resetHttp2Pool } from "../../src/network/h2_pool";

describe("Outbound HTTP/2 Multiplexed Session Pool", () => {
  afterEach(() => {
    resetHttp2Pool();
  });

  it("attaches stream lifecycle guard and releases stream count idempotently", () => {
    const pool = new Http2SessionPool();
    const fakeSession = {
      closed: false,
      destroyed: false,
      close: () => {},
      destroy: () => {},
    } as unknown as http2.ClientHttp2Session;

    // Simulate an internal pooled session
    const origin = "https://mock-origin.local";
    (pool as any).sessions.set(origin, [
      {
        session: fakeSession,
        activeStreams: 2,
        origin,
        isDraining: false,
      },
    ]);

    // Create a mock stream
    const handlers: Record<string, Function[]> = {};
    const fakeStream = {
      once: (event: string, fn: Function) => {
        handlers[event] = handlers[event] || [];
        handlers[event].push(fn);
      },
    } as unknown as http2.ClientHttp2Stream;

    pool.attachStreamGuard(origin, fakeSession, fakeStream);

    expect((pool as any).sessions.get(origin)[0].activeStreams).toBe(2);

    // Fire "close" event once
    handlers["close"]?.[0]?.();
    expect((pool as any).sessions.get(origin)[0].activeStreams).toBe(1);

    // Fire duplicate "error" event (must be idempotent due to released flag)
    handlers["error"]?.[0]?.();
    expect((pool as any).sessions.get(origin)[0].activeStreams).toBe(1);
  });

  it("handles in-pool GOAWAY graceful drain and destroys session when active streams hit 0", () => {
    const pool = new Http2SessionPool({ drainTimeoutMs: 5000 });
    let isClosed = false;

    const fakeSession = {
      closed: false,
      destroyed: false,
      close: () => {
        isClosed = true;
      },
      destroy: () => {
        isClosed = true;
      },
    } as unknown as http2.ClientHttp2Session;

    const origin = "https://mock-origin.local";
    const pooledItem = {
      session: fakeSession,
      activeStreams: 1,
      origin,
      isDraining: true, // Mark draining as if GOAWAY received
    };

    (pool as any).sessions.set(origin, [pooledItem]);

    // When last active stream releases, it should trigger immediate destroy
    pool.releaseStream(origin, fakeSession);

    expect(pooledItem.activeStreams).toBe(0);
    expect(isClosed).toBe(true);
    expect((pool as any).sessions.get(origin)).toBeUndefined();
  });

  it("provides session pool telemetry stats across origins", () => {
    const pool = new Http2SessionPool();
    const origin1 = "https://openrouter.ai";
    const origin2 = "https://api.groq.com";

    (pool as any).sessions.set(origin1, [
      {
        session: { closed: false } as any,
        activeStreams: 5,
        origin: origin1,
        isDraining: false,
      },
      {
        session: { closed: false } as any,
        activeStreams: 3,
        origin: origin1,
        isDraining: false,
      },
    ]);

    (pool as any).sessions.set(origin2, [
      {
        session: { closed: false } as any,
        activeStreams: 1,
        origin: origin2,
        isDraining: false,
      },
    ]);

    const stats1 = pool.getSessionStats(origin1) as any;
    expect(stats1.sessionCount).toBe(2);
    expect(stats1.activeSessions).toBe(2);
    expect(stats1.totalActiveStreams).toBe(8);

    const allStats = pool.getSessionStats() as any;
    expect(allStats[origin1]?.totalActiveStreams).toBe(8);
    expect(allStats[origin2]?.totalActiveStreams).toBe(1);
  });

  it("purges and destroys session immediately on runtime error or socket reset", () => {
    const pool = new Http2SessionPool();
    let isDestroyed = false;

    const fakeSession = {
      closed: false,
      destroyed: false,
      destroy: () => {
        isDestroyed = true;
      },
      close: () => {},
    } as unknown as http2.ClientHttp2Session;

    const origin = "https://openrouter.ai";
    const pooledItem = {
      session: fakeSession,
      activeStreams: 1,
      origin,
      isDraining: false,
      drainTimer: setTimeout(() => {}, 10000),
    };

    (pool as any).sessions.set(origin, [pooledItem]);
    expect((pool as any).sessions.get(origin)?.length).toBe(1);

    // Call destroySession (triggered by session.on("error") or session.on("close"))
    (pool as any).destroySession(origin, pooledItem);

    expect(isDestroyed).toBe(true);
    expect((pool as any).sessions.get(origin)).toBeUndefined();
  });
});
