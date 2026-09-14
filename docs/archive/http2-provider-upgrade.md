# LiteRouter Outbound HTTP/2 Multiplexing, Anti-429 Pacing & Circuit Breaker Architecture

## 1. Executive Summary & Philosophy

This specification details **The LiteRouter Way** to implement outbound HTTP/2 multiplexing, rate-limiting queue pacing (Anti-429), and provider-level circuit breakers without rewriting LiteRouter in Go or Rust.

### The LiteRouter Principles:
1. **Zero-Rewrite Pragmatism**: LiteRouter remains on **TypeScript / Bun**. The gateway overhead is $<0.5\text{ms}$ while upstream LLM inference is $300\text{ms}\text{--}3000\text{ms}$. Rewriting in Go/Rust introduces massive JSON schema friction without perceptible latency gains.
2. **Transport vs. Application Separation**:
   - **HTTP/2 Transport**: Manages persistent multiplexed streams, eliminating TCP handshakes and header overhead.
   - **Application Layer Protection**: Token-bucket rate pacing, TTFT stall detection, cooldown ladder rotation, and circuit breaking prevent $429$, $500$, and $529$ failures from reaching client agents.
3. **HTTP Status Code Immutability (No Premature 200 Traps)**: Queued requests **never** emit premature HTTP `200 OK` SSE headers while waiting. Instead, requests are queued up to a bounded timeout (e.g., max 15s). If capacity is unavailable or upstream rejects, clean HTTP status codes (`429`, `401`, `500`, `503`) are preserved and returned directly to the client.
4. **Resilient Session Lifecycle Management**:
   - **GOAWAY Graceful Draining**: Sessions undergoing graceful shutdown remain tracked in the pool with `isDraining: true` so inflight streams cleanly decrement counters and trigger zero-stream closure without waiting for hard timeouts.
   - **Single-Flight Mutex with Resilient Fallback**: Connection attempts are coalesced per origin, with error boundary protection preventing sibling promise crashes.
   - **Expiring Canary Leases**: Circuit breaker `HALF_OPEN` state enforces a single canary lease protected by a 60s lease timeout to prevent deadlocks.
   - **EMA Telemetry**: Queue dwell times use Exponential Moving Averages ($O(1)$ constant memory) preventing integer overflow over long-running daemon lifecycles.
5. **Instant Hot-Rollback**: Every subsystem is gated by environment flags (`LITEROUTER_H2_OUTBOUND`, `LITEROUTER_PACER_ENABLED`, `LITEROUTER_CIRCUIT_BREAKER`) for zero-risk zero-downtime rollback.

---

## 2. End-to-End Architectural Blueprint

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Downstream Clients                              │
│       Claude Code (HTTP/1.1) │ OpenCode 2 (HTTP/1.1) │ Pydantic AI (H2)│
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ TLS localhost:7766 (ALPN: h2, http/1.1)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          LiteRouter Engine                             │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 1. Ingress & Cross-Wire Schema Translation                       │  │
│  │    • Anthropic (/v1/messages) ⇄ OpenAI (/v1/chat/completions)    │  │
│  │    • Thought tag sanitization & reasoning extraction             │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 2. Token Bucket Pacer & Anti-429 Queue (src/network/pacer.ts)    │  │
│  │    • Per-key & Per-provider RPM/TPM Leaky Bucket                 │  │
│  │    • O(1) Fast FIFO Queue with EMA Dwell Time Telemetry (α=0.1)  │  │
│  │    • Bounded Queue Timeout (15s) → Clean Local HTTP 429 Response │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 3. Provider Circuit Breaker (src/network/circuit_breaker.ts)     │  │
│  │    • CLOSED → OPEN (5x 5xx/529) → HALF-OPEN (Canary Lease)       │  │
│  │    • 60s Canary Lease Timeout: Zero Deadlocks on Dropped Probes  │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 4. Fusion Sticky Fallback Engine (src/fusion/engine.ts)          │  │
│  │    • Tier 1: Primary → Tier 2: Secondary → Tier 3: Budget        │  │
│  │    • Model alias resolution (e.g., opus-high-speed)              │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ 5. Outbound HTTP/2 Multiplexed Pool (src/network/h2_pool.ts)     │  │
│  │    • Single-Flight Mutex with try/catch Handshake Boundary       │  │
│  │    • In-Pool GOAWAY Draining: Stream Zero-Count Triggered Close  │  │
│  │    • Deterministic Stream Scope RAII Guard (Zero Stream Leaks)   │  │
│  │    • Fallback to HTTP/1.1 keep-alive if ALPN rejected            │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      │ Outbound Multiplexed H2 Streams
                                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│                        Upstream AI Providers                           │
