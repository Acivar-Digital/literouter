import { test, expect } from "bun:test";
import {
  mergeConsecutiveMessages,
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

test("getModelLimits returns google model limits for google provider", () => {
  const limits = getModelLimits("google/gemini-3.1-flash-lite", "google");
  expect(limits.max_tpm).toBe(250000);
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
