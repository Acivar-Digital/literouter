import { describe, expect, it, mock } from "bun:test";
import type { ParsedDirective } from "../../../src/directive/types";
import type { RequestTelemetry, UsageRecord } from "../../../src/telemetry/session";
import {
  AnthropicMessagesTransformer,
  anthropicMessagesTransformer,
} from "../../../src/transformers/anthropic_messages";
import {
  AnthropicMessagesTransformer as ReExportedTransformer,
  anthropicMessagesTransformer as reExportedSingleton,
} from "../../../src/handlers/anthropic_compat";

const dummyDirective: ParsedDirective = {
  type: "direct",
  provider: "an",
  payload: "cl",
  completion: "ms",
  nuances: ["no"],
  raw: "lr-an-cl-ms-no",
};

function createMockTelemetry() {
  const markTtft = mock((_protocol?: string, _details?: string) => {});
  const recordUsage = mock((_record: UsageRecord) => {});
  return {
    telemetry: {
      markTtft,
      recordUsage,
    } as unknown as RequestTelemetry,
    markTtft,
    recordUsage,
  };
}

async function streamToString(readable: ReadableStream<Uint8Array>): Promise<string> {
  const reader = readable.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      result += decoder.decode(value, { stream: true });
    }
  }
  result += decoder.decode();
  return result;
}

