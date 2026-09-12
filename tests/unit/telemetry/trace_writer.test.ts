import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { existsSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  TraceWriter,
  FLUSH_INTERVAL_MS,
  FLUSH_COUNT_THRESHOLD,
  FLUSH_BYTES_THRESHOLD,
  RETENTION_DAYS,
} from "../../../src/telemetry/trace_writer";
import type { SanitizedTrace } from "../../../src/telemetry/ring_buffer";
import { fetchTraceById, queryTraces } from "../../../scripts/trace";

const TEST_DIR = join(tmpdir(), "trace_writer_tests");

function createTrace(id: string, overrides: Partial<SanitizedTrace> = {}): SanitizedTrace {
  return {
    reqId: id,
    createdAt: Date.now(),
    provider: "zen",
    model: "big-pickle",
    status: 200,
    durationMs: 120,
    ttftMs: 35,
    tokensPrompt: 10,
    tokensCompletion: 15,
    legs: {
      clientInbound: '{"prompt":"hello"}',
      upstreamOutbound: '{"prompt":"hello"}',
      upstreamInbound: '{"response":"world"}',
      clientOutbound: '{"response":"world"}',
    },
    ...overrides,
  };
}

describe("TraceWriter", () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      try {
        rmSync(TEST_DIR, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[trace_writer.test] Failed to clean up ${TEST_DIR}: ${err}`);
      }
    }
  });

  it("exports standard constants matching specification", () => {
    expect(FLUSH_INTERVAL_MS).toBe(30_000);
    expect(FLUSH_COUNT_THRESHOLD).toBe(100);
    expect(FLUSH_BYTES_THRESHOLD).toBe(16 * 1024 * 1024);
    expect(RETENTION_DAYS).toBe(30);
  });

  it("creates SQLite schema, tables, and indexes on init", () => {
    const dbPath = join(TEST_DIR, "schema_test.db");
    const writer = new TraceWriter();
    writer.init(dbPath);

    const db = writer.getDb();
    expect(db).not.toBeNull();

    // Check table exists
    const table = db!
      .query<{ name: string }, [string]>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      )
      .get("request_traces");
    expect(table?.name).toBe("request_traces");

    // Check columns
    const columns = db!
      .query<{ name: string }, []>("PRAGMA table_info(request_traces)")
      .all();
    const colNames = columns.map((c) => c.name);
    expect(colNames).toContain("req_id");
    expect(colNames).toContain("created_at");
    expect(colNames).toContain("provider");
    expect(colNames).toContain("model");
    expect(colNames).toContain("status");
    expect(colNames).toContain("duration_ms");
    expect(colNames).toContain("ttft_ms");
    expect(colNames).toContain("tokens_prompt");
    expect(colNames).toContain("tokens_completion");
    expect(colNames).toContain("client_inbound");
    expect(colNames).toContain("upstream_outbound");
    expect(colNames).toContain("upstream_inbound");
    expect(colNames).toContain("client_outbound");

    // Check indexes
    const indexes = db!
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name = 'request_traces'"
      )
      .all();
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_traces_created");
    expect(indexNames).toContain("idx_traces_provider");
    expect(indexNames).toContain("idx_traces_status");

    writer.drainSync();
  });

  it("batches traces and flushes when count threshold is reached", () => {
    const dbPath = join(TEST_DIR, "batch_count.db");
    const writer = new TraceWriter({ flushCountThreshold: 3 });
    writer.init(dbPath);

    writer.enqueue(createTrace("req-1"));
    writer.enqueue(createTrace("req-2"));
    expect(writer.getQueueLength()).toBe(2);

    // Verify DB still empty
    const db = writer.getDb()!;
    let count = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM request_traces").get()!.count;
    expect(count).toBe(0);

    // Enqueue 3rd item - triggers flush
    writer.enqueue(createTrace("req-3"));
    expect(writer.getQueueLength()).toBe(0);

    count = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM request_traces").get()!.count;
    expect(count).toBe(3);

    writer.drainSync();
  });

  it("flushes immediately when queueBytes exceeds flushBytesThreshold", () => {
    const dbPath = join(TEST_DIR, "batch_bytes.db");
    const writer = new TraceWriter({ flushBytesThreshold: 400 });
    writer.init(dbPath);

    const largeTrace = createTrace("req-large", {
      legs: {
        clientInbound: "x".repeat(350),
        upstreamOutbound: "x".repeat(350),
        upstreamInbound: "ok",
        clientOutbound: "ok",
      },
    });

    writer.enqueue(largeTrace);
    expect(writer.getQueueLength()).toBe(0); // Immediately flushed

    const db = writer.getDb()!;
    const count = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM request_traces").get()!.count;
    expect(count).toBe(1);

    writer.drainSync();
  });

  it("drainSync writes all remaining queued items and cleanly closes DB", () => {
    const dbPath = join(TEST_DIR, "drain_sync.db");
    const writer = new TraceWriter({ flushCountThreshold: 50 });
    writer.init(dbPath);

    writer.enqueue(createTrace("req-drain-1"));
    writer.enqueue(createTrace("req-drain-2"));
    expect(writer.getQueueLength()).toBe(2);

    writer.drainSync();
    expect(writer.getQueueLength()).toBe(0);
    expect(writer.getDb()).toBeNull();

    // Verify written to SQLite by opening independent connection
    const verifyDb = new Database(dbPath, { readonly: true });
    const count = verifyDb.query<{ count: number }, []>("SELECT COUNT(*) as count FROM request_traces").get()!.count;
    expect(count).toBe(2);
    verifyDb.close();
  });

  it("prunes expired records beyond retention window", () => {
    const dbPath = join(TEST_DIR, "prune_test.db");
    const writer = new TraceWriter({ retentionDays: 30 });
    writer.init(dbPath);

    const now = Date.now();
    const oldTimestamp = now - 35 * 86_400_000; // 35 days ago (expired)
    const recentTimestamp = now - 5 * 86_400_000; // 5 days ago (valid)

    writer.enqueue(createTrace("req-old", { createdAt: oldTimestamp }));
    writer.enqueue(createTrace("req-recent", { createdAt: recentTimestamp }));
    writer.flush();

    const db = writer.getDb()!;
    let total = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM request_traces").get()!.count;
    expect(total).toBe(2);

    writer.pruneOldTraces(30);

    total = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM request_traces").get()!.count;
    expect(total).toBe(1);

    const remaining = db.query<{ req_id: string }, []>("SELECT req_id FROM request_traces").get()!;
    expect(remaining.req_id).toBe("req-recent");

    writer.drainSync();
  });

  it("handles non-fatal init errors gracefully on invalid DB paths", () => {
    const invalidPath = "/proc/readonly_system_file/impossible/db.sqlite";
    const writer = new TraceWriter();

    // Should not throw
    expect(() => writer.init(invalidPath)).not.toThrow();
    expect(writer.getInitError()).not.toBeNull();
    expect(writer.getDb()).toBeNull();

    // Operations should be non-fatal no-ops
    expect(() => writer.enqueue(createTrace("req-skip"))).not.toThrow();
    expect(writer.getQueueLength()).toBe(0);
    expect(() => writer.flush()).not.toThrow();
    expect(() => writer.drainSync()).not.toThrow();
  });

  it("integrates with scripts/trace inspector to fetch by ID and query filters", () => {
    const dbPath = join(TEST_DIR, "cli_integration.db");
    const writer = new TraceWriter();
    writer.init(dbPath);

    writer.enqueue(
      createTrace("req-cli-1", {
        provider: "openrouter",
        model: "anthropic/claude-3.7-sonnet",
        status: 200,
        createdAt: 1000,
      })
    );
    writer.enqueue(
      createTrace("req-cli-2", {
        provider: "zen",
        model: "big-pickle",
        status: 429,
        createdAt: 2000,
      })
    );
    writer.drainSync();

    // Test fetchTraceById from SQLite
    const fetched = fetchTraceById("req-cli-1", dbPath);
    expect(fetched).not.toBeNull();
    expect(fetched?.source).toBe("sqlite");
    expect(fetched?.trace.reqId).toBe("req-cli-1");
    expect(fetched?.trace.provider).toBe("openrouter");
    expect(fetched?.trace.legs.clientInbound).toBe('{"prompt":"hello"}');

    // Test non-existent trace
    expect(fetchTraceById("non-existent-id", dbPath)).toBeNull();

    // Test queryTraces with errorsOnly filter
    const errorTraces = queryTraces({ errorsOnly: true, dbPath });
    expect(errorTraces.length).toBe(1);
    expect(errorTraces[0]?.reqId).toBe("req-cli-2");
    expect(errorTraces[0]?.status).toBe(429);

    // Test queryTraces with provider filter
    const zenTraces = queryTraces({ provider: "zen", dbPath });
    expect(zenTraces.length).toBe(1);
    expect(zenTraces[0]?.reqId).toBe("req-cli-2");

    const orTraces = queryTraces({ provider: "openrouter", dbPath });
    expect(orTraces.length).toBe(1);
    expect(orTraces[0]?.reqId).toBe("req-cli-1");
  });
});
