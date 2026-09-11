#!/usr/bin/env bun
/**
 * eval/eval.ts
 *
 * Master Model Evaluation & Capability Orchestrator for LiteRouter.
 *
 * Coordinates execution of three benchmark suites across any target model:
 *   1. Speed & Throughput Benchmark        (eval/speed.ts)
 *   2. Code & Agentic Capability Harness   (eval/code.ts)
 *   3. Web Vision-Language & Frontend Eval (eval/web.ts)
 *
 * Synthesizes an executive Markdown report card with architectural role
 * recommendations (Orchestrator, General Coder, or Explorer) and persists
 * it to eval/reports/<sanitized_model_name>.md.
 *
 * Usage:
 *   bun run eval/eval.ts [model_name] [options]
 *   bun run eval/eval.ts nex-agi/nex-n2.5-pro:free
 *   bun run eval/eval.ts inclusionai/ling-3.0-flash-vl:free --suites speed,web
 *   bun run eval/eval.ts <model> --suites code --stage 4 --continue
 *   bun run eval/eval.ts <model> --key lr-or-oa-ch-no --skip-report
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import {
  runSpeedBenchmark,
  type SpeedBenchmarkResult,
  type ModelAggregate,
} from "./speed";
import {
  runCodeEvaluation,
  type CodeEvalOptions,
  type CodeEvalSummary,
} from "./code";
import {
  runWebEvaluation,
  type WebEvalOptions,
  type WebEvalResult,
} from "./web";
import type { StageResult as CodeStageResult } from "./stages/types";
import type { StageResult as WebStageResult } from "./stages_web/types";

export type SuiteType = "speed" | "code" | "web";
export type ArchitecturalRole = "Orchestrator" | "General Coder" | "Explorer";

export interface EvalOrchestratorOptions {
  model?: string;
  suites?: SuiteType[];
  directiveKey?: string;
  gatewayUrl?: string;
  wire?: "chat" | "responses" | "auto";
  stage?: number;
  reasoningEffort?: "high" | "medium" | "none";
  skipReport?: boolean;
  continueOnFailure?: boolean;
  runs?: number;
  image?: string;
  reportsDir?: string;
}

export interface RoleRecommendation {
  role: ArchitecturalRole;
  badge: string;
  rationale: string;
  strengths: string[];
  caveats: string[];
}

export interface EvalOrchestratorSummary {
  model: string;
  sanitizedModelName: string;
  timestamp: string;
  directiveKey: string;
  gatewayUrl: string;
  wire: "chat" | "responses";
  suitesRun: SuiteType[];
  speedResult?: SpeedBenchmarkResult;
  codeSummary?: CodeEvalSummary;
  webResult?: WebEvalResult;
  roleRecommendation: RoleRecommendation;
  reportPath?: string;
  allSuitesPassed: boolean;
}

/**
 * Sanitizes a model identifier for filesystem storage.
 * Replaces unsafe characters (`/`, `:`, `@`, `\`, ` `, etc.) with underscores.
 */
