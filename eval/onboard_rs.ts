/**
 * eval/onboard_rs.ts
 *
 * Unified Responses API (POST /v1/responses) Model Onboarding & Certification Orchestrator
 *
 * Runs a concrete, 5-stage modular validation harness for models speaking OpenAI Responses API
 * (such as Zen's `muse-spark-1.3-contributor-free` or native OpenAI Responses endpoints):
 *   [Stage 1: Wire Protocol & Long Context Hydration] (eval/stages_rs/stage1_wire.ts)
 *   [Stage 2: Strict Pydantic Schema & Retry]        (eval/stages_rs/stage2_pydantic.ts)
 *   [Stage 3: Dynamic State & Agentic Loop Durability](eval/stages_rs/stage3_agentic.ts)
 *   [Stage 4: Surgical Coding & Patch Fidelity]       (eval/stages_rs/stage4_patch.ts)
 *   [Stage 5: Security & Prompt Injection Resilience] (eval/stages_rs/stage5_security.ts)
 *
 * Usage:
 *   bun run eval/onboard_rs.ts muse-spark-1.3-contributor-free
 *   bun run eval/onboard_rs.ts <model> --stage 1
 *   bun run eval/onboard_rs.ts <model> --directive lr-zn-oo-rs-no
 *   bun run eval/onboard_rs.ts <model> --continue
 */

import type { StageContext, StageResult } from "./stages_rs/types";
import { runStage1Wire } from "./stages_rs/stage1_wire";
import { runStage2Pydantic } from "./stages_rs/stage2_pydantic";
import { runStage3Agentic } from "./stages_rs/stage3_agentic";
import { runStage4Patch } from "./stages_rs/stage4_patch";
import { runStage5Security } from "./stages_rs/stage5_security";

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
  let model = "muse-spark-1.3-contributor-free";
  let directiveKey = "lr-zn-oo-rs-no";
  let gatewayUrl = "https://localhost:7766/v1/responses";
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
Usage: bun run eval/onboard_rs.ts [model_name] [options]

Default model: muse-spark-1.3-contributor-free

Options:
  --directive <key>   Directive key (default: lr-zn-oo-rs-no)
  --url <url>         Gateway endpoint (default: https://localhost:7766/v1/responses)
  --stage <n>         Run ONLY a specific stage (1, 2, 3, 4, or 5)
  --continue          Do not abort on failure; run all stages (Diagnostic Mode)
  --runs <n>          Number of benchmark iterations (default: 2)
  -h, --help          Show this help screen
`);
}

function printFinalSummary(model: string, results: StageResult[]) {
  console.log(`\n========================================================================`);
  console.log(`📋 FINAL RESPONSES API ONBOARDING CERTIFICATION REPORT: ${model}`);
  console.log(`========================================================================`);

  let totalScore = 0;
  let allPassed = true;

  for (const res of results) {
    totalScore += res.score;
    if (!res.passed) allPassed = false;
    const statusMark = res.passed ? "\x1b[32m[PASS]\x1b[0m" : "\x1b[31m[FAIL]\x1b[0m";
    const scoreStr = `${res.score.toString().padStart(3, " ")}/100`;
    console.log(`  ${statusMark} ${res.stageName.padEnd(52, " ")} | Score: ${scoreStr}`);
    if (res.notes.length > 0 && !res.passed) {
      for (const note of res.notes) {
        console.log(`         \x1b[33m└─ ${note}\x1b[0m`);
      }
    }
  }

  const avgScore = results.length > 0 ? Math.round(totalScore / results.length) : 0;
  console.log(`------------------------------------------------------------------------`);
  console.log(`🏆 Composite Certification Score : ${avgScore}/100`);
  console.log(`🏁 Gateway Onboarding Status     : ${allPassed ? "\x1b[32mCERTIFIED FOR RESPONSES API AGENT WORKLOADS\x1b[0m" : "\x1b[31mNOT CERTIFIED (ACTION REQUIRED)\x1b[0m"}`);
  console.log(`========================================================================\n`);
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
  console.log(`🛡️  5-STAGE RESPONSES API (POST /v1/responses) CERTIFICATION HARNESS`);
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
    if (!r5.passed && !options.stageFilter && !options.continueOnFailure) {
      console.log(`\n🛑 Pipeline Aborted: Failed Stage 5 (Security & Prompt Injection).`);
      printFinalSummary(options.model, stageResults);
      process.exit(1);
    }
  }

  printFinalSummary(options.model, stageResults);

  const anyFailed = stageResults.some((r) => !r.passed);
  if (anyFailed) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("FATAL HARNESS ERROR:", err);
  process.exit(1);
});
