import { describe, expect, test } from "bun:test";
import { openAiEmbeddingsTransformer, DEFAULT_EMBEDDING_BATCH_SIZE } from "../../src/transformers/openai_embeddings";
import { handleV4OpenAIEmbeddings, DEFAULT_EMBEDDING_DIRECTIVE } from "../../src/handlers/v4/openai_embeddings";
import { parseDirectiveKey } from "../../src/directive/parser";
import { EMBEDDINGS_PATHS } from "../../src/handlers/v4/router";
import { validateEndpointMatch, handleAppRequest } from "../../src/index";
import { globalCooldownManager, globalKeyPool } from "../../src/handlers/openai_compat";
import { executeDispatchPipeline, type DispatchRequest } from "../../src/engine/dispatch";
import { resetEnvCache } from "../../src/config/env";

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

  test("DEFAULT_EMBEDDING_DIRECTIVE is lr-fse-embeddings", () => {
    expect(DEFAULT_EMBEDDING_DIRECTIVE).toBe("lr-fse-embeddings");
    const parsed = parseDirectiveKey(DEFAULT_EMBEDDING_DIRECTIVE);
    expect(parsed?.type).toBe("fusion");
    if (parsed?.type === "fusion") {
      expect(parsed.preset).toBe("embeddings");
    }
  });

  test("handleAppRequest defaults unauthenticated /v1/embeddings to lr-fse-embeddings and executes dual-tier fusion", async () => {
    const prevEngine = process.env.LITEROUTER_ENGINE;
    process.env.LITEROUTER_ENGINE = "v4.1";
    resetEnvCache();
    globalCooldownManager.clearAll();
    globalKeyPool.reset();
    const originalFetch = globalThis.fetch;
    const requestedUrls: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requestedUrls.push(url);
      // Simulate Tier 1 (http://tei-wsl.lan:8002) connection error
      if (url.includes("tei-wsl.lan")) {
        throw new Error("Unable to connect to tei-wsl.lan:8002");
      }
      // Tier 2 (http://127.0.0.1:8002) succeeds
      if (url.includes("127.0.0.1:8002")) {
        return new Response(
          JSON.stringify([
            [0.11, 0.22, 0.33]
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return new Response("Not Found", { status: 404 });
    }) as any;

    try {
      globalKeyPool.setPool("tei", ["mock-tei-key"]);
      globalKeyPool.setPool("teivps", ["mock-teivps-key"]);

      const req = new Request("http://localhost:7766/v1/embeddings", {
        method: "POST",
        body: JSON.stringify({ input: "failover test query" }),
        headers: { "content-type": "application/json" },
      });

      const res = await handleAppRequest(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.object).toBe("list");
      expect(json.data[0]?.embedding).toEqual([0.11, 0.22, 0.33]);
      // Verified Tier 1 was attempted first, then Tier 2
      expect(requestedUrls.some((u) => u.includes("tei-wsl.lan:8002"))).toBe(true);
      expect(requestedUrls.some((u) => u.includes("127.0.0.1:8002"))).toBe(true);
    } finally {
      process.env.LITEROUTER_ENGINE = prevEngine;
      resetEnvCache();
      globalThis.fetch = originalFetch;
    }
  });

  test("executeDispatchPipeline returns structured 502 with code retries_exhausted when all retries fail", async () => {
    globalCooldownManager.clearAll();
    globalKeyPool.reset();
    globalKeyPool.setPool("tei", ["mock-tei-key"]);
    const directive = parseDirectiveKey("lr-tei-oa-em-no")!;
    const outboundPayload = openAiEmbeddingsTransformer.transformClientToWire(
      { input: "retry exhaust test" },
      directive,
      new Headers()
    );

    const dispatchReq: DispatchRequest = {
      reqId: "test-exhaust-502",
      method: "POST",
      path: "/v1/embeddings",
      directive,
      rawInboundBody: { input: "retry exhaust test" },
      outboundPayload,
      clientSignal: new AbortController().signal,
      clientHeaders: new Headers(),
      transformer: openAiEmbeddingsTransformer,
    };

    const fetchFn = async () => {
      throw new Error("Connection refused: 192.168.50.199:8002");
    };

    const res = await executeDispatchPipeline(dispatchReq, fetchFn);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error.type).toBe("gateway_error");
    expect(body.error.code).toBe("retries_exhausted");
    expect(body.error.message).toContain("retry attempts exhausted");
  });

  test("handleOpenAiEmbeddings catches unexpected synchronous dispatch failure and returns 502 error boundary", async () => {
    globalCooldownManager.clearAll();
    globalKeyPool.reset();
    globalKeyPool.setPool("tei", ["mock-tei-key"]);
    const req = new Request("http://localhost:7766/v1/embeddings", {
      method: "POST",
      body: JSON.stringify({ input: "boundary test" }),
      headers: { "content-type": "application/json" },
    });

    // Intentionally pass an invalid directive that bypasses validation or causes internal error
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new TypeError("Uncaught native buffer error");
    }) as any;

    try {
      const res = await handleV4OpenAIEmbeddings(req, "lr-tei-oa-em-no", "test-boundary-id");
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error.type).toBe("gateway_error");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
