import type { ParsedDirective } from "../directive/types";
import type {
  OutboundWirePayload,
  PayloadTransformerContract,
} from "../engine/transformer";
import type { RequestTelemetry } from "../telemetry/session";

interface ResponsesUsageDetails {
  readonly reasoning_tokens?: number;
}

interface ResponsesUsagePayload {
  readonly prompt_tokens?: number;
  readonly completion_tokens?: number;
  readonly total_tokens?: number;
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly completion_tokens_details?: ResponsesUsageDetails;
  readonly output_tokens_details?: ResponsesUsageDetails;
}

interface ParsedUsageInfo {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly reasoningTokens?: number;
}

function parseResponsesUsage(usageObj: unknown): ParsedUsageInfo | null {
  if (!usageObj || typeof usageObj !== "object") {
    return null;
  }
  const u = usageObj as ResponsesUsagePayload;
  const prompt = typeof u.prompt_tokens === "number"
    ? u.prompt_tokens
    : typeof u.input_tokens === "number"
      ? u.input_tokens
      : null;
  const completion = typeof u.completion_tokens === "number"
    ? u.completion_tokens
    : typeof u.output_tokens === "number"
      ? u.output_tokens
      : null;

  if (prompt === null || completion === null) {
    return null;
  }

  const total = typeof u.total_tokens === "number" ? u.total_tokens : prompt + completion;
  let reasoning: number | undefined;
  const details = u.completion_tokens_details ?? u.output_tokens_details;
  if (details && typeof details === "object" && typeof details.reasoning_tokens === "number") {
    reasoning = details.reasoning_tokens;
  }

  return {
    promptTokens: prompt,
    completionTokens: completion,
    totalTokens: total,
    reasoningTokens: reasoning,
  };
}

function extractResponsesUsageFromPayload(payload: Record<string, unknown>): ParsedUsageInfo | null {
  if (payload.response && typeof payload.response === "object") {
    const resp = payload.response as Record<string, unknown>;
    const parsed = parseResponsesUsage(resp.usage);
    if (parsed) return parsed;
  }
  return parseResponsesUsage(payload.usage);
}

function extractResponsesFinishReason(payload: Record<string, unknown>): string | null {
  const resp = payload.response && typeof payload.response === "object"
    ? (payload.response as Record<string, unknown>)
    : payload;

  if (typeof resp.status === "string" && resp.status.length > 0) {
    return resp.status === "completed" ? "stop" : resp.status;
  }
  if (Array.isArray(resp.choices) && resp.choices[0] && typeof resp.choices[0].finish_reason === "string") {
    return resp.choices[0].finish_reason;
  }
  return null;
}

function isContentEventOrDelta(eventType: string, parsed: Record<string, unknown>): boolean {
  if (
    eventType === "response.content_part.delta" ||
    eventType === "response.output_text.delta" ||
    eventType === "response.output_item.delta"
  ) {
    return true;
  }
  if (typeof parsed.delta === "string" && parsed.delta.length > 0) {
    return true;
  }
  if (parsed.delta && typeof parsed.delta === "object") {
    return true;
  }
  return false;
}

export class OpenAIResponsesTransformer implements PayloadTransformerContract {
  /** Pure: converts client request body to upstream Responses wire format */
  transformClientToWire(
    inboundBody: Record<string, unknown>,
    _directive: ParsedDirective,
    _headers: Headers
  ): OutboundWirePayload {
    return {
      endpointKey: "rs",
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: inboundBody,
      isStreaming: Boolean(inboundBody.stream),
    };
  }

  /**
   * Pure: converts upstream non-streaming response to client format.
   * Responses API native wire format preserves reasoning and outputs verbatim.
   */
  transformWireToClient(
    upstreamJson: unknown,
    _directive: ParsedDirective
  ): unknown {
    return upstreamJson;
  }

  /**
   * Returns a TransformStream for native OpenAI Responses SSE stream handling.
   * Preserves all reasoning tokens and SSE events without scrubbing.
   * Calls telemetry.markTtft() on the first content delta.
   * Calls telemetry.recordUsage() when usage metadata is encountered (e.g. response.done / response.completed).
   */
  createWireToClientStream(
    _directive: ParsedDirective,
    telemetry: RequestTelemetry,
    clientSignal: AbortSignal
  ): TransformStream<Uint8Array, Uint8Array> {
    const decoder = new TextDecoder();
    let lineBuffer = "";
    let currentEvent = "";
    let ttftMarked = false;
    let usageRecorded = false;
    let latestFinishReason: string | null = null;

    const recordUsageOnce = (usageInfo: ParsedUsageInfo, finishReason?: string | null) => {
      if (usageRecorded) return;
      usageRecorded = true;
      telemetry.recordUsage({
        promptTokens: usageInfo.promptTokens,
        completionTokens: usageInfo.completionTokens,
        totalTokens: usageInfo.totalTokens,
        reasoningTokens: usageInfo.reasoningTokens,
        finishReason: finishReason ?? latestFinishReason,
      });
    };

    const processLine = (rawLine: string) => {
      const line = rawLine.trim();
      if (line.startsWith("event:")) {
        currentEvent = line.slice("event:".length).trim();
        return;
      }
      if (!line.startsWith("data:")) {
        if (line === "") {
          currentEvent = "";
        }
        return;
      }

      const dataStr = line.slice("data:".length).trim();
      if (!dataStr || dataStr === "[DONE]") {
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(dataStr);
      } catch {
        return;
      }

      const eventType = currentEvent || (typeof parsed.type === "string" ? parsed.type : "");

      // 1. Mark TTFT on first content delta chunk
      if (!ttftMarked && isContentEventOrDelta(eventType, parsed)) {
        ttftMarked = true;
        telemetry.markTtft();
      }

      // 2. Track finish reason
      const reason = extractResponsesFinishReason(parsed);
      if (reason) {
        latestFinishReason = reason;
      }

      // 3. Record usage if present in response.done / response.completed or root
      const usage = extractResponsesUsageFromPayload(parsed);
      if (usage) {
        recordUsageOnce(usage, reason);
      }
    };

    return new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (clientSignal.aborted || chunk.byteLength === 0) {
          return;
        }

        lineBuffer += decoder.decode(chunk, { stream: true });
        const lines = lineBuffer.split("\n");
        lineBuffer = lines.pop() ?? "";

        for (const line of lines) {
          processLine(line);
        }

        controller.enqueue(chunk);
      },

      flush(controller) {
        const remaining = decoder.decode();
        if (remaining.length > 0) {
          lineBuffer += remaining;
        }
        if (lineBuffer.trim().length > 0) {
          for (const line of lineBuffer.split("\n")) {
            processLine(line);
          }
        }
        lineBuffer = "";
      },
    });
  }
}

export const openAiResponsesTransformer = new OpenAIResponsesTransformer();
