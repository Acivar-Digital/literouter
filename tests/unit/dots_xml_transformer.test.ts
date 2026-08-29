import { describe, expect, it } from "bun:test";
import {
  createDotsStreamState,
  parseDotsXml,
  processDotsStreamChunk,
  serializeDotsToolCalls,
  serializeDotsToolHistory,
} from "../../src/transformers/dots";
import { sanitizeAndTransformPayload } from "../../src/transformers/payload";
import type { OpenAIMessage, OpenAIRequestPayload } from "../../src/transformers/nuances";

describe("Dots XML Transformer — Static Parsing", () => {
  it("strips leaked </role>, <role assistant>, and chat template delimiters in static parsing", () => {
    const input = "</role>The risk-budget approach made DD WORSE (-79% vs baseline -68%).";
    const result = parseDotsXml(input);
    expect(result.cleanText).toBe("The risk-budget approach made DD WORSE (-79% vs baseline -68%).");
    expect(result.toolCalls).toHaveLength(0);

    const inputWithRoleBlock = "<role assistant>Hello user!</role>";
    const result2 = parseDotsXml(inputWithRoleBlock);
    expect(result2.cleanText).toBe("Hello user!");
  });

  it("strips leaked </role> and <role assistant> from delta.reasoning_content and delta.thought in streams", async () => {
    const { createDotsStreamTransformer } = await import("../../src/transformers/dots");
    const transformer = createDotsStreamTransformer();

    const chunk1 = 'data: {"id":"chat-1","choices":[{"delta":{"reasoning_content":"Let me calculate the risk...</role>"}}]}\n\n';
    const chunk2 = 'data: {"id":"chat-1","choices":[{"delta":{"thought":"<role assistant>Now we proceed."}}]}\n\n';
    const chunk3 = 'data: {"id":"chat-1","choices":[{"delta":{"content":"Final answer."}}]}\n\n';
    const chunk4 = 'data: {"id":"chat-1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
    const chunk5 = 'data: [DONE]\n\n';

    const inputChunks = [chunk1, chunk2, chunk3, chunk4, chunk5];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of inputChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = stream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    let resultText = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resultText += new TextDecoder().decode(value);
    }

    expect(resultText).not.toContain("</role>");
    expect(resultText).not.toContain("<role assistant>");
    expect(resultText).toContain("Let me calculate the risk...");
    expect(resultText).toContain("Now we proceed.");
    expect(resultText).toContain("Final answer.");
  });

  it("strips leaked </role> across streaming chunks", async () => {
    const { createDotsStreamTransformer } = await import("../../src/transformers/dots");
    const transformer = createDotsStreamTransformer();

    const chunk1 = 'data: {"id":"chat-1","choices":[{"delta":{"content":"</ro"}}]}\n\n';
    const chunk2 = 'data: {"id":"chat-1","choices":[{"delta":{"content":"le>The risk-budget approach"}}]}\n\n';
    const chunk3 = 'data: {"id":"chat-1","choices":[{"delta":{"content":" is working."}}]}\n\n';
    const chunk4 = 'data: {"id":"chat-1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
    const chunk5 = 'data: [DONE]\n\n';

    const inputChunks = [chunk1, chunk2, chunk3, chunk4, chunk5];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of inputChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = stream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    let resultText = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resultText += new TextDecoder().decode(value);
    }

    expect(resultText).not.toContain("</role>");
    expect(resultText).not.toContain("</ro");
    expect(resultText).toContain("The risk-budget approach");
    expect(resultText).toContain(" is working.");
  });

  it("parses single XML function invocation into OpenAI tool_calls structure", () => {
    const input =
      'I will look up the weather for you: <invoke name="get_weather"><parameter name="location">Tokyo</parameter></invoke>';
    const parsed = parseDotsXml(input);

    expect(parsed.cleanText.trim()).toBe("I will look up the weather for you:");
    expect(parsed.toolCalls.length).toBe(1);

    const call = parsed.toolCalls[0]!;
    expect(call.function.name).toBe("get_weather");

    const args = JSON.parse(call.function.arguments);
    expect(args.location).toBe("Tokyo");
  });

  it("parses XML invocation with multiple parameters", () => {
    const input =
      '<invoke name="search_database"><parameter name="query">SELECT *</parameter><parameter name="limit">10</parameter></invoke>';
    const parsed = parseDotsXml(input);

    expect(parsed.cleanText).toBe("");
    expect(parsed.toolCalls.length).toBe(1);

    const call = parsed.toolCalls[0]!;
    expect(call.function.name).toBe("search_database");

    const args = JSON.parse(call.function.arguments);
    expect(args.query).toBe("SELECT *");
    expect(args.limit).toBe(10);
  });

  it("passes through text without XML invocations untouched", () => {
    const input = "This is a plain response with no tool calls.";
    const parsed = parseDotsXml(input);

    expect(parsed.cleanText).toBe(input);
    expect(parsed.toolCalls.length).toBe(0);
  });
  it("parses complex mixed XML tool calls with malformed closing tags and arg_key/arg_value pairs", () => {
    const input = `Actually, let me just try a few parameter combinations and pick the best one.
</parameter>
</invoke>
</function_calls>

Let me try deeper add zone and momentum-gated adds.

<function_calls>
<invoke name="edit">
<parameter name="path">/home/yapilwsl/arthityap/trend/scripts/bt/kelly_backtest.py</parameter>
<parameter name="oldString">r_si = run_backtest(gold_jpy, add_fraction=0.5, add_zone_pct=0.6, max_additions=3)</arg_value><arg_key>newString</arg_key>
<arg_value>r_si = run_backtest(gold_jpy, add_fraction=0.5, add_zone_pct=0.7, max_additions=3)</arg_value>
</tool_call>`;

    const parsed = parseDotsXml(input);

    expect(parsed.toolCalls.length).toBe(1);
    const call = parsed.toolCalls[0]!;
    expect(call.function.name).toBe("edit");

    const args = JSON.parse(call.function.arguments);
    expect(args.path).toBe("/home/yapilwsl/arthityap/trend/scripts/bt/kelly_backtest.py");
    expect(args.oldString).toBe("r_si = run_backtest(gold_jpy, add_fraction=0.5, add_zone_pct=0.6, max_additions=3)");
    expect(args.newString).toBe("r_si = run_backtest(gold_jpy, add_fraction=0.5, add_zone_pct=0.7, max_additions=3)");

    expect(parsed.cleanText).toContain("Actually, let me just try a few parameter combinations and pick the best one.");
    expect(parsed.cleanText).toContain("Let me try deeper add zone and momentum-gated adds.");
    expect(parsed.cleanText).not.toContain("<invoke");
    expect(parsed.cleanText).not.toContain("</tool_call>");
  });

  it("parses tool_call tags with child name and raw json arguments", () => {
    const input = '<tool_call><name>shell</name><arguments>{"command": "pytest tests/"}</arguments></tool_call>';
    const parsed = parseDotsXml(input);

    expect(parsed.toolCalls.length).toBe(1);
    const call = parsed.toolCalls[0]!;
    expect(call.function.name).toBe("shell");
    const args = JSON.parse(call.function.arguments);
    expect(args.command).toBe("pytest tests/");
  });
});

