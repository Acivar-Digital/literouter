/**
 * eval/onboard.ts
 *
 * Unified Model Onboarding & Certification Orchestrator
 * (Backward-compatibility forwarding stub delegating to eval/code.ts)
 *
 * Usage:
 *   bun run eval/onboard.ts <model_name> [options]
 */

import {
  runCodeEvaluation,
  parseCliArgs,
  type CodeEvalOptions,
  type CodeEvalSummary,
} from "./code";

export { runCodeEvaluation, parseCliArgs };
export type { CodeEvalOptions, CodeEvalSummary };

if (import.meta.main) {
  const options = parseCliArgs();
  runCodeEvaluation(options)
    .then((summary) => {
      if (!summary.allPassed) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("Harness error:", err);
      process.exit(1);
    });
}
