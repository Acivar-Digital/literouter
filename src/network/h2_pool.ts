import http2, {
  type ClientHttp2Session,
  type ClientHttp2Stream,
  constants as h2Constants,
} from "node:http2";

export interface PooledSession {
  session: ClientHttp2Session;
  activeStreams: number;
  origin: string;
  isDraining: boolean;
  drainTimer?: ReturnType<typeof setTimeout>;
}

export interface Http2PoolConfig {
  readonly maxStreamsPerSession?: number;
  readonly sessionsPerOrigin?: number;
  readonly drainTimeoutMs?: number;
  readonly connectTimeoutMs?: number;
}

export class Http2SessionPool {
  private readonly sessions = new Map<string, PooledSession[]>();
  private readonly connectionLocks = new Map<string, Promise<ClientHttp2Session>>();
  private readonly maxStreamsPerSession: number;
  private readonly sessionsPerOrigin: number;
  private readonly drainTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(config?: Http2PoolConfig) {
    this.maxStreamsPerSession = config?.maxStreamsPerSession ?? 80;
    this.sessionsPerOrigin = config?.sessionsPerOrigin ?? 4;
    this.drainTimeoutMs = config?.drainTimeoutMs ?? 30000;
    this.connectTimeoutMs = config?.connectTimeoutMs ?? 10000;
  }

  public async acquireSession(origin: string): Promise<ClientHttp2Session> {
    const pool = this.sessions.get(origin) ?? [];

    // 1. Find existing active, non-draining session with available stream capacity
    for (const item of pool) {
      if (
        !item.isDraining &&
        !item.session.closed &&
        !item.session.destroyed &&
        item.activeStreams < this.maxStreamsPerSession
      ) {
        item.activeStreams++;
        return item.session;
      }
    }

    // 2. Check if a connection is already in-flight (Single-Flight Mutex with try/catch)
    const inFlightConnection = this.connectionLocks.get(origin);
    if (inFlightConnection) {
      try {
        const session = await inFlightConnection;
        const item = (this.sessions.get(origin) ?? []).find((p) => p.session === session);
        if (item && !item.isDraining && item.activeStreams < this.maxStreamsPerSession) {
          item.activeStreams++;
          return item.session;
        }
      } catch (err) {
        // Shared flight failed; log and fall through safely to direct creation or fallback
        console.warn(`[H2 Pool] In-flight connection attempt failed for ${origin}, bypassing lock:`, err);
      }
    }

    // 3. Spawn new session with Single-Flight Mutex lock if under sessionsPerOrigin
    const activeNonDraining = pool.filter((p) => !p.isDraining && !p.session.closed && !p.session.destroyed);
    if (activeNonDraining.length < this.sessionsPerOrigin) {
      const connectPromise = this.createSession(origin);
      this.connectionLocks.set(origin, connectPromise);

      try {
        const session = await connectPromise;
        const item = (this.sessions.get(origin) ?? []).find((p) => p.session === session);
        if (item) item.activeStreams++;
        return session;
      } finally {
        this.connectionLocks.delete(origin);
      }
    }

    // 4. Fallback to least loaded active non-draining session
    const leastLoaded = activeNonDraining.sort((a, b) => a.activeStreams - b.activeStreams)[0];
    if (leastLoaded) {
      leastLoaded.activeStreams++;
      return leastLoaded.session;
    }

    // Emergency new session
    return this.createSession(origin);
  }

  /**
   * Attaches an atomic lifecycle guard to the HTTP/2 stream ensuring releaseStream is guaranteed.
   */
  public attachStreamGuard(origin: string, session: ClientHttp2Session, stream: ClientHttp2Stream): void {
    let released = false;
    const releaseOnce = () => {
      if (released) return;
      released = true;
      this.releaseStream(origin, session);
    };

    stream.once("close", releaseOnce);
    stream.once("error", releaseOnce);
    stream.once("frameError", releaseOnce);
    stream.once("finish", releaseOnce);
  }

  public releaseStream(origin: string, session: ClientHttp2Session): void {
    const pool = this.sessions.get(origin);
    if (!pool) return;
    const item = pool.find((p) => p.session === session);
    if (item && item.activeStreams > 0) {
      item.activeStreams--;
      // If session is draining and all active streams finished, clean up immediately
      if (item.isDraining && item.activeStreams === 0) {
        this.destroySession(origin, item);
      }
    }
  }

