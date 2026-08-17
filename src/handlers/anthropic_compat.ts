import type { OpenAIMessage, OpenAIRequestPayload } from "../transformers/nuances";
import { createUnauthorizedResponse, validateDirective } from "../directive/validator";
import {
  globalKeyPool,
  handleOpenAICompat,
  resolveUpstreamEndpoint,
} from "./openai_compat";
import { logError, logInbound } from "../ui/logger";

export interface AnthropicContentBlock {
  readonly type: "text" | "image" | "tool_use" | "tool_result";
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
}

export interface AnthropicMessage {
  readonly role: "user" | "assistant";
  readonly content: string | readonly AnthropicContentBlock[];
}

export interface AnthropicMessagesRequest {
  readonly model: string;
  readonly messages: readonly AnthropicMessage[];
  readonly system?: string | readonly unknown[];
  readonly max_tokens?: number;
  readonly stream?: boolean;
  readonly temperature?: number;
  readonly tools?: readonly unknown[];
  readonly [key: string]: unknown;
}

function translateContent(content: string | readonly AnthropicContentBlock[]): string {
  if (typeof content === "string") {
    return content;
  }
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text)
    .join("\n");
}

function extractSystemString(system: unknown): string | null {
  if (typeof system === "string") {
    return system;
  }
  if (Array.isArray(system)) {
    return system
      .filter((b): b is { text: string } => typeof b === "object" && b !== null && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
  }
  return null;
}

function isAnthropicTool(tool: unknown): tool is { name: string; description?: string; input_schema: unknown } {
  if (typeof tool !== "object" || tool === null) {
    return false;
  }
  const t = tool as Record<string, unknown>;
  return typeof t.name === "string" && "input_schema" in t;
}

function translateSingleTool(tool: unknown): unknown {
  if (!isAnthropicTool(tool)) {
    return tool;
  }
  return {
    type: "function",
    function: {
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : undefined,
      parameters: tool.input_schema,
    },
  };
}

function translateTools(tools?: readonly unknown[]): readonly unknown[] | undefined {
  if (!tools || !Array.isArray(tools)) {
    return undefined;
  }
  return tools.map(translateSingleTool);
}

export function translateAnthropicToOpenAI(req: AnthropicMessagesRequest): OpenAIRequestPayload {
  const openAiMessages: OpenAIMessage[] = [];
  const systemText = extractSystemString(req.system);

  if (systemText) {
    openAiMessages.push({ role: "system", content: systemText });
  }

  for (const m of req.messages) {
    openAiMessages.push({
      role: m.role,
      content: translateContent(m.content),
    });
  }

  return {
    model: req.model,
    messages: openAiMessages,
    max_tokens: req.max_tokens,
    stream: req.stream,
    temperature: req.temperature,
    tools: translateTools(req.tools),
  };
}

export function translateOpenAIToAnthropicResponse(
  openAiRes: Record<string, unknown>,
  model: string
): Record<string, unknown> {
  const choices = (openAiRes.choices as Array<{ message?: { content?: string } }>) || [];
  const text = choices[0]?.message?.content || "";

  return {
    id: `msg_${Math.random().toString(36).slice(2, 11)}`,
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    model,
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: openAiRes.usage || { input_tokens: 0, output_tokens: 0 },
  };
}

function extractDeltaContent(rawJson: string): string | null {
  try {
    const parsed = JSON.parse(rawJson) as { choices?: Array<{ delta?: { content?: string } }> };
    return parsed.choices?.[0]?.delta?.content ?? null;
  } catch {
    return null;
  }
}

function isPassThroughEvent(rawData: string): boolean {
  return rawData.startsWith("{\"type\":") || rawData.startsWith("{\"event\":");
}

function tryEmitDeltaText(
  rawData: string,
  encoder: TextEncoder,
  controller: TransformStreamDefaultController<Uint8Array>
): void {
  const deltaText = extractDeltaContent(rawData);
  if (deltaText) {
    const deltaEvt = `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":${JSON.stringify(deltaText)}}}\n\n`;
    controller.enqueue(encoder.encode(deltaEvt));
  }
}

function tryProcessSseLine(
  line: string,
  encoder: TextEncoder,
  controller: TransformStreamDefaultController<Uint8Array>
): void {
  if (!line.startsWith("data: ") || line.includes("[DONE]")) {
    return;
  }
  const rawData = line.slice(6).trim();
  if (isPassThroughEvent(rawData)) {
    const evtLine = `event: content_block_delta\ndata: ${rawData}\n\n`;
    controller.enqueue(encoder.encode(evtLine));
    return;
  }
  tryEmitDeltaText(rawData, encoder, controller);
}

function processSseLines(
  lines: readonly string[],
  encoder: TextEncoder,
  controller: TransformStreamDefaultController<Uint8Array>
): void {
  for (const line of lines) {
    tryProcessSseLine(line, encoder, controller);
  }
}

export function createAnthropicStreamTransformer(model: string): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let msgStartSent = false;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      const lines = text.split("\n");

      if (!msgStartSent) {
        msgStartSent = true;
        const startEvt = `event: message_start\ndata: {"type":"message_start","message":{"id":"msg_stream","type":"message","role":"assistant","content":[],"model":"${model}"}}\n\n`;
        controller.enqueue(encoder.encode(startEvt));
        const blockStart = `event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`;
        controller.enqueue(encoder.encode(blockStart));
      }

      processSseLines(lines, encoder, controller);
    },
    flush(controller) {
      const stopBlock = 'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n';
      const msgStop = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';
      controller.enqueue(encoder.encode(stopBlock + msgStop));
    },
  });
}

