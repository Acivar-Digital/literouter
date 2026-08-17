import type { OpenAIMessage, OpenAIRequestPayload } from "../transformers/nuances";
import { createUnauthorizedResponse, validateDirective } from "../directive/validator";
import { logError, logInbound } from "../ui/logger";
import { globalKeyPool, handleOpenAICompat, resolveUpstreamEndpoint } from "./openai_compat";

function extractModelFromPath(pathname: string): string {
  const match = pathname.match(/\/v1beta\/models\/([^:]+)/);
  return match?.[1] ?? "gemini-2.5-pro";
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
    directiveStr: rawKey,
    targetProvider: directive.type === "direct" ? directive.provider : directive.preset,
    wireFormat: directive.type === "direct" ? directive.payload : "gg",
    endpoint: endpoint?.rawPath,
    model,
    keyIndex: 0,
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
