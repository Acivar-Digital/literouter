import type {
  OpenAIContentPart,
  OpenAIMessage,
} from "./nuances";
import { logFinishReason } from "../ui/logger";

export const REASONING_KEYS: readonly string[] = Object.freeze([
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

function stripReasoningFromChoiceObject(choice: Record<string, unknown>): void {
  deleteReasoningKeys(choice);
  if (choice.message && typeof choice.message === "object" && choice.message !== null) {
    deleteReasoningKeys(choice.message as Record<string, unknown>);
  }
  if (choice.delta && typeof choice.delta === "object" && choice.delta !== null) {
    deleteReasoningKeys(choice.delta as Record<string, unknown>);
  }
}

export function stripReasoningFromResponseBody(json: Record<string, unknown>): void {
  deleteReasoningKeys(json);
  if (!Array.isArray(json.choices)) {
    return;
  }
  for (const rawChoice of json.choices as Array<Record<string, unknown>>) {
    if (typeof rawChoice === "object" && rawChoice !== null) {
      stripReasoningFromChoiceObject(rawChoice);
    }
  }
}

function isReasoningContentPart(part: OpenAIContentPart | Record<string, unknown>): boolean {
  if (typeof part !== "object" || part === null) {
    return false;
  }
  const partType = typeof part.type === "string" ? part.type.toLowerCase() : "";
  if (partType === "reasoning" || partType === "thought" || partType === "thinking") {
    return true;
  }
  return (
    part.reasoningDetails !== undefined ||
    part.reasoning_details !== undefined ||
    part.reasoningField !== undefined ||
    part.reasoning_field !== undefined ||
    part.reasoning !== undefined ||
    part.thought !== undefined ||
    part.thinking !== undefined
  );
}

function normalizeCleanedParts(
  parts: readonly OpenAIContentPart[]
): string | readonly OpenAIContentPart[] {
  if (parts.length === 0) {
    return "";
  }
  const first = parts[0];
  if (parts.length === 1 && first && first.type === "text" && typeof first.text === "string") {
    return first.text;
  }
  return parts;
}

function extractToolPartText(part: unknown): string {
  if (typeof part === "string") {
    return part;
  }
  if (typeof part === "object" && part !== null) {
    const textVal = (part as Record<string, unknown>).text;
    if (typeof textVal === "string" && textVal.length > 0) {
      return textVal;
    }
    return JSON.stringify(part);
  }
  return String(part ?? "");
}

export function normalizeToolContent(content: unknown): string {
  if (Array.isArray(content)) {
    return content.map(extractToolPartText).join("\n");
  }
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return "";
  }
  return String(content);
}

export function stripToolMetadata(cleaned: Record<string, unknown>): void {
  delete cleaned.id;
  delete cleaned.name;
  delete cleaned.providerState;
  delete cleaned.state;
  delete cleaned.createdAt;
}

export function stripClientMetadata(cleaned: Record<string, unknown>): void {
  delete cleaned.id;
  delete cleaned.providerState;
  delete cleaned.state;
  delete cleaned.reasoning_details;
}

function scrubMessageContent(cleaned: Record<string, unknown>): void {
  if (cleaned.role === "tool") {
    cleaned.content = normalizeToolContent(cleaned.content);
    stripToolMetadata(cleaned);
    return;
  }

  if (cleaned.role === "assistant" || cleaned.role === "user") {
    stripClientMetadata(cleaned);
  }

  if (cleaned.role === "assistant" && typeof cleaned.content === "string") {
    let content = cleaned.content
      .replace(/<(?:think|thought|thinking)>[\s\S]*?<\/(?:think|thought|thinking)>/gi, "");
    if (Array.isArray(cleaned.tool_calls) && cleaned.tool_calls.length > 0) {
      content = content
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/gi, "")
        .replace(/<invoke[\s\S]*?<\/invoke>/gi, "")
        .replace(/<function=[a-zA-Z0-9_\-]+>[\s\S]*?<\/function>/gi, "")
        .replace(/(?:^|[^\w>])[a-zA-Z0-9_\-]+\s*<(?:arg_key|argument_name|parameter_name)>[\s\S]*?<\/(?:arg_value|argument_value|parameter_value)>\s*(?:<\/tool_call>)?/gi, "");
    }
    content = content
      .replace(/<\/?(?:tool_calls?|function_calls?|invoke|tool_call|function_call|function|parameter|arg_key|arg_value|parameter_value|argument_name|argument_value|parameter_name)[^>]*>/gi, "")
      .trim();
    cleaned.content = content;
  }

  if (Array.isArray(cleaned.content)) {
    const rawParts = cleaned.content as readonly OpenAIContentPart[];
    const nonReasoningParts = rawParts.filter((p) => !isReasoningContentPart(p));
    cleaned.content = normalizeCleanedParts(nonReasoningParts);
  }
}

export function scrubReasoningFromMessage(msg: OpenAIMessage): OpenAIMessage {
  const cleaned: Record<string, unknown> = { ...msg };

  deleteReasoningKeys(cleaned);
  scrubMessageContent(cleaned);

  return cleaned as unknown as OpenAIMessage;
}

export function scrubReasoningFromMessages(
  messages: readonly OpenAIMessage[] | undefined
): readonly OpenAIMessage[] {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages.map(scrubReasoningFromMessage);
}
