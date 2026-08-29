import { describe, expect, it } from "bun:test";
import {
  parseLingXml,
  createLingStreamTransformer,
  stripLingLeakedTemplateTags,
} from "../../src/transformers/ling";

describe("Ling Transformer & Streaming Suite", () => {
  it("strips control tokens like [gMASK] and <role>", () => {
    const raw = "[gMASK]<|startoftext|><role>assistant</role>Hello World<|role_end|>";
    expect(stripLingLeakedTemplateTags(raw)).toBe("Hello World");
  });

  it("streams thinking to reasoning_content and tool call to tool_calls delta", async () => {
    const transformer = createLingStreamTransformer();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const inputChunks = [
      'data: {"choices":[{"delta":{"content":"[gMASK]<|startoftext|><role>assistant</role>\\n<think>Inspecting codebase"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" for test files.</think>\\n"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"<tool_call>bash\\n<arg_key>command</arg_key>\\n"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"<arg_value>ls -la</arg_value>\\n</tool_call>"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of inputChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = stream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    let accumulatedOutput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulatedOutput += decoder.decode(value);
    }

    // Verify [gMASK] and <role> are never leaked
    expect(accumulatedOutput).not.toContain("[gMASK]");
    expect(accumulatedOutput).not.toContain("<role>");
    expect(accumulatedOutput).not.toContain("<think>");
    expect(accumulatedOutput).not.toContain("<tool_call>");

    // Verify reasoning_content delta was emitted
    expect(accumulatedOutput).toContain('"reasoning_content"');
    expect(accumulatedOutput).toContain("Inspecting codebase");

    // Verify tool_calls delta was emitted with correct JSON
    expect(accumulatedOutput).toContain('"tool_calls"');
    expect(accumulatedOutput).toContain('"name":"bash"');
    expect(accumulatedOutput).toContain('{\\"command\\":\\"ls -la\\"}');
  });

  it("streams plain text untouched without tag corruption", async () => {
    const transformer = createLingStreamTransformer();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const inputChunks = [
      'data: {"choices":[{"delta":{"content":"Here is the strategy: 1 < 2 and 3 > 2."}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" Done!"}}]}\n\n',
      "data: [DONE]\n\n",
    ];

    const stream = new ReadableStream({
      start(controller) {
        for (const chunk of inputChunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    });

    const transformedStream = stream.pipeThrough(transformer);
    const reader = transformedStream.getReader();
    let accumulatedOutput = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      accumulatedOutput += decoder.decode(value);
    }

    expect(accumulatedOutput).toContain("Here is the strategy: 1 < 2 and 3 > 2.");
    expect(accumulatedOutput).toContain("Done!");
  });
});
