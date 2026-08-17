import type { OpenAIMessage, OpenAIRequestPayload, OpenAIToolCall } from "./nuances";

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
  const directSig = extractFromExtraContent(obj);
  if (directSig) {
    return directSig;
  }
  return extractFromCandidates(obj);
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
