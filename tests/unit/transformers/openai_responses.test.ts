import { describe, expect, it } from "bun:test";
import type { ParsedDirective } from "../../../src/directive/types";
import {
  OpenAIResponsesTransformer,
  openAiResponsesTransformer,
  parseResponsesUsage,
  extractResponsesFinishReason,
  isContentEventOrDelta,
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

    it("detects TTFT on reasoning_text.delta", async () => {
      const transformer = new OpenAIResponsesTransformer();
      const mockTelemetry = new MockTelemetry();
      const abortController = new AbortController();

      const streamTransformer = transformer.createWireToClientStream(
        dummyDirective,
        mockTelemetry as unknown as RequestTelemetry,
        abortController.signal
      );

      const sseChunks = [
        "event: response.reasoning_text.delta\ndata: {\"delta\":\"Thinking hard...\"}\n\n",
        "event: response.done\ndata: {\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":10,\"output_tokens\":20,\"total_tokens\":30}}}\n\n",
      ];

      const inputStream = createStreamFromChunks(sseChunks);
      const outputStream = inputStream.pipeThrough(streamTransformer);
      await readStreamToString(outputStream);

      expect(mockTelemetry.ttftMarkedCount).toBe(1);
    });

    it("detects TTFT on function_call_arguments.delta", async () => {
      const transformer = new OpenAIResponsesTransformer();
      const mockTelemetry = new MockTelemetry();
      const abortController = new AbortController();

      const streamTransformer = transformer.createWireToClientStream(
        dummyDirective,
        mockTelemetry as unknown as RequestTelemetry,
        abortController.signal
      );

      const sseChunks = [
        "event: response.function_call_arguments.delta\ndata: {\"delta\":\"{\\\"location\\\": \\\"Tokyo\\\"}\"}\n\n",
        "event: response.done\ndata: {\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":8,\"output_tokens\":12,\"total_tokens\":20}}}\n\n",
      ];

      const inputStream = createStreamFromChunks(sseChunks);
      const outputStream = inputStream.pipeThrough(streamTransformer);
      await readStreamToString(outputStream);

      expect(mockTelemetry.ttftMarkedCount).toBe(1);
    });

    it("extracts finishReason 'length' for incomplete with max_output_tokens in stream", async () => {
      const transformer = new OpenAIResponsesTransformer();
      const mockTelemetry = new MockTelemetry();
      const abortController = new AbortController();

      const streamTransformer = transformer.createWireToClientStream(
        dummyDirective,
        mockTelemetry as unknown as RequestTelemetry,
        abortController.signal
      );

      const sseChunks = [
        "event: response.output_text.delta\ndata: {\"delta\":\"Cut off text...\"}\n\n",
        "event: response.done\ndata: {\"response\":{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"max_output_tokens\"},\"usage\":{\"input_tokens\":10,\"output_tokens\":50,\"total_tokens\":60}}}\n\n",
      ];

      const inputStream = createStreamFromChunks(sseChunks);
      const outputStream = inputStream.pipeThrough(streamTransformer);
      await readStreamToString(outputStream);

      expect(mockTelemetry.usageRecords.length).toBe(1);
      expect(mockTelemetry.usageRecords[0]?.finishReason).toBe("length");
    });

    it("extracts finishReason 'content_filter' for incomplete with content_filter in stream", async () => {
      const transformer = new OpenAIResponsesTransformer();
      const mockTelemetry = new MockTelemetry();
      const abortController = new AbortController();

      const streamTransformer = transformer.createWireToClientStream(
        dummyDirective,
        mockTelemetry as unknown as RequestTelemetry,
        abortController.signal
      );

      const sseChunks = [
        "event: response.refusal.delta\ndata: {\"delta\":\"I cannot answer.\"}\n\n",
        "event: response.done\ndata: {\"response\":{\"status\":\"incomplete\",\"incomplete_details\":{\"reason\":\"content_filter\"},\"usage\":{\"input_tokens\":15,\"output_tokens\":5,\"total_tokens\":20}}}\n\n",
      ];

      const inputStream = createStreamFromChunks(sseChunks);
      const outputStream = inputStream.pipeThrough(streamTransformer);
      await readStreamToString(outputStream);

      expect(mockTelemetry.usageRecords.length).toBe(1);
      expect(mockTelemetry.usageRecords[0]?.finishReason).toBe("content_filter");
    });
  });

  describe("parseResponsesUsage", () => {
    it("parses canonical input_tokens, output_tokens, and input_tokens_details.cached_tokens", () => {
      const usage = {
        input_tokens: 120,
        output_tokens: 45,
        total_tokens: 165,
        input_tokens_details: {
          cached_tokens: 64,
        },
        output_tokens_details: {
          reasoning_tokens: 20,
        },
      };

      const parsed = parseResponsesUsage(usage);
      expect(parsed).toEqual({
        promptTokens: 120,
        completionTokens: 45,
        totalTokens: 165,
        reasoningTokens: 20,
        cachedTokens: 64,
      });
    });

    it("computes totalTokens when total_tokens is omitted", () => {
      const usage = {
        input_tokens: 50,
        output_tokens: 30,
      };

      const parsed = parseResponsesUsage(usage);
      expect(parsed).toEqual({
        promptTokens: 50,
        completionTokens: 30,
        totalTokens: 80,
        reasoningTokens: undefined,
        cachedTokens: undefined,
      });
    });

    it("supports cached_tokens and cachedTokens root fields", () => {
      const parsed1 = parseResponsesUsage({
        input_tokens: 10,
        output_tokens: 20,
        cached_tokens: 5,
      });
      expect(parsed1?.cachedTokens).toBe(5);

      const parsed2 = parseResponsesUsage({
        prompt_tokens: 10,
        completion_tokens: 20,
        cachedTokens: 8,
      });
      expect(parsed2?.cachedTokens).toBe(8);
    });

    it("supports prompt_tokens and completion_tokens with legacy completion_tokens_details", () => {
      const usage = {
        prompt_tokens: 40,
        completion_tokens: 60,
        total_tokens: 100,
        completion_tokens_details: {
          reasoning_tokens: 15,
        },
      };

      const parsed = parseResponsesUsage(usage);
      expect(parsed).toEqual({
        promptTokens: 40,
        completionTokens: 60,
        totalTokens: 100,
        reasoningTokens: 15,
        cachedTokens: undefined,
      });
    });

    it("returns null for invalid or missing tokens", () => {
      expect(parseResponsesUsage(null)).toBeNull();
      expect(parseResponsesUsage(undefined)).toBeNull();
      expect(parseResponsesUsage("string")).toBeNull();
      expect(parseResponsesUsage({ input_tokens: 10 })).toBeNull();
      expect(parseResponsesUsage({ output_tokens: 20 })).toBeNull();
      expect(parseResponsesUsage({})).toBeNull();
    });
  });

  describe("isContentEventOrDelta", () => {
    it("recognizes valid content delta event types", () => {
      expect(isContentEventOrDelta("response.output_text.delta", {})).toBe(true);
      expect(isContentEventOrDelta("response.reasoning_text.delta", {})).toBe(true);
      expect(isContentEventOrDelta("response.function_call_arguments.delta", {})).toBe(true);
      expect(isContentEventOrDelta("response.audio.delta", {})).toBe(true);
      expect(isContentEventOrDelta("response.refusal.delta", {})).toBe(true);
    });

    it("does not match phantom non-existent spec events by event name alone", () => {
      expect(isContentEventOrDelta("response.content_part.delta", {})).toBe(false);
      expect(isContentEventOrDelta("response.output_item.delta", {})).toBe(false);
    });

    it("falls back to parsed.delta when delta is string or object", () => {
      expect(isContentEventOrDelta("unknown.event", { delta: "text delta" })).toBe(true);
      expect(isContentEventOrDelta("unknown.event", { delta: { text: "hello" } })).toBe(true);
      expect(isContentEventOrDelta("unknown.event", { delta: "" })).toBe(false);
      expect(isContentEventOrDelta("unknown.event", {})).toBe(false);
    });

    it("rejects non-delta event types without delta payload", () => {
      expect(isContentEventOrDelta("response.created", {})).toBe(false);
      expect(isContentEventOrDelta("response.completed", {})).toBe(false);
      expect(isContentEventOrDelta("response.output_item.added", {})).toBe(false);
    });
  });

  describe("extractResponsesFinishReason", () => {
    it("maps status 'completed' to 'stop'", () => {
      expect(extractResponsesFinishReason({ status: "completed" })).toBe("stop");
      expect(extractResponsesFinishReason({ response: { status: "completed" } })).toBe("stop");
    });

    it("maps status 'incomplete' with incomplete_details.reason 'max_output_tokens' to 'length'", () => {
      const payload = {
        status: "incomplete",
        incomplete_details: { reason: "max_output_tokens" },
      };
      expect(extractResponsesFinishReason(payload)).toBe("length");
      expect(extractResponsesFinishReason({ response: payload })).toBe("length");
    });

    it("maps status 'incomplete' with incomplete_details.reason 'content_filter' to 'content_filter'", () => {
      const payload = {
        status: "incomplete",
        incomplete_details: { reason: "content_filter" },
      };
      expect(extractResponsesFinishReason(payload)).toBe("content_filter");
      expect(extractResponsesFinishReason({ response: payload })).toBe("content_filter");
    });

    it("maps status 'incomplete' with other or missing reason to 'incomplete'", () => {
      expect(extractResponsesFinishReason({ status: "incomplete" })).toBe("incomplete");
      expect(extractResponsesFinishReason({ status: "incomplete", incomplete_details: null })).toBe("incomplete");
      expect(extractResponsesFinishReason({ status: "incomplete", incomplete_details: { reason: "other" } })).toBe("incomplete");
    });

    it("maps status 'cancelled' to 'cancelled'", () => {
      expect(extractResponsesFinishReason({ status: "cancelled" })).toBe("cancelled");
    });

    it("maps status 'failed' to 'error'", () => {
      expect(extractResponsesFinishReason({ status: "failed" })).toBe("error");
    });

    it("falls back to choices[0].finish_reason when status is missing", () => {
      expect(extractResponsesFinishReason({ choices: [{ finish_reason: "stop" }] })).toBe("stop");
      expect(extractResponsesFinishReason({ choices: [{ finish_reason: "tool_calls" }] })).toBe("tool_calls");
    });

    it("returns null when no status or choices are present", () => {
      expect(extractResponsesFinishReason({})).toBeNull();
      expect(extractResponsesFinishReason({ status: "in_progress" })).toBeNull();
    });
  });
});
