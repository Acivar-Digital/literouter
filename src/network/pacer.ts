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

export interface QueueNode<T> {
  value: T;
  next: QueueNode<T> | null;
  prev: QueueNode<T> | null;
}

export class FastFifoQueue<T> {
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

  public clear(): void {
    this.head = null;
    this.tail = null;
    this._size = 0;
  }
}

export interface PacerConfig {
  readonly maxRpm: number;
  readonly maxQueueDepth: number;
  readonly maxQueueWaitMs: number; // e.g. 15,000ms
  readonly minIntervalMs?: number; // Minimum wait between requests (e.g. 2,000ms for Google)
}

export class RequestPacer {
  private tokens: number;
  private lastRefillMs: number;
  private lastDispatchTimeMs = 0;
  private readonly queue = new FastFifoQueue<QueueEntry>();
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private emaDwellTimeMs = 0;

  constructor(private readonly config: PacerConfig) {
    this.tokens = config.maxRpm;
    this.lastRefillMs = Date.now();
  }

  public getMinInterval(): number {
    return this.config.minIntervalMs ?? Math.max(10, Math.ceil(60000 / this.config.maxRpm));
  }

  public async acquire(signal?: AbortSignal): Promise<{ queueDwellMs: number }> {
    this.refill();
    const now = Date.now();
    const timeSinceLastDispatch = now - this.lastDispatchTimeMs;
    const minInterval = this.getMinInterval();

    // Can only dispatch immediately if tokens available, queue is empty, AND minInterval has elapsed
    if (this.tokens >= 1 && this.queue.size === 0 && timeSinceLastDispatch >= minInterval) {
      this.tokens -= 1;
      this.lastDispatchTimeMs = now;
      this.updateEma(0);
      return { queueDwellMs: 0 };
    }

    if (this.queue.size >= this.config.maxQueueDepth) {
      const estimatedWaitSec = Math.ceil(
        ((this.queue.size + 1) * minInterval) / 1000
      );
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

      const timeoutTimer = setTimeout(() => {
        cleanup();
        reject(
          new PacerQueueTimeoutError(
            `Queue wait exceeded limit of ${this.config.maxQueueWaitMs}ms`,
            Math.ceil(this.config.maxQueueWaitMs / 1000)
          )
        );
      }, this.config.maxQueueWaitMs);

      const entry: QueueEntry = {
        resolve: () => {
          cleanup();
          clearTimeout(timeoutTimer);
          this.tokens -= 1;
          this.lastDispatchTimeMs = Date.now();
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

  public getStats(): { currentTokens: number; queueDepth: number; avgDwellTimeMs: number } {
    return {
      currentTokens: Math.round(this.tokens * 100) / 100,
      queueDepth: this.queue.size,
      avgDwellTimeMs: Math.round(this.emaDwellTimeMs),
    };
  }

  private updateEma(dwellMs: number): void {
    if (this.emaDwellTimeMs === 0) {
      this.emaDwellTimeMs = dwellMs;
    } else {
      // Exponential Moving Average: 10% weight to new sample, 90% historical
      this.emaDwellTimeMs = dwellMs * 0.1 + this.emaDwellTimeMs * 0.9;
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
    const now = Date.now();
    const minInterval = this.getMinInterval();
    const elapsed = now - this.lastDispatchTimeMs;
    const delay = Math.max(10, minInterval - elapsed);

    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      this.refill();
      if (this.tokens >= 1 && this.queue.size > 0) {
        const next = this.queue.dequeue();
        next?.resolve();
      }
      if (this.queue.size > 0) {
        this.scheduleDrain();
      }
    }, delay);
  }
}

const PROVIDER_DEFAULT_PACER_CONFIGS: Record<string, Partial<PacerConfig>> = {
  gg: { maxRpm: 15, minIntervalMs: 2000, maxQueueDepth: 100, maxQueueWaitMs: 45000 },
  or: { maxRpm: 30, minIntervalMs: 2000, maxQueueDepth: 100, maxQueueWaitMs: 45000 },
  nv: { maxRpm: 40, minIntervalMs: 2000, maxQueueDepth: 100, maxQueueWaitMs: 45000 },
  zn: { maxRpm: 60, minIntervalMs: 2000, maxQueueDepth: 100, maxQueueWaitMs: 45000 },
};

// Global registry for per-provider pacers (all keys for a provider share the single pipe)
const pacerRegistry = new Map<string, RequestPacer>();

export function getPacerForProvider(
  provider: string,
  _keyIndex = 0,
  config?: Partial<PacerConfig>
): RequestPacer {
  const pacerKey = provider;
  let pacer = pacerRegistry.get(pacerKey);
  if (!pacer) {
    const defaults = PROVIDER_DEFAULT_PACER_CONFIGS[provider] ?? {
      maxRpm: 30,
      minIntervalMs: 2000,
      maxQueueDepth: 100,
      maxQueueWaitMs: 45000,
    };
    pacer = new RequestPacer({
      maxRpm: config?.maxRpm ?? defaults.maxRpm ?? 30,
      minIntervalMs: config?.minIntervalMs ?? defaults.minIntervalMs ?? 2000,
      maxQueueDepth: config?.maxQueueDepth ?? defaults.maxQueueDepth ?? 100,
      maxQueueWaitMs: config?.maxQueueWaitMs ?? defaults.maxQueueWaitMs ?? 45000,
    });
    pacerRegistry.set(pacerKey, pacer);
  }
  return pacer;
}

export function clearPacerRegistry(): void {
  pacerRegistry.clear();
}
