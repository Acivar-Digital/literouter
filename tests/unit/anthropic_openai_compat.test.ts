import { describe, expect, it } from "bun:test";
import {
  type AnthropicMessagesRequest,
  createAnthropicStreamTransformer,
  translateAnthropicToOpenAI,
  translateOpenAIToAnthropicResponse,
} from "../../src/handlers/anthropic_compat";

describe("Anthropic -> OpenAI Cross-Wire Translation (ao payload)", () => {
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
    expect(openAi.temperature).toBe(0.7);
    expect(openAi.stream).toBe(true);
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

  it("translates assistant message with tool_use into OpenAI tool_calls", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: "Running command now..." },
            {
              type: "tool_use",
              id: "call_abc123",
              name: "Bash",
              input: { command: "ls -la" },
            },
          ],
        },
      ],
    };

    const openAi = translateAnthropicToOpenAI(req);
    expect(openAi.messages[0]).toEqual({
      role: "assistant",
      content: "Running command now...",
      tool_calls: [
        {
          id: "call_abc123",
          type: "function",
          function: {
            name: "Bash",
            arguments: '{"command":"ls -la"}',
          },
        },
      ],
    });
  });

  it("translates assistant message with only tool_use (content: null)", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      messages: [
        {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "call_only_tool",
              name: "GlobTool",
              input: { pattern: "**/*.ts" },
            },
          ],
        },
      ],
    };

    const openAi = translateAnthropicToOpenAI(req);
    expect(openAi.messages[0]).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [
        {
          id: "call_only_tool",
          type: "function",
          function: {
            name: "GlobTool",
            arguments: '{"pattern":"**/*.ts"}',
          },
        },
      ],
    });
  });

  it("translates user message containing tool_result blocks into OpenAI tool role messages", () => {
    const req: AnthropicMessagesRequest = {
      model: "test-model",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "call_abc123",
              content: "file1.ts\nfile2.ts",
            },
            {
              type: "text",
              text: "Now check file1.ts",
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
        content: "file1.ts\nfile2.ts",
      },
      {
        role: "user",
        content: "Now check file1.ts",
      },
    ]);
  });
});

describe("OpenAI -> Anthropic Response Translation (Non-Streaming)", () => {
  it("translates plain text OpenAI response to Anthropic message format", () => {
    const openAiRes = {
      id: "chatcmpl-test01",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Here is the code solution.",
          },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 25, completion_tokens: 50, total_tokens: 75 },
    };

    const anthropic = translateOpenAIToAnthropicResponse(openAiRes, "dots-3");
    expect(anthropic.id).toBe("chatcmpl-test01");
    expect(anthropic.type).toBe("message");
    expect(anthropic.role).toBe("assistant");
    expect(anthropic.content).toEqual([{ type: "text", text: "Here is the code solution." }]);
    expect(anthropic.stop_reason).toBe("end_turn");
    expect(anthropic.usage).toEqual({ prompt_tokens: 25, completion_tokens: 50, total_tokens: 75 });
  });

  it("translates tool_calls in OpenAI response to Anthropic tool_use content blocks", () => {
    const openAiRes = {
      id: "chatcmpl-test02",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Checking status...",
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
    };

    const anthropic = translateOpenAIToAnthropicResponse(openAiRes, "dots-3");
    expect(anthropic.content).toEqual([
      { type: "text", text: "Checking status..." },
      {
        type: "tool_use",
        id: "call_987",
        name: "Bash",
        input: { command: "git status" },
      },
    ]);
    expect(anthropic.stop_reason).toBe("tool_use");
  });
});

describe("OpenAI -> Anthropic SSE Stream Transformation", () => {
  it("transforms text chunks into Anthropic SSE events", async () => {
    const transformer = createAnthropicStreamTransformer("test-model");
    const openAiChunks = [
      'data: {"id":"c1","choices":[{"delta":{"role":"assistant","content":"Hello "}}]}\n\n',
      'data: {"id":"c1","choices":[{"delta":{"content":"world!"}}]}\n\n',
      'data: {"id":"c1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
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
    expect(fullOutput).toContain('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"');
    expect(fullOutput).toContain("event: message_stop");
  });

  it("transforms tool_calls chunks into Anthropic tool_use SSE events", async () => {
    const transformer = createAnthropicStreamTransformer("test-model");
    const openAiChunks = [
      'data: {"id":"c2","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_test_01","type":"function","function":{"name":"Bash","arguments":""}}]}}]}\n\n',
      'data: {"id":"c2","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"cmd\\":\\"pwd\\"}"}}]}}]}\n\n',
      'data: {"id":"c2","choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
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
    expect(fullOutput).toContain('"type":"tool_use","id":"call_test_01","name":"Bash"');
    expect(fullOutput).toContain('"type":"input_json_delta","partial_json":"{\\"cmd\\":\\"pwd\\"}"');
    expect(fullOutput).toContain("event: content_block_stop");
    expect(fullOutput).toContain('event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use"');
    expect(fullOutput).toContain("event: message_stop");
  });
});