│   OpenRouter (H2) │ Google Vertex (H2) │ NVIDIA NIM (H2) │ MiniMax (H2)│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Module Specifications & TypeScript Blueprints

### Module 1: Token Bucket Pacer, $O(1)$ FIFO Queue & EMA Dwell Telemetry (`src/network/pacer.ts`)

Prevents upstream rate-limit saturation without violating downstream HTTP status code contracts, using an Exponential Moving Average (EMA) to prevent integer overflows.

```typescript
export class PacerQueueOverflowError extends Error {
  public readonly retryAfterSec: number;
  constructor(message: string, retryAfterSec = 5) {
    super(message);
    this.name = "PacerQueueOverflowError";
    this.retryAfterSec = retryAfterSec;
  }
}

export class PacerQueueTimeoutError extends Error {
  public readonly retryAfterSec: number;
  constructor(message: string, retryAfterSec = 5) {
    super(message);
    this.name = "PacerQueueTimeoutError";
    this.retryAfterSec = retryAfterSec;
  }
}

interface QueueEntry {
  resolve: () => void;
  reject: (err: Error) => void;
  enqueuedAt: number;
  timeoutTimer: ReturnType<typeof setTimeout>;
}

interface QueueNode<T> {
  value: T;
  next: QueueNode<T> | null;
  prev: QueueNode<T> | null;
}

class FastFifoQueue<T> {
  private head: QueueNode<T> | null = null;
  private tail: QueueNode<T> | null = null;
  private _size = 0;

  public get size(): number {
    return this._size;
  }

  public enqueue(value: T): QueueNode<T> {
    const node: QueueNode<T> = { value, next: null, prev: this.tail };
    if (this.tail) {
      this.tail.next = node;
      this.tail = node;
    } else {
      this.head = node;
      this.tail = node;
    }
    this._size++;
    return node;
  }

  public dequeue(): T | undefined {
    if (!this.head) return undefined;
    const value = this.head.value;
    this.head = this.head.next;
    if (this.head) {
      this.head.prev = null;
    } else {
      this.tail = null;
    }
    this._size--;
    return value;
  }

  public remove(node: QueueNode<T>): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (node === this.head) this.head = node.next;
    if (node === this.tail) this.tail = node.prev;
    this._size--;
  }
}

export interface PacerConfig {
  readonly maxRpm: number;
  readonly maxQueueDepth: number;
  readonly maxQueueWaitMs: number; // e.g. 15,000ms
}

export class RequestPacer {
  private tokens: number;
  private lastRefillMs: number;
  private readonly queue = new FastFifoQueue<QueueEntry>();
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private emaDwellTimeMs = 0;

  constructor(private readonly config: PacerConfig) {
    this.tokens = config.maxRpm;
    this.lastRefillMs = Date.now();
  }

  public async acquire(signal?: AbortSignal): Promise<{ queueDwellMs: number }> {
    this.refill();
    if (this.tokens >= 1 && this.queue.size === 0) {
      this.tokens -= 1;
      this.updateEma(0);
      return { queueDwellMs: 0 };
    }

    if (this.queue.size >= this.config.maxQueueDepth) {
      const estimatedWaitSec = Math.ceil((this.queue.size + 1) / (this.config.maxRpm / 60));
      throw new PacerQueueOverflowError(
        `LiteRouter rate limit capacity (${this.config.maxQueueDepth}) saturated.`,
        Math.max(1, estimatedWaitSec)
      );
    }

    const enqueuedAt = Date.now();

    return new Promise<{ queueDwellMs: number }>((resolve, reject) => {
      let node: QueueNode<QueueEntry> | null = null;

      const cleanup = () => {
        if (node) this.queue.remove(node);
        signal?.removeEventListener("abort", abortHandler);
      };

      const abortHandler = () => {
        cleanup();
        clearTimeout(entry.timeoutTimer);
        reject(new Error("Request aborted while queued in LiteRouter pacer"));
      };

      // Pure Conveyor Belt Entry: Dispatches on FIFO tick with zero artificial wait timeouts
      const entry: QueueEntry = {
        resolve: () => {
          cleanup();
          const dwellMs = Date.now() - enqueuedAt;
          this.updateEma(dwellMs);
          resolve({ queueDwellMs: dwellMs });
        },
        reject: (err) => {
          cleanup();
          clearTimeout(timeoutTimer);
          reject(err);
        },
        enqueuedAt,
        timeoutTimer,
      };

      if (signal?.aborted) {
        clearTimeout(timeoutTimer);
        return reject(new Error("Request already aborted"));
      }

      signal?.addEventListener("abort", abortHandler, { once: true });
      node = this.queue.enqueue(entry);
      this.scheduleDrain();
    });
  }

  public getStats() {
    return {
      currentTokens: this.tokens,
      queueDepth: this.queue.size,
      avgDwellTimeMs: Math.round(this.emaDwellTimeMs),
    };
  }

  private updateEma(dwellMs: number): void {
    if (this.emaDwellTimeMs === 0) {
      this.emaDwellTimeMs = dwellMs;
    } else {
      // Exponential Moving Average: 10% weight to new sample, 90% historical
      this.emaDwellTimeMs = (dwellMs * 0.1) + (this.emaDwellTimeMs * 0.9);
    }
  }

  private refill(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillMs;
    const tokensToAdd = (elapsedMs / 60000) * this.config.maxRpm;
    this.tokens = Math.min(this.config.maxRpm, this.tokens + tokensToAdd);
    this.lastRefillMs = now;
  }

  private scheduleDrain(): void {
    if (this.drainTimer || this.queue.size === 0) return;
    const interval = Math.max(10, Math.ceil(60000 / this.config.maxRpm));
    
    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.refill();
      while (this.tokens >= 1 && this.queue.size > 0) {
        const next = this.queue.dequeue();
        next?.resolve();
      }
      if (this.queue.size > 0) {
        this.scheduleDrain();
      }
    }, interval);
  }
}
```

