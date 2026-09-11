#!/usr/bin/env bun
/**
 * eval/web.ts
 *
 * Master Runner for Web & Frontend Vision-Language Model Evaluation.
 *
 * Evaluates visual coding models across 5 specialized stages:
 *   [Stage 1: Structure & Visual-to-DOM Fidelity]   (eval/stages_web/stage1_structure.ts)
 *   [Stage 2: Mobile & Desktop Responsiveness]     (eval/stages_web/stage2_responsive.ts)
 *   [Stage 3: Interactivity & React State Logic]    (eval/stages_web/stage3_state.ts)
 *   [Stage 4: Code Hygiene & Anti-Hallucination]    (eval/stages_web/stage4_hygiene.ts)
 *   [Stage 5: Semantic HTML & Accessibility (A11y)](eval/stages_web/stage5_a11y.ts)
 *
 * Usage:
 *   bun run eval/web.ts [model_name] [options]
 *   bun run eval/web.ts inclusionai/ling-3.0-flash-vl:free
 *   bun run eval/web.ts --stage 1 --image ./mockup.png
 *   bun run eval/web.ts --continue --runs 3
 */

import type { StageContext, StageResult, StageRunner } from "./stages_web/types";
import {
  DEFAULT_DASHBOARD_MOCKUP,
  FALLBACK_PNG_BASE64,
  isResponsesEndpoint,
  buildStageHeaders,
  extractCompletionText,
} from "./stages_web/types";
import {
  FIXTURES,
  REMOTE_FIXTURE_URLS,
  SAAS_DASHBOARD_SVG,
  PRICING_TABLE_SVG,
  AUTH_MODAL_ERROR_SVG,
  svgToDataUri,
} from "./stages_web/fixtures";
import { runStage1Structure } from "./stages_web/stage1_structure";
import { runStage2Responsive } from "./stages_web/stage2_responsive";
import { runStage3State } from "./stages_web/stage3_state";
import { runStage4Hygiene } from "./stages_web/stage4_hygiene";
import { runStage5A11y } from "./stages_web/stage5_a11y";

export {
  DEFAULT_DASHBOARD_MOCKUP,
  FALLBACK_PNG_BASE64,
  isResponsesEndpoint,
  buildStageHeaders,
  extractCompletionText,
  FIXTURES,
  REMOTE_FIXTURE_URLS,
  SAAS_DASHBOARD_SVG,
  PRICING_TABLE_SVG,
  AUTH_MODAL_ERROR_SVG,
  svgToDataUri,
};

export interface WebEvalOptions {
  model?: string;
  directiveKey?: string;
  gatewayUrl?: string;
  image?: string;
  stage?: number;
  continueOnFailure?: boolean;
  cooldownMs?: number;
  runs?: number;
  timeoutMs?: number;
  maxTokens?: number;
  reasoningEffort?: "high" | "medium" | "none";
  silent?: boolean;
}

export interface WebEvalResult {
  model: string;
  directiveKey: string;
  gatewayUrl: string;
  allPassed: boolean;
  compositeScore: number;
  totalDurationMs: number;
  durationMs?: number;
  isProductionReady: boolean;
  stages: StageResult[];
}

export type WebPipelineResult = WebEvalResult;
export type WebStageResult = StageResult;

export interface StageDefinition {
  stageNumber: number;
  stageName: string;
  moduleFile: string;
  runner: StageRunner;
}

export const STAGE_DEFINITIONS: StageDefinition[] = [
  {
    stageNumber: 1,
    stageName: "Structure & Visual-to-DOM Fidelity",
    moduleFile: "stage1_structure.ts",
    runner: runStage1Structure,
  },
  {
    stageNumber: 2,
    stageName: "Mobile & Desktop Responsiveness",
    moduleFile: "stage2_responsive.ts",
    runner: runStage2Responsive,
  },
  {
    stageNumber: 3,
    stageName: "Interactivity & React State Logic",
    moduleFile: "stage3_state.ts",
    runner: runStage3State,
  },
  {
    stageNumber: 4,
    stageName: "Code Hygiene & Anti-Hallucination",
    moduleFile: "stage4_hygiene.ts",
    runner: runStage4Hygiene,
  },
  {
    stageNumber: 5,
    stageName: "Semantic HTML & Accessibility (A11y)",
    moduleFile: "stage5_a11y.ts",
    runner: runStage5A11y,
  },
];

