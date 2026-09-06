import { TagSanitizerStreamBuffer, stripLeakedTemplateTags } from "../transformers/dots";
import type { OpenAIMessage, OpenAIRequestPayload } from "../transformers/nuances";
import { validateDirective } from "../directive/validator";
import {
  acquireProviderPacer,
  buildAuthHeaders,
  globalKeyPool,
  handleOpenAICompat,
  resolveUpstreamEndpoint,
  UpstreamRetryableError,
  waitAndSelectKey,
} from "./openai_compat";
import { classifyTransportError, classifyUpstreamError } from "../network/classifier";
import {
  EMOJI,
  extractErrorMessage,
  logError,
  logExhausted,
  logInbound,
  logLimit,
  logRotate,
  logSeparator,
  logServed,
  logTtft,
  logUsage,
  logWarn,
} from "../ui/logger";
import {
  createResilientStream,
  fetchWithTtftGuard,
  NoResponseError,
  sanitizeDownstreamHeaders,
} from "../network/fetcher";
import { scrubUnsupportedParameters } from "../transformers/payload";
import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_SAFE_CONTEXT_TOKENS,
  estimateAnthropicTokens,
  extractContextLimit,
  isContextLengthError,
  pruneAnthropicPayload,
} from "../transformers/context_pruner";
import { getEnv } from "../config/env";
import { getPacerForProvider, PacerQueueOverflowError } from "../network/pacer";
import { getCircuitBreakerForProvider } from "../network/circuit_breaker";
import type { DirectDirective } from "../directive/parser";
import type { SelectedKey } from "../network/pool";

export interface AnthropicImageSource {
  readonly type: "base64" | "url";
  readonly media_type?: string;
  readonly data?: string;
  readonly url?: string;
}

export interface AnthropicContentBlock {
  readonly type: "text" | "image" | "document" | "thinking" | "redacted_thinking" | "tool_use" | "tool_result";
  readonly text?: string;
  readonly thinking?: string;
  readonly id?: string;
  readonly name?: string;
  readonly input?: unknown;
  readonly tool_use_id?: string;
  readonly content?: string | readonly unknown[];
  readonly is_error?: boolean;
  readonly source?: AnthropicImageSource;
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
  readonly stream_options?: unknown;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly top_k?: number;
  readonly stop_sequences?: readonly string[];
  readonly metadata?: unknown;
  readonly tools?: readonly unknown[];
  readonly tool_choice?: unknown;
  readonly thinking?: unknown;
  readonly [key: string]: unknown;
}

export function createAnthropicErrorResponse(
  status: number,
  message: string,
  errorType = "invalid_request_error",
  headers?: Record<string, string>
): Response {
  return Response.json(
    {
      type: "error",
      error: {
        type: errorType,
        message,
      },
    },
    {
      status,
      headers: { "Content-Type": "application/json", ...(headers || {}) },
    }
  );
}

export function mapOpenAIToAnthropicStopReason(
  finishReason?: string | null,
  hasToolUse = false
): string {
  if (finishReason === "length") {
    return "max_tokens";
  }
  if (finishReason === "content_filter") {
    return "refusal";
  }
  if (hasToolUse || finishReason === "tool_calls" || finishReason === "function_call") {
    return "tool_use";
  }
  return "end_turn";
}

export function mapOpenAIToAnthropicUsage(usage: unknown): Record<string, unknown> {
  if (!usage || typeof usage !== "object") {
    return { input_tokens: 0, output_tokens: 0 };
  }
  const u = usage as Record<string, unknown>;
  const inputTokens = typeof u.prompt_tokens === "number"
    ? u.prompt_tokens
    : (typeof u.input_tokens === "number" ? u.input_tokens : 0);
  const outputTokens = typeof u.completion_tokens === "number"
    ? u.completion_tokens
    : (typeof u.output_tokens === "number" ? u.output_tokens : 0);

  const result: Record<string, unknown> = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  };

  const details = u.prompt_tokens_details as Record<string, unknown> | undefined;
  if (details && typeof details.cached_tokens === "number") {
    result.cache_read_input_tokens = details.cached_tokens;
  } else if (typeof u.cache_read_input_tokens === "number") {
    result.cache_read_input_tokens = u.cache_read_input_tokens;
  }

  return result;
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

function translateToolChoice(choice: unknown): unknown {
  if (typeof choice === "string") {
    return choice;
  }
  if (typeof choice !== "object" || choice === null) {
    return choice;
  }
  const c = choice as Record<string, unknown>;
  if (c.type === "auto") return "auto";
  if (c.type === "any") return "required";
  if (c.type === "none") return "none";
  if (c.type === "tool" && typeof c.name === "string") {
    return { type: "function", function: { name: c.name } };
  }
  return choice;
}

