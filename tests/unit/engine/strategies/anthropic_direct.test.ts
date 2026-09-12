import { describe, expect, it } from "bun:test";
import { AnthropicDirectStrategy } from "../../../../src/engine/strategies/anthropic_direct";
import type { ProviderExecutionStrategy } from "../../../../src/engine/strategy";

describe("Slice 3.4: AnthropicDirectStrategy", () => {
  it("implements ProviderExecutionStrategy interface", () => {
    const strategy: ProviderExecutionStrategy = new AnthropicDirectStrategy();
    expect(strategy).toBeDefined();
  });

  it("builds auth headers with x-api-key and anthropic-version 2023-06-01", () => {
    const strategy = new AnthropicDirectStrategy();
    const headers = strategy.buildAuthHeaders("sk-ant-api03-test-secret");

    expect(headers).toEqual({
      "x-api-key": "sk-ant-api03-test-secret",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    });
  });

  it("ignores incoming headers and consistently emits standard Anthropic auth headers", () => {
    const strategy = new AnthropicDirectStrategy();
    const incoming = new Headers({
      Authorization: "Bearer client-auth",
      "anthropic-version": "2020-01-01",
    });

    const headers = strategy.buildAuthHeaders("upstream-ant-key", incoming);

    expect(headers).toEqual({
      "x-api-key": "upstream-ant-key",
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    });
  });
});
