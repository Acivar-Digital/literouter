import { describe, test, expect } from "bun:test";
import { OpenAIChatTransformer } from "../../src/transformers/openai_chat";
import { RequestTelemetry } from "../../src/telemetry/session";
import { parseDirective } from "../../src/directive/parser";

describe("Phase 6: Direct SSE Chunk Streaming & Fast-Path Bypass", () => {
  test("direct stream passes mid-stream content chunks without alteration while marking TTFT and usage", async () => {
    const transformer = new OpenAIChatTransformer();
    const telemetry = new RequestTelemetry({
      reqId: "req-fastpath-1",
      targetProvider: "openrouter",
      model: "gpt-4o",
      method: "POST",
      path: "/v1/chat/completions",
      clientAgent: "test-runner",
    });

    const directive = parseDirective("lr-or-oa-ch-no")!;

    const abortController = new AbortController();
    const streamTransformer = transformer.createWireToClientStream(
      directive,
      telemetry,
      abortController.signal
    );
    expect(streamTransformer).not.toBeNull();

    const textEncoder = new TextEncoder();
    const textDecoder = new TextDecoder();

    // Stream lines:
    // 1. First chunk with content -> triggers TTFT
    // 2. Mid-stream content chunk -> should hit fast-path bypass
    // 3. Finish chunk with usage -> triggers finish_reason & usage
    // 4. [DONE]
    const sseLines = [
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":"Hello"}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{"content":" world!"}}]}\n\n',
      'data: {"id":"chatcmpl-1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}}\n\n',
      "data: [DONE]\n\n",
    ];

    const inputStream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const line of sseLines) {
          controller.enqueue(textEncoder.encode(line));
        }
        controller.close();
      },
    });

    const outputStream = inputStream.pipeThrough(streamTransformer!);
    const reader = outputStream.getReader();

    let outputText = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      outputText += textDecoder.decode(value, { stream: true });
    }

    // Verify all chunks were emitted
    expect(outputText).toContain("Hello");
    expect(outputText).toContain(" world!");
    expect(outputText).toContain("finish_reason");
    expect(outputText).toContain("[DONE]");

    // Verify telemetry
    const metrics = telemetry.toTraceMetrics();
    expect(metrics.ttftMs).toBeGreaterThanOrEqual(0);
    expect(metrics.promptTokens).toBe(10);
    expect(metrics.completionTokens).toBe(2);
  });
});
