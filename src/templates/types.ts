/**
 * src/templates/types.ts
 *
 * Shared type definitions for provider templates.
 * Extracted to avoid circular imports between index.ts and individual templates.
 */

export type ThinkingMode = "high" | "medium" | "low";
export type TemplateName = "openrouter" | "gemini";

export interface ProviderTemplate {
  name: string;

  /** Optional: Override the full target URL (e.g. for native APIs with custom endpoints). */
  targetUrlCallback?(baseUrl: string, body: any, apiKey: string): string;

  /** Optional: Transform the entire request from OpenAI format to native format. */
  transformRequest?(body: any, configOptions: { mode: ThinkingMode | null; provider?: string | null }): any;

  /** Optional: Transform a native chunk back into an OpenAI response chunk (streaming). */
  transformChunk?(chunkJson: any, metadata: { model?: string; id?: string }): any;

  /** Optional: Transform a full native response JSON back into an OpenAI response (non-streaming). */
  transformResponse?(responseJson: any, metadata: { model?: string; id?: string }): any;

  /** Optional: Clean or modify headers for the specific provider. */
  applyHeaders?(headers: Record<string, string>, apiKey: string): void;

  /** Mutates the request body in-place to add provider-specific config like streaming and thinking. */
  applyTemplateConfig(body: Record<string, unknown>, configOptions: { mode: ThinkingMode | null; provider?: string | null }): void;
}
