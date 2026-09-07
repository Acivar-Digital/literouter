import { describe, expect, it } from "bun:test";
import { reassembleResponse } from "../../src/network/fetcher";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function createMockStream(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= chunks.length) {
        controller.close();
      } else {
        controller.enqueue(chunks[index++]);
      }
    },
  });
}

async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

describe("Network Fetcher: reassembleResponse & Protocol Fidelity", () => {
  it("reassembles firstChunk and remaining stream with 100% byte fidelity", async () => {
    const chunk1 = encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n");
    const chunk2 = encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n");
    const chunk3 = encoder.encode("data: [DONE]\n\n");

    const rawStream = createMockStream([chunk2, chunk3]);
    const rawReader = rawStream.getReader();

    const mockResponse = new Response(null, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    const combinedRes = reassembleResponse(mockResponse, chunk1, rawReader);
    expect(combinedRes.status).toBe(200);
    expect(combinedRes.headers.get("content-type")).toBe("text/event-stream");

    const resultText = await readAllBytes(combinedRes.body!);
    const expectedText =
      "data: {\"choices\":[{\"delta\":{\"content\":\"Hello\"}}]}\n\n" +
      "data: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n\n" +
      "data: [DONE]\n\n";

    expect(resultText).toBe(expectedText);
  });

  it("handles empty firstChunk cleanly without crashing", async () => {
    const chunk1 = new Uint8Array(0);
    const chunk2 = encoder.encode("{\"output\":\"direct json payload\"}");

    const rawStream = createMockStream([chunk2]);
    const rawReader = rawStream.getReader();

    const mockResponse = new Response(null, { status: 200 });
    const combinedRes = reassembleResponse(mockResponse, chunk1, rawReader);

    const text = await combinedRes.text();
    expect(text).toBe("{\"output\":\"direct json payload\"}");
  });

  it("propagates downstream cancellation to the underlying rawReader", async () => {
    let cancelCalledWith: unknown = null;
    const rawReader = {
      read: async () => ({ done: false, value: encoder.encode("chunk") }),
      cancel: async (reason: unknown) => {
        cancelCalledWith = reason;
      },
    } as unknown as ReadableStreamDefaultReader<Uint8Array>;

    const mockResponse = new Response(null, { status: 200 });
    const combinedRes = reassembleResponse(mockResponse, new Uint8Array(0), rawReader);

    const reader = combinedRes.body!.getReader();
    await reader.cancel("client disconnected");

    expect(cancelCalledWith).toBe("client disconnected");
  });
});