export function validateAnthropicPayload(payload: AnthropicMessagesRequest): string | null {
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return "messages must be a non-empty array";
  }
  for (const msg of payload.messages) {
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block && typeof block === "object" && block.type === "document") {
          return "Document content blocks (PDF/binary) are not supported by OpenAI-compatible endpoints.";
        }
      }
    }
  }
  return null;
}

function translateAssistantToolBlock(
  block: AnthropicContentBlock
): { id: string; type: "function"; function: { name: string; arguments: string } } | null {
  if (block.type !== "tool_use" || !block.name) {
    return null;
  }
  const callId = block.id || `call_${Math.random().toString(36).slice(2, 10)}`;
  const args = typeof block.input === "string" ? block.input : JSON.stringify(block.input ?? {});
  return {
    id: callId,
    type: "function",
    function: {
      name: block.name,
      arguments: args,
    },
  };
}

function translateAssistantMessage(msg: AnthropicMessage): OpenAIMessage {
  if (typeof msg.content === "string") {
    return { role: "assistant", content: msg.content } as OpenAIMessage;
  }
  if (!Array.isArray(msg.content)) {
    return { role: "assistant", content: null } as OpenAIMessage;
  }

  let textContent = "";
  let reasoningContent = "";
  const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

  for (const block of msg.content) {
    if (block.type === "thinking") {
      reasoningContent += (block.thinking || block.text || "");
    } else if (block.type === "text" && block.text) {
      textContent += block.text;
    }
    const tc = translateAssistantToolBlock(block);
    if (tc) {
      toolCalls.push(tc);
    }
  }

  const result: Record<string, unknown> = {
    role: "assistant",
    content: textContent.length > 0 ? textContent : null,
  };
  if (reasoningContent.length > 0) {
    result.reasoning_content = reasoningContent;
  }
  if (toolCalls.length > 0) {
    result.tool_calls = toolCalls;
  }
  return result as unknown as OpenAIMessage;
}

function formatToolResultContent(content: unknown, isError?: boolean): string {
  let resultText = "";
  if (typeof content === "string") {
    resultText = content;
  } else if (Array.isArray(content)) {
    resultText = content
      .map((b: unknown) => {
        if (typeof b === "object" && b !== null && "text" in b && typeof (b as { text: unknown }).text === "string") {
          return (b as { text: string }).text;
        }
        return typeof b === "string" ? b : JSON.stringify(b);
      })
      .join("\n");
  } else if (content !== undefined && content !== null) {
    resultText = JSON.stringify(content);
  }
  return isError ? `Error: ${resultText}` : resultText;
}

function translateUserContentBlock(block: AnthropicContentBlock): unknown | null {
  if (block.type === "text" && block.text) {
    return { type: "text", text: block.text };
  }
  if (block.type === "image" && block.source) {
    if (block.source.type === "base64" && block.source.data) {
      const mediaType = block.source.media_type || "image/jpeg";
      return {
        type: "image_url",
        image_url: { url: `data:${mediaType};base64,${block.source.data}` },
      };
    }
    if (block.source.type === "url" && block.source.url) {
      return {
        type: "image_url",
        image_url: { url: block.source.url },
      };
    }
  }
  return null;
}

function translateUserMessage(msg: AnthropicMessage, outMessages: OpenAIMessage[]): void {
  if (typeof msg.content === "string") {
    outMessages.push({ role: "user", content: msg.content } as OpenAIMessage);
    return;
  }
  if (!Array.isArray(msg.content)) {
    return;
  }

  const userParts: unknown[] = [];
  for (const block of msg.content) {
    if (block.type === "tool_result") {
      const resultText = formatToolResultContent(block.content, block.is_error);
      outMessages.push({
        role: "tool",
        tool_call_id: block.tool_use_id ?? block.id ?? "call_unknown",
        content: resultText,
      } as unknown as OpenAIMessage);
    } else {
      const part = translateUserContentBlock(block);
      if (part) {
        userParts.push(part);
      }
    }
  }

  if (userParts.length === 1 && typeof (userParts[0] as { type?: string; text?: string }).text === "string" && (userParts[0] as { type?: string }).type === "text") {
    outMessages.push({ role: "user", content: (userParts[0] as { text: string }).text } as OpenAIMessage);
  } else if (userParts.length > 0) {
    outMessages.push({ role: "user", content: userParts } as unknown as OpenAIMessage);
  }
}

