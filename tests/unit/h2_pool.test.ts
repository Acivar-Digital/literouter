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

    // Test compound key prefix aggregation
    (pool as any).sessions.set(`${origin1}#openrouter:1`, [
      { session: { closed: false } as any, activeStreams: 2, origin: origin1, isDraining: false },
    ]);
    (pool as any).sessions.set(`${origin1}#openrouter:2`, [
      { session: { closed: false } as any, activeStreams: 1, origin: origin1, isDraining: false },
    ]);

    const aggregatedStats = pool.getSessionStats(origin1) as any;
    expect(aggregatedStats.sessionCount).toBe(4);
    expect(aggregatedStats.activeSessions).toBe(4);
    expect(aggregatedStats.totalActiveStreams).toBe(11);

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

  it("purgeSession evicts and destroys session by reference", () => {
    const pool = new Http2SessionPool();
    let destroyed = false;
    const fakeSession = {
      closed: false,
      destroyed: false,
      destroy: () => {
        destroyed = true;
      },
    } as unknown as http2.ClientHttp2Session;

    const origin = "https://openrouter.ai";
    (pool as any).sessions.set(origin, [
      {
        session: fakeSession,
        activeStreams: 1,
        origin,
        isDraining: false,
      },
    ]);

    pool.purgeSession(origin, fakeSession);
    expect(destroyed).toBe(true);
    expect((pool as any).sessions.get(origin)).toBeUndefined();
  });

  it("handles startDraining gracefully with zero active streams", () => {
    const pool = new Http2SessionPool({ maxSessionAgeMs: 60000 });
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

    const origin = "https://api.openai.com";
    const pooledItem = {
      session: fakeSession,
      activeStreams: 0,
      origin,
      isDraining: false,
      ageTimer: setTimeout(() => {}, 60000),
    };

    (pool as any).sessions.set(origin, [pooledItem]);

    // Invoke startDraining when age limit triggers with 0 streams
    (pool as any).startDraining(origin, pooledItem);

    expect(isClosed).toBe(true);
    expect((pool as any).sessions.get(origin)).toBeUndefined();
  });

  it("handles startDraining with active streams by deferring destruction until releaseStream", () => {
    const pool = new Http2SessionPool({ maxSessionAgeMs: 60000, drainTimeoutMs: 10000 });
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

    const origin = "https://api.openai.com";
    const pooledItem = {
      session: fakeSession,
      activeStreams: 1,
      origin,
      isDraining: false,
      ageTimer: setTimeout(() => {}, 60000),
    };

    (pool as any).sessions.set(origin, [pooledItem]);

    // Age timer triggers startDraining while stream is in-flight
    (pool as any).startDraining(origin, pooledItem);

    expect(pooledItem.isDraining).toBe(true);
    expect(isClosed).toBe(false); // Must NOT close while stream is active!
    expect((pool as any).sessions.get(origin)?.length).toBe(1);

    // Stream completes and releases
    pool.releaseStream(origin, fakeSession);

    expect(isClosed).toBe(true); // Now closed cleanly!
    expect((pool as any).sessions.get(origin)).toBeUndefined();
  });

  it("acquireSession evicts dead/destroyed sessions and creates a fresh session", async () => {
    const pool = new Http2SessionPool();
    const deadSession = {
      closed: true,
      destroyed: true,
      destroy: () => {},
    } as unknown as http2.ClientHttp2Session;

    const origin = "https://mock-origin.local";
    (pool as any).sessions.set(origin, [
      {
        session: deadSession,
        activeStreams: 0,
        origin,
        isDraining: false,
      },
    ]);

    // Mock createSession to avoid actual TCP connection
    const freshSession = {
      closed: false,
      destroyed: false,
      destroy: () => {},
    } as unknown as http2.ClientHttp2Session;

    (pool as any).createSession = async () => {
      (pool as any).sessions.set(origin, [
        {
          session: freshSession,
          activeStreams: 0,
          origin,
          isDraining: false,
        },
      ]);
      return freshSession;
    };

    const acquired = await pool.acquireSession(origin);
    expect(acquired).toBe(freshSession);
    expect((pool as any).sessions.get(origin)[0].activeStreams).toBe(1);
  });

  it("increments activeStreams on emergency fallback session when all sessions are maxed out", async () => {
    const origin = "https://mock-origin.local";
    const pool = new Http2SessionPool({ maxStreamsPerSession: 2, sessionsPerOrigin: 1 });

    const maxedSession = {
      closed: false,
      destroyed: false,
      destroy: () => {},
    } as unknown as http2.ClientHttp2Session;

    // Existing session is at maxStreamsPerSession (2) and sessionsPerOrigin (1) is reached
    (pool as any).sessions.set(origin, [
      {
        session: maxedSession,
        activeStreams: 2,
        origin,
        isDraining: false,
      },
    ]);

    const emergencySession = {
      closed: false,
      destroyed: false,
      destroy: () => {},
    } as unknown as http2.ClientHttp2Session;

    (pool as any).createSession = async () => {
      const emergencyItem = {
        session: emergencySession,
        activeStreams: 0,
        origin,
        isDraining: false,
      };
      const existing = (pool as any).sessions.get(origin) ?? [];
      existing.push(emergencyItem);
      (pool as any).sessions.set(origin, existing);
      return emergencySession;
    };

    const acquired = await pool.acquireSession(origin);
    expect(acquired).toBe(emergencySession);

    // Verify SRE fix: activeStreams on the emergency session item must be 1, NOT 0!
    const poolItems = (pool as any).sessions.get(origin);
    const emergencyPooled = poolItems.find((p: any) => p.session === emergencySession);
    expect(emergencyPooled.activeStreams).toBe(1);
  });

  it("accurately reports session health via isSessionHealthy", () => {
    const pool = new Http2SessionPool();

    const healthySession = {
      closed: false,
      destroyed: false,
      connecting: false,
      socket: { destroyed: false },
    } as unknown as http2.ClientHttp2Session;
    expect(pool.isSessionHealthy(healthySession)).toBe(true);

    const closedSession = {
      closed: true,
      destroyed: false,
      connecting: false,
    } as unknown as http2.ClientHttp2Session;
    expect(pool.isSessionHealthy(closedSession)).toBe(false);

    const destroyedSession = {
      closed: false,
      destroyed: true,
      connecting: false,
    } as unknown as http2.ClientHttp2Session;
    expect(pool.isSessionHealthy(destroyedSession)).toBe(false);

    const socketDeadSession = {
      closed: false,
      destroyed: false,
      connecting: false,
      socket: { destroyed: true },
    } as unknown as http2.ClientHttp2Session;
    expect(pool.isSessionHealthy(socketDeadSession)).toBe(false);
  });

  it("preserves healthy session in pool when an individual stream errors without session destruction", () => {
    const pool = new Http2SessionPool();
    const origin = "https://mock-origin.local";

    const healthySession = {
      closed: false,
      destroyed: false,
      connecting: false,
      socket: { destroyed: false },
      close: () => {},
      destroy: () => {},
    } as unknown as http2.ClientHttp2Session;

    const pooledItem = {
      session: healthySession,
      activeStreams: 2,
      origin,
      isDraining: false,
    };
    (pool as any).sessions.set(origin, [pooledItem]);

    // Mock two streams
    const stream1Handlers: Record<string, Function[]> = {};
    const stream1 = {
      once: (event: string, fn: Function) => {
        stream1Handlers[event] = stream1Handlers[event] || [];
        stream1Handlers[event].push(fn);
      },
    } as unknown as http2.ClientHttp2Stream;

    pool.attachStreamGuard(origin, healthySession, stream1);

    // Stream 1 experiences an error (e.g. client abort / cancel)
    stream1Handlers["error"]?.[0]?.(new Error("Stream canceled"));

    // Verify stream 1 released its stream count from 2 to 1
    expect(pooledItem.activeStreams).toBe(1);
    // Verify healthy session was NOT purged or destroyed
    expect((pool as any).sessions.get(origin)?.length).toBe(1);
    expect(pool.isSessionHealthy(healthySession)).toBe(true);
  });

  it("isolates HTTP/2 connection pools per provider API key", async () => {
    const pool = new Http2SessionPool();
    const origin = "https://openrouter.ai";
    const key1PoolKey = `${origin}#openrouter:1`;
    const key2PoolKey = `${origin}#openrouter:2`;

    const session1 = {
      closed: false,
      destroyed: false,
      connecting: false,
      socket: { destroyed: false },
      close: () => {},
      destroy: () => {},
    } as unknown as http2.ClientHttp2Session;

    const session2 = {
      closed: false,
      destroyed: false,
      connecting: false,
      socket: { destroyed: false },
      close: () => {},
      destroy: () => {},
    } as unknown as http2.ClientHttp2Session;

    (pool as any).createSession = async (poolKey: string, connectOrigin: string) => {
      expect(connectOrigin).toBe(origin);
      if (poolKey === key1PoolKey) {
        const item = { session: session1, activeStreams: 0, origin: connectOrigin, isDraining: false };
        (pool as any).sessions.set(poolKey, [item]);
        return session1;
      }
      const item = { session: session2, activeStreams: 0, origin: connectOrigin, isDraining: false };
      (pool as any).sessions.set(poolKey, [item]);
      return session2;
    };

    const acquired1 = await pool.acquireSession(key1PoolKey, origin);
    const acquired2 = await pool.acquireSession(key2PoolKey, origin);

    expect(acquired1).toBe(session1);
    expect(acquired2).toBe(session2);
    expect(acquired1).not.toBe(acquired2);

    // Purging key 1 does NOT touch key 2
    pool.purgeSession(key1PoolKey, session1);
    expect((pool as any).sessions.get(key1PoolKey)).toBeUndefined();
    expect((pool as any).sessions.get(key2PoolKey)?.length).toBe(1);
  });
});
