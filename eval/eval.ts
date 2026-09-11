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
  runs?: number;
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

function isValidPassAtKInput(n: number, c: number, k: number): boolean {
  return n > 0 && k > 0 && c > 0;
}

/**
 * Standard pass@k unbiased estimator.
 * pass@k = 1 - \binom{n-c}{k} / \binom{n}{k} if (n - c) >= k, else 1.0.
 * For k=1, pass@1 = c / n.
 */
export function computePassAtK(n: number, c: number, k: number): number {
  if (!isValidPassAtKInput(n, c, k)) {
    return 0;
  }
  if (n - c < k) {
    return 1.0;
  }
  let prod = 1.0;
  for (let i = 0; i < k; i++) {
    prod *= (n - c - i) / (n - i);
  }
  return 1.0 - prod;
}

/**
 * Computes the requested percentile (0 - 100) using linear interpolation.
 * e.g., median = 50th, p95 = 95th.
 */
export function computePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(100, percentile));
  const index = (clamped / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;
  return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

/**
 * Computes sample mean and sample standard deviation (Bessel's corrected, N - 1).
 */
export function computeMeanAndStdDev(values: number[]): { mean: number; stdDev: number } {
  if (values.length === 0) {
    return { mean: 0, stdDev: 0 };
  }
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (values.length === 1) {
    return { mean, stdDev: 0 };
  }
  const sumSqDiff = values.reduce((sum, v) => sum + (v - mean) ** 2, 0);
  const variance = sumSqDiff / (values.length - 1);
  return { mean, stdDev: Math.sqrt(variance) };
}

function getZScore(confidenceLevel: number): number {
  if (confidenceLevel >= 0.99) return 2.576;
  if (confidenceLevel >= 0.95) return 1.96;
  if (confidenceLevel >= 0.90) return 1.645;
  return 1.96;
}

/**
 * Computes confidence interval for the sample mean at specified confidence level (default 0.95).
 */
export function computeConfidenceInterval(
  values: number[],
  confidenceLevel = 0.95
): { lower: number; upper: number } {
  if (values.length === 0) {
    return { lower: 0, upper: 0 };
  }
  const { mean, stdDev } = computeMeanAndStdDev(values);
  if (values.length === 1 || stdDev === 0) {
    return { lower: mean, upper: mean };
  }
  const z = getZScore(confidenceLevel);
  const margin = z * (stdDev / Math.sqrt(values.length));
  return { lower: mean - margin, upper: mean + margin };
}

function extractSpeedFromAgg(summary: EvalOrchestratorSummary): {
  ttfts: number[];
  latencies: number[];
  successCount: number;
  totalCount: number;
} {
  const agg =
    summary.speedResult?.aggregates.find((a) => a.model === summary.model) ??
    summary.speedResult?.aggregates[0];
  if (!agg) {
    return { ttfts: [], latencies: [], successCount: 0, totalCount: 0 };
  }
  if (agg.successfulRuns <= 0) {
    return { ttfts: [], latencies: [], successCount: 0, totalCount: 0 };
  }
  const ttfts = [agg.avgTtftMs];
  return {
    ttfts,
    latencies: [agg.avgDurationMs],
    successCount: agg.successfulRuns,
    totalCount: agg.successfulRuns,
  };
}

function extractSpeedRunData(summary: EvalOrchestratorSummary): {
  ttfts: number[];
  latencies: number[];
  successCount: number;
  totalCount: number;
} {
  const modelKey = Object.keys(summary.speedResult?.allResults ?? {})[0] ?? "";
  const modelResults =
    summary.speedResult?.allResults[summary.model] ??
    summary.speedResult?.allResults[modelKey] ??
    [];

  if (modelResults.length > 0) {
    const okResults = modelResults.filter((r) => r.status === "OK");
    const ttfts = okResults.map((r) => r.ttftMs).filter((t) => t > 0);
    const latencies = okResults.map((r) => r.totalDurationMs).filter((d) => d > 0);
    return { ttfts, latencies, successCount: okResults.length, totalCount: modelResults.length };
  }

  return extractSpeedFromAgg(summary);
}

export interface PipelineTelemetry {
  totalDurationMs: number;
  totalTokens: number;
  pipelineAvgSpeed: number;
}

/**
 * Normalizes stage names (e.g., "Stage 1: Wire Protocol" -> "1. Wire Protocol").
 */
export function formatStageName(rawName: string, index: number): string {
  const match = rawName.match(/^(?:Stage\s*)?(\d+)[:\s.-]*(.*)$/i);
  if (match && match[1]) {
    const num = match[1];
    const rest = match[2]?.trim() || `Stage ${num}`;
    return `${num}. ${rest}`;
  }
  return `${index + 1}. ${rawName}`;
}

/**
 * Aggregates duration, tokens, and computes pipeline average speed (tokens / duration_sec).
 */
export function computePipelineAvgSpeed(
  codeResults: CodeStageResult[] = [],
  webStages: WebStageResult[] = []
): PipelineTelemetry {
  let totalDurationMs = 0;
  let totalTokens = 0;
  let tokenDurationMs = 0;

  for (const r of codeResults) {
    if (typeof r.durationMs === "number" && r.durationMs > 0) {
      totalDurationMs += r.durationMs;
    }
    if (typeof r.completionTokens === "number" && r.completionTokens > 0) {
      totalTokens += r.completionTokens;
      if (typeof r.durationMs === "number" && r.durationMs > 0) {
        tokenDurationMs += r.durationMs;
      }
    }
  }

  for (const s of webStages) {
    if (typeof s.durationMs === "number" && s.durationMs > 0) {
      totalDurationMs += s.durationMs;
    }
  }

  const durationSec = (tokenDurationMs > 0 ? tokenDurationMs : totalDurationMs) / 1000;
  const pipelineAvgSpeed = totalTokens > 0 && durationSec > 0 ? totalTokens / durationSec : 0;

  return { totalDurationMs, totalTokens, pipelineAvgSpeed };
}

/**
 * Resolves the number of trials (n) and successful trials (c) for pass@k statistical analysis.
 *
 * CRITICAL STATISTICAL CONSTRAINTS:
 * 1. NEVER use speedData (HTTP round-trip success/failure) for pass@k. Speed benchmarks
 *    test network latency and throughput, NOT task correctness!
 * 2. pass@k is only statistically valid over repeated trials of the same evaluation run.
 * 3. When runs > 1, compute pass@k from the overall multi-run pass rate of the evaluation.
 * 4. When runs === 1, do not masquerade single-attempt runs as multi-trial statistics:
 *    set pass@1 to the actual completion percentage, and do not compute invalid pass@k factors.
 */
export function resolvePassCounts(
  summaryOrSpeedData: any,
  summaryOrRuns?: any,
  maybeRuns?: any
): { n: number; c: number } {
  let summary: EvalOrchestratorSummary;
  let runs = 1;

  if (summaryOrSpeedData && typeof summaryOrSpeedData === "object" && "model" in summaryOrSpeedData) {
    summary = summaryOrSpeedData as EvalOrchestratorSummary;
    runs = typeof summaryOrRuns === "number" ? summaryOrRuns : (summary.runs ?? 1);
  } else if (summaryOrRuns && typeof summaryOrRuns === "object" && "model" in summaryOrRuns) {
    // Legacy signature: resolvePassCounts(speedData, summary, runs)
    // NEVER use speedData!
    summary = summaryOrRuns as EvalOrchestratorSummary;
    runs = typeof maybeRuns === "number" ? maybeRuns : (summary.runs ?? 1);
  } else {
    return { n: 1, c: 0 };
  }

  const codeResults = summary.codeSummary?.results ?? [];
  const webStages = summary.webResult?.stages ?? [];
  const totalStages = codeResults.length + webStages.length;
  const passedStages =
    codeResults.filter((r) => r.passed).length +
    webStages.filter((s) => s.passed).length;

  if (runs <= 1) {
    // Single-attempt run: pass@1 is the actual completion percentage
    if (totalStages > 0) {
      return { n: totalStages, c: passedStages };
    }
    return { n: 1, c: summary.allSuitesPassed ? 1 : 0 };
  }

  // Multi-run evaluation (runs > 1):
  // Compute pass@k from the overall multi-run pass rate of the evaluation.
  const passRate = totalStages > 0
    ? passedStages / totalStages
    : (summary.allSuitesPassed ? 1.0 : 0.0);

  const n = runs;
  let c = Math.round(passRate * runs);
  if (summary.allSuitesPassed && c < runs) {
    c = runs;
  }
  if (!summary.allSuitesPassed && passRate === 0) {
    c = 0;
  }
  c = Math.max(0, Math.min(n, c));
  return { n, c };
}

function formatLatencyMetrics(speedData: { ttfts: number[]; latencies: number[] }): {
  medianTtft: string;
  p95Latency: string;
  stdDev: string;
  ciStr: string;
} {
  if (speedData.ttfts.length === 0) {
    return {
      medianTtft: "N/A",
      p95Latency: "N/A",
      stdDev: "N/A",
      ciStr: "N/A",
    };
  }

  const latSource = speedData.latencies.length > 0 ? speedData.latencies : speedData.ttfts;
  const median = computePercentile(speedData.ttfts, 50);
  const p95 = computePercentile(latSource, 95);
  const { stdDev } = computeMeanAndStdDev(speedData.ttfts);
  const ci = computeConfidenceInterval(speedData.ttfts, 0.95);

  return {
    medianTtft: `${median.toFixed(1)} ms`,
    p95Latency: `${p95.toFixed(1)} ms`,
    stdDev: `±${stdDev.toFixed(1)} ms`,
    ciStr: `[${ci.lower.toFixed(1)} ms, ${ci.upper.toFixed(1)} ms]`,
  };
}

export function buildStatisticalAnalysisSection(
  summary: EvalOrchestratorSummary,
  runs: number
): string[] {
  const lines: string[] = [];
  const speedData = extractSpeedRunData(summary);
  const { n, c } = resolvePassCounts(summary, runs);
  const k = Math.max(1, Math.min(runs, n));

  const pass1 = n > 0 ? c / n : 0;
  const pass1Str = `${(pass1 * 100).toFixed(1)}%`;
  const passKStr = runs > 1 ? `${(computePassAtK(n, c, k) * 100).toFixed(1)}%` : "N/A (Single Attempt)";
  const latencyMetrics = formatLatencyMetrics(speedData);

  lines.push(`## 📊 Statistical Analysis (Runs: ${runs})`);
  lines.push("");
  lines.push("| Metric | Value | Interpretation |");
  lines.push("|---|---|---|");
  lines.push(`| pass@1 (Sample Mean) | ${pass1Str} | Single-attempt pass probability |`);
  lines.push(`| pass@k | ${passKStr} | Success probability over k attempts |`);
  lines.push(`| Median TTFT | ${latencyMetrics.medianTtft} | 50th percentile time-to-first-token |`);
  lines.push(`| p95 Latency | ${latencyMetrics.p95Latency} | Tail latency bound |`);
  lines.push(`| Std Deviation | ${latencyMetrics.stdDev} | Output consistency |`);
  lines.push(`| 95% Confidence Interval | ${latencyMetrics.ciStr} | Expected true mean range |`);
  lines.push("");

  return lines;
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
 * Renders the dedicated Per-Stage Performance & Latency Profile table.
 */
export function buildPerStageProfileSection(
  summary: EvalOrchestratorSummary,
  telemetry: PipelineTelemetry
): string[] {
  const codeResults = (summary.codeSummary?.results ?? []) as CodeStageResult[];
  const webStages = (summary.webResult?.stages ?? []) as WebStageResult[];

  if (codeResults.length === 0 && webStages.length === 0) {
    return [];
  }

  const lines: string[] = [];
  lines.push("## ⚡ Per-Stage Performance & Latency Profile");
  lines.push("");
  lines.push("| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |");
  lines.push("|---|:---:|:---:|:---:|:---:|");

  for (let i = 0; i < codeResults.length; i++) {
    const r = codeResults[i]!;
    const stageLabel = formatStageName(r.stageName, i);
    const durStr = typeof r.durationMs === "number" ? `${r.durationMs} ms` : "-";
    const tokStr = typeof r.completionTokens === "number" ? `${r.completionTokens}` : "-";
    let spdStr = "-";
    if (typeof r.tokensPerSec === "number") {
      spdStr = `${r.tokensPerSec.toFixed(1)} tok/s`;
    } else if (typeof r.completionTokens === "number" && typeof r.durationMs === "number" && r.durationMs > 0) {
      spdStr = `${((r.completionTokens / r.durationMs) * 1000).toFixed(1)} tok/s`;
    }
    const statusStr = r.passed ? "✅ Passed" : "❌ Failed";
    lines.push(`| ${stageLabel} | ${durStr} | ${tokStr} | ${spdStr} | ${statusStr} |`);
  }

  for (const s of webStages) {
    const stageLabel = `Web ${s.stageNumber}. ${s.stageName}`;
    const durStr = typeof s.durationMs === "number" ? `${s.durationMs} ms` : "-";
    const tokStr = "-";
    const spdStr = "-";
    const statusStr = s.passed ? "✅ Passed" : "❌ Failed";
    lines.push(`| ${stageLabel} | ${durStr} | ${tokStr} | ${spdStr} | ${statusStr} |`);
  }

  const { totalDurationMs, totalTokens, pipelineAvgSpeed } = telemetry;
  const aggDurStr = totalDurationMs > 0 ? `**${totalDurationMs} ms**` : `**-**`;
  const aggTokStr = totalTokens > 0 ? `**${totalTokens}**` : `**-**`;
  const aggSpdStr = pipelineAvgSpeed > 0 ? `**${pipelineAvgSpeed.toFixed(1)} tok/s (avg)**` : `**-**`;
  const allPassed =
    (codeResults.length === 0 || codeResults.every((r) => r.passed)) &&
    (webStages.length === 0 || webStages.every((s) => s.passed));
  const aggStatusStr = allPassed ? "✅ Passed" : "❌ Failed";

  lines.push(`| **Pipeline Aggregate** | ${aggDurStr} | ${aggTokStr} | ${aggSpdStr} | ${aggStatusStr} |`);
  lines.push("");

  return lines;
}

/**
 * Generates an executive Markdown report card from evaluation results.
 */
export function generateMarkdownReport(summary: EvalOrchestratorSummary): string {
  const lines: string[] = [];
  const rec = summary.roleRecommendation;
  const codeResults = (summary.codeSummary?.results ?? []) as CodeStageResult[];
  const webStages = (summary.webResult?.stages ?? []) as WebStageResult[];
  const telemetry = computePipelineAvgSpeed(codeResults, webStages);

  lines.push(`# 🏛️ Model Evaluation Report Card: \`${summary.model}\``);
  lines.push("");
  lines.push(`> **Generated:** \`${summary.timestamp}\`  `);
  lines.push(`> **Directive Key:** \`${summary.directiveKey}\`  `);
  lines.push(`> **Wire Protocol:** \`${summary.wire.toUpperCase()}\`  `);
  lines.push(`> **Gateway Target:** \`${summary.gatewayUrl}\`  `);
  lines.push(`> **Evaluated Suites:** \`${summary.suitesRun.join(", ")}\`  `);
  if (telemetry.pipelineAvgSpeed > 0) {
    lines.push(`> **Pipeline Avg Speed:** \`${telemetry.pipelineAvgSpeed.toFixed(1)} tok/s\`  `);
  }
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

  // Per-Stage Performance & Latency Profile Section
  const stageProfileLines = buildPerStageProfileSection(summary, telemetry);
  if (stageProfileLines.length > 0) {
    lines.push(...stageProfileLines);
    lines.push("---");
    lines.push("");
  }

  // Statistical Analysis Section (Runs > 1)
  const runs = summary.runs ??
    summary.speedResult?.aggregates.find((a) => a.model === summary.model)?.successfulRuns ??
    1;

  if (runs > 1) {
    const statsLines = buildStatisticalAnalysisSection(summary, runs);
    lines.push(...statsLines);
    lines.push("---");
    lines.push("");
  }

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
    runs,
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
