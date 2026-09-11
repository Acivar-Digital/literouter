/**
 * eval/stages_web/types.ts
 *
 * Data contracts and types for modular Web/Frontend Vision-Language Model evaluation stages.
 */

export interface StageContext {
  model: string;
  directiveKey: string;
  gatewayUrl: string;
  runs: number;
  imageInput?: string; // URL or data URI
  imageUri?: string;   // Backward-compatibility alias
}

export interface SubCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface StageResult {
  stageNumber: number;
  stageName: string;
  passed: boolean;
  score: number; // 0 to 100
  durationMs: number;
  checks: SubCheck[];
  rawOutput?: string;
  error?: string;
  details?: Record<string, unknown>;
  notes?: string[];
}

export type StageRunner = (ctx: StageContext) => Promise<StageResult>;

/**
 * Default verified raster PNG dashboard mockup image for Vision-Language evaluations.
 * Public raw GitHub image URL supported natively across OpenRouter, Novita, vLLM and OpenAI Vision backends.
 */
export const DEFAULT_DASHBOARD_MOCKUP =
  "https://raw.githubusercontent.com/greptimeteam/dashboard/main/tablequery.png";

/**
 * 1x1 Transparent PNG Base64 stub fallback for offline or air-gapped test harnesses.
 */
export const FALLBACK_PNG_BASE64 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

