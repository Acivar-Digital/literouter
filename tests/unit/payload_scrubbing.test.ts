import { describe, expect, it } from "bun:test";
import {
  cleanOpenAIBody,
  sanitizeAndTransformPayload,
  scrubReasoningFromMessage,
  scrubReasoningFromMessages,
  scrubUnsupportedParameters,
} from "../../src/transformers/payload";
import type {
  OpenAIContentPart,
  OpenAIMessage,
  OpenAIRequestPayload,
} from "../../src/transformers/nuances";

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

describe("Inbound Request Reasoning Scrubbing (OpenCode2 Inbound Payload)", () => {
  it("scrubs a message with 375+ reasoning parts down to pure text content", () => {
    const parts: OpenAIContentPart[] = [];
    for (let i = 0; i < 400; i++) {
      parts.push({
        type: i % 2 === 0 ? "reasoning" : "thought",
        text: `Internal thought step ${i}`,
        reasoningDetails: { step: i },
      });
    }
    parts.push({
      type: "text",
      text: "Final user question after extended thinking session",
    });

    const inboundMessage: OpenAIMessage = {
      role: "user",
      content: parts,
      reasoning: "stale message reasoning",
      reasoning_content: "stale reasoning content",
      reasoning_details: [{ type: "thought", text: "stale details" }],
      thought: "stale thought",
      thinking: "stale thinking",
    };

    const cleaned = scrubReasoningFromMessage(inboundMessage);

    // Collapsed single remaining text part to string
    expect(cleaned.content).toBe("Final user question after extended thinking session");
    expect(cleaned.reasoning).toBeUndefined();
    expect(cleaned.reasoning_content).toBeUndefined();
    expect(cleaned.reasoning_details).toBeUndefined();
    expect(cleaned.thought).toBeUndefined();
    expect(cleaned.thinking).toBeUndefined();
  });

  it("normalizes empty message content to empty string when all parts are reasoning", () => {
    const parts: OpenAIContentPart[] = [
      { type: "reasoning", text: "step 1" },
      { type: "thought", text: "step 2" },
      { type: "thinking", text: "step 3" },
      { type: "custom", reasoningField: "field" },
    ];

    const inboundMessage: OpenAIMessage = {
      role: "assistant",
      content: parts,
      tool_calls: [
        {
          id: "call_123",
          type: "function",
          function: { name: "readFile", arguments: "{}" },
        },
      ],
      reasoning: "assistant thought",
    };

    const cleaned = scrubReasoningFromMessage(inboundMessage);

    expect(cleaned.content).toBe("");
    expect(cleaned.tool_calls).toHaveLength(1);
    expect(cleaned.tool_calls?.[0]?.function.name).toBe("readFile");
    expect(cleaned.reasoning).toBeUndefined();
  });

  it("preserves multi-part content arrays if multiple non-reasoning parts remain", () => {
    const parts: OpenAIContentPart[] = [
      { type: "reasoning", text: "thought 1" },
      { type: "text", text: "First paragraph." },
      { type: "thought", text: "thought 2" },
      { type: "text", text: "Second paragraph." },
      { type: "image_url", image_url: { url: "https://example.com/image.png" } },
    ];

    const inboundMessage: OpenAIMessage = {
      role: "user",
      content: parts,
    };

    const cleaned = scrubReasoningFromMessage(inboundMessage);

    expect(Array.isArray(cleaned.content)).toBe(true);
    const contentArr = cleaned.content as OpenAIContentPart[];
    expect(contentArr).toHaveLength(3);
    expect(contentArr[0]?.type).toBe("text");
    expect(contentArr[0]?.text).toBe("First paragraph.");
    expect(contentArr[1]?.type).toBe("text");
    expect(contentArr[1]?.text).toBe("Second paragraph.");
    expect(contentArr[2]?.type).toBe("image_url");
  });

  it("pipeline sanitizeAndTransformPayload / cleanOpenAIBody scrubs full conversation history with 375+ reasoning parts", () => {
    const heavyHistory: OpenAIMessage[] = [];

    // Turn 1: User
    heavyHistory.push({ role: "user", content: "Solve this complex puzzle." });

    // Turn 2: Assistant with 375 reasoning parts and tool call
    const reasoningParts: OpenAIContentPart[] = [];
    for (let i = 0; i < 375; i++) {
      reasoningParts.push({
        type: "reasoning",
        text: `Hypothesis verification step ${i}`,
        reasoning_details: { depth: i },
      });
    }
    reasoningParts.push({
      type: "text",
      text: "I will check the configuration file first.",
    });

    heavyHistory.push({
      role: "assistant",
      content: reasoningParts,
      reasoning_content: "Long reasoning content block",
      reasoning: "Overall reasoning block",
      tool_calls: [
        {
          id: "call_abc",
          type: "function",
          function: { name: "cat", arguments: '{"path":"file.txt"}' },
        },
      ],
    });

    // Turn 3: Tool response
    heavyHistory.push({
      role: "tool",
      tool_call_id: "call_abc",
      content: "file content: verified",
    });

    // Turn 4: User follow-up with thought parts
    heavyHistory.push({
      role: "user",
      content: [
        { type: "thought", text: "user thinking" },
        { type: "text", text: "Proceed to next step." },
      ],
    });

    const payload: OpenAIRequestPayload = {
      model: "openrouter/anthropic/claude-3.7-sonnet",
      messages: heavyHistory,
      stream: true,
    };

    const transformed = cleanOpenAIBody(payload);

    expect(transformed.messages).toHaveLength(4);

    // Verify Turn 1
    expect(transformed.messages[0]?.content).toBe("Solve this complex puzzle.");

    // Verify Turn 2 (375 reasoning parts removed from content array, collapsed to string, reasoning_content preserved for tool calls)
    const turn2 = transformed.messages[1];
    expect(turn2?.content).toBe("I will check the configuration file first.");
    expect(turn2?.reasoning_content).toBe("Long reasoning content block");
    expect(turn2?.reasoning).toBeUndefined();
    expect(turn2?.tool_calls).toHaveLength(1);

    // Verify Turn 3
    expect(transformed.messages[2]?.content).toBe("file content: verified");

    // Verify Turn 4 (thought part removed, single text part collapsed)
    expect(transformed.messages[3]?.content).toBe("Proceed to next step.");
  });

  it("handles undefined or empty messages array gracefully", () => {
    expect(scrubReasoningFromMessages(undefined)).toEqual([]);
    expect(scrubReasoningFromMessages([])).toEqual([]);
  });
});

