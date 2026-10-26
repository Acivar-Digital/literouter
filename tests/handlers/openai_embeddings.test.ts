import { describe, expect, test } from "bun:test";
import { openAiEmbeddingsTransformer, DEFAULT_EMBEDDING_BATCH_SIZE } from "../../src/transformers/openai_embeddings";
import { handleV4OpenAIEmbeddings } from "../../src/handlers/v4/openai_embeddings";
import { parseDirectiveKey } from "../../src/directive/parser";
import { EMBEDDINGS_PATHS } from "../../src/handlers/v4/router";
import { validateEndpointMatch } from "../../src/index";

describe("OpenAI Embeddings Transformer & Handler", () => {
  test("EMBEDDINGS_PATHS contains standard endpoints", () => {
    expect(EMBEDDINGS_PATHS.has("/v1/embeddings")).toBe(true);
    expect(EMBEDDINGS_PATHS.has("/embeddings")).toBe(true);
    expect(EMBEDDINGS_PATHS.has("/api/v1/embeddings")).toBe(true);
  });

  test("validateEndpointMatch enforces -em- directive on /v1/embeddings", () => {
    const chDirective = parseDirectiveKey("lr-tei-oa-ch-no") as { readonly endpoint?: string };
    const emDirective = parseDirectiveKey("lr-tei-oa-em-no") as { readonly endpoint?: string };

    // Chat directive to embeddings endpoint should fail
    const mismatch1 = validateEndpointMatch("/v1/embeddings", chDirective);
    expect(mismatch1).not.toBeNull();
    expect(mismatch1?.status).toBe(400);

    // Embeddings directive to chat endpoint should fail
    const mismatch2 = validateEndpointMatch("/v1/chat/completions", emDirective);
    expect(mismatch2).not.toBeNull();
    expect(mismatch2?.status).toBe(400);

    // Embeddings directive to embeddings endpoint should pass
    const match = validateEndpointMatch("/v1/embeddings", emDirective);
    expect(match).toBeNull();
  });

  test("openAiEmbeddingsTransformer transforms single string input", () => {
    const directive = parseDirectiveKey("lr-tei-oa-em-no")!;
    const wire = openAiEmbeddingsTransformer.transformClientToWire(
      { input: "hello world" },
      directive,
      new Headers({ "user-agent": "test-agent" })
    );

    expect(wire.endpointKey).toBe("em");
    expect(wire.method).toBe("POST");
    expect(wire.isStreaming).toBe(false);
    expect(wire.body.input).toBe("hello world");
    expect(wire.body.model).toBe("BAAI/bge-m3");
  });

  test("openAiEmbeddingsTransformer transforms and normalizes array input", () => {
    const directive = parseDirectiveKey("lr-tei-oa-em-no")!;
    const wire = openAiEmbeddingsTransformer.transformClientToWire(
      { input: ["doc1", "doc2"], model: "custom-embed" },
      directive,
      new Headers()
    );

    expect(wire.body.input).toEqual(["doc1", "doc2"]);
    expect(wire.body.model).toBe("custom-embed");
  });

  test("openAiEmbeddingsTransformer transforms raw upstream vector array to OpenAI format", () => {
    const directive = parseDirectiveKey("lr-tei-oa-em-no")!;
    const rawVectors = [
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ];

    const clientRes = openAiEmbeddingsTransformer.transformWireToClient(rawVectors, directive) as { object: string; data: Array<{ index: number; embedding: number[] }> };
    expect(clientRes.object).toBe("list");
    expect(clientRes.data.length).toBe(2);
    expect(clientRes.data[0]?.index).toBe(0);
    expect(clientRes.data[0]?.embedding).toEqual([0.1, 0.2, 0.3]);
    expect(clientRes.data[1]?.index).toBe(1);
    expect(clientRes.data[1]?.embedding).toEqual([0.4, 0.5, 0.6]);
  });

  test("handleV4OpenAIEmbeddings rejects invalid JSON with 400", async () => {
    const req = new Request("http://localhost:7766/v1/embeddings", {
      method: "POST",
      body: "{ invalid json ",
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleV4OpenAIEmbeddings(req, "lr-tei-oa-em-no", "test-req-id");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("Invalid JSON");
  });

  test("handleV4OpenAIEmbeddings rejects non-embeddings directive with 400", async () => {
    const req = new Request("http://localhost:7766/v1/embeddings", {
      method: "POST",
      body: JSON.stringify({ input: "test" }),
      headers: { "Content-Type": "application/json" },
    });

    const res = await handleV4OpenAIEmbeddings(req, "lr-tei-oa-ch-no", "test-req-id");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.message).toContain("Endpoint mismatch");
  });
});
