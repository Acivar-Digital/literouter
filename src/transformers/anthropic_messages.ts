import type { ParsedDirective } from "../directive/types";
import type { OutboundWirePayload, PayloadTransformerContract } from "../engine/transformer";
import type { RequestTelemetry, UsageRecord } from "../telemetry/session";

interface SseParsedMessage {
  readonly eventType: string;
  readonly data: Record<string, unknown> | null;
}

interface ExtractBlockResult {
  readonly eventBlock: string | null;
  readonly remaining: string;
}

interface UsageState {
  promptTokens: number;
  completionTokens: number;
  reasoningTokens?: number;
  finishReason: string | null;
  hasRecordedUsage: boolean;
}

function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const val = JSON.parse(text);
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return val as Record<string, unknown>;
    }
    return null;
  } catch (_err) {
    return null;
  }
}

function parseSseBlock(block: string): SseParsedMessage {
  let eventType = "";
  const dataLines: string[] = [];
  const lines = block.split("\n");

  for (const rawLine of lines) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line.startsWith("event:")) {
      eventType = line.slice(6).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) {
    return { eventType, data: null };
  }

  const jsonStr = dataLines.join("\n");
  const data = safeJsonParse(jsonStr);
  const effectiveType = eventType || (typeof data?.type === "string" ? data.type : "");

  return { eventType: effectiveType, data };
}

function extractNextEventBlock(currentBuffer: string): ExtractBlockResult {
  const lfIndex = currentBuffer.indexOf("\n\n");
  const crlfIndex = currentBuffer.indexOf("\r\n\r\n");
  if (lfIndex === -1 && crlfIndex === -1) {
    return { eventBlock: null, remaining: currentBuffer };
  }

  if (crlfIndex !== -1 && (lfIndex === -1 || crlfIndex < lfIndex)) {
    return {
      eventBlock: currentBuffer.slice(0, crlfIndex),
      remaining: currentBuffer.slice(crlfIndex + 4),
    };
  }

  return {
    eventBlock: currentBuffer.slice(0, lfIndex),
    remaining: currentBuffer.slice(lfIndex + 2),
  };
}

function drainEventBlocks(
  initialBuffer: string,
  onBlock: (block: string) => void
): string {
  let cur = initialBuffer;
  while (true) {
    const result = extractNextEventBlock(cur);
    if (result.eventBlock === null) {
      break;
    }
    cur = result.remaining;
    onBlock(result.eventBlock);
  }
  return cur;
}

function extractStartUsage(data: Record<string, unknown>, state: UsageState): void {
  const msg = data.message;
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) {
    return;
  }
  const u = (msg as Record<string, unknown>).usage;
  if (!u || typeof u !== "object" || Array.isArray(u)) {
    return;
  }
  const usageObj = u as Record<string, unknown>;
  if (typeof usageObj.input_tokens === "number") {
    state.promptTokens = usageObj.input_tokens;
  }
  if (typeof usageObj.output_tokens === "number") {
    state.completionTokens = usageObj.output_tokens;
  }
}

function extractReasoningTokens(usageObj: Record<string, unknown>, state: UsageState): void {
  const details = usageObj.output_tokens_details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const detailsObj = details as Record<string, unknown>;
    if (typeof detailsObj.thinking_tokens === "number") {
      state.reasoningTokens = detailsObj.thinking_tokens;
      return;
    }
  }
  if (typeof usageObj.thinking_tokens === "number") {
    state.reasoningTokens = usageObj.thinking_tokens;
  }
}

function extractDeltaUsage(data: Record<string, unknown>, state: UsageState): void {
  const u = data.usage;
  if (u && typeof u === "object" && !Array.isArray(u)) {
    const usageObj = u as Record<string, unknown>;
    if (typeof usageObj.output_tokens === "number") {
      state.completionTokens = usageObj.output_tokens;
    }
    if (typeof usageObj.input_tokens === "number") {
      state.promptTokens = usageObj.input_tokens;
    }
    extractReasoningTokens(usageObj, state);
  }

  const delta = data.delta;
  if (delta && typeof delta === "object" && !Array.isArray(delta)) {
    const deltaObj = delta as Record<string, unknown>;
    if (typeof deltaObj.stop_reason === "string") {
      state.finishReason = deltaObj.stop_reason;
    }
  }
}

