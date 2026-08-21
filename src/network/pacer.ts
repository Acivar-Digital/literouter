import { getEnv } from "../config/env";

export class PacerQueueOverflowError extends Error {
  public readonly retryAfterSec: number;
  constructor(message: string, retryAfterSec = 5) {
    super(message);
    this.name = "PacerQueueOverflowError";
    this.retryAfterSec = retryAfterSec;
  }
}

interface QueueEntry {
  readonly signal?: AbortSignal;
  readonly resolve: (dwellMs: number) => void;
  readonly reject: (err: Error) => void;
  readonly enqueuedAt: number;
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
  readonly minIntervalMs?: number; // Minimum wait between consecutive request dispatches
  readonly maxRpm?: number; // Optional backwards compatibility / fallback calculation
  readonly maxQueueDepth?: number; // Optional queue depth limit
}

export class RequestPacer {
  private lastDispatchTimeMs = 0;
  private readonly queue = new FastFifoQueue<QueueEntry>();
  private drainTimer: ReturnType<typeof setTimeout> | null = null;
  private emaDwellTimeMs = 0;

  constructor(private readonly config: PacerConfig = {}) {}

  public getMinInterval(): number {
    if (this.config.minIntervalMs !== undefined) {
      return this.config.minIntervalMs;
    }
    if (this.config.maxRpm && this.config.maxRpm > 0) {
      return Math.max(10, Math.ceil(60000 / this.config.maxRpm));
    }
    return 2000;
  }

  public get maxQueueDepth(): number {
    return this.config.maxQueueDepth ?? 1000;
  }

  public async acquire(signal?: AbortSignal): Promise<{ queueDwellMs: number }> {
    if (signal?.aborted) {
      throw new Error("Request aborted while queued in LiteRouter pacer");
    }

    const minInterval = this.getMinInterval();
    const now = Date.now();
    const timeSinceLastDispatch = now - this.lastDispatchTimeMs;

    // If queue is empty AND minInterval has elapsed since last dispatch: dispatch immediately!
    if (this.queue.size === 0 && timeSinceLastDispatch >= minInterval) {
      this.lastDispatchTimeMs = now;
      this.updateEma(0);
      return { queueDwellMs: 0 };
    }

    // Capacity check
    if (this.queue.size >= this.maxQueueDepth) {
      const estimatedWaitSec = Math.ceil(
        ((this.queue.size + 1) * minInterval) / 1000
      );
      throw new PacerQueueOverflowError(
        `LiteRouter rate limit capacity (${this.maxQueueDepth}) saturated.`,
        Math.max(1, estimatedWaitSec)
      );
    }

    const enqueuedAt = Date.now();

    return new Promise<{ queueDwellMs: number }>((resolve, reject) => {
      let node: QueueNode<QueueEntry> | null = null;
      let finished = false;

      const abortHandler = () => {
        if (finished) return;
        finished = true;
        if (node) {
          this.queue.remove(node);
          node = null;
        }
        signal?.removeEventListener("abort", abortHandler);
        reject(new Error("Request aborted while queued in LiteRouter pacer"));
      };

      const entry: QueueEntry = {
        signal,
        resolve: (dwellMs: number) => {
          if (finished) return;
          finished = true;
          node = null;
          signal?.removeEventListener("abort", abortHandler);
          resolve({ queueDwellMs: dwellMs });
        },
        reject: (err: Error) => {
          if (finished) return;
          finished = true;
          if (node) {
            this.queue.remove(node);
            node = null;
          }
          signal?.removeEventListener("abort", abortHandler);
          reject(err);
        },
        enqueuedAt,
      };

      if (signal?.aborted) {
        return reject(new Error("Request aborted while queued in LiteRouter pacer"));
      }

      signal?.addEventListener("abort", abortHandler, { once: true });
      node = this.queue.enqueue(entry);
      this.scheduleDrain();
    });
  }

  public getStats(): { currentTokens: number; queueDepth: number; avgDwellTimeMs: number } {
    return {
      currentTokens: 0,
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

  private scheduleDrain(): void {
    if (this.drainTimer !== null || this.queue.size === 0) return;
    const minInterval = this.getMinInterval();
    const elapsed = Date.now() - this.lastDispatchTimeMs;
    const waitMs = Math.max(0, minInterval - elapsed);

    this.drainTimer = setTimeout(() => {
      this.drainTimer = null;
      while (this.queue.size > 0) {
        const entry = this.queue.dequeue();
        if (!entry) break;
        if (entry.signal?.aborted) {
          continue;
        }
        this.lastDispatchTimeMs = Date.now();
        const dwellMs = Math.max(0, this.lastDispatchTimeMs - entry.enqueuedAt);
        this.updateEma(dwellMs);
        entry.resolve(dwellMs);
        break; // only 1 item dispatched per tick
      }
      if (this.queue.size > 0) {
        this.scheduleDrain();
      }
    }, waitMs);
  }
}

function getProviderMinDelayFromEnv(provider: string): number {
  const env = getEnv();
  switch (provider) {
    case "or":
      return env.OPENROUTER_MIN_DELAY_MS;
    case "nv":
      return env.NVIDIA_MIN_DELAY_MS;
    case "zn":
      return env.ZEN_MIN_DELAY_MS;
    case "gg":
      return env.GOOGLE_MIN_DELAY_MS;
    case "tp":
      return env.TEST_PROVIDER_MIN_DELAY_MS;
    default:
      return 2000;
  }
}

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
    const env = getEnv();
    const envDelay = getProviderMinDelayFromEnv(provider);
    pacer = new RequestPacer({
      minIntervalMs: config?.minIntervalMs ?? envDelay,
      maxQueueDepth: config?.maxQueueDepth ?? env.LITEROUTER_PACER_MAX_QUEUE_DEPTH ?? 100,
      maxRpm: config?.maxRpm ?? env.LITEROUTER_PACER_MAX_RPM ?? 30,
    });
    pacerRegistry.set(pacerKey, pacer);
  }
  return pacer;
}

export function clearPacerRegistry(): void {
  pacerRegistry.clear();
}
