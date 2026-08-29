import { describe, expect, it } from "bun:test";
import {
  parseLingXml,
  createLingStreamTransformer,
  stripLingLeakedTemplateTags,
  transformLingRequest,
  transformLingResponse,
} from "../../src/transformers/ling";
import type { OpenAIRequestPayload } from "../../src/transformers/nuances";

describe("Ling Transformer & Streaming Suite", () => {
  it("strips control tokens like [gMASK] and <role>", () => {
    const raw = "[gMASK]<|startoftext|><role>assistant</role>Hello World<|role_end|>";
    expect(stripLingLeakedTemplateTags(raw)).toBe("Hello World");
  });

  it("transforms Ling requests: injects XML tools to system prompt, formats tool history, strips tools JSON and sets stop tokens", () => {
    const incoming: OpenAIRequestPayload = {
      model: "openrouter/ling-3.0-flash",
      messages: [
        { role: "system", content: "You are a helpful coding assistant." },
        { role: "user", content: "Check files" },
        {
          role: "assistant",
          content: "Let me check.",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "bash",
                arguments: JSON.stringify({ command: "ls -la" }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_123",
          content: "total 0\n-rw-r--r-- file.txt",
        },
      ],
      tools: [
        {
          type: "function",
          function: {
            name: "bash",
            description: "Run shell command",
            parameters: {
              type: "object",
              properties: { command: { type: "string" } },
            },
          },
        },
      ],
      tool_choice: "auto",
    };

    const transformed = transformLingRequest(incoming);

    // 1. Root tools and tool_choice must be stripped to avoid upstream 400
    expect((transformed as Record<string, unknown>).tools).toBeUndefined();
    expect((transformed as Record<string, unknown>).tool_choice).toBeUndefined();

    // 2. Stop tokens are not forcefully overwritten unless provided in request
    expect(transformed.stop).toBeUndefined();

    // 3. System prompt must include <tools> definition and execution rules
    const sysMsg = transformed.messages.find((m) => m.role === "system");
    expect(typeof sysMsg?.content).toBe("string");
    expect(sysMsg?.content as string).toContain("<tools>");
    expect(sysMsg?.content as string).toContain('"name":"bash"');
    expect(sysMsg?.content as string).toContain("<tool_call>tool_name<arg_key>key</arg_key><arg_value>value</arg_value></tool_call>");
    expect(sysMsg?.content as string).toContain("Execution Rules");

    // 4. Assistant message must have tool_calls serialized to XML and tool_calls property removed
    const assistantMsg = transformed.messages.find((m) => m.role === "assistant");
    expect(typeof assistantMsg?.content).toBe("string");
    expect(assistantMsg?.content as string).toContain("<tool_call>bash<arg_key>command</arg_key><arg_value>ls -la</arg_value></tool_call>");
    expect(assistantMsg?.tool_calls).toBeUndefined();

    // 5. Tool response must be converted to user message with <tool_response>
    const userToolResponseMsg = transformed.messages.find(
      (m) => m.role === "user" && typeof m.content === "string" && (m.content as string).includes("<tool_response")
    );
    expect(userToolResponseMsg).toBeDefined();
    expect(userToolResponseMsg?.content as string).toContain('<tool_response id="call_123">');
    expect(userToolResponseMsg?.content as string).toContain("total 0");
  });

  it("streams thinking to reasoning_content and tool call in 2 compliant OpenCode2 deltas with finish_reason: tool_calls", async () => {
    const transformer = createLingStreamTransformer();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const inputChunks = [
      'data: {"choices":[{"delta":{"content":"[gMASK]<|startoftext|><role>assistant</role>\\n<think>Inspecting codebase"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" for test files.</think>\\n"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"<tool_call>bash\\n<arg_key>command</arg_key>\\n"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"<arg_value>ls -la</arg_value>\\n</tool_call>"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of inputChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = stream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    let accumulatedOutput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulatedOutput += decoder.decode(value);
    }

    // Verify [gMASK] and <role> are never leaked
    expect(accumulatedOutput).not.toContain("[gMASK]");
    expect(accumulatedOutput).not.toContain("<role>");
    expect(accumulatedOutput).not.toContain("<think>");
    expect(accumulatedOutput).not.toContain("<tool_call>");

    // Verify reasoning_content delta was emitted
    expect(accumulatedOutput).toContain('"reasoning_content"');
    expect(accumulatedOutput).toContain("Inspecting codebase");

    // Verify Chunk 1 (declaration with empty arguments) and Chunk 2 (arguments payload) were emitted
    expect(accumulatedOutput).toContain('"name":"bash","arguments":""');
    expect(accumulatedOutput).toContain('"arguments":"{\\"command\\":\\"ls -la\\"}"');
    expect(accumulatedOutput).toContain('"finish_reason":"tool_calls"');
  });

  it("streams plain text and guarantees finish_reason: stop before [DONE]", async () => {
    const transformer = createLingStreamTransformer();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const inputChunks = [
      'data: {"choices":[{"delta":{"content":"Here is the strategy: 1 < 2 and 3 > 2."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" Done!"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of inputChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = stream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    let accumulatedOutput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulatedOutput += decoder.decode(value);
    }

    expect(accumulatedOutput).toContain("Here is the strategy: 1 < 2 and 3 > 2.");
    expect(accumulatedOutput).toContain("Done!");
    expect(accumulatedOutput).toContain('"finish_reason":"stop"');
  });

  it("parses degraded tagless concat dialects (websearchquery, shellcommand, editpath, readpath)", () => {
    const rawWebsearch = "Let me check the web:\nwebsearchquery IBKR Singapore CFD trading allowed 2026\n";
    const resWebsearch = parseLingXml(rawWebsearch);
    expect(resWebsearch.toolCalls.length).toBe(1);
    expect(resWebsearch.toolCalls[0]!.function.name).toBe("websearch");
    expect(JSON.parse(resWebsearch.toolCalls[0]!.function.arguments)).toEqual({
      query: "IBKR Singapore CFD trading allowed 2026",
    });

    const rawShell = "Running git status:\nshellcommand git status && git push\n";
    const resShell = parseLingXml(rawShell);
    expect(resShell.toolCalls.length).toBe(1);
    expect(resShell.toolCalls[0]!.function.name).toBe("shell");
    expect(JSON.parse(resShell.toolCalls[0]!.function.arguments)).toEqual({
      command: "git status && git push",
    });

    const rawEdit = "Editing code:\neditpath /path/to/file.py oldString def foo(): pass newString def foo(): return 42\n";
    const resEdit = parseLingXml(rawEdit);
    expect(resEdit.toolCalls.length).toBe(1);
    expect(resEdit.toolCalls[0]!.function.name).toBe("edit");
    expect(JSON.parse(resEdit.toolCalls[0]!.function.arguments)).toEqual({
      path: "/path/to/file.py",
      oldString: "def foo(): pass",
      newString: "def foo(): return 42",
    });
  });

  it("passes through native delta.tool_calls chunks without dropping", async () => {
    const transformer = createLingStreamTransformer();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const inputChunks = [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_123","type":"function","function":{"name":"bash","arguments":""}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"command\\":\\"ls\\"}"}}]},"finish_reason":null}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of inputChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = stream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    let accumulatedOutput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulatedOutput += decoder.decode(value);
    }

    expect(accumulatedOutput).toContain('"id":"call_123"');
    expect(accumulatedOutput).toContain('{\\"command\\":\\"ls\\"}');
    expect(accumulatedOutput).toContain('"finish_reason":"tool_calls"');
  });

  it("transforms non-streaming Ling responses with tool calls and reasoning", () => {
    const rawResponse = {
      id: "gen-123",
      object: "chat.completion",
      created: 123456789,
      model: "ling-3.0-flash",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant" as const,
            content:
              "<think>Need to list files first</think><tool_call>bash<arg_key>command</arg_key><arg_value>ls</arg_value></tool_call>",
          },
          finish_reason: "stop",
        },
      ],
    };

    const transformed = transformLingResponse(rawResponse);
    expect(transformed.choices[0]!.message.reasoning_content).toBe("Need to list files first");
    expect(transformed.choices[0]!.message.tool_calls).toBeDefined();
    expect(transformed.choices[0]!.message.tool_calls?.[0]?.function.name).toBe("bash");
    expect(transformed.choices[0]!.message.tool_calls?.[0]?.function.arguments).toBe('{"command":"ls"}');
    expect(transformed.choices[0]!.finish_reason).toBe("tool_calls");
  });
});