describe("AnthropicMessagesTransformer", () => {
  it("exports singleton instance and re-exports from anthropic_compat", () => {
    expect(anthropicMessagesTransformer).toBeInstanceOf(AnthropicMessagesTransformer);
    expect(reExportedSingleton).toBe(anthropicMessagesTransformer);
    expect(ReExportedTransformer).toBe(AnthropicMessagesTransformer);
  });

  describe("transformClientToWire", () => {
    it("transforms non-streaming request with default headers", () => {
      const transformer = new AnthropicMessagesTransformer();
      const body = {
        model: "claude-3-7-sonnet-20250219",
        messages: [{ role: "user", content: "Hello" }],
        max_tokens: 1024,
      };

      const result = transformer.transformClientToWire(body, dummyDirective, new Headers());

      expect(result.endpointKey).toBe("ms");
      expect(result.method).toBe("POST");
      expect(result.isStreaming).toBe(false);
      expect(result.headers).toEqual({ "Content-Type": "application/json" });
      expect(result.body).toEqual(body);
    });

    it("detects streaming when stream flag is true", () => {
      const transformer = new AnthropicMessagesTransformer();
      const body = {
        model: "claude-3-7-sonnet-20250219",
        messages: [{ role: "user", content: "Count to 5" }],
        max_tokens: 256,
        stream: true,
      };

      const result = transformer.transformClientToWire(body, dummyDirective, new Headers());

      expect(result.isStreaming).toBe(true);
      expect(result.endpointKey).toBe("ms");
      expect(result.body).toEqual(body);
    });

    it("propagates anthropic-version and anthropic-beta from incoming headers", () => {
      const transformer = new AnthropicMessagesTransformer();
      const headers = new Headers({
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "output-128k-2025-02-19,prompt-caching-2024-07-31",
      });
      const body = { model: "claude-3-5-haiku", messages: [] };

      const result = transformer.transformClientToWire(body, dummyDirective, headers);

      expect(result.headers["Content-Type"]).toBe("application/json");
      expect(result.headers["anthropic-version"]).toBe("2023-06-01");
      expect(result.headers["anthropic-beta"]).toBe("output-128k-2025-02-19,prompt-caching-2024-07-31");
    });
  });

  describe("transformWireToClient", () => {
    it("passes through upstream Anthropic JSON payload unmodified", () => {
      const transformer = new AnthropicMessagesTransformer();
      const upstream = {
        id: "msg_01XFDUDYJgAACzvnptvVoYEL",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "Hello there!" }],
        model: "claude-3-7-sonnet-20250219",
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: 12,
          output_tokens: 6,
        },
      };

      const clientResponse = transformer.transformWireToClient(upstream, dummyDirective);
      expect(clientResponse).toBe(upstream);
      expect(clientResponse).toEqual(upstream);
    });
  });

  describe("createWireToClientStream", () => {
    it("streams mock Anthropic SSE and captures TTFT and final usage", async () => {
      const transformer = new AnthropicMessagesTransformer();
      const { telemetry, markTtft, recordUsage } = createMockTelemetry();
      const abortController = new AbortController();

      const rawFixture = await Bun.file("tests/fixtures/mock_anthropic_stream.txt").text();
      const transformStream = transformer.createWireToClientStream(
        dummyDirective,
        telemetry,
        abortController.signal
      );

      const inputStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(rawFixture));
          controller.close();
        },
      });

      const output = await streamToString(inputStream.pipeThrough(transformStream));

      expect(output).toBe(rawFixture);
      expect(markTtft).toHaveBeenCalledTimes(1);
      expect(markTtft).toHaveBeenCalledWith("anthropic", "First content block delta received");

      expect(recordUsage).toHaveBeenCalledTimes(1);
      expect(recordUsage).toHaveBeenCalledWith({
        promptTokens: 25,
        completionTokens: 8,
        reasoningTokens: undefined,
        totalTokens: 33,
        finishReason: "end_turn",
      });
    });

    it("handles fragmented / chunked SSE frames across packet boundaries", async () => {
      const transformer = new AnthropicMessagesTransformer();
      const { telemetry, markTtft, recordUsage } = createMockTelemetry();
      const abortController = new AbortController();

      const transformStream = transformer.createWireToClientStream(
        dummyDirective,
        telemetry,
        abortController.signal
      );

      const encoder = new TextEncoder();
      const chunks = [
        "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_frag\",\"usage\":{\"input_tokens\":50,\"output_tokens\":0}}}\n\n",
        "event: content_block_delta\nda",
        "ta: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"Frag",
        "mented\"}}\n\n",
        "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"max_tokens\"},\"usage\":{\"output_tokens\":20}}\n\n",
        "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
      ];

      const inputStream = new ReadableStream<Uint8Array>({
        async start(controller) {
          for (const chunk of chunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const output = await streamToString(inputStream.pipeThrough(transformStream));
      expect(output).toBe(chunks.join(""));

      expect(markTtft).toHaveBeenCalledTimes(1);
      expect(recordUsage).toHaveBeenCalledTimes(1);
      expect(recordUsage).toHaveBeenCalledWith({
        promptTokens: 50,
        completionTokens: 20,
        reasoningTokens: undefined,
        totalTokens: 70,
        finishReason: "max_tokens",
      });
    });

    it("extracts reasoning tokens if present in output_tokens_details", async () => {
      const transformer = new AnthropicMessagesTransformer();
      const { telemetry, recordUsage } = createMockTelemetry();
      const abortController = new AbortController();

      const transformStream = transformer.createWireToClientStream(
        dummyDirective,
        telemetry,
        abortController.signal
      );

      const encoder = new TextEncoder();
      const streamData = [
        "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":100}}}\n\n",
        "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"thinking_delta\",\"thinking\":\"pondering\"}}\n\n",
        "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\"},\"usage\":{\"output_tokens\":40,\"output_tokens_details\":{\"thinking_tokens\":25}}}\n\n",
        "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
      ].join("");

      const inputStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(streamData));
          controller.close();
        },
      });

      await streamToString(inputStream.pipeThrough(transformStream));

      expect(recordUsage).toHaveBeenCalledTimes(1);
      expect(recordUsage).toHaveBeenCalledWith({
        promptTokens: 100,
        completionTokens: 40,
        reasoningTokens: 25,
        totalTokens: 140,
        finishReason: "end_turn",
      });
    });

    it("records usage from message_start if message_delta is never emitted", async () => {
      const transformer = new AnthropicMessagesTransformer();
      const { telemetry, recordUsage } = createMockTelemetry();
      const abortController = new AbortController();

      const transformStream = transformer.createWireToClientStream(
        dummyDirective,
        telemetry,
        abortController.signal
      );

      const encoder = new TextEncoder();
      const streamData = [
        "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"usage\":{\"input_tokens\":42,\"output_tokens\":3}}}\n\n",
        "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n",
      ].join("");

      const inputStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(streamData));
          controller.close();
        },
      });

      await streamToString(inputStream.pipeThrough(transformStream));

      expect(recordUsage).toHaveBeenCalledTimes(1);
      expect(recordUsage).toHaveBeenCalledWith({
        promptTokens: 42,
        completionTokens: 3,
        reasoningTokens: undefined,
        totalTokens: 45,
        finishReason: null,
      });
    });

    it("aborts streaming when clientSignal is already aborted", async () => {
      const transformer = new AnthropicMessagesTransformer();
      const { telemetry, markTtft } = createMockTelemetry();
      const abortController = new AbortController();
      abortController.abort();

      const transformStream = transformer.createWireToClientStream(
        dummyDirective,
        telemetry,
        abortController.signal
      );

      const encoder = new TextEncoder();
      const inputStream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,\"delta\":{\"type\":\"text_delta\",\"text\":\"hi\"}}\n\n"
            )
          );
          controller.close();
        },
      });

      const output = await streamToString(inputStream.pipeThrough(transformStream));
      expect(output).toBe("");
      expect(markTtft).toHaveBeenCalledTimes(0);
    });
  });
});
