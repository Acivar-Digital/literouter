import { describe, expect, it } from "bun:test";
import { parseDirective, isDirectDirective } from "../../../src/directive/parser";
import { NuanceCodeSchema } from "../../../src/config/schema";
import {
  applyDeepSeekConstraints,
  isOpenCodeClient,
} from "../../../src/transformers/opencode_adapter";
import {
  transformMessages,
  sanitizeAndTransformPayload,
} from "../../../src/transformers/payload";
import { OpenAIChatTransformer } from "../../../src/transformers/openai_chat";
import { serializeDotsToolHistory } from "../../../src/transformers/dots";
import { RequestTelemetry } from "../../../src/telemetry/session";
import type { OpenAIMessage, OpenAIRequestPayload } from "../../../src/transformers/nuances";

describe("DeepSeek Nuance (ds) — Directive & Schema Validation", () => {
  it("validates ds in NuanceCodeSchema", () => {
    expect(NuanceCodeSchema.parse("ds")).toBe("ds");
  });

  it("parses direct directive with ds nuance", () => {
    const parsed = parseDirective("lr-zn-oa-ch-ds");
    expect(parsed).not.toBeNull();
    expect(isDirectDirective(parsed!)).toBe(true);
    expect(parsed!.type).toBe("direct");
    if (parsed!.type === "direct") {
      expect(parsed!.provider).toBe("zn");
      expect(parsed!.payload).toBe("oa");
      expect(parsed!.completion).toBe("ch");
      expect(parsed!.nuances).toEqual(["ds"]);
    }
  });

  it("parses compound directives containing ds", () => {
    const parsed = parseDirective("lr-zn-oa-ch-dp+ds");
    expect(parsed).not.toBeNull();
    if (parsed!.type === "direct") {
      expect(parsed!.nuances).toEqual(["dp", "ds"]);
    }
  });

  it("disables OpenCode aggressive client scrubbing when ds is active", () => {
    expect(isOpenCodeClient("opencode/2.0.22", null, ["ds"])).toBe(false);
    expect(isOpenCodeClient("opencode/2.0.22", null, ["no"])).toBe(true);
  });
});

describe("DeepSeek Nuance (ds) — Message Transformation & Auto-Healing", () => {
  it("auto-heals assistant message with tool_calls missing reasoning_content", () => {
    const inputMessages: OpenAIMessage[] = [
      { role: "user", content: "List files" },
      {
        role: "assistant",
        content: "Running tool",
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: { name: "ls", arguments: "{}" },
          },
        ],
      } as unknown as OpenAIMessage,
      { role: "tool", content: "file1.txt" } as unknown as OpenAIMessage,
    ];

    const healed = applyDeepSeekConstraints(inputMessages);
    expect(healed.length).toBe(3);
    const assistantMsg = healed[1] as Record<string, unknown>;
    expect(assistantMsg.reasoning_content).toBe("");
  });

  it("preserves existing reasoning_content on assistant tool calls", () => {
    const inputMessages: OpenAIMessage[] = [
      { role: "user", content: "List files" },
      {
        role: "assistant",
        content: "Running tool",
        reasoning_content: "I need to inspect the directory contents first.",
        tool_calls: [
          {
            id: "call_123",
            type: "function",
            function: { name: "ls", arguments: "{}" },
          },
        ],
      } as unknown as OpenAIMessage,
    ];

    const healed = applyDeepSeekConstraints(inputMessages);
    const assistantMsg = healed[1] as Record<string, unknown>;
    expect(assistantMsg.reasoning_content).toBe("I need to inspect the directory contents first.");
  });

  it("bypasses scrubReasoningFromMessages in transformMessages when ds is active", () => {
    const inputMessages: OpenAIMessage[] = [
      { role: "user", content: "Hello" },
      {
        role: "assistant",
        content: "Thinking complete.",
        reasoning_content: "Detailed thoughts here.",
      } as unknown as OpenAIMessage,
    ];

    // Under ds nuance: reasoning_content must be preserved
    const withDs = transformMessages(inputMessages, ["ds"]);
    const assistantDs = withDs[1] as Record<string, unknown>;
    expect(assistantDs.reasoning_content).toBe("Detailed thoughts here.");

    // Negative control under no nuance: reasoning_content is scrubbed
    const withNo = transformMessages(inputMessages, ["no"]);
    const assistantNo = withNo[1] as Record<string, unknown>;
    expect(assistantNo.reasoning_content).toBeUndefined();
  });

  it("preserves reasoning_content through full sanitizeAndTransformPayload pipeline with ds", () => {
    const payload: OpenAIRequestPayload = {
      model: "deepseek-v4.1-flash-free",
      messages: [
        { role: "user", content: "Find files" },
        {
          role: "assistant",
          content: "Looking up files",
          tool_calls: [{ id: "call_abc", type: "function", function: { name: "find", arguments: "{}" } }],
        } as unknown as OpenAIMessage,
        { role: "tool", content: "file.txt" } as unknown as OpenAIMessage,
      ],
    } as unknown as OpenAIRequestPayload;

    const transformed = sanitizeAndTransformPayload(payload, {
      nuances: ["ds"],
      enableScrubbing: true,
      targetWire: "oa",
    });

    const assistantMsg = transformed.messages[1] as Record<string, unknown>;
    expect(assistantMsg.reasoning_content).toBe("");
  });

  it("performs message content hygiene while preserving reasoning_content under ds", () => {
    const inputMessages: OpenAIMessage[] = [
      {
        role: "assistant",
        content: "Here is the plan <tool_call>{\"name\":\"test\"}</tool_call>",
        reasoning_content: "My thinking process",
        tool_calls: [{ id: "call_1", type: "function", function: { name: "test", arguments: "{}" } }],
      } as unknown as OpenAIMessage,
      {
        role: "tool",
        content: [{ type: "text", text: "tool output" }],
      } as unknown as OpenAIMessage,
    ];

    const cleaned = applyDeepSeekConstraints(inputMessages);
    const assistantMsg = cleaned[0] as Record<string, unknown>;
    // reasoning_content is preserved
    expect(assistantMsg.reasoning_content).toBe("My thinking process");
    // leaked tool_call tags in content are scrubbed
    expect(assistantMsg.content).toBe("Here is the plan");

    // tool content is normalized to string
    const toolMsg = cleaned[1] as Record<string, unknown>;
    expect(toolMsg.content).toBe("tool output");
  });

  it("preserves reasoning_content through serializeDotsToolHistory when tc is active", () => {
    const inputMessages: OpenAIMessage[] = [
      {
        role: "assistant",
        content: "Calling weather",
        reasoning_content: "Checking Tokyo temperature",
        tool_calls: [{ id: "call_w", type: "function", function: { name: "get_weather", arguments: "{\"city\":\"Tokyo\"}" } }],
      } as unknown as OpenAIMessage,
      {
        role: "tool",
        tool_call_id: "call_w",
        content: "20C Sunny",
      } as unknown as OpenAIMessage,
    ];

    const serialized = serializeDotsToolHistory(inputMessages);
    const assistantMsg = serialized[0] as Record<string, unknown>;
    expect(assistantMsg.role).toBe("assistant");
    expect(assistantMsg.reasoning_content).toBe("Checking Tokyo temperature");
    expect(String(assistantMsg.content)).toContain("<invoke name=\"get_weather\">");
  });
});