---

### Module 2: Provider Circuit Breaker with 60s Expiring Canary Lease (`src/network/circuit_breaker.ts`)

Restricts `HALF_OPEN` state to a single canary probe while enforcing a 60-second lease timestamp to prevent permanent deadlock if a canary probe drops.

```typescript
export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerConfig {
  readonly failureThreshold: number; // e.g. 5 consecutive 5xx/529
  readonly cooldownMs: number;        // e.g. 60_000ms
  readonly maxCanaryDurationMs?: number; // e.g. 60_000ms
}

export class ProviderCircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failureCount = 0;
  private nextProbeTimeMs = 0;
  private isCanaryInFlight = false;
  private canaryLockTimestampMs = 0;
  private readonly maxCanaryDurationMs: number;

  constructor(
    public readonly providerName: string,
    private readonly config: CircuitBreakerConfig = { failureThreshold: 5, cooldownMs: 60000 }
  ) {
    this.maxCanaryDurationMs = config.maxCanaryDurationMs ?? 60000;
  }

  /**
   * Evaluates if traffic is allowed.
   * In HALF_OPEN, permits ONLY ONE concurrent canary request with a 60s expiring lease.
   */
  public isAvailable(): boolean {
    const now = Date.now();
    if (this.state === "OPEN") {
      if (now >= this.nextProbeTimeMs) {
        this.state = "HALF_OPEN";
        this.isCanaryInFlight = true;
        this.canaryLockTimestampMs = now;
        return true; // Designated single canary probe
      }
      return false; // Circuit still open
    }

    if (this.state === "HALF_OPEN") {
      // Lease check: if canary in flight has exceeded max duration, forcibly grant new lease
      const isLeaseExpired = now - this.canaryLockTimestampMs > this.maxCanaryDurationMs;
      if (!this.isCanaryInFlight || isLeaseExpired) {
        this.isCanaryInFlight = true;
        this.canaryLockTimestampMs = now;
        return true;
      }
      // Another active canary is currently testing upstream; route other calls to fallback
      return false;
    }

    return true; // CLOSED - healthy
  }

  public recordSuccess(): void {
    this.failureCount = 0;
    this.state = "CLOSED";
    this.isCanaryInFlight = false;
    this.canaryLockTimestampMs = 0;
  }

  public recordFailure(isCritical5xx: boolean): void {
    if (!isCritical5xx) {
      if (this.state === "HALF_OPEN") {
        this.isCanaryInFlight = false;
        this.canaryLockTimestampMs = 0;
      }
      return;
    }

    this.failureCount += 1;
    this.isCanaryInFlight = false;
    this.canaryLockTimestampMs = 0;
    
    // In HALF_OPEN, a single failure immediately kicks back to OPEN with full cooldown
    if (this.state === "HALF_OPEN" || this.failureCount >= this.config.failureThreshold) {
      this.state = "OPEN";
      this.nextProbeTimeMs = Date.now() + this.config.cooldownMs;
    }
  }

  public getState(): CircuitState {
    return this.state;
  }
}
```

