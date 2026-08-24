import type { OpenAIMessage, OpenAIRequestPayload, OpenAIToolCall } from "./nuances";
import { logFinishReason } from "../ui/logger";

const THOUGHT_SIGNATURE_STORE = new Map<string, string>();

export function storeThoughtSignature(toolCallId: string, signature: string): void {
  if (toolCallId && signature) {
    THOUGHT_SIGNATURE_STORE.set(toolCallId, signature);
  }
}

export function getThoughtSignature(toolCallId: string): string | undefined {
  return THOUGHT_SIGNATURE_STORE.get(toolCallId);
}

export function clearThoughtSignatures(): void {
  THOUGHT_SIGNATURE_STORE.clear();
}

function extractFromExtraContent(obj: Record<string, unknown>): string | undefined {
  const extra = obj.extra_content as Record<string, unknown> | undefined;
  if (!extra) {
    return undefined;
  }
  const google = extra.google as Record<string, unknown> | undefined;
  if (!google) {
    return undefined;
  }
  const sig = google.thought_signature;
  return typeof sig === "string" ? sig : undefined;
}

function extractFromCandidates(obj: Record<string, unknown>): string | undefined {
  const candidates = obj.candidates as readonly Record<string, unknown>[] | undefined;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return undefined;
  }
  const first = candidates[0];
  if (!first) {
    return undefined;
  }
  return extractFromExtraContent(first);
}

export function extractThoughtSignature(responseObj: unknown): string | undefined {
  if (typeof responseObj !== "object" || responseObj === null) {
    return undefined;
  }
  const obj = responseObj as Record<string, unknown>;
  return extractFromExtraContent(obj) ?? extractFromCandidates(obj);
}

function patchToolCallWithSignature(toolCall: OpenAIToolCall): OpenAIToolCall {
  const existingSig = getThoughtSignature(toolCall.id);
  if (!existingSig) {
    return toolCall;
  }
  return {
    ...toolCall,
    extra_content: {
      ...toolCall.extra_content,
      google: {
        thought_signature: existingSig,
      },
    },
  };
}

function patchAssistantMessageSignatures(msg: OpenAIMessage): OpenAIMessage {
  if (msg.role !== "assistant" || !msg.tool_calls || msg.tool_calls.length === 0) {
    return msg;
  }
  return {
    ...msg,
    tool_calls: msg.tool_calls.map(patchToolCallWithSignature),
  };
}

export function injectThoughtSignatures(
  messages: readonly OpenAIMessage[]
): readonly OpenAIMessage[] {
  return messages.map(patchAssistantMessageSignatures);
}

export function stripReasoningParameters(
  payload: Record<string, unknown>
): Record<string, unknown> {
  const cleaned = { ...payload };
  delete cleaned.thinking;
  delete cleaned.thinkingConfig;
  delete cleaned.thinking_config;
  delete cleaned.reasoning_effort;
  delete cleaned.budget_tokens;
  return cleaned;
}

export function shouldStripReasoning(
  globalStrip: boolean,
  nuances: readonly string[]
): boolean {
  if (nuances.includes("ts")) {
    return false;
  }
  if (nuances.includes("sb")) {
    return true;
  }
  return globalStrip;
}

export interface StreamThinkingState {
  isInThinkTag: boolean;
  bufferedText: string;
}

export function createStreamThinkingState(): StreamThinkingState {
  return {
    isInThinkTag: false,
    bufferedText: "",
  };
}

function formatAnthropicThinkingDelta(text: string): string {
  const event = {
    type: "content_block_delta",
    index: 0,
    delta: {
      type: "thinking_delta",
      thinking: text,
    },
  };
  return `event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`;
}

function formatAnthropicTextDelta(text: string): string {
  const event = {
    type: "content_block_delta",
    index: 1,
    delta: {
      type: "text_delta",
      text: text,
    },
  };
  return `event: content_block_delta\ndata: ${JSON.stringify(event)}\n\n`;
}

function processTagOpen(
  text: string,
  state: StreamThinkingState,
  preserveThinking: boolean
): string {
  const parts = text.split("<think>");
  const before = parts[0] ?? "";
  const after = parts.slice(1).join("<think>");
  state.isInThinkTag = true;

  let out = "";
  if (before.length > 0) {
    out += formatAnthropicTextDelta(before);
  }
  if (after.length > 0 && preserveThinking) {
    out += formatAnthropicThinkingDelta(after);
  }
  return out;
}

function processTagClose(
  text: string,
  state: StreamThinkingState,
  preserveThinking: boolean
): string {
  const parts = text.split("</think>");
  const thinkPart = parts[0] ?? "";
  const textPart = parts.slice(1).join("</think>");
  state.isInThinkTag = false;

  let out = "";
  if (thinkPart.length > 0 && preserveThinking) {
    out += formatAnthropicThinkingDelta(thinkPart);
  }
  if (textPart.length > 0) {
    out += formatAnthropicTextDelta(textPart);
  }
  return out;
}