export function sanitizeModelName(model: string): string {
  return model.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * Ensures the reports directory exists and returns its absolute path.
 */
export function ensureReportsDirectory(customPath?: string): string {
  const dir = customPath ? resolve(customPath) : resolve(import.meta.dir, "reports");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Evaluates performance, code agentic durability, and web frontend fidelity
 * to synthesize an architectural role recommendation.
 */
export function determineArchitecturalRole(
  speedAgg?: ModelAggregate,
  code?: CodeEvalSummary,
  web?: WebEvalResult
): RoleRecommendation {
  const strengths: string[] = [];
  const caveats: string[] = [];

  let codeScore = 0;
  let codeStagesPassed = 0;
  let hasPydantic = false;
  let hasAgentic = false;
  let hasPatch = false;

  if (code && code.results.length > 0) {
    const totalScore = code.results.reduce((acc, r) => acc + r.score, 0);
    codeScore = Math.round(totalScore / code.results.length);
    codeStagesPassed = code.results.filter((r) => r.passed).length;

    for (const r of code.results) {
      const lower = r.stageName.toLowerCase();
      if (lower.includes("pydantic") && r.passed) hasPydantic = true;
      if (lower.includes("agentic") && r.passed) hasAgentic = true;
      if (lower.includes("patch") && r.passed) hasPatch = true;
    }

    if (hasPydantic) strengths.push("Pydantic AI 2.0 Schema & Retry Resilience");
    if (hasAgentic) strengths.push("Durable Multi-Turn Agentic State Tracking");
    if (hasPatch) strengths.push("Surgical Diff & Code Patch Fidelity");
    if (codeStagesPassed === code.results.length) strengths.push("100% Code Certification Gates Passed");
  }

  let webScore = 0;
  let webReady = false;
  if (web && web.stages.length > 0) {
    webScore = web.compositeScore;
    webReady = web.isProductionReady;
    if (webReady) strengths.push("Production-Ready Visual & Responsive Frontend DOM Fidelity");
    if (webScore >= 80) strengths.push(`High Web Synthesis Score (${webScore}/100)`);
  }

  const tokPerSec = speedAgg?.avgSpeedTokPerSec ?? 0;
  const ttftMs = speedAgg?.avgTtftMs ?? 0;

  if (speedAgg && speedAgg.successfulRuns > 0) {
    if (ttftMs > 0 && ttftMs < 1200) strengths.push(`Ultra-Low TTFT (${ttftMs}ms)`);
    if (tokPerSec >= 35) strengths.push(`High Streaming Throughput (${tokPerSec} tok/s)`);
    if (ttftMs > 2500) caveats.push(`Elevated TTFT (${ttftMs}ms) due to inference queueing or heavy thinking tokens`);
  }

  if (code && !code.allPassed) {
    const failedStages = code.results.filter((r) => !r.passed).map((r) => r.stageName);
    caveats.push(`Failed code stages: ${failedStages.join(", ")}`);
  }

  if (web && !web.allPassed) {
    caveats.push("Sub-optimal web frontend or accessibility compliance");
  }

  // 1. ORCHESTRATOR CRITERIA:
  // Requires structured schemas (Pydantic), agentic loop durability, and patch precision.
  const isOrchestratorCandidate =
    (code ? (codeScore >= 85 && hasPydantic && hasAgentic && (hasPatch || code.allPassed)) : false) ||
    (code && code.allPassed && codeScore >= 80);

  if (isOrchestratorCandidate) {
    return {
      role: "Orchestrator",
      badge: "🧠 MASTER ORCHESTRATOR",
      rationale:
        "Excels in structured output generation, durable multi-turn context retention, and strict schema validation. Prime candidate for orchestrating multi-agent pipelines, beads tracking, complex tool invocations, and supervisor duties.",
      strengths,
      caveats,
    };
  }

  // 2. GENERAL CODER CRITERIA:
  // Requires solid patch fidelity, decent code synthesis, or solid web frontend skills.
  const isGeneralCoderCandidate =
    (code ? (hasPatch || codeScore >= 65 || codeStagesPassed >= 3) : false) ||
    (web ? (webScore >= 75 || webReady) : false);

  if (isGeneralCoderCandidate) {
    return {
      role: "General Coder",
      badge: "💻 GENERAL CODER",
      rationale:
        "Displays dependable code generation, AST patch fidelity, or responsive frontend authoring. Well-suited for core engineering workflows, writing implementation code, debugging unit tests, and delivering full-stack features.",
      strengths,
      caveats,
    };
  }

  // 3. EXPLORER CRITERIA:
  // High throughput, rapid triage, or lighter-weight reasoning.
  return {
    role: "Explorer",
    badge: "⚡ FAST EXPLORER",
    rationale:
      "Demonstrates high streaming velocity, responsive first-token arrival, or lightweight resource footprint. Best allocated to fast repository exploration, code search, initial issue triage, rapid prototyping, and high-frequency queries.",
    strengths,
    caveats,
  };
}

/**
 * Generates an executive Markdown report card from evaluation results.
 */
export function generateMarkdownReport(summary: EvalOrchestratorSummary): string {
  const lines: string[] = [];
  const rec = summary.roleRecommendation;

  lines.push(`# 🏛️ Model Evaluation Report Card: \`${summary.model}\``);
  lines.push("");
  lines.push(`> **Generated:** \`${summary.timestamp}\`  `);
  lines.push(`> **Directive Key:** \`${summary.directiveKey}\`  `);
  lines.push(`> **Wire Protocol:** \`${summary.wire.toUpperCase()}\`  `);
  lines.push(`> **Gateway Target:** \`${summary.gatewayUrl}\`  `);
  lines.push(`> **Evaluated Suites:** \`${summary.suitesRun.join(", ")}\`  `);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Executive Role Recommendation
  lines.push("## 🎯 Architectural Role Recommendation");
  lines.push("");
  lines.push(`### ${rec.badge} — **${rec.role.toUpperCase()}**`);
  lines.push("");
  lines.push(`**Recommendation Rationale:**  `);
  lines.push(`${rec.rationale}`);
  lines.push("");

  if (rec.strengths.length > 0) {
    lines.push("**Key Architectural Strengths:**");
    for (const s of rec.strengths) {
      lines.push(`- ✅ ${s}`);
    }
    lines.push("");
  }

  if (rec.caveats.length > 0) {
    lines.push("**Operational Caveats & Boundaries:**");
    for (const c of rec.caveats) {
      lines.push(`- ⚠️ ${c}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // Speed Benchmark Section
  if (summary.suitesRun.includes("speed") && summary.speedResult) {
    lines.push("## ⚡ Speed & Throughput Benchmark");
    lines.push("");
    const agg = summary.speedResult.aggregates.find((a) => a.model === summary.model) ??
      summary.speedResult.aggregates[0];

    if (agg && agg.successfulRuns > 0) {
      lines.push("| Metric | Measured Value | Standard Target | Status |");
      lines.push("|---|---|---|---|");

      const ttftStatus = agg.avgTtftMs < 1500 ? "🟢 Snappy" : (agg.avgTtftMs < 3000 ? "🟡 Acceptable" : "🔴 High Latency");
      const speedStatus = agg.avgSpeedTokPerSec >= 35 ? "🟢 High" : (agg.avgSpeedTokPerSec >= 20 ? "🟡 Normal" : "🔴 Slow");

      lines.push(`| **Time to First Token (TTFT)** | \`${agg.avgTtftMs} ms\` (min: \`${agg.minTtftMs} ms\`, max: \`${agg.maxTtftMs} ms\`) | \`< 2,000 ms\` | ${ttftStatus} |`);
      lines.push(`| **Streaming Throughput** | \`${agg.avgSpeedTokPerSec} tok/s\` | \`> 30 tok/s\` | ${speedStatus} |`);
      lines.push(`| **Average Duration** | \`${agg.avgDurationMs} ms\` | - | ℹ️ |`);
      lines.push(`| **Average Output Tokens** | \`${agg.avgTotalTokens} tokens\` | - | ℹ️ |`);
      lines.push(`| **Successful Benchmark Runs** | \`${agg.successfulRuns}\` | \`>= 2\` | 🟢 Complete |`);
      lines.push("");
    } else {
      lines.push("⚠️ *Speed benchmark recorded 0 successful runs (possible upstream timeout or rate limit).*");
      lines.push("");
    }
  } else if (!summary.suitesRun.includes("speed")) {
    lines.push("## ⚡ Speed & Throughput Benchmark");
    lines.push("");
    lines.push("*(Suite skipped per CLI execution options)*");
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // Code Benchmark Section
  if (summary.suitesRun.includes("code") && summary.codeSummary) {
    lines.push("## 🛡️ Code & Agentic Capability Scorecard");
    lines.push("");
    lines.push("| Stage # | Stage Name | Score | Status | Notes & Observations |");
    lines.push("|---|---|---|---|---|");

    for (let i = 0; i < summary.codeSummary.results.length; i++) {
      const r = summary.codeSummary.results[i] as CodeStageResult;
      const stageIdx = i + 1;
      const statusIcon = r.passed ? "🟢 PASSED" : "🔴 FAILED";
      const notes = r.notes && r.notes.length > 0 ? r.notes.join("; ") : (r.passed ? "Passed verification" : "Criteria unmet");
      lines.push(`| **${stageIdx}** | ${r.stageName} | \`${r.score}/100\` | ${statusIcon} | ${notes} |`);
    }
    lines.push("");

    const passedCount = summary.codeSummary.results.filter((r) => r.passed).length;
    const totalCount = summary.codeSummary.results.length;
    const codeVerdict = summary.codeSummary.allPassed
      ? "🟢 **CERTIFIED PRODUCTION READY**"
      : "🔴 **REJECTED (CRITICAL GATES FAILED)**";

    lines.push(`**Code Suite Verdict:** ${codeVerdict} (\`${passedCount}/${totalCount}\` stages cleared)`);
    lines.push("");
  } else if (!summary.suitesRun.includes("code")) {
    lines.push("## 🛡️ Code & Agentic Capability Scorecard");
    lines.push("");
    lines.push("*(Suite skipped per CLI execution options)*");
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // Web Benchmark Section
  if (summary.suitesRun.includes("web") && summary.webResult) {
    lines.push("## 🌐 Web Frontend & Vision-Language Scorecard");
    lines.push("");
    lines.push("| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |");
    lines.push("|---|---|---|---|---|---|");

    for (const stage of summary.webResult.stages) {
      const statusIcon = stage.passed ? "🟢 PASSED" : "🔴 FAILED";
      const totalChecks = stage.checks.length;
      const passedChecks = stage.checks.filter((c) => c.passed).length;
      const checkRate = totalChecks > 0 ? `\`${passedChecks}/${totalChecks}\` checks` : `N/A`;

      lines.push(`| **${stage.stageNumber}** | ${stage.stageName} | \`${stage.score}/100\` | ${statusIcon} | \`${stage.durationMs} ms\` | ${checkRate} |`);
    }
    lines.push("");

    const webVerdict = summary.webResult.isProductionReady
      ? "🟢 **WEB PRODUCTION READY**"
      : "🔴 **NEEDS REFINEMENT**";

    lines.push(`**Web Composite Score:** \`${summary.webResult.compositeScore}/100\`  `);
    lines.push(`**Web Suite Verdict:** ${webVerdict}`);
    lines.push("");
  } else if (!summary.suitesRun.includes("web")) {
    lines.push("## 🌐 Web Frontend & Vision-Language Scorecard");
    lines.push("");
    lines.push("*(Suite skipped per CLI execution options)*");
    lines.push("");
  }

  lines.push("---");
  lines.push("");
  lines.push("## 📝 Operational LiteRouter Deployment Guidance");
  lines.push("");
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        model: summary.model,
        recommendedRole: rec.role,
        wire: summary.wire,
        directiveKey: summary.directiveKey,
        allPassed: summary.allSuitesPassed,
      },
      null,
      2
    )
  );
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

/**
 * Persists the generated report to disk in eval/reports/<sanitized_model_name>.md.
 */
export function writeMarkdownReport(
  summary: EvalOrchestratorSummary,
  customDir?: string
): string {
  const reportsDir = ensureReportsDirectory(customDir);
  const fileName = `${summary.sanitizedModelName}.md`;
  const filePath = join(reportsDir, fileName);

  const markdownContent = generateMarkdownReport(summary);
  writeFileSync(filePath, markdownContent, "utf-8");

  return filePath;
}

export function printHelp(): void {
  console.log(`
\x1b[1m\x1b[36mLiteRouter Master Evaluation Orchestrator (eval/eval.ts)\x1b[0m

\x1b[1mUSAGE:\x1b[0m
  bun run eval/eval.ts [model_name] [options]

\x1b[1mEXAMPLES:\x1b[0m
  bun run eval/eval.ts nex-agi/nex-n2.5-pro:free
  bun run eval/eval.ts inclusionai/ling-3.0-flash-vl:free --suites speed,web
  bun run eval/eval.ts muse-spark-1.3-contributor-free --wire rs --key lr-zn-oo-rs-no
  bun run eval/eval.ts <model> --suites code --stage 4 --continue

\x1b[1mOPTIONS:\x1b[0m
  --suites <list>       Comma-separated benchmark suites to execute:
                        speed, code, web (default: speed,code,web)
  --key, --directive <k> LiteRouter directive key (default: lr-or-oa-ch-no)
  --url <url>           LiteRouter gateway endpoint URL
  --wire <chat|rs>      Wire protocol ('chat' or 'rs'/'responses', auto-detected)
  --stage <n>           Run ONLY a specific stage (1-5) for code / web suites
  --reasoning <effort>  Reasoning effort for thinking models: none, medium, high
  --runs <n>            Number of benchmark iterations per test (default: 2)
  --continue            Continue suite execution on stage failure (Diagnostic Mode)
  --skip-report         Do not write Markdown report card to eval/reports/
  --image <path_or_url> Custom image input for web vision-language evaluation
  -h, --help            Show this help manual and exit

\x1b[1mREPORT OUTPUT:\x1b[0m
  Saved automatically to \x1b[33meval/reports/<sanitized_model_name>.md\x1b[0m
`);
}

export function parseCliArgs(argv: string[] = process.argv.slice(2)): EvalOrchestratorOptions {
  const opts: EvalOrchestratorOptions = {
    suites: ["speed", "code", "web"],
    runs: 2,
    continueOnFailure: false,
    skipReport: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
    if ((arg === "--key" || arg === "--directive") && i + 1 < argv.length) {
      opts.directiveKey = argv[++i];
    } else if (arg === "--url" && i + 1 < argv.length) {
      opts.gatewayUrl = argv[++i];
    } else if (arg === "--wire" && i + 1 < argv.length) {
      const val = argv[++i]?.toLowerCase();
      opts.wire = (val === "rs" || val === "responses") ? "responses" : (val === "chat" ? "chat" : "auto");
    } else if (arg === "--suites" && i + 1 < argv.length) {
      const raw = argv[++i];
      if (raw) {
        const parts = raw.split(",").map((s) => s.trim().toLowerCase());
        const validSuites: SuiteType[] = [];
        for (const p of parts) {
          if (p === "speed" || p === "code" || p === "web") {
            validSuites.push(p);
          }
        }
        if (validSuites.length > 0) {
          opts.suites = validSuites;
        }
      }
    } else if (arg === "--stage" && i + 1 < argv.length) {
      const val = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isNaN(val) && val >= 1 && val <= 5) {
        opts.stage = val;
      }
    } else if (arg === "--reasoning" && i + 1 < argv.length) {
      const effort = argv[++i];
      if (effort === "high" || effort === "medium" || effort === "none") {
        opts.reasoningEffort = effort;
      }
    } else if (arg === "--runs" && i + 1 < argv.length) {
      const r = Number.parseInt(argv[++i] ?? "", 10);
      if (!Number.isNaN(r) && r > 0) opts.runs = r;
    } else if (arg === "--image" && i + 1 < argv.length) {
      opts.image = argv[++i];
    } else if (arg === "--continue" || arg === "--no-fail-fast") {
      opts.continueOnFailure = true;
    } else if (arg === "--skip-report") {
      opts.skipReport = true;
    } else if (!arg.startsWith("-")) {
      opts.model = arg;
    }
  }

  return opts;
}

/**
 * Main orchestrator executing the selected benchmark suites and synthesizing
 * the executive report.
 */
export async function runMasterEvaluation(
  options: EvalOrchestratorOptions = {}
): Promise<EvalOrchestratorSummary> {
  const model = options.model ?? "nex-agi/nex-n2.5-pro:free";
  const sanitized = sanitizeModelName(model);
  const suitesToRun = options.suites && options.suites.length > 0 ? options.suites : (["speed", "code", "web"] as SuiteType[]);
  const runs = options.runs ?? 2;
  const continueOnFailure = options.continueOnFailure ?? false;

  // Auto-detect Responses vs Chat wire
  const isResponses =
    options.wire === "responses" ||
    model.toLowerCase().includes("muse") ||
    options.directiveKey?.includes("-rs-") ||
    options.gatewayUrl?.includes("/responses");

  const wire: "chat" | "responses" = isResponses ? "responses" : "chat";
  const directiveKey = options.directiveKey ?? (isResponses ? "lr-zn-oo-rs-no" : "lr-or-oa-ch-no");
  const defaultUrl = isResponses
    ? "https://localhost:7766/v1/responses"
    : "https://localhost:7766/v1/chat/completions";
  const gatewayUrl = options.gatewayUrl ?? defaultUrl;

  console.log(`\n========================================================================`);
  console.log(`🚀 \x1b[1m\x1b[36mLITEROUTER MASTER EVALUATION ORCHESTRATOR\x1b[0m`);
  console.log(`========================================================================`);
  console.log(`🎯 Target Model  : \x1b[1m\x1b[36${model}\x1b[0m`);
  console.log(`📦 Suites Scope  : \x1b[33m${suitesToRun.join(", ")}\x1b[0m`);
  console.log(`🔌 Wire Protocol : \x1b[35m${wire.toUpperCase()}\x1b[0m`);
  console.log(`🔑 Directive Key : \x1b[33m${directiveKey}\x1b[0m`);
  console.log(`🌐 Gateway Origin: ${gatewayUrl}`);
  console.log(`⚙️  Stage Scope   : ${options.stage ? `Stage ${options.stage} Only` : "All Stages"}`);
  console.log(`🔁 Runs / Test   : ${runs}`);
  console.log(`========================================================================\n`);

  let speedResult: SpeedBenchmarkResult | undefined;
  let codeSummary: CodeEvalSummary | undefined;
  let webResult: WebEvalResult | undefined;
  let allSuitesPassed = true;

  // 1. Suite: Speed
  if (suitesToRun.includes("speed")) {
    console.log(`\n▶ [1/3] EXECUTING SPEED & THROUGHPUT BENCHMARK...`);
    try {
      speedResult = await runSpeedBenchmark([model], runs, directiveKey, gatewayUrl, true);
    } catch (err) {
      console.error(`\x1b[31mError during speed benchmark execution:\x1b[0m`, err);
      allSuitesPassed = false;
    }
  }

  // 2. Suite: Code
  if (suitesToRun.includes("code")) {
    console.log(`\n▶ [2/3] EXECUTING UNIFIED CODE & AGENTIC BENCHMARK...`);
    try {
      const codeOpts: CodeEvalOptions = {
        model,
        directiveKey,
        gatewayUrl,
        wire,
        stageFilter: options.stage,
        runs,
        continueOnFailure,
      };
      codeSummary = await runCodeEvaluation(codeOpts);
      if (!codeSummary.allPassed) {
        allSuitesPassed = false;
      }
    } catch (err) {
      console.error(`\x1b[31mError during code benchmark execution:\x1b[0m`, err);
      allSuitesPassed = false;
    }
  }

  // 3. Suite: Web
  if (suitesToRun.includes("web")) {
    console.log(`\n▶ [3/3] EXECUTING WEB FRONTEND & VISION-LANGUAGE BENCHMARK...`);
    try {
      const webOpts: WebEvalOptions = {
        model,
        directiveKey,
        gatewayUrl,
        image: options.image,
        stage: options.stage,
        continueOnFailure,
        runs,
        reasoningEffort: options.reasoningEffort,
        silent: false,
      };
      webResult = await runWebEvaluation(webOpts);
      if (!webResult.allPassed) {
        allSuitesPassed = false;
      }
    } catch (err) {
      console.error(`\x1b[31mError during web benchmark execution:\x1b[0m`, err);
      allSuitesPassed = false;
    }
  }

  // Determine Architectural Role Recommendation
  const speedAgg = speedResult?.aggregates.find((a) => a.model === model);
  const roleRecommendation = determineArchitecturalRole(speedAgg, codeSummary, webResult);

  const timestamp = new Date().toISOString();
  const summary: EvalOrchestratorSummary = {
    model,
    sanitizedModelName: sanitized,
    timestamp,
    directiveKey,
    gatewayUrl,
    wire,
    suitesRun: suitesToRun,
    speedResult,
    codeSummary,
    webResult,
    roleRecommendation,
    allSuitesPassed,
  };

  // Report Card Generation
  if (!options.skipReport) {
    const reportFilePath = writeMarkdownReport(summary, options.reportsDir);
    summary.reportPath = reportFilePath;
    console.log(`\n📄 \x1b[32mExecutive Report Card generated at:\x1b[0m \x1b[1m${reportFilePath}\x1b[0m`);
  }

  // Print Executive Summary to stdout
  console.log(`\n========================================================================`);
  console.log(`🏁 MASTER EVALUATION SUMMARY FOR \x1b[1m\x1b[36m${model}\x1b[0m`);
  console.log(`========================================================================`);
  console.log(`🏆 Recommended Role : \x1b[1m${roleRecommendation.badge}\x1b[0m`);
  console.log(`💡 Rationale        : ${roleRecommendation.rationale}`);
  console.log(`📊 Overall Outcome   : ${allSuitesPassed ? "\x1b[32mALL TESTED SUITES PASSED\x1b[0m" : "\x1b[31mSOME SUITES FAILED OR INCOMPLETE\x1b[0m"}`);
  console.log(`========================================================================\n`);

  return summary;
}

if (import.meta.main) {
  const options = parseCliArgs();
  runMasterEvaluation(options)
    .then((summary) => {
      if (!summary.allSuitesPassed && !options.continueOnFailure) {
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error("\x1b[31mFatal error in master evaluation orchestrator:\x1b[0m", err);
      process.exit(1);
    });
}