describe("Strict Tool Payload Normalization & Client Metadata Stripping", () => {
  it("normalizes role: 'tool' content array into a single newline-separated string", () => {
    const toolMessage = {
      role: "tool",
      tool_call_id: "call_abc123",
      content: [
        { type: "text", text: "Output from tool part 1" },
        "Raw string part 2",
        { jsonResult: { success: true } },
      ],
      id: "msg_client_tool_id",
      name: "run_command",
      providerState: { cached: true },
      state: "completed",
      createdAt: 1720000000,
    } as unknown as OpenAIMessage;

    const scrubbed = scrubReasoningFromMessage(toolMessage);

    expect(typeof scrubbed.content).toBe("string");
    expect(scrubbed.content).toBe(
      'Output from tool part 1\nRaw string part 2\n{"jsonResult":{"success":true}}'
    );
    expect(scrubbed.role).toBe("tool");
    expect(scrubbed.tool_call_id).toBe("call_abc123");

    // Verify non-standard client properties are stripped
    const record = scrubbed as Record<string, unknown>;
    expect(record.id).toBeUndefined();
    expect(record.name).toBeUndefined();
    expect(record.providerState).toBeUndefined();
    expect(record.state).toBeUndefined();
    expect(record.createdAt).toBeUndefined();
  });

  it("ensures role: 'tool' content is always a string even if null or undefined", () => {
    const nullContentTool = {
      role: "tool",
      tool_call_id: "call_empty",
      content: null as unknown as string,
    } as OpenAIMessage;

    const scrubbed = scrubReasoningFromMessage(nullContentTool);
    expect(typeof scrubbed.content).toBe("string");
    expect(scrubbed.content).toBe("");
  });

  it("strips client metadata from role: 'user' and role: 'assistant' messages while preserving standard fields", () => {
    const userMessage = {
      role: "user",
      content: "Hello",
      id: "client_user_1",
      providerState: { status: "active" },
      state: "pending",
      reasoning_details: [{ step: 1 }],
    } as unknown as OpenAIMessage;

    const assistantMessage = {
      role: "assistant",
      content: "Here is the result",
      tool_calls: [
        {
          id: "call_xyz",
          type: "function",
          function: { name: "readFile", arguments: '{"path":"a.txt"}' },
        },
      ],
      id: "client_asst_1",
      providerState: { cached: false },
      state: "stream_done",
      reasoning_details: [{ step: 2 }],
    } as unknown as OpenAIMessage;

    const scrubbedUser = scrubReasoningFromMessage(userMessage);
    const scrubbedAsst = scrubReasoningFromMessage(assistantMessage);

    const userRecord = scrubbedUser as Record<string, unknown>;
    expect(userRecord.content).toBe("Hello");
    expect(userRecord.id).toBeUndefined();
    expect(userRecord.providerState).toBeUndefined();
    expect(userRecord.state).toBeUndefined();
    expect(userRecord.reasoning_details).toBeUndefined();

    const asstRecord = scrubbedAsst as Record<string, unknown>;
    expect(asstRecord.content).toBe("Here is the result");
    expect(asstRecord.tool_calls).toHaveLength(1);
    expect(asstRecord.id).toBeUndefined();
    expect(asstRecord.providerState).toBeUndefined();
    expect(asstRecord.state).toBeUndefined();
    expect(asstRecord.reasoning_details).toBeUndefined();
  });
});
