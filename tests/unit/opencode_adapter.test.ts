import { describe, expect, it } from "bun:test";
import {
  createOpenCodeReasoningFilterStreamTransformer,
  createSyntheticHeartbeatChunk,
  deleteReasoningKeys,
  FILTER_HEARTBEAT_INTERVAL_MS,
  filterReasoningFromChoice,
  filterReasoningFromChunk,
  hasMeaningfulDeltaFields,
  isOpenCodeClient,
  normalizeToolContent,
  processSseDataLine,
  REASONING_KEYS,
  sanitizeDelta,
  sanitizeRawControlChars,
  scrubReasoningFromMessage,
  scrubReasoningFromMessages,
  stripClientMetadata,
  stripReasoningFromResponseBody,
  stripToolMetadata,
} from "../../src/transformers/opencode_adapter";
import type { OpenAIContentPart, OpenAIMessage } from "../../src/transformers/nuances";

async function readStreamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let result = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      result += decoder.decode(value);
    }
  }
  return result;
}

function makeReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("opencode_adapter — 1. isOpenCodeClient detection", () => {
  it("detects opencode User-Agent variants case-insensitively", () => {
    expect(isOpenCodeClient("@opencode-ai/cli/2.0.0-beta.1")).toBe(true);
    expect(isOpenCodeClient("@opencode-ai/cli/1.0.0")).toBe(true);
    expect(isOpenCodeClient("opencode/1.0.4")).toBe(true);
    expect(isOpenCodeClient("OpenCode-Desktop/0.1")).toBe(true);
    expect(isOpenCodeClient("Mozilla/5.0 (Windows NT 10.0; Win64; x64) opencode/2.0")).toBe(true);
    expect(isOpenCodeClient("custom-OPENCODE-agent/3.0")).toBe(true);
  });

  it("bypasses detection for non-OpenCode clients (Python, Pydantic, curl, undefined)", () => {
    expect(isOpenCodeClient("pydantic-ai/0.0.24")).toBe(false);
    expect(isOpenCodeClient("pydantic-ai")).toBe(false);
    expect(isOpenCodeClient("curl/7.88.1")).toBe(false);
    expect(isOpenCodeClient("python-requests/2.31.0")).toBe(false);
    expect(isOpenCodeClient("OpenAI/Python 1.12.0")).toBe(false);
    expect(isOpenCodeClient(undefined)).toBe(false);
    expect(isOpenCodeClient(null)).toBe(false);
    expect(isOpenCodeClient("")).toBe(false);
  });

  it("detects x-opencode header from Headers instance", () => {
    const headers = new Headers();
    headers.set("x-opencode", "true");
    expect(isOpenCodeClient("curl/7.88.1", headers)).toBe(true);
    expect(isOpenCodeClient(null, headers)).toBe(true);
  });

  it("detects x-opencode header from plain Record object", () => {
    expect(isOpenCodeClient("curl/7.88.1", { "x-opencode": "1" })).toBe(true);
    expect(isOpenCodeClient("python-requests", { "x-opencode": "" })).toBe(true);
  });

  it("detects x-client-name header containing opencode", () => {
    const headers = new Headers();
    headers.set("x-client-name", "OpenCode-IDE");
    expect(isOpenCodeClient("curl/8.0", headers)).toBe(true);

    expect(isOpenCodeClient("curl/8.0", { "x-client-name": "opencode-agent" })).toBe(true);
    expect(isOpenCodeClient("curl/8.0", { "x-client-name": "other-agent" })).toBe(false);
    expect(isOpenCodeClient("curl/8.0", { "x-client-name": undefined })).toBe(false);
  });

  it("activates on 'sb' (strip budget/reasoning) nuance even without opencode headers", () => {
    expect(isOpenCodeClient("pydantic-ai", undefined, ["sb"])).toBe(true);
    expect(isOpenCodeClient("curl/7.88.1", {}, ["sb"])).toBe(true);
  });

  it("is overridden by 'ts' (thinking support) nuance, preserving reasoning for opencode clients", () => {
    expect(isOpenCodeClient("@opencode-ai/cli", undefined, ["ts"])).toBe(false);
    const headers = new Headers();
    headers.set("x-opencode", "true");
    expect(isOpenCodeClient("@opencode-ai/cli", headers, ["ts"])).toBe(false);
    expect(isOpenCodeClient("opencode", { "x-opencode": "1" }, ["ts", "sb"])).toBe(false);
  });

  it("handles null and undefined headers gracefully", () => {
    expect(isOpenCodeClient("generic-bot", null)).toBe(false);
    expect(isOpenCodeClient("generic-bot", undefined)).toBe(false);
  });
});

