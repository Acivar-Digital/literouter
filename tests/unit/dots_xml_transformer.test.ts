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
