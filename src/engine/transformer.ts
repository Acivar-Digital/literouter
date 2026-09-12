import type { ParsedDirective } from "../directive/types";
import type { RequestTelemetry } from "../telemetry/session";

export interface OutboundWirePayload {
  readonly endpointKey: string; // "ch", "ms", "rs", "gc", "ob"
  readonly method: "POST" | "GET";
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
  readonly isStreaming: boolean;
}

export interface PayloadTransformerContract {
  /** Pure: converts client request body to upstream wire format */
  transformClientToWire(
    inboundBody: Record<string, unknown>,
    directive: ParsedDirective,
    headers: Headers
  ): OutboundWirePayload;

  /** Pure: converts upstream non-streaming response to client format */
  transformWireToClient(
    upstreamJson: unknown,
    directive: ParsedDirective
  ): unknown;

  /**
   * Returns a TransformStream for streaming response translation.
   */
  createWireToClientStream(
    directive: ParsedDirective,
    telemetry: RequestTelemetry,
    clientSignal: AbortSignal
  ): TransformStream<Uint8Array, Uint8Array>;
}
