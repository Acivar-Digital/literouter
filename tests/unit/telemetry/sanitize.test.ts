import { describe, expect, it } from "bun:test";
import {
  ALLOWED_HEADERS,
  REDACTED_HEADERS,
  sanitizeBody,
  sanitizeHeaders,
} from "../../../src/telemetry/sanitize";

describe("Telemetry Sanitization — Header Allowlisting & Redaction", () => {
  it("redacts sensitive headers to [REDACTED]", () => {
    const input: Record<string, string> = {
      authorization: "Bearer mock-secret-token",
      "x-api-key": "mock-api-key-value",
      "api-key": "mock-azure-key",
      "x-goog-api-key": "mock-google-key",
      cookie: "session=abcdef123456",
      "set-cookie": "token=secret789",
    };

    const sanitized = sanitizeHeaders(input);

    for (const key of REDACTED_HEADERS) {
      expect(sanitized[key]).toBe("[REDACTED]");
    }
  });

  it("handles case-insensitivity for redacted headers", () => {
    const input: Record<string, string> = {
      AUTHORIZATION: "Bearer mock-token",
      "X-Api-Key": "mock-key",
      "Set-Cookie": "session=123",
    };

    const sanitized = sanitizeHeaders(input);

    expect(sanitized["authorization"]).toBe("[REDACTED]");
    expect(sanitized["x-api-key"]).toBe("[REDACTED]");
    expect(sanitized["set-cookie"]).toBe("[REDACTED]");
    expect(sanitized["AUTHORIZATION"]).toBeUndefined();
    expect(sanitized["X-Api-Key"]).toBeUndefined();
  });

  it("preserves all allowed headers verbatim", () => {
    const input: Record<string, string> = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "user-agent": "OpenCode-Client/2.0",
      "x-title": "Project Alpha",
      "http-referer": "https://opencode.ai",
      referer: "https://opencode.ai/ref",
      "x-request-id": "req-1234-abcd",
      "x-literouter-model": "gemini-flash",
      "x-literouter-tier": "0",
      "x-literouter-chain": "native",
      "x-session-id": "sess-5678-efgh",
      "anthropic-version": "2023-06-01",
      "retry-after": "60",
      "x-ratelimit-limit-requests": "1000",
      "x-ratelimit-remaining-requests": "999",
    };

    const sanitized = sanitizeHeaders(input);

    for (const key of ALLOWED_HEADERS) {
      expect(sanitized[key]).toBe(input[key]);
    }
  });

  it("handles case-insensitivity for allowed headers and normalizes keys to lowercase", () => {
    const input: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "Bun-Runtime",
      "X-Request-ID": "req-999",
    };

    const sanitized = sanitizeHeaders(input);

    expect(sanitized["content-type"]).toBe("application/json");
    expect(sanitized["user-agent"]).toBe("Bun-Runtime");
    expect(sanitized["x-request-id"]).toBe("req-999");
    expect(sanitized["Content-Type"]).toBeUndefined();
  });

  it("silently drops unknown / arbitrary headers", () => {
    const input: Record<string, string> = {
      "content-type": "application/json",
      "x-custom-secret": "super-private-token",
      "cf-ray": "82937401-syd",
      server: "cloudflare",
      "x-forwarded-for": "192.168.1.1",
      "x-unknown-token": "secret123",
    };

    const sanitized = sanitizeHeaders(input);

    expect(sanitized["content-type"]).toBe("application/json");
    expect(sanitized["x-custom-secret"]).toBeUndefined();
    expect(sanitized["cf-ray"]).toBeUndefined();
    expect(sanitized["server"]).toBeUndefined();
    expect(sanitized["x-forwarded-for"]).toBeUndefined();
    expect(sanitized["x-unknown-token"]).toBeUndefined();
    expect(Object.keys(sanitized)).toEqual(["content-type"]);
  });

  it("works with standard Web API Headers instance", () => {
    const headers = new Headers();
    headers.set("Authorization", "Bearer sk-test-stub");
    headers.set("Content-Type", "application/json");
    headers.set("X-Custom-Header", "should-be-dropped");
    headers.set("X-Session-ID", "sess-test-42");

    const sanitized = sanitizeHeaders(headers);

    expect(sanitized["authorization"]).toBe("[REDACTED]");
    expect(sanitized["content-type"]).toBe("application/json");
    expect(sanitized["x-session-id"]).toBe("sess-test-42");
    expect(sanitized["x-custom-header"]).toBeUndefined();
  });

  it("safely handles empty or missing headers", () => {
    expect(sanitizeHeaders({})).toEqual({});
    expect(sanitizeHeaders(new Headers())).toEqual({});
    // @ts-expect-error test undefined resilience
    expect(sanitizeHeaders(undefined)).toEqual({});
  });
});