describe("Dots XML Transformer — Streaming Chunk Handling", () => {
  it("passes through normal text chunks untouched including reasoning_content and usage", async () => {
    const { createDotsStreamTransformer } = await import("../../src/transformers/dots");
    const transformer = createDotsStreamTransformer();

    const chunk1 = 'data: {"id":"chat-1","choices":[{"delta":{"reasoning_content":"Thinking deeply...","thought":"Step 1"}}]}\n\n';
    const chunk2 = 'data: {"id":"chat-1","choices":[{"delta":{"content":"Hello world!"}}]}\n\n';
    const chunk3 = 'data: {"id":"chat-1","choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n';
    const chunk4 = 'data: [DONE]\n\n';

    const inputChunks = [chunk1, chunk2, chunk3, chunk4];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of inputChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = stream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    let resultText = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resultText += new TextDecoder().decode(value);
    }

    expect(resultText).toContain('"reasoning_content":"Thinking deeply..."');
    expect(resultText).toContain('"thought":"Step 1"');
    expect(resultText).toContain('"content":"Hello world!"');
    expect(resultText).toContain('"prompt_tokens":10');
    expect(resultText).toContain('"completion_tokens":5');
    expect(resultText).toContain('"finish_reason":"stop"');
    expect(resultText).toContain('data: [DONE]');
  });

  it("emits finish_reason: 'tool_calls' before data: [DONE] when tool calls are streamed", async () => {
    const { createDotsStreamTransformer } = await import("../../src/transformers/dots");
    const transformer = createDotsStreamTransformer();

    const chunk1Obj = {
      id: "chatcmpl-123",
      model: "ling-3.0",
      choices: [{ delta: { content: '<function_calls><invoke name="edit">' } }],
    };
    const chunk2Obj = {
      choices: [{ delta: { content: '<parameter name="path">/tmp/test.py</parameter></invoke></function_calls>' } }],
    };
    const chunk3Obj = {
      choices: [{ delta: {}, finish_reason: "stop" }],
    };

    const inputChunks = [
      `data: ${JSON.stringify(chunk1Obj)}\n\n`,
      `data: ${JSON.stringify(chunk2Obj)}\n\n`,
      `data: ${JSON.stringify(chunk3Obj)}\n\n`,
      "data: [DONE]\n\n",
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of inputChunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = stream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    let resultText = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      resultText += new TextDecoder().decode(value);
    }

    expect(resultText).toContain('"tool_calls"');
    expect(resultText).toContain('"name":"edit"');
    expect(resultText).toContain('/tmp/test.py');
    expect(resultText).toContain('"finish_reason":"tool_calls"');
    expect(resultText).toContain('data: [DONE]');

    // Ensure finish_reason occurs BEFORE data: [DONE]
    const finishIdx = resultText.indexOf('"finish_reason":"tool_calls"');
    const doneIdx = resultText.indexOf('data: [DONE]');
    expect(finishIdx).toBeGreaterThan(-1);
    expect(doneIdx).toBeGreaterThan(finishIdx);
  });

  it("handles XML tags split across chunk boundaries", () => {
    const state = createDotsStreamState();

    const chunk1 = 'Checking forecast: <invoke name="get_';
    const chunk2 = 'weather"><parameter name="city">Berlin</parameter></invoke> Done!';

    const out1 = processDotsStreamChunk(chunk1, state);
    const out2 = processDotsStreamChunk(chunk2, state);

    expect(out1).toContain("Checking forecast: ");
    expect(out2).toContain("tool_calls");
    expect(out2).toContain("get_weather");
    expect(out2).toContain("Berlin");
    expect(out2).toContain("Done!");
  });
});

