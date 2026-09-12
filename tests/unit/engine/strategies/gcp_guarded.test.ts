import { describe, expect, it } from "bun:test";
import { GcpGuardedStrategy } from "../../../../src/engine/strategies/gcp_guarded";
import type { DispatchContext } from "../../../../src/engine/strategy";

function createMockContext(model: string): DispatchContext {
  return {
    reqId: "req-gcp-123",
    directive: {
      provider: "gc",
      payload: "oa",
      completion: "ch",
      nuance: "no",
      model,
    } as any,
    providerConfig: {
      code: "gc",
      name: "Google Cloud Platform",
      env_key: "GCP_KEYS",
      strategy: "gcp_guarded",
      base_url: "https://generativelanguage.googleapis.com",
      auth_header: "Bearer",
      endpoints: {
        ch: "/v1beta/openai/chat/completions",
      },
    } as any,
    telemetry: {} as any,
    clientSignal: new AbortController().signal,
    selectedKey: { key: "gcp-key-1", index: 0, poolSize: 1 },
    attempt: 1,
    maxAttempts: 3,
  };
}

describe("Slice 3.4: GcpGuardedStrategy", () => {
  const strategy = new GcpGuardedStrategy();

  it("builds dual auth headers with Bearer and x-goog-api-key", () => {
    const headers = strategy.buildAuthHeaders("test-gcp-key");

    expect(headers).toEqual({
      Authorization: "Bearer test-gcp-key",
      "x-goog-api-key": "test-gcp-key",
      "Content-Type": "application/json",
    });
  });

  it("blocks non-Gemma model requests with HTTP 403 billing guardrail violation", async () => {
    const ctx = createMockContext("gemini-1.5-pro");
    const body = { model: "gemini-1.5-pro" };

    const res = strategy.preDispatch(ctx, body);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
    expect(res?.headers.get("Content-Type")).toContain("application/json");

    const json = await res?.json();
    expect(json.error).toEqual({
      code: "billing_guardrail_violation",
      message: expect.stringContaining("Billing Guardrail: Provider 'gc' is strictly restricted to free Gemma models"),
      type: "forbidden",
    });
  });

  it("blocks paid models even with google/ or gcp/ prefix", async () => {
    const ctx = createMockContext("google/claude-3-opus");
    const body = { model: "google/claude-3-opus" };

    const res = strategy.preDispatch(ctx, body);
    expect(res).not.toBeNull();
    expect(res?.status).toBe(403);
    const json = await res?.json();
    expect(json.error.code).toBe("billing_guardrail_violation");
  });

  it("allows valid Gemma model without prefix and mutates body.model", () => {
    const ctx = createMockContext("gemma-2-9b-it");
    const body: Record<string, unknown> = { model: "gemma-2-9b-it", messages: [] };

    const res = strategy.preDispatch(ctx, body);
    expect(res).toBeNull();
    expect(body.model).toBe("gemma-2-9b-it");
  });

  it("strips gcp/ or google/ prefix for valid Gemma models and normalizes body.model", () => {
    const ctx1 = createMockContext("gcp/gemma-3-27b-it");
    const body1: Record<string, unknown> = { model: "gcp/gemma-3-27b-it" };
    const res1 = strategy.preDispatch(ctx1, body1);
    expect(res1).toBeNull();
    expect(body1.model).toBe("gemma-3-27b-it");

    const ctx2 = createMockContext("google/gemma-2-2b-it");
    const body2: Record<string, unknown> = { model: "google/gemma-2-2b-it" };
    const res2 = strategy.preDispatch(ctx2, body2);
    expect(res2).toBeNull();
    expect(body2.model).toBe("gemma-2-2b-it");
  });

  it("falls back to ctx.directive.model if body.model is missing or empty", () => {
    const ctx = createMockContext("gemma-7b");
    const body: Record<string, unknown> = {};

    const res = strategy.preDispatch(ctx, body);
    expect(res).toBeNull();
    expect(body.model).toBe("gemma-7b");
  });
});