const ALLOWED_OPENAI_KEYS = new Set([
  "model",
  "messages",
  "stream",
  "stream_options",
  "max_tokens",
  "max_completion_tokens",
  "temperature",
  "top_p",
  "stop",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "user",
  "metadata",
  "response_format",
  "seed",
]);

export function translateAnthropicToOpenAI(req: AnthropicMessagesRequest): OpenAIRequestPayload {
  const openAiMessages: OpenAIMessage[] = [];
  const systemText = extractSystemString(req.system);

  if (systemText) {
    openAiMessages.push({ role: "system", content: systemText });
  }

  if (Array.isArray(req.messages)) {
    for (const msg of req.messages) {
      if (msg.role === "assistant") {
        openAiMessages.push(translateAssistantMessage(msg));
      } else if (msg.role === "user") {
        translateUserMessage(msg, openAiMessages);
      }
    }
  }

  const result: Record<string, unknown> = {
    model: req.model,
    messages: openAiMessages,
    stream: req.stream,
  };

  if (req.stream_options !== undefined) {
    result.stream_options = req.stream_options;
  }

  const env = getEnv();
  const minAoMaxTokens = env.LITEROUTER_AO_MAX_TOKENS ?? 32768;
  if (minAoMaxTokens > 0) {
    result.max_tokens = req.max_tokens !== undefined ? Math.max(req.max_tokens, minAoMaxTokens) : minAoMaxTokens;
  } else if (req.max_tokens !== undefined) {
    result.max_tokens = req.max_tokens;
  }
  if (req.temperature !== undefined) result.temperature = req.temperature;
  if (req.top_p !== undefined) result.top_p = req.top_p;
  if (req.stop_sequences !== undefined) result.stop = req.stop_sequences;
  if (req.metadata !== undefined) result.metadata = req.metadata;

  const translatedTools = translateTools(req.tools);
  if (translatedTools !== undefined) result.tools = translatedTools;

  if (req.tool_choice !== undefined) {
    result.tool_choice = translateToolChoice(req.tool_choice);
    if (typeof req.tool_choice === "object" && req.tool_choice !== null) {
      const tc = req.tool_choice as Record<string, unknown>;
      if (tc.disable_parallel_tool_use) {
        result.parallel_tool_calls = false;
      }
    }
  }

  for (const [key, value] of Object.entries(req)) {
    if (ALLOWED_OPENAI_KEYS.has(key) && result[key] === undefined && value !== undefined) {
      result[key] = value;
    }
  }

  return result as unknown as OpenAIRequestPayload;
}