describe("Dots XML Tool History Serialization", () => {
  it("serializes tool calls to XML invoke blocks inside <tool_calls>", () => {
    const toolCalls = [
      {
        id: "call_1",
        type: "function" as const,
        function: {
          name: "get_weather",
          arguments: JSON.stringify({ city: "Tokyo", unit: "celsius" }),
        },
      },
      {
        id: "call_2",
        type: "function" as const,
        function: {
          name: "calculate",
          arguments: JSON.stringify({ expr: "2 + 2" }),
        },
      },
    ];

    const xml = serializeDotsToolCalls(toolCalls);
    expect(xml).toContain("<tool_calls>");
    expect(xml).toContain('</tool_calls>');
    expect(xml).toContain('<invoke name="get_weather">');
    expect(xml).toContain('<parameter name="city">Tokyo</parameter>');
    expect(xml).toContain('<parameter name="unit">celsius</parameter>');
    expect(xml).toContain('<invoke name="calculate">');
    expect(xml).toContain('<parameter name="expr">2 + 2</parameter>');
  });

  it("handles empty or non-JSON arguments in tool call serialization", () => {
    const emptyXml = serializeDotsToolCalls([]);
    expect(emptyXml).toBe("");

    const nonJsonToolCall = [
      {
        id: "call_raw",
        type: "function" as const,
        function: {
          name: "raw_tool",
          arguments: "not a json string",
        },
      },
    ];
    const xml = serializeDotsToolCalls(nonJsonToolCall);
    expect(xml).toContain('<invoke name="raw_tool">');
    expect(xml).toContain('<parameter name="input">not a json string</parameter>');
  });

  it("serializes assistant tool calls and tool messages into XML conversation history", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "user",
        content: "What is the weather in Tokyo?",
      },
      {
        role: "assistant",
        content: "Let me check that.",
        tool_calls: [
          {
            id: "call_123",
            type: "function" as const,
            function: {
              name: "get_weather",
              arguments: JSON.stringify({ location: "Tokyo" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_123",
        content: JSON.stringify({ temp: 22, condition: "Sunny" }),
      },
      {
        role: "assistant",
        content: "It is 22C and Sunny in Tokyo.",
      },
    ];

    const serialized = serializeDotsToolHistory(messages);

    expect(serialized.length).toBe(4);
    expect(serialized[0]?.role).toBe("user");
    expect(serialized[0]?.content).toBe("What is the weather in Tokyo?");

    expect(serialized[1]?.role).toBe("assistant");
    expect(serialized[1]?.tool_calls).toBeUndefined();
    expect(typeof serialized[1]?.content).toBe("string");
    expect(serialized[1]?.content as string).toContain("Let me check that.");
    expect(serialized[1]?.content as string).toContain('<invoke name="get_weather">');
    expect(serialized[1]?.content as string).toContain('<parameter name="location">Tokyo</parameter>');

    expect(serialized[2]?.role).toBe("user");
    expect(typeof serialized[2]?.content).toBe("string");
    expect(serialized[2]?.content as string).toContain('<tool_result id="call_123">');
    expect(serialized[2]?.content as string).toContain('"temp":22');

    expect(serialized[3]?.role).toBe("assistant");
    expect(serialized[3]?.content).toBe("It is 22C and Sunny in Tokyo.");
  });

  it("integrates with sanitizeAndTransformPayload via 'tc' nuance and merges consecutive user messages", () => {
    const payload: OpenAIRequestPayload = {
      model: "custom-model",
      messages: [
        { role: "user", content: "Check status" },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_abc",
              type: "function" as const,
              function: {
                name: "check_status",
                arguments: "{}",
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_abc",
          content: "status: ok",
        },
        {
          role: "user",
          content: "Also check uptime",
        },
      ],
    };

    const transformed = sanitizeAndTransformPayload(payload, {
      nuances: ["tc"],
    });

    // In the input: [user, assistant (with tc), tool, user].
    // After serialization: [user, assistant (with invoke xml), user (<tool_result>), user].
    // After mergeConsecutiveMessages: [user, assistant, user (tool_result + text)].
    expect(transformed.messages.length).toBe(3);
    expect(transformed.messages[0]?.role).toBe("user");
    expect(transformed.messages[1]?.role).toBe("assistant");
    expect(transformed.messages[1]?.content).toContain('<invoke name="check_status">');
    expect(transformed.messages[2]?.role).toBe("user");
    expect(transformed.messages[2]?.content).toContain('<tool_result id="call_abc">');
    expect(transformed.messages[2]?.content).toContain("Also check uptime");
  });

  it("automatically triggers Dots tool history serialization when model name includes 'dots'", () => {
    const payload: OpenAIRequestPayload = {
      model: "openrouter/dots-studio/dots-3-note-preview",
      messages: [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_xyz",
              type: "function" as const,
              function: {
                name: "search",
                arguments: JSON.stringify({ q: "bun test" }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_xyz",
          content: "found results",
        },
      ],
    };

    const transformed = sanitizeAndTransformPayload(payload, { nuances: [] });
    expect(transformed.messages.length).toBe(2);
    expect(transformed.messages[0]?.role).toBe("assistant");
    expect(transformed.messages[0]?.content).toContain('<invoke name="search">');
    expect(transformed.messages[1]?.role).toBe("user");
    expect(transformed.messages[1]?.content).toContain('<tool_result id="call_xyz">');
    expect(transformed.messages[1]?.content).toContain("found results");
  });
});
