import { describe, expect, it } from "bun:test";
import { parseDirective } from "../../../src/directive/parser";
import type { ParsedDirective } from "../../../src/directive/types";
import {
  OpenAIEmbeddingsTransformer,
  openAiEmbeddingsTransformer,
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_BATCH_SIZE,
  isMultiInputBatch,
  sliceEmbeddingInput,
  mergeEmbeddingResponses,
  type OpenAIEmbeddingResponse,
} from "../../../src/transformers/openai_embeddings";
import type { RequestTelemetry } from "../../../src/telemetry/session";

describe("OpenAIEmbeddingsTransformer", () => {
  const dummyDirective = parseDirective("lr-tei-oa-em-no") as ParsedDirective;

  it("exports openAiEmbeddingsTransformer as a singleton instance", () => {
    expect(openAiEmbeddingsTransformer).toBeInstanceOf(OpenAIEmbeddingsTransformer);
    expect(DEFAULT_EMBEDDING_MODEL).toBe("BAAI/bge-m3");
    expect(DEFAULT_EMBEDDING_BATCH_SIZE).toBe(8);
  });

  describe("transformClientToWire", () => {
    it("sets endpointKey to 'em', method to 'POST', isStreaming to false", () => {
      const headers = new Headers({
        "content-type": "application/json",
        "user-agent": "AFT-Semantic/1.0",
        "x-request-id": "req-123",
        "authorization": "Bearer secret-key", // Should be filtered out
      });

      const payload = openAiEmbeddingsTransformer.transformClientToWire(
        { input: "test query", model: "custom-model" },
        dummyDirective,
        headers
      );

      expect(payload.endpointKey).toBe("em");
      expect(payload.method).toBe("POST");
      expect(payload.isStreaming).toBe(false);
      expect(payload.headers["content-type"]).toBe("application/json");
      expect(payload.headers["user-agent"]).toBe("AFT-Semantic/1.0");
      expect(payload.headers["x-request-id"]).toBe("req-123");
      expect(payload.headers["authorization"]).toBeUndefined();
      expect(payload.body.input).toBe("test query");
      expect(payload.body.model).toBe("custom-model");
    });

    it("defaults model to 'BAAI/bge-m3' when missing", () => {
      const payload = openAiEmbeddingsTransformer.transformClientToWire(
        { input: ["sentence 1", "sentence 2"] },
        dummyDirective,
        new Headers()
      );

      expect(payload.body.model).toBe("BAAI/bge-m3");
      expect(payload.body.input).toEqual(["sentence 1", "sentence 2"]);
    });

    it("normalizes missing input to empty string", () => {
      const payload = openAiEmbeddingsTransformer.transformClientToWire(
        {},
        dummyDirective,
        new Headers()
      );

      expect(payload.body.input).toBe("");
    });
  });

  describe("transformWireToClient", () => {
    it("passes through standard OpenAI embedding object", () => {
      const standardJson = {
        object: "list",
        data: [
          { object: "embedding", embedding: [0.1, 0.2, 0.3], index: 0 },
        ],
        model: "BAAI/bge-m3",
        usage: { prompt_tokens: 5, total_tokens: 5 },
      };

      const result = openAiEmbeddingsTransformer.transformWireToClient(standardJson, dummyDirective);
      expect(result).toEqual(standardJson);
    });

    it("transforms raw 2D array of vectors into standard OpenAI format", () => {
      const rawVectors = [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ];

      const result = openAiEmbeddingsTransformer.transformWireToClient(
        rawVectors,
        dummyDirective
      ) as OpenAIEmbeddingResponse;

      expect(result.object).toBe("list");
      expect(result.model).toBe("BAAI/bge-m3");
      expect(result.data).toHaveLength(2);
      expect(result.data![0]).toEqual({
        object: "embedding",
        embedding: [0.1, 0.2, 0.3],
        index: 0,
      });
      expect(result.data![1]).toEqual({
        object: "embedding",
        embedding: [0.4, 0.5, 0.6],
        index: 1,
      });
      expect(result.usage).toEqual({ prompt_tokens: 0, total_tokens: 0 });
    });

    it("transforms raw 1D vector into single-item OpenAI format", () => {
      const rawVector = [0.1, 0.2, 0.3];

      const result = openAiEmbeddingsTransformer.transformWireToClient(
        rawVector,
        dummyDirective
      ) as OpenAIEmbeddingResponse;

      expect(result.object).toBe("list");
      expect(result.data).toHaveLength(1);
      expect(result.data![0]).toEqual({
        object: "embedding",
        embedding: [0.1, 0.2, 0.3],
        index: 0,
      });
    });

    it("transforms object with embedding array into OpenAI format", () => {
      const singleObj = {
        embedding: [0.7, 0.8, 0.9],
        model: "custom-embed",
      };

      const result = openAiEmbeddingsTransformer.transformWireToClient(
        singleObj,
        dummyDirective
      ) as OpenAIEmbeddingResponse;

      expect(result.object).toBe("list");
      expect(result.model).toBe("custom-embed");
      expect(result.data).toHaveLength(1);
      expect(result.data![0]).toEqual({
        object: "embedding",
        embedding: [0.7, 0.8, 0.9],
        index: 0,
      });
    });

    it("passes through upstream errors unmodified", () => {
      const upstreamError = {
        error: { message: "Internal server error", type: "api_error" },
      };

      const result = openAiEmbeddingsTransformer.transformWireToClient(
        upstreamError,
        dummyDirective
      );
      expect(result).toEqual(upstreamError);
    });
  });

  describe("createWireToClientStream", () => {
    it("returns a passthrough TransformStream", async () => {
      const mockTelemetry = {} as RequestTelemetry;
      const abortCtrl = new AbortController();
      const stream = openAiEmbeddingsTransformer.createWireToClientStream(
        dummyDirective,
        mockTelemetry,
        abortCtrl.signal
      );

      const writer = stream.writable.getWriter();
      const reader = stream.readable.getReader();
      const testChunk = new Uint8Array([1, 2, 3]);

      const writePromise = (async () => {
        await writer.write(testChunk);
        await writer.close();
      })();

      const readPromise = (async () => {
        const { value, done } = await reader.read();
        expect(done).toBe(false);
        expect(value).toEqual(testChunk);
        const next = await reader.read();
        expect(next.done).toBe(true);
      })();

      await Promise.all([writePromise, readPromise]);
    });
  });

  describe("isMultiInputBatch helper", () => {
    it("distinguishes multi-document batches from single documents and token IDs", () => {
      expect(isMultiInputBatch("single string")).toBe(false);
      expect(isMultiInputBatch(["doc1", "doc2"])).toBe(true);
      expect(isMultiInputBatch([101, 2054, 102])).toBe(false); // Token IDs for 1 doc
      expect(isMultiInputBatch([[101, 2054], [101, 2055]])).toBe(true); // 2 docs of token IDs
      expect(isMultiInputBatch([])).toBe(false);
      expect(isMultiInputBatch(null)).toBe(false);
      expect(isMultiInputBatch(123)).toBe(false);
    });
  });

  describe("sliceEmbeddingInput helper", () => {
    it("slices input arrays larger than batch size", () => {
      const items = Array.from({ length: 16 }, (_, i) => `item_${i}`);
      const chunks = sliceEmbeddingInput(items, 8);

      expect(chunks).toHaveLength(2);
      expect(chunks[0]).toHaveLength(8);
      expect(chunks[1]).toHaveLength(8);
      expect(chunks[0]![0]).toBe("item_0");
      expect(chunks[1]![0]).toBe("item_8");
    });

    it("does not slice input with length <= batch size", () => {
      const items = ["a", "b", "c"];
      const chunks = sliceEmbeddingInput(items, 8);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toEqual(items);
    });
  });

  describe("mergeEmbeddingResponses helper", () => {
    it("stitches sequential indices and aggregates token usage across chunks", () => {
      const chunk1: OpenAIEmbeddingResponse = {
        object: "list",
        data: [
          { object: "embedding", embedding: [0.1, 0.2], index: 0 },
          { object: "embedding", embedding: [0.3, 0.4], index: 1 },
        ],
        model: "BAAI/bge-m3",
        usage: { prompt_tokens: 10, total_tokens: 10 },
      };

      const chunk2: OpenAIEmbeddingResponse = {
        object: "list",
        data: [
          { object: "embedding", embedding: [0.5, 0.6], index: 0 },
          { object: "embedding", embedding: [0.7, 0.8], index: 1 },
        ],
        model: "BAAI/bge-m3",
        usage: { prompt_tokens: 12, total_tokens: 12 },
      };

      const merged = mergeEmbeddingResponses([chunk1, chunk2]);

      expect(merged.object).toBe("list");
      expect(merged.model).toBe("BAAI/bge-m3");
      expect(merged.data).toHaveLength(4);
      expect(merged.data![0]!.index).toBe(0);
      expect(merged.data![1]!.index).toBe(1);
      expect(merged.data![2]!.index).toBe(2);
      expect(merged.data![3]!.index).toBe(3);
      expect(merged.data![2]!.embedding).toEqual([0.5, 0.6]);
      expect(merged.data![3]!.embedding).toEqual([0.7, 0.8]);
      expect(merged.usage).toEqual({
        prompt_tokens: 22,
        total_tokens: 22,
      });
    });
  });
});
