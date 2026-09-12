import { describe, expect, it, spyOn } from "bun:test";
import type { ParsedDirective } from "../../../src/directive/types";
import {
  GoogleNativeTransformer,
  googleNativeTransformer,
  isContentChunk,
  parseFinishReason,
  parseUsageMetadata,
  resolveEndpointKey,
  resolveIsStreaming,
} from "../../../src/transformers/google_native";
import {
  GoogleNativeTransformer as ReexportedGoogleNativeTransformer,
  googleNativeTransformer as reexportedGoogleNativeTransformer,
} from "../../../src/handlers/google_native";
import { RequestTelemetry, type TelemetryInit } from "../../../src/telemetry/session";

function createMockTelemetry(reqId = "req-test-google-native"): RequestTelemetry {
  const init: TelemetryInit = {
    reqId,
    method: "POST",
    path: "/v1beta/models/gemini-2.5-flash:streamGenerateContent",
    clientAgent: "test-agent",
    directiveStr: "lr-gg-gg-gc-no",
    targetProvider: "gg",
    wireFormat: "gg",
    endpoint: "gc",
    model: "gemini-2.5-flash",
  };
  return new RequestTelemetry(init);
}

async function pipeAndCollect(
  transformStream: TransformStream<Uint8Array, Uint8Array>,
  feedWriter: (writer: WritableStreamDefaultWriter<Uint8Array>) => Promise<void>
): Promise<Uint8Array[]> {
  const reader = transformStream.readable.getReader();
  const writer = transformStream.writable.getWriter();

  const readPromise = (async () => {
    const chunks: Uint8Array[] = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return chunks;
  })();

  await feedWriter(writer);
  await writer.close();
  return await readPromise;
}

const directGcDirective: ParsedDirective = {
  type: "direct",
  raw: "lr-gg-gg-gc-no",
  provider: "gg",
  payload: "gg",
  completion: "gc",
  nuances: ["no"],
};

const directChDirective: ParsedDirective = {
  type: "direct",
  raw: "lr-gg-oa-ch-no",
  provider: "gg",
  payload: "oa",
  completion: "ch",
  nuances: ["no"],
};

const fusionDirective: ParsedDirective = {
  type: "fusion",
  raw: "lr-fse-quad",
  preset: "quad",
};

