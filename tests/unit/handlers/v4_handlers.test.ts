import { describe, expect, it, beforeEach } from "bun:test";
import { handleOpenAiChat } from "../../../src/handlers/v4/openai_chat";
import { handleAnthropicMessages } from "../../../src/handlers/v4/anthropic_messages";
import { handleGoogleNative } from "../../../src/handlers/v4/google_native";
import { handleOpenAiResponses } from "../../../src/handlers/v4/openai_responses";
import { handleGcpCompat } from "../../../src/handlers/v4/gcp_compat";
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
});