export function translateOpenAIToAnthropicResponse(
  openAiRes: Record<string, unknown>,
  model: string
): Record<string, unknown> {
  const choices = (openAiRes.choices as Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
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

  const reasoning = msg?.reasoning_content || msg?.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    const cleaned = stripLeakedTemplateTags(reasoning);
    if (cleaned.length > 0) {
      contentBlocks.push({ type: "thinking", thinking: cleaned } as AnthropicContentBlock);
    }
  }

  let textContent = "";
  if (typeof msg?.content === "string") {
    textContent = stripLeakedTemplateTags(msg.content);
  } else if (Array.isArray(msg?.content)) {
    textContent = stripLeakedTemplateTags(
      msg.content
        .filter((p) => p?.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("")
    );
  }

  if (textContent.length > 0) {
    contentBlocks.push({ type: "text", text: textContent });
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

  if (contentBlocks.length === 0) {
    contentBlocks.push({ type: "text", text: "" });
  }

  const hasToolUse = contentBlocks.some((b) => b.type === "tool_use");
  const stopReason = mapOpenAIToAnthropicStopReason(firstChoice?.finish_reason, hasToolUse);

  return {
    id: (openAiRes.id as string) || `msg_${Math.random().toString(36).slice(2, 11)}`,
    type: "message",
    role: "assistant",
    content: contentBlocks,
    model,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: mapOpenAIToAnthropicUsage(openAiRes.usage),
  };
}

interface ActiveToolInfo {
  readonly blockIndex: number;
  readonly id: string;
  readonly name: string;
}

interface StreamTransformState {
  msgStartSent: boolean;
  currentBlockIndex: number;
  currentBlockType: "text" | "thinking" | "tool_use" | null;
  messageDeltaSent: boolean;
  accumulatedInputTokens: number;
  accumulatedOutputTokens: number;
  readonly activeToolMap: Map<number, ActiveToolInfo>;
  readonly openBlockIndices: Set<number>;
  pendingStopReason: string | null;
  readonly thinkingSanitizer: TagSanitizerStreamBuffer;
  readonly textSanitizer: TagSanitizerStreamBuffer;
}

function sseEvent(encoder: TextEncoder, event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function handleNativeAnthropicPassThrough(
  rawData: string,
  parsed: Record<string, unknown>,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): boolean {
  if (
    typeof parsed.type === "string" &&
    (parsed.type.startsWith("message_") || parsed.type.startsWith("content_block_") || parsed.type === "ping")
  ) {
    controller.enqueue(encoder.encode(`event: ${parsed.type}\ndata: ${rawData}\n\n`));
    return true;
  }
  return false;
}

function ensureMessageStart(
  parsed: Record<string, unknown>,
  model: string,
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  if (!state.msgStartSent) {
    state.msgStartSent = true;
    const msgId = (parsed.id as string) || `msg_${Math.random().toString(36).slice(2, 11)}`;
    controller.enqueue(
      sseEvent(encoder, "message_start", {
        type: "message_start",
        message: {
          id: msgId,
          type: "message",
          role: "assistant",
          content: [],
          model,
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: state.accumulatedInputTokens,
            output_tokens: 0,
          },
        },
      })
    );
  }
}

function closeAllOpenBlocks(
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  for (const index of state.openBlockIndices) {
    controller.enqueue(
      sseEvent(encoder, "content_block_stop", {
        type: "content_block_stop",
        index,
      })
    );
  }
  state.openBlockIndices.clear();
  state.currentBlockType = null;
}

function closeCurrentBlock(
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  if (state.currentBlockType !== null && state.openBlockIndices.has(state.currentBlockIndex)) {
    if (state.currentBlockType === "thinking") {
      const trailing = state.thinkingSanitizer.flush();
      if (trailing.length > 0) {
        controller.enqueue(
          sseEvent(encoder, "content_block_delta", {
            type: "content_block_delta",
            index: state.currentBlockIndex,
            delta: { type: "thinking_delta", thinking: trailing },
          })
        );
      }
    } else if (state.currentBlockType === "text") {
      const trailing = state.textSanitizer.flush();
      if (trailing.length > 0) {
        controller.enqueue(
          sseEvent(encoder, "content_block_delta", {
            type: "content_block_delta",
            index: state.currentBlockIndex,
            delta: { type: "text_delta", text: trailing },
          })
        );
      }
    }
    controller.enqueue(
      sseEvent(encoder, "content_block_stop", {
        type: "content_block_stop",
        index: state.currentBlockIndex,
      })
    );
    state.openBlockIndices.delete(state.currentBlockIndex);
    state.currentBlockType = null;
  }
}

function processReasoningDelta(
  reasoningDelta: string,
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  const sanitized = state.thinkingSanitizer.process(reasoningDelta);
  if (!sanitized) {
    return;
  }
  if (state.currentBlockType !== "thinking") {
    closeCurrentBlock(state, controller, encoder);
    state.currentBlockIndex++;
    state.currentBlockType = "thinking";
    state.openBlockIndices.add(state.currentBlockIndex);
    controller.enqueue(
      sseEvent(encoder, "content_block_start", {
        type: "content_block_start",
        index: state.currentBlockIndex,
        content_block: { type: "thinking", thinking: "" },
      })
    );
  }
  controller.enqueue(
    sseEvent(encoder, "content_block_delta", {
      type: "content_block_delta",
      index: state.currentBlockIndex,
      delta: { type: "thinking_delta", thinking: sanitized },
    })
  );
}

function processTextDelta(
  textDelta: string,
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  const sanitized = state.textSanitizer.process(textDelta);
  if (!sanitized) {
    return;
  }
  if (state.currentBlockType !== "text") {
    closeCurrentBlock(state, controller, encoder);
    state.currentBlockIndex++;
    state.currentBlockType = "text";
    state.openBlockIndices.add(state.currentBlockIndex);
    controller.enqueue(
      sseEvent(encoder, "content_block_start", {
        type: "content_block_start",
        index: state.currentBlockIndex,
        content_block: { type: "text", text: "" },
      })
    );
  }
  controller.enqueue(
    sseEvent(encoder, "content_block_delta", {
      type: "content_block_delta",
      index: state.currentBlockIndex,
      delta: { type: "text_delta", text: sanitized },
    })
  );
}

function processToolCallsDelta(
  toolCalls: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>,
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  for (const tc of toolCalls) {
    const tcIdx = typeof tc.index === "number" ? tc.index : 0;
    let toolInfo = state.activeToolMap.get(tcIdx);

    if (!toolInfo && (tc.id || tc.function?.name)) {
      closeCurrentBlock(state, controller, encoder);
      state.currentBlockIndex++;
      state.currentBlockType = "tool_use";
      state.openBlockIndices.add(state.currentBlockIndex);
      const toolId = tc.id || `call_${Math.random().toString(36).slice(2, 10)}`;
      const toolName = tc.function?.name || "tool";
      toolInfo = { blockIndex: state.currentBlockIndex, id: toolId, name: toolName };
      state.activeToolMap.set(tcIdx, toolInfo);

      controller.enqueue(
        sseEvent(encoder, "content_block_start", {
          type: "content_block_start",
          index: state.currentBlockIndex,
          content_block: { type: "tool_use", id: toolId, name: toolName, input: {} },
        })
      );
    }

    if (tc.function?.arguments && toolInfo) {
      controller.enqueue(
        sseEvent(encoder, "content_block_delta", {
          type: "content_block_delta",
          index: toolInfo.blockIndex,
          delta: { type: "input_json_delta", partial_json: tc.function.arguments },
        })
      );
    }
  }
}

export function createAnthropicStreamTransformer(model: string): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state: StreamTransformState = {
    msgStartSent: false,
    currentBlockIndex: -1,
    currentBlockType: null,
    messageDeltaSent: false,
    accumulatedInputTokens: 0,
    accumulatedOutputTokens: 0,
    activeToolMap: new Map<number, ActiveToolInfo>(),
    openBlockIndices: new Set<number>(),
    pendingStopReason: null,
    thinkingSanitizer: new TagSanitizerStreamBuffer(),
    textSanitizer: new TagSanitizerStreamBuffer(),
  };
  let buffer = "";

  const processLine = (rawLine: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(":")) {
      return;
    }
    const dataMatch = line.match(/^data:\s*(.*)$/);
    if (!dataMatch || dataMatch[1] === undefined) {
      return;
    }
    const rawData = dataMatch[1].trim();
    if (!rawData || rawData === "[DONE]") {
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      return;
    }

    if (parsed.error && typeof parsed.error === "object") {
      const errObj = parsed.error as Record<string, unknown>;
      const errMsg = typeof errObj.message === "string" ? errObj.message : JSON.stringify(errObj);
      const errType = typeof errObj.type === "string" ? errObj.type : "api_error";
      controller.enqueue(
        sseEvent(encoder, "error", {
          type: "error",
          error: {
            type: errType,
            message: errMsg,
          },
        })
      );
      return;
    }

    if (handleNativeAnthropicPassThrough(rawData, parsed, controller, encoder)) {
      return;
    }

    if (parsed.usage && typeof parsed.usage === "object") {
      const u = parsed.usage as Record<string, unknown>;
      if (typeof u.prompt_tokens === "number") state.accumulatedInputTokens = u.prompt_tokens;
      if (typeof u.completion_tokens === "number") state.accumulatedOutputTokens = u.completion_tokens;
    }

    ensureMessageStart(parsed, model, state, controller, encoder);

    const choices = parsed.choices as Array<{
      delta?: {
        content?: string | null;
        reasoning_content?: string | null;
        reasoning?: string | null;
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
      if (state.pendingStopReason && !state.messageDeltaSent && parsed.usage) {
        state.messageDeltaSent = true;
        controller.enqueue(
          sseEvent(encoder, "message_delta", {
            type: "message_delta",
            delta: { stop_reason: state.pendingStopReason, stop_sequence: null },
            usage: { output_tokens: state.accumulatedOutputTokens },
          })
        );
      }
      return;
    }

    const reasoningDelta = choice.delta?.reasoning_content || choice.delta?.reasoning;
    if (typeof reasoningDelta === "string" && reasoningDelta.length > 0) {
      processReasoningDelta(reasoningDelta, state, controller, encoder);
    }

    if (choice.delta?.content) {
      processTextDelta(choice.delta.content, state, controller, encoder);
    }

    if (Array.isArray(choice.delta?.tool_calls)) {
      processToolCallsDelta(choice.delta.tool_calls, state, controller, encoder);
    }

    if (choice.finish_reason) {
      closeAllOpenBlocks(state, controller, encoder);
      state.pendingStopReason = mapOpenAIToAnthropicStopReason(choice.finish_reason, state.activeToolMap.size > 0);
    }
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
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
      closeAllOpenBlocks(state, controller, encoder);
      if (!state.messageDeltaSent) {
        state.messageDeltaSent = true;
        const finalStopReason = state.pendingStopReason || "end_turn";
        controller.enqueue(
          sseEvent(encoder, "message_delta", {
            type: "message_delta",
            delta: { stop_reason: finalStopReason, stop_sequence: null },
            usage: { output_tokens: state.accumulatedOutputTokens },
          })
        );
      }
      controller.enqueue(sseEvent(encoder, "message_stop", { type: "message_stop" }));
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

  const endpoint = resolveUpstreamEndpoint(directive.provider, directive.completion, payload.model);
  const headers = buildAuthHeaders(endpoint.authHeader, selected.key, directive.provider);

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

    const rawErrorMsg = extractErrorMessage(bodyText);
    const ttlSec = classification.quarantineTtlSec > 0 ? classification.quarantineTtlSec : (response.status === 429 ? 60 : undefined);
    logLimit(reqId, directive.provider, selected.index, response.status, ttlSec, selected.totalKeys, rawErrorMsg);

    if (isContextLengthError(response.status, bodyText) && !clientSignal?.aborted) {
      const detectedLimit = extractContextLimit(bodyText);
      const targetLimit = detectedLimit ? Math.floor(detectedLimit * 0.75) : DEFAULT_SAFE_CONTEXT_TOKENS;
      const pruned = pruneAnthropicPayload(payload, targetLimit);
      if (pruned.messages.length < payload.messages.length || estimateAnthropicTokens(pruned) < estimateAnthropicTokens(payload)) {
        logWarn(EMOJI.prune, `[PRUNE ${reqId}] Context length exceeded upstream (${detectedLimit ?? "unknown"} tokens). Auto-pruned message turns and retrying...`);
        return executeAnthropicDirectCall(directive, pruned, clientSignal, selected, reqId, attempt, maxAttempts);
      }
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

  if (!isStream) {
    const fullBody = await collectFullBody(firstChunk, rawReader);
    let isErrorPayload = false;
    let errorStatus = response.status >= 400 ? response.status : 400;
    let errorMessage = "";
    let errorType = "invalid_request_error";

    try {
      const decoded = new TextDecoder().decode(fullBody);
      const json = JSON.parse(decoded) as Record<string, unknown>;

      if (json.type === "error" || json.error) {
        isErrorPayload = true;
        if (json.error && typeof json.error === "object") {
          const errObj = json.error as Record<string, unknown>;
          errorMessage = typeof errObj.message === "string" ? errObj.message : JSON.stringify(errObj);
          if (errObj.type === "rate_limit_error" || errObj.error_type === "rate_limit") {
            errorStatus = 429;
            errorType = "rate_limit_error";
          } else if (errObj.type === "overloaded_error") {
            errorStatus = 529;
            errorType = "overloaded_error";
          } else if (errObj.type === "authentication_error") {
            errorStatus = 401;
            errorType = "authentication_error";
          } else if (errObj.type === "permission_error") {
            errorStatus = 403;
            errorType = "permission_error";
          } else if (errObj.type === "not_found_error") {
            errorStatus = 404;
            errorType = "not_found_error";
          } else if (errObj.type === "api_error") {
            errorStatus = 500;
            errorType = "api_error";
          } else {
            errorStatus = 400;
            errorType = typeof errObj.type === "string" ? errObj.type : "invalid_request_error";
          }
        } else if (typeof json.error === "string") {
          errorMessage = json.error;
          errorStatus = 400;
          errorType = "invalid_request_error";
        }
      }

      if (!isErrorPayload) {
        breaker?.recordSuccess();
        globalKeyPool.reportSuccess(directive.provider, selected.index);
        logTtft(reqId, ttftMs, "First chunk streamed downstream", protocol);

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
      }
    } catch (parseErr) {
      void parseErr;
    }

    if (isErrorPayload) {
      if (isContextLengthError(errorStatus, errorMessage) && !clientSignal?.aborted) {
        const detectedLimit = extractContextLimit(errorMessage);
        const targetLimit = detectedLimit ? Math.floor(detectedLimit * 0.75) : DEFAULT_SAFE_CONTEXT_TOKENS;
        const pruned = pruneAnthropicPayload(payload, targetLimit);
        if (pruned.messages.length < payload.messages.length || estimateAnthropicTokens(pruned) < estimateAnthropicTokens(payload)) {
          logWarn(EMOJI.prune, `[PRUNE ${reqId}] Context length exceeded upstream (${detectedLimit ?? "unknown"} tokens). Auto-pruned message turns and retrying...`);
          return executeAnthropicDirectCall(directive, pruned, clientSignal, selected, reqId, attempt, maxAttempts);
        }
      }

      logError(reqId, `Direct Anthropic non-streaming error [HTTP ${errorStatus}]: ${errorMessage}`);
      logServed(reqId, duration, errorStatus, attempt, maxAttempts);
      logSeparator();
      return createAnthropicErrorResponse(errorStatus, errorMessage, errorType);
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
  logTtft(reqId, ttftMs, "Stream established", protocol);

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
    retryProvider: async (reason: string, hasEmittedTokens?: boolean) => {
      if (hasEmittedTokens) {
        return null;
      }
      const classification = classifyTransportError(reason);
      if (classification.quarantineTtlSec > 0) {
        globalKeyPool.reportFailure(directive.provider, currentKeyIndex, 500, undefined, reason, Date.now(), classification.quarantineTtlSec);
      }
      logLimit(reqId, directive.provider, currentKeyIndex, 500, classification.quarantineTtlSec > 0 ? classification.quarantineTtlSec : undefined, selected.totalKeys, reason);

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

        const nextHeaders = buildAuthHeaders(endpoint.authHeader, nextSelected.key, directive.provider);

        if (env.LITEROUTER_PACER_ENABLED) {
          const dynamicMaxQueueDepth = globalKeyPool.getDynamicMaxQueueDepth(directive.provider);
          const maxQueueDepth = env.LITEROUTER_PACER_MAX_QUEUE_DEPTH > 0
            ? env.LITEROUTER_PACER_MAX_QUEUE_DEPTH
            : dynamicMaxQueueDepth;
          const pacer = getPacerForProvider(directive.provider, nextSelected.index, {
            maxQueueDepth,
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
      const minTtl = globalKeyPool.getMinQuarantineTtlMs(directive.provider);
      const retryAfterSec = Math.max(1, Math.ceil(minTtl / 1000));
      return createAnthropicErrorResponse(
        503,
        `Provider '${directive.provider}' unavailable: all keys in cooldown exceed wait budget.`,
        "api_error",
        { "Retry-After": String(retryAfterSec) }
      );
    }

    const shouldPaceIngress =
      !["or", "nv", "zn", "gg"].includes(directive.provider) || !env.LITEROUTER_PACER_ENABLED;
    if (shouldPaceIngress) {
      try {
        await acquireProviderPacer(directive.provider, clientSignal);
      } catch (err: unknown) {
        if (clientSignal?.aborted || (err instanceof Error && err.message.includes("aborted"))) {
          return createAnthropicErrorResponse(499, "Request aborted by client", "invalid_request_error");
        }
        if (err instanceof PacerQueueOverflowError) {
          return Response.json(
            {
              type: "error",
              error: {
                type: "rate_limit_error",
                message: err.message,
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
        throw err;
      }
    }

    const selected = await waitAndSelectKey(directive.provider, startTime, maxWaitMs, clientSignal);
    if (!selected) {
      if (clientSignal?.aborted) {
        return createAnthropicErrorResponse(499, "Request aborted by client", "invalid_request_error");
      }
      const minTtl = globalKeyPool.getMinQuarantineTtlMs(directive.provider);
      logExhausted(reqId, directive.provider, minTtl);
      return createAnthropicErrorResponse(
        429,
        `All API keys for provider '${directive.provider}' are cooling down.`,
        "rate_limit_error"
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
      if (clientSignal?.aborted || (err instanceof Error && err.message.includes("aborted"))) {
        return createAnthropicErrorResponse(499, "Request aborted by client", "invalid_request_error");
      }
      if (err instanceof PacerQueueOverflowError) {
        return Response.json(
          {
            type: "error",
            error: {
              type: "rate_limit_error",
              message: err.message,
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
        globalKeyPool.reportFailure(directive.provider, selected.index, 0, undefined, err.message, Date.now(), 2);
        continue;
      }
      logError(reqId, "Direct request error", err);
      break;
    }
  }

  const errMsg = lastError instanceof Error ? lastError.message : "All direct request attempts failed";
  return createAnthropicErrorResponse(502, `Direct request attempts exhausted - ${errMsg}`, "api_error");
}

export async function handleAnthropicCompat(
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> {
  const validation = validateDirective(rawKey);
  if (validation.valid === false) {
    return createAnthropicErrorResponse(401, validation.error, "authentication_error");
  }

  const directive = validation.directive;
  const anthropicBody = await parseAnthropicRequest(req);
  if (!anthropicBody) {
    logError(reqId, "Failed to parse Anthropic messages body");
    return createAnthropicErrorResponse(400, "Malformed JSON", "invalid_request_error");
  }

  const validationError = validateAnthropicPayload(anthropicBody);
  if (validationError) {
    return createAnthropicErrorResponse(400, validationError, "invalid_request_error");
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
    totalKeys: poolSize,
    nuances: directive.type === "direct" ? directive.nuances : undefined,
  });

  let effectiveAnthropicBody = anthropicBody;
  const initialTokens = estimateAnthropicTokens(anthropicBody);
  if (initialTokens > DEFAULT_MAX_CONTEXT_TOKENS) {
    effectiveAnthropicBody = pruneAnthropicPayload(anthropicBody, DEFAULT_SAFE_CONTEXT_TOKENS);
    logWarn(EMOJI.prune, `[PRUNE ${reqId}] Proactively pruned Anthropic messages: ${initialTokens} -> ${estimateAnthropicTokens(effectiveAnthropicBody)} tokens.`);
  }

  if (directive.type === "direct" && directive.payload === "cl" && directive.completion === "ms") {
    const payload = scrubUnsupportedParameters(
      effectiveAnthropicBody as unknown as OpenAIRequestPayload,
      undefined,
      getEnv().LITEROUTER_ENABLE_SCRUBBING
    ) as unknown as AnthropicMessagesRequest;
    return executeAnthropicDirectLoop(directive, payload, req.signal, reqId);
  }

  const openAiPayload = translateAnthropicToOpenAI(effectiveAnthropicBody);

  const cleanHeaders = new Headers(req.headers);
  cleanHeaders.delete("authorization");
  cleanHeaders.delete("content-length");
  cleanHeaders.delete("anthropic-version");
  cleanHeaders.delete("anthropic-beta");
  cleanHeaders.delete("x-api-key");
  cleanHeaders.set("Content-Type", "application/json");

  const syntheticReq = new Request("http://localhost:7766/v1/chat/completions", {
    method: "POST",
    headers: cleanHeaders,
    body: JSON.stringify(openAiPayload),
    signal: req.signal,
  });

  const openAiRes = await handleOpenAICompat(syntheticReq, rawKey, reqId, { skipInboundLog: true });
  if (req.signal?.aborted && openAiRes.status === 499) {
    return createAnthropicErrorResponse(499, "Request aborted by client", "invalid_request_error");
  }
  if (openAiRes.status >= 400) {
    const errClone = openAiRes.clone();
    try {
      const errJson = (await errClone.json()) as Record<string, unknown>;
      const errObj = (errJson.error as Record<string, unknown>) || {};
      const errMsg = typeof errObj.message === "string"
        ? errObj.message
        : (typeof errJson.message === "string" ? errJson.message : JSON.stringify(errJson));
      const errType = typeof errObj.type === "string" ? errObj.type : "api_error";
      logError(reqId, `OpenAI Compat returned HTTP ${openAiRes.status}: ${errMsg}`);
      return createAnthropicErrorResponse(openAiRes.status, errMsg, errType);
    } catch {
      const errText = await openAiRes.text();
      logError(reqId, `OpenAI Compat returned HTTP ${openAiRes.status}: ${errText}`);
      return createAnthropicErrorResponse(openAiRes.status, errText || "Upstream error", "api_error");
    }
  }

  if (anthropicBody.stream) {
    return handleStreamingResult(openAiRes, anthropicBody.model);
  }
  return handleNonStreamingResult(openAiRes, anthropicBody.model);
}

export { estimateTextTokens, estimateAnthropicTokens as estimateAnthropicInputTokens } from "../transformers/context_pruner";

export async function handleAnthropicCountTokens(
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> {
  const startTime = Date.now();
  const validation = validateDirective(rawKey);
  if (validation.valid === false) {
    return createAnthropicErrorResponse(401, validation.error, "authentication_error");
  }

  const directive = validation.directive;
  const anthropicBody = await parseAnthropicRequest(req);
  if (!anthropicBody) {
    logError(reqId, "Failed to parse Anthropic count_tokens body");
    return createAnthropicErrorResponse(400, "Malformed JSON", "invalid_request_error");
  }

  const validationError = validateAnthropicPayload(anthropicBody);
  if (validationError) {
    return createAnthropicErrorResponse(400, validationError, "invalid_request_error");
  }

  const clientAgent = req.headers.get("user-agent") || "unknown";
  logInbound({
    reqId,
    method: req.method,
    path: "/v1/messages/count_tokens",
    clientAgent,
    protocol: req.headers.get("x-http-version") || "HTTP/1.1",
    directiveStr: rawKey,
    targetProvider: directive.type === "direct" ? directive.provider : directive.preset,
    wireFormat: directive.type === "direct" ? directive.payload : "cl",
    model: anthropicBody.model,
    totalKeys: directive.type === "direct" ? globalKeyPool.getPoolSize(directive.provider) : 1,
    nuances: directive.type === "direct" ? directive.nuances : undefined,
  });

  const inputTokens = estimateAnthropicTokens(anthropicBody);
  logServed(reqId, Date.now() - startTime, 200);

  return Response.json(
    { input_tokens: inputTokens },
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    }
  );
}

export const handleAnthropicOpenAICompat = handleAnthropicCompat;
