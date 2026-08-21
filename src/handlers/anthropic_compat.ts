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
import { getPacerForProvider, PacerQueueOverflowError, PacerQueueTimeoutError } from "../network/pacer";
import { getCircuitBreakerForProvider } from "../network/circuit_breaker";
import type { DirectDirective } from "../directive/parser";
import type { SelectedKey } from "../network/pool";

export interface AnthropicContentBlock {
  readonly type: "text" | "image" | "tool_use" | "tool_result";
  readonly text?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly tool_use_id?: string;
  readonly content?: string | readonly unknown[];
  readonly is_error?: boolean;
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
  readonly tool_choice?: unknown;
  readonly [key: string]: unknown;
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

  if (Array.isArray(req.messages)) {
    for (const msg of req.messages) {
      if (msg.role === "assistant") {
        const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];
        let textContent = "";

        if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === "text" && block.text) {
              textContent += block.text;
            } else if (block.type === "tool_use" && block.name) {
              const callId = block.id || `call_${Math.random().toString(36).slice(2, 10)}`;
              const args = typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {});
              toolCalls.push({
                id: callId,
                type: "function",
                function: {
                  name: block.name,
                  arguments: args,
                },
              });
            }
          }
        } else if (typeof msg.content === "string") {
          textContent = msg.content;
        }

        const assistantMsg: Record<string, unknown> = {
          role: "assistant",
          content: textContent.length > 0 ? textContent : null,
        };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        openAiMessages.push(assistantMsg as unknown as OpenAIMessage);
      } else if (msg.role === "user") {
        if (Array.isArray(msg.content)) {
          const contentList: readonly AnthropicContentBlock[] = msg.content;
          const toolResults = contentList.filter((b: AnthropicContentBlock) => b.type === "tool_result");
          const textBlocks = contentList.filter((b: AnthropicContentBlock) => b.type === "text");

          for (const tr of toolResults) {
            let resultText = "";
            if (typeof tr.content === "string") {
              resultText = tr.content;
            } else if (Array.isArray(tr.content)) {
              resultText = tr.content
                .map((b: unknown) => {
                  if (typeof b === "object" && b !== null && "text" in b && typeof (b as { text: unknown }).text === "string") {
                    return (b as { text: string }).text;
                  }
                  return typeof b === "string" ? b : JSON.stringify(b);
                })
                .join("\n");
            } else if (tr.content !== undefined && tr.content !== null) {
              resultText = JSON.stringify(tr.content);
            }

            openAiMessages.push({
              role: "tool",
              tool_call_id: tr.tool_use_id ?? tr.id ?? "call_unknown",
              content: resultText,
            } as unknown as OpenAIMessage);
          }

          if (textBlocks.length > 0) {
            const combinedText = textBlocks.map((b: AnthropicContentBlock) => b.text ?? "").join("\n");
            if (combinedText.trim().length > 0) {
              openAiMessages.push({ role: "user", content: combinedText });
            }
          }
        } else if (typeof msg.content === "string") {
          openAiMessages.push({ role: "user", content: msg.content });
        }
      }
    }
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
  const choices = (openAiRes.choices as Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string;
  }>) || [];

  const firstChoice = choices[0];
  const msg = firstChoice?.message;
  const contentBlocks: AnthropicContentBlock[] = [];

  if (msg?.content && typeof msg.content === "string" && msg.content.length > 0) {
    contentBlocks.push({ type: "text", text: msg.content });
  }

  if (Array.isArray(msg?.tool_calls)) {
    for (const tc of msg.tool_calls) {
      if (tc.function?.name) {
        let parsedInput: unknown = {};
        if (tc.function.arguments) {
          try {
            parsedInput = JSON.parse(tc.function.arguments);
          } catch {
            parsedInput = { raw: tc.function.arguments };
          }
        }
        contentBlocks.push({
          type: "tool_use",
          id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
          name: tc.function.name,
          input: parsedInput,
        });
      }
    }
  }

  const hasToolUse = contentBlocks.some((b) => b.type === "tool_use");
  const stopReason = hasToolUse ? "tool_use" : (firstChoice?.finish_reason === "stop" || firstChoice?.finish_reason === "end_turn" ? "end_turn" : "end_turn");

  return {
    id: (openAiRes.id as string) || `msg_${Math.random().toString(36).slice(2, 11)}`,
    type: "message",
    role: "assistant",
    content: contentBlocks,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: openAiRes.usage || { input_tokens: 0, output_tokens: 0 },
  };
}

interface ActiveToolInfo {
  readonly blockIndex: number;
  readonly id: string;
  readonly name: string;
}

function isPassThroughEvent(rawData: string): boolean {
  return rawData.startsWith("{\"type\":") || rawData.startsWith("{\"event\":");
}

