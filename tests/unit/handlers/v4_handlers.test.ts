import { describe, expect, it, beforeEach } from "bun:test";
import { handleOpenAiChat } from "../../../src/handlers/v4/openai_chat";
import { handleAnthropicMessages } from "../../../src/handlers/v4/anthropic_messages";
import { handleGoogleNative } from "../../../src/handlers/v4/google_native";
import { handleOpenAiResponses } from "../../../src/handlers/v4/openai_responses";
import { handleGcpCompat } from "../../../src/handlers/v4/gcp_compat";
import { handleV4OpenAIEmbeddings } from "../../../src/handlers/v4/openai_embeddings";
import { initProviderRegistry } from "../../../src/config/providers";
import { initStrategyRegistry } from "../../../src/engine/strategy_registry";
import { globalKeyPool } from "../../../src/handlers/openai_compat";

describe("v4 thin route handlers", () => {
  beforeEach(() => {
    initProviderRegistry();
    initStrategyRegistry();
  });

  describe("openai_chat handler", () => {
    it("rejects invalid json with 400", async () => {
      const req = new Request("http://localhost:7766/v1/chat/completions", {
        method: "POST",
        body: "invalid-json{",
        headers: { "content-type": "application/json" },
      });
      const res = await handleOpenAiChat(req, "lr-or-oa-ch-no");
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Invalid JSON");
    });

    it("rejects invalid directive with 400", async () => {
      const req = new Request("http://localhost:7766/v1/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "test" }),
        headers: { "content-type": "application/json" },
      });
      const res = await handleOpenAiChat(req, "invalid-directive");
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Invalid directive");
    });
  });

  describe("anthropic_messages handler", () => {
    it("rejects invalid json with 400", async () => {
      const req = new Request("http://localhost:7766/v1/messages", {
        method: "POST",
        body: "{malformed",
        headers: { "content-type": "application/json" },
      });
      const res = await handleAnthropicMessages(req, "lr-an-cl-ms-no");
      expect(res.status).toBe(400);
    });

    it("rejects invalid directive with 400", async () => {
      const req = new Request("http://localhost:7766/v1/messages", {
        method: "POST",
        body: JSON.stringify({ messages: [] }),
      });
      const res = await handleAnthropicMessages(req, "not-a-directive");
      expect(res.status).toBe(400);
    });
  });

  describe("google_native handler", () => {
    it("rejects invalid json with 400", async () => {
      const req = new Request("http://localhost:7766/v1beta/models/gemini-pro:generateContent", {
        method: "POST",
        body: "{bad",
      });
      const res = await handleGoogleNative(req, "lr-gg-gg-gc-no");
      expect(res.status).toBe(400);
    });

    it("rejects invalid directive with 400", async () => {
      const req = new Request("http://localhost:7766/v1beta/models/gemini-pro:generateContent", {
        method: "POST",
        body: JSON.stringify({ contents: [] }),
      });
      const res = await handleGoogleNative(req, "lr-bad");
      expect(res.status).toBe(400);
    });

    it("extracts model from pathname when body.model is missing", async () => {
      const originalFetch = globalThis.fetch;
      let upstreamUrl = "";
      globalThis.fetch = (async (input: string | URL | Request) => {
        upstreamUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        return new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as any;

      try {
        globalKeyPool.setPool("gg", ["AIzaSyDummyKey12345678901234567890"]);
        const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent", {
          method: "POST",
          body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] }),
          headers: { "content-type": "application/json" },
        });
        const res = await handleGoogleNative(req, "lr-gg-gg-gc-no");
        expect(res.status).toBe(200);
        expect(upstreamUrl).toContain("/models/gemini-2.5-flash:generateContent");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("preserves :streamGenerateContent action in upstream URL", async () => {
      const originalFetch = globalThis.fetch;
      let upstreamUrl = "";
      globalThis.fetch = (async (input: string | URL | Request) => {
        upstreamUrl = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        return new Response(JSON.stringify({ candidates: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as any;

      try {
        globalKeyPool.setPool("gg", ["AIzaSyDummyKey12345678901234567890"]);
        const req = new Request("http://localhost:7766/v1beta/models/gemini-2.5-flash:streamGenerateContent", {
          method: "POST",
          body: JSON.stringify({ contents: [{ parts: [{ text: "hi" }] }] }),
          headers: { "content-type": "application/json" },
        });
        const res = await handleGoogleNative(req, "lr-gg-gg-gc-no");
        expect(res.status).toBe(200);
        expect(upstreamUrl).toContain("/models/gemini-2.5-flash:streamGenerateContent");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("openai_responses handler", () => {
    it("rejects invalid json with 400", async () => {
      const req = new Request("http://localhost:7766/v1/responses", {
        method: "POST",
        body: "bad json",
      });
      const res = await handleOpenAiResponses(req, "lr-oa-oo-rs-no");
      expect(res.status).toBe(400);
    });

    it("rejects invalid directive with 400", async () => {
      const req = new Request("http://localhost:7766/v1/responses", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-4o" }),
      });
      const res = await handleOpenAiResponses(req, "bad-key");
      expect(res.status).toBe(400);
    });
  });

  describe("gcp_compat handler", () => {
    it("rejects invalid json with 400", async () => {
      const req = new Request("http://localhost:7766/v1beta/openai/chat/completions", {
        method: "POST",
        body: "bad",
      });
      const res = await handleGcpCompat(req, "lr-gc-oa-ch-no");
      expect(res.status).toBe(400);
    });

    it("rejects invalid directive with 400", async () => {
      const req = new Request("http://localhost:7766/v1beta/openai/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "gemma-2-9b-it" }),
      });
      const res = await handleGcpCompat(req, "bad-directive");
      expect(res.status).toBe(400);
    });

    it("rejects non-gemma model via GcpGuardedStrategy inside executeDispatchPipeline", async () => {
      const req = new Request("http://localhost:7766/v1beta/openai/chat/completions", {
        method: "POST",
        body: JSON.stringify({ model: "gpt-4o" }),
      });
      const res = await handleGcpCompat(req, "lr-gc-oa-ch-no");
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("billing_guardrail_violation");
    });
  });

  describe("openai_embeddings handler", () => {
    it("rejects invalid json with 400", async () => {
      const req = new Request("http://localhost:7766/v1/embeddings", {
        method: "POST",
        body: "{malformed json",
      });
      const res = await handleV4OpenAIEmbeddings(req, "lr-tei-oa-em-no");
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Invalid JSON");
    });

    it("rejects invalid directive with 400", async () => {
      const req = new Request("http://localhost:7766/v1/embeddings", {
        method: "POST",
        body: JSON.stringify({ input: "test" }),
      });
      const res = await handleV4OpenAIEmbeddings(req, "invalid-key");
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Invalid directive");
    });

    it("rejects non-embeddings directive with 400 endpoint mismatch", async () => {
      const req = new Request("http://localhost:7766/v1/embeddings", {
        method: "POST",
        body: JSON.stringify({ input: "test" }),
      });
      const res = await handleV4OpenAIEmbeddings(req, "lr-tei-oa-ch-no");
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Endpoint mismatch");
    });

    it("defaults empty rawKey to lr-tei-oa-em-no for ambient auth", async () => {
      const originalFetch = globalThis.fetch;
      let capturedBody: Record<string, unknown> = {};
      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            object: "list",
            data: [{ object: "embedding", embedding: [0.1, 0.2], index: 0 }],
            model: "BAAI/bge-m3",
            usage: { prompt_tokens: 4, total_tokens: 4 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as any;

      try {
        globalKeyPool.setPool("tei", ["dummy-tei-key"]);
        const req = new Request("http://localhost:7766/v1/embeddings", {
          method: "POST",
          body: JSON.stringify({ input: "ambient test query" }),
          headers: { "content-type": "application/json" },
        });
        const res = await handleV4OpenAIEmbeddings(req, "");
        expect(res.status).toBe(200);
        expect(capturedBody.input).toBe("ambient test query");
        expect(capturedBody.model).toBe("BAAI/bge-m3");
        const json = await res.json();
        expect(json.object).toBe("list");
        expect(json.data).toHaveLength(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("slices large batch (> 8 inputs) into chunks, stitches sequential indices, and sums usage", async () => {
      const originalFetch = globalThis.fetch;
      const fetchedBodies: Record<string, unknown>[] = [];
      globalThis.fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
        const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
        fetchedBodies.push(parsed);
        const inputArray = parsed.input as string[];
        return new Response(
          JSON.stringify({
            object: "list",
            data: inputArray.map((_, i) => ({
              object: "embedding",
              embedding: [i * 0.1, i * 0.2],
              index: i,
            })),
            model: "BAAI/bge-m3",
            usage: { prompt_tokens: inputArray.length * 2, total_tokens: inputArray.length * 2 },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }) as any;

      try {
        globalKeyPool.setPool("tei", ["dummy-tei-key"]);
        // 16 items: should slice into two chunks of 8
        const inputs = Array.from({ length: 16 }, (_, i) => `doc_${i}`);
        const req = new Request("http://localhost:7766/v1/embeddings", {
          method: "POST",
          body: JSON.stringify({ input: inputs }),
          headers: { "content-type": "application/json" },
        });
        const res = await handleV4OpenAIEmbeddings(req, "lr-tei-oa-em-no");
        expect(res.status).toBe(200);
        expect(fetchedBodies).toHaveLength(2);
        expect((fetchedBodies[0]!.input as string[])).toHaveLength(8);
        expect((fetchedBodies[1]!.input as string[])).toHaveLength(8);

        const json = await res.json();
        expect(json.object).toBe("list");
        expect(json.data).toHaveLength(16);
        // Verify indices stitched 0..15
        for (let i = 0; i < 16; i++) {
          expect(json.data[i].index).toBe(i);
        }
        // Total prompt tokens: 16 * 2 = 32
        expect(json.usage.prompt_tokens).toBe(32);
        expect(json.usage.total_tokens).toBe(32);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