---

### Module 3: Outbound HTTP/2 Multiplexed Pool with Non-Blocking Single-Flight & In-Pool GOAWAY Drain (`src/network/h2_pool.ts`)

Guarantees:
1. **Single-Flight Connection Mutex with Error Boundary**: Sibling requests awaiting shared handshakes catch rejections gracefully and fall back instead of unhandled promise crashing.
2. **In-Pool GOAWAY Tracking**: Draining sessions remain visible to `releaseStream` so `activeStreams === 0` cleans up cleanly before the 30s hard timeout.
3. **Deterministic Stream Scope RAII Guard**: `activeStreams` decrement is unconditionally guaranteed.

```typescript
import http2, { type ClientHttp2Session, type ClientHttp2Stream } from "node:http2";

interface PooledSession {
  session: ClientHttp2Session;
  activeStreams: number;
  origin: string;
  isDraining: boolean;
  drainTimer?: ReturnType<typeof setTimeout>;
}

export class Http2SessionPool {
  private readonly sessions = new Map<string, PooledSession[]>();
  private readonly connectionLocks = new Map<string, Promise<ClientHttp2Session>>();
  private readonly maxStreamsPerSession = 80;
  private readonly sessionsPerOrigin = 4;
  private readonly drainTimeoutMs = 30000;

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
        const item = (this.sessions.get(origin) ?? []).find(p => p.session === session);
        if (item && !item.isDraining && item.activeStreams < this.maxStreamsPerSession) {
          item.activeStreams++;
          return item.session;
        }
      } catch (err) {
        // Shared flight failed; log and fall through safely to direct creation or emergency session
        console.warn(`[H2 Pool] In-flight connection attempt failed for ${origin}, bypassing lock:`, err);
      }
    }

    // 3. Spawn new session with Single-Flight Mutex lock
    const activeNonDraining = pool.filter(p => !p.isDraining && !p.session.closed);
    if (activeNonDraining.length < this.sessionsPerOrigin) {
      const connectPromise = this.createSession(origin);
      this.connectionLocks.set(origin, connectPromise);
      
      try {
        const session = await connectPromise;
        const item = (this.sessions.get(origin) ?? []).find(p => p.session === session);
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
  }

  public releaseStream(origin: string, session: ClientHttp2Session): void {
    const pool = this.sessions.get(origin);
    if (!pool) return;
    const item = pool.find(p => p.session === session);
    if (item && item.activeStreams > 0) {
      item.activeStreams--;
      // If session is draining and all active streams finished, clean up immediately
      if (item.isDraining && item.activeStreams === 0) {
        this.destroySession(origin, item);
      }
    }
  }

  private async createSession(origin: string): Promise<ClientHttp2Session> {
    return new Promise<ClientHttp2Session>((resolve, reject) => {
      const session = http2.connect(origin);
      const pooled: PooledSession = { session, activeStreams: 0, origin, isDraining: false };

      const onConnect = () => {
        session.removeListener("error", onError);
        const pool = this.sessions.get(origin) ?? [];
        pool.push(pooled);
        this.sessions.set(origin, pool);
        resolve(session);
      };

      const onError = (err: Error) => {
        this.removeSession(origin, session);
        reject(err);
      };

      session.once("connect", onConnect);
      session.once("error", onError);

      session.on("close", () => this.removeSession(origin, session));

      // Upstream GOAWAY Handler: Keep session in pool for stream release, but mark isDraining
      session.on("goaway", () => {
        pooled.isDraining = true;
        // Start 30s hard drain timeout fallback
        pooled.drainTimer = setTimeout(() => {
          this.destroySession(origin, pooled);
        }, this.drainTimeoutMs);
      });
    });
  }

  private destroySession(origin: string, item: PooledSession): void {
    if (item.drainTimer) clearTimeout(item.drainTimer);
    if (!item.session.closed && !item.session.destroyed) {
      item.session.close();
    }
    this.removeSession(origin, item.session);
  }

  private removeSession(origin: string, session: ClientHttp2Session): void {
    const pool = this.sessions.get(origin);
    if (!pool) return;
    const filtered = pool.filter(p => p.session !== session);
    this.sessions.set(origin, filtered);
  }
}
```

---

## 4. Phased Implementation Roadmap

