import { describe, expect, test } from "bun:test";
import { ensureTerminalUserTurn } from "../../src/transformers/opencode_adapter";
import { sanitizeAndTransformPayload } from "../../src/transformers/payload";
import { translateAnthropicToOpenAI } from "../../src/transformers/anthropic_openai_xwire";
import type { OpenAIMessage } from "../../src/transformers/nuances";

describe("ensureTerminalUserTurn & Trailing Assistant Auto-Healing", () => {
  test("returns empty array when messages are empty", () => {
    expect(ensureTerminalUserTurn([])).toEqual([]);
    expect(ensureTerminalUserTurn(undefined)).toEqual([]);
  });

  test("leaves conversation intact when terminal turn is user", () => {
    const msgs: OpenAIMessage[] = [
      { role: "system", content: "You are a helpful assistant" },
      { role: "user", content: "hello" },
    ];
    const res = ensureTerminalUserTurn(msgs);
    expect(res).toEqual(msgs);
    expect(res.length).toBe(2);
  });

  test("appends synthetic user turn when terminal message has role: 'assistant'", () => {
    const msgs: OpenAIMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello there!" },
    ];
    const res = ensureTerminalUserTurn(msgs);
    expect(res.length).toBe(3);
    expect(res[2]).toEqual({ role: "user", content: "ok go on" });
  });

  test("appends synthetic user turn when terminal message has role: 'model'", () => {
    const msgs: OpenAIMessage[] = [
      { role: "user", content: "hi" },
      { role: "model", content: "I am thinking..." } as unknown as OpenAIMessage,
    ];
    const res = ensureTerminalUserTurn(msgs);
    expect(res.length).toBe(3);
    expect(res[2]).toEqual({ role: "user", content: "ok go on" });
  });

  test("wires into sanitizeAndTransformPayload correctly", () => {
    const payload = {
      model: "test-model",
      messages: [
        { role: "user", content: "Step 1 complete" },
        { role: "assistant", content: "Waiting for user input" },
      ] as OpenAIMessage[],
    };
    const transformed = sanitizeAndTransformPayload(payload);
    expect(transformed.messages.length).toBe(3);
    expect(transformed.messages[2]).toEqual({ role: "user", content: "ok go on" });
  });

  test("wires into translateAnthropicToOpenAI correctly", () => {
    const anthropicReq = {
      model: "claude-3-5-sonnet-20241022",
      messages: [
        { role: "user" as const, content: "Do task" },
        { role: "assistant" as const, content: "Starting task..." },
      ],
    };
    const translated = translateAnthropicToOpenAI(anthropicReq);
    expect(translated.messages.length).toBe(3);
    expect(translated.messages[2]).toEqual({ role: "user", content: "ok go on" });
  });
});
