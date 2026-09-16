import { describe, it, expect } from "bun:test";
import {
  toAnthropicRequest,
  fromAnthropicResponse,
  anthropicDeltaToOpenAiChunks,
  createAnthropicSseState,
} from "../../eval/anthropic_bridge";

describe("anthropic_bridge — request mapping", () => {
  it("maps system prompt, max_tokens and plain messages", () => {
    const out = toAnthropicRequest({
      model: "union-alpha",
      max_tokens: 128,
      messages: [
        { role: "system", content: "Be terse." },
        { role: "user", content: "hi" },
        { role: "assistant", content: "hello" },
        { role: "user", content: "bye" },
      ],
    });
    expect(out.model).toBe("union-alpha");
    expect(out.max_tokens).toBe(128);
    expect(out.system).toBe("Be terse.");
    expect(out.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "bye" },
    ]);
  });

  it("maps OpenAI tool definitions and forced tool_choice", () => {
    const out = toAnthropicRequest({
      model: "m",
      messages: [{ role: "user", content: "x" }],
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: { city: { type: "string" } } },
          },
        },
      ],
      tool_choice: { type: "function", function: { name: "get_weather" } },
    });
    expect(out.tools).toEqual([
      {
        name: "get_weather",
        description: "Get weather",
        input_schema: { type: "object", properties: { city: { type: "string" } } },
      },
    ]);
    expect(out.tool_choice).toEqual({ type: "tool", name: "get_weather" });
  });

  it("maps assistant tool_calls to tool_use blocks and tool results to tool_result blocks", () => {
    const out = toAnthropicRequest({
      model: "m",
      messages: [
        { role: "user", content: "read the file" },
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: "call_1", type: "function", function: { name: "read_file", arguments: '{"path":"a.ts"}' } },
          ],
        },
        { role: "tool", tool_call_id: "call_1", content: "file body" },
      ],
    });
    expect(out.messages).toEqual([
      { role: "user", content: "read the file" },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "call_1", name: "read_file", input: { path: "a.ts" } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", content: "file body" }] },
    ]);
  });

  it("maps data-URI image_url content parts to Anthropic image blocks", () => {
    const dataUri = "data:image/png;base64,aGVsbG8=";
    const out = toAnthropicRequest({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: dataUri } },
          ],
        },
      ],
    });
    expect((out.messages as any[])[0].content).toEqual([
      { type: "text", text: "look" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
    ]);
  });

  it("defaults max_tokens when absent (Anthropic requires it)", () => {
    const out = toAnthropicRequest({ model: "m", messages: [{ role: "user", content: "x" }] });
    expect(out.max_tokens).toBe(4096);
  });
});

describe("anthropic_bridge — response mapping", () => {
  it("maps text response to OpenAI chat completion shape", () => {
    const out = fromAnthropicResponse(
      {
        id: "msg_1",
        model: "union-alpha",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "hello" }],
        usage: { input_tokens: 3, output_tokens: 5 },
      },
      "m"
    );
    expect(out.object).toBe("chat.completion");
    expect((out.choices as any[])[0].message.content).toBe("hello");
    expect((out.choices as any[])[0].finish_reason).toBe("stop");
    expect(out.usage).toEqual({ prompt_tokens: 3, completion_tokens: 5, total_tokens: 8 });
  });

  it("maps tool_use blocks to OpenAI tool_calls", () => {
    const out = fromAnthropicResponse(
      {
        id: "msg_2",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "tu_1", name: "read_file", input: { path: "a" } }],
        usage: { input_tokens: 1, output_tokens: 2 },
      },
      "m"
    );
    const choice = (out.choices as any[])[0];
    expect(choice.finish_reason).toBe("tool_calls");
    expect(choice.message.tool_calls[0].function.name).toBe("read_file");
    expect(JSON.parse(choice.message.tool_calls[0].function.arguments)).toEqual({ path: "a" });
  });

  it("maps max_tokens stop reason to length", () => {
    const out = fromAnthropicResponse(
      { stop_reason: "max_tokens", content: [{ type: "text", text: "abc" }], usage: {} },
      "m"
    );
    expect((out.choices as any[])[0].finish_reason).toBe("length");
  });
});

describe("anthropic_bridge — SSE delta translation (stateful)", () => {
  it("translates text stream, tool-use stream and final usage without buffering", () => {
    const state = createAnthropicSseState();

    // text flow
    let chunks = anthropicDeltaToOpenAiChunks(
      { type: "content_block_start", index: 0, content_block: { type: "text" } },
      state
    );
    expect(chunks).toHaveLength(0);
    chunks = anthropicDeltaToOpenAiChunks(
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "he" } },
      state
    );
    expect(chunks[0]!.choices[0]!.delta.content).toBe("he");
    chunks = anthropicDeltaToOpenAiChunks(
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "llo" } },
      state
    );
    expect(chunks[0]!.choices[0]!.delta.content).toBe("llo");

    // tool flow: second block
    chunks = anthropicDeltaToOpenAiChunks(
      { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "tu_9", name: "patch" } },
      state
    );
    expect(chunks[0]!.choices[0]!.delta.tool_calls[0]).toEqual({
      index: 0,
      id: "tu_9",
      type: "function",
      function: { name: "patch", arguments: "" },
    });
    chunks = anthropicDeltaToOpenAiChunks(
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: '{"a":1' } },
      state
    );
    expect(chunks[0]!.choices[0]!.delta.tool_calls[0]!.function.arguments).toBe('{"a":1');
    chunks = anthropicDeltaToOpenAiChunks(
      { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "}" } },
      state
    );
    expect(chunks[0]!.choices[0]!.delta.tool_calls[0]!.function.arguments).toBe("}");

    chunks = anthropicDeltaToOpenAiChunks(
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 17 } },
      state
    );
    expect(chunks[0]!.choices[0]!.finish_reason).toBe("tool_calls");
    expect(chunks[0]!.usage).toEqual({ prompt_tokens: 0, completion_tokens: 17, total_tokens: 17 });
  });

  it("maps thinking deltas to reasoning_content", () => {
    const state = createAnthropicSseState();
    const chunks = anthropicDeltaToOpenAiChunks(
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "hmm" } },
      state
    );
    expect(chunks[0]!.choices[0]!.delta.reasoning_content).toBe("hmm");
  });

  it("maps message_start input tokens into usage state", () => {
    const state = createAnthropicSseState();
    anthropicDeltaToOpenAiChunks(
      { type: "message_start", message: { usage: { input_tokens: 48 } } },
      state
    );
    const chunks = anthropicDeltaToOpenAiChunks(
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 4 } },
      state
    );
    expect(chunks[0]!.usage!.total_tokens).toBe(52); // 48 input + 4 output
  });
});
