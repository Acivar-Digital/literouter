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
  timeoutMs?: number;  // Per-stage HTTP timeout in ms (default: 120000)
  maxTokens?: number;  // Max completion tokens (default: 8192)
  reasoningEffort?: "high" | "medium" | "none"; // Reasoning effort for thinking models
  extraPayload?: Record<string, unknown>;
  headers?: Record<string, string>;
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

export function isResponsesEndpoint(gatewayUrl: string, directiveKey: string): boolean {
  return gatewayUrl.includes("/responses") || directiveKey.includes("-rs-");
}

export function buildStageHeaders(ctx: StageContext): Record<string, string> {
  const masterKey = process.env.LITEROUTER_AUTH_KEY;
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${ctx.directiveKey}`,
    "User-Agent": "OpenCode/1.18.29",
    "X-Title": "OpenCode",
    "HTTP-Referer": "https://opencode.ai",
    ...(masterKey ? { "x-literouter-key": masterKey } : {}),
    ...(ctx.headers ?? {}),
  };
}

export function extractCompletionText(data: any): string {
  if (!data) return "";
  if (data.choices?.[0]?.message?.content) {
    return data.choices[0].message.content;
  }
  if (Array.isArray(data.output)) {
    const msgText = data.output
      .filter((item: any) => item && item.type === "message")
      .flatMap((msg: any) => msg.content || [])
      .filter((part: any) => part && (part.type === "text" || part.type === "output_text"))
      .map((part: any) => part.text || "")
      .join("");
    if (msgText.trim().length > 0) {
      return msgText;
    }

    // Fallback: check function_call arguments (e.g. write tool content)
    for (const item of data.output) {
      if (item && item.type === "function_call" && item.arguments) {
        try {
          const parsed = JSON.parse(item.arguments);
          if (typeof parsed.content === "string") return parsed.content;
          if (typeof parsed.code === "string") return parsed.code;
        } catch {
          // ignore
        }
      }
    }
  }
  if (typeof data.output_text === "string") {
    return data.output_text;
  }
  return "";
}

