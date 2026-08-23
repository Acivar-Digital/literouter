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

function hasMeaningfulDeltaFields(delta: Record<string, unknown>): boolean {
  return (
    delta.content !== undefined ||
    delta.tool_calls !== undefined ||
    delta.role !== undefined ||
    delta.refusal !== undefined
  );
}

function sanitizeDelta(rawDelta: unknown): { delta: Record<string, unknown>; hasContent: boolean } {
  if (typeof rawDelta !== "object" || rawDelta === null) {
    return { delta: {}, hasContent: false };
  }
  const delta: Record<string, unknown> = { ...(rawDelta as Record<string, unknown>) };
  delete delta.reasoning;
  delete delta.reasoning_content;
  delete delta.reasoning_details;
  return { delta, hasContent: hasMeaningfulDeltaFields(delta) };
}

function filterReasoningFromChoice(rawChoice: unknown): { choice: Record<string, unknown>; hasData: boolean } {
  if (typeof rawChoice !== "object" || rawChoice === null) {
    return { choice: {}, hasData: false };
  }
  const choice: Record<string, unknown> = { ...(rawChoice as Record<string, unknown>) };
  delete choice.reasoning_content;
  delete choice.reasoning;
  delete choice.reasoning_details;

  let hasData = choice.finish_reason !== null && choice.finish_reason !== undefined;

  if (choice.delta) {
    const { delta, hasContent } = sanitizeDelta(choice.delta);
    choice.delta = delta;
    if (hasContent) {
      hasData = true;
    }
  }

  return { choice, hasData };
}

export function filterReasoningFromChunk(data: Record<string, unknown>): {
  filteredData: Record<string, unknown>;
  shouldEmit: boolean;
} {
  const filtered: Record<string, unknown> = { ...data };
  delete filtered.reasoning_content;
  delete filtered.reasoning;
  delete filtered.reasoning_details;

  let shouldEmit = filtered.usage != null || filtered.error != null;

  if (Array.isArray(filtered.choices)) {
    const newChoices: Record<string, unknown>[] = [];
    for (const rawChoice of filtered.choices) {
      const { choice, hasData } = filterReasoningFromChoice(rawChoice);
      if (hasData) {
        shouldEmit = true;
      }
      newChoices.push(choice);
    }
    filtered.choices = newChoices;
  }

  return { filteredData: filtered, shouldEmit };
}

function processSseDataLine(line: string): string | null {
  const jsonStr = line.slice(6);
  try {
    const data = JSON.parse(jsonStr) as Record<string, unknown>;
    const { filteredData, shouldEmit } = filterReasoningFromChunk(data);
    if (!shouldEmit) {
      return null;
    }
    return `data: ${JSON.stringify(filteredData)}\n`;
  } catch (err: unknown) {
    void err;
    return line + "\n";
  }
}

export function createOpenCodeReasoningFilterStreamTransformer(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let lineBuffer = "";

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      lineBuffer += decoder.decode(chunk, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":") || trimmed === "data: [DONE]") {
          controller.enqueue(encoder.encode(line + "\n"));
          continue;
        }
        if (trimmed.startsWith("data: ")) {
          const transformed = processSseDataLine(trimmed);
          if (transformed) {
            controller.enqueue(encoder.encode(transformed));
          }
        } else {
          controller.enqueue(encoder.encode(line + "\n"));
        }
      }
    },
    flush(controller) {
      if (lineBuffer.length > 0) {
        const trimmed = lineBuffer.trim();
        if (trimmed.startsWith("data: ") && trimmed !== "data: [DONE]") {
          const transformed = processSseDataLine(trimmed);
          if (transformed) {
            controller.enqueue(encoder.encode(transformed));
          }
        } else {
          controller.enqueue(encoder.encode(lineBuffer));
        }
      }
    },
  });
}
