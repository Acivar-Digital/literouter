/**
 * eval/stages/types.ts
 *
 * Shared data contracts and types for modular model onboarding stages.
 */

export interface StageContext {
  model: string;
  directiveKey: string;
  gatewayUrl: string;
  runs: number;
  timeoutMs?: number;
}

export interface StageResult {
  stageName: string;
  passed: boolean;
  score: number; // 0 - 100
  details: Record<string, unknown>;
  notes: string[];
  vetoTriggered?: string;
  durationMs?: number;
  completionTokens?: number;
  tokensPerSec?: number;
}

/**
 * Details key holding captured upstream thinking traces.
 * Unscored evidence only — never feeds pass/fail or role gating.
 */
export const REASONING_TRANSCRIPT_KEY = "reasoning_transcript";

/** Per-entry cap to bound report card size. */
export const MAX_REASONING_TRANSCRIPT_CHARS = 4000;

function pushTranscriptEntry(result: StageResult, text: string): void {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;
  const entry =
    trimmed.length > MAX_REASONING_TRANSCRIPT_CHARS
      ? `${trimmed.slice(0, MAX_REASONING_TRANSCRIPT_CHARS)}…[truncated]`
      : trimmed;
  const existing = result.details[REASONING_TRANSCRIPT_KEY];
  const list: string[] = Array.isArray(existing) ? (existing as string[]) : [];
  list.push(entry);
  result.details[REASONING_TRANSCRIPT_KEY] = list;
}

/**
 * Extracts `choices[0].message.reasoning_content` from a non-streaming
 * Chat Completions JSON payload and appends it to the result transcript.
 * Safe no-op on any other shape (Anthropic, errors, empty).
 */
export function collectReasoningTranscript(result: StageResult, data: unknown): void {
  if (!data || typeof data !== "object") return;
  const choices = (data as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return;
  const message = (choices[0] as Record<string, unknown> | undefined)?.message as
    | Record<string, unknown>
    | undefined;
  const reasoning = message?.reasoning_content;
  if (typeof reasoning !== "string") return;
  pushTranscriptEntry(result, reasoning);
}

/**
 * Appends a pre-assembled thinking string (e.g. accumulated SSE
 * `delta.reasoning_content` chunks) to the result transcript.
 */
export function appendReasoningTranscript(result: StageResult, text: string): void {
  pushTranscriptEntry(result, text);
}
