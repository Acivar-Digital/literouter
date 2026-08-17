import { test, expect } from "bun:test";
import {
  isDotsModel,
  parseDotsXml,
  transformDotsNonStreaming,
  createDotsStreamTransformer,
} from "../../../src/lib";

test("isDotsModel correctly identifies dots models", () => {
  expect(
    isDotsModel("openrouter/dots-studio/dots-3-note-preview:free"),
  ).toBeTrue();
  expect(isDotsModel("dots-3-note-preview")).toBeTrue();
  expect(isDotsModel("DOTS-model")).toBeTrue();
  expect(isDotsModel("nvidia/openai/gpt-oss-120b")).toBeFalse();
  expect(isDotsModel("google/gemini-3.5-flash-lite")).toBeFalse();
  expect(isDotsModel(undefined)).toBeFalse();
  expect(isDotsModel(null as any)).toBeFalse();
});

test("parseDotsXml parses single invoke with complex shell command", () => {
  const xml = `
<dots_function_call>
<invoke name="shell">
<parameter name="command">
cd /home/yapilwsl/arthityap/baziforecaster && git add admin/controls/controls.py tools/read_file.py && echo "staged: $(git diff --cached --name-only | wc -l)"
</parameter>
</invoke>
</dots_function_call>
`;
  const result = parseDotsXml(xml);
  expect(result.length).toBe(1);
  expect(result[0].type).toBe("function");
  expect(result[0].function.name).toBe("shell");
  expect(result[0].id.startsWith("call_dots_")).toBeTrue();

  const parsedArgs = JSON.parse(result[0].function.arguments);
  expect(parsedArgs.command).toContain(
    "cd /home/yapilwsl/arthityap/baziforecaster",
  );
  expect(parsedArgs.command).toContain('echo "staged:');
});

test("parseDotsXml parses multiple parameters and multiple invokes", () => {
  const xml = `
<dots_function_call>
<invoke name="edit_file">
<parameter name="path">src/index.ts</parameter>
<parameter name="content">console.log("hello world");</parameter>
</invoke>
<invoke name="shell">
<parameter name="command">bun test</parameter>
</invoke>
</dots_function_call>
`;
  const result = parseDotsXml(xml);
  expect(result.length).toBe(2);

  expect(result[0].function.name).toBe("edit_file");
  const args0 = JSON.parse(result[0].function.arguments);
  expect(args0.path).toBe("src/index.ts");
  expect(args0.content).toBe('console.log("hello world");');

  expect(result[1].function.name).toBe("shell");
  const args1 = JSON.parse(result[1].function.arguments);
  expect(args1.command).toBe("bun test");
});

test("parseDotsXml returns empty array for non-xml or missing tags", () => {
  expect(parseDotsXml("")).toEqual([]);
  expect(parseDotsXml("Just normal conversational text")).toEqual([]);
  expect(parseDotsXml(null as any)).toEqual([]);
});

test("transformDotsNonStreaming transforms message with dots tool calls", () => {
  const rawData = {
    choices: [
      {
        message: {
          role: "assistant",
          content: `<dots_function_call>
<invoke name="shell">
<parameter name="command">git status</parameter>
</invoke>
</dots_function_call>`,
        },
      },
    ],
  };

  const transformed = transformDotsNonStreaming(rawData);
  const msg = transformed.choices[0].message;
  expect(msg.tool_calls).toBeDefined();
  expect(msg.tool_calls.length).toBe(1);
  expect(msg.tool_calls[0].function.name).toBe("shell");
  expect(JSON.parse(msg.tool_calls[0].function.arguments).command).toBe(
    "git status",
  );
  expect(msg.content).toBeNull();
});

test("transformDotsNonStreaming preserves surrounding text content", () => {
  const rawData = {
    choices: [
      {
        message: {
          role: "assistant",
          content: `Here is the status check:
<dots_function_call>
<invoke name="shell">
<parameter name="command">git status</parameter>
</invoke>
</dots_function_call>
Let me know if you need more.`,
        },
      },
    ],
  };

  const transformed = transformDotsNonStreaming(rawData);
  const msg = transformed.choices[0].message;
  expect(msg.tool_calls.length).toBe(1);
  expect(msg.content).toBe(
    "Here is the status check:\n\nLet me know if you need more.",
  );
});

test("createDotsStreamTransformer parses stream chunks split across boundaries", async () => {
  const transformer = createDotsStreamTransformer();

  // Create stream of SSE chunks with proper JSON encoding
  const textDeltas = [
    "I will run ",
    "the status check.\n<dots_",
    'function_call>\n<invoke name="shell">\n',
    '<parameter name="command">\n',
    "git status\n</parameter>\n",
    "</invoke>\n</dots_function_call>\n",
    "Done!",
  ];

  const chunks = textDeltas.map(
    (text) =>
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`,
  );
  chunks.push("data: [DONE]\n\n");

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  }).pipeThrough(transformer);

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullOutput = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    fullOutput += decoder.decode(value);
  }

  expect(fullOutput).toContain("I will run ");
  expect(fullOutput).toContain("the status check.");
  expect(fullOutput).toContain("tool_calls");
  expect(fullOutput).toContain("call_dots_");
  expect(fullOutput).toContain("shell");
  expect(fullOutput).toContain("git status");
  expect(fullOutput).toContain("Done!");
  expect(fullOutput).toContain("[DONE]");
});

test("createDotsStreamTransformer passes through normal stream untouched", async () => {
  const transformer = createDotsStreamTransformer();
  const textDeltas = ["Hello! ", "How are you today?"];
  const chunks = textDeltas.map(
    (text) =>
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] })}\n\n`,
  );
  chunks.push("data: [DONE]\n\n");

  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  }).pipeThrough(transformer);

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let fullOutput = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    fullOutput += decoder.decode(value);
  }

  expect(fullOutput).toContain("Hello! ");
  expect(fullOutput).toContain("How are you today?");
  expect(fullOutput).not.toContain("tool_calls");
});
