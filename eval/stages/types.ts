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
}

export interface StageResult {
  stageName: string;
  passed: boolean;
  score: number; // 0 - 100
  details: Record<string, unknown>;
  notes: string[];
}
