import { beforeEach, describe, expect, it } from "bun:test";
import type { OpenAIMessage } from "../../src/transformers/nuances";
import {
  clearThoughtSignatures,
  getThoughtSignature,
  injectThoughtSignatures,
  storeThoughtSignature,
} from "../../src/transformers/thinking";

describe("Google Thought Signature Store — Capture & Injection", () => {
  beforeEach(() => {
    clearThoughtSignatures();
  });

  it("saves and retrieves thought signature by tool call id", () => {
    storeThoughtSignature("call_tokyo_weather_1", "crypto_sig_abc123xyz");
    const sig = getThoughtSignature("call_tokyo_weather_1");
    expect(sig).toBe("crypto_sig_abc123xyz");
  });

  it("returns undefined for untracked tool call id", () => {
    const sig = getThoughtSignature("call_non_existent");
    expect(sig).toBeUndefined();
  });

  it("injects saved thought signature into matching historical assistant tool call", () => {
    storeThoughtSignature("call_lookup_42", "sig_google_secure_token");

    const messages: OpenAIMessage[] = [
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_lookup_42",
            type: "function",
            function: { name: "lookup", arguments: '{"id":42}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_lookup_42",
        content: '{"result":"found"}',
      },
    ];

    const injected = injectThoughtSignatures(messages);
    expect(injected.length).toBe(2);

    const assistantMsg = injected[0] as OpenAIMessage;
    const toolCall = assistantMsg.tool_calls?.[0];
    expect(toolCall).toBeDefined();

    const extraContent = toolCall?.extra_content;
    expect(extraContent).toBeDefined();

    const googleData = extraContent?.["google"] as Record<string, unknown> | undefined;
    expect(googleData?.["thought_signature"]).toBe("sig_google_secure_token");
  });

  it("leaves messages unchanged if no tool calls exist", () => {
    const messages: OpenAIMessage[] = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
    ];

    const result = injectThoughtSignatures(messages);
    expect(result).toEqual(messages);
  });

  it("clears all stored signatures on clearThoughtSignatures", () => {
    storeThoughtSignature("call_1", "sig_1");
    clearThoughtSignatures();
    expect(getThoughtSignature("call_1")).toBeUndefined();
  });
});
