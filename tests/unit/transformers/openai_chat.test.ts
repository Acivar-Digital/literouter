import { describe, expect, it, mock } from "bun:test";
import { parseDirective } from "../../../src/directive/parser";
import type { ParsedDirective } from "../../../src/directive/types";
import {
  OpenAIChatTransformer,
  openAiChatTransformer,
} from "../../../src/transformers/openai_chat";
import type { RequestTelemetry } from "../../../src/telemetry/session";

function createMockTelemetry(reqId = "req-test-123"): {
  telemetry: RequestTelemetry;
  markTtftCalls: string[];
  usageRecords: unknown[];
} {
  const markTtftCalls: string[] = [];
  const usageRecords: unknown[] = [];

  const telemetry = {
    reqId,
    markTtft: mock((proto?: string) => {
      markTtftCalls.push(proto ?? "default");
    }),
    recordUsage: mock((record: unknown) => {
      usageRecords.push(record);
    }),
  } as unknown as RequestTelemetry;

  return { telemetry, markTtftCalls, usageRecords };
}

async function streamToString(
  transformer: TransformStream<Uint8Array, Uint8Array>,
  chunks: string[]
): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const writer = transformer.writable.getWriter();
  const reader = transformer.readable.getReader();

  const writePromise = (async () => {
    for (const chunk of chunks) {
      await writer.write(encoder.encode(chunk));
    }
    await writer.close();
  })();

  let result = "";
  const readPromise = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        result += decoder.decode(value);
      }
    }
  })();

  await Promise.all([writePromise, readPromise]);
  return result;
}

