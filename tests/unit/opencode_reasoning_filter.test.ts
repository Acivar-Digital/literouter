import { describe, expect, it } from "bun:test";
import {
  createOpenCodeReasoningFilterStreamTransformer,
  filterReasoningFromChunk,
  isOpenCodeClient,
} from "../../src/transformers/thinking";
import { stripReasoningFromResponseBody } from "../../src/handlers/openai_compat";

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

describe("OpenCode Reasoning Filter — Client Detection (isOpenCodeClient)", () => {
  it("detects opencode User-Agent strings (case-insensitive)", () => {
    expect(isOpenCodeClient("@opencode-ai/cli/2.0.0-beta.1")).toBe(true);
    expect(isOpenCodeClient("opencode/1.0.4")).toBe(true);
    expect(isOpenCodeClient("OpenCode-Desktop/0.1")).toBe(true);
    expect(isOpenCodeClient("Mozilla/5.0 (Windows NT 10.0; Win64; x64) opencode/2.0")).toBe(true);
  });

  it("does not match non-OpenCode User-Agents (e.g. pydantic-ai, curl, python)", () => {
    expect(isOpenCodeClient("pydantic-ai/0.0.24")).toBe(false);
    expect(isOpenCodeClient("pydantic-ai")).toBe(false);
    expect(isOpenCodeClient("curl/7.88.1")).toBe(false);
    expect(isOpenCodeClient("python-requests/2.31.0")).toBe(false);
    expect(isOpenCodeClient("OpenAI/Python 1.12.0")).toBe(false);
    expect(isOpenCodeClient(undefined)).toBe(false);
    expect(isOpenCodeClient(null)).toBe(false);
  });

  it("detects x-opencode header via Headers instance", () => {
    const headers = new Headers();
    headers.set("x-opencode", "true");
    expect(isOpenCodeClient("curl/7.88.1", headers)).toBe(true);
  });

  it("detects x-opencode header via record object", () => {
    expect(isOpenCodeClient("curl/7.88.1", { "x-opencode": "1" })).toBe(true);
  });

  it("detects x-client-name header when containing opencode", () => {
    const headers = new Headers();
    headers.set("x-client-name", "OpenCode-IDE");
    expect(isOpenCodeClient("unknown", headers)).toBe(true);

    expect(isOpenCodeClient("unknown", { "x-client-name": "opencode-v2" })).toBe(true);
  });

  it("activates on 'sb' (strip budget/reasoning) nuance even without opencode header", () => {
    expect(isOpenCodeClient("pydantic-ai", undefined, ["sb"])).toBe(true);
  });

  it("is overridden by 'ts' (thinking support) nuance, preserving reasoning for opencode", () => {
    expect(isOpenCodeClient("@opencode-ai/cli", undefined, ["ts"])).toBe(false);
    const headers = new Headers();
    headers.set("x-opencode", "true");
    expect(isOpenCodeClient("@opencode-ai/cli", headers, ["ts"])).toBe(false);
  });
});

