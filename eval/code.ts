/**
 * eval/code.ts
 *
 * Unified Coding & Agentic Capability Test Suite
 * Supports both Chat Completions and Responses API wire protocols.
 *
 * Usage:
 *   bun run eval/code.ts <model_name>
 *   bun run eval/code.ts muse-spark-1.3-contributor-free --wire rs
 *   bun run eval/code.ts <model> --stage 4
 *   bun run eval/code.ts <model> --directive lr-or-oa-ch-no
 */

import type { StageContext, StageResult } from "./stages/types";
import { runStage1Wire as runStage1WireChat } from "./stages/stage1_wire";
import { runStage2Pydantic as runStage2PydanticChat } from "./stages/stage2_pydantic";
import { runStage3Agentic as runStage3AgenticChat } from "./stages/stage3_agentic";
import { runStage4Patch as runStage4PatchChat } from "./stages/stage4_patch";
import { runStage5Security as runStage5SecurityChat } from "./stages/stage5_security";

import { runStage1Wire as runStage1WireRs } from "./stages_rs/stage1_wire";
import { runStage2Pydantic as runStage2PydanticRs } from "./stages_rs/stage2_pydantic";
import { runStage3Agentic as runStage3AgenticRs } from "./stages_rs/stage3_agentic";
import { runStage4Patch as runStage4PatchRs } from "./stages_rs/stage4_patch";
import { runStage5Security as runStage5SecurityRs } from "./stages_rs/stage5_security";

export interface CodeEvalOptions {
  model?: string;
  directiveKey?: string;
  gatewayUrl?: string;
  wire?: "chat" | "responses" | "auto";
  stageFilter?: number;
  runs?: number;
  continueOnFailure?: boolean;
  cooldownMs?: number;
  timeoutMs?: number;
}

export interface CodeEvalSummary {
  model: string;
  wire: "chat" | "responses";
  directiveKey: string;
  gatewayUrl: string;
  allPassed: boolean;
  results: StageResult[];
}

export function printHelp(): void {
  console.log(`
Usage: bun run eval/code.ts [model_name] [options]

Options:
  --wire <chat|rs>    Wire protocol ('chat' or 'rs'/'responses', auto-detected if omitted)
  --directive <key>   Directive key (default: lr-or-oa-ch-no for chat, lr-zn-oo-rs-no for responses)
  --url <url>         Gateway endpoint
  --stage <n>         Run ONLY a specific stage (1, 2, 3, 4, or 5)
  --continue          Do not abort on failure; run all stages (Diagnostic Mode)
  --runs <n>          Number of benchmark iterations (default: 2)
  --cooldown <ms>     Cooldown delay between stages in milliseconds (default: 2000)
  --timeout <ms>      Stage execution timeout in milliseconds (default: 120000)
  -h, --help          Show this help screen
`);
}

function detectIsResponses(options: CodeEvalOptions): boolean {
  if (options.wire === "responses") return true;
  if (options.wire === "chat") return false;
  if (options.model?.toLowerCase().includes("muse")) return true;
  if (options.directiveKey?.includes("-rs-")) return true;
  if (options.gatewayUrl?.includes("/v1/responses")) return true;
  return false;
}

export function resolveWireAndDefaults(options: CodeEvalOptions): {
  wire: "chat" | "responses";
  model: string;
  directiveKey: string;
  gatewayUrl: string;
} {
  const isRs = detectIsResponses(options);
  if (isRs) {
    return {
      wire: "responses",
      model: options.model ?? "muse-spark-1.3-contributor-free",
      directiveKey: options.directiveKey ?? "lr-zn-oo-rs-no",
      gatewayUrl: options.gatewayUrl ?? "https://localhost:7766/v1/responses",
    };
  }
  return {
    wire: "chat",
    model: options.model ?? "nex-agi/nex-n2.5-pro:free",
    directiveKey: options.directiveKey ?? "lr-or-oa-ch-no",
    gatewayUrl: options.gatewayUrl ?? "https://localhost:7766/v1/chat/completions",
  };
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)): CodeEvalOptions {
  const opts: CodeEvalOptions = {
    runs: 2,
    continueOnFailure: false,
    cooldownMs: 2000,
    timeoutMs: 120000,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--directive" && i + 1 < argv.length) {
      opts.directiveKey = argv[++i];
    } else if (arg === "--url" && i + 1 < argv.length) {
      opts.gatewayUrl = argv[++i];
    } else if (arg === "--wire" && i + 1 < argv.length) {
      const val = argv[++i]?.toLowerCase();
      opts.wire = (val === "rs" || val === "responses") ? "responses" : (val === "chat" ? "chat" : "auto");
    } else if (arg === "--stage" && i + 1 < argv.length) {
      const val = argv[++i];
      if (val) opts.stageFilter = parseInt(val, 10);
    } else if (arg === "--runs" && i + 1 < argv.length) {
      const val = argv[++i];
      if (val) opts.runs = parseInt(val, 10);
    } else if (arg === "--cooldown" && i + 1 < argv.length) {
      const val = argv[++i];
      if (val) opts.cooldownMs = parseInt(val, 10);
    } else if (arg === "--timeout" && i + 1 < argv.length) {
      const val = argv[++i];
      if (val) opts.timeoutMs = parseInt(val, 10);
    } else if (arg === "--continue" || arg === "--no-fail-fast") {
      opts.continueOnFailure = true;
    } else if (!arg.startsWith("--")) {
      opts.model = arg;
    }
  }

  return opts;
}