describe("GoogleNativeTransformer", () => {
  describe("Exports and Singleton", () => {
    it("exports a singleton instance of GoogleNativeTransformer", () => {
      expect(googleNativeTransformer).toBeInstanceOf(GoogleNativeTransformer);
      expect(reexportedGoogleNativeTransformer).toBe(googleNativeTransformer);
      expect(ReexportedGoogleNativeTransformer).toBe(GoogleNativeTransformer);
    });
  });

  describe("Helper Functions", () => {
    it("resolves endpoint key based on directive completion", () => {
      expect(resolveEndpointKey(directGcDirective)).toBe("gc");
      expect(resolveEndpointKey(directChDirective)).toBe("ch");
      expect(resolveEndpointKey(fusionDirective)).toBe("gc");
    });

    it("resolves isStreaming accurately", () => {
      expect(resolveIsStreaming({}, directGcDirective)).toBe(true);
      expect(resolveIsStreaming({ stream: true }, directChDirective)).toBe(true);
      expect(resolveIsStreaming({ stream: false }, directChDirective)).toBe(false);
      expect(resolveIsStreaming({}, directChDirective)).toBe(false);
      expect(resolveIsStreaming({}, fusionDirective)).toBe(false);
    });

    it("detects content chunks properly", () => {
      expect(isContentChunk('{"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}')).toBe(true);
      expect(isContentChunk('data: {"candidates":[]}\n\n')).toBe(true);
      expect(isContentChunk('data: {"text":"hello"}\n\n')).toBe(true);
      expect(isContentChunk(': ping\n\n')).toBe(false);
      expect(isContentChunk('data: {}\n\n')).toBe(false);
    });

    it("parses finish reasons accurately", () => {
      expect(parseFinishReason('{"finishReason":"STOP"}')).toBe("STOP");
      expect(parseFinishReason('{"finish_reason":"MAX_TOKENS"}')).toBe("MAX_TOKENS");
      expect(parseFinishReason('{"other":"value"}')).toBeNull();
    });

    it("parses usage metadata accurately", () => {
      const usage1 = parseUsageMetadata(
        '{"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":25,"totalTokenCount":35}}'
      );
      expect(usage1).toEqual({
        promptTokens: 10,
        completionTokens: 25,
        totalTokens: 35,
      });

      // Computes totalTokens when totalTokenCount is missing or 0
      const usage2 = parseUsageMetadata(
        '{"usage_metadata":{"promptTokenCount":15,"candidatesTokenCount":5}}'
      );
      expect(usage2).toEqual({
        promptTokens: 15,
        completionTokens: 5,
        totalTokens: 20,
      });

      expect(parseUsageMetadata('{"no_usage":true}')).toBeNull();
      expect(parseUsageMetadata('{"usageMetadata":{"promptTokenCount":0,"candidatesTokenCount":0,"totalTokenCount":0}}')).toBeNull();
    });
  });

  describe("transformClientToWire", () => {
    it("transforms client request to wire format with default gc completion", () => {
      const inboundBody = {
        contents: [{ role: "user", parts: [{ text: "Hello Gemini" }] }],
        generationConfig: { temperature: 0.7 },
      };
      const wire = googleNativeTransformer.transformClientToWire(
        inboundBody,
        directGcDirective,
        new Headers()
      );

      expect(wire.endpointKey).toBe("gc");
      expect(wire.method).toBe("POST");
      expect(wire.headers).toEqual({ "Content-Type": "application/json" });
      expect(wire.body).toEqual(inboundBody);
      expect(wire.isStreaming).toBe(true);
    });

    it("respects ch completion and explicit stream: false", () => {
      const inboundBody = {
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        stream: false,
      };
      const wire = googleNativeTransformer.transformClientToWire(
        inboundBody,
        directChDirective,
        new Headers()
      );

      expect(wire.endpointKey).toBe("ch");
      expect(wire.method).toBe("POST");
      expect(wire.isStreaming).toBe(false);
    });

    it("respects ch completion with stream: true", () => {
      const inboundBody = {
        contents: [{ role: "user", parts: [{ text: "Hi" }] }],
        stream: true,
      };
      const wire = googleNativeTransformer.transformClientToWire(
        inboundBody,
        directChDirective,
        new Headers()
      );

      expect(wire.endpointKey).toBe("ch");
      expect(wire.isStreaming).toBe(true);
    });
  });

  describe("transformWireToClient", () => {
    it("passes non-streaming responses through verbatim", () => {
      const upstreamResponse = {
        candidates: [
          {
            content: { parts: [{ text: "Non-streaming answer" }], role: "model" },
            finishReason: "STOP",
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 8,
          candidatesTokenCount: 12,
          totalTokenCount: 20,
        },
      };

      const transformed = googleNativeTransformer.transformWireToClient(
        upstreamResponse,
        directGcDirective
      );
      expect(transformed).toEqual(upstreamResponse);
    });
  });

  describe("createWireToClientStream", () => {
    it("passes bytes through transparently and records TTFT and usage", async () => {
      const telemetry = createMockTelemetry("req-stream-test-1");
      const markTtftSpy = spyOn(telemetry, "markTtft");
      const recordUsageSpy = spyOn(telemetry, "recordUsage");

      const abortController = new AbortController();
      const transformStream = googleNativeTransformer.createWireToClientStream(
        directGcDirective,
        telemetry,
        abortController.signal
      );

      const chunk1 = 'data: {"candidates":[{"content":{"parts":[{"text":"Hello"}]}}]}\n\n';
      const chunk2 = 'data: {"candidates":[{"content":{"parts":[{"text":" world"}]},"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":10,"candidatesTokenCount":6,"totalTokenCount":16}}\n\n';
      const encoder = new TextEncoder();

      const receivedChunks = await pipeAndCollect(transformStream, async (writer) => {
        await writer.write(encoder.encode(chunk1));
        expect(markTtftSpy).toHaveBeenCalledTimes(1);
        expect(recordUsageSpy).toHaveBeenCalledTimes(0);

        await writer.write(encoder.encode(chunk2));
      });

      const decoder = new TextDecoder();
      const combinedText = receivedChunks.map((c) => decoder.decode(c)).join("");

      expect(combinedText).toBe(chunk1 + chunk2);
      expect(markTtftSpy).toHaveBeenCalledTimes(1);
      expect(recordUsageSpy).toHaveBeenCalledTimes(1);
      expect(recordUsageSpy).toHaveBeenCalledWith({
        promptTokens: 10,
        completionTokens: 6,
        totalTokens: 16,
        finishReason: "stop",
      });
    });

    it("does not call markTtft on ping or empty chunks prior to content", async () => {
      const telemetry = createMockTelemetry("req-stream-ping-test");
      const markTtftSpy = spyOn(telemetry, "markTtft");
      const abortController = new AbortController();
      const transformStream = googleNativeTransformer.createWireToClientStream(
        directGcDirective,
        telemetry,
        abortController.signal
      );

      const encoder = new TextEncoder();
      await pipeAndCollect(transformStream, async (writer) => {
        await writer.write(encoder.encode(": keepalive ping\n\n"));
        expect(markTtftSpy).toHaveBeenCalledTimes(0);

        await writer.write(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"First real content"}]}}]}\n\n'));
        expect(markTtftSpy).toHaveBeenCalledTimes(1);
      });

      expect(markTtftSpy).toHaveBeenCalledTimes(1);
    });

    it("processes usage metadata emitted in flush", async () => {
      const telemetry = createMockTelemetry("req-stream-flush-test");
      const recordUsageSpy = spyOn(telemetry, "recordUsage");
      const abortController = new AbortController();
      const transformStream = googleNativeTransformer.createWireToClientStream(
        directGcDirective,
        telemetry,
        abortController.signal
      );

      const encoder = new TextEncoder();
      await pipeAndCollect(transformStream, async (writer) => {
        await writer.write(encoder.encode('{"usageMetadata":{"promptTokenCount":7,"candidatesTokenCount":13,"totalTokenCount":20},"finishReason":"MAX_TOKENS"}'));
      });

      expect(recordUsageSpy).toHaveBeenCalledTimes(1);
      expect(recordUsageSpy).toHaveBeenCalledWith({
        promptTokens: 7,
        completionTokens: 13,
        totalTokens: 20,
        finishReason: "max_tokens",
      });
    });

    it("drops chunks if client signal is aborted", async () => {
      const telemetry = createMockTelemetry("req-stream-abort-test");
      const abortController = new AbortController();
      const transformStream = googleNativeTransformer.createWireToClientStream(
        directGcDirective,
        telemetry,
        abortController.signal
      );

      abortController.abort();
      const encoder = new TextEncoder();

      const received = await pipeAndCollect(transformStream, async (writer) => {
        await writer.write(encoder.encode('data: {"candidates":[{"content":{"parts":[{"text":"Dropped"}]}}]}\n\n'));
      });

      expect(received.length).toBe(0);
    });
  });
});