function appendThinkingIfPreserved(out: string, thinkPart: string, preserveThinking: boolean): string {
  if (thinkPart.length > 0 && preserveThinking) {
    return out + formatAnthropicThinkingDelta(thinkPart);
  }
  return out;
}

function processFullThinkTag(
  text: string,
  preserveThinking: boolean
): string {
  const parts = text.split("<think>");
  const before = parts[0] ?? "";
  const rest = parts.slice(1).join("<think>");
  const closeParts = rest.split("</think>");
  const thinkPart = closeParts[0] ?? "";
  const after = closeParts.slice(1).join("</think>");

  let out = before.length > 0 ? formatAnthropicTextDelta(before) : "";
  out = appendThinkingIfPreserved(out, thinkPart, preserveThinking);
  if (after.length > 0) {
    out += formatAnthropicTextDelta(after);
  }
  return out;
}

function formatDefaultDelta(
  chunk: string,
  state: StreamThinkingState,
  preserveThinking: boolean
): string {
  if (state.isInThinkTag) {
    return preserveThinking ? formatAnthropicThinkingDelta(chunk) : "";
  }
  return formatAnthropicTextDelta(chunk);
}

export function processThinkingDelta(
  chunk: string,
  state: StreamThinkingState,
  preserveThinking: boolean
): string {
  const hasOpen = chunk.includes("<think>");
  const hasClose = chunk.includes("</think>");

  if (hasOpen && hasClose) {
    state.isInThinkTag = false;
    return processFullThinkTag(chunk, preserveThinking);
  }
  if (hasOpen) {
    return processTagOpen(chunk, state, preserveThinking);
  }
  if (hasClose) {
    return processTagClose(chunk, state, preserveThinking);
  }
  return formatDefaultDelta(chunk, state, preserveThinking);
}

const REASONING_KEYS: readonly string[] = Object.freeze([
  "reasoning",
  "reasoning_content",
  "reasoning_details",
  "reasoningDetails",
  "thought",
  "thoughts",
  "thinking",
  "thinking_content",
  "think",
]);

export function deleteReasoningKeys(target: Record<string, unknown>): void {
  for (const key of REASONING_KEYS) {
    delete target[key];
  }
}

export function isOpenCodeClient(
  userAgent?: string | null,
  headers?: Headers | Record<string, string | string[] | undefined> | null,
  nuances?: readonly string[]
): boolean {
  if (nuances && nuances.includes("ts")) {
    return false;
  }
  if (nuances && nuances.includes("sb")) {
    return true;
  }
  if (userAgent && userAgent.toLowerCase().includes("opencode")) {
    return true;
  }
  if (!headers) {
    return false;
  }
  if (headers instanceof Headers) {
    if (headers.has("x-opencode")) {
      return true;
    }
    const clientName = headers.get("x-client-name");
    return Boolean(clientName && clientName.toLowerCase().includes("opencode"));
  }
  if (headers["x-opencode"] !== undefined) {
    return true;
  }
  const clientName = headers["x-client-name"];
  return typeof clientName === "string" && clientName.toLowerCase().includes("opencode");
}

export function hasMeaningfulDeltaFields(delta: Record<string, unknown>): boolean {
  const hasContent = typeof delta.content === "string" && delta.content.length > 0;
  const hasToolCalls = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;
  const hasRole = typeof delta.role === "string" && delta.role.length > 0;
  const hasRefusal = typeof delta.refusal === "string" && delta.refusal.length > 0;
  const hasFunctionCall = typeof delta.function_call === "object" && delta.function_call !== null;
  return hasContent || hasToolCalls || hasRole || hasRefusal || hasFunctionCall;
}

export function sanitizeDelta(rawDelta: unknown): { delta: Record<string, unknown>; hasContent: boolean } {
  if (typeof rawDelta !== "object" || rawDelta === null) {
    return { delta: {}, hasContent: false };
  }
  const delta: Record<string, unknown> = { ...(rawDelta as Record<string, unknown>) };
  deleteReasoningKeys(delta);

  if (delta.content === null || delta.content === undefined) {
    delete delta.content;
  }
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length === 0) {
    delete delta.tool_calls;
  }

  return { delta, hasContent: hasMeaningfulDeltaFields(delta) };
}

export function filterReasoningFromChoice(
  rawChoice: unknown,
  reqId?: string
): { choice: Record<string, unknown>; hasData: boolean } {
  if (typeof rawChoice !== "object" || rawChoice === null) {
    return { choice: {}, hasData: false };
  }
  const choice: Record<string, unknown> = { ...(rawChoice as Record<string, unknown>) };
  deleteReasoningKeys(choice);

  let hasData = choice.finish_reason !== null && choice.finish_reason !== undefined;
  if (typeof choice.finish_reason === "string" && choice.finish_reason.length > 0) {
    logFinishReason(reqId ?? "stream", choice.finish_reason);
  }

  if (choice.delta) {
    const { delta, hasContent } = sanitizeDelta(choice.delta);
    choice.delta = delta;
    if (hasContent) {
      hasData = true;
    }
  }

  return { choice, hasData };
}