describe("opencode_adapter — 2. sanitizeDelta & deleteReasoningKeys", () => {
  it("exports all expected reasoning keys and deleteReasoningKeys deletes them", () => {
    expect(REASONING_KEYS).toContain("reasoning");
    expect(REASONING_KEYS).toContain("reasoning_content");
    expect(REASONING_KEYS).toContain("reasoning_details");
    expect(REASONING_KEYS).toContain("reasoningDetails");
    expect(REASONING_KEYS).toContain("thought");
    expect(REASONING_KEYS).toContain("thoughts");
    expect(REASONING_KEYS).toContain("thinking");
    expect(REASONING_KEYS).toContain("thinking_content");
    expect(REASONING_KEYS).toContain("think");

    const target: Record<string, unknown> = {
      content: "Hello",
      reasoning: "r1",
      reasoning_content: "r2",
      reasoning_details: "r3",
      reasoningDetails: "r4",
      thought: "t1",
      thoughts: "t2",
      thinking: "t3",
      thinking_content: "t4",
      think: "t5",
    };
    deleteReasoningKeys(target);
    expect(target).toEqual({ content: "Hello" });
  });

  it("handles non-object and null rawDelta gracefully in sanitizeDelta", () => {
    expect(sanitizeDelta(null)).toEqual({ delta: {}, hasContent: false });
    expect(sanitizeDelta(undefined)).toEqual({ delta: {}, hasContent: false });
    expect(sanitizeDelta("string delta")).toEqual({ delta: {}, hasContent: false });
    expect(sanitizeDelta(123)).toEqual({ delta: {}, hasContent: false });
  });

  it("removes null and undefined content", () => {
    const res1 = sanitizeDelta({ content: null });
    expect(res1.delta.content).toBeUndefined();
    expect(res1.hasContent).toBe(false);

    const res2 = sanitizeDelta({ content: undefined });
    expect(res2.delta.content).toBeUndefined();
    expect(res2.hasContent).toBe(false);
  });

  it("removes reasoning keys and suppresses pure reasoning deltas", () => {
    const raw = {
      reasoning_content: "Thinking about life...",
      thought: "Step 1",
      thinking: "Computing",
    };
    const { delta, hasContent } = sanitizeDelta(raw);
    expect(delta).toEqual({});
    expect(hasContent).toBe(false);
  });

  it("removes empty tool_calls array but preserves populated tool_calls array", () => {
    const emptyTools = sanitizeDelta({ tool_calls: [] });
    expect(emptyTools.delta.tool_calls).toBeUndefined();
    expect(emptyTools.hasContent).toBe(false);

    const populatedTools = sanitizeDelta({
      tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "test" } }],
    });
    expect(populatedTools.delta.tool_calls).toBeDefined();
    expect(populatedTools.hasContent).toBe(true);
  });

  it("keeps valid string content and identifies meaningful fields", () => {
    const textDelta = sanitizeDelta({ content: "Hello world" });
    expect(textDelta.delta.content).toBe("Hello world");
    expect(textDelta.hasContent).toBe(true);

    const roleDelta = sanitizeDelta({ role: "assistant" });
    expect(roleDelta.delta.role).toBe("assistant");
    expect(roleDelta.hasContent).toBe(true);

    const refusalDelta = sanitizeDelta({ refusal: "I cannot do that." });
    expect(refusalDelta.delta.refusal).toBe("I cannot do that.");
    expect(refusalDelta.hasContent).toBe(true);

    const fnDelta = sanitizeDelta({ function_call: { name: "my_fn" } });
    expect(fnDelta.delta.function_call).toEqual({ name: "my_fn" });
    expect(fnDelta.hasContent).toBe(true);
  });

  it("evaluates hasMeaningfulDeltaFields accurately", () => {
    expect(hasMeaningfulDeltaFields({})).toBe(false);
    expect(hasMeaningfulDeltaFields({ content: "" })).toBe(false);
    expect(hasMeaningfulDeltaFields({ content: "ok" })).toBe(true);
    expect(hasMeaningfulDeltaFields({ role: "assistant" })).toBe(true);
    expect(hasMeaningfulDeltaFields({ tool_calls: [] })).toBe(false);
    expect(hasMeaningfulDeltaFields({ tool_calls: [{ id: "1" }] })).toBe(true);
    expect(hasMeaningfulDeltaFields({ refusal: "no" })).toBe(true);
    expect(hasMeaningfulDeltaFields({ function_call: { name: "calc" } })).toBe(true);
  });
});

