import type { OpenAIMessage, OpenAIRequestPayload } from "../transformers/nuances";
import { getEnv } from "../config/env";
import { createUnauthorizedResponse, validateDirective } from "../directive/validator";
import { getPacerForProvider, PacerQueueOverflowError } from "../network/pacer";
import { logError, logInbound } from "../ui/logger";
import { globalKeyPool, handleOpenAICompat, resolveUpstreamEndpoint } from "./openai_compat";

function extractModelFromPath(pathname: string): string {
  const match = pathname.match(/\/v1beta\/models\/([^:]+)/);
  const raw = match?.[1] ?? "gemini-3.1-flash-lite";
  return raw.startsWith("google/") ? raw.slice(7) : raw;
}

function extractTextParts(parts: ReadonlyArray<{ text?: string }> | undefined): string {
  if (!parts || parts.length === 0) {
    return "";
  }
  return parts.map((p) => p.text ?? "").join("\n");
}

function translateGoogleToOpenAI(googleBody: Record<string, unknown>, model: string): OpenAIRequestPayload {
  const contents = (googleBody.contents as Array<{ role?: string; parts?: Array<{ text?: string }> }>) || [];
  const messages: OpenAIMessage[] = [];

  for (const c of contents) {
    const role = c.role === "model" ? "assistant" : "user";
    const text = extractTextParts(c.parts);
    messages.push({ role, content: text });
  }

  return {
    model,
    messages,
    stream: false,
  };
}

