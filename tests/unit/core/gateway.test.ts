import { test, expect } from "bun:test";
import {
  mergeConsecutiveMessages,
  cleanGemmaPayload,
  cleanLatexSymbols,
  getModelLimits,
  staticValidateKeys,
  sanitizeHistoricalMessages,
  createStreamTransformer,
} from "../../../src/lib";

test("mergeConsecutiveMessages merges consecutive same-role string content", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "user", content: "there" },
    { role: "assistant", content: "hi" },
  ];
  const merged = mergeConsecutiveMessages(messages);
  expect(merged).toEqual([
    { role: "user", content: "hello\n\nthere" },
    { role: "assistant", content: "hi" },
  ]);
});

test("mergeConsecutiveMessages merges consecutive same-role array content", () => {
  const messages = [
    {
      role: "user",
      content: [{ type: "text", text: "a" }],
    },
    {
      role: "user",
      content: [{ type: "text", text: "b" }],
    },
    { role: "assistant", content: "ok" },
  ];
  const merged = mergeConsecutiveMessages(messages);
  expect(merged).toEqual([
    {
      role: "user",
      content: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    },
    { role: "assistant", content: "ok" },
  ]);
});

test("mergeConsecutiveMessages returns empty array for non-array input", () => {
  expect(mergeConsecutiveMessages(null as any)).toEqual([]);
  expect(mergeConsecutiveMessages(undefined as any)).toEqual([]);
});

test("cleanGemmaPayload strips thinkingConfig recursively", () => {
  const payload = {
    contents: [{ parts: [{ text: "hi" }] }],
    thinkingConfig: { includeThoughts: true },
    generationConfig: {
      presence_penalty: 0.5,
      maxOutputTokens: 100,
    },
  };
  const cleaned = cleanGemmaPayload(payload);
  expect(cleaned.thinkingConfig).toBeUndefined();
  expect(cleaned.generationConfig.presence_penalty).toBeUndefined();
  expect(cleaned.generationConfig.maxOutputTokens).toBe(100);
  expect(cleaned.contents).toEqual([{ parts: [{ text: "hi" }] }]);
});

test("cleanGemmaPayload strips unsupported keys inside arrays", () => {
  const payload = [
    { user: "x", seed: 1, text: "keep" },
    { logprobs: true, keepMe: 2 },
  ];
  const cleaned = cleanGemmaPayload(payload);
  expect(cleaned[0]).toEqual({ text: "keep" });
  expect(cleaned[1]).toEqual({ keepMe: 2 });
});

test("cleanLatexSymbols converts \\times and \\rightarrow", () => {
  expect(cleanLatexSymbols("a \\times b")).toBe("a × b");
  expect(cleanLatexSymbols("a \\rightarrow b")).toBe("a → b");
  expect(cleanLatexSymbols("a $\\to$ b")).toBe("a → b");
});

test("getModelLimits returns default limits when MODEL_LIMITS is empty", () => {
  const limits = getModelLimits("google/gemini-3.1-flash-lite", "google");
  expect(limits.max_tpm).toBe(1000000);
  expect(limits.max_rpm).toBe(15);
});

test("getModelLimits falls back to provider default when no model match", () => {
  const limits = getModelLimits("some-other-model", "nvidia");
  expect(limits.max_rpm).toBe(40);
});

test("getModelLimits returns DEFAULT_LIMITS with no provider", () => {
  const limits = getModelLimits("unknown-model");
  expect(limits.max_tpm).toBe(1000000);
});

test("staticValidateKeys rejects placeholder and short keys", () => {
  const keys = staticValidateKeys(
    "GOOGLE",
    "changeme, sk-short, <your_key_here>, AIzaSy_tooShort, realkey0123456789abcdefghijklmnop",
  );
  expect(keys).toEqual(["realkey0123456789abcdefghijklmnop"]);
});

test("staticValidateKeys returns empty for empty input", () => {
  expect(staticValidateKeys("GOOGLE", "")).toEqual([]);
});

test("sanitizeHistoricalMessages strips thought blocks and Thinking placeholders from previous assistant messages", () => {
  const messages = [
    { role: "user", content: "hello" },
    { role: "assistant", content: "Thinking... \n\nHello! How can I help?" },
    { role: "assistant", content: "<thought>\nlet me think...\n</thought>\nHere is the answer." },
  ];
  sanitizeHistoricalMessages(messages);
  expect(messages[1].content).toBe("Hello! How can I help?");
  expect(messages[2].content).toBe("Here is the answer.");
});

test("createStreamTransformer wraps reasoning in <thought> tags when collapseReasoning=true", async () => {
  const transformer = createStreamTransformer(true);
  const writer = transformer.writable.getWriter();
  const reader = transformer.readable.getReader();

  const chunk1 = 'data: {"choices":[{"delta":{"reasoning":"let me think"}}]}\n\n';
  const chunk2 = 'data: {"choices":[{"delta":{"reasoning":" more thinking"}}]}\n\n';
  const chunk3 = 'data: {"choices":[{"delta":{"content":"Here is the answer"}}]}\n\n';

  writer.write(new TextEncoder().encode(chunk1));
  writer.write(new TextEncoder().encode(chunk2));
  writer.write(new TextEncoder().encode(chunk3));
  writer.close();

  let output = "";
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output += decoder.decode(value);
    if (output.includes("[DONE]")) break;
  }

  expect(output).toContain("<thought>\\nlet me think");
  expect(output).toContain(" more thinking");
  expect(output).toContain("\\n</thought>\\nHere is the answer");
});
