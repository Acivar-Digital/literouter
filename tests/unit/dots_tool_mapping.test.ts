import { describe, expect, it } from "bun:test";
import { classifyUpstreamError } from "../../src/network/classifier";
import { serializeDotsToolHistory } from "../../src/transformers/dots";
import type { OpenAIMessage, OpenAIRequestPayload } from "../../src/transformers/nuances";
import { sanitizeAndTransformPayload } from "../../src/transformers/payload";

describe("Dots Tool History Serialization & Compaction", () => {
  it("transforms assistant message with tool_calls into XML invoke blocks and strips tool_calls", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "assistant",
        content: "I will check the weather and run calculations.",
        tool_calls: [
          {
            id: "call_weather_1",
            type: "function",
            function: {
              name: "get_weather",
              arguments: JSON.stringify({ location: "Tokyo", unit: "celsius" }),
            },
          },
          {
            id: "call_calc_2",
            type: "function",
            function: {
              name: "calculate",
              arguments: JSON.stringify({ expression: "10 * 5" }),
            },
          },
        ],
      },
    ];

    const serialized = serializeDotsToolHistory(messages);

    expect(serialized.length).toBe(1);
    const assistantMsg = serialized[0]!;
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.tool_calls).toBeUndefined();
    expect(typeof assistantMsg.content).toBe("string");

    const content = assistantMsg.content as string;
    expect(content).toContain("I will check the weather and run calculations.");
    expect(content).toContain("<tool_calls>");
    expect(content).toContain("</tool_calls>");
    expect(content).toContain('<invoke name="get_weather">');
    expect(content).toContain('<parameter name="location">Tokyo</parameter>');
    expect(content).toContain('<parameter name="unit">celsius</parameter>');
    expect(content).toContain('<invoke name="calculate">');
    expect(content).toContain('<parameter name="expression">10 * 5</parameter>');
  });

  it("transforms role: 'tool' message into role: 'user' with <tool_result> wrapping", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "tool",
        tool_call_id: "call_weather_1",
        content: JSON.stringify({ temp: 22, condition: "Sunny" }),
      },
    ];

    const serialized = serializeDotsToolHistory(messages);

    expect(serialized.length).toBe(1);
    const toolResultMsg = serialized[0]!;
    expect(toolResultMsg.role).toBe("user");
    expect(typeof toolResultMsg.content).toBe("string");

    const content = toolResultMsg.content as string;
    expect(content).toBe(
      '<tool_result id="call_weather_1">\n{"temp":22,"condition":"Sunny"}\n</tool_result>'
    );
  });

  it("transforms multi-turn Claude Code summarization history to contain ZERO tool roles and merges consecutive user turns cleanly (model dots)", () => {
    const payload: OpenAIRequestPayload = {
      model: "dots-studio/dots-3-note-preview:free",
      messages: [
        { role: "system", content: "You are a concise summarizer assistant." },
        { role: "user", content: "Please read src/index.ts and summarize it." },
        {
          role: "assistant",
          content: "Let me inspect the file first.",
          tool_calls: [
            {
              id: "call_read_1",
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "src/index.ts" }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_read_1",
          content: 'export const version = "1.0.0";',
        },
        {
          role: "user",
          content: "Also check the dependencies.",
        },
        {
          role: "assistant",
          content: "",
          tool_calls: [
            {
              id: "call_pkg_2",
              type: "function",
              function: {
                name: "read_file",
                arguments: JSON.stringify({ path: "package.json" }),
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_pkg_2",
          content: '{"dependencies": {"valkey": "^0.1.0"}}',
        },
        {
          role: "user",
          content: "Give me the final summary.",
        },
      ],
    };

    const transformed = sanitizeAndTransformPayload(payload);

    // Verify zero tool roles exist anywhere in the transformed message history
    const toolRoleCount = transformed.messages.filter((m) => m.role === "tool").length;
    expect(toolRoleCount).toBe(0);

    // Structure should be: system -> user -> assistant -> user (merged tool_result 1 + text) -> assistant -> user (merged tool_result 2 + text)
    expect(transformed.messages.length).toBe(6);

    expect(transformed.messages[0]?.role).toBe("system");
    expect(transformed.messages[0]?.content).toBe("You are a concise summarizer assistant.");

    expect(transformed.messages[1]?.role).toBe("user");
    expect(transformed.messages[1]?.content).toBe("Please read src/index.ts and summarize it.");

    expect(transformed.messages[2]?.role).toBe("assistant");
    expect(transformed.messages[2]?.tool_calls).toBeUndefined();
    expect(transformed.messages[2]?.content).toContain("Let me inspect the file first.");
    expect(transformed.messages[2]?.content).toContain('<invoke name="read_file">');

    expect(transformed.messages[3]?.role).toBe("user");
    expect(transformed.messages[3]?.content).toContain('<tool_result id="call_read_1">');
    expect(transformed.messages[3]?.content).toContain('export const version = "1.0.0";');
    expect(transformed.messages[3]?.content).toContain("Also check the dependencies.");

    expect(transformed.messages[4]?.role).toBe("assistant");
    expect(transformed.messages[4]?.tool_calls).toBeUndefined();
    expect(transformed.messages[4]?.content).toContain('<invoke name="read_file">');

    expect(transformed.messages[5]?.role).toBe("user");
    expect(transformed.messages[5]?.content).toContain('<tool_result id="call_pkg_2">');
    expect(transformed.messages[5]?.content).toContain('"dependencies": {"valkey": "^0.1.0"}');
    expect(transformed.messages[5]?.content).toContain("Give me the final summary.");
  });

  it("transforms multi-turn summarization history when activated via 'tc' nuance flag", () => {
    const payload: OpenAIRequestPayload = {
      model: "custom-router-model",
      messages: [
        { role: "user", content: "Run diagnostic" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: "call_diag_1",
              type: "function",
              function: {
                name: "run_doctor",
                arguments: "{}",
              },
            },
          ],
        },
        {
          role: "tool",
          tool_call_id: "call_diag_1",
          content: "All systems healthy",
        },
        {
          role: "user",
          content: "Great, proceed.",
        },
      ],
    };

    const transformed = sanitizeAndTransformPayload(payload, {
      nuances: ["tc"],
    });

    const toolRoleCount = transformed.messages.filter((m) => m.role === "tool").length;
    expect(toolRoleCount).toBe(0);

    expect(transformed.messages.length).toBe(3);
    expect(transformed.messages[0]?.role).toBe("user");
    expect(transformed.messages[1]?.role).toBe("assistant");
    expect(transformed.messages[1]?.tool_calls).toBeUndefined();
    expect(transformed.messages[1]?.content).toContain('<invoke name="run_doctor">');
    expect(transformed.messages[2]?.role).toBe("user");
    expect(transformed.messages[2]?.content).toContain('<tool_result id="call_diag_1">');
    expect(transformed.messages[2]?.content).toContain("All systems healthy");
    expect(transformed.messages[2]?.content).toContain("Great, proceed.");
  });
});

describe("Upstream Error Classification — 400 Fail-Fast", () => {
  it("classifies HTTP 400 with 'provider returned error' as fail_fast with 0s quarantine and isRetryable: false", () => {
    const result = classifyUpstreamError({
      provider: "openrouter",
      status: 400,
      headers: new Headers(),
      bodyText: JSON.stringify({
        error: {
          message: "Provider returned error: Invalid request parameters or unsupported tool format",
          code: 400,
        },
      }),
    });

    expect(result.action).toBe("fail_fast");
    expect(result.quarantineTtlSec).toBe(0);
    expect(result.isRetryable).toBe(false);
    expect(result.reason).toBe("Client request error (non-retryable 400)");
  });
});