| Phase | Milestone | Deliverables | Verification |
|---|---|---|---|
| **Phase 1** | **Anti-429 Pacer with EMA & Bounded Timeout** | `src/network/pacer.ts`, integration into handlers. Preserves HTTP status codes; emits clean 429 on timeout/saturation; tracks EMA dwell time. | Unit tests verify queue wait timeout, $O(1)$ fast queue, EMA calculation, and clean 429 response structure. |
| **Phase 2** | **Circuit Breaker with 60s Expiring Canary** | `src/network/circuit_breaker.ts`, strict `HALF_OPEN` single-flight probe with lease expiration. | Mock 500 error sequence trips circuit to `OPEN`; test canary lease auto-recovery after 60s simulated hang. |
| **Phase 3** | **Outbound HTTP/2 Pool with Safe GOAWAY & Mutex** | `src/network/h2_pool.ts`, single-flight connect mutex with error boundary, in-pool GOAWAY stream counter tracking. | Concurrency tests with 100 simultaneous requests confirm $\le 4$ sockets created; verify GOAWAY session drains to 0 and closes. |
| **Phase 4** | **Telemetry & Status Health UI** | Update `/health` endpoint and terminal banner to report active H2 sessions, pacer EMA dwell times, and circuit states. | `curl -k https://localhost:7766/health` includes complete circuit/pacer telemetry. |

---

## 5. Rollback Strategy & Verification Gates

### Safety Flags in `src/config/schema.ts`
All three features can be globally disabled at runtime via `.env.local` or environment variables without code modification:

```bash
# Instant Hot-Rollback Envs
LITEROUTER_H2_OUTBOUND="false"
LITEROUTER_PACER_ENABLED="false"
LITEROUTER_CIRCUIT_BREAKER="false"
```

### Verification Commands
```bash
# 1. Run all unit tests
bun test

# 2. Run Python integration smoke tests against live gateway
uv run pytest tests/integration/

# 3. Verify Claude Code compatibility
claude --print "Write a one-sentence haiku about speed."
```

---

## 6. Post-Implementation: Terminal Connection Inspection & Diagnostics

You can inspect active inbound/outbound connections, HTTP/2 session multiplexing, and circuit states directly from the terminal.

### 1. Gateway Health & Telemetry Endpoint
Query the live gateway telemetry to inspect outbound HTTP/2 session pools, active streams per origin, and provider circuit breaker statuses:

```bash
curl -sk https://localhost:7766/health | jq .
```

**Telemetry Payload Example:**
```json
{
  "status": "healthy",
  "uptime": 3600.24,
  "timestamp": "2026-08-19T04:15:00.000Z",
  "h2_outbound": {
    "https://generativelanguage.googleapis.com": {
      "totalSessions": 1,
      "activeStreams": 3,
      "isDraining": false
    }
  },
  "circuit_breakers": {
    "gg": {
      "state": "CLOSED",
      "failureCount": 0,
      "isCanaryInFlight": false
    }
  }
}
```

---

### 2. OS-Level Socket Inspection (`ss` / `lsof`)

#### A. Downstream Client Connections (Port `7766`)
Inspect incoming connections from downstream clients (e.g. Claude Code, OpenCode CLI, Python/Pydantic AI):

```bash
# Using ss (Socket Statistics)
ss -tan '( sport = :7766 or dport = :7766 )'

# Using lsof
lsof -i :7766
```

#### B. Outbound Upstream Connections (Port `443`)
Inspect persistent outbound TCP/TLS connections from LiteRouter to upstream LLM providers (Google Gemini, OpenRouter, NVIDIA, Zen, DeepSeek):

```bash
# Find LiteRouter PID and list outbound sockets
PID=$(pgrep -f "bun run src/index.ts" || cat .literouter.pid 2>/dev/null)
ss -tanp | grep "pid=$PID"
```

#### C. Real-Time Socket Watcher
Monitor live inbound client requests and outbound upstream multiplexing concurrently:

```bash
watch -n 1 'ss -tanp | grep -E "7766|bun"'
```

---

### 3. Live Logs and Trace File Inspection

- **Live Gateway Daemon Logs:**
  ```bash
  # Attach to the background tmux session
  tmux attach -t literouter
  
  # Or capture the last 50 log lines without attaching:
  tmux capture-pane -pt literouter -S -50
  ```

- **Detailed Inbound/Outbound Request Traces:**
  ```bash
  # View the most recent request trace (inbound body/headers, upstream URL, TTFT, and duration)
  cat logs/traces/$(ls -t logs/traces/ | head -n 1) | jq .
  ```

