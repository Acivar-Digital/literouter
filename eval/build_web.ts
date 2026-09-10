#!/usr/bin/env bun
/**
 * eval/build_web.ts
 *
 * Master CLI Runner for Web & Frontend Vision-Language Model Evaluation.
 *
 * Evaluates visual coding models across 5 specialized stages:
 *   [Stage 1: Structure & Visual-to-DOM Fidelity]   (eval/stages_web/stage1_structure.ts)
 *   [Stage 2: Mobile & Desktop Responsiveness]     (eval/stages_web/stage2_responsive.ts)
 *   [Stage 3: Interactivity & React State Logic]    (eval/stages_web/stage3_state.ts)
 *   [Stage 4: Code Hygiene & Anti-Hallucination]    (eval/stages_web/stage4_hygiene.ts)
 *   [Stage 5: Semantic HTML & Accessibility (A11y)](eval/stages_web/stage5_a11y.ts)
 *
 * Usage:
 *   bun run eval/build_web.ts [model_name] [options]
 *   bun run eval/build_web.ts inclusionai/ling-3.0-flash-vl:free
 *   bun run eval/build_web.ts --stage 1 --image ./mockup.png
 *   bun run eval/build_web.ts --continue --runs 3
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { StageContext, StageResult, StageRunner } from "./stages_web/types";
import { DEFAULT_DASHBOARD_MOCKUP } from "./stages_web/types";

interface CliOptions {
  model: string;
  directiveKey: string;
  gatewayUrl: string;
  image?: string;
  stage?: number;
  continueOnFailure: boolean;
  runs: number;
}

interface StageDefinition {
  stageNumber: number;
  stageName: string;
  moduleFile: string;
  candidateExports: string[];
}

const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    stageNumber: 1,
    stageName: "Structure & Visual-to-DOM Fidelity",
    moduleFile: "stage1_structure.ts",
    candidateExports: ["runStage1Structure", "runStage1", "run", "default"],
  },
  {
    stageNumber: 2,
    stageName: "Mobile & Desktop Responsiveness",
    moduleFile: "stage2_responsive.ts",
    candidateExports: ["runStage2Responsive", "runStage2", "run", "default"],
  },
  {
    stageNumber: 3,
    stageName: "Interactivity & React State Logic",
    moduleFile: "stage3_state.ts",
    candidateExports: ["runStage3State", "runStage3", "run", "default"],
  },
  {
    stageNumber: 4,
    stageName: "Code Hygiene & Anti-Hallucination",
    moduleFile: "stage4_hygiene.ts",
    candidateExports: ["runStage4Hygiene", "runStage4", "run", "default"],
  },
  {
    stageNumber: 5,
    stageName: "Semantic HTML & Accessibility (A11y)",
    moduleFile: "stage5_a11y.ts",
    candidateExports: ["runStage5A11y", "runStage5", "run", "default"],
  },
];

function printHelp(): void {
  console.log(`
\x1b[1m\x1b[36mWeb Vision-Language Model Evaluation Runner (build_web)\x1b[0m

\x1b[1mUSAGE:\x1b[0m
  bun run eval/build_web.ts [model_name] [options]

\x1b[1mARGUMENTS:\x1b[0m
  <model_name>          Model identifier (default: inclusionai/ling-3.0-flash-vl:free)

\x1b[1mOPTIONS:\x1b[0m
  --directive <key>     Gateway directive key (default: lr-or-oa-ch-no)
  --url <url>           Gateway chat completions URL (default: https://localhost:7766/v1/chat/completions)
  --image <uri_or_path> Image input (URL, data URI, or path; defaults to internal SaaS dashboard SVG)
  --stage <n>           Run ONLY stage n (1 to 5)
  --continue            Run all stages even if failure occurs (diagnostic mode)
  --runs <n>            Number of test runs/iterations per check (default: 2)
  -h, --help            Show this help menu and exit

\x1b[1mSTAGES:\x1b[0m
  Stage 1: Structure & Visual-to-DOM Fidelity
  Stage 2: Mobile & Desktop Responsiveness
  Stage 3: Interactivity & React State Logic
  Stage 4: Code Hygiene & Anti-Hallucination
  Stage 5: Semantic HTML & Accessibility (A11y)
`);
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let model = "inclusionai/ling-3.0-flash-vl:free";
  let directiveKey = "lr-or-oa-ch-no";
  let gatewayUrl = "https://localhost:7766/v1/chat/completions";
  let image: string | undefined;
  let stage: number | undefined;
  let continueOnFailure = false;
  let runs = 2;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else if (arg === "--directive" && i + 1 < args.length) {
      directiveKey = args[++i] ?? directiveKey;
    } else if (arg === "--url" && i + 1 < args.length) {
      gatewayUrl = args[++i] ?? gatewayUrl;
    } else if (arg === "--image" && i + 1 < args.length) {
      image = args[++i];
    } else if (arg === "--stage" && i + 1 < args.length) {
      const parsedStage = Number.parseInt(args[++i] ?? "", 10);
      if (!Number.isNaN(parsedStage) && parsedStage >= 1 && parsedStage <= 5) {
        stage = parsedStage;
      } else {
        console.error(`\x1b[31mError: --stage must be an integer between 1 and 5\x1b[0m`);
        process.exit(1);
      }
    } else if (arg === "--continue") {
      continueOnFailure = true;
    } else if (arg === "--runs" && i + 1 < args.length) {
      const parsedRuns = Number.parseInt(args[++i] ?? "", 10);
      if (!Number.isNaN(parsedRuns) && parsedRuns > 0) {
        runs = parsedRuns;
      }
    } else if (arg && !arg.startsWith("--")) {
      model = arg;
    }
  }

  return {
    model,
    directiveKey,
    gatewayUrl,
    image,
    stage,
    continueOnFailure,
    runs,
  };
}

async function resolveStageRunner(def: StageDefinition): Promise<StageRunner> {
  const modulePath = resolve(__dirname, "stages_web", def.moduleFile);
  if (!existsSync(modulePath)) {
    return async (ctx: StageContext): Promise<StageResult> => ({
      stageNumber: def.stageNumber,
      stageName: def.stageName,
      passed: false,
      score: 0,
      durationMs: 0,
      checks: [
        {
          name: `Module Availability (${def.moduleFile})`,
          passed: false,
          detail: `Module file not found on disk at ${modulePath}`,
        },
      ],
      error: `Stage implementation not found: ${def.moduleFile}`,
    });
  }

  const mod = await import(modulePath);
  for (const exp of def.candidateExports) {
    if (typeof mod[exp] === "function") {
      return mod[exp] as StageRunner;
    }
  }

  return async (ctx: StageContext): Promise<StageResult> => ({
    stageNumber: def.stageNumber,
    stageName: def.stageName,
    passed: false,
    score: 0,
    durationMs: 0,
    checks: [
      {
        name: `Export Resolution (${def.moduleFile})`,
        passed: false,
        detail: `None of [${def.candidateExports.join(", ")}] exported as a function from ${def.moduleFile}`,
      },
    ],
    error: `No valid stage runner function found in ${def.moduleFile}`,
  });
}

function printStageResult(res: StageResult): void {
  const statusColor = res.passed ? "\x1b[32m" : "\x1b[31m";
  const statusText = res.passed ? "PASSED" : "FAILED";
  console.log(`\n  ┌─────────────────────────────────────────────────────────────┐`);
  console.log(`  │ Stage ${res.stageNumber}: ${res.stageName.padEnd(49).slice(0, 49)} │`);
  console.log(`  │ Status: ${statusColor}${statusText.padEnd(8)}\x1b[0m  Score: \x1b[1m${res.score}/100\x1b[0m  Duration: ${res.durationMs}ms`.padEnd(68) + `│`);
  console.log(`  ├─────────────────────────────────────────────────────────────┤`);

  if (res.checks && res.checks.length > 0) {
    for (const check of res.checks) {
      const icon = check.passed ? "\x1b[32m✔\x1b[0m" : "\x1b[31m✖\x1b[0m";
      const name = check.name.padEnd(46).slice(0, 46);
      const detailStr = check.detail ? ` (${check.detail})` : "";
      console.log(`  │   ${icon} ${name}${detailStr}`.padEnd(68) + `│`);
    }
  } else {
    console.log(`  │   (No detailed sub-checks recorded)                         │`);
  }

  if (res.error) {
    console.log(`  │   \x1b[31mError: ${res.error}\x1b[0m`.padEnd(77) + `│`);
  }

  console.log(`  └─────────────────────────────────────────────────────────────┘`);
}

function printFinalReport(model: string, results: StageResult[]): boolean {
  console.log(`\n========================================================================`);
  console.log(`📊 \x1b[1mWEB VISION-LANGUAGE MODEL EVALUATION REPORT: ${model}\x1b[0m`);
  console.log(`========================================================================`);
  console.log(`| # | Stage Name                                     | Score | Status   | Duration |`);
  console.log(`|---|------------------------------------------------|-------|----------|----------|`);

  let allPassed = true;
  let totalScore = 0;
  let totalDuration = 0;

  for (const r of results) {
    totalScore += r.score;
    totalDuration += r.durationMs;
    if (!r.passed) {
      allPassed = false;
    }

    const numStr = `${r.stageNumber}`.padEnd(1);
    const nameStr = r.stageName.padEnd(46).slice(0, 46);
    const scoreStr = `${r.score}/100`.padStart(5);
    const statusStr = r.passed ? `\x1b[32mPASSED\x1b[0m  ` : `\x1b[31mFAILED\x1b[0m  `;
    const durStr = `${r.durationMs}ms`.padStart(8);

    console.log(`| ${numStr} | ${nameStr} | ${scoreStr} | ${statusStr} | ${durStr} |`);
  }

  const compositeScore = results.length > 0 ? Math.round(totalScore / results.length) : 0;
  const isProductionReady = allPassed && compositeScore >= 80;

  console.log(`========================================================================`);
  console.log(`⏱️  Total Duration   : ${totalDuration}ms`);
  console.log(`📈 Composite Score  : \x1b[1m${compositeScore}/100\x1b[0m`);

  if (isProductionReady) {
    console.log(`🏁 Final Verdict    : \x1b[1m\x1b[32mWEB PRODUCTION READY\x1b[0m`);
  } else {
    console.log(`🏁 Final Verdict    : \x1b[1m\x1b[31mNEEDS REFINEMENT\x1b[0m`);
  }
  console.log(`========================================================================\n`);

  return isProductionReady;
}

export async function main(): Promise<void> {
  const options = parseArgs();
  const selectedImage = options.image ?? DEFAULT_DASHBOARD_MOCKUP;

  const ctx: StageContext = {
    model: options.model,
    directiveKey: options.directiveKey,
    gatewayUrl: options.gatewayUrl,
    runs: options.runs,
    imageInput: selectedImage,
    imageUri: selectedImage,
  };

  const stagesToRun = options.stage
    ? STAGE_DEFINITIONS.filter((s) => s.stageNumber === options.stage)
    : STAGE_DEFINITIONS;

  console.log(`\n========================================================================`);
  console.log(`🌐 \x1b[1m\x1b[36mLITEROUTER WEB VISION-LANGUAGE BENCHMARK\x1b[0m`);
  console.log(`========================================================================`);
  console.log(`🎯 Model         : \x1b[36m${ctx.model}\x1b[0m`);
  console.log(`🔑 Directive Key : \x1b[33m${ctx.directiveKey}\x1b[0m`);
  console.log(`🚪 Gateway URL   : ${ctx.gatewayUrl}`);
  console.log(`🖼️  Image Input   : ${options.image ? options.image : "[Internal SaaS Dashboard Mockup SVG]"}`);
  console.log(`⚙️  Stage Scope   : ${options.stage ? `Stage ${options.stage} Only` : "All 5 Stages (Sequential)"}`);
  console.log(`🔂 Diagnostic    : ${options.continueOnFailure ? "Enabled (Continue on failure)" : "Disabled (Fail-Fast)"}`);
  console.log(`========================================================================`);

  const results: StageResult[] = [];

  for (const stageDef of stagesToRun) {
    console.log(`\n▶ Running Stage ${stageDef.stageNumber}: ${stageDef.stageName}...`);
    const runner = await resolveStageRunner(stageDef);
    const startTime = Date.now();
    let result: StageResult;

    try {
      result = await runner(ctx);
      if (!result.durationMs) {
        result.durationMs = Date.now() - startTime;
      }
    } catch (err) {
      result = {
        stageNumber: stageDef.stageNumber,
        stageName: stageDef.stageName,
        passed: false,
        score: 0,
        durationMs: Date.now() - startTime,
        checks: [
          {
            name: "Stage Execution",
            passed: false,
            detail: err instanceof Error ? err.message : String(err),
          },
        ],
        error: err instanceof Error ? err.message : String(err),
      };
    }

    results.push(result);
    printStageResult(result);

    if (!result.passed && !options.continueOnFailure && !options.stage) {
      console.log(`\n\x1b[31m🛑 Pipeline Aborted: Stage ${stageDef.stageNumber} failed in fail-fast mode.\x1b[0m`);
      break;
    }
  }

  const success = printFinalReport(options.model, results);
  if (!success) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("\x1b[31mExecution error in build_web:\x1b[0m", err);
    process.exit(1);
  });
}
