import type { ParsedDirective } from "../directive/types";
import type { OutboundWirePayload, PayloadTransformerContract } from "../engine/transformer";
import type { RequestTelemetry } from "../telemetry/session";

export interface GoogleUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

export function extractNumberByPattern(text: string, pattern: RegExp): number {
  const match = text.match(pattern);
  return match ? Number(match[1]) : 0;
}

export function parseFinishReason(text: string): string | null {
  if (!text.includes("finishReason") && !text.includes("finish_reason")) {
    return null;
  }
  const match = text.match(/"finish_?reason"\s*:\s*"([^"]+)"/i);
  return match?.[1] ?? null;
}

export function parseUsageMetadata(text: string): GoogleUsage | null {
  if (!text.includes("usageMetadata") && !text.includes("usage_metadata")) {
    return null;
  }
  const promptTokens = extractNumberByPattern(text, /"promptTokenCount"\s*:\s*(\d+)/i);
  const completionTokens = extractNumberByPattern(text, /"candidatesTokenCount"\s*:\s*(\d+)/i);
  const totalRaw = extractNumberByPattern(text, /"totalTokenCount"\s*:\s*(\d+)/i);
  const totalTokens = totalRaw > 0 ? totalRaw : promptTokens + completionTokens;
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
    return null;
  }
  return { promptTokens, completionTokens, totalTokens };
}

export function isContentChunk(text: string): boolean {
  return (
    text.includes('"candidates"') ||
    text.includes('"content"') ||
    text.includes('"parts"') ||
    text.includes('"text"')
  );
}

export function resolveEndpointKey(directive: ParsedDirective): string {
  if ("completion" in directive && directive.completion === "ch") {
    return "ch";
  }
  return "gc";
}

export function resolveIsStreaming(
  inboundBody: Record<string, unknown>,
  directive: ParsedDirective
): boolean {
  if (Boolean(inboundBody.stream)) {
    return true;
  }
  return "completion" in directive && directive.completion === "gc";
}

function processChunkTtft(
  buffer: string,
  ttftMarked: boolean,
  telemetry: RequestTelemetry
): boolean {
  if (ttftMarked) {
    return true;
  }
  if (isContentChunk(buffer)) {
    telemetry.markTtft();
    return true;
  }
  return false;
}

function processChunkUsage(
  buffer: string,
  usageRecorded: boolean,
  finishReason: string | null,
  telemetry: RequestTelemetry
): boolean {
  if (usageRecorded) {
    return true;
  }
  const usage = parseUsageMetadata(buffer);
  if (!usage) {
    return false;
  }
  telemetry.recordUsage({
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    finishReason: finishReason ? finishReason.toLowerCase() : null,
  });
  return true;
}

export class GoogleNativeTransformer implements PayloadTransformerContract {
  transformClientToWire(
    inboundBody: Record<string, unknown>,
    directive: ParsedDirective,
    _headers: Headers
  ): OutboundWirePayload {
    return {
      endpointKey: resolveEndpointKey(directive),
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: inboundBody,
      isStreaming: resolveIsStreaming(inboundBody, directive),
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
    let ttftMarked = false;
    let usageRecorded = false;
    let latestFinishReason: string | null = null;

    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (clientSignal.aborted || chunk.byteLength === 0) {
          return;
        }
        const text = decoder.decode(chunk, { stream: true });
        buffer = (buffer + text).slice(-65536);

        ttftMarked = processChunkTtft(buffer, ttftMarked, telemetry);
        latestFinishReason = parseFinishReason(buffer) ?? latestFinishReason;
        usageRecorded = processChunkUsage(buffer, usageRecorded, latestFinishReason, telemetry);

        controller.enqueue(chunk);
      },

      flush(_controller) {
        const remaining = decoder.decode();
        if (remaining.length > 0) {
          buffer = (buffer + remaining).slice(-65536);
        }
        processChunkUsage(buffer, usageRecorded, latestFinishReason, telemetry);
        buffer = "";
      },
    });
  }
}

export const googleNativeTransformer = new GoogleNativeTransformer();
