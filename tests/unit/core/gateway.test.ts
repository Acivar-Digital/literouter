import { test, expect } from "bun:test";
import {
  mergeConsecutiveMessages,
  sanitizeHistoricalMessages,
  cleanGemmaPayload,
  cleanLatexSymbols,
  getModelLimits,
  staticValidateKeys,
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

test("sanitizeHistoricalMessages strips reasoning fields from assistant messages", () => {
  const messages = [
    { role: "system", content: "system prompt" },
    { role: "user", content: "what is 2+2?" },
    {
      role: "assistant",
      content: "4",
      reasoning_content: "thinking about addition...",
      reasoningContent: "legacy field",
      thought: "google thought",
      thought_summary: "summary",
    },
    { role: "user", content: "what about 3+3?" },
  ];
  const cleaned = sanitizeHistoricalMessages(messages);
  expect(cleaned).toEqual([
    { role: "system", content: "system prompt" },
    { role: "user", content: "what is 2+2?" },
    { role: "assistant", content: "4" },
    { role: "user", content: "what about 3+3?" },
  ]);
});

test("sanitizeHistoricalMessages preserves tool_calls and ensures content string when empty", () => {
  const messages = [
    {
      role: "assistant",
      content: null,
      reasoning_content: "planning to run bash tool...",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "bash", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "call_1", content: "ok" },
  ];
  const cleaned = sanitizeHistoricalMessages(messages);
  expect(cleaned).toEqual([
    {
      role: "assistant",
      content: "",
      tool_calls: [{ id: "call_1", type: "function", function: { name: "bash", arguments: "{}" } }],
    },
    { role: "tool", tool_call_id: "call_1", content: "ok" },
  ]);
});

test("sanitizeHistoricalMessages respects stripReasoning = false", () => {
  const messages = [
    {
      role: "assistant",
      content: "hi",
      reasoning_content: "keep me",
    },
  ];
  const cleaned = sanitizeHistoricalMessages(messages, false);
  expect(cleaned).toEqual([
    {
      role: "assistant",
      content: "hi",
      reasoning_content: "keep me",
    },
  ]);
});

test("sanitizeHistoricalMessages normalizes null content on assistant without tool_calls", () => {
  const messages = [
    {
      role: "assistant",
      content: null,
      reasoning_content: "internal monologue",
    },
  ];
  const cleaned = sanitizeHistoricalMessages(messages);
  expect(cleaned).toEqual([
    {
      role: "assistant",
      content: "",
    },
  ]);
});

test("sanitizeHistoricalMessages handles null/undefined input safely", () => {
  expect(sanitizeHistoricalMessages(null as any)).toEqual([]);
  expect(sanitizeHistoricalMessages(undefined as any)).toEqual([]);
});
