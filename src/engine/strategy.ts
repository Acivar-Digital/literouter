import type { ParsedDirective } from "../directive/types";
import type { ProviderConfigEntry } from "../config/schema";
import type { RequestTelemetry } from "../telemetry/session";

export interface SelectedKey {
  readonly key: string;
  readonly index: number;
  readonly poolSize: number;
}

export interface DispatchContext {
  readonly reqId: string;
  readonly directive: ParsedDirective;
  readonly providerConfig: ProviderConfigEntry;
  readonly telemetry: RequestTelemetry;
  readonly clientSignal: AbortSignal;
  readonly selectedKey: SelectedKey;
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly path?: string;
}

export interface StrategyResult {
  readonly response: Response;
  readonly committed: boolean;
}

export interface ProviderExecutionStrategy {
  preDispatch?(ctx: DispatchContext, body: Record<string, unknown>): Response | null;
  resolveTarget?(ctx: DispatchContext, body: Record<string, unknown>): {
    model: string;
    upstreamUrl: string;
    extraHeaders?: Record<string, string>;
  };
  classifyFailure?(
    ctx: DispatchContext,
    status: number,
    body?: string
  ): "retry_same_target" | "advance_target" | "fail_fast";
  buildAuthHeaders?(key: string, incomingHeaders?: Headers): Record<string, string>;
  injectHeaders?(ctx: DispatchContext, headers: Record<string, string>): Record<string, string>;
}