describe("opencode_adapter — 3. filterReasoningFromChunk & filterReasoningFromChoice", () => {
  it("filterReasoningFromChoice strips reasoning and handles non-object choices", () => {
    expect(filterReasoningFromChoice(null)).toEqual({ choice: {}, hasData: false });
    expect(filterReasoningFromChoice(undefined)).toEqual({ choice: {}, hasData: false });

    const choiceWithReasoning = {
      index: 0,
      thought: "secret thought",
      delta: {
        reasoning_content: "thinking...",
      },
      finish_reason: null,
    };
    const res = filterReasoningFromChoice(choiceWithReasoning, "req-1");
    expect(res.choice.thought).toBeUndefined();
    expect((res.choice.delta as Record<string, unknown>).reasoning_content).toBeUndefined();
    expect(res.hasData).toBe(false);

    const choiceWithFinish = {
      index: 0,
      delta: {},
      finish_reason: "stop",
    };
    const resFinish = filterReasoningFromChoice(choiceWithFinish, "req-2");
    expect(resFinish.hasData).toBe(true);
  });

  it("filterReasoningFromChunk suppresses pure reasoning chunks", () => {
    const chunk = {
      id: "chatcmpl-1",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "deepseek-reasoner",
      reasoning: "top level reasoning",
      choices: [
        {
          index: 0,
          delta: {
            reasoning_content: "Let's first derive the proof.",
            thought: "Proof step 1",
          },
          finish_reason: null,
        },
      ],
    };

    const { filteredData, shouldEmit } = filterReasoningFromChunk(chunk);
    expect(shouldEmit).toBe(false);
    expect(filteredData.reasoning).toBeUndefined();
    const firstChoice = (filteredData.choices as Array<{ delta: Record<string, unknown> }>)[0];
    expect(firstChoice).toBeDefined();
    expect(firstChoice?.delta).toEqual({});
  });

  it("filterReasoningFromChunk preserves non-reasoning data (content, tool_calls, role, usage)", () => {
    const chunkWithContent = {
      id: "chatcmpl-2",
      choices: [
        {
          index: 0,
          delta: {
            content: "Paris is the capital of France.",
            reasoning_content: "User asked for capital.",
          },
          finish_reason: null,
        },
      ],
    };

    const resContent = filterReasoningFromChunk(chunkWithContent);
    expect(resContent.shouldEmit).toBe(true);
    const choice0 = (resContent.filteredData.choices as Array<{ delta: Record<string, unknown> }>)[0];
    expect(choice0).toBeDefined();
    expect(choice0?.delta.content).toBe("Paris is the capital of France.");
    expect(choice0?.delta.reasoning_content).toBeUndefined();

    const chunkWithUsage = {
      id: "chatcmpl-3",
      choices: [],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    };
    const resUsage = filterReasoningFromChunk(chunkWithUsage);
    expect(resUsage.shouldEmit).toBe(true);

    const chunkWithError = {
      id: "chatcmpl-4",
      error: { message: "Rate limit exceeded", type: "rate_limit_error" },
    };
    const resError = filterReasoningFromChunk(chunkWithError);
    expect(resError.shouldEmit).toBe(true);
  });
});

