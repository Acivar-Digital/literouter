import { describe, expect, it } from "bun:test";
import {
  transformOpenAiToResponses,
  transformResponsesToOpenAi,
  createResponsesStreamTransformer,
} from "../../src/transformers/responses";

describe("Responses Transformer Suite", () => {
  describe("transformOpenAiToResponses", () => {
    it("converts OpenAI messages to Responses input format", () => {
      const payload = {
        model: "muse-spark-1.3-contributor-free",
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "Hello there" },
        ],
        temperature: 0.7,
        top_p: 0.9,
        max_tokens: 500,
        stream: true,
        reasoning_effort: "high",
      };

      const transformed = transformOpenAiToResponses(payload);

      expect(transformed.model).toBe("muse-spark-1.3-contributor-free");
      expect(transformed.stream).toBe(true);
      expect(transformed.temperature).toBe(0.7);
      expect(transformed.top_p).toBe(0.9);
      expect(transformed.max_output_tokens).toBe(500);
      expect(transformed.reasoning).toEqual({ effort: "high" });
      expect(transformed.input).toEqual([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello there" },
      ]);
    });

    it("handles complex content part arrays in messages", () => {
      const payload = {
        model: "muse-spark-1.3-contributor-free",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Part 1 " },
              { type: "text", text: "Part 2" },
            ],
          },
        ],
      };

      const transformed = transformOpenAiToResponses(payload);
      expect(transformed.input).toEqual([
        { role: "user", content: "Part 1 Part 2" },
      ]);
    });
  });

  describe("transformResponsesToOpenAi", () => {
    it("transforms structured Responses API JSON into OpenAI chat.completion format", () => {
      const responsesPayload = {
        id: "resp_6a9d87b927e4d1b9101c4d7a",
        object: "response",
        created_at: 1788708793,
        completed_at: 1788708793,
        status: "completed",
        model: "muse-spark-1.3-contributor-free",
        output: [
          {
            id: "rs_reasoning_123",
            type: "reasoning",
            status: "completed",
            encrypted_content: "encrypted-blob",
            summary: [],
          },
          {
            id: "msg_output_456",
            type: "message",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Hello from Muse!",
                annotations: [],
                logprobs: [],
              },
            ],
          },
        ],
        usage: {
          input_tokens: 19,
          output_tokens: 193,
          total_tokens: 212,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 182 },
        },
      };

      const openAiResp = transformResponsesToOpenAi(responsesPayload);

      expect(openAiResp.id).toBe("resp_6a9d87b927e4d1b9101c4d7a");
      expect(openAiResp.object).toBe("chat.completion");
      expect(openAiResp.created).toBe(1788708793);
      expect(openAiResp.model).toBe("muse-spark-1.3-contributor-free");
      expect(openAiResp.choices).toHaveLength(1);
      expect(openAiResp.choices[0]!.finish_reason).toBe("stop");
      expect(openAiResp.choices[0]!.message.role).toBe("assistant");
      expect(openAiResp.choices[0]!.message.content).toBe("Hello from Muse!");
      expect(openAiResp.usage).toBeDefined();
      expect(openAiResp.usage?.prompt_tokens).toBe(19);
      expect(openAiResp.usage?.completion_tokens).toBe(193);
      expect(openAiResp.usage?.total_tokens).toBe(212);
      expect(openAiResp.usage?.completion_tokens_details?.reasoning_tokens).toBe(182);
    });

    it("handles fallback to output_text if output array is absent", () => {
      const responsesPayload = {
        id: "resp_fallback_1",
        created_at: 1788708000,
        model: "muse-spark-1.3-contributor-free",
        output_text: "Direct output text",
      };

      const openAiResp = transformResponsesToOpenAi(responsesPayload);
      expect(openAiResp.choices[0]!.message.content).toBe("Direct output text");
    });
  });

  describe("createResponsesStreamTransformer", () => {
    it("transforms Responses SSE stream events into standard OpenAI chat.completion.chunk SSE stream", async () => {
      const transformer = createResponsesStreamTransformer("muse-spark-1.3-contributor-free");

      const inputSse = [
        `event: response.created\n`,
        `data: {"type":"response.created","response":{"id":"resp_stream_123","model":"muse-spark-1.3-contributor-free","created_at":1788708800}}\n\n`,
        `event: response.output_text.delta\n`,
        `data: {"type":"response.output_text.delta","delta":"Hello "}\n\n`,
        `event: response.output_text.delta\n`,
        `data: {"type":"response.output_text.delta","delta":"world!"}\n\n`,
        `event: response.completed\n`,
        `data: {"type":"response.completed","response":{"id":"resp_stream_123","usage":{"input_tokens":10,"output_tokens":20,"total_tokens":30,"output_tokens_details":{"reasoning_tokens":15}}}}\n\n`,
      ];

      const encoder = new TextEncoder();
      const decoder = new TextDecoder();

      const stream = new ReadableStream({
        start(controller) {
          for (const chunk of inputSse) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const transformedStream = stream.pipeThrough(transformer);
      const reader = transformedStream.getReader();

      let output = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value);
      }

      expect(output).toContain("data: [DONE]");
      expect(output).toContain('"role":"assistant"');
      expect(output).toContain('"content":"Hello "');
      expect(output).toContain('"content":"world!"');
      expect(output).toContain('"finish_reason":"stop"');
      expect(output).toContain('"reasoning_tokens":15');
    });
  });
});
