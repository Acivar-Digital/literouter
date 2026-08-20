import { describe, expect, it, spyOn } from "bun:test";
import {
  NoResponseError,
  fetchWithTtftGuard,
  formatMidstreamErrorFrame,
  readFirstChunkWithTimeout,
  resolveTtftTimeout,
} from "../../src/network/fetcher";

const decoder = new TextDecoder();

describe("Fetcher — Transport Error Wrapping", () => {
  it("wraps raw fetch network transport exceptions in NoResponseError when signal is not aborted", async () => {
    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => {
      return Promise.reject(new TypeError("Failed to fetch: Connection refused"));
    }) as unknown as typeof fetch);

    const options = {
      url: "http://127.0.0.1:59999/unreachable-test-endpoint",
      method: "POST" as const,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ test: true }),
      provider: "test-provider",
      keyIndex: 0,
    };

    let thrownError: unknown;
    try {
      await fetchWithTtftGuard(options);
    } catch (err: unknown) {
      thrownError = err;
    } finally {
      fetchSpy.mockRestore();
    }

    expect(thrownError).toBeInstanceOf(NoResponseError);
    expect((thrownError as Error).message).toBe("Network transport failure: Failed to fetch: Connection refused");
  });

  it("rethrows raw error when clientSignal is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Client cancelled request"));

    const fetchSpy = spyOn(globalThis, "fetch").mockImplementation((() => {
      const abortErr = new Error("The operation was aborted");
      abortErr.name = "AbortError";
      return Promise.reject(abortErr);
    }) as unknown as typeof fetch);

    const options = {
      url: "http://127.0.0.1:59999/unreachable-test-endpoint",
      method: "POST" as const,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ test: true }),
      clientSignal: controller.signal,
      provider: "test-provider",
      keyIndex: 0,
    };

    let thrownError: unknown;
    try {
      await fetchWithTtftGuard(options);
    } catch (err: unknown) {
      thrownError = err;
    } finally {
      fetchSpy.mockRestore();
    }

    expect(thrownError).not.toBeInstanceOf(NoResponseError);
    expect((thrownError as Error).message).toBe("The operation was aborted");
  });
});

describe("Dynamic TTFT Resolution (`resolveTtftTimeout`)", () => {
  it("defaults to 5000ms when model is undefined or empty", () => {
    expect(resolveTtftTimeout()).toBe(5000);
    expect(resolveTtftTimeout(undefined, undefined)).toBe(5000);
    expect(resolveTtftTimeout("", undefined)).toBe(5000);
  });

  it("uses envTimeoutMs for standard non-reasoning models", () => {
    expect(resolveTtftTimeout("gpt-4o", 8000)).toBe(8000);
    expect(resolveTtftTimeout("claude-3-5-sonnet-20241022", 10000)).toBe(10000);
    expect(resolveTtftTimeout("meta-llama/llama-3.3-70b-instruct")).toBe(5000);
  });

  it("scales to at least 60000ms for reasoning models", () => {
    const reasoningModels = [
      "o1",
      "o1-mini",
      "o1-preview",
      "o3",
      "o3-mini",
      "deepseek-reasoner",
      "deepseek/deepseek-r1",
      "deepseek-r1-distill-llama-70b",
      "claude-3-7-sonnet-thought",
      "claude-3-7-sonnet:thought",
      "custom-thinking-model",
    ];

    for (const model of reasoningModels) {
      expect(resolveTtftTimeout(model)).toBe(60000);
      expect(resolveTtftTimeout(model, 5000)).toBe(60000);
    }
  });

  it("respects envTimeoutMs if larger than 60000ms for reasoning models", () => {
    expect(resolveTtftTimeout("deepseek-reasoner", 90000)).toBe(90000);
    expect(resolveTtftTimeout("o1-mini", 75000)).toBe(75000);
  });
});

describe("Wire-Compliant Midstream Error Frame (`formatMidstreamErrorFrame`)", () => {
  it("formats Anthropic error frame correctly for 'anthropic' and 'cl'", () => {
    const message = "Upstream stream interrupted mid-generation";

    const anthropicBytes = formatMidstreamErrorFrame("anthropic", message);
    const anthropicText = decoder.decode(anthropicBytes);
    expect(anthropicText).toBe(
      `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message } })}\n\n`
    );

    const clBytes = formatMidstreamErrorFrame("cl", message);
    const clText = decoder.decode(clBytes);
    expect(clText).toBe(
      `event: error\ndata: ${JSON.stringify({ type: "error", error: { type: "api_error", message } })}\n\n`
    );
  });

  it("formats OpenAI error frame correctly with [DONE] marker for 'openai' and default", () => {
    const message = "Upstream connection dropped";

    const openaiBytes = formatMidstreamErrorFrame("openai", message);
    const openaiText = decoder.decode(openaiBytes);
    expect(openaiText).toBe(
      `data: ${JSON.stringify({ error: { message, type: "server_error" } })}\n\ndata: [DONE]\n\n`
    );

    const defaultBytes = formatMidstreamErrorFrame("other-protocol", message);
    const defaultText = decoder.decode(defaultBytes);
    expect(defaultText).toBe(
      `data: ${JSON.stringify({ error: { message, type: "server_error" } })}\n\ndata: [DONE]\n\n`
    );
  });
});

describe("Stream First Chunk TTFT Timeout (`readFirstChunkWithTimeout`)", () => {
  it("rejects with NoResponseError when chunk is not read within timeoutMs", async () => {
    const slowStream = new ReadableStream<Uint8Array>({
      start() {
        // Stalled stream - produces no tokens
      },
    });

    const reader = slowStream.getReader();
    let thrownError: unknown;
    try {
      await readFirstChunkWithTimeout(reader, 50);
    } catch (err: unknown) {
      thrownError = err;
    } finally {
      reader.releaseLock();
    }

    expect(thrownError).toBeInstanceOf(NoResponseError);
    expect((thrownError as Error).message).toContain("TTFT exceeded 50ms");
  });

  it("resolves promptly when first chunk is received before timeoutMs", async () => {
    const encoder = new TextEncoder();
    const fastStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"content\":\"hello\"}\n\n"));
      },
    });

    const reader = fastStream.getReader();
    const result = await readFirstChunkWithTimeout(reader, 1000);
    reader.releaseLock();

    expect(result.done).toBe(false);
    expect(result.value).toBeDefined();
    expect(decoder.decode(result.value)).toContain("hello");
  });
});
