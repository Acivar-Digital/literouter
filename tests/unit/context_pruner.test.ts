import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SAFE_CONTEXT_TOKENS,
  DEFAULT_MAX_CONTEXT_TOKENS,
  estimateTextTokens,
  estimateAnthropicTokens,
  estimateOpenAITokens,
  extractContextLimit,
  isContextLengthError,
  normalizeAnthropicAlternation,
  pruneAnthropicPayload,
  pruneOpenAIPayload,
  sanitizeAnthropicToolReferences,
  sanitizeOpenAIToolReferences,
} from "../../src/transformers/context_pruner";
import type { AnthropicMessagesRequest } from "../../src/handlers/anthropic_compat";
import type { OpenAIRequestPayload } from "../../src/transformers/nuances";

describe("Context Pruner & Forwarder Contract", () => {
  it("detects context length errors across provider formats", () => {
    expect(
      isContextLengthError(
        400,
        "The input (263247 tokens) is longer than the model's context length (262144 tokens). trace_id: f1fe7aebfbb65520b18ee10ad4829efa"
      )
    ).toBe(true);

    expect(
      isContextLengthError(
        400,
        "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens."
      )
    ).toBe(true);

    expect(
      isContextLengthError(400, '{"error":{"message":"context_length_exceeded","type":"invalid_request_error"}}')
    ).toBe(true);

    expect(
      isContextLengthError(400, "Input tokens exceed model context window (131072)")
    ).toBe(true);

    expect(
      isContextLengthError(400, "Invalid API key provided")
    ).toBe(false);
  });

  it("extracts exact context limit integer from upstream error strings", () => {
    expect(
      extractContextLimit(
        "The input (263247 tokens) is longer than the model's context length (262144 tokens)."
      )
    ).toBe(262144);

    expect(
      extractContextLimit(
        "This model's maximum context length is 128000 tokens. However, your messages resulted in 130000 tokens."
      )
    ).toBe(128000);

    expect(
      extractContextLimit("Input tokens exceed model context window (131072)")
    ).toBe(131072);
  });

  it("accurately estimates text tokens and payload tokens", () => {
    expect(estimateTextTokens("")).toBe(0);
    expect(estimateTextTokens("hello world")).toBeGreaterThan(0);

    const anthropicReq: AnthropicMessagesRequest = {
      model: "claude-3-5-sonnet-20241022",
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "hello world" }],
    };
    expect(estimateAnthropicTokens(anthropicReq)).toBeGreaterThan(5);

    const openaiReq: OpenAIRequestPayload = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello world" }],
    };
    expect(estimateOpenAITokens(openaiReq)).toBeGreaterThan(5);
  });

  it("acts as a dumb forwarder: preserves Anthropic payloads without message mutation", () => {
    const messages = [
      { role: "user" as const, content: "Initial user instruction" },
      { role: "assistant" as const, content: "Step 1 output" },
      { role: "user" as const, content: "Final question" },
    ];
    const req: AnthropicMessagesRequest = {
      model: "claude-3-5-sonnet-20241022",
      messages,
    };

    const result = pruneAnthropicPayload(req, 10);
    expect(result.messages.length).toBe(3);
    expect(result.messages).toEqual(messages);

    expect(sanitizeAnthropicToolReferences(messages)).toBe(messages);
    expect(normalizeAnthropicAlternation(messages)).toBe(messages);
  });

  it("acts as a dumb forwarder: preserves OpenAI payloads without message mutation", () => {
    const messages = [
      { role: "system" as const, content: "System prompt" },
      { role: "user" as const, content: "Turn 1" },
      { role: "assistant" as const, content: "Turn 1 reply" },
      { role: "user" as const, content: "Turn 2 question" },
    ];
    const req: OpenAIRequestPayload = {
      model: "gpt-4o",
      messages,
    };

    const result = pruneOpenAIPayload(req, 10);
    expect(result.messages.length).toBe(4);
    expect(result.messages).toEqual(messages);

    expect(sanitizeOpenAIToolReferences(messages)).toBe(messages);
  });
});
