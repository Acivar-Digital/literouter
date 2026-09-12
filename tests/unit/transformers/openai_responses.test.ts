import { describe, expect, it } from "bun:test";
import type { ParsedDirective } from "../../../src/directive/types";
import {
  OpenAIResponsesTransformer,
  openAiResponsesTransformer,
} from "../../../src/transformers/openai_responses";
import type { RequestTelemetry, UsageRecord } from "../../../src/telemetry/session";

const dummyDirective: ParsedDirective = {
  type: "direct",
  raw: "lr-zn-oo-rs-no",
  provider: "zn",
  payload: "oo",
  wire: "oo",
  completion: "rs",
  endpoint: "rs",
  nuances: ["no"],
};

class MockTelemetry {
  public ttftMarkedCount = 0;
  public usageRecords: UsageRecord[] = [];

  markTtft(): void {
    this.ttftMarkedCount += 1;
  }

  recordUsage(record: UsageRecord): void {
    this.usageRecords.push(record);
  }
}

async function readStreamToString(
  stream: ReadableStream<Uint8Array>
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      result += decoder.decode(value, { stream: true });
    }
  }
  result += decoder.decode();
  return result;
}

function createStreamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("OpenAI Responses Transformer (src/transformers/openai_responses.ts)", () => {
  it("exports a singleton instance of OpenAIResponsesTransformer", () => {
    expect(openAiResponsesTransformer).toBeInstanceOf(OpenAIResponsesTransformer);
  });

  describe("transformClientToWire", () => {
    it("transforms inbound non-streaming body preserving all native parameters", () => {
      const transformer = new OpenAIResponsesTransformer();
      const inboundBody = {
        model: "muse-spark-1.3",
        input: [{ role: "user", content: "Write a poem" }],
        tools: [{ type: "function", name: "calculator" }],
        stream: false,
        reasoning: { effort: "high" },
        response_format: { type: "json_object" },
      };

      const outbound = transformer.transformClientToWire(
        inboundBody,
        dummyDirective,
        new Headers()
      );

      expect(outbound.endpointKey).toBe("rs");
      expect(outbound.method).toBe("POST");
      expect(outbound.headers["Content-Type"]).toBe("application/json");
      expect(outbound.isStreaming).toBe(false);
      expect(outbound.body).toEqual(inboundBody);
    });

    it("detects streaming mode when stream is true", () => {
      const transformer = new OpenAIResponsesTransformer();
      const inboundBody = {
        model: "muse-spark-1.3",
        input: "Hello",
        stream: true,
      };

      const outbound = transformer.transformClientToWire(
        inboundBody,
        dummyDirective,
        new Headers()
      );

      expect(outbound.endpointKey).toBe("rs");
      expect(outbound.method).toBe("POST");
      expect(outbound.isStreaming).toBe(true);
      expect(outbound.body).toEqual(inboundBody);
    });
  });

  describe("transformWireToClient", () => {
    it("preserves native Responses output verbatim without reasoning scrubbing", () => {
      const transformer = new OpenAIResponsesTransformer();
      const upstreamJson = {
        id: "resp_native_789",
        model: "muse-spark-1.3",
        output: [
          {
            type: "reasoning",
            reasoning: "Step 1: Pondering deeply about life...",
          },
          {
            type: "message",
            content: [{ type: "text", text: "Here is your poem." }],
          },
        ],
        usage: {
          input_tokens: 15,
          output_tokens: 45,
          total_tokens: 60,
          output_tokens_details: {
            reasoning_tokens: 25,
          },
        },
      };

      const clientJson = transformer.transformWireToClient(upstreamJson, dummyDirective);
      expect(clientJson).toEqual(upstreamJson);
      // Ensure reasoning field is strictly preserved
      const casted = clientJson as typeof upstreamJson;
      expect(casted.output?.[0]?.reasoning).toBe("Step 1: Pondering deeply about life...");
    });
  });

  describe("createWireToClientStream", () => {
    it("passes through SSE chunks verbatim preserving reasoning deltas", async () => {
      const transformer = new OpenAIResponsesTransformer();
      const mockTelemetry = new MockTelemetry();
      const abortController = new AbortController();

      const streamTransformer = transformer.createWireToClientStream(
        dummyDirective,
        mockTelemetry as unknown as RequestTelemetry,
        abortController.signal
      );

      const sseChunks = [
        "event: response.output_item.added\ndata: {\"item\":{\"type\":\"reasoning\",\"content\":[]}}\n\n",
        "event: response.content_part.delta\ndata: {\"delta\":{\"type\":\"reasoning_text\",\"text\":\"Thinking...\"}}\n\n",
        "event: response.output_text.delta\ndata: {\"delta\":\"Final answer\"}\n\n",
        "event: response.done\ndata: {\"response\":{\"status\":\"completed\",\"usage\":{\"prompt_tokens\":10,\"completion_tokens\":20,\"total_tokens\":30,\"completion_tokens_details\":{\"reasoning_tokens\":8}}}}\n\n",
        "data: [DONE]\n\n",
      ];

      const inputStream = createStreamFromChunks(sseChunks);
      const outputStream = inputStream.pipeThrough(streamTransformer);
      const outputText = await readStreamToString(outputStream);

      expect(outputText).toBe(sseChunks.join(""));
      expect(mockTelemetry.ttftMarkedCount).toBe(1);
      expect(mockTelemetry.usageRecords.length).toBe(1);
      expect(mockTelemetry.usageRecords[0]).toEqual({
        promptTokens: 10,
        completionTokens: 20,
        totalTokens: 30,
        reasoningTokens: 8,
        finishReason: "stop",
      });
    });

    it("handles alternative usage format with input_tokens / output_tokens in response.completed", async () => {
      const transformer = new OpenAIResponsesTransformer();
      const mockTelemetry = new MockTelemetry();
      const abortController = new AbortController();

      const streamTransformer = transformer.createWireToClientStream(
        dummyDirective,
        mockTelemetry as unknown as RequestTelemetry,
        abortController.signal
      );

      const sseChunks = [
        "event: response.output_text.delta\ndata: {\"delta\":\"Chunk 1\"}\n\n",
        "event: response.output_text.delta\ndata: {\"delta\":\"Chunk 2\"}\n\n",
        "event: response.completed\ndata: {\"status\":\"stop\",\"usage\":{\"input_tokens\":5,\"output_tokens\":15,\"total_tokens\":20,\"output_tokens_details\":{\"reasoning_tokens\":4}}}\n\n",
      ];

      const inputStream = createStreamFromChunks(sseChunks);
      const outputStream = inputStream.pipeThrough(streamTransformer);
      await readStreamToString(outputStream);

      expect(mockTelemetry.ttftMarkedCount).toBe(1);
      expect(mockTelemetry.usageRecords.length).toBe(1);
      expect(mockTelemetry.usageRecords[0]).toEqual({
        promptTokens: 5,
        completionTokens: 15,
        totalTokens: 20,
        reasoningTokens: 4,
        finishReason: "stop",
      });
    });

    it("respects clientSignal abort on streaming", async () => {
      const transformer = new OpenAIResponsesTransformer();
      const mockTelemetry = new MockTelemetry();
      const abortController = new AbortController();
      abortController.abort();

      const streamTransformer = transformer.createWireToClientStream(
        dummyDirective,
        mockTelemetry as unknown as RequestTelemetry,
        abortController.signal
      );

      const inputStream = createStreamFromChunks(["event: test\ndata: {}\n\n"]);
      const outputStream = inputStream.pipeThrough(streamTransformer);
      const outputText = await readStreamToString(outputStream);

      expect(outputText).toBe("");
      expect(mockTelemetry.ttftMarkedCount).toBe(0);
    });
  });
});
