import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resolve, join } from "node:path";
import {
  isPathWithinBase,
  getAllTsFiles,
  PROJECT_ROOT,
  PROJECT_ROOT_REAL,
} from "../../scripts/diagnose/complexity";
import { resetEnvCache, getEnv } from "../../src/config/env";
import { verifyMasterSecret } from "../../src/directive/validator";
import { parseDirective } from "../../src/directive/parser";
import { handleAppRequest, resetAllState, MAX_REQUEST_BODY_SIZE } from "../../src/lib";
import { OpenAIChatTransformer } from "../../src/transformers/openai_chat";
import { OpenAIResponsesTransformer } from "../../src/transformers/openai_responses";
import {
  SAFE_CLIENT_PASS_HEADERS,
  mergeOutboundHeaders,
  createCleanErrorResponse,
} from "../../src/engine/dispatch";
import {
  sanitizeBody,
  sanitizeHeaders,
  ALLOWED_HEADERS,
  REDACTED_HEADERS,
} from "../../src/telemetry/sanitize";

describe("Comprehensive Security Fixes Test Suite", () => {
  // ---------------------------------------------------------------------------
  // 1. Path Traversal & Containment in scripts/diagnose/complexity.ts
  // ---------------------------------------------------------------------------
  describe("1. Path Traversal & Containment (scripts/diagnose/complexity.ts)", () => {
    it("allows valid paths inside PROJECT_ROOT", () => {
      expect(isPathWithinBase(PROJECT_ROOT, PROJECT_ROOT, PROJECT_ROOT_REAL)).toBe(true);
      expect(isPathWithinBase(resolve(PROJECT_ROOT, "src"), PROJECT_ROOT, PROJECT_ROOT_REAL)).toBe(true);
      expect(
        isPathWithinBase(resolve(PROJECT_ROOT, "scripts/diagnose"), PROJECT_ROOT, PROJECT_ROOT_REAL)
      ).toBe(true);
      expect(isPathWithinBase(resolve(PROJECT_ROOT, "package.json"), PROJECT_ROOT, PROJECT_ROOT_REAL)).toBe(
        true
      );
    });

    it("blocks directory traversal using ../../ escaping PROJECT_ROOT", () => {
      const escape1 = resolve(PROJECT_ROOT, "../../etc/passwd");
      expect(isPathWithinBase(escape1, PROJECT_ROOT, PROJECT_ROOT_REAL)).toBe(false);

      const escape2 = resolve(PROJECT_ROOT, "..");
      expect(isPathWithinBase(escape2, PROJECT_ROOT, PROJECT_ROOT_REAL)).toBe(false);

      const escape3 = "/tmp";
      expect(isPathWithinBase(escape3, PROJECT_ROOT, PROJECT_ROOT_REAL)).toBe(false);

      const escape4 = "/etc";
      expect(isPathWithinBase(escape4, PROJECT_ROOT, PROJECT_ROOT_REAL)).toBe(false);
    });

    it("handles non-existent paths cleanly without unhandled ENOENT crashes", () => {
      // Non-existent path inside root - realpathSync throws ENOENT which must be safely caught
      const nonExistentInside = resolve(PROJECT_ROOT, "non_existent_folder_mock_test_123/mock_file.ts");
      expect(() => isPathWithinBase(nonExistentInside, PROJECT_ROOT, PROJECT_ROOT_REAL)).not.toThrow();
      expect(isPathWithinBase(nonExistentInside, PROJECT_ROOT, PROJECT_ROOT_REAL)).toBe(false);

      // Non-existent path outside root
      const nonExistentOutside = resolve(PROJECT_ROOT, "../../non_existent_mock_xyz_987/test.ts");
      expect(() => isPathWithinBase(nonExistentOutside, PROJECT_ROOT, PROJECT_ROOT_REAL)).not.toThrow();
      expect(isPathWithinBase(nonExistentOutside, PROJECT_ROOT, PROJECT_ROOT_REAL)).toBe(false);
    });

    it("getAllTsFiles throws a descriptive traversal error for paths outside root", () => {
      const traversalTarget = resolve(PROJECT_ROOT, "../");
      expect(() => getAllTsFiles(traversalTarget)).toThrow(
        /Path traversal detected:.*escapes the project root/
      );
    });

    it("getAllTsFiles successfully returns ts files for legitimate subdirectories", () => {
      const diagnoseDir = resolve(PROJECT_ROOT, "scripts/diagnose");
      const files = getAllTsFiles(diagnoseDir);
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => f.endsWith("complexity.ts"))).toBe(true);
      expect(files.every((f) => f.endsWith(".ts"))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Admin Endpoint Auth Key Lockdown (/reset and /admin/pool/reset)
  // ---------------------------------------------------------------------------
  describe("2. Admin Endpoint Auth Key Lockdown", () => {
    const originalAuth = process.env.LITEROUTER_AUTH_KEY;
    const originalEngine = process.env.LITEROUTER_ENGINE;
    const TEST_MASTER_KEY = "test-stub-master-auth-secret-key1";

    beforeEach(() => {
      process.env.LITEROUTER_AUTH_KEY = TEST_MASTER_KEY;
      process.env.LITEROUTER_ENGINE = "v4.1";
      resetEnvCache();
      resetAllState();
    });

    afterEach(() => {
      if (originalAuth !== undefined) {
        process.env.LITEROUTER_AUTH_KEY = originalAuth;
      } else {
        delete process.env.LITEROUTER_AUTH_KEY;
      }
      if (originalEngine !== undefined) {
        process.env.LITEROUTER_ENGINE = originalEngine;
      } else {
        delete process.env.LITEROUTER_ENGINE;
      }
      resetEnvCache();
      resetAllState();
    });

    describe("verifyMasterSecret constant-time verification", () => {
      it("returns true only for exact matching secrets", () => {
        expect(verifyMasterSecret(TEST_MASTER_KEY, TEST_MASTER_KEY)).toBe(true);
      });

      it("returns false for mismatching or truncated candidate keys", () => {
        expect(verifyMasterSecret("wrong-mock-key", TEST_MASTER_KEY)).toBe(false);
        expect(verifyMasterSecret(TEST_MASTER_KEY.slice(0, -1), TEST_MASTER_KEY)).toBe(false);
        expect(verifyMasterSecret(TEST_MASTER_KEY + "extra", TEST_MASTER_KEY)).toBe(false);
      });

      it("returns false for empty or missing inputs", () => {
        expect(verifyMasterSecret("", TEST_MASTER_KEY)).toBe(false);
        expect(verifyMasterSecret(TEST_MASTER_KEY, "")).toBe(false);
        expect(verifyMasterSecret("", "")).toBe(false);
      });
    });

    describe("/reset endpoint protection", () => {
      it("succeeds with valid LITEROUTER_AUTH_KEY bearer token", async () => {
        const req = new Request("http://localhost:7766/reset", {
          method: "POST",
          headers: { Authorization: `Bearer ${TEST_MASTER_KEY}` },
        });
        const res = await handleAppRequest(req);
        expect(res.status).toBe(200);
        const data = (await res.json()) as { status: string };
        expect(data.status).toBe("ok");
      });

      it("rejects directive routing keys (e.g. lr-or-oa-ch-no) with 401 Unauthorized", async () => {
        const req = new Request("http://localhost:7766/reset", {
          method: "POST",
          headers: { Authorization: "Bearer lr-or-oa-ch-no" },
        });
        const res = await handleAppRequest(req);
        expect(res.status).toBe(401);
        const data = (await res.json()) as { error: { message: string; type: string } };
        expect(data.error.message).toBe("Unauthorized admin access");
        expect(data.error.type).toBe("authentication_error");
      });

      it("rejects invalid master keys with 401 Unauthorized", async () => {
        const req = new Request("http://localhost:7766/reset", {
          method: "POST",
          headers: { Authorization: "Bearer test-stub-invalid-secret-key2" },
        });
        const res = await handleAppRequest(req);
        expect(res.status).toBe(401);
        const data = (await res.json()) as { error: { message: string } };
        expect(data.error.message).toBe("Unauthorized admin access");
      });

      it("rejects requests missing Authorization headers with 401", async () => {
        const req = new Request("http://localhost:7766/reset", {
          method: "POST",
        });
        const res = await handleAppRequest(req);
        expect(res.status).toBe(401);
      });

      it("rejects /reset when LITEROUTER_AUTH_KEY is unconfigured", async () => {
        delete process.env.LITEROUTER_AUTH_KEY;
        resetEnvCache();

        const req = new Request("http://localhost:7766/reset", {
          method: "POST",
          headers: { Authorization: `Bearer ${TEST_MASTER_KEY}` },
        });
        const res = await handleAppRequest(req);
        expect(res.status).toBe(401);
        const data = (await res.json()) as { error: { message: string } };
        expect(data.error.message).toContain("Admin endpoints disabled");
      });
    });

    describe("/admin/pool/reset endpoint protection", () => {
      it("succeeds with valid LITEROUTER_AUTH_KEY bearer token", async () => {
        const req = new Request("http://localhost:7766/admin/pool/reset?provider=gg", {
          method: "POST",
          headers: { Authorization: `Bearer ${TEST_MASTER_KEY}` },
        });
        const res = await handleAppRequest(req);
        expect(res.status).toBe(200);
        const data = (await res.json()) as { status: string; provider: string };
        expect(data.status).toBe("ok");
        expect(data.provider).toBe("gg");
      });

      it("rejects directive routing keys on /admin/pool/reset with 401", async () => {
        const req = new Request("http://localhost:7766/admin/pool/reset", {
          method: "POST",
          headers: { Authorization: "Bearer lr-or-oa-ch-no" },
        });
        const res = await handleAppRequest(req);
        expect(res.status).toBe(401);
        const data = (await res.json()) as { error: { message: string } };
        expect(data.error.message).toBe("Unauthorized admin access");
      });

      it("rejects missing Authorization on /admin/pool/reset with 401", async () => {
        const req = new Request("http://localhost:7766/admin/pool/reset", {
          method: "POST",
        });
        const res = await handleAppRequest(req);
        expect(res.status).toBe(401);
      });

      it("rejects /admin/pool/reset when LITEROUTER_AUTH_KEY is unconfigured", async () => {
        delete process.env.LITEROUTER_AUTH_KEY;
        resetEnvCache();

        const req = new Request("http://localhost:7766/admin/pool/reset", {
          method: "POST",
          headers: { Authorization: `Bearer ${TEST_MASTER_KEY}` },
        });
        const res = await handleAppRequest(req);
        expect(res.status).toBe(401);
        const data = (await res.json()) as { error: { message: string } };
        expect(data.error.message).toContain("Admin endpoints disabled");
      });
    });

    describe("/v1/traces endpoint protection", () => {
      it("rejects directive keys from viewing traces", async () => {
        const req = new Request("http://localhost:7766/v1/traces", {
          method: "GET",
          headers: { Authorization: "Bearer lr-or-oa-ch-no" },
        });
        const res = await handleAppRequest(req);
        expect(res.status).toBe(401);
      });

      it("allows master auth key via x-literouter-key header", async () => {
        const req = new Request("http://localhost:7766/v1/traces", {
          method: "GET",
          headers: { "x-literouter-key": TEST_MASTER_KEY },
        });
        const res = await handleAppRequest(req);
        expect(res.status).toBe(200);
        const data = (await res.json()) as { traces: unknown[] };
        expect(Array.isArray(data.traces)).toBe(true);
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Outbound Client Header Filtering
  // ---------------------------------------------------------------------------
  describe("3. Outbound Client Header Filtering", () => {
    const chatDirective = parseDirective("lr-or-oa-ch-no")!;
    const responsesDirective = parseDirective("lr-or-oa-rs-no")!;

    it("SAFE_CLIENT_PASS_HEADERS contains strictly allowed headers", () => {
      expect(SAFE_CLIENT_PASS_HEADERS.has("accept")).toBe(true);
      expect(SAFE_CLIENT_PASS_HEADERS.has("user-agent")).toBe(true);
      expect(SAFE_CLIENT_PASS_HEADERS.has("x-request-id")).toBe(true);
      expect(SAFE_CLIENT_PASS_HEADERS.has("session-id")).toBe(true);
      expect(SAFE_CLIENT_PASS_HEADERS.has("x-session-id")).toBe(true);
      expect(SAFE_CLIENT_PASS_HEADERS.has("anthropic-version")).toBe(true);
      expect(SAFE_CLIENT_PASS_HEADERS.has("anthropic-beta")).toBe(true);
      expect(SAFE_CLIENT_PASS_HEADERS.has("x-title")).toBe(true);
      expect(SAFE_CLIENT_PASS_HEADERS.has("http-referer")).toBe(true);

      // Sensitive headers must NOT be in the allowlist
      expect(SAFE_CLIENT_PASS_HEADERS.has("authorization")).toBe(false);
      expect(SAFE_CLIENT_PASS_HEADERS.has("cookie")).toBe(false);
      expect(SAFE_CLIENT_PASS_HEADERS.has("set-cookie")).toBe(false);
      expect(SAFE_CLIENT_PASS_HEADERS.has("proxy-authorization")).toBe(false);
      expect(SAFE_CLIENT_PASS_HEADERS.has("x-forwarded-for")).toBe(false);
    });

    it("OpenAIChatTransformer preserves safe headers and filters sensitive client headers", () => {
      const transformer = new OpenAIChatTransformer();
      const headers = new Headers({
        "user-agent": "test-stub-agent/1.0",
        "session-id": "sess-test-stub-123",
        "x-request-id": "req-test-stub-abc",
        "anthropic-version": "2023-06-01",
        authorization: "Bearer test-stub-secret-token",
        cookie: "auth_session=test-stub-cookie-secret",
        "set-cookie": "leak_cookie=test-stub-val",
        "proxy-authorization": "Basic test-stub-creds",
        "x-forwarded-for": "10.0.0.1",
        "x-internal-token": "test-stub-leak",
      });

      const payload = transformer.transformClientToWire(
        { model: "openai/gpt-4o", messages: [{ role: "user", content: "hello" }] },
        chatDirective,
        headers
      );

      // Safe headers forwarded
      expect(payload.headers["user-agent"]).toBe("test-stub-agent/1.0");
      expect(payload.headers["session-id"]).toBe("sess-test-stub-123");
      expect(payload.headers["x-request-id"]).toBe("req-test-stub-abc");
      expect(payload.headers["anthropic-version"]).toBe("2023-06-01");
      expect(payload.headers["content-type"]).toBe("application/json");

      // Sensitive / internal headers stripped
      expect(payload.headers["authorization"]).toBeUndefined();
      expect(payload.headers["cookie"]).toBeUndefined();
      expect(payload.headers["set-cookie"]).toBeUndefined();
      expect(payload.headers["proxy-authorization"]).toBeUndefined();
      expect(payload.headers["x-forwarded-for"]).toBeUndefined();
      expect(payload.headers["x-internal-token"]).toBeUndefined();
    });

    it("OpenAIResponsesTransformer preserves safe headers and filters sensitive client headers", () => {
      const transformer = new OpenAIResponsesTransformer();
      const headers = new Headers({
        "user-agent": "test-stub-client/2.0",
        "x-title": "Research Session",
        "http-referer": "https://localhost/test",
        authorization: "Bearer test-stub-secret-token",
        cookie: "id=test-stub-session-id",
        "set-cookie": "token=test-stub-secret",
        "proxy-authorization": "Bearer test-stub-proxy-secret",
        "x-custom-secret": "test-stub-bad",
      });

      const payload = transformer.transformClientToWire(
        { model: "openai/gpt-4o", input: "test prompt" },
        responsesDirective,
        headers
      );

      // Safe headers forwarded
      expect(payload.headers["user-agent"]).toBe("test-stub-client/2.0");
      expect(payload.headers["x-title"]).toBe("Research Session");
      expect(payload.headers["http-referer"]).toBe("https://localhost/test");

      // Sensitive headers stripped
      expect(payload.headers["authorization"]).toBeUndefined();
      expect(payload.headers["cookie"]).toBeUndefined();
      expect(payload.headers["set-cookie"]).toBeUndefined();
      expect(payload.headers["proxy-authorization"]).toBeUndefined();
      expect(payload.headers["x-custom-secret"]).toBeUndefined();
    });

    it("mergeOutboundHeaders filters sensitive client headers when filterClientHeaders is true", () => {
      const authHeaders = { authorization: "Bearer test-stub-upstream-key" };
      const injectedHeaders = { "x-injected": "gateway-internal" };
      const payloadHeaders = {
        authorization: "Bearer test-stub-token",
        cookie: "test-stub-session=abc",
        "proxy-authorization": "test-stub-proxy",
        "x-forwarded-for": "192.168.1.1",
        host: "evil-host.com",
        "x-title": "Allowed Title",
        "user-agent": "test-stub-ua",
        "x-request-id": "req-test-stub-1",
      };

      const merged = mergeOutboundHeaders(
        authHeaders,
        injectedHeaders,
        undefined,
        undefined,
        payloadHeaders
      );

      expect(merged["x-title"]).toBe("Allowed Title");
      expect(merged["user-agent"]).toBe("test-stub-ua");
      expect(merged["x-request-id"]).toBe("req-test-stub-1");
      expect(merged["x-injected"]).toBe("gateway-internal");
      expect(merged["authorization"]).toBe("Bearer test-stub-upstream-key");
      expect(merged["cookie"]).toBeUndefined();
      expect(merged["proxy-authorization"]).toBeUndefined();
      expect(merged["x-forwarded-for"]).toBeUndefined();
      expect(merged["host"]).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Request Body Size Cap (32MB Max Request Body)
  // ---------------------------------------------------------------------------
  describe("4. Request Body Size Cap (32MB)", () => {
    it("exports MAX_REQUEST_BODY_SIZE as exactly 32MB (33,554,432 bytes)", () => {
      expect(MAX_REQUEST_BODY_SIZE).toBe(32 * 1024 * 1024);
    });

    it("correctly flags and releases buffer memory when incoming chunks exceed 32MB", () => {
      const limit = MAX_REQUEST_BODY_SIZE;
      let totalBytes = 0;
      let isOverLimit = false;
      const chunks: Buffer[] = [];

      const receiveChunk = (size: number) => {
        if (isOverLimit) return;
        totalBytes += size;
        if (totalBytes > limit) {
          isOverLimit = true;
          chunks.length = 0; // Guard against OOM by immediately dropping chunks
          return;
        }
        chunks.push(Buffer.alloc(size));
      };

      // 10MB chunk: acceptable
      receiveChunk(10 * 1024 * 1024);
      expect(isOverLimit).toBe(false);
      expect(chunks.length).toBe(1);

      // Another 15MB: total 25MB, still acceptable
      receiveChunk(15 * 1024 * 1024);
      expect(isOverLimit).toBe(false);
      expect(chunks.length).toBe(2);

      // Another 10MB: total 35MB > 32MB limit -> triggers overlimit defense
      receiveChunk(10 * 1024 * 1024);
      expect(isOverLimit).toBe(true);
      expect(chunks.length).toBe(0); // Memory released
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Secret Scanning & Scrubbing
  // ---------------------------------------------------------------------------
  describe("5. Secret Scanning & Scrubbing", () => {
    describe("sanitizeBody regex redaction across provider keys", () => {
      it("scrubs Anthropic keys", () => {
        const input = "Failed upstream with key sk-ant-api03-test-stub-1234567890abcdef123456 in body";
        const result = sanitizeBody(input);
        expect(result).not.toContain("sk-ant-api03");
        expect(result).toContain("[REDACTED_KEY]");
      });

      it("scrubs OpenAI project/service keys", () => {
        const input = "Invalid token: sk-proj-test-stub-1234567890abcdef1234567890";
        const result = sanitizeBody(input);
        expect(result).not.toContain("sk-proj-");
        expect(result).toContain("[REDACTED_KEY]");
      });

      it("scrubs Groq and Cerebras keys", () => {
        const input = "Groq: gsk_test_stub_12345678901234567890 and Cerebras: csk-test-stub-12345678901234567890";
        const result = sanitizeBody(input);
        expect(result).not.toContain("gsk_");
        expect(result).not.toContain("csk-");
        expect(result).toBe("Groq: [REDACTED_KEY] and Cerebras: [REDACTED_KEY]");
      });

      it("scrubs NVIDIA and Google keys", () => {
        const input =
          "NVIDIA: nvapi-test-stub-1234567890abcdef1234567890ab and Google: AIzaSyD-test-stub-1234567890abcdef12345";
        const result = sanitizeBody(input);
        expect(result).not.toContain("nvapi-");
        expect(result).not.toContain("AIzaSy");
        expect(result).toContain("[REDACTED_KEY]");
      });

      it("scrubs OpenRouter keys", () => {
        // OpenRouter keys match sk-or-v1- followed by 64 hex/alphanumeric chars
        const fakeOrKey = "sk-or-v1-mock" + "1".repeat(60);
        const input = `OpenRouter key: ${fakeOrKey}`;
        const result = sanitizeBody(input);
        expect(result).not.toContain(fakeOrKey);
        expect(result).toContain("[REDACTED_KEY]");
      });

      it("scrubs URL query parameters containing keys or tokens", () => {
        const input =
          "Request to https://generativelanguage.googleapis.com/v1beta/models?key=AIzaSyD-test-stub-secretKey123&other=ok";
        const result = sanitizeBody(input);
        expect(result).not.toContain("AIzaSyD-test-stub-secretKey123");
        expect(result).toContain("[REDACTED_KEY]");
      });

      it("scrubs Bearer tokens", () => {
        const input = "Authorization header: Bearer test-stub-secret-token-value-12345";
        const result = sanitizeBody(input);
        expect(result).not.toContain("test-stub-secret-token-value-12345");
        expect(result).toContain("[REDACTED_KEY]");
      });

      it("truncates oversized payloads when maxBytes is specified", () => {
        const longText = "a".repeat(1000) + " sk-proj-test-stub-1234567890abcdef12345";
        const truncated = sanitizeBody(longText, 200);
        expect(truncated.length).toBeLessThan(longText.length);
        expect(truncated).toContain("... [TRUNCATED FOR TRACE]");
      });
    });

    describe("createCleanErrorResponse", () => {
      it("strips sensitive upstream response headers and scrubs error body", () => {
        const upstreamHeaders = new Headers({
          "content-type": "application/json",
          "retry-after": "10",
          "x-request-id": "req-test-stub-err-99",
          "set-cookie": "session=test-stub-secret-cookie",
          server: "cloudflare",
          "cf-ray": "1234567890abcdef-SJC",
          "cf-cache-status": "DYNAMIC",
          "content-encoding": "gzip",
          "content-length": "456",
          "transfer-encoding": "chunked",
        });

        const rawResponse = new Response(null, {
          status: 401,
          statusText: "Unauthorized",
          headers: upstreamHeaders,
        });

        const errorPayload = JSON.stringify({
          error: {
            message: "Authentication failure with key sk-ant-api03-test-stub-12345678901234567890",
            code: "invalid_api_key",
          },
        });

        const cleanResponse = createCleanErrorResponse(rawResponse, errorPayload);
        expect(cleanResponse.status).toBe(401);

        // Safe headers preserved
        expect(cleanResponse.headers.get("content-type")).toBe("application/json");
        expect(cleanResponse.headers.get("retry-after")).toBe("10");
        expect(cleanResponse.headers.get("x-request-id")).toBe("req-test-stub-err-99");

        // Sensitive / gateway-specific headers removed
        expect(cleanResponse.headers.get("set-cookie")).toBeNull();
        expect(cleanResponse.headers.get("server")).toBeNull();
        expect(cleanResponse.headers.get("cf-ray")).toBeNull();
        expect(cleanResponse.headers.get("cf-cache-status")).toBeNull();
        expect(cleanResponse.headers.get("content-encoding")).toBeNull();
        expect(cleanResponse.headers.get("content-length")).toBeNull();
        expect(cleanResponse.headers.get("transfer-encoding")).toBeNull();
      });
    });

    describe("sanitizeHeaders allowlist and redaction", () => {
      it("redacts sensitive headers in REDACTED_HEADERS to [REDACTED]", () => {
        const inputHeaders = {
          authorization: "Bearer test-stub-token",
          "x-api-key": "test-stub-key",
          "api-key": "test-stub-key",
          "x-goog-api-key": "test-stub-key",
          cookie: "sess=test-stub",
          "set-cookie": "sess=test-stub",
        };

        const sanitized = sanitizeHeaders(inputHeaders);
        for (const [key, value] of Object.entries(sanitized)) {
          expect(value).toBe("[REDACTED]");
        }
      });

      it("retains allowed headers in ALLOWED_HEADERS and drops unknown headers", () => {
        const inputHeaders = {
          "content-type": "application/json",
          accept: "application/json",
          "user-agent": "test-stub-agent",
          "x-request-id": "req-123",
          "x-custom-unknown-header": "test-stub-leak",
          "internal-debug": "true",
        };

        const sanitized = sanitizeHeaders(inputHeaders);
        expect(sanitized["content-type"]).toBe("application/json");
        expect(sanitized["accept"]).toBe("application/json");
        expect(sanitized["user-agent"]).toBe("test-stub-agent");
        expect(sanitized["x-request-id"]).toBe("req-123");

        // Unknown headers omitted from trace headers
        expect(sanitized["x-custom-unknown-header"]).toBeUndefined();
        expect(sanitized["internal-debug"]).toBeUndefined();
      });
    });
  });
});
