import { describe, expect, it } from "bun:test";
import {
  createStreamThinkingState,
  processThinkingDelta,
  shouldStripReasoning,
  stripReasoningParameters,
} from "../../src/transformers/thinking";

describe("Thinking Transformer — Streaming Delta Processing", () => {
  it("strips thinking block content when preserveThinking is false", () => {
    const state = createStreamThinkingState();
    const chunk1 = "Hello <think>secret reasoning</think> world!";
    const out = processThinkingDelta(chunk1, state, false);

    expect(out).toContain("Hello ");
    expect(out).toContain(" world!");
    expect(out).not.toContain("secret reasoning");
  });

  it("converts thinking block to thinking_delta when preserveThinking is true", () => {
    const state = createStreamThinkingState();
    const chunk = "Intro <think>Deep mathematical analysis</think> Outro";
    const out = processThinkingDelta(chunk, state, true);

    expect(out).toContain("thinking_delta");
    expect(out).toContain("Deep mathematical analysis");
    expect(out).toContain("Intro ");
    expect(out).toContain(" Outro");
  });

  it("passes clean text without thinking tags as text_delta", () => {
    const state = createStreamThinkingState();
    const out = processThinkingDelta("Standard stream chunk", state, false);

    expect(out).toContain("text_delta");
    expect(out).toContain("Standard stream chunk");
  });
});

describe("Thinking Transformer — Reasoning Stripping Policy", () => {
  it("preserves reasoning if 'ts' nuance is present, overriding global default", () => {
    const preserve = !shouldStripReasoning(true, ["ts"]);
    expect(preserve).toBe(true);
  });

  it("strips reasoning if 'sb' nuance is present, overriding global default", () => {
    const strip = shouldStripReasoning(false, ["sb"]);
    expect(strip).toBe(true);
  });

  it("follows global default when neither 'ts' nor 'sb' is specified", () => {
    expect(shouldStripReasoning(true, ["no"])).toBe(true);
    expect(shouldStripReasoning(false, ["no"])).toBe(false);
  });
});

describe("Thinking Transformer — Payload Parameter Scrubber", () => {
  it("removes reasoning and thinking parameters from payload", () => {
    const payload: Record<string, unknown> = {
      model: "deepseek/deepseek-r1",
      messages: [{ role: "user", content: "Solve puzzle" }],
      thinking: { budget_tokens: 4096 },
      thinkingConfig: { thinkingBudget: 4096 },
      reasoning_effort: "high",
      temperature: 0.7,
    };

    const cleaned = stripReasoningParameters(payload);
    expect(cleaned.thinking).toBeUndefined();
    expect(cleaned.thinkingConfig).toBeUndefined();
    expect(cleaned.reasoning_effort).toBeUndefined();
    expect(cleaned.temperature).toBe(0.7);
    expect(cleaned.model).toBe("deepseek/deepseek-r1");
  });
});
