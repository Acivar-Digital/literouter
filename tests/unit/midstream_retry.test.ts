import { describe, expect, it } from "bun:test";
import { resetEnvCache } from "../../src/config/env";
import {
  createResilientStream,
  formatMidstreamErrorFrame,
  handlePrematureEof,
  inspectChunkMarkers,
  isInBandErrorChunk,
  readWithChunkTimeout,
  StreamStallError,
  type StreamCallbacks,
  type StreamTokenState,
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

describe("formatMidstreamErrorFrame", () => {
  it("formats OpenAI error frame with JSON error payload and data: [DONE] delimiter", () => {
    const frame = formatMidstreamErrorFrame("openai", "Connection terminated mid-stream");
    const decoded = decoder.decode(frame);

    expect(decoded).toContain('data: {"error":{"message":"Connection terminated mid-stream","type":"server_error"}}\n\n');
    expect(decoded).toContain("data: [DONE]\n\n");
  });

  it("formats Anthropic error frame with SSE event error format", () => {
    const frame = formatMidstreamErrorFrame("anthropic", "Upstream stall timeout");
    const decoded = decoder.decode(frame);

    expect(decoded).toContain("event: error\n");
    expect(decoded).toContain('"type":"api_error"');
    expect(decoded).toContain('"message":"Upstream stall timeout"');
  });
});

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

describe("handlePrematureEof", () => {
  it("returns null if hasSeenDoneMarker is true", async () => {
    let retryCalled = false;
    const callbacks: StreamCallbacks = {
      retryProvider: async () => {
        retryCalled = true;
        return null;
      },
    };
    const state: StreamTokenState = { hasSeenDoneMarker: true, hasSeenDataToken: false };
    const result = await handlePrematureEof(state, callbacks);
    expect(result).toBeNull();
    expect(retryCalled).toBe(false);
  });

  it("returns null if hasSeenDataToken is true", async () => {
    let retryCalled = false;
    const callbacks: StreamCallbacks = {
      retryProvider: async () => {
        retryCalled = true;
        return null;
      },
    };
    const state: StreamTokenState = { hasSeenDoneMarker: false, hasSeenDataToken: true };
    const result = await handlePrematureEof(state, callbacks);
    expect(result).toBeNull();
    expect(retryCalled).toBe(false);
  });

  it("calls retryProvider when neither token nor done marker seen", async () => {
    const retryChunk = encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n');
    const dummyReader = createMockReader([]);
    const callbacks: StreamCallbacks = {
      retryProvider: async (reason) => {
        expect(reason).toContain("prematurely with 0 tokens");
        return { firstChunk: retryChunk, reader: dummyReader };
      },
    };
    const state: StreamTokenState = { hasSeenDoneMarker: false, hasSeenDataToken: false };
    const result = await handlePrematureEof(state, callbacks);
    expect(result).toBeDefined();
    expect(result?.firstChunk).toBe(retryChunk);
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

  it("premature EOF with 0 data tokens triggers retryProvider and seamlessly yields chunks from 2nd provider", async () => {
    const firstChunk = encoder.encode("\n\n");
    const emptyReader = createMockReader([]);

    const retryFirstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"provider2 start"}}]}\n\n');
    const retryChunk2 = encoder.encode('data: {"choices":[{"delta":{"content":" provider2 mid"}}]}\n\n');
    const retryDoneChunk = encoder.encode("data: [DONE]\n\n");
    const recoveredReader = createMockReader([retryChunk2, retryDoneChunk]);

    let retryReason = "";
    const callbacks: StreamCallbacks = {
      retryProvider: async (reason: string) => {
        retryReason = reason;
        return {
          firstChunk: retryFirstChunk,
          reader: recoveredReader,
        };
      },
    };

    const stream = createResilientStream(firstChunk, emptyReader, callbacks);
    const { text, chunks } = await readAllChunks(stream);

    expect(retryReason).toBe("Upstream terminated stream prematurely with 0 tokens and no [DONE] marker");
    expect(text).toContain("provider2 start");
    expect(text).toContain(" provider2 mid");
    expect(text).toContain("[DONE]");
    expect(chunks.length).toBeGreaterThanOrEqual(3);
  });

  it("clean EOF after data tokens does NOT trigger retry and closes cleanly", async () => {
    const firstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n');
    const chunk2 = encoder.encode('data: {"choices":[{"delta":{"content":" world"}}]}\n\n');
    const normalReader = createMockReader([chunk2]);

    let retryCalled = false;
    const callbacks: StreamCallbacks = {
      retryProvider: async () => {
        retryCalled = true;
        return null;
      },
    };

    const stream = createResilientStream(firstChunk, normalReader, callbacks);
    const { text } = await readAllChunks(stream);

    expect(retryCalled).toBe(false);
    expect(text).toContain("Hello");
    expect(text).toContain(" world");
  });

  it("clean EOF after [DONE] marker does NOT trigger retry and closes cleanly", async () => {
    const firstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"Result"}}]}\n\n');
    const doneChunk = encoder.encode("data: [DONE]\n\n");
    const normalReader = createMockReader([doneChunk]);

    let retryCalled = false;
    const callbacks: StreamCallbacks = {
      retryProvider: async () => {
        retryCalled = true;
        return null;
      },
    };

    const stream = createResilientStream(firstChunk, normalReader, callbacks);
    const { text } = await readAllChunks(stream);

    expect(retryCalled).toBe(false);
    expect(text).toContain("Result");
    expect(text).toContain("[DONE]");
  });

  it("inspectChunkMarkers accurately tracks [DONE], finish_reason, and content tokens", () => {
    const state: StreamTokenState = { hasSeenDoneMarker: false, hasSeenDataToken: false };

    inspectChunkMarkers(encoder.encode(": keep-alive\n\n"), state);
    expect(state.hasSeenDoneMarker).toBe(false);
    expect(state.hasSeenDataToken).toBe(false);

    inspectChunkMarkers(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'), state);
    expect(state.hasSeenDataToken).toBe(true);
    expect(state.hasSeenDoneMarker).toBe(false);

    inspectChunkMarkers(encoder.encode('data: {"choices":[{"finish_reason":"stop"}]}\n\n'), state);
    expect(state.hasSeenDoneMarker).toBe(true);

    const doneState: StreamTokenState = { hasSeenDoneMarker: false, hasSeenDataToken: false };
    inspectChunkMarkers(encoder.encode("data: [DONE]\n\n"), doneState);
    expect(doneState.hasSeenDoneMarker).toBe(true);
  });

  it("readWithChunkTimeout throws StreamStallError when reading times out", async () => {
    const stalledReader = {
      read: () => new Promise<never>(() => {}),
      releaseLock: () => {},
      cancel: async () => {},
      closed: Promise.resolve(undefined),
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    let errorThrown: unknown;
    try {
      await readWithChunkTimeout(stalledReader, 25);
    } catch (err: unknown) {
      errorThrown = err;
    }

    expect(errorThrown).toBeInstanceOf(StreamStallError);
    expect((errorThrown as Error).message).toContain("Stream idle timeout exceeded 25ms");
  });

  it("inter-chunk stall timeout triggers retryProvider and resumes streaming from 2nd provider", async () => {
    const originalTimeout = process.env.LITEROUTER_STREAM_IDLE_TIMEOUT_MS;
    process.env.LITEROUTER_STREAM_IDLE_TIMEOUT_MS = "25";
    resetEnvCache();

    try {
      const firstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"pre-stall"}}]}\n\n');
      const stalledReader = {
        read: () => new Promise<never>(() => {}),
        releaseLock: () => {},
        cancel: async () => {},
        closed: Promise.resolve(undefined),
      } as unknown as ReadableStreamDefaultReader<Uint8Array>;

      const retryFirstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"post-stall resumed"}}]}\n\n');
      const retryDoneChunk = encoder.encode("data: [DONE]\n\n");
      const recoveredReader = createMockReader([retryDoneChunk]);

      let retryReason = "";
      const callbacks: StreamCallbacks = {
        retryProvider: async (reason: string) => {
          retryReason = reason;
          return {
            firstChunk: retryFirstChunk,
            reader: recoveredReader,
          };
        },
      };

      const stream = createResilientStream(firstChunk, stalledReader, callbacks);
      const { text } = await readAllChunks(stream);

      expect(retryReason).toContain("Stream idle timeout exceeded 25ms");
      expect(text).toContain("pre-stall");
      expect(text).toContain("post-stall resumed");
      expect(text).toContain("[DONE]");
    } finally {
      if (originalTimeout !== undefined) {
        process.env.LITEROUTER_STREAM_IDLE_TIMEOUT_MS = originalTimeout;
      } else {
        delete process.env.LITEROUTER_STREAM_IDLE_TIMEOUT_MS;
      }
      resetEnvCache();
    }
  });

  it("retryProvider exhaustion formats downstream OpenAI error frame and terminates cleanly", async () => {
    const firstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"initial"}}]}\n\n');
    const socketError = new Error("Connection reset by peer");
    const failingReader = createMockReader([socketError]);

    let retryCalled = false;
    const callbacks: StreamCallbacks = {
      protocol: "openai",
      retryProvider: async () => {
        retryCalled = true;
        return null;
      },
    };

    const stream = createResilientStream(firstChunk, failingReader, callbacks);
    const { text } = await readAllChunks(stream);

    expect(retryCalled).toBe(true);
    expect(text).toContain("initial");
    expect(text).toContain('data: {"error":{"message":"Connection reset by peer","type":"server_error"}}\n\ndata: [DONE]\n\n');
  });

  it("retryProvider exhaustion formats downstream Anthropic error frame and terminates cleanly", async () => {
    const firstChunk = encoder.encode("event: message_start\ndata: {}\n\n");
    const socketError = new Error("Anthropic upstream failure");
    const failingReader = createMockReader([socketError]);

    let retryCalled = false;
    const callbacks: StreamCallbacks = {
      protocol: "anthropic",
      retryProvider: async () => {
        retryCalled = true;
        return null;
      },
    };

    const stream = createResilientStream(firstChunk, failingReader, callbacks);
    const { text } = await readAllChunks(stream);

    expect(retryCalled).toBe(true);
    expect(text).toContain("event: message_start");
    expect(text).toContain("event: error\ndata: ");
    expect(text).toContain('"type":"api_error"');
    expect(text).toContain('"message":"Anthropic upstream failure"');
  });

  it("keepalive comment frames do not count as data tokens, so premature EOF still triggers retry", async () => {
    const firstChunk = encoder.encode(": keep-alive\n\n");
    const commentChunk1 = encoder.encode(": keep-alive\n\n");
    const commentChunk2 = encoder.encode(": ping\n\n");
    const commentsThenEofReader = createMockReader([commentChunk1, commentChunk2]);

    const retryFirstChunk = encoder.encode('data: {"choices":[{"delta":{"content":"recovered after keepalive EOF"}}]}\n\n');
    const retryDoneChunk = encoder.encode("data: [DONE]\n\n");
    const recoveredReader = createMockReader([retryDoneChunk]);

    let retryReason = "";
    const callbacks: StreamCallbacks = {
      retryProvider: async (reason: string) => {
        retryReason = reason;
        return {
          firstChunk: retryFirstChunk,
          reader: recoveredReader,
        };
      },
    };

    const stream = createResilientStream(firstChunk, commentsThenEofReader, callbacks);
    const { text } = await readAllChunks(stream);

    expect(retryReason).toBe("Upstream terminated stream prematurely with 0 tokens and no [DONE] marker");
    expect(text).toContain(": keep-alive");
    expect(text).toContain(": ping");
    expect(text).toContain("recovered after keepalive EOF");
    expect(text).toContain("[DONE]");
  });
});
