import type { ProviderExecutionStrategy, DispatchContext } from "../strategy";
import { buildZenHeaders } from "../zen";

export class ZenStrategy implements ProviderExecutionStrategy {
  buildAuthHeaders(key: string, incomingHeaders?: Headers): Record<string, string> {
    const zenHeaders = buildZenHeaders(incomingHeaders);
    return {
      ...zenHeaders,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
  }

  injectHeaders(_ctx: DispatchContext, headers: Record<string, string>): Record<string, string> {
    return headers;
  }
}
