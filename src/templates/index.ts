/**
 * src/templates/index.ts
 *
 * Provider template registry.
 * Each template knows how to inject thinking/reasoning params
 * into the request body for its specific upstream API.
 */

import { openrouterTemplate } from "./openrouter.js";
import { geminiTemplate } from "./gemini.js";
import type { ProviderTemplate, TemplateName } from "./types.js";

// Re-export types for consumers
export type { ThinkingMode, TemplateName, ProviderTemplate } from "./types.js";

const registry: Record<TemplateName, ProviderTemplate> = {
  openrouter: openrouterTemplate,
  gemini: geminiTemplate,
};

/**
 * Returns the provider template matching the given name.
 * Throws if the template name is not recognized.
 */
export function getTemplate(name: string): ProviderTemplate {
  const template = registry[name as TemplateName];
  if (!template) {
    const valid = Object.keys(registry).join(", ");
    throw new Error(
      `Unknown template "${name}". Valid templates: ${valid}`
    );
  }
  return template;
}