export function printHelp(): void {
  console.log(`
\x1b[1m\x1b[36mWeb Vision-Language Model Evaluation Runner (web.ts)\x1b[0m

\x1b[1mUSAGE:\x1b[0m
  bun run eval/web.ts [model_name] [options]

\x1b[1mARGUMENTS:\x1b[0m
  <model_name>          Model identifier (default: inclusionai/ling-3.0-flash-vl:free)

\x1b[1mOPTIONS:\x1b[0m
  --directive <key>     Gateway directive key (default: lr-or-oa-ch-no)
  --url <url>           Gateway chat completions URL (default: https://localhost:7766/v1/chat/completions)
  --image <uri_or_path> Image input (URL, data URI, or path; defaults to internal SaaS dashboard SVG)
  --stage <n>           Run ONLY stage n (1 to 5)
  --continue            Run all stages even if failure occurs (diagnostic mode)
  --runs <n>            Number of test runs/iterations per check (default: 2)
  --cooldown <ms>       Cooldown delay between stages in milliseconds (default: 2000)
  --timeout <ms>        HTTP request timeout per stage in ms (default: 180000)
  --max-tokens <n>      Max completion tokens (default: 8192)
  --reasoning <effort>  Reasoning effort: high, medium, none
  -h, --help            Show this help menu and exit

\x1b[1mSTAGES:\x1b[0m
  Stage 1: Structure & Visual-to-DOM Fidelity
  Stage 2: Mobile & Desktop Responsiveness
  Stage 3: Interactivity & React State Logic
  Stage 4: Code Hygiene & Anti-Hallucination
  Stage 5: Semantic HTML & Accessibility (A11y)
`);
}

export function parseArgs(argv: string[] = process.argv.slice(2)): WebEvalOptions {
  const opts: WebEvalOptions = {
    continueOnFailure: false,
    cooldownMs: 2000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--directive" && i + 1 < argv.length) {
      opts.directiveKey = argv[++i];
    } else if (arg === "--url" && i + 1 < argv.length) {
      opts.gatewayUrl = argv[++i];
    } else if (arg === "--image" && i + 1 < argv.length) {
      opts.image = argv[++i];
    } else if (arg === "--cooldown" && i + 1 < argv.length) {
      const parsedCooldown = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isNaN(parsedCooldown) && parsedCooldown >= 0) opts.cooldownMs = parsedCooldown;
    } else if (arg === "--timeout" && i + 1 < argv.length) {
      const parsedTimeout = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isNaN(parsedTimeout) && parsedTimeout > 0) opts.timeoutMs = parsedTimeout;
    } else if (arg === "--max-tokens" && i + 1 < argv.length) {
      const parsedTokens = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isNaN(parsedTokens) && parsedTokens > 0) opts.maxTokens = parsedTokens;
    } else if (arg === "--reasoning" && i + 1 < argv.length) {
      const effort = argv[++i];
      if (effort === "high" || effort === "medium" || effort === "none") {
        opts.reasoningEffort = effort;
      }
    } else if (arg === "--stage" && i + 1 < argv.length) {
      const parsedStage = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isNaN(parsedStage) && parsedStage >= 1 && parsedStage <= 5) {
        opts.stage = parsedStage;
      } else {
        console.error(`\x1b[31mError: --stage must be an integer between 1 and 5\x1b[0m`);
        process.exit(1);
      }
    } else if (arg === "--continue") {
      opts.continueOnFailure = true;
    } else if (arg === "--runs" && i + 1 < argv.length) {
      const parsedRuns = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isNaN(parsedRuns) && parsedRuns > 0) opts.runs = parsedRuns;
    } else if (!arg.startsWith("--")) {
      opts.model = arg;
    }
  }

  return opts;
}

export function normalizeWebOptions(opts: WebEvalOptions = {}): Required<Omit<WebEvalOptions, "stage" | "image" | "reasoningEffort">> & {
  image?: string;
  stage?: number;
  reasoningEffort?: "high" | "medium" | "none";
} {
  let model = opts.model ?? "inclusionai/ling-3.0-flash-vl:free";
  let directiveKey = opts.directiveKey ?? "lr-or-oa-ch-no";
  let gatewayUrl = opts.gatewayUrl ?? "https://localhost:7766/v1/chat/completions";
  const continueOnFailure = opts.continueOnFailure ?? false;
  const cooldownMs = opts.cooldownMs ?? 2000;
  const runs = opts.runs ?? 2;
  const timeoutMs = opts.timeoutMs ?? 180000;
  const maxTokens = opts.maxTokens ?? 8192;
  const silent = opts.silent ?? false;

  if (model.includes("muse")) {
    if (directiveKey === "lr-or-oa-ch-no") {
      directiveKey = "lr-zn-oo-rs-no";
    }
    if (gatewayUrl === "https://localhost:7766/v1/chat/completions") {
      gatewayUrl = "https://localhost:7766/v1/responses";
    }
  } else if (directiveKey.includes("-rs-") && gatewayUrl === "https://localhost:7766/v1/chat/completions") {
    gatewayUrl = "https://localhost:7766/v1/responses";
  }

  return {
    model,
    directiveKey,
    gatewayUrl,
    image: opts.image,
    stage: opts.stage,
    continueOnFailure,
    cooldownMs,
    runs,
    timeoutMs,
    maxTokens,
    reasoningEffort: opts.reasoningEffort,
    silent,
  };
}