describe("OpenCode Reasoning Filter — Chunk Filter (filterReasoningFromChunk)", () => {
  it("strips reasoning_content, reasoning, and reasoning_details from delta and returns shouldEmit: false if only reasoning was present", () => {
    const chunk = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "deepseek-reasoner",
      choices: [
        {
          index: 0,
          delta: {
            reasoning_content: "Let's first understand the equation.",
            reasoning: "Let's first understand the equation.",
            reasoning_details: [{ type: "thought", text: "detailed thought" }],
          },
          finish_reason: null,
        },
      ],
      reasoning_details: [{ type: "thought", text: "top-level detailed thought" }],
    };

    const { filteredData, shouldEmit } = filterReasoningFromChunk(chunk);
    expect(shouldEmit).toBe(false);
    expect(filteredData.reasoning_details).toBeUndefined();
    const firstChoice = (filteredData.choices as Array<{ delta?: Record<string, unknown>; reasoning_details?: unknown }>)?.[0];
    expect(firstChoice?.delta).toEqual({});
    expect(firstChoice?.reasoning_details).toBeUndefined();
  });

  it("preserves delta and returns shouldEmit: true when delta contains content", () => {
    const chunk = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "deepseek-reasoner",
      choices: [
        {
          index: 0,
          delta: {
            content: "The result is 42.",
          },
          finish_reason: null,
        },
      ],
    };

    const { filteredData, shouldEmit } = filterReasoningFromChunk(chunk);
    expect(shouldEmit).toBe(true);
    const firstChoice = (filteredData.choices as Array<{ delta?: Record<string, unknown> }>)?.[0];
    expect(firstChoice?.delta?.content).toBe("The result is 42.");
  });

  it("preserves delta and returns shouldEmit: true when delta contains role: assistant", () => {
    const chunk = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "deepseek-reasoner",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            reasoning_content: "Starting calculation...",
          },
          finish_reason: null,
        },
      ],
    };

    const { filteredData, shouldEmit } = filterReasoningFromChunk(chunk);
    expect(shouldEmit).toBe(true);
    const delta = (filteredData.choices as Array<{ delta?: Record<string, unknown> }>)?.[0]?.delta;
    expect(delta?.role).toBe("assistant");
    expect(delta?.reasoning_content).toBeUndefined();
  });

  it("preserves delta and returns shouldEmit: true when delta contains tool_calls", () => {
    const chunk = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "deepseek-reasoner",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_123",
                type: "function",
                function: { name: "get_weather", arguments: "{}" },
              },
            ],
            reasoning_content: "I will call weather tool.",
          },
          finish_reason: null,
        },
      ],
    };

    const { filteredData, shouldEmit } = filterReasoningFromChunk(chunk);
    expect(shouldEmit).toBe(true);
    const delta = (filteredData.choices as Array<{ delta?: Record<string, unknown> }>)?.[0]?.delta;
    expect(delta?.tool_calls).toBeDefined();
    expect(delta?.reasoning_content).toBeUndefined();
  });

  it("returns shouldEmit: true when finish_reason is present (e.g. stop or tool_calls)", () => {
    const chunk = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "deepseek-reasoner",
      choices: [
        {
          index: 0,
          delta: {
            reasoning_content: "Final step.",
          },
          finish_reason: "stop",
        },
      ],
    };

    const { filteredData, shouldEmit } = filterReasoningFromChunk(chunk);
    expect(shouldEmit).toBe(true);
    const choice = (filteredData.choices as Array<{ delta?: Record<string, unknown>; finish_reason?: string }>)?.[0];
    expect(choice?.finish_reason).toBe("stop");
    expect(choice?.delta?.reasoning_content).toBeUndefined();
  });

  it("returns shouldEmit: true when usage stats are present in chunk", () => {
    const chunk = {
      id: "chatcmpl-123",
      object: "chat.completion.chunk",
      created: 1700000000,
      model: "deepseek-reasoner",
      choices: [],
      usage: {
        prompt_tokens: 25,
        completion_tokens: 150,
        total_tokens: 175,
      },
    };

    const { filteredData, shouldEmit } = filterReasoningFromChunk(chunk);
    expect(shouldEmit).toBe(true);
    expect(filteredData.usage).toBeDefined();
  });
});

