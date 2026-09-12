import type { DispatchContext, ProviderExecutionStrategy } from "../strategy";

function extractDirectiveModel(directive: unknown): string {
  if (directive && typeof directive === "object" && "model" in directive) {
    const val = (directive as { model?: unknown }).model;
    return typeof val === "string" ? val : "";
  }
  return "";
}

export class GcpGuardedStrategy implements ProviderExecutionStrategy {
  preDispatch(ctx: DispatchContext, body: Record<string, unknown>): Response | null {
    const fallbackModel = extractDirectiveModel(ctx.directive);
    const rawModel =
      typeof body.model === "string" && body.model.length > 0
        ? body.model
        : fallbackModel;
    const normalized = rawModel.replace(/^(?:gcp|google)\//i, "");

    if (!normalized.toLowerCase().includes("gemma")) {
      return Response.json(
        {
          error: {
            code: "billing_guardrail_violation",
            message: `Billing Guardrail: Provider 'gc' is strictly restricted to free Gemma models to prevent GCP billing overruns. Model requested: ${rawModel}`,
            type: "forbidden",
          },
        },
        { status: 403 }
      );
    }

    body.model = normalized;
    return null;
  }

  buildAuthHeaders(key: string, _incomingHeaders?: Headers): Record<string, string> {
    return {
      Authorization: `Bearer ${key}`,
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    };
  }
}