async function parseGoogleRequestBody(req: Request): Promise<Record<string, unknown> | null> {
  if (req.method !== "POST") {
    return {};
  }
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function formatGoogleNativeResponse(json: { choices?: Array<{ message?: { content?: string } }> }): Response {
  const text = json.choices?.[0]?.message?.content || "";
  const googleNativeRes = {
    candidates: [
      {
        content: {
          parts: [{ text }],
          role: "model",
        },
        finishReason: "STOP",
        index: 0,
      },
    ],
  };
  return Response.json(googleNativeRes, { status: 200 });
}

export async function handleGoogleNative(
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> {
  const validation = validateDirective(rawKey);
  if (validation.valid === false) {
    return createUnauthorizedResponse(validation.error);
  }

  const url = new URL(req.url);
  const model = extractModelFromPath(url.pathname);
  const directive = validation.directive;

  const clientAgent = req.headers.get("user-agent") || "unknown";
  const endpoint = directive.type === "direct"
    ? resolveUpstreamEndpoint(directive.provider, directive.completion, model)
    : undefined;
  const poolSize = directive.type === "direct" ? globalKeyPool.getPoolSize(directive.provider) : 1;

  logInbound({
    reqId,
    method: req.method,
    path: url.pathname,
    clientAgent,
    protocol: req.headers.get("x-http-version") || "HTTP/1.1",
    directiveStr: rawKey,
    targetProvider: directive.type === "direct" ? directive.provider : directive.preset,
    wireFormat: directive.type === "direct" ? directive.payload : "gg",
    endpoint: endpoint?.rawPath,
    model,
    totalKeys: poolSize,
    nuances: directive.type === "direct" ? directive.nuances : undefined,
  });

  const googleBody = await parseGoogleRequestBody(req);
  if (googleBody === null) {
    logError(reqId, "Failed to parse Google native request body");
    return Response.json({ error: { message: "Invalid JSON" } }, { status: 400 });
  }

  const openAiPayload = translateGoogleToOpenAI(googleBody, model);
  const syntheticReq = new Request("http://localhost:7766/v1/chat/completions", {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(openAiPayload),
    signal: req.signal,
  });

  const res = await handleOpenAICompat(syntheticReq, rawKey, reqId, { skipInboundLog: true });
  if (!res.ok) {
    return res;
  }

  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  return formatGoogleNativeResponse(json);
}

export async function handleGoogleOpenAIBeta(
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> {
  return handleOpenAICompat(req, rawKey, reqId);
}

/**
 * Verbatim pass-through for the Antigravity Agent Interactions API
 * (`POST /v1beta/interactions`, `GET /v1beta/files/{id}:download`).
 *
 * The directive (api-key as filter) selects the Google provider; the request
 * path + query are forwarded as-is to GOOGLE_NATIVE_BASE_URL and authenticated
 * with a rotated key from the `gg` pool. The gateway master key (sk-lr-*) is
 * intentionally NOT accepted here.
 */
export async function handleGoogleInteractionsPassthrough(
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> {
  const validation = validateDirective(rawKey);
  if (validation.valid === false) {
    return createUnauthorizedResponse(validation.error);
  }
  const directive = validation.directive;
  if (directive.type !== "direct" || directive.provider !== "gg") {
    return Response.json(
      {
        error: {
          message: "Antigravity interactions requires a Google directive (lr-gg-*)",
          type: "invalid_request_error",
        },
      },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const base = process.env.GOOGLE_NATIVE_BASE_URL || "https://generativelanguage.googleapis.com";
  const upstreamUrl = new URL(`${base}${url.pathname}${url.search}`);

  if (getEnv().LITEROUTER_PACER_ENABLED) {
    try {
      const env = getEnv();
      const dynamicMaxQueueDepth = globalKeyPool.getDynamicMaxQueueDepth("gg");
      const maxQueueDepth = env.LITEROUTER_PACER_MAX_QUEUE_DEPTH > 0 ? env.LITEROUTER_PACER_MAX_QUEUE_DEPTH : dynamicMaxQueueDepth;
      const pacer = getPacerForProvider("gg", 0, { maxQueueDepth });
      await pacer.acquire(req.signal);
    } catch (err) {
      if (req.signal?.aborted || (err instanceof Error && err.message.includes("aborted"))) {
        return Response.json(
          { error: { message: "Request aborted", type: "client_closed_request" } },
          { status: 499 }
        );
      }
      if (err instanceof PacerQueueOverflowError) {
        return Response.json(
          {
            error: {
              message: err.message,
              type: "rate_limit_exceeded",
              code: "rate_limit_exceeded",
            },
          },
          {
            status: 429,
            headers: { "Retry-After": String(err.retryAfterSec) },
          }
        );
      }
      throw err;
    }
  }

  const selected = globalKeyPool.selectNextKey("gg");
  if (!selected) {
    return Response.json(
      { error: { message: "Google key pool exhausted", type: "rate_limit_error" } },
      { status: 503 }
    );
  }

  const upstreamHeaders = new Headers();
  for (const [k, v] of req.headers) {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk === "x-goog-api-key" || lk === "host" || lk === "content-length") {
      continue;
    }
    upstreamHeaders.set(k, v);
  }
  upstreamHeaders.set("x-goog-api-key", selected.key);
  // Request uncompressed upstream so we don't have to re-encode; Bun's fetch
  // already decompresses gzip, and leaking a `content-encoding` header would
  // make the client try (and fail) to decompress the plaintext body.
  upstreamHeaders.set("Accept-Encoding", "identity");

  logInbound({
    reqId,
    method: req.method,
    path: url.pathname,
    clientAgent: req.headers.get("user-agent") || "unknown",
    protocol: req.headers.get("x-http-version") || "HTTP/1.1",
    directiveStr: rawKey,
    targetProvider: "gg",
    wireFormat: "gg",
    endpoint: url.pathname,
    model: "antigravity",
    totalKeys: selected.totalKeys,
  });

  try {
    const upstreamReq = new Request(upstreamUrl.toString(), {
      method: req.method,
      headers: upstreamHeaders,
      body: req.body,
      signal: req.signal,
    });
    const res = await fetch(upstreamReq);
    globalKeyPool.reportSuccess("gg", selected.index);
    // Return the upstream body verbatim, but drop hop-by-hop / content-encoding
    // headers. Bun's fetch already decompresses the body, so leaking a
    // `content-encoding` header would make the client try (and fail) to
    // decompress plaintext. Requesting `identity` upstream keeps it clean.
    const outHeaders = new Headers(res.headers);
    outHeaders.delete("content-encoding");
    outHeaders.delete("content-length");
    outHeaders.delete("transfer-encoding");
    return new Response(res.body, { status: res.status, headers: outHeaders });
  } catch (err) {
    globalKeyPool.reportFailure("gg", selected.index, 502);
    logError(reqId, "Google interactions passthrough upstream failure", err);
    return Response.json(
      { error: { message: "Upstream Google interactions request failed", type: "server_error" } },
      { status: 502 }
    );
  }
}