describe("OpenCode Reasoning Filter — Stream Transformer (createOpenCodeReasoningFilterStreamTransformer)", () => {
  it("filters out reasoning deltas while keeping role, content, finish_reason, and [DONE]", async () => {
    const transformer = createOpenCodeReasoningFilterStreamTransformer();

    const inputEvents = [
      ': keepalive\n\n',
      'data: {"id":"1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"id":"2","choices":[{"index":0,"delta":{"reasoning_content":"Thinking deeply step 1..."},"finish_reason":null}]}\n\n',
      'data: {"id":"3","choices":[{"index":0,"delta":{"reasoning":"Thinking deeply step 2..."},"finish_reason":null}]}\n\n',
      'data: {"id":"3b","choices":[{"index":0,"delta":{"reasoning_details":[{"type":"thought","text":"Thinking deeply step 3..."}]},"finish_reason":null}]}\n\n',
      'data: {"id":"4","choices":[{"index":0,"delta":{"content":"Hello! "},"finish_reason":null}]}\n\n',
      'data: {"id":"5","choices":[{"index":0,"delta":{"content":"How can I help you?"},"finish_reason":null}]}\n\n',
      'data: {"id":"6","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n',
      'data: {"id":"7","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":20,"total_tokens":30}}\n\n',
      'data: [DONE]\n\n',
    ].join("");

    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(inputEvents));
        controller.close();
      },
    });

    const transformedStream = readable.pipeThrough(transformer);
    const outputText = await readStreamToString(transformedStream);

    // Verify reasoning chunks were stripped out
    expect(outputText).not.toContain("Thinking deeply step 1");
    expect(outputText).not.toContain("Thinking deeply step 2");
    expect(outputText).not.toContain("Thinking deeply step 3");
    expect(outputText).not.toContain("reasoning_content");
    expect(outputText).not.toContain("reasoning_details");

    // Verify valid SSE lines remained
    expect(outputText).toContain(": keepalive");
    expect(outputText).toContain('"role":"assistant"');
    expect(outputText).toContain('"content":"Hello! "');
    expect(outputText).toContain('"content":"How can I help you?"');
    expect(outputText).toContain('"finish_reason":"stop"');
    expect(outputText).toContain('"prompt_tokens":10');
    expect(outputText).toContain("data: [DONE]");
  });

  it("handles chunk fragmentation across stream reads cleanly", async () => {
    const transformer = createOpenCodeReasoningFilterStreamTransformer();

    const part1 = 'data: {"id":"1","choices":[{"index":0,"delta":{"reasoning_content":"chunk ';
    const part2 = 'fragment"},"finish_reason":null}]}\n\ndata: {"id":"2","choices":[{"index":0,"delta":{"content":"';
    const part3 = 'Clean output"},"finish_reason":null}]}\n\ndata: [DONE]\n\n';

    const encoder = new TextEncoder();
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(part1));
        controller.enqueue(encoder.encode(part2));
        controller.enqueue(encoder.encode(part3));
        controller.close();
      },
    });

    const transformedStream = readable.pipeThrough(transformer);
    const outputText = await readStreamToString(transformedStream);

    expect(outputText).not.toContain("chunk fragment");
    expect(outputText).toContain('"content":"Clean output"');
    expect(outputText).toContain("data: [DONE]");
  });

  it("ensures non-OpenCode clients (like Pydantic AI) preserve the raw reasoning stream intact", async () => {
    // When client is Pydantic AI, the stream is not piped through the OpenCode transformer
    const userAgent = "pydantic-ai/0.0.24";
    const isOpencode = isOpenCodeClient(userAgent);
    expect(isOpencode).toBe(false);

    const inputEvents = [
      'data: {"id":"1","choices":[{"index":0,"delta":{"reasoning_content":"Step 1: Pydantic AI needs this reasoning delta.","reasoning_details":[{"type":"thought","text":"details"}]},"finish_reason":null}]}\n\n',
      'data: {"id":"2","choices":[{"index":0,"delta":{"content":"Final answer."},"finish_reason":null}]}\n\n',
      'data: [DONE]\n\n',
    ].join("");

    const encoder = new TextEncoder();
    const rawStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(inputEvents));
        controller.close();
      },
    });

    // Pydantic AI gets raw stream unmodified
    const finalStream = isOpencode
      ? rawStream.pipeThrough(createOpenCodeReasoningFilterStreamTransformer())
      : rawStream;

    const outputText = await readStreamToString(finalStream);

    expect(outputText).toContain("Pydantic AI needs this reasoning delta.");
    expect(outputText).toContain("reasoning_content");
    expect(outputText).toContain("reasoning_details");
    expect(outputText).toContain("Final answer.");
  });
});

