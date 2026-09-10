/**
 * eval/onboard.ts
 *
 * Unified Model Onboarding & Certification Orchestrator
 *
 * Runs a concrete, 5-stage modular validation harness:
 *   [Stage 1: Wire Protocol & Long Context Hydration] (eval/stages/stage1_wire.ts)
 *   [Stage 2: Strict Pydantic AI 2.0 Types & Retry]   (eval/stages/stage2_pydantic.ts)
 *   [Stage 3: Dynamic State & Agentic Loop Durability](eval/stages/stage3_agentic.ts)
 *   [Stage 4: Surgical Coding & Patch Fidelity]       (eval/stages/stage4_patch.ts)
 *   [Stage 5: Security & Injection Resilience]        (eval/stages/stage5_security.ts)
 *
 * Usage:
 *   bun run eval/onboard.ts <model_name>
 *   bun run eval/onboard.ts nex-agi/nex-n2.5-pro:free
 *   bun run eval/onboard.ts <model> --stage 4
 *   bun run eval/onboard.ts <model> --directive lr-or-oa-ch-no
 */

import type { StageContext, StageResult } from "./stages/types";
import { runStage1Wire } from "./stages/stage1_wire";
import { runStage2Pydantic } from "./stages/stage2_pydantic";
import { runStage3Agentic } from "./stages/stage3_agentic";
import { runStage4Patch } from "./stages/stage4_patch";
import { runStage5Security } from "./stages/stage5_security";

interface OnboardOptions {
  model: string;
  directiveKey: string;
  gatewayUrl: string;
  stageFilter?: number;
  runs: number;
  continueOnFailure: boolean;
}

function parseCliArgs(): OnboardOptions {
  const args = process.argv.slice(2);
  let model = "nex-agi/nex-n2.5-pro:free";
  let directiveKey = "lr-or-oa-ch-no";
  let gatewayUrl = "https://localhost:7766/v1/chat/completions";
  let stageFilter: number | undefined;
  let runs = 2;
  let continueOnFailure = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg === "--directive" && i + 1 < args.length) {
      const val = args[++i];
      if (val) directiveKey = val;
    } else if (arg === "--url" && i + 1 < args.length) {
      const val = args[++i];
      if (val) gatewayUrl = val;
    } else if (arg === "--stage" && i + 1 < args.length) {
      const val = args[++i];
      if (val) stageFilter = parseInt(val, 10);
    } else if (arg === "--runs" && i + 1 < args.length) {
      const val = args[++i];
      if (val) runs = parseInt(val, 10);
    } else if (arg === "--continue" || arg === "--no-fail-fast") {
      continueOnFailure = true;
    } else if (arg && !arg.startsWith("--")) {
      model = arg;
    }
  }

  return {
    model,
    directiveKey,
    gatewayUrl,
    stageFilter,
    runs,
    continueOnFailure,
  };
}

function printHelp() {
  console.log(`
Usage: bun run eval/onboard.ts <model_name> [options]

Options:
  --directive <key>   Directive key (default: lr-or-oa-ch-no)
  --url <url>         Gateway endpoint (default: https://localhost:7766/v1/chat/completions)
  --stage <n>         Run ONLY a specific stage (1, 2, 3, 4, or 5)
  --continue          Do not abort on failure; run all stages (Diagnostic Mode)
  --runs <n>          Number of benchmark iterations (default: 2)
  -h, --help          Show this help screen
`);
}

