import { describe, expect, it } from "bun:test";
import {
  injectToolsSchemaSystemPrompt,
  serializeDotsToolHistory,
} from "../../src/transformers/dots";
import { mergeConsecutiveMessages } from "../../src/transformers/payload";
import { scrubReasoningFromMessages } from "../../src/transformers/thinking";
import type { OpenAIMessage } from "../../src/transformers/nuances";

describe("1-to-1 JSON to Native XML Serialization Suite", () => {
  it("Tool Schema Injection -> Native <tools> XML", () => {
    const messages: readonly OpenAIMessage[] = [
      { role: "user", content: "List all files" },
    ];
    const tools = [
      {
        type: "function",
        function: {
          name: "bash",
          description: "Execute bash command",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
            required: ["command"],
          },
        },
      },
    ];

    const injected = injectToolsSchemaSystemPrompt(messages, tools);
    expect(injected[0]?.role).toBe("system");
    const sysContent = String(injected[0]?.content ?? "");
    expect(sysContent).toContain("<tools>");
    expect(sysContent).toContain('"name":"bash"');
    expect(sysContent).toContain("</tools>");
  });

  it("Tool Execution Observation (role: 'tool') -> Dedicated <tool_result> / <tool_response>", () => {
    const messages: readonly OpenAIMessage[] = [
      { role: "user", content: "Run pytest" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_abc123",
            type: "function",
            function: { name: "bash", arguments: '{"command": "pytest"}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_abc123",
        name: "bash",
        content: "5 passed, 0 failed",
      },
    ];

    const serialized = serializeDotsToolHistory(messages);
    const lastMsg = serialized[serialized.length - 1];
    const content = String(lastMsg?.content ?? "");
    expect(content).toContain('<tool_result id="call_abc123"');
    expect(content).toContain("5 passed, 0 failed");
    expect(content).toContain("</tool_result>");
  });

  it("Consecutive Tool Compaction (Preserve Strict Turn Alternation)", () => {
    const messages: readonly OpenAIMessage[] = [
      { role: "user", content: "Read two files" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "c1", type: "function", function: { name: "read", arguments: '{"p": "a.txt"}' } },
          { id: "c2", type: "function", function: { name: "read", arguments: '{"p": "b.txt"}' } },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "contents of a" },
      { role: "tool", tool_call_id: "c2", content: "contents of b" },
    ];

    const serialized = serializeDotsToolHistory(messages);
    const merged = mergeConsecutiveMessages(serialized);

    expect(merged.length).toBe(3); // user, assistant, user (compacted tools)
    const toolTurn = String(merged[2]?.content ?? "");
    expect(toolTurn).toContain('<tool_result id="c1"');
    expect(toolTurn).toContain("contents of a");
    expect(toolTurn).toContain('<tool_result id="c2"');
    expect(toolTurn).toContain("contents of b");
  });

  it("Reasoning Pruning on Historical Turns", () => {
    const messages: readonly OpenAIMessage[] = [
      { role: "user", content: "Turn 1" },
      { role: "assistant", content: "Answer 1", reasoning_content: "Old 5000-token scratchpad" },
      { role: "user", content: "Turn 2" },
    ];

    const cleaned = scrubReasoningFromMessages(messages);
    expect(cleaned[1]?.reasoning_content).toBeUndefined();
    expect(cleaned[1]?.content).toBe("Answer 1");
  });
});
