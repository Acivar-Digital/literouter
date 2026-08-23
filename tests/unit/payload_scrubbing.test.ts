import { describe, expect, it } from "bun:test";
import {
  sanitizeAndTransformPayload,
  scrubUnsupportedParameters,
} from "../../src/transformers/payload";
import type { OpenAIRequestPayload } from "../../src/transformers/nuances";

describe("Payload Scrubbing Toggle (LITEROUTER_ENABLE_SCRUBBING)", () => {
  it("preserves thinking, tools, and gemma params when enableScrubbing is false", () => {
    const payload: OpenAIRequestPayload = {
      model: "google/gemma-4-31b",
      messages: [{ role: "user", content: "Hello world" }],
      thinking: { type: "enabled", budget_tokens: 2048 },
      thinkingConfig: { thinkingBudget: 2048 },
      thinking_config: { thinking_level: "minimal" },
      reasoning_effort: "low",
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
      logit_bias: { "50256": -100 },
      tools: [{ type: "function", function: { name: "test_fn" } }],
      tool_choice: "auto",
    } as unknown as OpenAIRequestPayload;

    const res = sanitizeAndTransformPayload(payload, {
      nuances: ["gm"],
      enableScrubbing: false,
      capabilities: { supportsThinking: false, supportsTools: false },
    });

    const record = res as unknown as Record<string, unknown>;
    expect(record.thinking).toBeDefined();
    expect(record.thinkingConfig).toBeDefined();
    expect(record.thinking_config).toBeDefined();
    expect(record.reasoning_effort).toBe("low");
    expect(record.presence_penalty).toBe(0.5);
    expect(record.frequency_penalty).toBe(0.5);
    expect(record.logit_bias).toBeDefined();
    expect(record.tools).toBeDefined();
    expect(record.tool_choice).toBe("auto");
  });

  it("scrubs thinking, tools, and gemma params when enableScrubbing is true", () => {
    const payload: OpenAIRequestPayload = {
      model: "google/gemma-4-31b",
      messages: [{ role: "user", content: "Hello world" }],
      thinking: { type: "enabled", budget_tokens: 2048 },
      thinkingConfig: { thinkingBudget: 2048 },
      thinking_config: { thinking_level: "minimal" },
      reasoning_effort: "low",
      presence_penalty: 0.5,
      frequency_penalty: 0.5,
      logit_bias: { "50256": -100 },
      tools: [{ type: "function", function: { name: "test_fn" } }],
      tool_choice: "auto",
    } as unknown as OpenAIRequestPayload;

    const res = sanitizeAndTransformPayload(payload, {
      nuances: ["gm"],
      enableScrubbing: true,
      capabilities: { supportsThinking: false, supportsTools: false },
    });

    const record = res as unknown as Record<string, unknown>;
    expect(record.thinking).toBeUndefined();
    expect(record.thinkingConfig).toBeUndefined();
    expect(record.thinking_config).toBeUndefined();
    expect(record.reasoning_effort).toBeUndefined();
    expect(record.presence_penalty).toBeUndefined();
    expect(record.frequency_penalty).toBeUndefined();
    expect(record.logit_bias).toBeUndefined();
    expect(record.tools).toBeUndefined();
    expect(record.tool_choice).toBeUndefined();
  });

  it("scrubUnsupportedParameters directly respects enableScrubbing flag", () => {
    const payload = {
      model: "test-model",
      messages: [{ role: "user", content: "test" }],
      thinking: { budget: 100 },
      tools: [{ type: "function" }],
    } as unknown as OpenAIRequestPayload;

    const withoutScrubbing = scrubUnsupportedParameters(
      payload,
      { supportsThinking: false, supportsTools: false },
      false
    );
    expect((withoutScrubbing as unknown as Record<string, unknown>).thinking).toBeDefined();
    expect((withoutScrubbing as unknown as Record<string, unknown>).tools).toBeDefined();

    const withScrubbing = scrubUnsupportedParameters(
      payload,
      { supportsThinking: false, supportsTools: false },
      true
    );
    expect((withScrubbing as unknown as Record<string, unknown>).thinking).toBeUndefined();
    expect((withScrubbing as unknown as Record<string, unknown>).tools).toBeUndefined();
  });
});
