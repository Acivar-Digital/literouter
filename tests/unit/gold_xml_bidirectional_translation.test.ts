import { describe, expect, it } from "bun:test";
import { parseDotsXml } from "../../src/transformers/dots";
import { sanitizeAndTransformPayload } from "../../src/transformers/payload";
import type { OpenAIRequestPayload } from "../../src/transformers/nuances";

interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface OpenAIResponse {
  choices: Array<{
    message: {
      role: string;
      content: string | null;
      reasoning_content?: string;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
}

interface XmlToJsonTestCase {
  name: string;
  rawXml: string;
  expectedTool: string;
  expectedArgs: Record<string, unknown>;
  expectedReasoning?: string;
}

interface JsonToXmlTestCase {
  name: string;
  request: OpenAIRequestPayload;
  expectedXmlSnippets: string[];
  forbiddenSnippets: string[];
}

function transformWithLiteRouter(rawXml: string): OpenAIResponse {
  const { cleanText, toolCalls, reasoningContent } = parseDotsXml(rawXml);
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: cleanText.length > 0 ? cleanText : null,
          reasoning_content: reasoningContent,
          tool_calls: toolCalls.length > 0 ? (toolCalls as OpenAIToolCall[]) : undefined,
        },
        finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
      },
    ],
  };
}

describe("Gold Test: XML to JSON Inbound Translation (Model XML -> Standard OpenAI JSON)", () => {
  const TEST_CASES: XmlToJsonTestCase[] = [
    {
      name: "Ling-3.0 / GLM <arg_key> & <arg_value> Dialect",
      rawXml: `[gMASK]<|startoftext|><role>assistant</role>
<think>Inspecting directory structure first.</think>
<tool_call>bash
<arg_key>command</arg_key>
<arg_value>ls -la src/</arg_value>
<arg_key>restart</arg_key>
<arg_value>false</arg_value>
</tool_call><|role_end|>`,
      expectedTool: "bash",
      expectedArgs: { command: "ls -la src/", restart: false },
      expectedReasoning: "Inspecting directory structure first.",
    },
    {
      name: "Qwen XML (<function=...><parameter=...>) Dialect",
      rawXml: `<think>Editing configuration file.</think>
<tool_call>
<function=edit_file>
<parameter=path>config/app.json</parameter>
<parameter=lines>42</parameter>
</function>
</tool_call>`,
      expectedTool: "edit_file",
      expectedArgs: { path: "config/app.json", lines: 42 },
      expectedReasoning: "Editing configuration file.",
    },
    {
      name: "DeepSeek / MiniMax (<invoke name=...>) Dialect",
      rawXml: `<invoke name="fetch_url">
<parameter name="url">https://api.github.com</parameter>
<parameter name="timeout">30</parameter>
</invoke>`,
      expectedTool: "fetch_url",
      expectedArgs: { url: "https://api.github.com", timeout: 30 },
    },
    {
      name: "Trapped Tool Call Inside <think> (No closing </think>)",
      rawXml: `<think>
I must run the linter immediately.
<tool_call>lint_runner<arg_key>fix</arg_key><arg_value>true</arg_value></tool_call>`,
      expectedTool: "lint_runner",
      expectedArgs: { fix: true },
      expectedReasoning: "I must run the linter immediately.",
    },
  ];

  for (const tc of TEST_CASES) {
    it(`translates ${tc.name} into clean OpenAI tool_calls JSON`, () => {
      const responseData = transformWithLiteRouter(tc.rawXml);
      const choice = responseData.choices[0];
      expect(choice).toBeDefined();
      expect(choice?.finish_reason).toBe("tool_calls");

      const toolCall = choice?.message.tool_calls?.[0];
      expect(toolCall).toBeDefined();
      expect(toolCall?.function.name).toBe(tc.expectedTool);

      const parsedArgs = JSON.parse(toolCall?.function.arguments || "{}");
      for (const [key, val] of Object.entries(tc.expectedArgs)) {
        expect(parsedArgs[key]).toEqual(val);
      }

      const content = choice?.message.content;
      if (content) {
        const leakedTagRegex =
          /<\/?(?:role|tool_call|tool_response|arg_key|arg_value|invoke|parameter|function|think)[^>]*>|<\|(?:role_end|startoftext|endoftext)\|>/i;
        expect(leakedTagRegex.test(content)).toBe(false);
      }

      if (tc.expectedReasoning) {
        expect(choice?.message.reasoning_content).toContain(tc.expectedReasoning);
      }
    });
  }
});

describe("Gold Test: JSON to XML Outbound Translation (OpenCode JSON -> Native Model XML)", () => {
  const TEST_CASES: JsonToXmlTestCase[] = [
    {
      name: "Tool Schema Injection -> System Prompt Tools Schema",
      request: {
        model: "inclusionai/ling-3.0-flash:free",
        messages: [{ role: "user", content: "List all files" }],
        tools: [
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
        ],
      },
      expectedXmlSnippets: [
        "<tools>",
        '"name":"bash"',
        "</tools>",
        "<tool_call>",
      ],
      forbiddenSnippets: [],
    },
    {
      name: "Tool Execution Observation (role: 'tool') -> Serialized Tool Result",
      request: {
        model: "inclusionai/ling-3.0-flash:free",
        messages: [
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
        ],
      },
      expectedXmlSnippets: [
        '<tool_result id="call_abc123"',
        "5 passed, 0 failed",
        "</tool_result>",
      ],
      forbiddenSnippets: ["<|im_start|>tool"],
    },
    {
      name: "Consecutive Tool Compaction (Preserve Strict Turn Alternation)",
      request: {
        model: "inclusionai/ling-3.0-flash:free",
        messages: [
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
        ],
      },
      expectedXmlSnippets: [
        '<tool_result id="c1"',
        "contents of a",
        "</tool_result>",
        '<tool_result id="c2"',
        "contents of b",
        "</tool_result>",
      ],
      forbiddenSnippets: [],
    },
    {
      name: "Reasoning Pruning on Historical Turns",
      request: {
        model: "inclusionai/ling-3.0-flash:free",
        messages: [
          { role: "user", content: "Turn 1" },
          { role: "assistant", content: "Answer 1", reasoning_content: "Old 5000-token scratchpad" },
          { role: "user", content: "Turn 2" },
        ],
      },
      expectedXmlSnippets: ["Answer 1"],
      forbiddenSnippets: [],
    },
  ];

  for (const tc of TEST_CASES) {
    it(`serializes ${tc.name} into native XML without schema degradation`, () => {
      const transformed = sanitizeAndTransformPayload(tc.request, { nuances: ["tc"] });
      const fullContent = (transformed.messages ?? []).map((m) => m.content ?? "").join("\n\n");

      for (const snippet of tc.expectedXmlSnippets) {
        expect(fullContent).toContain(snippet);
      }

      for (const forbidden of tc.forbiddenSnippets) {
        expect(fullContent).not.toContain(forbidden);
      }
    });
  }
});