describe("Telemetry Sanitization — Body Key Scrubbing", () => {
  it("scrubs OpenRouter keys: sk-or-v1-[a-zA-Z0-9]{64}", () => {
    // 64-character mock token
    const mockOrKey = "sk-or-v1-" + "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f61234";
    const body = {
      message: `Failed request using key ${mockOrKey} to upstream`,
    };

    const sanitized = sanitizeBody(body);
    expect(sanitized).not.toContain(mockOrKey);
    expect(sanitized).toContain("[REDACTED_KEY]");
    expect(sanitized).toBe('{"message":"Failed request using key [REDACTED_KEY] to upstream"}');
  });

  it("scrubs NVIDIA NIM keys: nvapi-[a-zA-Z0-9_-]{64}", () => {
    // Exactly 64 characters mock token with allowed charset (16 * 4)
    const mockNvKey =
      "nvapi-" +
      "ABCDEF0123456789" +
      "abcdef0123456789" +
      "-_ABCDEF01234567" +
      "abcdef0123456789";
    const body = `Error from upstream: invalid token ${mockNvKey}`;

    const sanitized = sanitizeBody(body);
    expect(sanitized).not.toContain(mockNvKey);
    expect(sanitized).toBe("Error from upstream: invalid token [REDACTED_KEY]");
  });

  it("scrubs Google AI Studio keys: AIzaSy[a-zA-Z0-9_-]{33}", () => {
    // 33-character mock suffix after AIzaSy
    const mockGgKey = "AIzaSy" + "ABCD0123456789-_abcd0123456789-_0";
    const body = {
      error: {
        message: `API key ${mockGgKey} has exceeded quota`,
      },
    };

    const sanitized = sanitizeBody(body);
    expect(sanitized).not.toContain(mockGgKey);
    expect(sanitized).toContain("[REDACTED_KEY]");
  });

  it("scrubs LiteRouter directive / proxy keys: sk-lr-[a-zA-Z0-9_-]+", () => {
    const mockLrKey = "sk-lr-or-oa-ch-no_test-session-1234";
    const body = {
      apiKey: mockLrKey,
      directive: "sk-lr-nv-oa-ch-ts",
    };

    const sanitized = sanitizeBody(body);
    expect(sanitized).not.toContain(mockLrKey);
    expect(sanitized).not.toContain("sk-lr-nv-oa-ch-ts");
    expect(sanitized).toBe('{"apiKey":"[REDACTED_KEY]","directive":"[REDACTED_KEY]"}');
  });

  it("scrubs Bearer tokens: Bearer\\s+[a-zA-Z0-9_.-]+", () => {
    const rawString = "Authorization header was Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-off";
    const sanitized = sanitizeBody(rawString);

    expect(sanitized).not.toContain("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-off");
    expect(sanitized).toBe("Authorization header was [REDACTED_KEY]");
  });

  it("scrubs multiple secret formats embedded in a single payload", () => {
    const mockOrKey = "sk-or-v1-" + "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const mockGgKey = "AIzaSy" + "1234567890abcdef1234567890abcdef1";
    const payload = {
      primary: mockOrKey,
      secondary: mockGgKey,
      authHeader: "Bearer stub-token-xyz.123_abc",
      directive: "sk-lr-fse-fast",
    };

    const sanitized = sanitizeBody(payload);
    expect(sanitized).not.toContain(mockOrKey);
    expect(sanitized).not.toContain(mockGgKey);
    expect(sanitized).not.toContain("Bearer stub-token-xyz.123_abc");
    expect(sanitized).not.toContain("sk-lr-fse-fast");
    expect(sanitized).toBe(
      '{"primary":"[REDACTED_KEY]","secondary":"[REDACTED_KEY]","authHeader":"[REDACTED_KEY]","directive":"[REDACTED_KEY]"}'
    );
  });

  it("handles non-string primitives and special types gracefully", () => {
    expect(sanitizeBody(undefined)).toBe("");
    expect(sanitizeBody(null)).toBe("null");
    expect(sanitizeBody(12345)).toBe("12345");
    expect(sanitizeBody(true)).toBe("true");
    expect(sanitizeBody(["safe-item", 100])).toBe('["safe-item",100]');
  });

  it("handles circular structures without crashing", () => {
    const circular: Record<string, unknown> = { name: "test" };
    circular.self = circular;

    const sanitized = sanitizeBody(circular);
    expect(sanitized).toBe("[object Object]");
  });
});