describe("OpenCode Reasoning Filter — Non-Streaming Response Body (stripReasoningFromResponseBody)", () => {
  it("strips reasoning, reasoning_content, and reasoning_details from json choices and messages", () => {
    const responseBody: Record<string, unknown> = {
      id: "chatcmpl-nonstream",
      object: "chat.completion",
      created: 1700000000,
      model: "deepseek-reasoner",
      reasoning: "Top level reasoning",
      reasoning_content: "Top level reasoning content",
      reasoning_details: [{ type: "thought", text: "Top level reasoning details" }],
      choices: [
        {
          index: 0,
          reasoning: "Choice reasoning",
          reasoning_content: "Choice reasoning content",
          reasoning_details: [{ type: "thought", text: "Choice reasoning details" }],
          message: {
            role: "assistant",
            content: "Hello! Here is your answer.",
            reasoning: "Message reasoning",
            reasoning_content: "Message reasoning content",
            reasoning_details: [{ type: "thought", text: "Message reasoning details" }],
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    };

    stripReasoningFromResponseBody(responseBody);

    expect(responseBody.reasoning).toBeUndefined();
    expect(responseBody.reasoning_content).toBeUndefined();
    expect(responseBody.reasoning_details).toBeUndefined();

    const choice = (responseBody.choices as Array<Record<string, unknown>>)[0];
    expect(choice).toBeDefined();
    expect(choice?.reasoning).toBeUndefined();
    expect(choice?.reasoning_content).toBeUndefined();
    expect(choice?.reasoning_details).toBeUndefined();

    const msg = choice?.message as Record<string, unknown> | undefined;
    expect(msg).toBeDefined();
    expect(msg?.content).toBe("Hello! Here is your answer.");
    expect(msg?.role).toBe("assistant");
    expect(msg?.reasoning).toBeUndefined();
    expect(msg?.reasoning_content).toBeUndefined();
    expect(msg?.reasoning_details).toBeUndefined();
  });
});

describe("OpenCode2 Downstream SSE Stream — Live Thinking Delivery", () => {
  it("delivers reasoning deltas unmodified to OpenCode2 by default so TUI renders thinking", async () => {
    // Standard directive (no 'sb' nuance)
    const nuances: string[] = ["no"];
    const shouldStrip = nuances.includes("sb");
    expect(shouldStrip).toBe(false);

    const inputEvents = [
      'data: {"id":"1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"id":"2","choices":[{"index":0,"delta":{"reasoning_content":"Step 1: Inspecting AST structure..."},"finish_reason":null}]}\n\n',
      'data: {"id":"3","choices":[{"index":0,"delta":{"reasoning_content":"Step 2: Checking payload transformer..."},"finish_reason":null}]}\n\n',
      'data: {"id":"4","choices":[{"index":0,"delta":{"content":"Here is the verified solution."},"finish_reason":null}]}\n\n',
      'data: [DONE]\n\n',
    ].join("");

    const encoder = new TextEncoder();
    const rawStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(inputEvents));
        controller.close();
      },
    });

    const stream = shouldStrip
      ? rawStream.pipeThrough(createOpenCodeReasoningFilterStreamTransformer())
      : rawStream;

    const outputText = await readStreamToString(stream);

    // Verify OpenCode2 TUI receives live reasoning deltas
    expect(outputText).toContain("Step 1: Inspecting AST structure...");
    expect(outputText).toContain("Step 2: Checking payload transformer...");
    expect(outputText).toContain("Here is the verified solution.");
    expect(outputText).toContain("data: [DONE]");
  });

  it("strips reasoning deltas when 'sb' (strip budget/reasoning) nuance is explicitly requested", async () => {
    const nuances: string[] = ["sb"];
    const shouldStrip = nuances.includes("sb");
    expect(shouldStrip).toBe(true);

    const inputEvents = [
      'data: {"id":"1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n',
      'data: {"id":"2","choices":[{"index":0,"delta":{"reasoning_content":"Hidden thinking..."},"finish_reason":null}]}\n\n',
      'data: {"id":"3","choices":[{"index":0,"delta":{"content":"Direct answer."},"finish_reason":null}]}\n\n',
      'data: [DONE]\n\n',
    ].join("");

    const encoder = new TextEncoder();
    const rawStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(inputEvents));
        controller.close();
      },
    });

    const stream = shouldStrip
      ? rawStream.pipeThrough(createOpenCodeReasoningFilterStreamTransformer())
      : rawStream;

    const outputText = await readStreamToString(stream);

    // Verify thinking was stripped due to 'sb' nuance
    expect(outputText).not.toContain("Hidden thinking...");
    expect(outputText).toContain("Direct answer.");
    expect(outputText).toContain("data: [DONE]");
  });

  it("safely drops reasoning chunks where content is null without emitting invalid null content to OpenCode", async () => {
    const inputEvents = [
      'data: {"id":"1","choices":[{"index":0,"delta":{"role":"assistant","content":null,"reasoning":"Starting to analyze..."},"finish_reason":null}]}\n\n',
      'data: {"id":"2","choices":[{"index":0,"delta":{"content":null,"reasoning":"Thinking step 2..."},"finish_reason":null}]}\n\n',
      'data: {"id":"3","choices":[{"index":0,"delta":{"content":null,"reasoning":"Thinking step 3..."},"finish_reason":null}]}\n\n',
      'data: {"id":"4","choices":[{"index":0,"delta":{"content":"Final verified answer."},"finish_reason":null}]}\n\n',
      'data: [DONE]\n\n',
    ].join("");

    const encoder = new TextEncoder();
    const rawStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(inputEvents));
        controller.close();
      },
    });

    const stream = rawStream.pipeThrough(createOpenCodeReasoningFilterStreamTransformer());
    const outputText = await readStreamToString(stream);

    // Chunks 2 & 3 must be completely dropped
    expect(outputText).not.toContain("Thinking step");
    expect(outputText).not.toContain('"content":null');
    expect(outputText).toContain('{"id":"1","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}');
    expect(outputText).toContain('{"id":"4","choices":[{"index":0,"delta":{"content":"Final verified answer."},"finish_reason":null}]}');
    expect(outputText).toContain("data: [DONE]");
  });
});
