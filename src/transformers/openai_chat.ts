import type { ParsedDirective } from "../directive/types";
import type {
  OutboundWirePayload,
  PayloadTransformerContract,
} from "../engine/transformer";
import type { RequestTelemetry, UsageRecord } from "../telemetry/session";
import {
  filterReasoningFromChunk,
  stripReasoningFromResponseBody,
} from "./opencode_adapter";
import { sanitizeAndTransformPayload } from "./payload";
import type { OpenAIRequestPayload } from "./nuances";
import { EMOJI, logWarn } from "../ui/logger";

interface ParsedUsageDetails {
  readonly reasoning_tokens?: number;
  readonly thinking_tokens?: number;
}

interface RawUsagePayload {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly completion_tokens_details?: ParsedUsageDetails;
  readonly output_tokens_details?: ParsedUsageDetails;
}

interface StreamState {
  lineBuffer: string;
  ttftMarked: boolean;
  usageRecorded: boolean;
  latestFinishReason: string | null;
}

function extractDirectiveNuances(directive: ParsedDirective): readonly string[] {
  return "nuances" in directive ? directive.nuances : [];
}

function extractDirectiveWire(directive: ParsedDirective): string {
  if ("payload" in directive) {
    return directive.wire ?? directive.payload;
  }
  return "oa";
}

function shouldScrubReasoning(directive: ParsedDirective): boolean {
  const nuances = extractDirectiveNuances(directive);
  const wire = extractDirectiveWire(directive);
  if (nuances.includes("ts")) {
    return false;
  }
  return wire === "oa" || nuances.includes("sb");
}

function extractReasoningTokens(usage: RawUsagePayload): number | undefined {
  const details = usage.completion_tokens_details ?? usage.output_tokens_details;
  if (!details || typeof details !== "object") {
    return undefined;
  }
  return details.reasoning_tokens ?? details.thinking_tokens;
}

function parseOpenAiUsage(data: Record<string, unknown>): UsageRecord | null {
  if (!data.usage || typeof data.usage !== "object") {
    return null;
  }
  const u = data.usage as RawUsagePayload;
  const promptTokens = u.prompt_tokens ?? u.input_tokens ?? 0;
  const completionTokens = u.completion_tokens ?? u.output_tokens ?? 0;
  const totalTokens = u.total_tokens ?? (promptTokens + completionTokens);
  const reasoningTokens = extractReasoningTokens(u);

  return {
    promptTokens,
    completionTokens,
    totalTokens,
    reasoningTokens,
  };
}

function extractFinishReason(data: Record<string, unknown>): string | null {
  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    return null;
  }
  const choice = data.choices[0] as { finish_reason?: unknown };
  if (typeof choice?.finish_reason === "string" && choice.finish_reason.length > 0) {
    return choice.finish_reason;
  }
  return null;
}

function hasContentToken(data: Record<string, unknown>, shouldScrub: boolean): boolean {
  if (!Array.isArray(data.choices) || data.choices.length === 0) {
    return false;
  }
  const first = data.choices[0] as { delta?: Record<string, unknown> };
  const delta = first?.delta;
  if (!delta || typeof delta !== "object") {
    return false;
  }
  if (typeof delta.content === "string" && delta.content.length > 0) {
    return true;
  }
  if (Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0) {
    return true;
  }
  if (!shouldScrub && typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) {
    return true;
  }
  return false;
}

function recordTelemetryEvents(
  parsed: Record<string, unknown>,
  state: StreamState,
  shouldScrub: boolean,
  telemetry: RequestTelemetry
): void {
  if (!state.ttftMarked && hasContentToken(parsed, shouldScrub)) {
    state.ttftMarked = true;
    telemetry.markTtft("openai");
  }

  const finishReason = extractFinishReason(parsed);
  if (finishReason) {
    state.latestFinishReason = finishReason;
  }

  const usage = parseOpenAiUsage(parsed);
  if (usage && !state.usageRecorded) {
    state.usageRecorded = true;
    telemetry.recordUsage({
      ...usage,
      finishReason: state.latestFinishReason,
    });
  }
}

