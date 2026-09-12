import { describe, expect, it, mock } from "bun:test";
import type { ParsedDirective } from "../../../src/directive/types";
import type { RequestTelemetry, UsageRecord } from "../../../src/telemetry/session";
import {
  AnthropicOpenAIXWireTransformer,
  anthropicOpenAiXWireTransformer,
} from "../../../src/transformers/anthropic_openai_xwire";

const dummyDirective: ParsedDirective = {
  type: "direct",
  provider: "or",
  payload: "ao",
  completion: "ch",
  nuances: ["no"],
  rawKey: "lr-or-ao-ch-no",
} as unknown as ParsedDirective;

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

describe("AnthropicOpenAIXWireTransformer", () => {
  it("exports singleton instance", () => {
    expect(anthropicOpenAiXWireTransformer).toBeInstanceOf(AnthropicOpenAIXWireTransformer);
  });

  describe("transformClientToWire", () => {
    it("transforms basic system and user messages to OpenAI Chat wire format", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const inbound = {
        model: "openai/gpt-4o",
        system: "You are a helpful assistant.",
        messages: [{ role: "user", content: "Hello world" }],
        max_tokens: 1024,
        temperature: 0.7,
      };

      const result = transformer.transformClientToWire(inbound, dummyDirective, new Headers());

      expect(result.endpointKey).toBe("ch");
      expect(result.method).toBe("POST");
      expect(result.isStreaming).toBe(false);
      expect(result.headers).toEqual({ "Content-Type": "application/json" });

      const body = result.body;
      expect(body.model).toBe("openai/gpt-4o");
      expect(body.temperature).toBe(0.7);
      expect(body.max_tokens).toBe(32768);
      expect(body.messages).toEqual([
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello world" },
      ]);
    });

    it("detects streaming when stream is true", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const inbound = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Hello stream" }],
        stream: true,
      };

      const result = transformer.transformClientToWire(inbound, dummyDirective, new Headers());
      expect(result.isStreaming).toBe(true);
      expect(result.body.stream).toBe(true);
    });

    it("translates array system message into joined string", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const inbound = {
        model: "openai/gpt-4o",
        system: [
          { type: "text", text: "Line 1" },
          { type: "text", text: "Line 2" },
        ],
        messages: [{ role: "user", content: "Hi" }],
      };

      const result = transformer.transformClientToWire(inbound, dummyDirective, new Headers());
      const messages = result.body.messages as Array<Record<string, unknown>>;
      expect(messages[0]).toEqual({
        role: "system",
        content: "Line 1\nLine 2",
      });
    });

    it("translates tools from Anthropic input_schema to OpenAI parameters", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const inbound = {
        model: "openai/gpt-4o",
        messages: [{ role: "user", content: "Fetch weather" }],
        tools: [
          {
            name: "get_weather",
            description: "Get current weather",
            input_schema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
        ],
      };

      const result = transformer.transformClientToWire(inbound, dummyDirective, new Headers());
      const tools = result.body.tools as Array<{ type: string; function: Record<string, unknown> }>;
      expect(tools).toHaveLength(1);
      expect(tools[0]).toEqual({
        type: "function",
        function: {
          name: "get_weather",
          description: "Get current weather",
          parameters: {
            type: "object",
            properties: { location: { type: "string" } },
            required: ["location"],
          },
        },
      });
    });

    it("translates tool_choice options", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const inboundAuto = {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        tool_choice: { type: "auto" },
      };
      expect(transformer.transformClientToWire(inboundAuto, dummyDirective, new Headers()).body.tool_choice).toBe("auto");

      const inboundAny = {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        tool_choice: { type: "any" },
      };
      expect(transformer.transformClientToWire(inboundAny, dummyDirective, new Headers()).body.tool_choice).toBe("required");

      const inboundNamed = {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        tool_choice: { type: "tool", name: "calculator", disable_parallel_tool_use: true },
      };
      const namedRes = transformer.transformClientToWire(inboundNamed, dummyDirective, new Headers());
      expect(namedRes.body.tool_choice).toEqual({
        type: "function",
        function: { name: "calculator" },
      });
      expect(namedRes.body.parallel_tool_calls).toBe(false);
    });

    it("translates user tool_result block into tool message", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const inbound = {
        model: "m",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "call_abc123",
                content: "Sunny, 72F",
              },
            ],
          },
        ],
      };

      const result = transformer.transformClientToWire(inbound, dummyDirective, new Headers());
      const messages = result.body.messages as Array<Record<string, unknown>>;
      expect(messages).toEqual([
        {
          role: "tool",
          tool_call_id: "call_abc123",
          content: "Sunny, 72F",
        },
      ]);
    });

    it("translates user image block into image_url", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const inbound = {
        model: "m",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: "iVBORw0KGgoAAAANSUhEUg==",
                },
              },
            ],
          },
        ],
      };

      const result = transformer.transformClientToWire(inbound, dummyDirective, new Headers());
      const messages = result.body.messages as Array<{ role: string; content: Array<{ type: string; image_url: { url: string } }> }>;
      const firstMsg = messages[0];
      const firstContent = firstMsg?.content?.[0];
      expect(firstContent).toEqual({
        type: "image_url",
        image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" },
      });
    });

    it("translates assistant thinking and tool_use blocks into OpenAI assistant message", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const inbound = {
        model: "m",
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "I should calculate 2+2" },
              { type: "text", text: "Let me check." },
              {
                type: "tool_use",
                id: "call_calc1",
                name: "calc",
                input: { expression: "2+2" },
              },
            ],
          },
        ],
      };

      const result = transformer.transformClientToWire(inbound, dummyDirective, new Headers());
      const messages = result.body.messages as Array<Record<string, unknown>>;
      const firstMsg = messages[0];
      expect(firstMsg).toBeDefined();
      expect(firstMsg?.role).toBe("assistant");
      expect(firstMsg?.content).toBe("Let me check.");
      expect(firstMsg?.reasoning_content).toBe("I should calculate 2+2");
      expect(firstMsg?.tool_calls).toEqual([
        {
          id: "call_calc1",
          type: "function",
          function: {
            name: "calc",
            arguments: JSON.stringify({ expression: "2+2" }),
          },
        },
      ]);
    });
  });

  describe("transformWireToClient", () => {
    it("translates standard OpenAI completion into Anthropic message format", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const upstreamJson = {
        id: "chatcmpl-test999",
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello from OpenAI!",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 12,
          completion_tokens: 8,
          total_tokens: 20,
        },
      };

      const result = transformer.transformWireToClient(upstreamJson, dummyDirective) as Record<string, unknown>;
      expect(result.id).toBe("chatcmpl-test999");
      expect(result.type).toBe("message");
      expect(result.role).toBe("assistant");
      expect(result.model).toBe("gpt-4o");
      expect(result.stop_reason).toBe("end_turn");
      expect(result.content).toEqual([{ type: "text", text: "Hello from OpenAI!" }]);
      expect(result.usage).toEqual({ input_tokens: 12, output_tokens: 8 });
    });

    it("translates reasoning_content and tool_calls into Anthropic content blocks", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const upstreamJson = {
        id: "chatcmpl-tool",
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "I will check the weather.",
              reasoning_content: "Checking San Francisco weather forecast.",
              tool_calls: [
                {
                  id: "call_w1",
                  type: "function",
                  function: {
                    name: "get_weather",
                    arguments: JSON.stringify({ city: "San Francisco" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: {
          prompt_tokens: 25,
          completion_tokens: 30,
        },
      };

      const result = transformer.transformWireToClient(upstreamJson, dummyDirective) as Record<string, unknown>;
      expect(result.stop_reason).toBe("tool_use");
      const content = result.content as Array<Record<string, unknown>>;
      expect(content).toHaveLength(3);
      expect(content[0]).toEqual({ type: "thinking", thinking: "Checking San Francisco weather forecast." });
      expect(content[1]).toEqual({ type: "text", text: "I will check the weather." });
      expect(content[2]).toEqual({
        type: "tool_use",
        id: "call_w1",
        name: "get_weather",
        input: { city: "San Francisco" },
      });
    });

    it("maps finish_reason length to max_tokens", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const upstreamJson = {
        id: "chatcmpl-len",
        model: "gpt-4o",
        choices: [
          {
            message: { role: "assistant", content: "Truncated text..." },
            finish_reason: "length",
          },
        ],
      };

      const result = transformer.transformWireToClient(upstreamJson, dummyDirective) as Record<string, unknown>;
      expect(result.stop_reason).toBe("max_tokens");
    });

    it("handles empty upstream response gracefully", () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const result = transformer.transformWireToClient(null, dummyDirective) as Record<string, unknown>;
      expect(result.type).toBe("message");
      expect(result.role).toBe("assistant");
      expect(result.stop_reason).toBe("end_turn");
      expect(result.content).toEqual([{ type: "text", text: "" }]);
    });
  });

  describe("createWireToClientStream", () => {
    it("translates OpenAI SSE stream chunks into Anthropic SSE stream events", async () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const { telemetry, markTtft, recordUsage } = createMockTelemetry();
      const abortController = new AbortController();

      const stream = transformer.createWireToClientStream(dummyDirective, telemetry, abortController.signal);

      const sseChunks = [
        'data: {"id":"chatcmpl-s1","model":"gpt-4o","choices":[{"delta":{"role":"assistant"}}]}\n\n',
        'data: {"id":"chatcmpl-s1","model":"gpt-4o","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"chatcmpl-s1","model":"gpt-4o","choices":[{"delta":{"content":" world!"}}]}\n\n',
        'data: {"id":"chatcmpl-s1","model":"gpt-4o","choices":[{"finish_reason":"stop"}]}\n\n',
        'data: {"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n',
        "data: [DONE]\n\n",
      ];

      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const transformedReadable = readable.pipeThrough(stream);
      const outputText = await streamToString(transformedReadable);

      expect(outputText).toContain("event: message_start");
      expect(outputText).toContain("event: content_block_start");
      expect(outputText).toContain("event: content_block_delta");
      expect(outputText).toContain("event: content_block_stop");
      expect(outputText).toContain("event: message_delta");
      expect(outputText).toContain("event: message_stop");
      expect(outputText).toContain('"text":"Hello"');
      expect(outputText).toContain('"text":" world!"');

      // Verify telemetry calls
      expect(markTtft).toHaveBeenCalledTimes(1);
      expect(recordUsage).toHaveBeenCalledTimes(1);
      expect(recordUsage).toHaveBeenCalledWith({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        finishReason: "end_turn",
      });
    });

    it("translates streaming reasoning chunks into thinking events", async () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const { telemetry, markTtft } = createMockTelemetry();
      const abortController = new AbortController();

      const stream = transformer.createWireToClientStream(dummyDirective, telemetry, abortController.signal);

      const sseChunks = [
        'data: {"id":"chatcmpl-s2","model":"gpt-4o","choices":[{"delta":{"reasoning_content":"Thinking deeply..."}}]}\n\n',
        'data: {"id":"chatcmpl-s2","model":"gpt-4o","choices":[{"delta":{"content":"Done thinking."}}]}\n\n',
        'data: {"id":"chatcmpl-s2","model":"gpt-4o","choices":[{"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ];

      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const outputText = await streamToString(readable.pipeThrough(stream));

      expect(markTtft).toHaveBeenCalledTimes(1);
      expect(outputText).toContain('"type":"thinking"');
      expect(outputText).toContain('"type":"thinking_delta"');
      expect(outputText).toContain('"thinking":"Thinking deeply..."');
      expect(outputText).toContain('"text":"Done thinking."');
    });

    it("translates streaming tool call chunks into tool_use content blocks", async () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const { telemetry } = createMockTelemetry();
      const abortController = new AbortController();

      const stream = transformer.createWireToClientStream(dummyDirective, telemetry, abortController.signal);

      const sseChunks = [
        'data: {"id":"chatcmpl-s3","model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_dyn1","function":{"name":"search","arguments":""}}]}}]}\n\n',
        'data: {"id":"chatcmpl-s3","model":"gpt-4o","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"query\\": \\"lite\\"}}"}}]}}]}\n\n',
        'data: {"id":"chatcmpl-s3","model":"gpt-4o","choices":[{"finish_reason":"tool_calls"}]}\n\n',
        "data: [DONE]\n\n",
      ];

      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          for (const chunk of sseChunks) {
            controller.enqueue(encoder.encode(chunk));
          }
          controller.close();
        },
      });

      const outputText = await streamToString(readable.pipeThrough(stream));

      expect(outputText).toContain('"type":"tool_use"');
      expect(outputText).toContain('"name":"search"');
      expect(outputText).toContain('"type":"input_json_delta"');
      expect(outputText).toContain('{\\"query\\": \\"lite\\"}');
      expect(outputText).toContain('"stop_reason":"tool_use"');
    });

    it("handles pre-aborted clientSignal without emitting chunks", async () => {
      const transformer = new AnthropicOpenAIXWireTransformer();
      const { telemetry } = createMockTelemetry();
      const abortController = new AbortController();
      abortController.abort();

      const stream = transformer.createWireToClientStream(dummyDirective, telemetry, abortController.signal);

      const readable = new ReadableStream<Uint8Array>({
        start(controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Aborted"}}]}\n\n'));
          controller.close();
        },
      });

      const outputText = await streamToString(readable.pipeThrough(stream));
      expect(outputText).toBe("");
    });
  });
});
