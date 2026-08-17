import { describe, expect, it } from "bun:test";
import type { OpenAIMessage } from "../../src/transformers/nuances";
import {
  applyGemmaConstraints,
  mergeConsecutiveMessages,
  normalizeLatex,
  sanitizeAndTransformPayload,
} from "../../src/transformers/payload";

describe("Gemma Transformer — System Prompt Transformation & Turn Merging", () => {
  it("converts system message into prepended [System Context] in first user message", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "You are an expert Python engineer." },
      { role: "user", content: "Write a quicksort function." },
    ];

    const result = applyGemmaConstraints(messages);
    expect(result.length).toBe(1);
    expect(result[0]?.role).toBe("user");
    expect(result[0]?.content).toBe(
      "[System Context: You are an expert Python engineer.]\n\nWrite a quicksort function."
    );
  });

  it("creates a user message if only a system message is present", () => {
    const messages: OpenAIMessage[] = [
      { role: "system", content: "You are an assistant." },
    ];

    const result = applyGemmaConstraints(messages);
    expect(result.length).toBe(1);
    expect(result[0]?.role).toBe("user");
    expect(result[0]?.content).toBe("[System Context: You are an assistant.]");
  });

  it("merges consecutive user messages into a single user turn", () => {
    const messages: OpenAIMessage[] = [
      { role: "user", content: "First part." },
      { role: "user", content: "Second part." },
      { role: "assistant", content: "Acknowledged." },
    ];

    const result = mergeConsecutiveMessages(messages);
    expect(result.length).toBe(2);
    expect(result[0]?.role).toBe("user");
    expect(result[0]?.content).toBe("First part.\n\nSecond part.");
    expect(result[1]?.role).toBe("assistant");
    expect(result[1]?.content).toBe("Acknowledged.");
  });

  it("merges consecutive assistant messages into a single turn", () => {
    const messages: OpenAIMessage[] = [
      { role: "user", content: "Query." },
      { role: "assistant", content: "Answer 1." },
      { role: "assistant", content: "Answer 2." },
    ];

    const result = mergeConsecutiveMessages(messages);
    expect(result.length).toBe(2);
    expect(result[1]?.role).toBe("assistant");
    expect(result[1]?.content).toBe("Answer 1.\n\nAnswer 2.");
  });
});

describe("Gemma Transformer — End-to-End Payload Sanitization", () => {
  it("applies gemma constraints when 'gm' nuance is provided", () => {
    const payload = {
      model: "gemma-4-31b",
      messages: [
        { role: "system" as const, content: "System rule" },
        { role: "user" as const, content: "Hello" },
      ],
      temperature: 0.7,
    };

    const transformed = sanitizeAndTransformPayload(payload, { nuances: ["gm"] });
    expect(transformed.messages.length).toBe(1);
    expect(transformed.messages[0]?.role).toBe("user");
    expect(transformed.messages[0]?.content).toContain("[System Context: System rule]");
  });
});

describe("LaTeX Normalizer", () => {
  it("replaces double-escaped times formula with clean unicode", () => {
    const input = "The speed is 3 \\times 10^8 m/s.";
    const result = normalizeLatex(input);
    expect(result).toBe("The speed is 3 × 10^8 m/s.");
  });

  it("replaces rightarrow with unicode arrow", () => {
    const input = "Step A \\rightarrow Step B.";
    const result = normalizeLatex(input);
    expect(result).toBe("Step A → Step B.");
  });

  it("replaces inequality symbols", () => {
    const input = "a \\leq b and c \\geq d";
    const result = normalizeLatex(input);
    expect(result).toBe("a ≤ b and c ≥ d");
  });
});