function emitFilteredOrRaw(
  parsed: Record<string, unknown>,
  shouldScrub: boolean,
  reqId: string | undefined,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  if (!shouldScrub) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(parsed)}\n\n`));
    return;
  }

  const { filteredData, shouldEmit } = filterReasoningFromChunk(parsed, reqId);
  if (shouldEmit) {
    controller.enqueue(encoder.encode(`data: ${JSON.stringify(filteredData)}\n\n`));
  }
}

function handleDataChunk(
  dataStr: string,
  state: StreamState,
  directive: ParsedDirective,
  telemetry: RequestTelemetry,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  if (dataStr === "[DONE]") {
    controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    return;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(dataStr) as Record<string, unknown>;
  } catch (parseErr) {
    const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
    logWarn(EMOJI.amber, `Invalid JSON in SSE data line: ${msg}`);
    controller.enqueue(encoder.encode(`data: ${dataStr}\n\n`));
    return;
  }

  const shouldScrub = shouldScrubReasoning(directive);
  recordTelemetryEvents(parsed, state, shouldScrub, telemetry);
  emitFilteredOrRaw(parsed, shouldScrub, telemetry.reqId, controller, encoder);
}

function handleLine(
  rawLine: string,
  state: StreamState,
  directive: ParsedDirective,
  telemetry: RequestTelemetry,
  controller: TransformStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  const line = rawLine.trim();
  if (line.length === 0) {
    return;
  }
  if (line.startsWith(":")) {
    controller.enqueue(encoder.encode(`${line}\n\n`));
    return;
  }
  if (line.startsWith("data:")) {
    const dataStr = line.slice(5).trim();
    handleDataChunk(dataStr, state, directive, telemetry, controller, encoder);
    return;
  }
  controller.enqueue(encoder.encode(`${line}\n\n`));
}

export class OpenAIChatTransformer implements PayloadTransformerContract {
  /** Pure: converts client request body to upstream wire format */
  transformClientToWire(
    inboundBody: Record<string, unknown>,
    directive: ParsedDirective,
    headers: Headers
  ): OutboundWirePayload {
    const isStreaming = Boolean(inboundBody.stream);
    const wireHeaders: Record<string, string> = {
      "content-type": "application/json",
    };
    headers.forEach((value, key) => {
      wireHeaders[key.toLowerCase()] = value;
    });

    const nuances = extractDirectiveNuances(directive);
    const wire = extractDirectiveWire(directive);
    const transformedBody = sanitizeAndTransformPayload(
      inboundBody as OpenAIRequestPayload,
      {
        nuances,
        targetWire: wire as "oa" | "oo" | "cl" | "gg" | "rs" | "ao",
        enableScrubbing: true,
      }
    ) as Record<string, unknown>;

    return {
      endpointKey: "ch",
      method: "POST",
      headers: wireHeaders,
      body: transformedBody,
      isStreaming,
    };
  }

  /** Pure: converts upstream non-streaming response to client format */
  transformWireToClient(
    upstreamJson: unknown,
    directive: ParsedDirective
  ): unknown {
    if (!upstreamJson || typeof upstreamJson !== "object") {
      return upstreamJson;
    }

    if (shouldScrubReasoning(directive)) {
      const cloned = structuredClone(upstreamJson) as Record<string, unknown>;
      stripReasoningFromResponseBody(cloned);
      return cloned;
    }

    return upstreamJson;
  }

  /**
   * Returns a TransformStream for streaming response translation.
   * Parses inbound SSE chunks (data: {...}).
   * Calls telemetry.markTtft() on first content chunk.
   * Calls telemetry.recordUsage() on final chunk if usage block is present.
   * Handles reasoning scrubbing per nuance (oa wire scrubs reasoning_content unless ts nuance is present).
   * Emits standard OpenAI SSE chunks.
   */
  createWireToClientStream(
    directive: ParsedDirective,
    telemetry: RequestTelemetry,
    clientSignal: AbortSignal
  ): TransformStream<Uint8Array, Uint8Array> {
    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    const state: StreamState = {
      lineBuffer: "",
      ttftMarked: false,
      usageRecorded: false,
      latestFinishReason: null,
    };

    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (clientSignal.aborted || chunk.byteLength === 0) {
          return;
        }
        state.lineBuffer += decoder.decode(chunk, { stream: true });
        const lines = state.lineBuffer.split("\n");
        state.lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          if (clientSignal.aborted) {
            return;
          }
          handleLine(line, state, directive, telemetry, controller, encoder);
        }
      },

      flush(controller) {
        if (clientSignal.aborted) {
          return;
        }
        const remaining = decoder.decode();
        if (remaining.length > 0) {
          state.lineBuffer += remaining;
        }
        if (state.lineBuffer.trim().length > 0) {
          const lines = state.lineBuffer.split("\n");
          state.lineBuffer = "";
          for (const line of lines) {
            handleLine(line, state, directive, telemetry, controller, encoder);
          }
        }
      },
    });
  }
}

export const openAiChatTransformer = new OpenAIChatTransformer();
