import type { ProviderExecutionStrategy } from "../strategy";

export class AnthropicDirectStrategy implements ProviderExecutionStrategy {
  buildAuthHeaders(key: string, _incomingHeaders?: Headers): Record<string, string> {
    return {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };
  }
}
