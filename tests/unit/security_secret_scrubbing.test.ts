import { describe, expect, it } from "bun:test";
import { sanitizeBody, SECRET_REGEX } from "../../src/telemetry/sanitize";
import { createCleanErrorResponse } from "../../src/engine/dispatch";

describe("Step 4: Secret Regex Expansion & Upstream Error Redaction", () => {
  describe("Expanded SECRET_REGEX & sanitizeBody", () => {
    it("scrubs Anthropic keys", () => {
      const text = "Error contacting upstream with key sk-ant-api03-test-stub-1234567890abcdef123456 in body";
      expect(sanitizeBody(text)).not.toContain("sk-ant-api03");
      expect(sanitizeBody(text)).toContain("[REDACTED_KEY]");
    });

    it("scrubs OpenAI project/service keys", () => {
      const text = "Failed auth for sk-proj-test-stub-1234567890abcdef12345";
      expect(sanitizeBody(text)).not.toContain("sk-proj-");
      expect(sanitizeBody(text)).toContain("[REDACTED_KEY]");
    });

    it("scrubs Groq and Cerebras keys", () => {
      const text = "Groq: gsk_test_stub_123456789012345 and Cerebras: csk-test-stub-123456789012345";
      expect(sanitizeBody(text)).not.toContain("gsk_");
      expect(sanitizeBody(text)).not.toContain("csk-");
      expect(sanitizeBody(text)).toBe("Groq: [REDACTED_KEY] and Cerebras: [REDACTED_KEY]");
    });

    it("scrubs NVIDIA and Google keys", () => {
      const text = "nvapi-test-stub-1234567890abcdef1234567890ab and AIzaSyD-test-stub-1234567890abcdef12345";
      expect(sanitizeBody(text)).not.toContain("nvapi-");
      expect(sanitizeBody(text)).not.toContain("AIzaSy");
    });

    it("scrubs URL query parameters containing keys or tokens", () => {
      const text = "Failed request to https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyD-test-stub-secretKey123&other=ok";
      expect(sanitizeBody(text)).not.toContain("AIzaSyD-test-stub-secretKey123");
      expect(sanitizeBody(text)).toContain("[REDACTED_KEY]");
    });
  });

  describe("createCleanErrorResponse", () => {
    it("redacts sensitive keys in error body and strips sensitive upstream headers", async () => {
      const upstreamHeaders = new Headers({
        "content-type": "application/json",
        "retry-after": "5",
        "x-request-id": "req-err-456",
        "set-cookie": "session=secret-leak",
        server: "cloudflare",
        "cf-ray": "8937123987123-SJC",
        "content-encoding": "gzip",
      });

      const rawUpstreamResponse = new Response(null, {
        status: 401,
        statusText: "Unauthorized",
        headers: upstreamHeaders,
      });

      const errText = JSON.stringify({
        error: {
          message: "Authentication failure with token sk-ant-api03-test-stub-12345678901234567890",
          code: "invalid_api_key",
        },
      });

      const cleanRes = createCleanErrorResponse(rawUpstreamResponse, errText);
      expect(cleanRes.status).toBe(401);

      // Safe headers retained
      expect(cleanRes.headers.get("content-type")).toBe("application/json");
      expect(cleanRes.headers.get("retry-after")).toBe("5");
      expect(cleanRes.headers.get("x-request-id")).toBe("req-err-456");

      // Sensitive headers stripped
      expect(cleanRes.headers.get("set-cookie")).toBeNull();
      expect(cleanRes.headers.get("server")).toBeNull();
      expect(cleanRes.headers.get("cf-ray")).toBeNull();
      expect(cleanRes.headers.get("content-encoding")).toBeNull();

      // Body sanitized
      const bodyText = await cleanRes.text();
      expect(bodyText).not.toContain("sk-ant-api03");
      expect(bodyText).toContain("[REDACTED_KEY]");
    });
  });
});