interface StageDef {
  stageNum: number;
  runner: (ctx: StageContext) => Promise<StageResult>;
}

function getStages(wire: "chat" | "responses"): StageDef[] {
  if (wire === "responses") {
    return [
      { stageNum: 1, runner: runStage1WireRs },
      { stageNum: 2, runner: runStage2PydanticRs },
      { stageNum: 3, runner: runStage3AgenticRs },
      { stageNum: 4, runner: runStage4PatchRs },
      { stageNum: 5, runner: runStage5SecurityRs },
    ];
  }
  return [
    { stageNum: 1, runner: runStage1WireChat },
    { stageNum: 2, runner: runStage2PydanticChat },
    { stageNum: 3, runner: runStage3AgenticChat },
    { stageNum: 4, runner: runStage4PatchChat },
    { stageNum: 5, runner: runStage5SecurityChat },
  ];
}

function printHeader(
  ctx: StageContext,
  wire: string,
  stageFilter?: number,
  continueOnFailure?: boolean,
  cooldownMs?: number,
): void {
  const mode = stageFilter
    ? `Isolated Stage ${stageFilter}`
    : (continueOnFailure ? "All Stages (Diagnostic Mode)" : "Full Sequential Pipeline (Fail-Fast)");

  console.log(`\n========================================================================`);
  console.log(`🛡️  5-STAGE UNIFIED CODING & AGENTIC CERTIFICATION HARNESS`);
  console.log(`========================================================================`);
  console.log(`🎯 Target Model    : \x1b[36m${ctx.model}\x1b[0m`);
  console.log(`🔌 Wire Protocol   : \x1b[35m${wire.toUpperCase()}\x1b[0m`);
  console.log(`🔑 Directive Key   : \x1b[33m${ctx.directiveKey}\x1b[0m`);
  console.log(`🌐 Gateway Origin  : ${ctx.gatewayUrl}`);
  console.log(`⚙️  Execution Mode  : ${mode}`);
  console.log(`⏱️  Timeout / Cool : ${ctx.timeoutMs ?? 120000}ms / ${cooldownMs ?? 2000}ms`);
  console.log(`========================================================================`);
}

function formatStageDuration(result: StageResult): string {
  if (result.durationMs === undefined) return "N/A";
  return `${result.durationMs}ms`;
}

function formatStageSpeed(result: StageResult): string {
  if (result.tokensPerSec !== undefined) {
    return `${result.tokensPerSec} tok/s`;
  }
  if (result.completionTokens !== undefined && result.durationMs && result.durationMs > 0) {
    const spd = (result.completionTokens / (result.durationMs / 1000)).toFixed(1);
    return `${spd} tok/s`;
  }
  return "N/A";
}

function formatStageLoopLog(stageNum: number, result: StageResult): string {
  const statusText = result.passed ? "Passed" : "Failed";
  const latencyPart = result.durationMs !== undefined ? ` | Latency: ${result.durationMs}ms` : "";
  const speed = formatStageSpeed(result);
  const speedPart = speed !== "N/A" ? ` | Speed: ${speed}` : "";
  return `Stage ${stageNum}: ${statusText} (${result.score} pts)${latencyPart}${speedPart}`;
}

