import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { type SanitizedTrace, traceBuffer } from "../src/telemetry/ring_buffer";

export interface TraceSummary {
  reqId: string;
  createdAt: number;
  provider: string;
  model: string;
  status: number;
  durationMs: number;
  ttftMs?: number;
  tokensPrompt?: number;
  tokensCompletion?: number;
  source: "ram" | "sqlite";
}

export interface CliOptions {
  reqId?: string;
  errorsOnly: boolean;
  provider?: string;
  limit: number;
  dbPath: string;
  help: boolean;
}

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    errorsOnly: false,
    limit: 10,
    dbPath: "logs/traces.db",
    help: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) {
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      options.help = true;
    } else if (arg === "--errors") {
      options.errorsOnly = true;
    } else if (arg === "--provider") {
      const next = argv[++i];
      if (next) {
        options.provider = next;
      }
    } else if (arg.startsWith("--provider=")) {
      options.provider = arg.slice("--provider=".length);
    } else if (arg === "-n") {
      const next = argv[++i];
      if (next) {
        const val = Number.parseInt(next, 10);
        if (!Number.isNaN(val) && val > 0) {
          options.limit = val;
        }
      }
    } else if (arg.startsWith("-n=")) {
      const val = Number.parseInt(arg.slice(3), 10);
      if (!Number.isNaN(val) && val > 0) {
        options.limit = val;
      }
    } else if (arg === "--db") {
      const next = argv[++i];
      if (next) {
        options.dbPath = next;
      }
    } else if (arg.startsWith("--db=")) {
      options.dbPath = arg.slice("--db=".length);
    } else if (!arg.startsWith("-") && !options.reqId) {
      options.reqId = arg;
    }
  }

  return options;
}

export function fetchTraceById(
  reqId: string,
  dbPath = "logs/traces.db"
): { trace: SanitizedTrace; source: "ram" | "sqlite" } | null {
  // 1. Check RAM ring buffer
  const memTrace = traceBuffer.get(reqId);
  if (memTrace) {
    return { trace: memTrace, source: "ram" };
  }

  // 2. Query SQLite
  if (!existsSync(dbPath)) {
    return null;
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const row = db
        .query<
          {
            req_id: string;
            created_at: number;
            provider: string;
            model: string;
            status: number;
            duration_ms: number;
            ttft_ms: number | null;
            tokens_prompt: number | null;
            tokens_completion: number | null;
            client_inbound: string | null;
            upstream_outbound: string | null;
            upstream_inbound: string | null;
            client_outbound: string | null;
          },
          [string]
        >(
          `SELECT req_id, created_at, provider, model, status, duration_ms, ttft_ms,
                  tokens_prompt, tokens_completion, client_inbound, upstream_outbound,
                  upstream_inbound, client_outbound
           FROM request_traces WHERE req_id = ?`
        )
        .get(reqId);

      if (!row) {
        return null;
      }

      const trace: SanitizedTrace = {
        reqId: row.req_id,
        createdAt: row.created_at,
        provider: row.provider,
        model: row.model,
        status: row.status,
        durationMs: row.duration_ms,
        ttftMs: row.ttft_ms ?? undefined,
        tokensPrompt: row.tokens_prompt ?? undefined,
        tokensCompletion: row.tokens_completion ?? undefined,
        legs: {
          clientInbound: row.client_inbound ?? "",
          upstreamOutbound: row.upstream_outbound ?? "",
          upstreamInbound: row.upstream_inbound ?? "",
          clientOutbound: row.client_outbound ?? "",
        },
      };
      return { trace, source: "sqlite" };
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`[scripts/trace.ts] Failed to query SQLite: ${err}`);
    return null;
  }
}

function querySqliteSummaries(
  dbPath: string,
  errorsOnly: boolean,
  provider?: string,
  limit = 10
): TraceSummary[] {
  if (!existsSync(dbPath)) {
    return [];
  }

  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      const conditions = ["1=1"];
      const params: (string | number)[] = [];

      if (errorsOnly) {
        conditions.push("status >= 400");
      }
      if (provider) {
        conditions.push("provider = ?");
        params.push(provider.toLowerCase());
      }
      params.push(limit);

      const querySql = `
        SELECT req_id, created_at, provider, model, status, duration_ms, ttft_ms,
               tokens_prompt, tokens_completion
        FROM request_traces
        WHERE ${conditions.join(" AND ")}
        ORDER BY created_at DESC
        LIMIT ?
      `;

      const rows = db
        .query<
          {
            req_id: string;
            created_at: number;
            provider: string;
            model: string;
            status: number;
            duration_ms: number;
            ttft_ms: number | null;
            tokens_prompt: number | null;
            tokens_completion: number | null;
          },
          (string | number)[]
        >(querySql)
        .all(...params);

      return rows.map((r) => ({
        reqId: r.req_id,
        createdAt: r.created_at,
        provider: r.provider,
        model: r.model,
        status: r.status,
        durationMs: r.duration_ms,
        ttftMs: r.ttft_ms ?? undefined,
        tokensPrompt: r.tokens_prompt ?? undefined,
        tokensCompletion: r.tokens_completion ?? undefined,
        source: "sqlite" as const,
      }));
    } finally {
      db.close();
    }
  } catch (err) {
    console.error(`[scripts/trace.ts] Failed to query SQLite traces: ${err}`);
    return [];
  }
}

