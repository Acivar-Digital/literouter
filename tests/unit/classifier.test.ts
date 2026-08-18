import { describe, expect, it } from "bun:test";
import {
  classifyUpstreamError,
  type UpstreamErrorInfo,
  type ErrorClassification,
} from "../../src/network/classifier";

describe("Error Classifier — classifyUpstreamError", () => {
  describe("HTTP 400 - Provider-side retryable vs client-side fail-fast", () => {
    it("classifies 'Provider returned error' as retry_rotate with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 400,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "Provider returned error: upstream timeout" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.reason).toBeDefined();
    });

    it("classifies 'No available provider' as retry_rotate with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "or",
        status: 400,
        headers: {},
        bodyText: JSON.stringify({ error: { message: "No available provider for the requested model" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
    });

    it("classifies 'temporarily unavailable' as retry_rotate with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "tg",
        status: 400,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: "Backend temporarily unavailable" }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
    });

    it("handles case-insensitivity for retryable 400 patterns", () => {
      const result = classifyUpstreamError({
        provider: "or",
        status: 400,
        headers: {},
        bodyText: "PROVIDER RETURNED ERROR",
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
    });

    it("classifies 'maximum context length' as fail_fast with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 400,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "This model's maximum context length is 128000 tokens" } }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
    });

    it("classifies 'context_length' as fail_fast with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "ds",
        status: 400,
        headers: {},
        bodyText: JSON.stringify({ error: { code: "context_length_exceeded", message: "Prompt too long" } }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
    });

    it("classifies 'safety' as fail_fast with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "gg",
        status: 400,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "Response blocked due to safety ratings" } }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
    });

    it("classifies 'HARM_PROBABILITY' as fail_fast with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "gg",
        status: 400,
        headers: {},
        bodyText: JSON.stringify({ candidates: [{ finishReason: "SAFETY", safetyRatings: [{ probability: "HARM_PROBABILITY_HIGH" }] }] }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
    });

    it("classifies generic 400 errors as fail_fast with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 400,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "Invalid parameter: temperature must be between 0 and 2" } }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
    });
  });

  describe("HTTP 429 - Rate limit vs Quota exhaustion", () => {
    it("classifies 429 standard rate limit as retry_rotate with 65s default quarantine", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 429,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "Rate limit reached for requests" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(65);
    });

    it("honors Retry-After header for 429 standard rate limit", () => {
      const headers = new Headers({ "retry-after": "120" });
      const result = classifyUpstreamError({
        provider: "oa",
        status: 429,
        headers,
        bodyText: JSON.stringify({ error: { message: "Too many requests" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(120);
    });

    it("honors Retry-After in Record<string, string> format", () => {
      const result = classifyUpstreamError({
        provider: "nv",
        status: 429,
        headers: { "retry-after": "90" },
        bodyText: "Rate limit exceeded",
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(90);
    });

    it("classifies 429 with 'insufficient_quota' as retry_rotate with 7-day (604800s) quarantine", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 429,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { code: "insufficient_quota", message: "You exceeded your current quota" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(604800);
    });

    it("classifies 429 with 'credit_limit' as retry_rotate with 7-day quarantine", () => {
      const result = classifyUpstreamError({
        provider: "or",
        status: 429,
        headers: {},
        bodyText: JSON.stringify({ error: { message: "Account credit_limit exceeded" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(604800);
    });

    it("classifies 429 with 'out of balance' as retry_rotate with 7-day quarantine", () => {
      const result = classifyUpstreamError({
        provider: "ds",
        status: 429,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "Your balance is out of balance. Please recharge." } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(604800);
    });
  });

  describe("HTTP 401 & 403 - Authentication and Authorization errors", () => {
    it("classifies 401 as retry_rotate with 7-day (604800s) quarantine", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 401,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "Incorrect API key provided" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(604800);
    });

    it("classifies 403 as retry_rotate with 7-day (604800s) quarantine", () => {
      const result = classifyUpstreamError({
        provider: "gg",
        status: 403,
        headers: {},
        bodyText: JSON.stringify({ error: { message: "The caller does not have permission" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(604800);
    });
  });

  describe("HTTP 5xx - Transient server errors", () => {
    it.each([500, 502, 503, 504])("classifies HTTP %i as retry_rotate with 10s quarantine", (status) => {
      const result = classifyUpstreamError({
        provider: "nv",
        status,
        headers: new Headers(),
        bodyText: `Server Error ${status}`,
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(10);
    });
  });

  describe("HTTP 404 - Not Found", () => {
    it("classifies 404 as fail_fast with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 404,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "The model `gpt-unknown` does not exist" } }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
    });
  });

  describe("Robustness & Bounded parsing", () => {
    it("handles undefined bodyText gracefully", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 500,
        headers: new Headers(),
        bodyText: undefined,
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(10);
    });

    it("handles empty string bodyText gracefully", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 400,
        headers: {},
        bodyText: "",
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
    });

    it("safely processes huge bodies (>4KB) without performance degradation or errors", () => {
      const hugeString = "x".repeat(65536);
      const hugeBody = JSON.stringify({
        error: {
          message: `Provider returned error: ${hugeString}`,
        },
      });

      const result = classifyUpstreamError({
        provider: "or",
        status: 400,
        headers: new Headers(),
        bodyText: hugeBody,
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
    });

    it("safely handles non-JSON malformed bodies", () => {
      const result = classifyUpstreamError({
        provider: "an",
        status: 400,
        headers: {},
        bodyText: "<html><body>400 Bad Request: maximum context length exceeded</body></html>",
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
    });
  });
});