function processChoices(
  rawChoices: readonly unknown[],
  reqId?: string
): { choices: Record<string, unknown>[]; hasChoiceData: boolean } {
  const choices: Record<string, unknown>[] = [];
  let hasChoiceData = false;
  for (const rawChoice of rawChoices) {
    const { choice, hasData } = filterReasoningFromChoice(rawChoice, reqId);
    if (hasData) {
      hasChoiceData = true;
    }
    choices.push(choice);
  }
  return { choices, hasChoiceData };
}

export function filterReasoningFromChunk(
  data: Record<string, unknown>,
  reqId?: string
): {
  filteredData: Record<string, unknown>;
  shouldEmit: boolean;
} {
  const filtered: Record<string, unknown> = { ...data };
  deleteReasoningKeys(filtered);

  let shouldEmit = filtered.usage != null || filtered.error != null;

  if (Array.isArray(filtered.choices)) {
    const { choices, hasChoiceData } = processChoices(filtered.choices, reqId);
    filtered.choices = choices;
    if (hasChoiceData) {
      shouldEmit = true;
    }
  }

  return { filteredData: filtered, shouldEmit };
}

export function sanitizeRawControlChars(rawJsonStr: string): string {
  return rawJsonStr.replace(/\r/g, "\\r");
}

export function createSyntheticHeartbeatChunk(): string {
  const heartbeatPayload = {
    id: "chatcmpl-heartbeat",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "heartbeat",
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: null,
      },
    ],
  };
  return `data: ${JSON.stringify(heartbeatPayload)}\n\n`;
}

function extractJsonFromSseLine(trimmed: string): string {
  return trimmed.slice(5).trim();
}

export function processSseDataLine(line: string, reqId?: string): string | null {
  const jsonStr = extractJsonFromSseLine(line);
  try {
    const sanitized = sanitizeRawControlChars(jsonStr);
    const data = JSON.parse(sanitized) as Record<string, unknown>;
    const { filteredData, shouldEmit } = filterReasoningFromChunk(data, reqId);
    if (!shouldEmit) {
      return null;
    }
    return `data: ${JSON.stringify(filteredData)}`;
  } catch (_err: unknown) {
    void _err;
    return line;
  }
}

export const FILTER_HEARTBEAT_INTERVAL_MS = 5000;

export interface FilterTransformerState {
  lastEmittedTime: number;
  readonly reqId?: string;
}

function handleSuppressedChunk(
  state: FilterTransformerState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  const now = Date.now();
  if (now - state.lastEmittedTime >= FILTER_HEARTBEAT_INTERVAL_MS) {
    controller.enqueue(encoder.encode(createSyntheticHeartbeatChunk()));
    state.lastEmittedTime = now;
  }
}

function handleDataLine(
  trimmed: string,
  state: FilterTransformerState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  const transformed = processSseDataLine(trimmed, state.reqId);
  if (transformed) {
    controller.enqueue(encoder.encode(transformed + "\n\n"));
    state.lastEmittedTime = Date.now();
  } else {
    handleSuppressedChunk(state, controller, encoder);
  }
}

function handleSseLine(
  line: string,
  state: FilterTransformerState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  if (trimmed.startsWith(":")) {
    controller.enqueue(encoder.encode(trimmed + "\n\n"));
    controller.enqueue(encoder.encode(createSyntheticHeartbeatChunk()));
    state.lastEmittedTime = Date.now();
    return;
  }

  if (trimmed === "data: [DONE]" || trimmed === "data:[DONE]") {
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    state.lastEmittedTime = Date.now();
    return;
  }

  if (trimmed.startsWith("data:")) {
    handleDataLine(trimmed, state, controller, encoder);
    return;
  }

  controller.enqueue(encoder.encode(trimmed + "\n\n"));
  state.lastEmittedTime = Date.now();
}

function flushRemainingBuffer(
  lineBuffer: string,
  state: FilterTransformerState,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  const trimmed = lineBuffer.trim();
  if (!trimmed) {
    return;
  }
  if (trimmed.startsWith("data:") && trimmed !== "data: [DONE]" && trimmed !== "data:[DONE]") {
    const transformed = processSseDataLine(trimmed, state.reqId);
    if (transformed) {
      controller.enqueue(encoder.encode(transformed + "\n\n"));
      state.lastEmittedTime = Date.now();
    }
    return;
  }
  controller.enqueue(encoder.encode(trimmed + "\n\n"));
  state.lastEmittedTime = Date.now();
}

export function createOpenCodeReasoningFilterStreamTransformer(
  reqId?: string
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const encoder = new TextEncoder();
  let lineBuffer = "";
  const state: FilterTransformerState = {
    lastEmittedTime: Date.now(),
    reqId,
  };

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        handleSseLine(line, state, controller, encoder);
      }
    },
    flush(controller) {
      if (lineBuffer.length > 0) {
        flushRemainingBuffer(lineBuffer, state, controller, encoder);
        lineBuffer = "";
      }
    },
  });
}
