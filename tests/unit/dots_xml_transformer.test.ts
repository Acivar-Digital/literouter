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
  it("strips complete and split <role>HUMAN</role> in TagSanitizerStreamBuffer", () => {
    const { TagSanitizerStreamBuffer } = require("../../src/transformers/dots");
    const buffer = new TagSanitizerStreamBuffer();

    // 1. Single chunk complete
    const res1 = buffer.process("<role>HUMAN</role>continue");
    expect(res1).toBe("continue");

    // 2. Split across chunks
    const buffer2 = new TagSanitizerStreamBuffer();
    const c1 = buffer2.process("<role>HU");
    const c2 = buffer2.process("MAN</");
    const c3 = buffer2.process("role>continue work");
    expect(c1).toBe("");
    expect(c2).toBe("");
    expect(c3).toBe("continue work");
  });

  it("strips leaked </role> across split chunks in streaming reasoning_content", async () => {
    const { createDotsStreamTransformer } = await import("../../src/transformers/dots");
    const transformer = createDotsStreamTransformer();

    const chunk1 = 'data: {"id":"chat-1","choices":[{"delta":{"reasoning_content":"Let me calculate the risk...</ro"}}]}\n\n';
    const chunk2 = 'data: {"id":"chat-1","choices":[{"delta":{"reasoning_content":"le>"}}]}\n\n';
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
    expect(resultText).not.toContain("</ro");
    expect(resultText).not.toContain("le>");
    expect(resultText).toContain("Let me calculate the risk...");
    expect(resultText).toContain("Final answer.");
  });

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

  it("extracts tool calls trapped inside <think> tags (Qwen / Ling / DeepSeek pattern)", () => {
    const input =
      '<think>\nI need to inspect the working directory first.\n<tool_call>bash\n<arg_key>command</arg_key><arg_value>ls -la</arg_value></tool_call>\n</think>';
    const parsed = parseDotsXml(input);

    expect(parsed.toolCalls.length).toBe(1);
    expect(parsed.toolCalls[0]!.function.name).toBe("bash");
    const args = JSON.parse(parsed.toolCalls[0]!.function.arguments);
    expect(args.command).toBe("ls -la");
    expect(parsed.reasoningContent).toContain("I need to inspect the working directory first.");
    expect(parsed.cleanText).toBe("");
  });

  it("merges consecutive tool results into a single user message", () => {
    const messages: OpenAIMessage[] = [
      {
        role: "tool",
        tool_call_id: "call_1",
        name: "bash",
        content: "file1.txt\nfile2.txt",
      },
      {
        role: "tool",
        tool_call_id: "call_2",
        name: "read_file",
        content: "export const A = 1;",
      },
    ];
    const serialized = serializeDotsToolHistory(messages);

    expect(serialized.length).toBe(1);
    expect(serialized[0]!.role).toBe("user");
    const content = serialized[0]!.content as string;
    expect(content).toContain('<tool_result id="call_1" name="bash">');
    expect(content).toContain('<tool_result id="call_2" name="read_file">');
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


  it("parses Qwen XML format (<function=name><parameter=key>)", () => {
    const raw = `I will now write the file.
<tool_call>
<function=write>
<parameter=path>src/index.js</parameter>
<parameter=content>console.log("hello world");</parameter>
<parameter=count>42</parameter>
<parameter=active>true</parameter>
<parameter=ratio>3.14</parameter>
</function>
</tool_call>
Let me know if you need changes.`;

    const result = parseDotsXml(raw);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("write");
    const args = JSON.parse(result.toolCalls[0]!.function.arguments);
    expect(args.path).toBe("src/index.js");
    expect(args.content).toBe('console.log("hello world");');
    expect(args.count).toBe(42);
    expect(args.active).toBe(true);
    expect(args.ratio).toBe(3.14);
    expect(result.cleanText).toContain("I will now write the file.");
    expect(result.cleanText).toContain("Let me know if you need changes.");
    expect(result.cleanText).not.toContain("<function=");
    expect(result.cleanText).not.toContain("<parameter=");
  });

  it("strips GLM-4 / Ling-3.0 template tokens (<|role_end|>, <|role_start|>, <tool_response>, <role>)", () => {
    const raw = `<|role_start|>assistant<role>assistant</role>Hello user!<tool_response>Success</tool_response><|role_end|>`;
    const result = parseDotsXml(raw);
    expect(result.cleanText).toBe("Hello user!Success");
    expect(result.cleanText).not.toContain("<|role_end|>");
    expect(result.cleanText).not.toContain("<|role_start|>");
    expect(result.cleanText).not.toContain("<role>");
    expect(result.cleanText).not.toContain("<tool_response>");
  });

  it("parses GLM-4 / Zhipu / Qwen3 <tool_call>name<arg_key>...<arg_value> format", () => {
    const raw = `<tool_call>bash
<arg_key>command</arg_key>
<arg_value>ls -la</arg_value>
<arg_key>description</arg_key>
<arg_value>List files in directory</arg_value>
</tool_call>`;

    const result = parseDotsXml(raw);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("bash");
    const args = JSON.parse(result.toolCalls[0]!.function.arguments);
    expect(args.command).toBe("ls -la");
    expect(args.description).toBe("List files in directory");
    expect(result.cleanText).toBe("");
    expect(result.cleanText).not.toContain("<arg_key>");
    expect(result.cleanText).not.toContain("<arg_value>");
  });

  it("parses GLM-4 unwrapped tool calls with multiline <arg_value> scripts", () => {
    const raw = `I will run the script now.
bash<arg_key>command</arg_key><arg_value>cat << 'EOF' > test.py
import sys
print("hello world")
EOF
python test.py</arg_value></tool_call>`;

    const result = parseDotsXml(raw);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("bash");
    const args = JSON.parse(result.toolCalls[0]!.function.arguments);
    expect(args.command).toContain('import sys\nprint("hello world")');
    expect(result.cleanText).toContain("I will run the script now.");
    expect(result.cleanText).not.toContain("arg_value");
    expect(result.cleanText).not.toContain("arg_key");
    expect(result.cleanText).not.toContain("<tool_call>");
  });

  it("parses DeepSeek DSML / MiniMax XML format (<invoke name=...>)", () => {
    const raw = `<invoke name="bash">
<parameter name="command">ls -la</parameter>
<parameter name="restart">false</parameter>
<parameter name="timeout">300</parameter>
</invoke>`;

    const result = parseDotsXml(raw);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("bash");
    const args = JSON.parse(result.toolCalls[0]!.function.arguments);
    expect(args.command).toBe("ls -la");
    expect(args.restart).toBe(false);
    expect(args.timeout).toBe(300);
    expect(result.cleanText).toBe("");
  });

  it("parses Claude / Cline XML format (<tool_name><param>...)", () => {
    const raw = `Writing configuration:
<write>
<path>server.py</path>
<content>import os</content>
<lines>10</lines>
</write>`;

    const result = parseDotsXml(raw);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("write");
    const args = JSON.parse(result.toolCalls[0]!.function.arguments);
    expect(args.path).toBe("server.py");
    expect(args.content).toBe("import os");
    expect(args.lines).toBe(10);
    expect(result.cleanText).toBe("Writing configuration:");
  });

  it("parses Qwen JSON-in-XML hybrid format (<tool_call>{...}</tool_call>)", () => {
    const raw = `<tool_call>
{"name": "edit", "arguments": {"path": "main.py", "diff": "- old\n+ new"}}
</tool_call>`;

    const result = parseDotsXml(raw);
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("edit");
    const args = JSON.parse(result.toolCalls[0]!.function.arguments);
    expect(args.path).toBe("main.py");
    expect(args.diff).toBe("- old\n+ new");
    expect(result.cleanText).toBe("");
  });

  it("handles complex data-type casting rules (bools, ints, floats, json arrays/objects, strings)", () => {
    const raw = `<invoke name="test_types">
<parameter name="is_admin">true</parameter>
<parameter name="is_guest">false</parameter>
<parameter name="user_id">12345</parameter>
<parameter name="negative_val">-99</parameter>
<parameter name="pi">3.14159</parameter>
<parameter name="items">[1, 2, "three"]</parameter>
<parameter name="config">{"theme": "dark", "retries": 3}</parameter>
<parameter name="plain_str">Just plain text</parameter>
</invoke>`;

    const result = parseDotsXml(raw);
    expect(result.toolCalls).toHaveLength(1);
    const args = JSON.parse(result.toolCalls[0]!.function.arguments);
    expect(args.is_admin).toBe(true);
    expect(args.is_guest).toBe(false);
    expect(args.user_id).toBe(12345);
    expect(args.negative_val).toBe(-99);
    expect(args.pi).toBe(3.14159);
    expect(args.items).toEqual([1, 2, "three"]);
    expect(args.config).toEqual({ theme: "dark", retries: 3 });
    expect(args.plain_str).toBe("Just plain text");
  });


  it("extracts <think>, <thought>, <thinking> blocks into reasoningContent and strips from cleanText", () => {
    const raw = `<think>
Analyzing user requirements:
1. User wants to check server status.
2. Call status tool.
</think>
<tool_call>
<function=status>
<parameter=detailed>true</parameter>
</function>
</tool_call>`;

    const result = parseDotsXml(raw);
    expect(result.reasoningContent).toContain("Analyzing user requirements:");
    expect(result.reasoningContent).toContain("Call status tool.");
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]!.function.name).toBe("status");
    expect(result.cleanText).toBe("");
  });

  it("extracts <thought> and <thinking> blocks into reasoningContent for plain text responses", () => {
    const raw1 = `<thought>
I should explain the concept simply.
</thought>
Here is the simple explanation.`;

    const res1 = parseDotsXml(raw1);
    expect(res1.reasoningContent).toBe("I should explain the concept simply.");
    expect(res1.cleanText).toBe("Here is the simple explanation.");
    expect(res1.toolCalls).toHaveLength(0);

    const raw2 = `<thinking>
Deep philosophical reasoning...
</thinking>
Final answer is 42.`;

    const res2 = parseDotsXml(raw2);
    expect(res2.reasoningContent).toBe("Deep philosophical reasoning...");
    expect(res2.cleanText).toBe("Final answer is 42.");
  });

  it("injects tools schema into system prompt XML when tools array is present", () => {
    const payload: OpenAIRequestPayload = {
      model: "qwen2.5-coder",
      tools: [
        {
          type: "function",
          function: {
            name: "write_file",
            description: "Write contents to a file",
            parameters: {
              type: "object",
              properties: {
                path: { type: "string" },
                content: { type: "string" },
              },
              required: ["path", "content"],
            },
          },
        },
      ],
      messages: [
        { role: "system", content: "You are OpenCode assistant." },
        { role: "user", content: "Create server.js" },
      ],
    };

    const transformed = sanitizeAndTransformPayload(payload, {
      nuances: ["tc"],
    });

    expect(transformed.messages.length).toBe(2);
    expect(transformed.messages[0]?.role).toBe("system");
    expect(transformed.messages[0]?.content).toContain("You are OpenCode assistant.");
    expect(transformed.messages[0]?.content).toContain("# Tools");
    expect(transformed.messages[0]?.content).toContain("<tools>");
    expect(transformed.messages[0]?.content).toContain('"name":"write_file"');
    expect(transformed.messages[0]?.content).toContain("<tool_call>");
    expect(transformed.messages[1]?.role).toBe("user");
  });

  it("strips leaked </role:assistant>, <role:assistant>, <role=assistant>, and whitespace variations", () => {
    const input1 = "</role:assistant>Here is the content";
    const res1 = parseDotsXml(input1);
    expect(res1.cleanText).toBe("Here is the content");

    const input2 = "<role:assistant>Thinking complete.</role:assistant>Ready to proceed.";
    const res2 = parseDotsXml(input2);
    expect(res2.cleanText).toBe("Thinking complete.Ready to proceed.");

    const input3 = "</ role >Whitespace test</  role>";
    const res3 = parseDotsXml(input3);
    expect(res3.cleanText).toBe("Whitespace test");
  });

  it("strips DeepSeek fullwidth template tags (＜｜User｜＞, <｜Assistant｜>, <｜end of sentence｜>)", () => {
    const input1 = "<｜Assistant｜>DeepSeek response<｜end of sentence｜>";
    const res1 = parseDotsXml(input1);
    expect(res1.cleanText).toBe("DeepSeek response");

    const input2 = "＜｜User｜＞Hello＜｜end of sentence｜＞";
    const res2 = parseDotsXml(input2);
    expect(res2.cleanText).toBe("Hello");
  });

  it("strips GLM tokens ([gMASK]<sop>, <|observation|>)", () => {
    const input = "[gMASK]<sop>GLM generated response<|observation|>";
    const res = parseDotsXml(input);
    expect(res.cleanText).toBe("GLM generated response");
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

  it("streams GLM <tool_call>name<arg_key> syntax without leaking <arg_value> or tags to text deltas", async () => {
    const { createDotsStreamTransformer } = await import("../../src/transformers/dots");
    const transformer = createDotsStreamTransformer();

    const chunk1Obj = {
      id: "chatcmpl-glm",
      model: "glm-4",
      choices: [{ delta: { content: '<tool_call>bash\n<arg_key>command</arg_key>\n<arg_value>ls ' } }],
    };
    const chunk2Obj = {
      choices: [{ delta: { content: '-la</arg_value>\n</tool_call>' } }],
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
    expect(resultText).toContain('"name":"bash"');
    expect(resultText).toContain('ls -la');
    expect(resultText).not.toContain('<arg_value>');
    expect(resultText).not.toContain('<arg_key>');
    expect(resultText).not.toContain('<tool_call>');
    expect(resultText).toContain('"finish_reason":"tool_calls"');
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

  it("strips trailing unclosed </role or </ro at end of stream without leaking", async () => {
    const { createDotsStreamTransformer } = await import("../../src/transformers/dots");
    const transformer = createDotsStreamTransformer();

    const chunk1 = 'data: {"id":"chat-1","choices":[{"delta":{"content":"Response text</ro"}}]}\n\n';
    const chunk2 = 'data: [DONE]\n\n';

    const inputChunks = [chunk1, chunk2];

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

    expect(resultText).not.toContain("</ro");
    expect(resultText).toContain("Response text");
  });

  it("emits reasoning_content delta when <think> tag is streamed in content", async () => {
    const { createDotsStreamTransformer } = await import("../../src/transformers/dots");
    const transformer = createDotsStreamTransformer();

    const chunk1 = 'data: {"id":"chat-1","choices":[{"delta":{"content":"<think>Plan step 1</think>Here is the result"}}]}\n\n';
    const chunk2 = 'data: {"id":"chat-1","choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
    const chunk3 = 'data: [DONE]\n\n';

    const inputChunks = [chunk1, chunk2, chunk3];

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

    expect(resultText).toContain('"reasoning_content":"Plan step 1"');
    expect(resultText).toContain('"content":"Here is the result"');
    expect(resultText).not.toContain("<think>");
    expect(resultText).not.toContain("</think>");
  });

  it("emits live incremental reasoning deltas when <think> tag is split across multiple streaming chunks", async () => {
    const { createDotsStreamTransformer } = await import("../../src/transformers/dots");
    const transformer = createDotsStreamTransformer();

    const chunk1 = 'data: {"id":"chat-think","choices":[{"delta":{"content":"<think>Plan step 1"}}]}\n\n';
    const chunk2 = 'data: {"id":"chat-think","choices":[{"delta":{"content":" and step 2"}}]}\n\n';
    const chunk3 = 'data: {"id":"chat-think","choices":[{"delta":{"content":"</think>Final answer rendered"}}]}\n\n';
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

    expect(resultText).toContain('"reasoning_content":"Plan step 1"');
    expect(resultText).toContain('"reasoning_content":" and step 2"');
    expect(resultText).toContain('"content":"Final answer rendered"');
    expect(resultText).not.toContain("<think>");
    expect(resultText).not.toContain("</think>");
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
