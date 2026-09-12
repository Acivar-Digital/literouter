import type { ParsedDirective } from "../directive/types";
import type { OutboundWirePayload, PayloadTransformerContract } from "../engine/transformer";
import type { RequestTelemetry, UsageRecord } from "../telemetry/session";
import { TagSanitizerStreamBuffer, stripLeakedTemplateTags } from "./dots";
import type { OpenAIMessage, OpenAIRequestPayload } from "./nuances";
import { getEnv } from "../config/env";

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

export function translateTools(tools?: readonly unknown[]): readonly unknown[] | undefined {
  if (!tools || !Array.isArray(tools)) {
    return undefined;
  }
  return tools.map(translateSingleTool);
}

const TOOL_CHOICE_MAP: Record<string, string> = {
  auto: "auto",
  any: "required",
  none: "none",
};

export function translateToolChoice(choice: unknown): unknown {
  if (typeof choice === "string" || !choice || typeof choice !== "object") {
    return choice;
  }
  const c = choice as Record<string, unknown>;
  const mapped = typeof c.type === "string" ? TOOL_CHOICE_MAP[c.type] : undefined;
  if (mapped) {
    return mapped;
  }
  if (c.type === "tool" && typeof c.name === "string") {
    return { type: "function", function: { name: c.name } };
  }
  return choice;
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

function extractAssistantBlocks(content: readonly AnthropicContentBlock[]): {
  textContent: string;
  reasoningContent: string;
  toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
} {
  let textContent = "";
  let reasoningContent = "";
  const toolCalls: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> = [];

  for (const block of content) {
    if (block.type === "thinking") {
      reasoningContent += block.thinking || block.text || "";
    } else if (block.type === "text" && block.text) {
      textContent += block.text;
    }
    const tc = translateAssistantToolBlock(block);
    if (tc) {
      toolCalls.push(tc);
    }
  }
  return { textContent, reasoningContent, toolCalls };
}

function translateAssistantMessage(msg: AnthropicMessage): OpenAIMessage {
  if (typeof msg.content === "string") {
    return { role: "assistant", content: msg.content } as OpenAIMessage;
  }
  if (!Array.isArray(msg.content)) {
    return { role: "assistant", content: null } as OpenAIMessage;
  }

  const { textContent, reasoningContent, toolCalls } = extractAssistantBlocks(msg.content);
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

function translateImageSource(source: AnthropicImageSource): { type: "image_url"; image_url: { url: string } } | null {
  if (source.type === "base64" && source.data) {
    const mediaType = source.media_type || "image/jpeg";
    return {
      type: "image_url",
      image_url: { url: `data:${mediaType};base64,${source.data}` },
    };
  }
  if (source.type === "url" && source.url) {
    return {
      type: "image_url",
      image_url: { url: source.url },
    };
  }
  return null;
}

function translateUserContentBlock(block: AnthropicContentBlock): unknown | null {
  if (block.type === "text" && block.text) {
    return { type: "text", text: block.text };
  }
  if (block.type === "image" && block.source) {
    return translateImageSource(block.source);
  }
  return null;
}

function processUserBlocks(blocks: readonly AnthropicContentBlock[], outMessages: OpenAIMessage[]): unknown[] {
  const userParts: unknown[] = [];
  for (const block of blocks) {
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
  return userParts;
}

function translateUserMessage(msg: AnthropicMessage, outMessages: OpenAIMessage[]): void {
  if (typeof msg.content === "string") {
    outMessages.push({ role: "user", content: msg.content } as OpenAIMessage);
    return;
  }
  if (!Array.isArray(msg.content)) {
    return;
  }

  const userParts = processUserBlocks(msg.content, outMessages);
  if (userParts.length === 1 && (userParts[0] as { type?: string }).type === "text") {
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

function applyToolChoiceSettings(req: AnthropicMessagesRequest, result: Record<string, unknown>): void {
  if (req.tool_choice !== undefined) {
    result.tool_choice = translateToolChoice(req.tool_choice);
    if (typeof req.tool_choice === "object" && req.tool_choice !== null) {
      const tc = req.tool_choice as Record<string, unknown>;
      if (tc.disable_parallel_tool_use) {
        result.parallel_tool_calls = false;
      }
    }
  }
}

function copyAllowedOpenAiKeys(req: AnthropicMessagesRequest, result: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(req)) {
    if (ALLOWED_OPENAI_KEYS.has(key) && result[key] === undefined && value !== undefined) {
      result[key] = value;
    }
  }
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

  applyToolChoiceSettings(req, result);
  copyAllowedOpenAiKeys(req, result);

  return result as unknown as OpenAIRequestPayload;
}

function parseToolCallArguments(args?: string): unknown {
  if (!args) return {};
  try {
    return JSON.parse(args);
  } catch {
    return { raw: args };
  }
}

function extractToolUseBlocks(toolCalls?: Array<{
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}>): AnthropicContentBlock[] {
  if (!Array.isArray(toolCalls)) return [];
  const blocks: AnthropicContentBlock[] = [];
  for (const tc of toolCalls) {
    if (tc.function?.name) {
      blocks.push({
        type: "tool_use",
        id: tc.id || `call_${Math.random().toString(36).slice(2, 10)}`,
        name: tc.function.name,
        input: parseToolCallArguments(tc.function.arguments),
      });
    }
  }
  return blocks;
}

function extractTextContent(content?: string | Array<{ type?: string; text?: string }> | null): string {
  if (typeof content === "string") {
    return stripLeakedTemplateTags(content);
  }
  if (Array.isArray(content)) {
    return stripLeakedTemplateTags(
      content
        .filter((p) => p?.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("")
    );
  }
  return "";
}

function extractMessageContentBlocks(msg?: {
  content?: string | Array<{ type?: string; text?: string }> | null;
  reasoning_content?: string | null;
  reasoning?: string | null;
  tool_calls?: Array<{
    id?: string;
    type?: string;
    function?: { name?: string; arguments?: string };
  }>;
}): AnthropicContentBlock[] {
  const blocks: AnthropicContentBlock[] = [];
  const reasoning = msg?.reasoning_content || msg?.reasoning;
  if (typeof reasoning === "string" && reasoning.length > 0) {
    const cleaned = stripLeakedTemplateTags(reasoning);
    if (cleaned.length > 0) {
      blocks.push({ type: "thinking", thinking: cleaned } as AnthropicContentBlock);
    }
  }

  const textContent = extractTextContent(msg?.content);
  if (textContent.length > 0) {
    blocks.push({ type: "text", text: textContent });
  }

  const toolBlocks = extractToolUseBlocks(msg?.tool_calls);
  blocks.push(...toolBlocks);

  if (blocks.length === 0) {
    blocks.push({ type: "text", text: "" });
  }
  return blocks;
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
  const contentBlocks = extractMessageContentBlocks(firstChoice?.message);
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
  fallbackModel: string,
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  if (!state.msgStartSent) {
    state.msgStartSent = true;
    const msgId = (parsed.id as string) || `msg_${Math.random().toString(36).slice(2, 11)}`;
    const effectiveModel = (typeof parsed.model === "string" && parsed.model.length > 0)
      ? parsed.model
      : fallbackModel;
    controller.enqueue(
      sseEvent(encoder, "message_start", {
        type: "message_start",
        message: {
          id: msgId,
          type: "message",
          role: "assistant",
          content: [],
          model: effectiveModel,
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

function flushTrailingBlockDelta(
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
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
}

function closeCurrentBlock(
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  if (state.currentBlockType !== null && state.openBlockIndices.has(state.currentBlockIndex)) {
    flushTrailingBlockDelta(state, controller, encoder);
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

function startToolCallBlock(
  tc: { id?: string; function?: { name?: string; arguments?: string } },
  tcIdx: number,
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): ActiveToolInfo {
  closeCurrentBlock(state, controller, encoder);
  state.currentBlockIndex++;
  state.currentBlockType = "tool_use";
  state.openBlockIndices.add(state.currentBlockIndex);
  const toolId = tc.id || `call_${Math.random().toString(36).slice(2, 10)}`;
  const toolName = tc.function?.name || "tool";
  const toolInfo: ActiveToolInfo = { blockIndex: state.currentBlockIndex, id: toolId, name: toolName };
  state.activeToolMap.set(tcIdx, toolInfo);

  controller.enqueue(
    sseEvent(encoder, "content_block_start", {
      type: "content_block_start",
      index: state.currentBlockIndex,
      content_block: { type: "tool_use", id: toolId, name: toolName, input: {} },
    })
  );
  return toolInfo;
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
      toolInfo = startToolCallBlock(tc, tcIdx, state, controller, encoder);
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

function updateUsageTokens(parsed: Record<string, unknown>, state: StreamTransformState): void {
  if (parsed.usage && typeof parsed.usage === "object") {
    const u = parsed.usage as Record<string, unknown>;
    if (typeof u.prompt_tokens === "number") state.accumulatedInputTokens = u.prompt_tokens;
    if (typeof u.completion_tokens === "number") state.accumulatedOutputTokens = u.completion_tokens;
  }
}

function handleSseErrorChunk(
  parsed: Record<string, unknown>,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): boolean {
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
    return true;
  }
  return false;
}

interface StreamProcessorContext {
  readonly state: StreamTransformState;
  readonly fallbackModel: string;
  readonly telemetry?: RequestTelemetry;
  ttftMarked: boolean;
}

function checkAndMarkTtft(
  ctx: StreamProcessorContext,
  choice?: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{ id?: string; function?: { name?: string } }>;
    };
  }
): void {
  if (ctx.ttftMarked || !choice?.delta) {
    return;
  }
  const hasContent = Boolean(choice.delta.content && choice.delta.content.length > 0);
  const hasReasoning = Boolean((choice.delta.reasoning_content || choice.delta.reasoning));
  const hasTools = Boolean(choice.delta.tool_calls && choice.delta.tool_calls.length > 0);

  if (hasContent || hasReasoning || hasTools) {
    ctx.ttftMarked = true;
    ctx.telemetry?.markTtft?.();
  }
}

function processChoiceDeltas(
  choice: {
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  },
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
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
}

function handleMissingChoice(
  parsed: Record<string, unknown>,
  state: StreamTransformState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
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
}

function processParsedChunk(
  rawData: string,
  parsed: Record<string, unknown>,
  ctx: StreamProcessorContext,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  if (handleSseErrorChunk(parsed, controller, encoder)) {
    return;
  }
  if (handleNativeAnthropicPassThrough(rawData, parsed, controller, encoder)) {
    return;
  }

  updateUsageTokens(parsed, ctx.state);
  ensureMessageStart(parsed, ctx.fallbackModel, ctx.state, controller, encoder);

  const choices = parsed.choices as Array<{
    delta?: {
      content?: string | null;
      reasoning_content?: string | null;
      reasoning?: string | null;
      tool_calls?: Array<{ index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string | null;
  }> | undefined;

  const choice = choices?.[0];
  if (!choice) {
    handleMissingChoice(parsed, ctx.state, controller, encoder);
    return;
  }

  checkAndMarkTtft(ctx, choice);
  processChoiceDeltas(choice, ctx.state, controller, encoder);
}

function parseSseDataLine(rawLine: string): string | null {
  const line = rawLine.trim();
  if (!line || line.startsWith(":")) {
    return null;
  }
  const dataMatch = line.match(/^data:\s*(.*)$/);
  if (!dataMatch || dataMatch[1] === undefined) {
    return null;
  }
  const rawData = dataMatch[1].trim();
  if (!rawData || rawData === "[DONE]") {
    return null;
  }
  return rawData;
}

export function createAnthropicXWireStreamTransformer(
  telemetry?: RequestTelemetry,
  clientSignal?: AbortSignal,
  fallbackModel = "unknown"
): TransformStream<Uint8Array, Uint8Array> {
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

  const ctx: StreamProcessorContext = {
    state,
    fallbackModel,
    telemetry,
    ttftMarked: false,
  };

  let buffer = "";

  const processLine = (rawLine: string, controller: TransformStreamDefaultController<Uint8Array>) => {
    const rawData = parseSseDataLine(rawLine);
    if (!rawData) {
      return;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawData) as Record<string, unknown>;
    } catch {
      return;
    }
    processParsedChunk(rawData, parsed, ctx, controller, encoder);
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (clientSignal?.aborted) {
        return;
      }
      buffer += decoder.decode(chunk, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        processLine(line, controller);
      }
    },
    flush(controller) {
      if (clientSignal?.aborted) {
        return;
      }
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

      const record: UsageRecord = {
        promptTokens: state.accumulatedInputTokens,
        completionTokens: state.accumulatedOutputTokens,
        totalTokens: state.accumulatedInputTokens + state.accumulatedOutputTokens,
        finishReason: state.pendingStopReason || "end_turn",
      };
      telemetry?.recordUsage?.(record);
    },
  });
}

export class AnthropicOpenAIXWireTransformer implements PayloadTransformerContract {
  transformClientToWire(
    inboundBody: Record<string, unknown>,
    _directive: ParsedDirective,
    _headers: Headers
  ): OutboundWirePayload {
    const openAiPayload = translateAnthropicToOpenAI(inboundBody as unknown as AnthropicMessagesRequest);
    return {
      endpointKey: "ch",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: openAiPayload as Record<string, unknown>,
      isStreaming: Boolean(inboundBody.stream),
    };
  }

  transformWireToClient(
    upstreamJson: unknown,
    _directive: ParsedDirective
  ): unknown {
    const jsonRec = typeof upstreamJson === "object" && upstreamJson !== null
      ? (upstreamJson as Record<string, unknown>)
      : {};
    const model = typeof jsonRec.model === "string" ? jsonRec.model : "unknown";
    return translateOpenAIToAnthropicResponse(jsonRec, model);
  }

  createWireToClientStream(
    _directive: ParsedDirective,
    telemetry: RequestTelemetry,
    clientSignal: AbortSignal
  ): TransformStream<Uint8Array, Uint8Array> {
    return createAnthropicXWireStreamTransformer(telemetry, clientSignal);
  }
}

export const anthropicOpenAiXWireTransformer = new AnthropicOpenAIXWireTransformer();