export function printStageResult(res: StageResult): void {
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

export function printFinalReport(model: string, results: StageResult[]): boolean {
  console.log(`\n========================================================================`);
  console.log(`📊 \x1b[1mWEB VISION-LANGUAGE MODEL EVALUATION REPORT: ${model}\x1b[0m`);
  console.log(`========================================================================`);
  console.log(`| # | Stage Name                                     | Score | Status   | Duration |`);
  console.log(`|---|------------------------------------------------|-------|----------|----------|`);

  let allPassed = results.length > 0;
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

function printHeader(ctx: StageContext, opts: ReturnType<typeof normalizeWebOptions>): void {
  console.log(`\n========================================================================`);
  console.log(`🌐 \x1b[1m\x1b[36mLITEROUTER WEB VISION-LANGUAGE BENCHMARK\x1b[0m`);
  console.log(`========================================================================`);
  console.log(`🎯 Model         : \x1b[36m${ctx.model}\x1b[0m`);
  console.log(`🔑 Directive Key : \x1b[33m${ctx.directiveKey}\x1b[0m`);
  console.log(`🚪 Gateway URL   : ${ctx.gatewayUrl}`);
  console.log(`🖼️  Image Input   : ${opts.image ? opts.image : "[Internal SaaS Dashboard Mockup SVG]"}`);
  console.log(`⚙️  Stage Scope   : ${opts.stage ? `Stage ${opts.stage} Only` : "All 5 Stages (Sequential)"}`);
  console.log(`⏱️  Cooldown      : ${opts.cooldownMs}ms`);
  console.log(`🔂 Diagnostic    : ${opts.continueOnFailure ? "Enabled (Continue on failure)" : "Disabled (Fail-Fast)"}`);
  console.log(`========================================================================`);
}

async function executeStage(
  stageDef: StageDefinition,
  ctx: StageContext
): Promise<StageResult> {
  const startTime = Date.now();
  try {
    const res = await stageDef.runner(ctx);
    if (!res.durationMs || res.durationMs <= 0) {
      res.durationMs = Date.now() - startTime;
    }
    return res;
  } catch (err) {
    return {
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
}

/**
 * Programmatic entrypoint for web vision-language evaluation.
 */
export async function runWebEvaluation(options: WebEvalOptions = {}): Promise<WebEvalResult> {
  const norm = normalizeWebOptions(options);
  const selectedImage = norm.image ?? DEFAULT_DASHBOARD_MOCKUP;

  const ctx: StageContext = {
    model: norm.model,
    directiveKey: norm.directiveKey,
    gatewayUrl: norm.gatewayUrl,
    runs: norm.runs,
    imageInput: selectedImage,
    imageUri: selectedImage,
    timeoutMs: norm.timeoutMs,
    maxTokens: norm.maxTokens,
    reasoningEffort: norm.reasoningEffort,
  };

  const stagesToRun = norm.stage
    ? STAGE_DEFINITIONS.filter((s) => s.stageNumber === norm.stage)
    : STAGE_DEFINITIONS;

  if (!norm.silent) {
    printHeader(ctx, norm);
  }

  const results: StageResult[] = [];

  let isFirstStage = true;
  for (const stageDef of stagesToRun) {
    if (!isFirstStage && norm.cooldownMs > 0) {
      if (!norm.silent) {
        console.log(`[Web Eval] Sleeping ${norm.cooldownMs}ms between stages...`);
      }
      await Bun.sleep(norm.cooldownMs);
    }
    isFirstStage = false;

    if (!norm.silent) {
      console.log(`\n▶ Running Stage ${stageDef.stageNumber}: ${stageDef.stageName}...`);
    }

    const result = await executeStage(stageDef, ctx);
    results.push(result);

    if (!norm.silent) {
      printStageResult(result);
    }

    if (!result.passed && !norm.continueOnFailure && !norm.stage) {
      if (!norm.silent) {
        console.log(`\n\x1b[31m🛑 Pipeline Aborted: Stage ${stageDef.stageNumber} failed in fail-fast mode.\x1b[0m`);
      }
      break;
    }
  }

  let allPassed = results.length > 0;
  let totalScore = 0;
  let totalDuration = 0;

  for (const r of results) {
    totalScore += r.score;
    totalDuration += r.durationMs;
    if (!r.passed) {
      allPassed = false;
    }
  }

  const compositeScore = results.length > 0 ? Math.round(totalScore / results.length) : 0;
  const isProductionReady = allPassed && compositeScore >= 80;

  if (!norm.silent) {
    printFinalReport(norm.model, results);
  }

  return {
    model: norm.model,
    directiveKey: norm.directiveKey,
    gatewayUrl: norm.gatewayUrl,
    allPassed,
    compositeScore,
    totalDurationMs: totalDuration,
    durationMs: totalDuration,
    isProductionReady,
    stages: results,
  };
}

export async function main(): Promise<void> {
  const options = parseArgs();
  const result = await runWebEvaluation(options);
  if (!result.isProductionReady) {
    process.exit(1);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error("\x1b[31mExecution error in web eval:\x1b[0m", err);
    process.exit(1);
  });
}
