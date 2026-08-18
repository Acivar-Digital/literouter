import type { OpenAIMessage, OpenAIRequestPayload } from "../transformers/nuances";
import { createUnauthorizedResponse, validateDirective } from "../directive/validator";
import {
  globalKeyPool,
  handleOpenAICompat,
  parseRetryAfterHeader,
  resolveUpstreamEndpoint,
  UpstreamRetryableError,
} from "./openai_compat";
import { classifyUpstreamError } from "../network/classifier";
import {
  logError,
  logInbound,
  logLimit,
  logRotate,
  logSeparator,
  logServed,
  logTtft,
  logUsage,
} from "../ui/logger";
import {
  createResilientStream,
  fetchWithTtftGuard,
  NoResponseError,
  sanitizeDownstreamHeaders,
} from "../network/fetcher";
import { scrubUnsupportedParameters } from "../transformers/payload";
import { getEnv } from "../config/env";
import type { DirectDirective } from "../directive/parser";
import type { SelectedKey } from "../network/pool";

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

async function collectFullBody(
  firstChunk: Uint8Array,
  rawReader: ReadableStreamDefaultReader<Uint8Array>
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [firstChunk];
  let totalLength = firstChunk.length;

  while (true) {
    const { done, value } = await rawReader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      totalLength += value.length;
    }
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function executeAnthropicDirectCall(
  directive: DirectDirective,
  payload: AnthropicMessagesRequest,
  clientSignal: AbortSignal | undefined,
  selected: SelectedKey,
  reqId: string,
  attempt: number,
  maxAttempts: number
): Promise<Response> {
  const endpoint = resolveUpstreamEndpoint(directive.provider, directive.completion, payload.model);
  const env = getEnv();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${selected.key}`,
    "Accept-Encoding": "identity",
    "HTTP-Referer": env.LITEROUTER_HTTP_REFERER,
    "X-Title": env.LITEROUTER_X_TITLE,
  };

  const startTime = Date.now();
  const { response, ttftMs, firstChunk, rawReader } = await fetchWithTtftGuard({
    url: endpoint.url,
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    clientSignal,
    provider: directive.provider,
    keyIndex: selected.index,
  });
  const duration = Date.now() - startTime;
  const isStream = Boolean(payload.stream);

  if (response.status >= 400) {
    const fullBody = await collectFullBody(firstChunk, rawReader);
    const bodyText = new TextDecoder().decode(fullBody);
    const classification = classifyUpstreamError({
      provider: directive.provider,
      status: response.status,
      headers: response.headers,
      bodyText,
    });

    if (classification.quarantineTtlSec > 0) {
      globalKeyPool.reportFailure(
        directive.provider,
        selected.index,
        response.status,
        response.headers,
        bodyText,
        Date.now(),
        classification.quarantineTtlSec
      );
    }

    if (response.status === 429 || classification.quarantineTtlSec > 0) {
      const ttlSec = classification.quarantineTtlSec > 0 ? classification.quarantineTtlSec : 60;
      logLimit(reqId, directive.provider, selected.index, response.status, ttlSec, selected.totalKeys);
    }

    const canRetry = classification.action === "retry_rotate" && attempt < maxAttempts && !clientSignal?.aborted;
    if (canRetry) {
      throw new UpstreamRetryableError(
        `Upstream error ${response.status}: ${classification.reason}`,
        response.status,
        classification
      );
    }

    logServed(reqId, duration, response.status, attempt, maxAttempts);
    logSeparator();

    return new Response(fullBody.buffer as ArrayBuffer, {
      status: response.status,
      headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
    });
  }

  globalKeyPool.reportSuccess(directive.provider, selected.index);
  logTtft(reqId, ttftMs, isStream ? "Stream established" : "First chunk streamed downstream");

  if (!isStream) {
    const fullBody = await collectFullBody(firstChunk, rawReader);
    try {
      const decoded = new TextDecoder().decode(fullBody);
      const json = JSON.parse(decoded) as Record<string, unknown>;
      if (json.usage && typeof json.usage === "object") {
        const u = json.usage as Record<string, unknown>;
        const promptTokens = typeof u.input_tokens === "number" ? u.input_tokens : 0;
        const completionTokens = typeof u.output_tokens === "number" ? u.output_tokens : 0;
        const totalTokens = promptTokens + completionTokens;
        let reasoningTokens: number | undefined;
        if (u.output_tokens_details && typeof u.output_tokens_details === "object") {
          const details = u.output_tokens_details as Record<string, unknown>;
          if (typeof details.thinking_tokens === "number") {
            reasoningTokens = details.thinking_tokens;
          }
        }
        logUsage({
          reqId,
          provider: directive.provider,
          keyIndex: selected.index,
          totalKeys: selected.totalKeys,
          promptTokens,
          reasoningTokens,
          completionTokens,
          totalTokens,
          durationMs: duration,
        });
      }
    } catch (parseErr) {
      void parseErr;
    }

    logServed(reqId, duration, response.status, attempt, maxAttempts);
    logSeparator();

    return new Response(fullBody.buffer as ArrayBuffer, {
      status: response.status,
      headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
    });
  }

  let currentKeyIndex = selected.index;
  let currentAttempt = attempt;

  const resilientStream = createResilientStream(firstChunk, rawReader, {
    onUsage: (u) => {
      const streamDuration = Date.now() - startTime;
      logUsage({
        reqId,
        provider: directive.provider,
        keyIndex: currentKeyIndex,
        totalKeys: selected.totalKeys,
        promptTokens: u.promptTokens,
        reasoningTokens: u.reasoningTokens,
        completionTokens: u.completionTokens,
        totalTokens: u.totalTokens,
        durationMs: streamDuration,
      });
      logServed(reqId, streamDuration, response.status, currentAttempt, maxAttempts);
      logSeparator();
    },
    retryProvider: async (reason: string) => {
      globalKeyPool.reportFailure(directive.provider, currentKeyIndex, 500, undefined, reason, Date.now(), 60);
      logLimit(reqId, directive.provider, currentKeyIndex, 500, 60, selected.totalKeys);

      while (currentAttempt < maxAttempts) {
        currentAttempt++;
        if (clientSignal?.aborted) {
          return null;
        }
        const nextSelected = globalKeyPool.selectNextKey(directive.provider);
        if (!nextSelected) {
          return null;
        }
        logRotate(reqId, directive.provider, currentKeyIndex, nextSelected.index, nextSelected.totalKeys, currentAttempt, maxAttempts);
        currentKeyIndex = nextSelected.index;

        const nextHeaders: Record<string, string> = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${nextSelected.key}`,
          "Accept-Encoding": "identity",
          "HTTP-Referer": env.LITEROUTER_HTTP_REFERER,
          "X-Title": env.LITEROUTER_X_TITLE,
        };

        try {
          const nextResult = await fetchWithTtftGuard({
            url: endpoint.url,
            method: "POST",
            headers: nextHeaders,
            body: JSON.stringify(payload),
            clientSignal,
            provider: directive.provider,
            keyIndex: nextSelected.index,
          });
          if (nextResult.response.status >= 400) {
            globalKeyPool.reportFailure(directive.provider, nextSelected.index, nextResult.response.status);
            continue;
          }
          globalKeyPool.reportSuccess(directive.provider, nextSelected.index);
          return {
            firstChunk: nextResult.firstChunk,
            rawReader: nextResult.rawReader,
            reader: nextResult.rawReader,
          };
        } catch (fetchErr: unknown) {
          void fetchErr;
          globalKeyPool.reportFailure(directive.provider, nextSelected.index, 500);
          continue;
        }
      }
      return null;
    },
  });

  return new Response(resilientStream, {
    status: response.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

async function executeAnthropicDirectLoop(
  directive: DirectDirective,
  payload: AnthropicMessagesRequest,
  clientSignal: AbortSignal | undefined,
  reqId: string
): Promise<Response> {
  const poolSize = globalKeyPool.getPoolSize(directive.provider);
  const maxAttempts = Math.min(3, Math.max(1, poolSize));
  let lastError: unknown = null;
  let prevKeyIndex = -1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const selected = globalKeyPool.selectNextKey(directive.provider);
    if (!selected) {
      logLimit(reqId, directive.provider, 0, 429, 60, poolSize);
      return Response.json(
        { error: { message: `All API keys for provider '${directive.provider}' are cooling down.`, type: "insufficient_quota" } },
        { status: 429 }
      );
    }

    if (attempt > 0) {
      logRotate(reqId, directive.provider, prevKeyIndex, selected.index, selected.totalKeys, attempt + 1, maxAttempts);
    }
    prevKeyIndex = selected.index;

    try {
      return await executeAnthropicDirectCall(directive, payload, clientSignal, selected, reqId, attempt + 1, maxAttempts);
    } catch (err: unknown) {
      lastError = err;
      if (clientSignal?.aborted) {
        break;
      }
      if (err instanceof UpstreamRetryableError) {
        continue;
      }
      if (err instanceof NoResponseError) {
        globalKeyPool.reportFailure(directive.provider, selected.index, 429);
        logLimit(reqId, directive.provider, selected.index, 429, 60, selected.totalKeys);
        continue;
      }
      logError(reqId, "Direct request error", err);
      break;
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : "All direct request attempts failed";
  return Response.json(
    { error: { message: `Direct request attempts exhausted - ${errMsg}`, type: "gateway_error" } },
    { status: 502 }
  );
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

  // If the directive targets upstream Anthropic Messages endpoint (e.g. completion 'ms'),
  // forward the native Anthropic payload directly with zero lossy format conversion!
  if (directive.type === "direct" && directive.completion === "ms") {
    const payload = scrubUnsupportedParameters(
      anthropicBody as unknown as OpenAIRequestPayload
    ) as unknown as AnthropicMessagesRequest;
    return executeAnthropicDirectLoop(directive, payload, req.signal, reqId);
  }

  // Cross-wire fallback: Translate to OpenAI if calling an OpenAI completion endpoint (e.g. 'ch')
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
