import { describe, expect, it } from "bun:test";
import {
  dispatchRoute,
  handleAppRequest,
  validateEndpointMatch,
} from "../../src/index";

describe("Endpoint Fail-Fast Guards & Route Dispatch (literouter-52gt)", () => {
  describe("validateEndpointMatch helper", () => {
    it("returns 400 when /v1/chat/completions receives directive with endpoint 'rs'", async () => {
      const res = validateEndpointMatch("/v1/chat/completions", { endpoint: "rs" });
      expect(res).not.toBeNull();
      expect(res!.status).toBe(400);
      expect(res!.headers.get("Content-Type")).toBe("application/json");

      const body = await res!.json();
      expect(body).toEqual({
        error: {
          message: "Endpoint mismatch: Directive specifies Responses API (-rs-). Use /v1/responses.",
          type: "invalid_request_error",
        },
      });
    });

    it("returns 400 when /v1/responses receives directive with endpoint 'ch'", async () => {
      const res = validateEndpointMatch("/v1/responses", { endpoint: "ch" });
      expect(res).not.toBeNull();
      expect(res!.status).toBe(400);
      expect(res!.headers.get("Content-Type")).toBe("application/json");

      const body = await res!.json();
      expect(body).toEqual({
        error: {
          message: "Endpoint mismatch: Directive specifies Chat Completions (-ch-). Use /v1/chat/completions.",
          type: "invalid_request_error",
        },
      });
    });

    it("returns null when /v1/chat/completions receives directive with endpoint 'ch'", () => {
      const res = validateEndpointMatch("/v1/chat/completions", { endpoint: "ch" });
      expect(res).toBeNull();
    });

    it("returns null when /v1/responses receives directive with endpoint 'rs'", () => {
      const res = validateEndpointMatch("/v1/responses", { endpoint: "rs" });
      expect(res).toBeNull();
    });

    it("returns null for non-matching paths or missing endpoint", () => {
      expect(validateEndpointMatch("/v1/messages", { endpoint: "ms" })).toBeNull();
      expect(validateEndpointMatch("/v1/responses", null)).toBeNull();
      expect(validateEndpointMatch("/v1/responses", undefined)).toBeNull();
      expect(validateEndpointMatch("/v1/chat/completions", {})).toBeNull();
    });
  });

  describe("dispatchRoute fail-fast integration", () => {
    it("returns 400 when POST /v1/chat/completions is called with -rs- directive", async () => {
      const req = new Request("http://localhost:7766/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer lr-zn-oo-rs-no",
        },
        body: JSON.stringify({ model: "muse-spark-1.3", messages: [{ role: "user", content: "hi" }] }),
      });

      const res = await dispatchRoute(req, "lr-zn-oo-rs-no", "req_test_rs_mismatch");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toBe(
        "Endpoint mismatch: Directive specifies Responses API (-rs-). Use /v1/responses."
      );
      expect(data.error.type).toBe("invalid_request_error");
    });

    it("returns 400 when POST /v1/responses is called with -ch- directive", async () => {
      const req = new Request("http://localhost:7766/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer lr-zn-oa-ch-no",
        },
        body: JSON.stringify({ model: "muse-spark-1.3", input: "hi" }),
      });

      const res = await dispatchRoute(req, "lr-zn-oa-ch-no", "req_test_ch_mismatch");
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toBe(
        "Endpoint mismatch: Directive specifies Chat Completions (-ch-). Use /v1/chat/completions."
      );
      expect(data.error.type).toBe("invalid_request_error");
    });

    it("routes POST /v1/responses to handleOpenAiOriginal", async () => {
      const req = new Request("http://localhost:7766/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer lr-zn-oo-rs-no",
        },
        body: JSON.stringify({ model: "muse-spark-1.3", input: "hi" }),
      });

      // Providing a state with a mock key pool manager so handleOpenAiOriginal attempts upstream fetch
      const mockState = {
        keyPoolManager: {
          selectNextKey: () => ({ key: "mock-test-key", index: 0 }),
        },
      };

      // Mock global fetch to simulate upstream Responses API
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async (url: string | URL | Request) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        expect(urlStr).toBe("https://opencode.ai/zen/v1/responses");
        return new Response(JSON.stringify({ id: "resp_123", output_text: "hello world" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof globalThis.fetch;

      try {
        const res = await dispatchRoute(req, "lr-zn-oo-rs-no", "req_test_responses_ok", mockState);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data.id).toBe("resp_123");
        expect(data.output_text).toBe("hello world");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("handleAppRequest fail-fast integration", () => {
    it("fails fast on handleAppRequest for endpoint mismatch", async () => {
      const req = new Request("http://localhost:7766/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer lr-or-oo-rs-no",
        },
        body: JSON.stringify({ model: "gpt-4o", messages: [] }),
      });

      const res = await handleAppRequest(req);
      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.message).toContain("Responses API (-rs-). Use /v1/responses.");
    });
  });
});
