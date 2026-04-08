/**
 * src/templates/openrouter.ts
 *
 * OpenRouter provider template.
 * Injects `reasoning.effort` for thinking mode control.
 *
 * Docs: https://openrouter.ai/docs/api/reference/parameters
 * OpenRouter uses { reasoning: { effort: "high"|"medium"|"low"|"none" } }
 */

import type { ProviderTemplate, ThinkingMode } from "./types.js";

// OpenRouter effort maps 1:1 with our config values
const EFFORT_MAP: Record<ThinkingMode, string> = {
  high: "high",
  medium: "medium",
  low: "low",
};

export const openrouterTemplate: ProviderTemplate = {
  name: "openrouter",

  applyTemplateConfig(body: Record<string, unknown>, options: { mode: ThinkingMode | null; provider?: string | null }): void {
    // Default to streaming if not specified
    body.stream = body.stream ?? true;

    if (options.mode) {
      body.reasoning = {
        ...(typeof body.reasoning === "object" && body.reasoning !== null
          ? body.reasoning
          : {}),
        effort: EFFORT_MAP[options.mode],
      };
    }

    if (options.provider) {
      body.provider = {
        // Just passes the exact string requested by the user directly to OpenRouter's provider order
        order: [options.provider],
      };
    }
  },
};
