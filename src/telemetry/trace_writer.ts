import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SanitizedTrace } from "./ring_buffer";

export const FLUSH_INTERVAL_MS = 30_000;
export const FLUSH_COUNT_THRESHOLD = 100;
export const FLUSH_BYTES_THRESHOLD = 16 * 1024 * 1024; // 16MB
export const RETENTION_DAYS = 30;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS request_traces (
  req_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  ttft_ms INTEGER,
  tokens_prompt INTEGER,
  tokens_completion INTEGER,
  client_inbound TEXT,
  upstream_outbound TEXT,
  upstream_inbound TEXT,
  client_outbound TEXT
);
CREATE INDEX IF NOT EXISTS idx_traces_created ON request_traces(created_at);
CREATE INDEX IF NOT EXISTS idx_traces_provider ON request_traces(provider);
CREATE INDEX IF NOT EXISTS idx_traces_status ON request_traces(status);
`;

export const INSERT_SQL = `
INSERT OR REPLACE INTO request_traces (
  req_id, created_at, provider, model, status,
  duration_ms, ttft_ms, tokens_prompt, tokens_completion,
  client_inbound, upstream_outbound, upstream_inbound, client_outbound
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
`;

export interface TraceWriterOptions {
  flushIntervalMs?: number;
  flushCountThreshold?: number;
  flushBytesThreshold?: number;
  retentionDays?: number;
}

export class TraceWriter {
  private db: Database | null = null;
  private queue: SanitizedTrace[] = [];
  private queueBytes = 0;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private initError: Error | null = null;

  public readonly flushIntervalMs: number;
  public readonly flushCountThreshold: number;
  public readonly flushBytesThreshold: number;
  public readonly retentionDays: number;

  constructor(options: TraceWriterOptions = {}) {
    this.flushIntervalMs = options.flushIntervalMs ?? FLUSH_INTERVAL_MS;
    this.flushCountThreshold = options.flushCountThreshold ?? FLUSH_COUNT_THRESHOLD;
    this.flushBytesThreshold = options.flushBytesThreshold ?? FLUSH_BYTES_THRESHOLD;
    this.retentionDays = options.retentionDays ?? RETENTION_DAYS;
  }

  init(dbPath = "logs/traces.db"): void {
    try {
      if (dbPath !== ":memory:") {
        const dir = dirname(dbPath);
        if (dir && dir !== ".") {
          mkdirSync(dir, { recursive: true });
        }
      }
      this.db = new Database(dbPath, { create: true });
      this.db.exec("PRAGMA journal_mode = WAL;");
      this.db.exec("PRAGMA synchronous = NORMAL;");
      this.db.exec(SCHEMA_SQL);
      this.pruneOldTraces();
      this.flushTimer = setInterval(() => this.flush(), this.flushIntervalMs);
      this.initError = null;
    } catch (err) {
      // SQLite init failure is NON-FATAL. Gateway continues without persistence.
      // Traces remain in RAM ring buffer only.
      this.initError = err instanceof Error ? err : new Error(String(err));
      console.error(
        `[TraceWriter] SQLite init failed (non-fatal, RAM-only mode): ${this.initError.message}`
      );
    }
  }

  enqueue(trace: SanitizedTrace): void {
    if (this.initError || !this.db) {
      return;
    }

    this.queue.push(trace);
    this.queueBytes += JSON.stringify(trace).length;

    if (
      this.queue.length >= this.flushCountThreshold ||
      this.queueBytes >= this.flushBytesThreshold
    ) {
      this.flush();
    }
  }

  flush(): void {
    if (!this.db || this.queue.length === 0) {
      return;
    }

    try {
      const insert = this.db.prepare(INSERT_SQL);
      const tx = this.db.transaction((traces: SanitizedTrace[]) => {
        for (const t of traces) {
          insert.run(
            t.reqId,
            t.createdAt,
            t.provider,
            t.model,
            t.status,
            t.durationMs,
            t.ttftMs ?? null,
            t.tokensPrompt ?? null,
            t.tokensCompletion ?? null,
            t.legs?.clientInbound ?? null,
            t.legs?.upstreamOutbound ?? null,
            t.legs?.upstreamInbound ?? null,
            t.legs?.clientOutbound ?? null
          );
        }
      });
      tx(this.queue);
    } catch (err) {
      console.error(
        `[TraceWriter] Flush failed (${this.queue.length} traces lost): ${err}`
      );
    } finally {
      this.queue = [];
      this.queueBytes = 0;
    }
  }

  /** Synchronous drain on process exit. */
  drainSync(): void {
    this.flush();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.db) {
      try {
        this.db.close();
      } catch (err) {
        console.warn(`[TraceWriter] Close error: ${err}`);
      }
      this.db = null;
    }
  }

  pruneOldTraces(retentionDays = this.retentionDays): void {
    if (!this.db) {
      return;
    }
    try {
      const cutoff = Date.now() - retentionDays * 86_400_000;
      this.db.run("DELETE FROM request_traces WHERE created_at < ?", [cutoff]);
    } catch (err) {
      console.error(`[TraceWriter] Prune failed (non-fatal): ${err}`);
    }
  }

  getDb(): Database | null {
    return this.db;
  }

  getQueueLength(): number {
    return this.queue.length;
  }

  getQueueBytes(): number {
    return this.queueBytes;
  }

  getInitError(): Error | null {
    return this.initError;
  }
}

export const traceWriter = new TraceWriter();

// Register shutdown hooks
process.on("beforeExit", () => traceWriter.drainSync());
process.on("SIGINT", () => {
  traceWriter.drainSync();
  process.exit(0);
});
process.on("SIGTERM", () => {
  traceWriter.drainSync();
  process.exit(0);
});
