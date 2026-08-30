import { describe, expect, it } from "bun:test";
import {
  DEFAULT_SAFE_CONTEXT_TOKENS,
  extractContextLimit,
  isContextLengthError,
  normalizeAnthropicAlternation,
  pruneAnthropicPayload,
  pruneOpenAIPayload,
  sanitizeAnthropicToolReferences,
} from "../../src/transformers/context_pruner";
import type { AnthropicMessagesRequest } from "../../src/handlers/anthropic_compat";
import type { OpenAIRequestPayload } from "../../src/transformers/nuances";

describe("Context Pruner & Overflow Guard", () => {
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

  it("sanitizes orphaned Anthropic tool_result blocks when preceding tool_use is pruned", () => {
    const messages = [
      {
        role: "user" as const,
        content: [
          {
            type: "tool_result" as const,
            tool_use_id: "orphaned_call_123",
            content: "File contents of big_file.txt...",
          },
        ],
      },
      {
        role: "assistant" as const,
        content: "Understood, proceeding.",
      },
    ];

    const sanitized = sanitizeAnthropicToolReferences(messages);
    expect(sanitized[0]!.content).toBeArray();
    const firstBlock = (sanitized[0]!.content as any[])[0];
    expect(firstBlock.type).toBe("text");
    expect(firstBlock.text).toContain("[Pruned tool result (orphaned_call_123)]");
  });

  it("normalizes Anthropic message alternation", () => {
    const messages = [
      { role: "assistant" as const, content: "First assistant" },
      { role: "user" as const, content: "User 1" },
      { role: "user" as const, content: "User 2" },
      { role: "assistant" as const, content: "Assistant 2" },
    ];

    const normalized = normalizeAnthropicAlternation(messages);
    expect(normalized[0]!.role).toBe("user");
    expect(normalized.length).toBe(4); // synthetic user + assistant + merged user turns + assistant
  });

  it("prunes oversized Anthropic conversation payloads down to target token limit", () => {
    const longText = "word ".repeat(50000); // ~70k tokens
    const req: AnthropicMessagesRequest = {
      model: "inclusionai/ling-3.0-flash-fin:free",
      system: "You are a helpful assistant.",
      messages: [
        { role: "user", content: "Initial user instruction" },
        { role: "assistant", content: `Step 1 output: ${longText}` },
        { role: "user", content: `Step 2 prompt: ${longText}` },
        { role: "assistant", content: `Step 2 output: ${longText}` },
        { role: "user", content: `Step 3 prompt: ${longText}` },
        { role: "assistant", content: `Step 3 output: ${longText}` },
        { role: "user", content: "Final question: What is the summary?" },
      ],
    };

    const pruned = pruneAnthropicPayload(req, 100000);
    expect(pruned.messages.length).toBeLessThan(req.messages.length);
    expect(pruned.messages[0]!.role).toBe("user");
    expect(pruned.messages[pruned.messages.length - 1]!.content).toBe("Final question: What is the summary?");
  });

  it("prunes oversized OpenAI conversation payloads while keeping system messages", () => {
    const longText = "token ".repeat(50000);
    const req: OpenAIRequestPayload = {
      model: "gpt-4o",
      messages: [
        { role: "system", content: "System prompt here." },
        { role: "user", content: `Turn 1: ${longText}` },
        { role: "assistant", content: `Turn 1 reply: ${longText}` },
        { role: "user", content: `Turn 2: ${longText}` },
        { role: "assistant", content: `Turn 2 reply: ${longText}` },
        { role: "user", content: "Turn 3 final question" },
      ],
    };

    const pruned = pruneOpenAIPayload(req, 100000);
    expect(pruned.messages.length).toBeLessThan(req.messages.length);
    expect(pruned.messages[0]!.role).toBe("system");
    expect(pruned.messages[pruned.messages.length - 1]!.content).toBe("Turn 3 final question");
  });
});
