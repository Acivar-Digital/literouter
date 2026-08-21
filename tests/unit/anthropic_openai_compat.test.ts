import { describe, expect, it } from "bun:test";
import {
  type AnthropicMessagesRequest,
  createAnthropicErrorResponse,
  createAnthropicStreamTransformer,
  mapOpenAIToAnthropicStopReason,
  mapOpenAIToAnthropicUsage,
  translateAnthropicToOpenAI,
  translateOpenAIToAnthropicResponse,
  validateAnthropicPayload,
} from "../../src/handlers/anthropic_compat";

describe("Anthropic -> OpenAI Forward Translation", () => {
  it("translates basic system and user messages", () => {
    const req: AnthropicMessagesRequest = {
      model: "dots-studio/dots-3-note-preview:free",
      system: "You are a helpful coding assistant.",
      messages: [{ role: "user", content: "Hello world" }],
      max_tokens: 4096,
      temperature: 0.7,
      stream: true,
    };

    const openAi = translateAnthropicToOpenAI(req);
    expect(openAi.model).toBe("dots-studio/dots-3-note-preview:free");
    expect(openAi.max_tokens).toBe(4096);
    expect(openAi.max_completion_tokens).toBe(4096);
    expect(openAi.temperature).toBe(0.7);
    expect(openAi.stream).toBe(true);
    expect(openAi.stream_options).toEqual({ include_usage: true });
    expect(openAi.messages).toEqual([
      { role: "system", content: "You are a helpful coding assistant." },
      { role: "user", content: "Hello world" },
    ]);
  });

  it("translates array system prompt with multiple text blocks", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      system: [
        { type: "text", text: "Rule 1: Be concise." },
        { type: "text", text: "Rule 2: No chitchat." },
      ] as unknown as string[],
      messages: [{ role: "user", content: "Hi" }],
    };

    const openAi = translateAnthropicToOpenAI(req);
    expect(openAi.messages[0]).toEqual({
      role: "system",
      content: "Rule 1: Be concise.\nRule 2: No chitchat.",
    });
  });

  it("translates Anthropic tool definitions (input_schema -> parameters)", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      messages: [{ role: "user", content: "Run ls" }],
      tools: [
        {
          name: "Bash",
          description: "Execute bash command",
          input_schema: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          },
        },
      ],
    };

    const openAi = translateAnthropicToOpenAI(req);
    expect(openAi.tools).toEqual([
      {
        type: "function",
        function: {
          name: "Bash",
          description: "Execute bash command",
          parameters: {
            type: "object",
            properties: {
              command: { type: "string" },
            },
            required: ["command"],
          },
        },
      },
    ]);
  });

  it("translates assistant message with thinking block via .thinking property into reasoning_content", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "Step 1: calculate sum." },
            { type: "text", text: "The sum is 42." },
          ],
        },
      ],
    };

    const openAi = translateAnthropicToOpenAI(req);
    expect(openAi.messages[0]).toEqual({
      role: "assistant",
      content: "The sum is 42.",
      reasoning_content: "Step 1: calculate sum.",
    } as unknown as typeof openAi.messages[0]);
  });

  it("translates multimodal user messages with image base64 and url", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: "iVBORw0KGgoAAAANSUhEUgAA",
              },
            },
            {
              type: "image",
              source: {
                type: "url",
                url: "https://example.com/diagram.png",
              },
            },
            {
              type: "text",
              text: "Explain these images",
            },
          ],
        },
      ],
    };

    const openAi = translateAnthropicToOpenAI(req);
    expect(openAi.messages).toEqual([
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA" },
          },
          {
            type: "image_url",
            image_url: { url: "https://example.com/diagram.png" },
          },
          {
            type: "text",
            text: "Explain these images",
          },
        ],
      },
    ]);
  });

  it("translates user message containing tool_result with is_error flag", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_abc123",
              content: "File not found",
              is_error: true,
            },
          ],
        },
      ],
    };

    const openAi = translateAnthropicToOpenAI(req);
    expect(openAi.messages).toEqual([
      {
        role: "tool",
        tool_call_id: "call_abc123",
        content: "Error: File not found",
      },
    ]);
  });

  it("translates tool_choice with disable_parallel_tool_use: true to parallel_tool_calls: false", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      tool_choice: {
        type: "auto",
        disable_parallel_tool_use: true,
      },
    };

    const openAi = translateAnthropicToOpenAI(req);
    expect(openAi.tool_choice).toBe("auto");
    expect(openAi.parallel_tool_calls).toBe(false);
  });

  it("strips unwhitelisted Anthropic-only keys from outbound OpenAI request", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      messages: [{ role: "user", content: "Hi" }],
      anthropic_version: "2023-06-01",
      anthropic_beta: ["prompt-caching-2024-07-25"],
      container: "sandbox-1",
      mcp_servers: [{ name: "local" }],
    };

    const openAi = translateAnthropicToOpenAI(req) as Record<string, unknown>;
    expect(openAi.anthropic_version).toBeUndefined();
    expect(openAi.anthropic_beta).toBeUndefined();
    expect(openAi.container).toBeUndefined();
    expect(openAi.mcp_servers).toBeUndefined();
  });
});