export function printFinalSummary(model: string, wire: string, results: StageResult[]): void {
  const divider = `|${"-".repeat(56)}|${"-".repeat(9)}|${"-".repeat(8)}|${"-".repeat(12)}|${"-".repeat(15)}|`;
  const banner = "=".repeat(106);

  console.log(`\n${banner}`);
  console.log(`📊 CERTIFICATION AUDIT REPORT: \x1b[1m${model}\x1b[0m [${wire.toUpperCase()}]`);
  console.log(banner);
  console.log(`| ${"Stage".padEnd(54)} | ${"Score".padStart(7)} | ${"Status".padEnd(6)} | ${"Duration".padStart(10)} | ${"Speed (tok/s)".padStart(13)} |`);
  console.log(divider);

  let allPassed = results.length > 0;
  for (const r of results) {
    const padName = r.stageName.padEnd(54).slice(0, 54);
    const padScore = `${r.score}/100`.padStart(7);
    const statusStr = r.passed ? `\x1b[32mPASSED\x1b[0m` : `\x1b[31mFAILED\x1b[0m`;
    const padDur = formatStageDuration(r).padStart(10);
    const padSpeed = formatStageSpeed(r).padStart(13);
    console.log(`| ${padName} | ${padScore} | ${statusStr} | ${padDur} | ${padSpeed} |`);
    if (!r.passed) {
      allPassed = false;
      for (const note of r.notes) {
        console.log(`  \x1b[33m└─ ${note}\x1b[0m`);
      }
    }
  }

  const totalTokens = results.reduce((acc, r) => acc + (r.completionTokens ?? 0), 0);
  const totalDurationSec = results.reduce((acc, r) => acc + (r.durationMs ?? 0), 0) / 1000;
  const avgSpeed = totalDurationSec > 0 ? (totalTokens / totalDurationSec).toFixed(1) : "N/A";

  console.log(banner);
  console.log(`⚡ Overall Pipeline Average Speed: ${avgSpeed} tok/s`);
  if (allPassed) {
    console.log(`🏁 FINAL VERDICT: \x1b[32mCERTIFIED PRODUCTION-READY FOR OPENCODE 2 & CLAUDE CODE\x1b[0m`);
  } else {
    console.log(`🏁 FINAL VERDICT: \x1b[31mREJECTED - FAILED CRITICAL CERTIFICATION GATES\x1b[0m`);
  }
  console.log(`${banner}\n`);
}

export async function runCodeEvaluation(options: CodeEvalOptions = {}): Promise<CodeEvalSummary> {
  const resolved = resolveWireAndDefaults(options);
  const timeoutMs = options.timeoutMs ?? 120000;
  const cooldownMs = options.cooldownMs ?? 2000;
  const ctx: StageContext = {
    model: resolved.model,
    directiveKey: resolved.directiveKey,
    gatewayUrl: resolved.gatewayUrl,
    runs: options.runs ?? 2,
    timeoutMs,
  };
  const continueOnFailure = options.continueOnFailure ?? false;
  const stageFilter = options.stageFilter;

  printHeader(ctx, resolved.wire, stageFilter, continueOnFailure, cooldownMs);

  const stages = getStages(resolved.wire);
  const stageResults: StageResult[] = [];

  let isFirstStage = true;
  for (const s of stages) {
    if (stageFilter && stageFilter !== s.stageNum) continue;

    if (!isFirstStage && cooldownMs > 0) {
      console.log(`⏳ Cooling down for ${cooldownMs}ms before Stage ${s.stageNum}...`);
      await Bun.sleep(cooldownMs);
    }
    isFirstStage = false;

    const result = await s.runner(ctx);
    stageResults.push(result);
    console.log(formatStageLoopLog(s.stageNum, result));

    if (!result.passed && !stageFilter && !continueOnFailure) {
      console.log(`\n🛑 Pipeline Aborted: Failed Stage ${s.stageNum} (${result.stageName}).`);
      break;
    }
  }

  printFinalSummary(resolved.model, resolved.wire, stageResults);

  const allPassed = stageResults.length > 0 && stageResults.every((r) => r.passed);
  return {
    model: resolved.model,
    wire: resolved.wire,
    directiveKey: resolved.directiveKey,
    gatewayUrl: resolved.gatewayUrl,
    allPassed,
    results: stageResults,
  };
}

export const runCodeEvalSuite = runCodeEvaluation;

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
