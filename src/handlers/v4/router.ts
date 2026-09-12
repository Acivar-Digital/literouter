import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { parseDirectiveKey } from "../../directive/parser";
import { traceBuffer, type SanitizedTrace } from "../../telemetry/ring_buffer";
import { traceWriter } from "../../telemetry/trace_writer";
import { handleV4OpenAIChat } from "./openai_chat";
import { handleV4AnthropicMessages } from "./anthropic_messages";
import { handleV4GoogleNative } from "./google_native";
import { handleV4OpenAIResponses } from "./openai_responses";
import { handleV4GcpCompat } from "./gcp_compat";

export interface TraceDbRow {
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
}

const SELECT_TRACE_SQL = `
  SELECT req_id, created_at, provider, model, status, duration_ms, ttft_ms,
         tokens_prompt, tokens_completion, client_inbound, upstream_outbound,
         upstream_inbound, client_outbound
  FROM request_traces WHERE req_id = ?
`;

function mapRowToTrace(row: TraceDbRow): SanitizedTrace {
  return {
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
}

function queryDbHandle(db: Database, traceId: string): SanitizedTrace | null {
  try {
    const row = db.query<TraceDbRow, [string]>(SELECT_TRACE_SQL).get(traceId);
    return row ? mapRowToTrace(row) : null;
  } catch (err) {
    console.warn(`[RouterV4] SQLite query failed: ${err}`);
    return null;
  }
}

function queryDbFile(dbPath: string, traceId: string): SanitizedTrace | null {
  if (!existsSync(dbPath)) {
    return null;
  }
  try {
    const db = new Database(dbPath, { readonly: true });
    try {
      return queryDbHandle(db, traceId);
    } finally {
      db.close();
    }
  } catch (err) {
    console.warn(`[RouterV4] SQLite file read failed: ${err}`);
    return null;
  }
}

export function findTraceInDb(traceId: string, customDbPath?: string): SanitizedTrace | null {
  const activeDb = traceWriter.getDb();
  if (activeDb) {
    const result = queryDbHandle(activeDb, traceId);
    if (result) {
      return result;
    }
  }
  return queryDbFile(customDbPath ?? "logs/traces.db", traceId);
}

function isTracePath(path: string): boolean {
  return path === "/v1/traces" || path.startsWith("/v1/traces/");
}

function handleTraceDetail(traceId: string): Response {
  if (!traceId) {
    return Response.json(
      {
        error: {
          code: "not_found",
          message: "Trace not found: ",
          type: "invalid_request_error",
        },
      },
      { status: 404 }
    );
  }

  const memTrace = traceBuffer.get(traceId);
  if (memTrace) {
    return Response.json(memTrace);
  }

  const dbTrace = findTraceInDb(traceId);
  if (dbTrace) {
    return Response.json(dbTrace);
  }

  return Response.json(
    {
      error: {
        code: "not_found",
        message: `Trace not found: ${traceId}`,
        type: "invalid_request_error",
      },
    },
    { status: 404 }
  );
}

function handleTraceList(url: URL): Response {
  const errors = url.searchParams.get("errors") === "true";
  const rawN = url.searchParams.get("n");
  const parsedN = parseInt(rawN ?? "10", 10);
  const n = Number.isNaN(parsedN) || parsedN <= 0 ? 10 : parsedN;

  const traces = errors ? traceBuffer.getErrors(n) : traceBuffer.getRecent(n);
  return Response.json({ traces });
}

function handleTraceEndpoints(url: URL, path: string, rawKey: string): Response {
  const directive = parseDirectiveKey(rawKey);
  if (!directive) {
    return Response.json(
      {
        error: {
          code: "unauthorized",
          message: "Directive key authorization required to access trace inspection endpoints",
          type: "authentication_error",
        },
      },
      { status: 401 }
    );
  }

  if (path.startsWith("/v1/traces/")) {
    const traceId = path.slice("/v1/traces/".length);
    return handleTraceDetail(traceId);
  }

  return handleTraceList(url);
}

function isGoogleNativePath(path: string): boolean {
  if (!path.startsWith("/v1beta/models/") && !path.startsWith("/v1/models/")) {
    return false;
  }
  return path.endsWith(":generateContent") || path.endsWith(":streamGenerateContent");
}

function isGcpCompatPath(path: string): boolean {
  return path.startsWith("/v1beta/openai/");
}

function dispatchPostRoute(
  path: string,
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> | null {
  if (path === "/v1/chat/completions") {
    return handleV4OpenAIChat(req, rawKey, reqId);
  }
  if (path === "/v1/messages" || path === "/messages") {
    return handleV4AnthropicMessages(req, rawKey, reqId);
  }
  if (path === "/v1/responses") {
    return handleV4OpenAIResponses(req, rawKey, reqId);
  }
  if (isGoogleNativePath(path)) {
    return handleV4GoogleNative(req, rawKey, reqId);
  }
  if (isGcpCompatPath(path)) {
    return handleV4GcpCompat(req, rawKey, reqId);
  }
  return null;
}

export async function dispatchV4(
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (isTracePath(path)) {
    return handleTraceEndpoints(url, path, rawKey);
  }

  if (req.method === "POST") {
    const postRes = dispatchPostRoute(path, req, rawKey, reqId);
    if (postRes !== null) {
      return postRes;
    }
  }

  return Response.json(
    {
      error: {
        code: "not_found",
        message: `Route not found: ${req.method} ${path}`,
        type: "invalid_request_error",
      },
    },
    { status: 404 }
  );
}