async function main() {
  const options = parseCliArgs();
  const ctx: StageContext = {
    model: options.model,
    directiveKey: options.directiveKey,
    gatewayUrl: options.gatewayUrl,
    runs: options.runs,
  };

  console.log(`\n========================================================================`);
  console.log(`🛡️  5-STAGE HARDENED MODEL CERTIFICATION HARNESS`);
  console.log(`========================================================================`);
  console.log(`🎯 Target Model    : \x1b[36m${ctx.model}\x1b[0m`);
  console.log(`🔑 Directive Key   : \x1b[33m${ctx.directiveKey}\x1b[0m`);
  console.log(`🌐 Gateway Origin  : ${ctx.gatewayUrl}`);
  console.log(`⚙️  Execution Mode  : ${options.stageFilter ? `Isolated Stage ${options.stageFilter}` : (options.continueOnFailure ? "All Stages (Diagnostic Mode)" : "Full Sequential Pipeline (Fail-Fast)")}`);
  console.log(`========================================================================`);

  const stageResults: StageResult[] = [];

  // Stage 1
  if (!options.stageFilter || options.stageFilter === 1) {
    const r1 = await runStage1Wire(ctx);
    stageResults.push(r1);
    if (!r1.passed && !options.stageFilter && !options.continueOnFailure) {
      console.log(`\n🛑 Pipeline Aborted: Failed Stage 1 (Wire & Hydration).`);
      printFinalSummary(options.model, stageResults);
      process.exit(1);
    }
  }

  // Stage 2
  if (!options.stageFilter || options.stageFilter === 2) {
    const r2 = await runStage2Pydantic(ctx);
    stageResults.push(r2);
    if (!r2.passed && !options.stageFilter && !options.continueOnFailure) {
      console.log(`\n🛑 Pipeline Aborted: Failed Stage 2 (Pydantic Schema & Retry).`);
      printFinalSummary(options.model, stageResults);
      process.exit(1);
    }
  }

  // Stage 3
  if (!options.stageFilter || options.stageFilter === 3) {
    const r3 = await runStage3Agentic(ctx);
    stageResults.push(r3);
    if (!r3.passed && !options.stageFilter && !options.continueOnFailure) {
      console.log(`\n🛑 Pipeline Aborted: Failed Stage 3 (Agentic Loop Durability).`);
      printFinalSummary(options.model, stageResults);
      process.exit(1);
    }
  }

  // Stage 4
  if (!options.stageFilter || options.stageFilter === 4) {
    const r4 = await runStage4Patch(ctx);
    stageResults.push(r4);
    if (!r4.passed && !options.stageFilter && !options.continueOnFailure) {
      console.log(`\n🛑 Pipeline Aborted: Failed Stage 4 (Surgical Coding & Patch Fidelity).`);
      printFinalSummary(options.model, stageResults);
      process.exit(1);
    }
  }

  // Stage 5
  if (!options.stageFilter || options.stageFilter === 5) {
    const r5 = await runStage5Security(ctx);
    stageResults.push(r5);
  }

  printFinalSummary(options.model, stageResults);
}

function printFinalSummary(model: string, results: StageResult[]) {
  console.log(`\n========================================================================`);
  console.log(`📊 CERTIFICATION AUDIT REPORT: \x1b[1m${model}\x1b[0m`);
  console.log(`========================================================================`);
  console.log(`| Stage Name                                           | Score | Status |`);
  console.log(`|------------------------------------------------------|-------|--------|`);

  let allPassed = true;
  for (const r of results) {
    const padName = r.stageName.padEnd(52).slice(0, 52);
    const padScore = `${r.score}/100`.padStart(5);
    const statusStr = r.passed ? `\x1b[32mPASSED\x1b[0m` : `\x1b[31mFAILED\x1b[0m`;
    console.log(`| ${padName} | ${padScore} | ${statusStr} |`);
    if (!r.passed) allPassed = false;
  }

  console.log(`========================================================================`);
  if (allPassed) {
    console.log(`🏁 FINAL VERDICT: \x1b[32mCERTIFIED PRODUCTION-READY FOR OPENCODE 2 & CLAUDE CODE\x1b[0m`);
  } else {
    console.log(`🏁 FINAL VERDICT: \x1b[31mREJECTED - FAILED CRITICAL CERTIFICATION GATES\x1b[0m`);
  }
  console.log(`========================================================================\n`);
}

main().catch((err) => {
  console.error("Harness error:", err);
  process.exit(1);
});