describe("DeepSeek Nuance (ds) — OpenAIChatTransformer Wire Integration", () => {
  it("preserves reasoning_content in non-streaming responses when ds is set", () => {
    const transformer = new OpenAIChatTransformer();
    const directive = parseDirective("lr-zn-oa-ch-ds")!;

    const upstreamResponse = {
      id: "chatcmpl-test",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: "42",
            reasoning_content: "21 * 2 = 42",
          },
          finish_reason: "stop",
        },
      ],
    };

    const clientResponse = transformer.transformWireToClient(upstreamResponse, directive) as typeof upstreamResponse;
    expect(clientResponse.choices[0]?.message.reasoning_content).toBe("21 * 2 = 42");

    // Negative control with no nuance: reasoning_content stripped
    const defaultDirective = parseDirective("lr-zn-oa-ch-no")!;
    const scrubbedResponse = transformer.transformWireToClient(upstreamResponse, defaultDirective) as typeof upstreamResponse;
    const scrubbedMsg = scrubbedResponse.choices[0]?.message as Record<string, unknown> | undefined;
    expect(scrubbedMsg?.reasoning_content).toBeUndefined();
  });

  it("streams reasoning_content deltas verbatim when ds is set", async () => {
    const transformer = new OpenAIChatTransformer();
    const directive = parseDirective("lr-zn-oa-ch-ds")!;
    const telemetry = new RequestTelemetry({
      reqId: "req_test_ds",
      method: "POST",
      path: "/v1/chat/completions",
      clientAgent: "test",
    });
    const abortController = new AbortController();
    const stream = transformer.createWireToClientStream(directive, telemetry, abortController.signal);

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    const readPromise = (async () => {
      let output = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value);
      }
      return output;
    })();

    const chunk1 = 'data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","reasoning_content":"Step 1"}}]}\n\n';
    const chunk2 = 'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Answer"}}]}\n\n';
    const chunkDone = 'data: [DONE]\n\n';

    await writer.write(encoder.encode(chunk1));
    await writer.write(encoder.encode(chunk2));
    await writer.write(encoder.encode(chunkDone));
    await writer.close();

    const output = await readPromise;

    expect(output).toContain('"reasoning_content":"Step 1"');
    expect(output).toContain('"content":"Answer"');
  });

  it("scrubs reasoning_content deltas in streaming when ds is not set (negative control)", async () => {
    const transformer = new OpenAIChatTransformer();
    const directive = parseDirective("lr-zn-oa-ch-no")!;
    const telemetry = new RequestTelemetry({
      reqId: "req_test_no",
      method: "POST",
      path: "/v1/chat/completions",
      clientAgent: "test",
    });
    const abortController = new AbortController();
    const stream = transformer.createWireToClientStream(directive, telemetry, abortController.signal);

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const writer = stream.writable.getWriter();
    const reader = stream.readable.getReader();

    const readPromise = (async () => {
      let output = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        output += decoder.decode(value);
      }
      return output;
    })();

    const chunk1 = 'data: {"id":"chatcmpl-1","choices":[{"delta":{"role":"assistant","reasoning_content":"Step 1"}}]}\n\n';
    const chunk2 = 'data: {"id":"chatcmpl-1","choices":[{"delta":{"content":"Answer"}}]}\n\n';
    const chunkDone = 'data: [DONE]\n\n';

    await writer.write(encoder.encode(chunk1));
    await writer.write(encoder.encode(chunk2));
    await writer.write(encoder.encode(chunkDone));
    await writer.close();

    const output = await readPromise;

    expect(output).not.toContain('"reasoning_content":"Step 1"');
    expect(output).toContain('"content":"Answer"');
  });
});
