import type { ProviderExecutionStrategy } from "../strategy";

export class StandardStrategy implements ProviderExecutionStrategy {
  buildAuthHeaders(key: string, _incomingHeaders?: Headers): Record<string, string> {
    return {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }
}
