import { describe, expect, it } from "bun:test";
import {
  createResilientStream,
  isInBandErrorChunk,
  type StreamCallbacks,
} from "../../src/network/fetcher";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function createMockReader(
  chunks: Array<Uint8Array | Error>
): ReadableStreamDefaultReader<Uint8Array> {
  let index = 0;
  return {
    read: async () => {
      if (index >= chunks.length) {
        return { done: true, value: undefined };
      }
      const item = chunks[index++];
      if (item instanceof Error) {
        throw item;
      }
      return { done: false, value: item };
    },
    releaseLock: () => {},
    cancel: async () => {},
    closed: Promise.resolve(undefined),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

async function readAllChunks(stream: ReadableStream<Uint8Array>): Promise<{
  text: string;
  chunks: Uint8Array[];
}> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      text += decoder.decode(value, { stream: true });
    }
  }
  text += decoder.decode();
  return { text, chunks };
}

describe("isInBandErrorChunk", () => {
  it("detects in-band server error chunk containing 'Server error mid-response. The response above may be incomplete.' and returns { isError: true }", () => {
    const textChunk = encoder.encode(
      "data: {\"error\":{\"message\":\"Server error mid-response. The response above may be incomplete.\",\"code\":500}}\n\n"
    );
    const result = isInBandErrorChunk(textChunk);
    expect(result).toBeDefined();
    expect(result.isError).toBe(true);

    const plainTextChunk = encoder.encode(
      "Server error mid-response. The response above may be incomplete."
    );
    const plainResult = isInBandErrorChunk(plainTextChunk);
    expect(plainResult.isError).toBe(true);
  });

  it("detects 5xx error JSON in SSE chunks and returns { isError: true }", () => {
    const errorChunks = [
      'data: {"error":{"message":"Internal Server Error","type":"server_error","code":500}}\n\n',
      'data: {"error":{"message":"Bad Gateway","code":502}}\n\n',
      'data: {"error":{"message":"Service Unavailable","status":503}}\n\n',
      'data: {"error":{"message":"Gateway Timeout","code":504}}\n\n',
      'data: {"error":{"type":"server_error","message":"An unexpected error occurred"}}\n\n',
      'data: {"error":{"code":"internal_error","message":"Upstream failure"}}\n\n',
    ];

    for (const chunkStr of errorChunks) {
      const chunk = encoder.encode(chunkStr);
      const result = isInBandErrorChunk(chunk);
      expect(result.isError).toBe(true);
    }
  });

  it("returns { isError: false } for standard content deltas", () => {
    const normalChunks = [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":" world"}}]}\\n\\n',
      'data: {"choices":[{"delta":{"reasoning_content":"Let\'s think step by step"}}]}\n\n',
      'data: [DONE]\n\n',
      ': keep-alive\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":25,"total_tokens":35}}\n\n',
      "",
    ];

    for (const chunkStr of normalChunks) {
      const chunk = encoder.encode(chunkStr);
      const result = isInBandErrorChunk(chunk);
      expect(result.isError).toBe(false);
    }
  });

  it("returns { isError: false } for empty byte chunks", () => {
    const emptyChunk = new Uint8Array(0);
    const result = isInBandErrorChunk(emptyChunk);
    expect(result.isError).toBe(false);
  });
});

