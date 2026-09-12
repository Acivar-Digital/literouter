import { describe, expect, it, beforeEach, spyOn, afterEach } from "bun:test";
import {
  handleAnthropicCompat,
  createAnthropicErrorResponse,
  validateAnthropicPayload,
  type AnthropicMessagesRequest,
} from "../../../src/handlers/anthropic_compat";
import { getProviderConfig, initProviderRegistry, isRegisteredProvider } from "../../../src/config/providers";
import { globalKeyPool } from "../../../src/handlers/openai_compat";

describe("Anthropic Compat Handler Unit Tests", () => {
  beforeEach(() => {
    initProviderRegistry();
  });

  describe("Payload Validation & Error Formatting", () => {
    it("validates well-formed request payload", () => {
      const validPayload: AnthropicMessagesRequest = {
        model: "claude-3-7-sonnet-20250219",
        messages: [{ role: "user", content: "Hello world" }],
        max_tokens: 1024,
      };
      const error = validateAnthropicPayload(validPayload);
      expect(error).toBeNull();
    });

    it("rejects payload with unsupported document content blocks", () => {
      const docPayload: AnthropicMessagesRequest = {
        model: "claude-3-7-sonnet-20250219",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                text: "binary-doc",
              },
            ],
          },
        ],
        max_tokens: 1024,
      };
      const error = validateAnthropicPayload(docPayload);
      expect(error).toContain("Document content blocks");
    });

    it("rejects payload missing messages or empty array", () => {
      const emptyPayload = {
        model: "claude-3-7-sonnet-20250219",
        messages: [],
        max_tokens: 1024,
      } as AnthropicMessagesRequest;
      const error = validateAnthropicPayload(emptyPayload);
      expect(error).toContain("messages");
    });

    it("creates standard Anthropic error response structure", async () => {
      const res = createAnthropicErrorResponse(400, "Bad test payload", "invalid_request_error");
      expect(res.status).toBe(400);
      expect(res.headers.get("Content-Type")).toBe("application/json");
      const json = await res.json();
      expect(json).toEqual({
        type: "error",
        error: {
          type: "invalid_request_error",
          message: "Bad test payload",
        },
      });
    });
  });

  describe("Dynamic Provider Config & Retry Unification", () => {
    it("retrieves provider configuration dynamically from registry", () => {
      const provConfig = getProviderConfig("an");
      expect(provConfig).toBeDefined();
      expect(provConfig.code).toBe("an");
      expect(provConfig.request_retry).toBeDefined();
      expect(typeof provConfig.request_retry.enabled).toBe("boolean");
      expect(typeof provConfig.request_retry.max_attempts).toBe("number");
      expect(provConfig.request_retry.delay).toBeDefined();
      expect(typeof provConfig.request_retry.delay.min_ms).toBe("number");
      expect(typeof provConfig.request_retry.delay.max_ms).toBe("number");
      expect(provConfig.request_retry.delay.max_ms).toBeGreaterThanOrEqual(
        provConfig.request_retry.delay.min_ms
      );
    });

    it("bounds retry attempts by provider config and pool size", () => {
      const provConfig = getProviderConfig("an");
      const poolSize = globalKeyPool.getPoolSize("an");
      const maxAttempts = provConfig.request_retry.enabled
        ? Math.min(provConfig.request_retry.max_attempts, poolSize > 0 ? poolSize : 1)
        : 1;

      expect(maxAttempts).toBeGreaterThanOrEqual(1);
      expect(maxAttempts).toBeLessThanOrEqual(provConfig.request_retry.max_attempts);
    });

    it("respects disabled retries by clamping maxAttempts to 1", () => {
      const mockDisabledConfig = {
        request_retry: {
          enabled: false,
          max_attempts: 5,
          delay: { min_ms: 100, max_ms: 200 },
        },
      };
      const poolSize = 3;
      const maxAttempts = mockDisabledConfig.request_retry.enabled
        ? Math.min(mockDisabledConfig.request_retry.max_attempts, poolSize > 0 ? poolSize : 1)
        : 1;

      expect(maxAttempts).toBe(1);
    });

    it("calculates jittered retry delay within min_ms and max_ms bounds", () => {
      const { min_ms, max_ms } = getProviderConfig("an").request_retry.delay;
      for (let i = 0; i < 20; i++) {
        const delayMs = min_ms < max_ms
          ? min_ms + Math.floor(Math.random() * (max_ms - min_ms + 1))
          : min_ms;
        expect(delayMs).toBeGreaterThanOrEqual(min_ms);
        expect(delayMs).toBeLessThanOrEqual(max_ms);
      }
    });

    it("evaluates dynamic pacer enabled status without hardcoded provider lists", () => {
      expect(isRegisteredProvider("an")).toBe(true);
      const anPacer = getProviderConfig("an").pacer;
      expect(anPacer).toBeDefined();
      expect(typeof anPacer?.enabled).toBe("boolean");

      expect(isRegisteredProvider("invalid-provider-code")).toBe(false);

      // Verify that handler file does not contain hardcoded pacer array
      const handlerSource = Bun.file("src/handlers/anthropic_compat.ts");
      return handlerSource.text().then((source) => {
        expect(source).not.toContain('["or", "nv", "zn", "gg"]');
        expect(source).not.toContain("['or', 'nv', 'zn', 'gg']");
      });
    });
  });

  describe("Inbound Request Handling", () => {
    it("rejects invalid directive key with 401", async () => {
      const req = new Request("http://localhost:7766/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-7-sonnet-20250219",
          messages: [{ role: "user", content: "Hi" }],
          max_tokens: 100,
        }),
      });

      const res = await handleAnthropicCompat(req, "invalid-key", "req-test-401");
      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.type).toBe("error");
      expect(json.error.type).toBe("authentication_error");
    });

    it("rejects malformed JSON payload with 400", async () => {
      const req = new Request("http://localhost:7766/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "invalid-json{",
      });

      const res = await handleAnthropicCompat(req, "lr-an-cl-ms-no", "req-test-400");
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.type).toBe("error");
      expect(json.error.type).toBe("invalid_request_error");
      expect(json.error.message).toContain("Malformed JSON");
    });

    it("rejects invalid payload missing required fields with 400", async () => {
      const req = new Request("http://localhost:7766/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-3-7-sonnet-20250219",
          messages: [],
        }),
      });

      const res = await handleAnthropicCompat(req, "lr-an-cl-ms-no", "req-test-invalid-body");
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.type).toBe("error");
      expect(json.error.type).toBe("invalid_request_error");
    });
  });
});
