import {
  getNativeChain,
  getNativeTierIndex,
  setNativeTierIndex,
} from "../../handlers/google_native";
import type { DispatchContext, ProviderExecutionStrategy } from "../strategy";

function extractDirectiveModel(directive: unknown): string {
  if (directive && typeof directive === "object" && "model" in directive) {
    const val = (directive as { model?: unknown }).model;
    return typeof val === "string" ? val : "";
  }
  return "";
}

export class NativeCascadeStrategy implements ProviderExecutionStrategy {
  private readonly chains?: Record<string, readonly string[]>;

  constructor(chains?: Record<string, readonly string[]>) {
    this.chains = chains;
  }

  private resolveChain(model: string): readonly string[] | undefined {
    if (this.chains) {
      return this.chains[model];
    }
    const dynamicChain = getNativeChain(model);
    return dynamicChain.length > 0 ? dynamicChain : undefined;
  }

  private buildGoogleUrl(ctx: DispatchContext, model: string): string {
    const base = ctx.providerConfig.base_url.replace(/\/+$/, "");
    const completionCode =
      ctx.directive.type === "direct" ? ctx.directive.completion : "gc";
    const endpointTemplate = ctx.providerConfig.endpoints[completionCode];
    if (!endpointTemplate) {
      throw new Error(
        `No endpoint for completion code "${completionCode}" on provider "${ctx.providerConfig.code}"`
      );
    }
    const path = endpointTemplate.replace("{model}", model);
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    return `${base}${normalizedPath}`;
  }

  resolveTarget(
    ctx: DispatchContext,
    body: Record<string, unknown>
  ): {
    model: string;
    upstreamUrl: string;
    extraHeaders?: Record<string, string>;
  } {
    const fallbackModel = extractDirectiveModel(ctx.directive);
    const requestedModel =
      typeof body.model === "string" && body.model.length > 0
        ? body.model
        : fallbackModel;
    const chain = this.resolveChain(requestedModel);

    if (!chain || chain.length === 0) {
      return {
        model: requestedModel,
        upstreamUrl: this.buildGoogleUrl(ctx, requestedModel),
      };
    }

    const tierIdx = getNativeTierIndex(requestedModel);
    const resolvedModel =
      chain[((tierIdx % chain.length) + chain.length) % chain.length] ?? requestedModel;

    return {
      model: resolvedModel,
      upstreamUrl: this.buildGoogleUrl(ctx, resolvedModel),
      extraHeaders: {
        "x-literouter-chain": requestedModel,
        "x-literouter-tier": `${tierIdx + 1}/${chain.length}`,
      },
    };
  }

  classifyFailure(
    ctx: DispatchContext,
    status: number,
    _body?: string
  ): "retry_same_target" | "advance_target" | "fail_fast" {
    const requestedModel = extractDirectiveModel(ctx.directive);
    const chain = this.resolveChain(requestedModel);

    if (chain && chain.length > 0 && status === 404) {
      const currentIdx = getNativeTierIndex(requestedModel);
      const nextIdx = (currentIdx + 1) % chain.length;
      setNativeTierIndex(requestedModel, nextIdx);
      return "advance_target";
    }

    if (status === 429 || (status >= 500 && status <= 504)) {
      return "retry_same_target";
    }

    return "fail_fast";
  }

  buildAuthHeaders(key: string, _incomingHeaders?: Headers): Record<string, string> {
    return {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    };
  }
}
