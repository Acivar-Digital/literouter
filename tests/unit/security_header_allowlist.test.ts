import { describe, expect, it } from "bun:test";
import { parseDirective } from "../../src/directive/parser";
import { OpenAIChatTransformer } from "../../src/transformers/openai_chat";
import { OpenAIResponsesTransformer } from "../../src/transformers/openai_responses";
import { mergeOutboundHeaders, SAFE_CLIENT_PASS_HEADERS } from "../../src/engine/dispatch";

describe("Step 2: Outbound Client Header Allowlist", () => {
  const directive = parseDirective("lr-or-oa-ch-no")!;
  const responsesDirective = parseDirective("lr-or-oa-rs-no")!;

  it("OpenAIChatTransformer allows safe headers and blocks sensitive client headers", () => {
    const transformer = new OpenAIChatTransformer();
    const headers = new Headers({
      "user-agent": "test-agent/1.0",
      "session-id": "sess-xyz-123",
      "x-request-id": "req-abc-999",
      "anthropic-version": "2023-06-01",
      cookie: "session=sensitive_secret_token",
      authorization: "Bearer sensitive_master_key",
      "x-custom-internal": "forbidden_data",
      "x-forwarded-for": "1.2.3.4",
    });

    const result = transformer.transformClientToWire(
      { model: "test-model", messages: [{ role: "user", content: "hello" }] },
      directive,
      headers
    );

    // Safe headers should pass
    expect(result.headers["user-agent"]).toBe("test-agent/1.0");
    expect(result.headers["session-id"]).toBe("sess-xyz-123");
    expect(result.headers["x-request-id"]).toBe("req-abc-999");
    expect(result.headers["anthropic-version"]).toBe("2023-06-01");
    expect(result.headers["content-type"]).toBe("application/json");

    // Sensitive / un-allowlisted headers must NOT pass
    expect(result.headers["cookie"]).toBeUndefined();
    expect(result.headers["authorization"]).toBeUndefined();
    expect(result.headers["x-custom-internal"]).toBeUndefined();
    expect(result.headers["x-forwarded-for"]).toBeUndefined();
  });

  it("OpenAIResponsesTransformer allows safe headers and blocks sensitive client headers", () => {
    const transformer = new OpenAIResponsesTransformer();
    const headers = new Headers({
      "user-agent": "test-agent/2.0",
      "x-title": "My Research Session",
      "http-referer": "https://example.com/research",
      cookie: "uid=secret",
      authorization: "Bearer secret",
      "x-internal-secret": "leak",
    });

    const result = transformer.transformClientToWire(
      { model: "test-model", input: "hello" },
      responsesDirective,
      headers
    );

    expect(result.headers["user-agent"]).toBe("test-agent/2.0");
    expect(result.headers["x-title"]).toBe("My Research Session");
    expect(result.headers["http-referer"]).toBe("https://example.com/research");
    expect(result.headers["cookie"]).toBeUndefined();
    expect(result.headers["authorization"]).toBeUndefined();
    expect(result.headers["x-internal-secret"]).toBeUndefined();
  });

  it("mergeOutboundHeaders filters unsafe client payloadHeaders while retaining provider auth", () => {
    const authHeaders = { Authorization: "Bearer upstream-provider-key-real" };
    const injectedHeaders = { "x-injected": "gateway-internal" };
    const payloadHeaders = {
      "user-agent": "client-ua",
      "x-request-id": "req-1",
      cookie: "stolen-cookie",
      authorization: "Bearer client-secret-attempt",
      "x-forwarded-for": "1.2.3.4",
      "proxy-authorization": "secret-proxy",
    };

    const merged = mergeOutboundHeaders(authHeaders, injectedHeaders, undefined, undefined, payloadHeaders);

    // Provider auth is preserved from authHeaders
    expect(merged.Authorization || merged.authorization).toBe("Bearer upstream-provider-key-real");
    expect(merged["x-injected"]).toBe("gateway-internal");
    expect(merged["user-agent"]).toBe("client-ua");
    expect(merged["x-request-id"]).toBe("req-1");

    // Unsafe client headers from payloadHeaders are filtered out
    expect(merged["cookie"]).toBeUndefined();
    expect(merged["authorization"] && merged["authorization"] !== "Bearer upstream-provider-key-real").toBeFalsy();
    expect(merged["x-forwarded-for"]).toBeUndefined();
    expect(merged["proxy-authorization"]).toBeUndefined();
  });
});