  public getSessionStats(origin?: string) {
    if (origin) {
      const pool = this.sessions.get(origin) ?? [];
      return {
        origin,
        sessionCount: pool.length,
        activeSessions: pool.filter((p) => !p.isDraining && !p.session.closed).length,
        totalActiveStreams: pool.reduce((acc, p) => acc + p.activeStreams, 0),
      };
    }
    const allStats: Record<string, { sessionCount: number; activeSessions: number; totalActiveStreams: number }> = {};
    for (const [org, pool] of this.sessions.entries()) {
      allStats[org] = {
        sessionCount: pool.length,
        activeSessions: pool.filter((p) => !p.isDraining && !p.session.closed).length,
        totalActiveStreams: pool.reduce((acc, p) => acc + p.activeStreams, 0),
      };
    }
    return allStats;
  }

  public closeAll(): void {
    for (const [origin, pool] of this.sessions.entries()) {
      for (const item of pool) {
        if (item.drainTimer) clearTimeout(item.drainTimer);
        try {
          if (!item.session.closed && !item.session.destroyed) {
            item.session.destroy();
          }
        } catch {
          // ignore destroy errors on cleanup
        }
      }
    }
    this.sessions.clear();
    this.connectionLocks.clear();
  }

  private async createSession(origin: string): Promise<ClientHttp2Session> {
    return new Promise<ClientHttp2Session>((resolve, reject) => {
      let connectTimer: ReturnType<typeof setTimeout> | null = null;
      let session: ClientHttp2Session;

      try {
        session = http2.connect(origin, {
          // ALPN negotiation happens over TLS
          timeout: this.connectTimeoutMs,
        });
      } catch (err) {
        return reject(err);
      }

      const pooled: PooledSession = {
        session,
        activeStreams: 0,
        origin,
        isDraining: false,
      };

      const cleanupListeners = () => {
        if (connectTimer) clearTimeout(connectTimer);
        session.removeListener("connect", onConnect);
        session.removeListener("error", onError);
      };

      const onConnect = () => {
        cleanupListeners();
        const pool = this.sessions.get(origin) ?? [];
        pool.push(pooled);
        this.sessions.set(origin, pool);
        resolve(session);
      };

      const onError = (err: Error) => {
        cleanupListeners();
        this.removeSession(origin, session);
        reject(err);
      };

      connectTimer = setTimeout(() => {
        cleanupListeners();
        this.removeSession(origin, session);
        try {
          session.destroy();
        } catch {
          // ignore
        }
        reject(new Error(`HTTP/2 connection timeout to origin ${origin}`));
      }, this.connectTimeoutMs);

      session.once("connect", onConnect);
      session.once("error", onError);

      session.on("close", () => this.removeSession(origin, session));

      // Upstream GOAWAY Handler: Keep session in pool for active stream releases, but mark isDraining
      session.on("goaway", () => {
        pooled.isDraining = true;
        // Start hard drain timeout fallback
        pooled.drainTimer = setTimeout(() => {
          this.destroySession(origin, pooled);
        }, this.drainTimeoutMs);
      });
    });
  }

  private destroySession(origin: string, item: PooledSession): void {
    if (item.drainTimer) clearTimeout(item.drainTimer);
    if (!item.session.closed && !item.session.destroyed) {
      try {
        item.session.close();
      } catch {
        // ignore
      }
    }
    this.removeSession(origin, item.session);
  }

  private removeSession(origin: string, session: ClientHttp2Session): void {
    const pool = this.sessions.get(origin);
    if (!pool) return;
    const filtered = pool.filter((p) => p.session !== session);
    if (filtered.length === 0) {
      this.sessions.delete(origin);
    } else {
      this.sessions.set(origin, filtered);
    }
  }
}

// Global HTTP/2 Session Pool singleton
let globalHttp2Pool: Http2SessionPool | null = null;

export function getHttp2Pool(): Http2SessionPool {
  if (!globalHttp2Pool) {
    globalHttp2Pool = new Http2SessionPool();
  }
  return globalHttp2Pool;
}

export function resetHttp2Pool(): void {
  if (globalHttp2Pool) {
    globalHttp2Pool.closeAll();
    globalHttp2Pool = null;
  }
}
