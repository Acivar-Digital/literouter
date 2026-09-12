import { describe, expect, it } from "bun:test";
import { StandardStrategy } from "../../../../src/engine/strategies/standard";
import type { ProviderExecutionStrategy } from "../../../../src/engine/strategy";

describe("Slice 3.3: StandardStrategy", () => {
  it("implements ProviderExecutionStrategy interface", () => {
    const strategy: ProviderExecutionStrategy = new StandardStrategy();
    expect(strategy).toBeDefined();
  });

  it("builds default auth headers with Bearer token and JSON content-type", () => {
    const strategy = new StandardStrategy();
    const headers = strategy.buildAuthHeaders("test-bearer-token");

    expect(headers).toEqual({
      Authorization: "Bearer test-bearer-token",
      "Content-Type": "application/json",
    });
  });

  it("ignores incomingHeaders and consistently returns standard Bearer headers", () => {
    const strategy = new StandardStrategy();
    const incoming = new Headers({
      Authorization: "Bearer client-key",
      "X-Custom": "ignore-me",
    });
    const headers = strategy.buildAuthHeaders("upstream-key-999", incoming);

    expect(headers).toEqual({
      Authorization: "Bearer upstream-key-999",
      "Content-Type": "application/json",
    });
  });
});
