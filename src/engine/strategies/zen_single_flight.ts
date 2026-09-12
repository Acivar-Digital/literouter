import { getEnv } from "../../config/env";
import { ensureSessionHeaders } from "../session_id";
import type { DispatchContext, ProviderExecutionStrategy } from "../strategy";

export class ZenSingleFlightStrategy implements ProviderExecutionStrategy {
  injectHeaders(_ctx: DispatchContext, headers: Record<string, string>): Record<string, string> {
    const injected = { ...headers };
    ensureSessionHeaders(injected);
    return injected;
  }

  classifyFailure(
    _ctx: DispatchContext,
    status: number,
    _body?: string
  ): "retry_same_target" | "advance_target" | "fail_fast" {
    const env = getEnv();
    if (!env.ZEN_ENABLE_RETRIES) {
      return "fail_fast";
    }

    if (status === 429 || (status >= 500 && status <= 504)) {
      return "retry_same_target";
    }

    return "fail_fast";
  }
}