export function createAnthropicStreamTransformer(model: string): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let msgStartSent = false;
  let currentBlockIndex = -1;
  let currentBlockType: "text" | "tool_use" | null = null;
  const activeToolMap = new Map<number, ActiveToolInfo>();
  let messageDeltaSent = false;
  let buffer = "";

  const closeCurrentBlock = (controller: TransformStreamDefaultController<Uint8Array>) => {
    if (currentBlockType !== null && currentBlockIndex >= 0) {
      controller.enqueue(
        encoder.encode(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${currentBlockIndex}}\n\n`)
      );
      currentBlockType = null;
    }
  };

  const processLine = (line: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    if (!line.startsWith("data: ") || line.includes("[DONE]")) {
      return;
    }
    const rawData = line.slice(6).trim();
    if (isPassThroughEvent(rawData)) {
      const evtLine = `event: content_block_delta\ndata: ${rawData}\n\n`;
      controller.enqueue(encoder.encode(evtLine));
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      return;
    }

    if (!msgStartSent) {
      msgStartSent = true;
      const msgId = (parsed.id as string) || `msg_${Math.random().toString(36).slice(2, 11)}`;
      const startEvt = `event: message_start\ndata: {"type":"message_start","message":{"id":"${msgId}","type":"message","role":"assistant","content":[],"model":"${model}","stop_reason":null,"usage":{"input_tokens":0,"output_tokens":0}}}\n\n`;
      controller.enqueue(encoder.encode(startEvt));
    }

    const choices = parsed.choices as Array<{
      delta?: {
        content?: string | null;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          type?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }> | undefined;

    const choice = choices?.[0];
    if (!choice) {
      return;
    }

    if (choice.delta?.content) {
      if (currentBlockType !== "text") {
        closeCurrentBlock(controller);
        currentBlockIndex++;
        currentBlockType = "text";
        controller.enqueue(
          encoder.encode(
            `event: content_block_start\ndata: {"type":"content_block_start","index":${currentBlockIndex},"content_block":{"type":"text","text":""}}\n\n`
          )
        );
      }
      controller.enqueue(
        encoder.encode(
          `event: content_block_delta\ndata: {"type":"content_block_delta","index":${currentBlockIndex},"delta":{"type":"text_delta","text":${JSON.stringify(choice.delta.content)}}}\n\n`
        )
      );
    }

    if (Array.isArray(choice.delta?.tool_calls)) {
      for (const tc of choice.delta.tool_calls) {
        const tcIdx = typeof tc.index === "number" ? tc.index : 0;
        let toolInfo = activeToolMap.get(tcIdx);

        if (!toolInfo && (tc.id || tc.function?.name)) {
          closeCurrentBlock(controller);
          currentBlockIndex++;
          currentBlockType = "tool_use";
          const toolId = tc.id || `call_${Math.random().toString(36).slice(2, 10)}`;
          const toolName = tc.function?.name || "tool";
          toolInfo = { blockIndex: currentBlockIndex, id: toolId, name: toolName };
          activeToolMap.set(tcIdx, toolInfo);

          controller.enqueue(
            encoder.encode(
              `event: content_block_start\ndata: {"type":"content_block_start","index":${currentBlockIndex},"content_block":{"type":"tool_use","id":"${toolId}","name":"${toolName}","input":{}}}\n\n`
            )
          );
        }

        if (tc.function?.arguments && toolInfo) {
          controller.enqueue(
            encoder.encode(
              `event: content_block_delta\ndata: {"type":"content_block_delta","index":${toolInfo.blockIndex},"delta":{"type":"input_json_delta","partial_json":${JSON.stringify(tc.function.arguments)}}}\n\n`
            )
          );
        }
      }
    }

    if (choice.finish_reason) {
      closeCurrentBlock(controller);
      const stopReason = choice.finish_reason === "tool_calls" ? "tool_use" : (choice.finish_reason === "stop" || choice.finish_reason === "end_turn" ? "end_turn" : choice.finish_reason);
      if (!messageDeltaSent) {
        messageDeltaSent = true;
        controller.enqueue(
          encoder.encode(
            `event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"${stopReason}","stop_sequence":null},"usage":{"output_tokens":0}}\n\n`
          )
        );
      }
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        processLine(line, controller);
      }
    },
    flush(controller) {
      if (buffer.length > 0) {
        processLine(buffer, controller);
      }
      closeCurrentBlock(controller);
      if (!messageDeltaSent) {
        messageDeltaSent = true;
        controller.enqueue(
          encoder.encode('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":0}}\n\n')
        );
      }
      controller.enqueue(encoder.encode('event: message_stop\ndata: {"type":"message_stop"}\n\n'));
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
  const env = getEnv();
  const breaker = env.LITEROUTER_CIRCUIT_BREAKER
    ? getCircuitBreakerForProvider(directive.provider)
    : null;

  if (breaker && !breaker.isAvailable()) {
    logLimit(reqId, directive.provider, selected.index, 503, 60, selected.totalKeys);
    throw new UpstreamRetryableError(
      `Provider '${directive.provider}' circuit breaker is OPEN`,
      503,
      { action: "retry_rotate", reason: "circuit_breaker_open", quarantineTtlSec: 60 }
    );
  }

  if (env.LITEROUTER_PACER_ENABLED) {
    const dynamicMaxQueueDepth = globalKeyPool.getDynamicMaxQueueDepth(directive.provider);
    const maxQueueDepth = env.LITEROUTER_PACER_MAX_QUEUE_DEPTH > 0
      ? env.LITEROUTER_PACER_MAX_QUEUE_DEPTH
      : dynamicMaxQueueDepth;
    const pacer = getPacerForProvider(directive.provider, selected.index, {
      maxQueueDepth,
      maxQueueWaitMs: env.LITEROUTER_PACER_MAX_QUEUE_WAIT_MS,
    });
    await pacer.acquire(clientSignal);
  }

  const endpoint = resolveUpstreamEndpoint(directive.provider, directive.completion, payload.model);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${selected.key}`,
    "Accept-Encoding": "identity",
    "HTTP-Referer": env.LITEROUTER_HTTP_REFERER,
    "X-Title": env.LITEROUTER_X_TITLE,
  };

  const startTime = Date.now();
  const { response, ttftMs, firstChunk, rawReader, protocol } = await fetchWithTtftGuard({
    url: endpoint.url,
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    clientSignal,
    provider: directive.provider,
    keyIndex: selected.index,
    model: payload.model,
  });
  const duration = Date.now() - startTime;
  const isStream = Boolean(payload.stream);

  if (response.status >= 400) {
    if (response.status >= 500 || response.status === 529) {
      breaker?.recordFailure(true);
    } else {
      breaker?.recordFailure(false);
    }

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

  breaker?.recordSuccess();

  globalKeyPool.reportSuccess(directive.provider, selected.index);
  logTtft(reqId, ttftMs, isStream ? "Stream established" : "First chunk streamed downstream", protocol);

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
    protocol: "anthropic",
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

        if (env.LITEROUTER_PACER_ENABLED) {
          const dynamicMaxQueueDepth = globalKeyPool.getDynamicMaxQueueDepth(directive.provider);
          const maxQueueDepth = env.LITEROUTER_PACER_MAX_QUEUE_DEPTH > 0
            ? env.LITEROUTER_PACER_MAX_QUEUE_DEPTH
            : dynamicMaxQueueDepth;
          const pacer = getPacerForProvider(directive.provider, nextSelected.index, {
            maxQueueDepth,
            maxQueueWaitMs: env.LITEROUTER_PACER_MAX_QUEUE_WAIT_MS,
          });
          await pacer.acquire(clientSignal);
        }

        try {
          const nextResult = await fetchWithTtftGuard({
            url: endpoint.url,
            method: "POST",
            headers: nextHeaders,
            body: JSON.stringify(payload),
            clientSignal,
            provider: directive.provider,
            keyIndex: nextSelected.index,
            model: payload.model,
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
  const startTime = Date.now();
  const env = getEnv();
  const maxWaitMs = env.LITEROUTER_PACER_MAX_QUEUE_WAIT_MS || 20000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const dwellMs = Date.now() - startTime;
    if (globalKeyPool.shouldLoadShed(directive.provider, dwellMs, maxWaitMs)) {
      logLimit(reqId, directive.provider, 0, 503, 60, poolSize);
      return Response.json(
        { error: { message: `Provider '${directive.provider}' unavailable: all keys in cooldown exceed wait budget.`, type: "service_unavailable" } },
        { status: 503 }
      );
    }

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
      if (err instanceof PacerQueueOverflowError || err instanceof PacerQueueTimeoutError) {
        return Response.json(
          {
            error: {
              message: err.message,
              type: "rate_limit_error",
            },
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(err.retryAfterSec),
              "Content-Type": "application/json",
            },
          }
        );
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
    protocol: req.headers.get("x-http-version") || "HTTP/1.1",
    directiveStr: rawKey,
    targetProvider: directive.type === "direct" ? directive.provider : directive.preset,
    wireFormat: directive.type === "direct" ? directive.payload : "cl",
    endpoint: endpoint?.rawPath,
    model: anthropicBody.model,
    keyIndex: 0,
    totalKeys: poolSize,
    nuances: directive.type === "direct" ? directive.nuances : undefined,
  });

  // If the directive targets upstream Anthropic Messages endpoint (e.g. completion 'ms' with native 'cl' payload),
  // forward the native Anthropic payload directly with zero lossy format conversion!
  if (directive.type === "direct" && directive.payload === "cl" && directive.completion === "ms") {
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

export const handleAnthropicOpenAICompat = handleAnthropicCompat;