describe("Slice 4.1: OpenAIChatTransformer", () => {
  const defaultDirective = parseDirective("lr-or-oa-ch-no")!;
  const tsDirective = parseDirective("lr-or-oa-ch-ts")!;
  const sbDirective = parseDirective("lr-or-oa-ch-sb")!;

  describe("Singleton & Class Export", () => {
    it("exports openAiChatTransformer as singleton instance of OpenAIChatTransformer", () => {
      expect(openAiChatTransformer).toBeInstanceOf(OpenAIChatTransformer);
    });
  });

  describe("transformClientToWire", () => {
    it("maps basic non-streaming client request to wire format", () => {
      const inbound = {
        model: "deepseek-ai/deepseek-r1",
        messages: [{ role: "user", content: "Hello world" }],
        temperature: 0.7,
      };
      const headers = new Headers({
        "x-custom-header": "test-val",
      });

      const wire = openAiChatTransformer.transformClientToWire(
        inbound,
        defaultDirective,
        headers
      );

      expect(wire.endpointKey).toBe("ch");
      expect(wire.method).toBe("POST");
      expect(wire.isStreaming).toBe(false);
      expect(wire.headers["content-type"]).toBe("application/json");
      expect(wire.headers["x-custom-header"]).toBe("test-val");
      expect(wire.body.model).toBe("deepseek-ai/deepseek-r1");
      expect(wire.body.temperature).toBe(0.7);
    });

    it("correctly identifies streaming flag when stream is true", () => {
      const inbound = {
        model: "openai/gpt-4o",
        stream: true,
        messages: [{ role: "user", content: "Hi" }],
      };
      const wire = openAiChatTransformer.transformClientToWire(
        inbound,
        defaultDirective,
        new Headers()
      );

      expect(wire.isStreaming).toBe(true);
      expect(wire.endpointKey).toBe("ch");
      expect(wire.method).toBe("POST");
    });
  });

  describe("transformWireToClient", () => {
    it("scrubs reasoning_content by default on oa wire without ts nuance", () => {
      const upstreamJson = {
        id: "chatcmpl-test",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Final answer.",
              reasoning_content: "Internal reasoning trace that should be scrubbed.",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      };

      const result = openAiChatTransformer.transformWireToClient(
        upstreamJson,
        defaultDirective
      ) as typeof upstreamJson;

      const firstChoice = result.choices[0];
      expect(firstChoice?.message.content).toBe("Final answer.");
      expect(firstChoice?.message.reasoning_content).toBeUndefined();
      // Verifies input was not mutated (pure function)
      expect(upstreamJson.choices[0]?.message.reasoning_content).toBe(
        "Internal reasoning trace that should be scrubbed."
      );
    });

    it("preserves reasoning_content when ts nuance is present", () => {
      const upstreamJson = {
        id: "chatcmpl-test",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Final answer.",
              reasoning_content: "Preserve this thinking trace.",
            },
          },
        ],
      };

      const result = openAiChatTransformer.transformWireToClient(
        upstreamJson,
        tsDirective
      ) as typeof upstreamJson;

      const firstChoice = result.choices[0];
      expect(firstChoice?.message.reasoning_content).toBe(
        "Preserve this thinking trace."
      );
    });

    it("force-scrubs reasoning_content when sb nuance is present", () => {
      const upstreamJson = {
        id: "chatcmpl-test",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Output",
              reasoning_content: "Strip this unconditionally",
            },
          },
        ],
      };

      const result = openAiChatTransformer.transformWireToClient(
        upstreamJson,
        sbDirective
      ) as typeof upstreamJson;

      const firstChoice = result.choices[0];
      expect(firstChoice?.message.reasoning_content).toBeUndefined();
    });

    it("returns non-object upstream data untouched", () => {
      expect(openAiChatTransformer.transformWireToClient(null, defaultDirective)).toBeNull();
      expect(openAiChatTransformer.transformWireToClient("raw string", defaultDirective)).toBe("raw string");
    });
  });

  describe("createWireToClientStream", () => {
    it("calls telemetry.markTtft() on first content chunk and records usage on final chunk", async () => {
      const { telemetry, markTtftCalls, usageRecords } = createMockTelemetry();
      const signal = new AbortController().signal;
      const stream = openAiChatTransformer.createWireToClientStream(
        defaultDirective,
        telemetry,
        signal
      );

      const sseInput = [
        ": ping\n\n",
        'data: {"id":"1","choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"id":"1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"1","choices":[{"delta":{"content":" world"},"finish_reason":"stop"}]}\n\n',
        'data: {"id":"1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15,"completion_tokens_details":{"reasoning_tokens":3}}}\n\n',
        "data: [DONE]\n\n",
      ];

      const output = await streamToString(stream, sseInput);

      expect(output).toContain("data: [DONE]\n\n");
      expect(output).toContain('"content":"Hello"');
      expect(output).toContain('"content":" world"');
      expect(markTtftCalls.length).toBe(1);
      expect(markTtftCalls[0]).toBe("openai");

      expect(usageRecords.length).toBe(1);
      expect(usageRecords[0]).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        reasoningTokens: 3,
        finishReason: "stop",
      });
    });

    it("scrubs reasoning-only chunks by default (oa wire, no ts nuance)", async () => {
      const { telemetry, markTtftCalls } = createMockTelemetry();
      const signal = new AbortController().signal;
      const stream = openAiChatTransformer.createWireToClientStream(
        defaultDirective,
        telemetry,
        signal
      );

      const sseInput = [
        'data: {"id":"1","choices":[{"delta":{"reasoning_content":"Step 1..."}}]}\n\n',
        'data: {"id":"1","choices":[{"delta":{"reasoning_content":"Step 2..."}}]}\n\n',
        'data: {"id":"1","choices":[{"delta":{"content":"Direct answer."}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      const output = await streamToString(stream, sseInput);

      expect(output).not.toContain("Step 1");
      expect(output).not.toContain("Step 2");
      expect(output).not.toContain("reasoning_content");
      expect(output).toContain('"content":"Direct answer."');
      expect(markTtftCalls.length).toBe(1);
    });

    it("preserves reasoning_content chunks when ts nuance is present", async () => {
      const { telemetry, markTtftCalls } = createMockTelemetry();
      const signal = new AbortController().signal;
      const stream = openAiChatTransformer.createWireToClientStream(
        tsDirective,
        telemetry,
        signal
      );

      const sseInput = [
        'data: {"id":"1","choices":[{"delta":{"reasoning_content":"Step 1 thinking..."}}]}\n\n',
        'data: {"id":"1","choices":[{"delta":{"content":"Answer."}}]}\n\n',
        "data: [DONE]\n\n",
      ];

      const output = await streamToString(stream, sseInput);

      expect(output).toContain("Step 1 thinking...");
      expect(output).toContain('"reasoning_content"');
      expect(output).toContain('"content":"Answer."');
      expect(markTtftCalls.length).toBe(1);
    });

    it("handles chunk fragmentation across network packets seamlessly", async () => {
      const { telemetry } = createMockTelemetry();
      const signal = new AbortController().signal;
      const stream = openAiChatTransformer.createWireToClientStream(
        defaultDirective,
        telemetry,
        signal
      );

      // Fragmented packets across SSE boundaries
      const chunk1 = 'data: {"id":"1","choices":[';
      const chunk2 = '{"delta":{"content":"Split ';
      const chunk3 = 'message"}}]}\n\ndata: [DONE]\n\n';

      const output = await streamToString(stream, [chunk1, chunk2, chunk3]);

      expect(output).toContain('"content":"Split message"');
      expect(output).toContain("data: [DONE]\n\n");
    });
  });
});