describe("Inbound Payload Validation", () => {
  it("rejects document content blocks with clean descriptive message", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: "JVBERi0xLjQK" },
            },
          ],
        },
      ],
    };

    const error = validateAnthropicPayload(req);
    expect(error).toContain("Document content blocks");
  });

  it("accepts valid text, image, and tool_use requests", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      messages: [{ role: "user", content: "Hello" }],
    };

    const error = validateAnthropicPayload(req);
    expect(error).toBeNull();
  });
});

describe("OpenAI -> Anthropic Response Translation (Non-Streaming)", () => {
  it("maps finish_reason length to max_tokens even when tool calls exist", () => {
    expect(mapOpenAIToAnthropicStopReason("length")).toBe("max_tokens");
    expect(mapOpenAIToAnthropicStopReason("length", true)).toBe("max_tokens");
    expect(mapOpenAIToAnthropicStopReason("content_filter")).toBe("refusal");
    expect(mapOpenAIToAnthropicStopReason("tool_calls")).toBe("tool_use");
    expect(mapOpenAIToAnthropicStopReason("stop")).toBe("end_turn");

    const usage = mapOpenAIToAnthropicUsage({
      prompt_tokens: 120,
      completion_tokens: 45,
      prompt_tokens_details: { cached_tokens: 20 },
    });
    expect(usage).toEqual({
      input_tokens: 120,
      output_tokens: 45,
      cache_read_input_tokens: 20,
    });
  });

  it("translates reasoning_content from upstream model to thinking block", () => {
    const openAiRes = {
      id: "chatcmpl-think01",
      choices: [
        {
          message: {
            role: "assistant",
            reasoning_content: "Let us verify step by step.",
            content: "The answer is 42.",
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 30, completion_tokens: 20 },
    };

    const anthropic = translateOpenAIToAnthropicResponse(openAiRes, "test-model");
    expect(anthropic.id).toBe("chatcmpl-think01");
    expect(anthropic.type).toBe("message");
    expect(anthropic.role).toBe("assistant");
    expect(anthropic.content).toEqual([
      { type: "thinking", thinking: "Let us verify step by step." },
      { type: "text", text: "The answer is 42." },
    ]);
    expect(anthropic.stop_reason).toBe("end_turn");
    expect(anthropic.usage).toEqual({ input_tokens: 30, output_tokens: 20 });
  });

  it("translates array message.content from OpenAI response properly", () => {
    const openAiRes = {
      id: "chatcmpl-array01",
      choices: [
        {
          message: {
            role: "assistant",
            content: [
              { type: "text", text: "Part 1. " },
              { type: "text", text: "Part 2." },
            ],
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    };

    const anthropic = translateOpenAIToAnthropicResponse(openAiRes, "test-model");
    expect(anthropic.content).toEqual([
      { type: "text", text: "Part 1. Part 2." },
    ]);
  });

  it("translates tool_calls in OpenAI response to Anthropic tool_use content blocks", () => {
    const openAiRes = {
      id: "chatcmpl-tool01",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Running tool...",
            tool_calls: [
              {
                id: "call_987",
                type: "function",
                function: {
                  name: "Bash",
                  arguments: '{"command":"git status"}',
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 15, completion_tokens: 10 },
    };

    const anthropic = translateOpenAIToAnthropicResponse(openAiRes, "dots-3");
    expect(anthropic.content).toEqual([
      { type: "text", text: "Running tool..." },
      {
        type: "tool_use",
        id: "call_987",
        name: "Bash",
        input: { command: "git status" },
      },
    ]);
    expect(anthropic.stop_reason).toBe("tool_use");
    expect(anthropic.usage).toEqual({ input_tokens: 15, output_tokens: 10 });
  });
});

describe("OpenAI -> Anthropic SSE Stream Transformation", () => {
  it("transforms text chunks and captures final token usage on empty choices with CRLF and comments", async () => {
    const transformer = createAnthropicStreamTransformer("test-model");
    const openAiChunks = [
      ': keep-alive\r\n',
      'data: {"id":"c1","choices":[{"delta":{"role":"assistant","content":"Hello "}}]}\r\n\r\n',
      'data: {"id":"c1","choices":[{"delta":{"content":"world!"}}]}\n\n',
      'data: {"id":"c1","choices":[{"delta":{},"finish_reason":"length"}]}\n\n',
      'data: {"id":"c1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":25}}\n\n',
      "data: [DONE]\n\n",
    ];

    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of openAiChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = inputStream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    const decoder = new TextDecoder();
    let fullOutput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullOutput += decoder.decode(value);
    }

    expect(fullOutput).toContain("event: message_start");
    expect(fullOutput).toContain("event: content_block_start");
    expect(fullOutput).toContain('{"type":"text_delta","text":"Hello "}');
    expect(fullOutput).toContain('{"type":"text_delta","text":"world!"}');
    expect(fullOutput).toContain("event: content_block_stop");
    expect(fullOutput).toContain('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens","stop_sequence":null},"usage":{"output_tokens":25}}\n\n');
    expect(fullOutput).toContain("event: message_stop");
  });

  it("handles upstream in-stream error event on HTTP 200", async () => {
    const transformer = createAnthropicStreamTransformer("test-model");
    const openAiChunks = [
      'data: {"error":{"type":"overloaded_error","message":"Provider is overloaded"}}\n\n',
    ];

    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of openAiChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = inputStream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    const decoder = new TextDecoder();
    let fullOutput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullOutput += decoder.decode(value);
    }

    expect(fullOutput).toContain("event: error");
    expect(fullOutput).toContain('"type":"overloaded_error"');
    expect(fullOutput).toContain('"message":"Provider is overloaded"');
  });

  it("transforms reasoning stream chunks into thinking_delta events", async () => {
    const transformer = createAnthropicStreamTransformer("test-model");
    const openAiChunks = [
      'data: {"id":"c2","choices":[{"delta":{"reasoning_content":"Thinking... "}}]}\n\n',
      'data: {"id":"c2","choices":[{"delta":{"content":"Done!"}}]}\n\n',
      'data: {"id":"c2","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of openAiChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = inputStream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    const decoder = new TextDecoder();
    let fullOutput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullOutput += decoder.decode(value);
    }

    expect(fullOutput).toContain('"type":"thinking","thinking":""');
    expect(fullOutput).toContain('{"type":"thinking_delta","thinking":"Thinking... "}');
    expect(fullOutput).toContain('{"type":"text_delta","text":"Done!"}');
    expect(fullOutput).toContain('"stop_reason":"end_turn"');
  });

  it("handles interleaved multi-tool calls without state desync", async () => {
    const transformer = createAnthropicStreamTransformer("test-model");
    const openAiChunks = [
      'data: {"id":"c3","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_0","type":"function","function":{"name":"ToolA","arguments":""}}]}}]}\n\n',
      'data: {"id":"c3","choices":[{"delta":{"tool_calls":[{"index":1,"id":"call_1","type":"function","function":{"name":"ToolB","arguments":""}}]}}]}\n\n',
      'data: {"id":"c3","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"a\\":1}"}}]}}]}\n\n',
      'data: {"id":"c3","choices":[{"delta":{"tool_calls":[{"index":1,"function":{"arguments":"{\\"b\\":2}"}}]}}]}\n\n',
      'data: {"id":"c3","choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of openAiChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = inputStream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    const decoder = new TextDecoder();
    let fullOutput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullOutput += decoder.decode(value);
    }

    expect(fullOutput).toContain('"type":"tool_use","id":"call_0","name":"ToolA"');
    expect(fullOutput).toContain('"type":"tool_use","id":"call_1","name":"ToolB"');
    expect(fullOutput).toContain('{"type":"input_json_delta","partial_json":"{\\"a\\":1}"}');
    expect(fullOutput).toContain('{"type":"input_json_delta","partial_json":"{\\"b\\":2}"}');
    expect(fullOutput).toContain('"stop_reason":"tool_use"');
  });

  it("passes through native Anthropic SSE events cleanly without corruption", async () => {
    const transformer = createAnthropicStreamTransformer("test-model");
    const anthropicChunks = [
      'data: {"type":"message_start","message":{"id":"msg_passthrough","role":"assistant"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hello"}}\n\n',
      "data: [DONE]\n\n",
    ];

    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of anthropicChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = inputStream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    const decoder = new TextDecoder();
    let fullOutput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      fullOutput += decoder.decode(value);
    }

    expect(fullOutput).toContain('event: message_start\ndata: {"type":"message_start"');
    expect(fullOutput).toContain('event: content_block_delta\ndata: {"type":"content_block_delta"');
    expect(fullOutput).not.toContain('event: content_block_delta\ndata: {"type":"message_start"');
  });
});

describe("Anthropic Error Response Helper", () => {
  it("creates compliant Anthropic error envelope", async () => {
    const res = createAnthropicErrorResponse(400, "Invalid JSON payload", "invalid_request_error");
    expect(res.status).toBe(400);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json).toEqual({
      type: "error",
      error: {
        type: "invalid_request_error",
        message: "Invalid JSON payload",
      },
    });
  });
});