export function queryTraces(options: {
  errorsOnly?: boolean;
  provider?: string;
  limit?: number;
  dbPath?: string;
}): TraceSummary[] {
  const errorsOnly = options.errorsOnly ?? false;
  const provider = options.provider?.toLowerCase();
  const limit = options.limit ?? 10;
  const dbPath = options.dbPath ?? "logs/traces.db";

  // 1. Gather RAM traces
  const memCandidates = errorsOnly
    ? traceBuffer.getErrors(100)
    : traceBuffer.getRecent(100);

  const memSummaries: TraceSummary[] = memCandidates
    .filter((t) => (!provider ? true : t.provider.toLowerCase() === provider))
    .map((t) => ({
      reqId: t.reqId,
      createdAt: t.createdAt,
      provider: t.provider,
      model: t.model,
      status: t.status,
      durationMs: t.durationMs,
      ttftMs: t.ttftMs,
      tokensPrompt: t.tokensPrompt,
      tokensCompletion: t.tokensCompletion,
      source: "ram" as const,
    }));

  // 2. Gather SQLite traces
  const sqliteSummaries = querySqliteSummaries(
    dbPath,
    errorsOnly,
    provider,
    limit * 2
  );

  // 3. Merge and deduplicate by reqId (RAM takes precedence)
  const map = new Map<string, TraceSummary>();
  for (const s of memSummaries) {
    map.set(s.reqId, s);
  }
  for (const s of sqliteSummaries) {
    if (!map.has(s.reqId)) {
      map.set(s.reqId, s);
    }
  }

  return Array.from(map.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit);
}

function printTraceDetail(trace: SanitizedTrace, source: string): void {
  const dateStr = new Date(trace.createdAt).toISOString();
  console.log("=".repeat(80));
  console.log(`Trace: ${trace.reqId} [Source: ${source.toUpperCase()}]`);
  console.log("=".repeat(80));
  console.log(`Created:     ${dateStr} (${trace.createdAt})`);
  console.log(`Provider:    ${trace.provider}`);
  console.log(`Model:       ${trace.model}`);
  console.log(`Status:      ${trace.status}`);
  console.log(`Duration:    ${trace.durationMs}ms`);
  console.log(`TTFT:        ${trace.ttftMs != null ? `${trace.ttftMs}ms` : "N/A"}`);
  console.log(
    `Tokens:      Prompt: ${trace.tokensPrompt ?? 0} | Completion: ${trace.tokensCompletion ?? 0}`
  );
  console.log("\n" + "-".repeat(80));
  console.log("Leg 1: Client Inbound");
  console.log("-".repeat(80));
  console.log(trace.legs.clientInbound || "(empty)");
  console.log("\n" + "-".repeat(80));
  console.log("Leg 2: Upstream Outbound");
  console.log("-".repeat(80));
  console.log(trace.legs.upstreamOutbound || "(empty)");
  console.log("\n" + "-".repeat(80));
  console.log("Leg 3: Upstream Inbound");
  console.log("-".repeat(80));
  console.log(trace.legs.upstreamInbound || "(empty)");
  console.log("\n" + "-".repeat(80));
  console.log("Leg 4: Client Outbound");
  console.log("-".repeat(80));
  console.log(trace.legs.clientOutbound || "(empty)");
  console.log("=".repeat(80));
}

function formatPad(str: string, len: number): string {
  return str.length >= len ? str.slice(0, len) : str.padEnd(len, " ");
}

function printTracesTable(traces: TraceSummary[]): void {
  if (traces.length === 0) {
    console.log("No traces found matching criteria.");
    return;
  }

  const header = [
    formatPad("TIME", 24),
    formatPad("STATUS", 8),
    formatPad("REQ_ID", 20),
    formatPad("SRC", 8),
    formatPad("PROVIDER", 10),
    formatPad("MODEL", 20),
    formatPad("DURATION", 10),
    formatPad("TTFT", 8),
  ].join(" ");

  console.log(header);
  console.log("-".repeat(header.length));

  for (const t of traces) {
    const timeStr = new Date(t.createdAt).toISOString().replace("T", " ").slice(0, 23);
    const row = [
      formatPad(timeStr, 24),
      formatPad(String(t.status), 8),
      formatPad(t.reqId, 20),
      formatPad(t.source, 8),
      formatPad(t.provider, 10),
      formatPad(t.model, 20),
      formatPad(`${t.durationMs}ms`, 10),
      formatPad(t.ttftMs != null ? `${t.ttftMs}ms` : "-", 8),
    ].join(" ");
    console.log(row);
  }
}

function printHelp(): void {
  console.log(`
LiteRouter Trace Inspector

Usage:
  bun run scripts/trace.ts <req_id>              Inspect all 4 legs of a request
  bun run scripts/trace.ts [options]             Query and list recent traces

Options:
  <req_id>            Request ID to inspect
  --errors            Filter traces with status >= 400
  --provider <code>   Filter by provider (e.g. zn, or, nv, gg)
  -n <count>          Number of results to display (default: 10)
  --db <path>         Path to SQLite database (default: logs/traces.db)
  -h, --help          Show this help message
`);
}

export function runCli(argv: string[] = process.argv.slice(2)): void {
  const options = parseCliArgs(argv);

  if (options.help) {
    printHelp();
    return;
  }

  if (options.reqId) {
    const result = fetchTraceById(options.reqId, options.dbPath);
    if (!result) {
      console.error(`Trace not found for reqId: ${options.reqId}`);
      process.exitCode = 1;
      return;
    }
    printTraceDetail(result.trace, result.source);
    return;
  }

  const results = queryTraces({
    errorsOnly: options.errorsOnly,
    provider: options.provider,
    limit: options.limit,
    dbPath: options.dbPath,
  });

  printTracesTable(results);
}

if (import.meta.main) {
  runCli();
}