function emitUsage(telemetry: RequestTelemetry, state: UsageState): void {
  state.hasRecordedUsage = true;
  const record: UsageRecord = {
    promptTokens: state.promptTokens,
    completionTokens: state.completionTokens,
    reasoningTokens: state.reasoningTokens,
    totalTokens: state.promptTokens + state.completionTokens,
    finishReason: state.finishReason,
  };
  telemetry.recordUsage(record);
}

function handleContentDelta(
  eventType: string,
  telemetry: RequestTelemetry,
  ttftState: { marked: boolean }
): void {
  if (eventType === "content_block_delta" && !ttftState.marked) {
    ttftState.marked = true;
    telemetry.markTtft("anthropic", "First content block delta received");
  }
}

function handleUsageEvents(
  msg: SseParsedMessage,
  telemetry: RequestTelemetry,
  usageState: UsageState
): void {
  if (msg.eventType === "message_start" && msg.data) {
    extractStartUsage(msg.data, usageState);
  } else if (msg.eventType === "message_delta" && msg.data) {
    extractDeltaUsage(msg.data, usageState);
    emitUsage(telemetry, usageState);
  } else if (msg.eventType === "message_stop" && !usageState.hasRecordedUsage) {
    if (usageState.promptTokens > 0 || usageState.completionTokens > 0) {
      emitUsage(telemetry, usageState);
    }
  }
}

function handleSseMessage(
  msg: SseParsedMessage,
  telemetry: RequestTelemetry,
  usageState: UsageState,
  ttftState: { marked: boolean }
): void {
  handleContentDelta(msg.eventType, telemetry, ttftState);
  handleUsageEvents(msg, telemetry, usageState);
}

export class AnthropicMessagesTransformer implements PayloadTransformerContract {
  transformClientToWire(
    inboundBody: Record<string, unknown>,
    _directive: ParsedDirective,
    headers?: Headers
  ): OutboundWirePayload {
    const outboundHeaders: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (headers && typeof headers.get === "function") {
      const anthropicVersion = headers.get("anthropic-version");
      if (anthropicVersion) {
        outboundHeaders["anthropic-version"] = anthropicVersion;
      }
      const anthropicBeta = headers.get("anthropic-beta");
      if (anthropicBeta) {
        outboundHeaders["anthropic-beta"] = anthropicBeta;
      }
    }

    return {
      endpointKey: "ms",
      method: "POST",
      headers: outboundHeaders,
      body: inboundBody,
      isStreaming: Boolean(inboundBody.stream),
    };
  }

  transformWireToClient(
    upstreamJson: unknown,
    _directive: ParsedDirective
  ): unknown {
    return upstreamJson;
  }

  createWireToClientStream(
    _directive: ParsedDirective,
    telemetry: RequestTelemetry,
    clientSignal: AbortSignal
  ): TransformStream<Uint8Array, Uint8Array> {
    const decoder = new TextDecoder();
    let buffer = "";
    const ttftState = { marked: false };
    const usageState: UsageState = {
      promptTokens: 0,
      completionTokens: 0,
      finishReason: null,
      hasRecordedUsage: false,
    };

    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (clientSignal.aborted) {
          return;
        }
        controller.enqueue(chunk);
        buffer += decoder.decode(chunk, { stream: true });
        buffer = drainEventBlocks(buffer, (block) => {
          const parsedMsg = parseSseBlock(block);
          handleSseMessage(parsedMsg, telemetry, usageState, ttftState);
        });
      },

      flush() {
        if (clientSignal.aborted) {
          return;
        }
        buffer += decoder.decode();
        buffer = drainEventBlocks(buffer, (block) => {
          const parsedMsg = parseSseBlock(block);
          handleSseMessage(parsedMsg, telemetry, usageState, ttftState);
        });

        if (buffer.trim().length > 0) {
          const parsedMsg = parseSseBlock(buffer);
          handleSseMessage(parsedMsg, telemetry, usageState, ttftState);
          buffer = "";
        }

        if (!usageState.hasRecordedUsage && (usageState.promptTokens > 0 || usageState.completionTokens > 0)) {
          emitUsage(telemetry, usageState);
        }
      },
    });
  }
}

export const anthropicMessagesTransformer = new AnthropicMessagesTransformer();
