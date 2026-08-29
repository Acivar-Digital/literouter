import { describe, expect, it } from "bun:test";
import { parseLingXml } from "../../src/transformers/ling";
import { parseDotsXml } from "../../src/transformers/dots";

interface TestCase {
  name: string;
  rawXml: string;
  expectedTool: string;
  expectedArgs: Record<string, unknown>;
  expectedReasoning?: string;
}

const TEST_CASES: TestCase[] = [
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
  {
    name: "Multi-parameter invoke stream (User Gold Case)",
    rawXml: `<tool_calls>
<invoke name="read">
<parameter name="path">/home/yapilwsl/arthityap/trend/docs/gold_jpy_strategy_report.md</parameter>
<parameter name="offset">245</parameter>
<parameter name="limit">10</parameter>
</invoke>
</tool_calls>`,
    expectedTool: "read",
    expectedArgs: {
      path: "/home/yapilwsl/arthityap/trend/docs/gold_jpy_strategy_report.md",
      offset: 245,
      limit: 10,
    },
  },
];

describe("1-to-1 Bidirectional XML to JSON Parser Suite", () => {
  for (const tc of TEST_CASES) {
    it(`parseLingXml: ${tc.name}`, () => {
      const result = parseLingXml(tc.rawXml);
      expect(result.toolCalls.length).toBeGreaterThan(0);
      const first = result.toolCalls[0];
      expect(first?.function.name).toBe(tc.expectedTool);

      const parsedArgs = JSON.parse(first?.function.arguments ?? "{}");
      for (const [k, v] of Object.entries(tc.expectedArgs)) {
        expect(parsedArgs[k]).toEqual(v);
      }

      if (tc.expectedReasoning) {
        expect(result.reasoningContent).toContain(tc.expectedReasoning);
      }

      // Assert zero leaked XML tags in visible cleanText
      expect(result.cleanText).not.toMatch(/<\/?(?:role|tool_call|tool_calls|arg_key|arg_value|invoke|parameter|function|think)[^>]*>/i);
    });

    it(`parseDotsXml: ${tc.name}`, () => {
      const result = parseDotsXml(tc.rawXml);
      expect(result.toolCalls.length).toBeGreaterThan(0);
      const first = result.toolCalls[0];
      expect(first?.function.name).toBe(tc.expectedTool);

      const parsedArgs = JSON.parse(first?.function.arguments ?? "{}");
      for (const [k, v] of Object.entries(tc.expectedArgs)) {
        expect(parsedArgs[k]).toEqual(v);
      }

      if (tc.expectedReasoning) {
        expect(result.reasoningContent).toContain(tc.expectedReasoning);
      }

      // Assert zero leaked XML tags in visible cleanText
      expect(result.cleanText).not.toMatch(/<\/?(?:role|tool_call|tool_calls|arg_key|arg_value|invoke|parameter|function|think)[^>]*>/i);
    });
  }
});