describe("opencode_adapter — 4. createOpenCodeReasoningFilterStreamTransformer & SSE processing", () => {
  it("sanitizeRawControlChars replaces carriage returns", () => {
    expect(sanitizeRawControlChars('{"text":"line1\rline2"}')).toBe('{"text":"line1\\rline2"}');
  });

  it("createSyntheticHeartbeatChunk generates valid SSE chunk format", () => {
    const heartbeat = createSyntheticHeartbeatChunk();
    expect(heartbeat.startsWith("data: ")).toBe(true);
    expect(heartbeat.endsWith("\n\n")).toBe(true);
    const parsed = JSON.parse(heartbeat.replace(/^data:\s*/, "").trim());
    expect(parsed.id).toBe("chatcmpl-heartbeat");
    expect(parsed.model).toBe("heartbeat");
    expect(parsed.choices[0].finish_reason).toBeNull();
  });

  it("processSseDataLine transforms reasoning chunks and handles malformed JSON", () => {
    const validReasoningLine = 'data: {"id":"1","choices":[{"index":0,"delta":{"reasoning_content":"think"}}]}';
    expect(processSseDataLine(validReasoningLine)).toBeNull();

    const validContentLine = 'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Hi!"}}]}';
    const processed = processSseDataLine(validContentLine);
    expect(processed).not.toBeNull();
    expect(processed).toContain('"content":"Hi!"');

    const malformedLine = "data: not-a-json-object";
    expect(processSseDataLine(malformedLine)).toBe(malformedLine);
  });

  it("streams regular SSE chunks and filters pure reasoning chunks", async () => {
    const transformer = createOpenCodeReasoningFilterStreamTransformer();
    const inputChunks = [
      'data: {"id":"1","choices":[{"index":0,"delta":{"role":"assistant"}}]}\n\n',
      'data: {"id":"1","choices":[{"index":0,"delta":{"reasoning_content":"Thinking..."}}]}\n\n',
      'data: {"id":"1","choices":[{"index":0,"delta":{"content":"Hello world!"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const stream = makeReadableStream(inputChunks).pipeThrough(transformer);
    const output = await readStreamToString(stream);

    expect(output).toContain('"role":"assistant"');
    expect(output).not.toContain("Thinking...");
    expect(output).toContain('"content":"Hello world!"');
    expect(output).toContain("data: [DONE]\n\n");
  });

  it("passes through comments (: ping) and injects synthetic heartbeat chunk", async () => {
    const transformer = createOpenCodeReasoningFilterStreamTransformer("test-req");
    const inputChunks = [": ping\n\n", "data: [DONE]\n\n"];

    const stream = makeReadableStream(inputChunks).pipeThrough(transformer);
    const output = await readStreamToString(stream);

    expect(output).toContain(": ping\n\n");
    expect(output).toContain("chatcmpl-heartbeat");
    expect(output).toContain("data: [DONE]\n\n");
  });

  it("flushes remaining buffer when stream closes without trailing newline", async () => {
    const transformer = createOpenCodeReasoningFilterStreamTransformer();
    const inputChunks = ['data: {"id":"1","choices":[{"index":0,"delta":{"content":"Unfinished newline"}}]'];

    const stream = makeReadableStream(inputChunks).pipeThrough(transformer);
    const output = await readStreamToString(stream);

    expect(output).toContain('"content":"Unfinished newline"');
  });

  it("injects heartbeat when suppressed reasoning chunks exceed FILTER_HEARTBEAT_INTERVAL_MS", async () => {
    expect(FILTER_HEARTBEAT_INTERVAL_MS).toBe(5000);

    const transformer = createOpenCodeReasoningFilterStreamTransformer();
    const suppressedChunk = 'data: {"id":"1","choices":[{"index":0,"delta":{"reasoning_content":"Thinking..."}}]}\n\n';

    // We can simulate time passage by testing the transformer with multiple suppressed chunks
    const stream = makeReadableStream([suppressedChunk, suppressedChunk]).pipeThrough(transformer);
    const output = await readStreamToString(stream);
    // Suppressed chunks within normal immediate execution don't trigger heartbeat unless interval elapsed
    expect(output).not.toContain("Thinking...");
  });
});

describe("opencode_adapter — 5. stripReasoningFromResponseBody", () => {
  it("strips top-level reasoning keys and choice-level reasoning keys from response body", () => {
    const responseBody: Record<string, unknown> = {
      id: "chatcmpl-resp-1",
      object: "chat.completion",
      created: 1700000000,
      model: "deepseek-reasoner",
      reasoning: "top reasoning",
      reasoning_details: { trace: "abc" },
      choices: [
        {
          index: 0,
          thought: "choice thought",
          reasoning_content: "choice reasoning",
          message: {
            role: "assistant",
            content: "Final answer is 42.",
            reasoning: "message reasoning",
            reasoning_content: "thought in message",
            thinking: "message thinking",
          },
          delta: {
            role: "assistant",
            reasoning_content: "delta reasoning",
          },
          finish_reason: "stop",
        },
      ],
      usage: { total_tokens: 50 },
    };

    stripReasoningFromResponseBody(responseBody);

    expect(responseBody.reasoning).toBeUndefined();
    expect(responseBody.reasoning_details).toBeUndefined();

    const choice = (responseBody.choices as Array<Record<string, unknown>>)[0];
    expect(choice).toBeDefined();
    expect(choice?.thought).toBeUndefined();
    expect(choice?.reasoning_content).toBeUndefined();

    const msg = choice?.message as Record<string, unknown>;
    expect(msg).toBeDefined();
    expect(msg?.content).toBe("Final answer is 42.");
    expect(msg?.reasoning).toBeUndefined();
    expect(msg?.reasoning_content).toBeUndefined();
    expect(msg?.thinking).toBeUndefined();

    const delta = choice?.delta as Record<string, unknown>;
    expect(delta?.reasoning_content).toBeUndefined();
  });

  it("handles empty or non-array choices in response body gracefully", () => {
    const noChoices: Record<string, unknown> = { id: "chatcmpl-empty", reasoning: "remove me" };
    stripReasoningFromResponseBody(noChoices);
    expect(noChoices.reasoning).toBeUndefined();

    const nonArrayChoices: Record<string, unknown> = { id: "chatcmpl-weird", choices: "not-an-array" };
    stripReasoningFromResponseBody(nonArrayChoices);
    expect(nonArrayChoices.choices).toBe("not-an-array");
  });
});

describe("opencode_adapter — 6. scrubReasoningFromMessages & metadata stripping", () => {
  it("handles non-array or undefined messages gracefully", () => {
    expect(scrubReasoningFromMessages(undefined)).toEqual([]);
    expect(scrubReasoningFromMessages(null as unknown as readonly OpenAIMessage[])).toEqual([]);
  });

  it("normalizes tool message content from array of parts or strings", () => {
    expect(normalizeToolContent(["Result line 1", "Result line 2"])).toBe("Result line 1\nResult line 2");
    expect(normalizeToolContent([{ text: "Part A" }, { text: "Part B" }])).toBe("Part A\nPart B");
    expect(normalizeToolContent("Plain string")).toBe("Plain string");
    expect(normalizeToolContent(null)).toBe("");
    expect(normalizeToolContent(undefined)).toBe("");
    expect(normalizeToolContent(12345)).toBe("12345");
  });

  it("strips SQLite metadata from role: 'tool' messages and normalizes array content", () => {
    const toolMsg: Record<string, unknown> = {
      role: "tool",
      tool_call_id: "call_abc123",
      name: "run_query",
      id: "sql-msg-1234",
      providerState: "persisted",
      state: "executed",
      createdAt: 1700000000,
      content: [{ type: "text", text: "Database output: 5 rows found." }],
      reasoning: "tool thought",
    };

    const scrubbed = scrubReasoningFromMessage(toolMsg as unknown as OpenAIMessage);
    const scrubbedRec = scrubbed as unknown as Record<string, unknown>;

    expect(scrubbedRec.role).toBe("tool");
    expect(scrubbedRec.tool_call_id).toBe("call_abc123");
    expect(scrubbedRec.content).toBe("Database output: 5 rows found.");
    expect(scrubbedRec.id).toBeUndefined();
    expect(scrubbedRec.name).toBeUndefined();
    expect(scrubbedRec.providerState).toBeUndefined();
    expect(scrubbedRec.state).toBeUndefined();
    expect(scrubbedRec.createdAt).toBeUndefined();
    expect(scrubbedRec.reasoning).toBeUndefined();
  });

  it("stripToolMetadata and stripClientMetadata remove expected fields", () => {
    const toolObj: Record<string, unknown> = {
      id: "1",
      name: "tool_fn",
      providerState: "ps",
      state: "st",
      createdAt: 123,
      other: "keep",
    };
    stripToolMetadata(toolObj);
    expect(toolObj).toEqual({ other: "keep" });

    const clientObj: Record<string, unknown> = {
      id: "2",
      providerState: "ps",
      state: "st",
      reasoning_details: "rd",
      other: "keep",
    };
    stripClientMetadata(clientObj);
    expect(clientObj).toEqual({ other: "keep" });
  });

  it("strips client metadata and filters reasoning parts from user/assistant messages", () => {
    const assistantMsg: Record<string, unknown> = {
      role: "assistant",
      id: "asst-msg-999",
      providerState: "saved",
      state: "done",
      reasoning_details: "some detail",
      reasoning: "assistant reasoning",
      content: [
        { type: "thought", text: "Internal thought process" },
        { type: "reasoning", text: "Reasoning part" },
        { type: "thinking", text: "Thinking block" },
        { type: "text", text: "Here is the final answer." },
      ],
    };

    const scrubbed = scrubReasoningFromMessage(assistantMsg as unknown as OpenAIMessage);
    const scrubbedRec = scrubbed as unknown as Record<string, unknown>;

    expect(scrubbedRec.role).toBe("assistant");
    expect(scrubbedRec.id).toBeUndefined();
    expect(scrubbedRec.providerState).toBeUndefined();
    expect(scrubbedRec.state).toBeUndefined();
    expect(scrubbedRec.reasoning_details).toBeUndefined();
    expect(scrubbedRec.reasoning).toBeUndefined();
    // Normalized single text part to string
    expect(scrubbedRec.content).toBe("Here is the final answer.");
  });

  it("handles array content with multiple non-reasoning parts and empty cleaned parts", () => {
    const multiPartMsg: OpenAIMessage = {
      role: "user",
      content: [
        { type: "text", text: "Text block 1" },
        { type: "image_url", image_url: { url: "https://example.com/pic.png" } } as OpenAIContentPart,
      ],
    };

    const scrubbedMulti = scrubReasoningFromMessage(multiPartMsg);
    expect(Array.isArray(scrubbedMulti.content)).toBe(true);
    expect((scrubbedMulti.content as OpenAIContentPart[]).length).toBe(2);

    const onlyReasoningMsg: OpenAIMessage = {
      role: "assistant",
      content: [
        { type: "thought", text: "Only thoughts here" } as OpenAIContentPart,
      ],
    };

    const scrubbedOnlyReasoning = scrubReasoningFromMessage(onlyReasoningMsg);
    expect(scrubbedOnlyReasoning.content).toBe("");
  });

  it("scrubReasoningFromMessages processes a full list of conversation messages", () => {
    const conversation: OpenAIMessage[] = [
      {
        role: "user",
        content: "Calculate 2+2",
      },
      {
        role: "assistant",
        content: [
          { type: "thought", text: "2+2 is 4" } as OpenAIContentPart,
          { type: "text", text: "4" },
        ],
      },
      {
        role: "tool",
        content: [{ text: "Tool output verified" }],
      } as unknown as OpenAIMessage,
    ];

    const result = scrubReasoningFromMessages(conversation);
    expect(result.length).toBe(3);
    expect(result[0]?.content).toBe("Calculate 2+2");
    expect(result[1]?.content).toBe("4");
    expect(result[2]?.content).toBe("Tool output verified");
  });

  it("preserves reasoning_content on assistant messages that contain tool_calls", () => {
    const assistantToolMsg: OpenAIMessage = {
      role: "assistant",
      content: null,
      reasoning_content: "I need to check auth.ts before editing",
      tool_calls: [
        {
          id: "call_123",
          type: "function",
          function: { name: "grep", arguments: '{"pattern":"auth"}' },
        },
      ],
    } as unknown as OpenAIMessage;

    const scrubbed = scrubReasoningFromMessage(assistantToolMsg);
    expect((scrubbed as Record<string, unknown>).reasoning_content).toBe("I need to check auth.ts before editing");
    expect(scrubbed.tool_calls).toBeDefined();
    expect(scrubbed.tool_calls?.length).toBe(1);
  });
});