describe("createResilientStream — Mid-Stream Error Recovery", () => {
  it("suppresses in-band error chunk, calls nextAttemptProvider, and continues streaming downstream until done", async () => {
    const firstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"First"}}]}\n\n');
    const normalChunk = encoder.encode('data: {"choices":[{"delta":{"content":" chunk"}}]}\n\n');
    const inBandErrorChunk = encoder.encode(
      'data: {"error":{"message":"Server error mid-response. The response above may be incomplete.","code":500}}\n\n'
    );

    const retryFirstChunk = encoder.encode('data: {"choices":[{"delta":{"content":" recovered"}}]}\n\n');
    const retryDoneChunk = encoder.encode("data: [DONE]\n\n");

    const failingReader = createMockReader([normalChunk, inBandErrorChunk]);
    const recoveredReader = createMockReader([retryDoneChunk]);

    let providerCalled = false;
    const callbacks: StreamCallbacks = {
      nextAttemptProvider: async () => {
        providerCalled = true;
        return {
          firstChunk: retryFirstChunk,
          rawReader: recoveredReader,
        };
      },
    };

    const stream = createResilientStream(firstChunk, failingReader, callbacks);
    const { text } = await readAllChunks(stream);

    expect(providerCalled).toBe(true);
    expect(text).toContain("First");
    expect(text).toContain(" chunk");
    expect(text).toContain(" recovered");
    expect(text).toContain("[DONE]");
    expect(text).not.toContain("Server error mid-response");
  });

  it("recovers when upstream reader throws mid-stream (e.g. socket reset) via nextAttemptProvider", async () => {
    const firstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"Start"}}]}\n\n');
    const chunk1 = encoder.encode('data: {"choices":[{"delta":{"content":" mid"}}]}\n\n');
    const socketResetError = new Error("socket reset: connection reset by peer");

    const retryFirstChunk = encoder.encode('data: {"choices":[{"delta":{"content":" finish"}}]}\n\n');
    const retryDoneChunk = encoder.encode("data: [DONE]\n\n");

    const failingReader = createMockReader([chunk1, socketResetError]);
    const recoveredReader = createMockReader([retryDoneChunk]);

    let providerCalled = false;
    const callbacks: StreamCallbacks = {
      nextAttemptProvider: async () => {
        providerCalled = true;
        return {
          firstChunk: retryFirstChunk,
          rawReader: recoveredReader,
        };
      },
    };

    const stream = createResilientStream(firstChunk, failingReader, callbacks);
    const { text } = await readAllChunks(stream);

    expect(providerCalled).toBe(true);
    expect(text).toContain("Start");
    expect(text).toContain(" mid");
    expect(text).toContain(" finish");
    expect(text).toContain("[DONE]");
  });

  it("errors downstream controller if retries fail or nextAttemptProvider throws", async () => {
    const firstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"Start"}}]}\n\n');
    const socketError = new Error("Connection terminated unexpectedly");

    const failingReader = createMockReader([socketError]);

    const callbacks: StreamCallbacks = {
      nextAttemptProvider: async () => {
        throw new Error("All retry keys exhausted");
      },
    };

    const stream = createResilientStream(firstChunk, failingReader, callbacks);

    let errorThrown: unknown;
    try {
      await readAllChunks(stream);
    } catch (err: unknown) {
      errorThrown = err;
    }

    expect(errorThrown).toBeDefined();
    expect((errorThrown as Error).message).toContain("All retry keys exhausted");
  });

  it("errors downstream controller if nextAttemptProvider returns null / no further attempts", async () => {
    const firstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"Start"}}]}\n\n');
    const socketError = new Error("Connection reset");

    const failingReader = createMockReader([socketError]);

    const callbacks: StreamCallbacks = {
      nextAttemptProvider: async () => {
        return null;
      },
    };

    const stream = createResilientStream(firstChunk, failingReader, callbacks);

    let errorThrown: unknown;
    try {
      await readAllChunks(stream);
    } catch (err: unknown) {
      errorThrown = err;
    }

    expect(errorThrown).toBeDefined();
    expect((errorThrown as Error).message).toContain("Connection reset");
  });

  it("errors downstream controller if upstream fails and no nextAttemptProvider is provided", async () => {
    const firstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"Start"}}]}\n\n');
    const socketError = new Error("Network transport failure");

    const failingReader = createMockReader([socketError]);

    const stream = createResilientStream(firstChunk, failingReader);

    let errorThrown: unknown;
    try {
      await readAllChunks(stream);
    } catch (err: unknown) {
      errorThrown = err;
    }

    expect(errorThrown).toBeDefined();
    expect((errorThrown as Error).message).toContain("Network transport failure");
  });
});
