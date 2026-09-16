import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetEnvCache } from "../../../src/config/env";
import {
  classifyTransportError,
  classifyUpstreamError,
  type UpstreamErrorInfo,
  type ErrorClassification,
} from "../../../src/network/classifier";

describe("Error Classifier — classifyUpstreamError & classifyTransportError", () => {
  let originalTtl: string | undefined;
  let originalOrQuarantine: string | undefined;

  beforeEach(() => {
    originalTtl = process.env.COOLDOWN_RATE_LIMIT_TTL_SEC;
    originalOrQuarantine = process.env.OPENROUTER_ENABLE_QUARANTINE;
    process.env.COOLDOWN_RATE_LIMIT_TTL_SEC = "65";
    process.env.OPENROUTER_ENABLE_QUARANTINE = "true";
    resetEnvCache();
  });

  afterEach(() => {
    if (originalTtl === undefined) {
      delete process.env.COOLDOWN_RATE_LIMIT_TTL_SEC;
    } else {
      process.env.COOLDOWN_RATE_LIMIT_TTL_SEC = originalTtl;
    }
    if (originalOrQuarantine === undefined) {
      delete process.env.OPENROUTER_ENABLE_QUARANTINE;
    } else {
      process.env.OPENROUTER_ENABLE_QUARANTINE = originalOrQuarantine;
    }
    resetEnvCache();
  });
  describe("HTTP 400 - Provider-side retryable vs client-side fail-fast", () => {
    it("classifies 'Provider returned error' as fail_fast with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 400,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "Provider returned error: upstream timeout" } }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(false);
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
      expect(result.isRetryable).toBe(true);
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
      expect(result.isRetryable).toBe(true);
    });

    it("handles case-insensitivity for retryable 400 patterns", () => {
      const result = classifyUpstreamError({
        provider: "or",
        status: 400,
        headers: {},
        bodyText: "NO AVAILABLE PROVIDER",
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(true);
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
      expect(result.isRetryable).toBe(false);
    });

    it("classifies 'context_length_exceeded' as fail_fast with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "ds",
        status: 400,
        headers: {},
        bodyText: JSON.stringify({ error: { code: "context_length_exceeded", message: "Prompt too long" } }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(false);
    });

    it("classifies 'prompt is too long' / context overflow as fail_fast with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "an",
        status: 400,
        headers: new Headers(),
        bodyText: JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "prompt is too long: 205000 tokens > 200000 maximum context length",
          },
        }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(false);
    });

    it("classifies Anthropic context window overflow error as fail_fast with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "an",
        status: 400,
        headers: {},
        bodyText: JSON.stringify({
          error: {
            type: "invalid_request_error",
            message: "Request exceeds the maximum context length of 200000 tokens",
          },
        }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(false);
    });

    it("classifies Google Gemini token limit exceeded 400 as fail_fast with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "gg",
        status: 400,
        headers: {},
        bodyText: JSON.stringify({
          error: {
            code: 400,
            message: "Request contains 1048577 tokens, which exceeds the maximum limit of 1048576 tokens",
            status: "INVALID_ARGUMENT",
          },
        }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(false);
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
      expect(result.isRetryable).toBe(false);
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
      expect(result.isRetryable).toBe(false);
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
      expect(result.isRetryable).toBe(false);
    });
  });

  describe("HTTP 429 - Rate limit vs Quota exhaustion", () => {
    it("classifies 429 standard rate limit as retry_rotate with 0s default quarantine (purged 65s default)", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 429,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "Rate limit reached for requests" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(true);
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
      expect(result.isRetryable).toBe(true);
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
      expect(result.isRetryable).toBe(true);
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
      expect(result.isRetryable).toBe(true);
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
      expect(result.isRetryable).toBe(true);
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
      expect(result.isRetryable).toBe(true);
    });
  });

  describe("HTTP 401 & 403 - classifier key-treatment vs engine fail_fast downstream contract", () => {
    // NOTE (literouter-58xb): at the classifier layer 401 keeps tiered key
    // quarantine (300s -> 1800s -> 86400s). The engine downstream contract
    // (src/engine/status_classify.ts) treats 401/403 as fail_fast — see the
    // downstream-contract block in tests/unit/engine/math_and_classify.test.ts.
    it("classifier key-treatment: 401 retry_rotate tiered (default/1st failure = 300s; engine downstream is fail_fast)", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 401,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "Incorrect API key provided" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(300);
      expect(result.reason).toBe("auth_failure_key_quarantined");
      expect(result.isRetryable).toBe(true);
    });

    it("classifier key-treatment: 403 fail_fast with 0s quarantine (never parks the key; engine downstream is fail_fast)", () => {
      const result = classifyUpstreamError({
        provider: "gg",
        status: 403,
        headers: {},
        bodyText: JSON.stringify({ error: { message: "The caller does not have permission" } }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.reason).toBe("Client error (403)");
      expect(result.isRetryable).toBe(false);
    });

    it("classifier key-treatment: 401 with consecutiveAuthFailures = 2 quarantines 1800s (engine downstream is fail_fast)", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 401,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "Incorrect API key provided" } }),
        consecutiveAuthFailures: 2,
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(1800);
      expect(result.reason).toBe("auth_failure_key_quarantined");
      expect(result.isRetryable).toBe(true);
    });

    it("classifier key-treatment: 401 with consecutiveAuthFailures >= 3 quarantines 86400s (engine downstream is fail_fast)", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 401,
        headers: new Headers(),
        bodyText: JSON.stringify({ error: { message: "Incorrect API key provided" } }),
        consecutiveAuthFailures: 3,
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(86400);
      expect(result.reason).toBe("auth_failure_key_quarantined");
      expect(result.isRetryable).toBe(true);
    });

    it("403 stays fail_fast with 0s quarantine even with consecutiveAuthFailures >= 3 (no tiering)", () => {
      const result = classifyUpstreamError({
        provider: "gg",
        status: 403,
        headers: {},
        bodyText: JSON.stringify({ error: { message: "The caller does not have permission" } }),
        consecutiveAuthFailures: 3,
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(false);
    });
  });

  describe("HTTP 408 - Request timeout", () => {
    it("classifies 408 as retry_rotate with 0s quarantine (delay via providers.json request_retry)", () => {
      const result = classifyUpstreamError({
        provider: "or",
        status: 408,
        headers: {},
        bodyText: JSON.stringify({ error: { message: "Request timeout" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.reason).toBe("Request timeout (408)");
      expect(result.isRetryable).toBe(true);
    });

    it("classifies bare 408 with empty body as retry_rotate with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "nv",
        status: 408,
        headers: new Headers(),
        bodyText: "",
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(true);
    });
  });

  describe("Canonical error_type wins over status (3 skins)", () => {
    it("chat skin: error.metadata.error_type=permission_denied on 500 flips to fail_fast 0s", () => {
      const result = classifyUpstreamError({
        provider: "nv",
        status: 500,
        headers: new Headers(),
        bodyText: JSON.stringify({
          error: {
            message: "Internal server error",
            metadata: { error_type: "permission_denied" },
          },
        }),
      });
      expect(result.action).toBe("fail_fast");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(false);
      expect(result.errorType).toBe("permission_denied");
    });

    it("anthropic skin: error.error_type=timeout on 400 flips to retry_rotate", () => {
      const result = classifyUpstreamError({
        provider: "an",
        status: 400,
        headers: {},
        bodyText: JSON.stringify({
          error: { error_type: "timeout", message: "Upstream timed out" },
        }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe("timeout");
    });

    it("responses skin: top-level error_type=rate_limit_exceeded on 403 flips to retry_rotate", () => {
      const result = classifyUpstreamError({
        provider: "oa",
        status: 403,
        headers: new Headers(),
        bodyText: JSON.stringify({
          error_type: "rate_limit_exceeded",
          error: { message: "Rate limit reached for requests" },
        }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.isRetryable).toBe(true);
      expect(result.errorType).toBe("rate_limit_exceeded");
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
      expect(result.isRetryable).toBe(true);
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
      expect(result.isRetryable).toBe(false);
    });
  });

  describe("Transport & Network Connection Drops (Pre-TTFT)", () => {
    it("evaluates TCP RST / ECONNRESET with 2s cooldown quarantine", () => {
      const result = classifyTransportError(new Error("read ECONNRESET"));
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(2);
      expect(result.reason).toBe("transport_reset_cooldown");
      expect(result.isRetryable).toBe(true);
    });

    it("evaluates socket EOF / hang up with 2s cooldown quarantine", () => {
      const result = classifyTransportError(new Error("socket hang up: premature close EOF"));
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(2);
      expect(result.isRetryable).toBe(true);
    });

    it("evaluates ConnectTimeout with 2s cooldown quarantine", () => {
      const result = classifyTransportError(new Error("ConnectTimeoutError: Connect Timeout"));
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(2);
      expect(result.isRetryable).toBe(true);
    });

    it("evaluates status 0 pre-stream transport reset with 2s cooldown quarantine", () => {
      const result = classifyUpstreamError({
        provider: "or",
        status: 0,
        headers: {},
        bodyText: "Network transport failure: Connection reset by peer",
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(2);
      expect(result.reason).toBe("transport_reset_cooldown");
      expect(result.isRetryable).toBe(true);
    });

    it("evaluates TTFT timeout with 2s transient quarantine", () => {
      const result = classifyTransportError(new Error("TTFT exceeded 5000ms"));
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(2);
      expect(result.reason).toBe("ttft_timeout_exceeded");
      expect(result.isRetryable).toBe(true);
    });

    it("evaluates NoResponse / timed out waiting for first chunk with 2s transient quarantine", () => {
      const result = classifyTransportError(new Error("NoResponse: timed out waiting for first chunk"));
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(2);
      expect(result.reason).toBe("ttft_timeout_exceeded");
      expect(result.isRetryable).toBe(true);
    });

    it("evaluates status 0 TTFT timeout with 2s transient quarantine", () => {
      const result = classifyUpstreamError({
        provider: "or",
        status: 0,
        headers: {},
        bodyText: "TTFT exceeded 5000ms",
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(2);
      expect(result.reason).toBe("ttft_timeout_exceeded");
      expect(result.isRetryable).toBe(true);
    });
  });

  describe("HTTP/2 Stream Cancellations & Zero-Quarantine Retries", () => {
    it("classifies 'The pending stream has been canceled' in transport error as retry_rotate with 0s quarantine", () => {
      const result = classifyTransportError(new Error("The pending stream has been canceled"));
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.reason).toBe("transport_stream_canceled_immediate_retry");
      expect(result.isRetryable).toBe(true);
    });

    it("classifies 'The pending stream has been canceled' in HTTP 500 body as retry_rotate with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "or",
        status: 500,
        headers: {},
        bodyText: JSON.stringify({ error: { message: "The pending stream has been canceled" } }),
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.reason).toBe("transport_stream_canceled_immediate_retry");
      expect(result.isRetryable).toBe(true);
    });

    it("classifies ERR_HTTP2_STREAM_CANCEL as retry_rotate with 0s quarantine", () => {
      const result = classifyTransportError(new Error("ERR_HTTP2_STREAM_CANCEL: stream was reset"));
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.reason).toBe("transport_stream_canceled_immediate_retry");
      expect(result.isRetryable).toBe(true);
    });

    it("classifies RST_STREAM in body as retry_rotate with 0s quarantine", () => {
      const result = classifyUpstreamError({
        provider: "or",
        status: 502,
        headers: {},
        bodyText: "Upstream sent RST_STREAM frame",
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.quarantineTtlSec).toBe(0);
      expect(result.reason).toBe("transport_stream_canceled_immediate_retry");
      expect(result.isRetryable).toBe(true);
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
      expect(result.isRetryable).toBe(true);
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
      expect(result.isRetryable).toBe(false);
    });

    it("safely processes huge bodies (>4KB) without performance degradation or errors", () => {
      const hugeString = "x".repeat(65536);
      const hugeBody = JSON.stringify({
        error: {
          message: `no available provider: ${hugeString}`,
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
      expect(result.isRetryable).toBe(true);
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
      expect(result.isRetryable).toBe(false);
    });
  });

  describe("Conserve Rules Evaluation", () => {
    it("matches custom conserve rule and marks isConserve with resolved TTL", () => {
      const result = classifyUpstreamError({
        provider: "or",
        status: 429,
        headers: {},
        bodyText: '{"error":{"message":"free-models-per-day limit reached"}}',
        conserveRules: [
          {
            status: 429,
            contains: "free-models-per-day",
            ttl: 3600,
            reason: "openrouter_daily_free_quota_exhausted",
          },
        ],
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.isRetryable).toBe(true);
      expect(result.isConserve).toBe(true);
      expect(result.quarantineTtlSec).toBe(3600);
      expect(result.reason).toBe("openrouter_daily_free_quota_exhausted");
    });

    it("conserve-first: conserve rule wins over typed error_type fail_fast", () => {
      const result = classifyUpstreamError({
        provider: "or",
        status: 429,
        headers: {},
        bodyText: JSON.stringify({
          error: {
            message: "free-models-per-day limit reached",
            error_type: "permission_denied",
          },
        }),
        conserveRules: [
          {
            status: 429,
            contains: "free-models-per-day",
            ttl: 3600,
            reason: "openrouter_daily_free_quota_exhausted",
          },
        ],
      });
      expect(result.action).toBe("retry_rotate");
      expect(result.isRetryable).toBe(true);
      expect(result.isConserve).toBe(true);
      expect(result.quarantineTtlSec).toBe(3600);
      expect(result.reason).toBe("openrouter_daily_free_quota_exhausted");
    });

    it("falls through when conserve rules do not match status or text", () => {      const result = classifyUpstreamError({
        provider: "or",
        status: 429,
        headers: {},
        bodyText: '{"error":{"message":"Rate limit exceeded"}}',
        conserveRules: [
          {
            status: 429,
            contains: "free-models-per-day",
            ttl: "midnight_utc",
            reason: "openrouter_daily_free_quota_exhausted",
          },
        ],
      });
      expect(result.isConserve).toBeUndefined();
      expect(result.reason).toBe("Rate limit reached (429)");
    });
  });
});