async function handleStreamingResult(
  openAiRes: Response,
  model: string
): Promise<Response> {
  if (!openAiRes.body) {
    return openAiRes;
  }
  const transformedStream = openAiRes.body.pipeThrough(createAnthropicStreamTransformer(model));
  return new Response(transformedStream, {
    status: openAiRes.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function parseAnthropicRequest(req: Request): Promise<AnthropicMessagesRequest | null> {
  try {
    return (await req.json()) as AnthropicMessagesRequest;
  } catch {
    return null;
  }
}

async function handleNonStreamingResult(
  openAiRes: Response,
  model: string
): Promise<Response> {
  if (!openAiRes.ok) {
    return openAiRes;
  }
  const json = (await openAiRes.json()) as Record<string, unknown>;
  const translated = translateOpenAIToAnthropicResponse(json, model);
  return Response.json(translated, { status: 200 });
}

export async function handleAnthropicCompat(
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> {
  const validation = validateDirective(rawKey);
  if (validation.valid === false) {
    return createUnauthorizedResponse(validation.error);
  }

  const directive = validation.directive;
  const anthropicBody = await parseAnthropicRequest(req);
  if (!anthropicBody) {
    logError(reqId, "Failed to parse Anthropic messages body");
    return Response.json({ error: { type: "invalid_request_error", message: "Malformed JSON" } }, { status: 400 });
  }

  const clientAgent = req.headers.get("user-agent") || "unknown";
  const endpoint = directive.type === "direct"
    ? resolveUpstreamEndpoint(directive.provider, directive.completion, anthropicBody.model)
    : undefined;
  const poolSize = directive.type === "direct" ? globalKeyPool.getPoolSize(directive.provider) : 1;

  logInbound({
    reqId,
    method: req.method,
    path: "/v1/messages",
    clientAgent,
    directiveStr: rawKey,
    targetProvider: directive.type === "direct" ? directive.provider : directive.preset,
    wireFormat: directive.type === "direct" ? directive.payload : "cl",
    endpoint: endpoint?.rawPath,
    model: anthropicBody.model,
    keyIndex: 0,
    totalKeys: poolSize,
    nuances: directive.type === "direct" ? directive.nuances : undefined,
  });

  const openAiPayload = translateAnthropicToOpenAI(anthropicBody);
  const syntheticReq = new Request("http://localhost:7766/v1/chat/completions", {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(openAiPayload),
    signal: req.signal,
  });

  const openAiRes = await handleOpenAICompat(syntheticReq, rawKey, reqId, { skipInboundLog: true });
  if (openAiRes.status >= 400) {
    const errClone = openAiRes.clone();
    const errText = await errClone.text();
    logError(reqId, `OpenAI Compat returned HTTP ${openAiRes.status}: ${errText}`);
  }

  if (anthropicBody.stream) {
    return handleStreamingResult(openAiRes, anthropicBody.model);
  }
  return handleNonStreamingResult(openAiRes, anthropicBody.model);
}
