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
import { REASONING_TRANSCRIPT_KEY } from "./stages/types";
import type { StageResult as WebStageResult } from "./stages_web/types";
import {
  validateStrictEvalArgs,
  extractPositionalAndNamed,
  getDefaultGatewayBaseUrl,
  deriveWireDirectiveKeys,
  type ValidatedEvalArgs,
  type WireDirectiveKeys,
} from "./validate_cli";
import {
  installAnthropicBridge,
  uninstallAnthropicBridge,
} from "./anthropic_bridge";

export type SuiteType = "speed" | "code" | "web";
export type ArchitecturalRole = "Orchestrator" | "General Coder" | "Explorer";

export interface EvalOrchestratorOptions {
  model?: string;
  provider?: string;
  suites?: SuiteType[];
  directiveKey?: string;
  gatewayUrl?: string;
  wire?: "chat" | "responses" | "messages" | "auto";
  allWires?: boolean;
  stage?: number;
  reasoningEffort?: "high" | "medium" | "none";
  reasoningTranscript?: boolean;
  skipReport?: boolean;
  continueOnFailure?: boolean;
  runs?: number;
  image?: string;
  reportsDir?: string;
  batchTargets?: ValidatedEvalArgs[];
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
  wire: "chat" | "responses" | "messages";
  suitesRun: SuiteType[];
  runs?: number;
  speedResult?: SpeedBenchmarkResult;
  codeSummary?: CodeEvalSummary;
  webResult?: WebEvalResult;
  roleRecommendation: RoleRecommendation;
  reportPath?: string;
  allSuitesPassed: boolean;
}

export interface WireResultSummary {
  wire: "chat" | "responses" | "messages";
  wireLabel: string;
  directiveKey: string;
  gatewayUrl: string;
  passed: boolean;
  summary?: EvalOrchestratorSummary;
  error?: string;
}

export interface UnifiedRoleRecommendation {
  overallRole: ArchitecturalRole;
  badge: string;
  rationale: string;
  bestWireForOrchestrator: string;
  bestWireForCoder: string;
  bestWireForExplorer: string;
  strengths: string[];
  caveats: string[];
}

export interface ConsolidatedModelSummary {
  model: string;
  sanitizedModelName: string;
  timestamp: string;
  gatewayHost: string;
  directiveKeys: WireDirectiveKeys;
  wireResults: {
    chat: WireResultSummary;
    responses: WireResultSummary;
    messages: WireResultSummary;
  };
  allWiresPassed: boolean;
  unifiedRoleRecommendation: UnifiedRoleRecommendation;
  reportPath?: string;
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

export interface CanonicalStageInfo {
  stageNumber: number;
  stageName: string;
}

export const CANONICAL_CODE_STAGES: CanonicalStageInfo[] = [
  { stageNumber: 1, stageName: "Stage 1: Wire Protocol & Long Context Hydration" },
  { stageNumber: 2, stageName: "Stage 2: Pydantic AI 2.0 Schema & Self-Correction Retry" },
  { stageNumber: 3, stageName: "Stage 3: Dynamic State, Agentic Loop & Speed" },
  { stageNumber: 4, stageName: "Stage 4: Surgical Coding & Patch Fidelity (str_replace)" },
  { stageNumber: 5, stageName: "Stage 5: Security & Indirect Prompt Injection Resilience" },
];

export const CANONICAL_WEB_STAGES: CanonicalStageInfo[] = [
  { stageNumber: 1, stageName: "Stage 1: DOM Structure & Layout Fidelity" },
  { stageNumber: 2, stageName: "Stage 2: Responsive Design & Mobile Scaling" },
  { stageNumber: 3, stageName: "Stage 3: Interactive State & Event Architecture" },
  { stageNumber: 4, stageName: "Stage 4: Code Hygiene & Anti-Hallucination Guardrails" },
  { stageNumber: 5, stageName: "Stage 5: Semantic Accessibility & ARIA Compliance" },
];

/**
 * Extracts a 1-based stage number from a code stage result name.
 */
export function extractCodeStageNumber(rawName: string, fallbackIndex: number): number {
  const match = rawName.match(/^(?:Stage\s*)?(\d+)/i);
  if (match && match[1]) {
    const parsed = Number.parseInt(match[1], 10);
    if (!Number.isNaN(parsed) && parsed > 0) return parsed;
  }
  return fallbackIndex + 1;
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

  // Code rows
  const executedCodeMap = new Map<number, CodeStageResult>();
  codeResults.forEach((r, idx) => {
    const stageNum = extractCodeStageNumber(r.stageName, idx);
    executedCodeMap.set(stageNum, r);
  });
  const firstFailedCode = codeResults.find((r) => !r.passed);
  let firstFailedCodeNum: number | null = null;
  if (firstFailedCode) {
    const fIdx = codeResults.indexOf(firstFailedCode);
    firstFailedCodeNum = extractCodeStageNumber(firstFailedCode.stageName, fIdx);
  }

  if (codeResults.length > 0) {
    for (const canonical of CANONICAL_CODE_STAGES) {
      const r = executedCodeMap.get(canonical.stageNumber);
      if (r) {
        const stageLabel = formatStageName(r.stageName, canonical.stageNumber - 1);
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
      } else {
        const stageLabel = formatStageName(canonical.stageName, canonical.stageNumber - 1);
        let statusReason = "⏭️ Skipped (CLI filter)";
        if (firstFailedCodeNum !== null && canonical.stageNumber > firstFailedCodeNum) {
          statusReason = `⏭️ Skipped (Fail-Fast: Stage ${firstFailedCodeNum})`;
        }
        lines.push(`| ${stageLabel} | - | - | - | ${statusReason} |`);
      }
    }
    for (const [stageNum, r] of executedCodeMap) {
      if (stageNum > 5 || stageNum < 1) {
        const stageLabel = formatStageName(r.stageName, stageNum - 1);
        const durStr = typeof r.durationMs === "number" ? `${r.durationMs} ms` : "-";
        const tokStr = typeof r.completionTokens === "number" ? `${r.completionTokens}` : "-";
        const statusStr = r.passed ? "✅ Passed" : "❌ Failed";
        lines.push(`| ${stageLabel} | ${durStr} | ${tokStr} | - | ${statusStr} |`);
      }
    }
  }

  // Web rows
  const executedWebMap = new Map<number, WebStageResult>();
  webStages.forEach((s) => {
    executedWebMap.set(s.stageNumber, s);
  });
  const firstFailedWeb = webStages.find((s) => !s.passed);
  const firstFailedWebNum = firstFailedWeb ? firstFailedWeb.stageNumber : null;

  if (webStages.length > 0) {
    for (const canonical of CANONICAL_WEB_STAGES) {
      const s = executedWebMap.get(canonical.stageNumber);
      if (s) {
        const stageLabel = `Web ${s.stageNumber}. ${s.stageName}`;
        const durStr = typeof s.durationMs === "number" ? `${s.durationMs} ms` : "-";
        const tokStr = "-";
        const spdStr = "-";
        const statusStr = s.passed ? "✅ Passed" : "❌ Failed";
        lines.push(`| ${stageLabel} | ${durStr} | ${tokStr} | ${spdStr} | ${statusStr} |`);
      } else {
        const stageLabel = `Web ${canonical.stageNumber}. ${canonical.stageName}`;
        let statusReason = "⏭️ Skipped (CLI filter)";
        if (firstFailedWebNum !== null && canonical.stageNumber > firstFailedWebNum) {
          statusReason = `⏭️ Skipped (Fail-Fast: Stage ${firstFailedWebNum})`;
        }
        lines.push(`| ${stageLabel} | - | - | - | ${statusReason} |`);
      }
    }
    for (const [stageNum, s] of executedWebMap) {
      if (stageNum > 5 || stageNum < 1) {
        const stageLabel = `Web ${s.stageNumber}. ${s.stageName}`;
        const durStr = typeof s.durationMs === "number" ? `${s.durationMs} ms` : "-";
        const statusStr = s.passed ? "✅ Passed" : "❌ Failed";
        lines.push(`| ${stageLabel} | ${durStr} | - | - | ${statusStr} |`);
      }
    }
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
 * Renders captured upstream thinking traces as collapsible, unscored evidence.
 * Never feeds pass/fail or role gating. Stages whose upstream emitted no
 * reasoning are listed explicitly so "absent" is distinguishable from "lost".
 */
export function buildReasoningTranscriptSection(summary: EvalOrchestratorSummary): string[] {
  const codeResults = (summary.codeSummary?.results ?? []) as CodeStageResult[];
  if (!summary.suitesRun.includes("code") || codeResults.length === 0) {
    return [];
  }
  const lines: string[] = [];
  lines.push("## 🧠 Reasoning Transcripts (Unscored Evidence)");
  lines.push("");
  lines.push("> Raw upstream thinking captured via the `ts`-nuance directive key. ");
  lines.push("> Qualitative evidence only — excluded from scores, verdicts, and role gating.");
  lines.push("");
  for (const r of codeResults) {
    const raw = (r as { details?: Record<string, unknown> }).details?.[REASONING_TRANSCRIPT_KEY];
    const entries = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
    if (entries.length === 0) {
      lines.push(`<details><summary>${r.stageName} — no reasoning emitted by upstream</summary>`);
      lines.push("");
      lines.push("*(empty)*");
      lines.push("");
      lines.push("</details>");
      lines.push("");
      continue;
    }
    entries.forEach((entry, i) => {
      lines.push(`<details><summary>${r.stageName} — transcript ${i + 1} (${entry.length} chars)</summary>`);
      lines.push("");
      lines.push(entry);
      lines.push("");
      lines.push("</details>");
      lines.push("");
    });
  }
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

    const executedCodeMap = new Map<number, CodeStageResult>();
    const executedResults = (summary.codeSummary.results ?? []) as CodeStageResult[];
    executedResults.forEach((r, idx) => {
      const stageNum = extractCodeStageNumber(r.stageName, idx);
      executedCodeMap.set(stageNum, r);
    });

    const firstFailedCode = executedResults.find((r) => !r.passed);
    let firstFailedCodeNum: number | null = null;
    if (firstFailedCode) {
      const fIdx = executedResults.indexOf(firstFailedCode);
      firstFailedCodeNum = extractCodeStageNumber(firstFailedCode.stageName, fIdx);
    }

    for (const canonical of CANONICAL_CODE_STAGES) {
      const r = executedCodeMap.get(canonical.stageNumber);
      if (r) {
        const statusIcon = r.passed ? "🟢 PASSED" : "🔴 FAILED";
        const notes = r.notes && r.notes.length > 0 ? r.notes.join("; ") : (r.passed ? "Passed verification" : "Criteria unmet");
        lines.push(`| **${canonical.stageNumber}** | ${r.stageName} | \`${r.score}/100\` | ${statusIcon} | ${notes} |`);
      } else {
        let reason = "Intentionally excluded (CLI filter / not scheduled)";
        if (firstFailedCodeNum !== null && canonical.stageNumber > firstFailedCodeNum) {
          reason = `Aborted: Stage ${firstFailedCodeNum} failed in fail-fast mode`;
        }
        lines.push(`| **${canonical.stageNumber}** | ${canonical.stageName} | \`—\` | ⏭️ SKIPPED | ${reason} |`);
      }
    }

    for (const [stageNum, r] of executedCodeMap) {
      if (stageNum > 5 || stageNum < 1) {
        const statusIcon = r.passed ? "🟢 PASSED" : "🔴 FAILED";
        const notes = r.notes && r.notes.length > 0 ? r.notes.join("; ") : (r.passed ? "Passed verification" : "Criteria unmet");
        lines.push(`| **${stageNum}** | ${r.stageName} | \`${r.score}/100\` | ${statusIcon} | ${notes} |`);
      }
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

    const executedWebMap = new Map<number, WebStageResult>();
    const executedWebStages = summary.webResult.stages ?? [];
    for (const stage of executedWebStages) {
      executedWebMap.set(stage.stageNumber, stage);
    }

    const failedWeb = executedWebStages.find((s) => !s.passed);
    const failedWebNum = failedWeb ? failedWeb.stageNumber : null;

    for (const canonical of CANONICAL_WEB_STAGES) {
      const stage = executedWebMap.get(canonical.stageNumber);
      if (stage) {
        const statusIcon = stage.passed ? "🟢 PASSED" : "🔴 FAILED";
        const totalChecks = stage.checks.length;
        const passedChecks = stage.checks.filter((c) => c.passed).length;
        const checkRate = totalChecks > 0 ? `\`${passedChecks}/${totalChecks}\` checks` : `N/A`;
        lines.push(`| **${stage.stageNumber}** | ${stage.stageName} | \`${stage.score}/100\` | ${statusIcon} | \`${stage.durationMs} ms\` | ${checkRate} |`);
      } else {
        let reason = "Intentionally excluded (CLI filter / not scheduled)";
        if (failedWebNum !== null && canonical.stageNumber > failedWebNum) {
          reason = `Aborted: Stage ${failedWebNum} failed in fail-fast mode`;
        }
        lines.push(`| **${canonical.stageNumber}** | ${canonical.stageName} | \`—\` | ⏭️ SKIPPED | \`—\` | ${reason} |`);
      }
    }

    for (const [stageNum, stage] of executedWebMap) {
      if (stageNum > 5 || stageNum < 1) {
        const statusIcon = stage.passed ? "🟢 PASSED" : "🔴 FAILED";
        const totalChecks = stage.checks.length;
        const passedChecks = stage.checks.filter((c) => c.passed).length;
        const checkRate = totalChecks > 0 ? `\`${passedChecks}/${totalChecks}\` checks` : `N/A`;
        lines.push(`| **${stage.stageNumber}** | ${stage.stageName} | \`${stage.score}/100\` | ${statusIcon} | \`${stage.durationMs} ms\` | ${checkRate} |`);
      }
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

  // Reasoning Transcripts Section (unscored evidence)
  const transcriptLines = buildReasoningTranscriptSection(summary);
  if (transcriptLines.length > 0) {
    lines.push(...transcriptLines);
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

function formatWireSpeed(w?: WireResultSummary): string {
  if (!w?.summary) return w?.error ? "Error" : "N/A";
  const speedAgg = w.summary.speedResult?.aggregates?.find(
    (a) => a.model === w.summary?.model
  ) ?? w.summary.speedResult?.aggregates?.[0];
  if (speedAgg && speedAgg.avgSpeedTokPerSec > 0) {
    return `${speedAgg.avgSpeedTokPerSec.toFixed(1)} tok/s`;
  }
  const telemetry = computePipelineAvgSpeed(
    (w.summary.codeSummary?.results ?? []) as CodeStageResult[],
    (w.summary.webResult?.stages ?? []) as WebStageResult[]
  );
  if (telemetry.pipelineAvgSpeed > 0) {
    return `${telemetry.pipelineAvgSpeed.toFixed(1)} tok/s`;
  }
  return "-";
}

function formatWireTtft(w?: WireResultSummary): string {
  if (!w?.summary) return "-";
  const speedAgg = w.summary.speedResult?.aggregates?.find(
    (a) => a.model === w.summary?.model
  ) ?? w.summary.speedResult?.aggregates?.[0];
  if (speedAgg && speedAgg.avgTtftMs > 0) {
    return `${Math.round(speedAgg.avgTtftMs)} ms`;
  }
  return "-";
}

function formatWireLatency(w?: WireResultSummary): string {
  if (!w?.summary) return "-";
  const speedAgg = w.summary.speedResult?.aggregates?.find(
    (a) => a.model === w.summary?.model
  ) ?? w.summary.speedResult?.aggregates?.[0];
  if (speedAgg && speedAgg.avgDurationMs > 0) {
    return `${Math.round(speedAgg.avgDurationMs)} ms`;
  }
  return "-";
}

function formatWireCodeRate(w?: WireResultSummary): string {
  if (!w?.summary?.codeSummary) return w?.error ? "Error" : "N/A";
  const results = w.summary.codeSummary.results ?? [];
  if (results.length === 0) return "N/A";
  const passed = results.filter((r) => r.passed).length;
  const pct = Math.round((passed / results.length) * 100);
  return `${passed}/${results.length} (${pct}%)`;
}

function formatWireWebRate(w?: WireResultSummary): string {
  if (!w?.summary?.webResult) return w?.error ? "Error" : "N/A";
  const stages = w.summary.webResult.stages ?? [];
  if (stages.length === 0) return "N/A";
  const passed = stages.filter((s) => s.passed).length;
  return `${passed}/${stages.length} (${w.summary.webResult.compositeScore}/100)`;
}

function formatWireVerdict(w?: WireResultSummary): string {
  if (!w) return "⚪ NOT RUN";
  if (w.error) return "🔴 ERROR";
  return w.passed ? "🟢 PASSED" : "🔴 FAILED";
}

function formatWireRole(w?: WireResultSummary): string {
  if (!w?.summary) return w?.error ? "ERROR" : "N/A";
  return w.summary.roleRecommendation.role;
}

function formatWireDetailSection(wireNumber: number, w: WireResultSummary): string[] {
  const lines: string[] = [];
  lines.push(`## 🔌 Wire ${wireNumber}: ${w.wireLabel} (\`${w.wire}\`)`);
  lines.push("");
  lines.push(`> **Directive Key:** \`${w.directiveKey}\`  `);
  lines.push(`> **Endpoint Target:** \`${w.gatewayUrl}\`  `);
  lines.push(`> **Verdict:** ${formatWireVerdict(w)}  `);

  if (w.error) {
    lines.push("");
    lines.push(`> ⚠️ **Execution Error:** \`${w.error}\`  `);
    lines.push("");
    return lines;
  }

  if (!w.summary) {
    lines.push("");
    lines.push("*(No execution telemetry recorded for this wire)*");
    lines.push("");
    return lines;
  }

  const s = w.summary;
  const codeResults = (s.codeSummary?.results ?? []) as CodeStageResult[];
  const webStages = (s.webResult?.stages ?? []) as WebStageResult[];
  const telemetry = computePipelineAvgSpeed(codeResults, webStages);

  if (telemetry.pipelineAvgSpeed > 0) {
    lines.push(`> **Pipeline Avg Speed:** \`${telemetry.pipelineAvgSpeed.toFixed(1)} tok/s\`  `);
  }
  lines.push("");

  // Speed Benchmark Table
  if (s.speedResult && s.speedResult.aggregates.length > 0) {
    lines.push("### ⚡ Speed & Throughput Benchmark");
    lines.push("");
    lines.push("| Model | Iterations | TTFT (min / avg / max) | Avg Latency | Tokens | Speed |");
    lines.push("|---|:---:|:---:|:---:|:---:|:---:|");
    for (const agg of s.speedResult.aggregates) {
      const ttftStr = `${Math.round(agg.minTtftMs)} / ${Math.round(agg.avgTtftMs)} / ${Math.round(agg.maxTtftMs)} ms`;
      const durStr = `${Math.round(agg.avgDurationMs)} ms`;
      const tokStr = `${Math.round(agg.avgTotalTokens)}`;
      const spdStr = `${agg.avgSpeedTokPerSec.toFixed(1)} tok/s`;
      lines.push(`| \`${agg.model}\` | ${agg.successfulRuns} | ${ttftStr} | ${durStr} | ${tokStr} | ${spdStr} |`);
    }
    lines.push("");
  }

  // Code & Agentic Capability Table
  if (s.codeSummary && s.codeSummary.results.length > 0) {
    lines.push("### 🛡️ Code & Agentic Capability Scorecard");
    lines.push("");
    lines.push("| Stage # | Stage Name | Score | Status | Duration | Completion Tokens |");
    lines.push("|---|---|:---:|:---:|:---:|:---:|");

    const executedCodeMap = new Map<number, CodeStageResult>();
    s.codeSummary.results.forEach((r, idx) => {
      const stageNum = extractCodeStageNumber(r.stageName, idx);
      executedCodeMap.set(stageNum, r);
    });

    for (const canonical of CANONICAL_CODE_STAGES) {
      const r = executedCodeMap.get(canonical.stageNumber);
      if (r) {
        const stageLabel = formatStageName(r.stageName, canonical.stageNumber - 1);
        const durStr = typeof r.durationMs === "number" ? `${r.durationMs} ms` : "-";
        const tokStr = typeof r.completionTokens === "number" ? `${r.completionTokens}` : "-";
        const statusStr = r.passed ? "🟢 PASSED" : "🔴 FAILED";
        lines.push(`| **${canonical.stageNumber}** | ${stageLabel} | \`${r.score ?? 100}/100\` | ${statusStr} | ${durStr} | ${tokStr} |`);
      } else {
        const stageLabel = formatStageName(canonical.stageName, canonical.stageNumber - 1);
        lines.push(`| **${canonical.stageNumber}** | ${stageLabel} | - | ⏭️ SKIPPED | - | - |`);
      }
    }
    lines.push("");
    const passedCode = s.codeSummary.results.filter((r) => r.passed).length;
    lines.push(`**Code Suite Verdict:** ${s.codeSummary.allPassed ? "🟢 **CERTIFIED**" : "🔴 **FAILED**"} (\`${passedCode}/${s.codeSummary.results.length}\` stages cleared)`);
    lines.push("");
  }

  // Web Frontend Scorecard
  if (s.webResult && s.webResult.stages.length > 0) {
    lines.push("### 🌐 Web Frontend Scorecard");
    lines.push("");
    lines.push("| Stage # | Stage Name | Score | Status | Duration | Sub-Check Pass Rate |");
    lines.push("|---|---|:---:|:---:|:---:|:---:|");

    const executedWebMap = new Map<number, WebStageResult>();
    s.webResult.stages.forEach((st) => executedWebMap.set(st.stageNumber, st));

    for (const canonical of CANONICAL_WEB_STAGES) {
      const st = executedWebMap.get(canonical.stageNumber);
      if (st) {
        const statusStr = st.passed ? "🟢 PASSED" : "🔴 FAILED";
        const checks = st.checks.length > 0 ? `\`${st.checks.filter((c) => c.passed).length}/${st.checks.length}\`` : "N/A";
        lines.push(`| **${st.stageNumber}** | ${st.stageName} | \`${st.score}/100\` | ${statusStr} | \`${st.durationMs} ms\` | ${checks} |`);
      } else {
        lines.push(`| **${canonical.stageNumber}** | ${canonical.stageName} | - | ⏭️ SKIPPED | - | - |`);
      }
    }
    lines.push("");
    lines.push(`**Web Composite Score:** \`${s.webResult.compositeScore}/100\` (${s.webResult.isProductionReady ? "🟢 **PRODUCTION READY**" : "🔴 **NEEDS REFINEMENT**"})`);
    lines.push("");
  }

  return lines;
}

export function determineUnifiedRoleRecommendation(
  chat: WireResultSummary,
  responses: WireResultSummary,
  messages: WireResultSummary
): UnifiedRoleRecommendation {
  const wires = [chat, responses, messages];
  const strengthsSet = new Set<string>();
  const caveatsSet = new Set<string>();

  for (const w of wires) {
    if (w.summary?.roleRecommendation) {
      for (const s of w.summary.roleRecommendation.strengths) {
        strengthsSet.add(s);
      }
      for (const c of w.summary.roleRecommendation.caveats) {
        caveatsSet.add(c);
      }
    }
    if (w.error) {
      caveatsSet.add(`${w.wireLabel} encountered runtime failure: ${w.error}`);
    }
  }

  // 1. Best Wire for Orchestrator
  let bestWireForOrchestrator = "Responses API (/v1/responses)";
  let maxOrchScore = -1;

  for (const w of wires) {
    if (!w.summary?.codeSummary) continue;
    const stages = w.summary.codeSummary.results ?? [];
    let orchPoints = 0;
    for (const r of stages) {
      const lower = r.stageName.toLowerCase();
      if ((lower.includes("pydantic") || lower.includes("agentic") || lower.includes("security")) && r.passed) {
        orchPoints += (r.score ?? 100);
      }
    }
    const wireBonus = w.wire === "responses" ? 5 : 0;
    if (orchPoints + wireBonus > maxOrchScore) {
      maxOrchScore = orchPoints + wireBonus;
      bestWireForOrchestrator = `${w.wireLabel} (\`${w.directiveKey}\`)`;
    }
  }

  // 2. Best Wire for Coder
  let bestWireForCoder = "Chat Completions (/v1/chat/completions)";
  let maxCoderScore = -1;

  for (const w of wires) {
    if (!w.summary?.codeSummary) continue;
    const stages = w.summary.codeSummary.results ?? [];
    let coderPoints = 0;
    for (const r of stages) {
      const lower = r.stageName.toLowerCase();
      if (lower.includes("patch") || lower.includes("surgical")) {
        coderPoints += (r.score ?? (r.passed ? 100 : 0));
      }
    }
    const passedCount = stages.filter((r) => r.passed).length;
    coderPoints += passedCount * 10;
    if (coderPoints > maxCoderScore) {
      maxCoderScore = coderPoints;
      bestWireForCoder = `${w.wireLabel} (\`${w.directiveKey}\`)`;
    }
  }

  // 3. Best Wire for Explorer
  let bestWireForExplorer = "Chat Completions (/v1/chat/completions)";
  let maxExplorerSpeed = -1;

  for (const w of wires) {
    if (!w.summary) continue;
    const speedAgg = w.summary.speedResult?.aggregates?.find(
      (a) => a.model === w.summary?.model
    ) ?? w.summary.speedResult?.aggregates?.[0];
    const tokPerSec = speedAgg?.avgSpeedTokPerSec ?? 0;
    if (tokPerSec > maxExplorerSpeed) {
      maxExplorerSpeed = tokPerSec;
      const ttft = speedAgg?.avgTtftMs ? ` (${Math.round(speedAgg.avgTtftMs)}ms TTFT)` : "";
      bestWireForExplorer = `${w.wireLabel} (\`${tokPerSec.toFixed(1)} tok/s\`${ttft})`;
    }
  }

  // Overall Role
  const roles = wires.map((w) => w.summary?.roleRecommendation.role).filter(Boolean);
  let overallRole: ArchitecturalRole = "Explorer";
  let badge = "⚡ FAST EXPLORER";
  let rationale = "Recommended for fast browsing, repo exploration, and symbol navigation.";

  if (roles.includes("Orchestrator")) {
    overallRole = "Orchestrator";
    badge = "🧠 MASTER ORCHESTRATOR";
    rationale =
      "Excels in structured output generation, durable multi-turn context retention, and strict schema validation. Prime candidate for orchestrating multi-agent pipelines, beads tracking, complex tool invocations, and supervisor duties.";
  } else if (roles.includes("General Coder")) {
    overallRole = "General Coder";
    badge = "💻 GENERAL CODER";
    rationale =
      "Demonstrates solid surgical code diffing, patch fidelity, and code synthesis across one or more wire protocols. Well-suited for core engineering workflows, writing implementation code, debugging unit tests, and delivering full-stack features.";
  }

  return {
    overallRole,
    badge,
    rationale,
    bestWireForOrchestrator,
    bestWireForCoder,
    bestWireForExplorer,
    strengths: Array.from(strengthsSet),
    caveats: Array.from(caveatsSet),
  };
}

export function generateConsolidatedMarkdownReport(summary: ConsolidatedModelSummary): string {
  const lines: string[] = [];
  const rec = summary.unifiedRoleRecommendation;

  lines.push(`# 🏛️ Consolidated Multi-Wire Evaluation Report: \`${summary.model}\``);
  lines.push("");
  lines.push(`> **Generated:** \`${summary.timestamp}\`  `);
  lines.push(`> **Target Gateway:** \`${summary.gatewayHost}\`  `);
  lines.push(`> **Chat Directive:** \`${summary.directiveKeys.chat}\`  `);
  lines.push(`> **Responses Directive:** \`${summary.directiveKeys.responses}\`  `);
  lines.push(`> **Anthropic Directive:** \`${summary.directiveKeys.messages}\`  `);
  lines.push(`> **Wires Tested:** \`Chat Completions (/v1/chat/completions)\`, \`Responses API (/v1/responses)\`, \`Anthropic Messages (/v1/messages)\`  `);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Unified Role Recommendation
  lines.push("## 🎯 Unified Role Recommendation");
  lines.push("");
  lines.push(`### ${rec.badge} — **${rec.overallRole.toUpperCase()}**`);
  lines.push("");
  lines.push(`**Executive Rationale:**  `);
  lines.push(`${rec.rationale}`);
  lines.push("");
  lines.push("#### 🏆 Wire Specialization Matrix");
  lines.push(`- 🧠 **Best Wire for Orchestrator**: ${rec.bestWireForOrchestrator}`);
  lines.push(`- 💻 **Best Wire for General Coder**: ${rec.bestWireForCoder}`);
  lines.push(`- ⚡ **Best Wire for Explorer**: ${rec.bestWireForExplorer}`);
  lines.push("");

  if (rec.strengths.length > 0) {
    lines.push("#### 🌟 Cross-Wire Strengths");
    for (const s of rec.strengths) {
      lines.push(`- ✅ ${s}`);
    }
    lines.push("");
  }

  if (rec.caveats.length > 0) {
    lines.push("#### ⚠️ Observed Limitations & Caveats");
    for (const c of rec.caveats) {
      lines.push(`- ⚠️ ${c}`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("");

  // Cross-Wire Comparison Matrix Table
  lines.push("## 📊 Cross-Wire Comparison Matrix");
  lines.push("");
  lines.push("| Metric / Dimension | Wire 1: Chat Completions | Wire 2: Responses API | Wire 3: Anthropic Messages |");
  lines.push("|---|:---:|:---:|:---:|");
  lines.push(`| **Directive Key** | \`${summary.directiveKeys.chat}\` | \`${summary.directiveKeys.responses}\` | \`${summary.directiveKeys.messages}\` |`);
  lines.push(`| **Endpoint** | \`/v1/chat/completions\` | \`/v1/responses\` | \`/v1/messages\` |`);
  lines.push(`| **Overall Verdict** | ${formatWireVerdict(summary.wireResults.chat)} | ${formatWireVerdict(summary.wireResults.responses)} | ${formatWireVerdict(summary.wireResults.messages)} |`);
  lines.push(`| **Throughput Speed** | \`${formatWireSpeed(summary.wireResults.chat)}\` | \`${formatWireSpeed(summary.wireResults.responses)}\` | \`${formatWireSpeed(summary.wireResults.messages)}\` |`);
  lines.push(`| **Average TTFT** | \`${formatWireTtft(summary.wireResults.chat)}\` | \`${formatWireTtft(summary.wireResults.responses)}\` | \`${formatWireTtft(summary.wireResults.messages)}\` |`);
  lines.push(`| **Average Latency** | \`${formatWireLatency(summary.wireResults.chat)}\` | \`${formatWireLatency(summary.wireResults.responses)}\` | \`${formatWireLatency(summary.wireResults.messages)}\` |`);
  lines.push(`| **Code Pass Rate** | \`${formatWireCodeRate(summary.wireResults.chat)}\` | \`${formatWireCodeRate(summary.wireResults.responses)}\` | \`${formatWireCodeRate(summary.wireResults.messages)}\` |`);
  lines.push(`| **Web Pass Rate** | \`${formatWireWebRate(summary.wireResults.chat)}\` | \`${formatWireWebRate(summary.wireResults.responses)}\` | \`${formatWireWebRate(summary.wireResults.messages)}\` |`);
  lines.push(`| **Wire Role** | **${formatWireRole(summary.wireResults.chat)}** | **${formatWireRole(summary.wireResults.responses)}** | **${formatWireRole(summary.wireResults.messages)}** |`);
  lines.push("");
  lines.push("---");
  lines.push("");

  // Detailed Per-Wire Sections
  lines.push(...formatWireDetailSection(1, summary.wireResults.chat));
  lines.push("---");
  lines.push("");
  lines.push(...formatWireDetailSection(2, summary.wireResults.responses));
  lines.push("---");
  lines.push("");
  lines.push(...formatWireDetailSection(3, summary.wireResults.messages));
  lines.push("---");
  lines.push("");

  // Reasoning Transcripts (Empirical Audit)
  const allTranscripts: { wireLabel: string; stageName: string; transcripts: string[] }[] = [];
  for (const w of [summary.wireResults.chat, summary.wireResults.responses, summary.wireResults.messages]) {
    if (w.summary) {
      const codeResults = (w.summary.codeSummary?.results ?? []) as CodeStageResult[];
      for (const r of codeResults) {
        const raw = (r as { details?: Record<string, unknown> }).details?.[REASONING_TRANSCRIPT_KEY];
        const entries = Array.isArray(raw) ? raw.filter((t): t is string => typeof t === "string") : [];
        if (entries.length > 0) {
          allTranscripts.push({ wireLabel: w.wireLabel, stageName: r.stageName, transcripts: entries });
        }
      }
    }
  }

  if (allTranscripts.length > 0) {
    lines.push("## 🔍 Upstream Reasoning Transcripts (Empirical Audit)");
    lines.push("");
    for (const item of allTranscripts) {
      item.transcripts.forEach((t, i) => {
        lines.push(`<details><summary>[${item.wireLabel}] ${item.stageName} — transcript ${i + 1} (${t.length} chars)</summary>`);
        lines.push("");
        lines.push(t);
        lines.push("");
        lines.push("</details>");
        lines.push("");
      });
    }
    lines.push("---");
    lines.push("");
  }

  // Operational Guidance
  lines.push("## 📝 Operational LiteRouter Deployment Guidance");
  lines.push("");
  lines.push("```json");
  lines.push(
    JSON.stringify(
      {
        model: summary.model,
        recommendedRole: rec.overallRole,
        bestWireForOrchestrator: rec.bestWireForOrchestrator,
        bestWireForCoder: rec.bestWireForCoder,
        bestWireForExplorer: rec.bestWireForExplorer,
        allWiresPassed: summary.allWiresPassed,
        directiveKeys: summary.directiveKeys,
      },
      null,
      2
    )
  );
  lines.push("```");
  lines.push("");

  return lines.join("\n");
}

export function writeConsolidatedMarkdownReport(
  summary: ConsolidatedModelSummary,
  customDir?: string
): string {
  const reportsDir = ensureReportsDirectory(customDir);
  const fileName = `${summary.sanitizedModelName}.md`;
  const filePath = join(reportsDir, fileName);

  const markdownContent = generateConsolidatedMarkdownReport(summary);
  writeFileSync(filePath, markdownContent, "utf-8");

  return filePath;
}

export async function runMultiWireModelEvaluation(
  target: ValidatedEvalArgs,
  baseOptions: EvalOrchestratorOptions
): Promise<ConsolidatedModelSummary> {
  const wireKeys = deriveWireDirectiveKeys(target.directiveKey, target.providerCode);
  const baseUrl = getDefaultGatewayBaseUrl();

  console.log(`\n========================================================================`);
  console.log(`🚀 \x1b[1m\x1b[36mLITEROUTER MULTI-WIRE MASTER EVALUATION ORCHESTRATOR\x1b[0m`);
  console.log(`========================================================================`);
  console.log(`🎯 Target Model    : \x1b[1m\x1b[36m${target.model}\x1b[0m`);
  console.log(`🏢 Provider        : \x1b[33m${target.provider} (${target.providerCode})\x1b[0m`);
  console.log(`🌐 Gateway Host    : ${baseUrl}`);
  console.log(`🔑 Wire 1 (Chat)   : \x1b[35m${wireKeys.chat}\x1b[0m (/v1/chat/completions)`);
  console.log(`🔑 Wire 2 (Resp)   : \x1b[35m${wireKeys.responses}\x1b[0m (/v1/responses)`);
  console.log(`🔑 Wire 3 (Msg)    : \x1b[35m${wireKeys.messages}\x1b[0m (/v1/messages)`);
  console.log(`📦 Suites Scope    : \x1b[33m${(baseOptions.suites ?? ["speed", "code", "web"]).join(", ")}\x1b[0m`);
  console.log(`🔁 Runs / Test     : ${baseOptions.runs ?? 2}`);
  console.log(`========================================================================\n`);

  const wireResults: {
    chat: WireResultSummary;
    responses: WireResultSummary;
    messages: WireResultSummary;
  } = {
    chat: {
      wire: "chat",
      wireLabel: "Chat Completions",
      directiveKey: wireKeys.chat,
      gatewayUrl: `${baseUrl}/v1/chat/completions`,
      passed: false,
    },
    responses: {
      wire: "responses",
      wireLabel: "Responses API",
      directiveKey: wireKeys.responses,
      gatewayUrl: `${baseUrl}/v1/responses`,
      passed: false,
    },
    messages: {
      wire: "messages",
      wireLabel: "Anthropic Messages",
      directiveKey: wireKeys.messages,
      gatewayUrl: `${baseUrl}/v1/messages`,
      passed: false,
    },
  };

  // Wire 1: Chat Completions
  console.log(`\n========================================================================`);
  console.log(`🔌 [1/3] SEQUENTIAL MATRIX: WIRE 1 (Chat Completions: /v1/chat/completions)`);
  console.log(`🔑 Directive Key : \x1b[33m${wireKeys.chat}\x1b[0m`);
  console.log(`========================================================================`);
  uninstallAnthropicBridge();
  try {
    const summaryChat = await runMasterEvaluation({
      ...baseOptions,
      model: target.model,
      provider: target.provider,
      directiveKey: wireKeys.chat,
      gatewayUrl: `${baseUrl}/v1/chat/completions`,
      wire: "chat",
      skipReport: true,
    });
    wireResults.chat.summary = summaryChat;
    wireResults.chat.passed = summaryChat.allSuitesPassed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31m❌ Wire 1 (Chat Completions) failed:\x1b[0m`, msg);
    wireResults.chat.error = msg;
    wireResults.chat.passed = false;
  }

  // Wire 2: Responses API
  console.log(`\n========================================================================`);
  console.log(`🔌 [2/3] SEQUENTIAL MATRIX: WIRE 2 (Responses API: /v1/responses)`);
  console.log(`🔑 Directive Key : \x1b[33m${wireKeys.responses}\x1b[0m`);
  console.log(`========================================================================`);
  uninstallAnthropicBridge();
  try {
    const summaryRs = await runMasterEvaluation({
      ...baseOptions,
      model: target.model,
      provider: target.provider,
      directiveKey: wireKeys.responses,
      gatewayUrl: `${baseUrl}/v1/responses`,
      wire: "responses",
      skipReport: true,
    });
    wireResults.responses.summary = summaryRs;
    wireResults.responses.passed = summaryRs.allSuitesPassed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31m❌ Wire 2 (Responses API) failed:\x1b[0m`, msg);
    wireResults.responses.error = msg;
    wireResults.responses.passed = false;
  }

  // Wire 3: Anthropic Messages
  console.log(`\n========================================================================`);
  console.log(`🔌 [3/3] SEQUENTIAL MATRIX: WIRE 3 (Anthropic Messages: /v1/messages)`);
  console.log(`🔑 Directive Key : \x1b[33m${wireKeys.messages}\x1b[0m`);
  console.log(`========================================================================`);
  installAnthropicBridge();
  try {
    const summaryMs = await runMasterEvaluation({
      ...baseOptions,
      model: target.model,
      provider: target.provider,
      directiveKey: wireKeys.messages,
      gatewayUrl: `${baseUrl}/v1/messages`,
      wire: "messages",
      skipReport: true,
    });
    wireResults.messages.summary = summaryMs;
    wireResults.messages.passed = summaryMs.allSuitesPassed;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\x1b[31m❌ Wire 3 (Anthropic Messages) failed:\x1b[0m`, msg);
    wireResults.messages.error = msg;
    wireResults.messages.passed = false;
  } finally {
    uninstallAnthropicBridge();
  }

  const allWiresPassed = wireResults.chat.passed && wireResults.responses.passed && wireResults.messages.passed;
  const unifiedRoleRecommendation = determineUnifiedRoleRecommendation(
    wireResults.chat,
    wireResults.responses,
    wireResults.messages
  );

  const consolidated: ConsolidatedModelSummary = {
    model: target.model,
    sanitizedModelName: sanitizeModelName(target.model),
    timestamp: new Date().toISOString(),
    gatewayHost: baseUrl,
    directiveKeys: wireKeys,
    wireResults,
    allWiresPassed,
    unifiedRoleRecommendation,
  };

  if (!baseOptions.skipReport) {
    const reportPath = writeConsolidatedMarkdownReport(consolidated, baseOptions.reportsDir);
    consolidated.reportPath = reportPath;
    console.log(`\n📄 \x1b[1m\x1b[32mConsolidated Multi-Wire Report saved to: ${reportPath}\x1b[0m\n`);
  }

  // Console cross-wire summary matrix
  console.log(`\n========================================================================================================================`);
  console.log(`🏁 \x1b[1m\x1b[36mCONSOLIDATED 3-WIRE MATRIX: ${target.model}\x1b[0m`);
  console.log(`========================================================================================================================`);
  console.log(`| Wire Protocol        | Directive Key    | Status   | Speed     | Avg TTFT | Code (Stages) | Web Score | Role`);
  console.log(`|----------------------|------------------|----------|-----------|----------|---------------|-----------|------------------`);
  for (const w of [wireResults.chat, wireResults.responses, wireResults.messages]) {
    const proto = w.wireLabel.padEnd(20).slice(0, 20);
    const key = w.directiveKey.padEnd(16).slice(0, 16);
    const st = (w.passed ? "\x1b[32mPASSED\x1b[0m  " : "\x1b[31mFAILED\x1b[0m  ");
    const spd = formatWireSpeed(w).padEnd(9).slice(0, 9);
    const ttft = formatWireTtft(w).padEnd(8).slice(0, 8);
    const code = formatWireCodeRate(w).padEnd(13).slice(0, 13);
    const web = formatWireWebRate(w).padEnd(9).slice(0, 9);
    const role = formatWireRole(w).padEnd(18).slice(0, 18);
    console.log(`| ${proto} | ${key} | ${st} | ${spd} | ${ttft} | ${code} | ${web} | ${role}`);
  }
  console.log(`========================================================================================================================`);
  console.log(`🏆 \x1b[1mUnified Role: ${unifiedRoleRecommendation.badge} (${unifiedRoleRecommendation.overallRole})\x1b[0m`);
  console.log(`========================================================================================================================\n`);

  return consolidated;
}

export async function runBatchMultiWireEvaluation(
  targets: ValidatedEvalArgs[],
  baseOptions: EvalOrchestratorOptions
): Promise<boolean> {
  console.log(`\n========================================================================================================================`);
  console.log(`📋 \x1b[1m\x1b[36mSTARTING MULTI-WIRE BATCH EVALUATION (${targets.length} MODELS)\x1b[0m`);
  console.log(`========================================================================================================================`);
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]!;
    console.log(`  [${i + 1}/${targets.length}] ${t.model} (${t.provider}) -> ${t.directiveKey}`);
  }
  console.log(`========================================================================================================================\n`);

  const results: ConsolidatedModelSummary[] = [];
  for (let idx = 0; idx < targets.length; idx++) {
    const target = targets[idx]!;
    console.log(`\n▶ [${idx + 1}/${targets.length}] Processing Model: \x1b[1m\x1b[36m${target.model}\x1b[0m`);
    try {
      const summary = await runMultiWireModelEvaluation(target, baseOptions);
      results.push(summary);
      if (!summary.allWiresPassed && !baseOptions.continueOnFailure) {
        console.log(`\n🛑 Batch stopped after incomplete wire execution on ${target.model} (use --continue to evaluate remaining models).`);
        break;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(`\n❌ Error evaluating model ${target.model}:`, errMsg);
      if (!baseOptions.continueOnFailure) {
        console.log(`\n🛑 Batch stopped after fatal error on ${target.model} (use --continue to evaluate remaining models).`);
        break;
      }
    }
  }

  // Print Batch Summary Table
  console.log(`\n========================================================================================================================`);
  console.log(`🏁 \x1b[1m\x1b[36mCONSOLIDATED MULTI-WIRE BATCH EVALUATION SUMMARY REPORT\x1b[0m`);
  console.log(`========================================================================================================================`);
  console.log(`| # | Model Identifier                   | Provider     | Chat | Resp | Msg  | Unified Role Recommendation | Report Card`);
  console.log(`|---|------------------------------------|--------------|:----:|:----:|:----:|-----------------------------|-----------------------------------------`);

  for (let idx = 0; idx < results.length; idx++) {
    const r = results[idx]!;
    const num = String(idx + 1).padEnd(2);
    const m = r.model.padEnd(34).slice(0, 34);
    const p = (r.directiveKeys.chat).split("-")[1]?.padEnd(12).slice(0, 12) ?? "unknown".padEnd(12);
    const chSt = r.wireResults.chat.passed ? "✅" : "❌";
    const rsSt = r.wireResults.responses.passed ? "✅" : "❌";
    const msSt = r.wireResults.messages.passed ? "✅" : "❌";
    const role = (r.unifiedRoleRecommendation.overallRole).padEnd(27).slice(0, 27);
    const rep = (r.reportPath ?? `eval/reports/${r.sanitizedModelName}.md`).padEnd(39).slice(0, 39);
    console.log(`| ${num}| ${m} | ${p} |  ${chSt}  |  ${rsSt}  |  ${msSt}  | ${role} | ${rep}`);
  }
  console.log(`========================================================================================================================\n`);

  return results.every((r) => r.allWiresPassed);
}

export function printHelp(): void {
  console.log(`
\x1b[1m\x1b[36mLiteRouter Master Evaluation Orchestrator (eval/eval.ts)\x1b[0m

\x1b[1mUSAGE (ARGUMENTS IN EXACT ORDER):\x1b[0m
  bun run eval/eval.ts <model_name> <provider> <api_key> [options]
  bun run eval/eval.ts [file_path] [options]

\x1b[1mDEFAULT HOST:\x1b[0m
  http://literouter.lan:7766

\x1b[1mARGUMENTS:\x1b[0m
  1. <model_name>        Target model identifier (e.g. google/gemini-3.5-flash-lite, stealth/union-alpha)
  2. <provider>          Provider in config/providers.json (openrouter, nvidia, google, zen, gcp / or, nv, gg, zn, gc)
  3. <api_key>           LiteRouter directive key (e.g. lr-gg-gg-gc-no, lr-or-oa-ch-no, lr-zn-cl-ms-no)

\x1b[1mEXAMPLES:\x1b[0m
  bun run eval/eval.ts                                      (Runs 3-wire matrix for models in eval/reports/test-models.txt)
  bun run eval/eval.ts --all-wires                          (Explicit 3-wire matrix for default models)
  bun run eval/eval.ts nex-agi/nex-n2.5-mini:free           (Runs 3-wire sequential matrix for target model)
  bun run eval/eval.ts stealth/union-alpha openrouter lr-or-oa-ch-no --all-wires
  bun run eval/eval.ts union-alpha zen lr-zn-cl-ms-no --wire messages --continue

\x1b[1mOPTIONS:\x1b[0m
  --all-wires            Execute full 3-wire sequential matrix (Chat -> Responses -> Messages) (default)
  --suites <list>        Comma-separated benchmark suites to execute:
                         speed, code, web (default: speed,code,web)
  --url <url>            LiteRouter gateway endpoint URL (default: http://literouter.lan:7766)
  --wire <chat|rs|ms>    Wire protocol ('chat', 'rs'/'responses', 'messages'/'ms')
  --stage <n>            Run ONLY a specific stage (1-5) for code / web suites
  --reasoning <effort>   Reasoning effort for thinking models: none, medium, high
  --reasoning-transcript Preserve upstream thinking (ts-nuance key) and append transcripts
  --no-reasoning-transcript Scrub thinking, no transcript appendix
  --runs <n>             Number of benchmark iterations per test (default: 2)
  --continue             Continue suite execution on stage failure (Diagnostic Mode)
  --skip-report          Do not write Markdown report card to eval/reports/
  --image <path_or_url>  Custom image input for web vision-language evaluation
  -h, --help             Show this help manual and exit

\x1b[1mREPORT OUTPUT:\x1b[0m
  Saved automatically to \x1b[33meval/reports/<sanitized_model_name>.md\x1b[0m
`);
}

export function parseCliArgs(
  argv: string[] = process.argv.slice(2),
  config: { strict?: boolean; allowDefaultFile?: boolean } = {}
): EvalOrchestratorOptions {
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }
  }

  if (config.strict) {
    const validated = validateStrictEvalArgs(argv, "eval/eval.ts", {
      allowDefaultFile: config.allowDefaultFile ?? true,
    });
    const { named } = extractPositionalAndNamed(argv);

    const opts: EvalOrchestratorOptions = {
      model: validated.model,
      provider: validated.provider,
      directiveKey: validated.directiveKey,
      suites: ["speed", "code", "web"],
      runs: 2,
      continueOnFailure: false,
      skipReport: false,
      reasoningTranscript: true,
      batchTargets: validated.batchTargets,
    };

    if (named["--all-wires"] || named["--allwires"] || named["--multi-wire"]) {
      opts.allWires = true;
    } else if (named["--wire"] && !named["--all-wires"]) {
      opts.allWires = false;
    } else {
      opts.allWires = true;
    }

    if (typeof named["--url"] === "string") opts.gatewayUrl = named["--url"];
    if (typeof named["--wire"] === "string") {
      const val = named["--wire"].toLowerCase();
      opts.wire =
        val === "rs" || val === "responses"
          ? "responses"
          : val === "chat"
            ? "chat"
            : val === "messages" || val === "ms" || val === "anthropic"
              ? "messages"
              : "auto";
    } else if (validated.directiveKey.includes("-ms-") || validated.directiveKey.includes("-cl-")) {
      opts.wire = "messages";
    }
    if (typeof named["--suites"] === "string") {
      const parts = named["--suites"].split(",").map((s) => s.trim().toLowerCase());
      const validSuites: SuiteType[] = [];
      for (const p of parts) {
        if (p === "speed" || p === "code" || p === "web") validSuites.push(p);
      }
      if (validSuites.length > 0) opts.suites = validSuites;
    }
    if (typeof named["--stage"] === "string") {
      const val = Number.parseInt(named["--stage"], 10);
      if (!Number.isNaN(val) && val >= 1 && val <= 5) opts.stage = val;
    }
    if (typeof named["--reasoning"] === "string") {
      const effort = named["--reasoning"];
      if (effort === "high" || effort === "medium" || effort === "none") {
        opts.reasoningEffort = effort as "high" | "medium" | "none";
      }
    }
    if (typeof named["--runs"] === "string") {
      const r = Number.parseInt(named["--runs"], 10);
      if (!Number.isNaN(r) && r > 0) opts.runs = r;
    }
    if (typeof named["--image"] === "string") opts.image = named["--image"];
    if (named["--continue"] || named["--no-fail-fast"]) opts.continueOnFailure = true;
    if (named["--reasoning-transcript"]) opts.reasoningTranscript = true;
    if (named["--no-reasoning-transcript"]) opts.reasoningTranscript = false;
    if (named["--skip-report"]) opts.skipReport = true;

    return opts;
  }

  // Non-strict fallback for tests and programmatic usage
  const { positionals, named } = extractPositionalAndNamed(argv);
  const opts: EvalOrchestratorOptions = {
    suites: ["speed", "code", "web"],
    runs: 2,
    continueOnFailure: false,
    skipReport: false,
    reasoningTranscript: true,
  };

  if (named["--all-wires"] || named["--allwires"] || named["--multi-wire"]) {
    opts.allWires = true;
  } else if (named["--wire"] && !named["--all-wires"]) {
    opts.allWires = false;
  } else {
    opts.allWires = true;
  }

  if (positionals[0]) opts.model = positionals[0];
  if (positionals[1]) opts.provider = positionals[1];
  if (positionals[2]) opts.directiveKey = positionals[2];

  if (typeof named["--model"] === "string") opts.model = named["--model"];
  if (typeof named["--provider"] === "string") opts.provider = named["--provider"];
  if (typeof named["--key"] === "string") opts.directiveKey = named["--key"];
  if (typeof named["--directive"] === "string") opts.directiveKey = named["--directive"];
  if (typeof named["--url"] === "string") opts.gatewayUrl = named["--url"];
  if (typeof named["--wire"] === "string") {
    const val = named["--wire"].toLowerCase();
    opts.wire =
      val === "rs" || val === "responses"
        ? "responses"
        : val === "chat"
          ? "chat"
          : val === "messages" || val === "ms" || val === "anthropic"
            ? "messages"
            : "auto";
  }
  if (typeof named["--suites"] === "string") {
    const parts = named["--suites"].split(",").map((s) => s.trim().toLowerCase());
    const validSuites: SuiteType[] = [];
    for (const p of parts) {
      if (p === "speed" || p === "code" || p === "web") validSuites.push(p);
    }
    if (validSuites.length > 0) opts.suites = validSuites;
  }
  if (typeof named["--stage"] === "string") {
    const val = Number.parseInt(named["--stage"], 10);
    if (!Number.isNaN(val) && val >= 1 && val <= 5) opts.stage = val;
  }
  if (typeof named["--reasoning"] === "string") {
    const effort = named["--reasoning"];
    if (effort === "high" || effort === "medium" || effort === "none") {
      opts.reasoningEffort = effort as "high" | "medium" | "none";
    }
  }
  if (typeof named["--runs"] === "string") {
    const r = Number.parseInt(named["--runs"], 10);
    if (!Number.isNaN(r) && r > 0) opts.runs = r;
  }
  if (typeof named["--image"] === "string") opts.image = named["--image"];
  if (named["--continue"] || named["--no-fail-fast"]) opts.continueOnFailure = true;
  if (named["--reasoning-transcript"]) opts.reasoningTranscript = true;
  if (named["--no-reasoning-transcript"]) opts.reasoningTranscript = false;
  if (named["--skip-report"]) opts.skipReport = true;

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
  const isMessages =
    options.wire === "messages" ||
    options.directiveKey?.includes("-ms-") ||
    options.directiveKey?.includes("-cl-") ||
    options.gatewayUrl?.includes("/messages");

  const wire: "chat" | "responses" | "messages" = isMessages
    ? "messages"
    : isResponses
      ? "responses"
      : "chat";
  const directiveKey = options.directiveKey ?? (isMessages ? "lr-zn-cl-ms-no" : isResponses ? "lr-zn-oo-rs-no" : "lr-or-oa-ch-no");
  const baseUrl = getDefaultGatewayBaseUrl();
  const defaultUrl = isMessages
    ? `${baseUrl}/v1/messages`
    : isResponses
      ? `${baseUrl}/v1/responses`
      : `${baseUrl}/v1/chat/completions`;
  const gatewayUrl = options.gatewayUrl ?? defaultUrl;

  console.log(`\n========================================================================`);
  console.log(`🚀 \x1b[1m\x1b[36mLITEROUTER MASTER EVALUATION ORCHESTRATOR\x1b[0m`);
  console.log(`========================================================================`);
  console.log(`🎯 Target Model  : \x1b[1m\x1b[36m${model}\x1b[0m`);
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
        wire: wire === "responses" ? "responses" : "chat",
        stageFilter: options.stage,
        runs,
        continueOnFailure,
        reasoningTranscript: options.reasoningTranscript ?? true,
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
  // codeSummary.directiveKey carries the effective key actually used on the
  // wire (e.g. ts-nuance variant when reasoning transcripts are enabled).
  const effectiveDirectiveKey = codeSummary?.directiveKey ?? directiveKey;
  const summary: EvalOrchestratorSummary = {
    model,
    sanitizedModelName: sanitized,
    timestamp,
    directiveKey: effectiveDirectiveKey,
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

/**
 * Executes evaluation suites across multiple model targets sequentially,
 * generating independent report cards and printing a consolidated batch summary.
 */
export async function runBatchEvaluation(
  targets: ValidatedEvalArgs[],
  baseOptions: EvalOrchestratorOptions
): Promise<boolean> {
  console.log(`\n========================================================================`);
  console.log(`🚀 \x1b[1m\x1b[36mLITEROUTER BATCH MULTI-MODEL EVALUATION\x1b[0m`);
  console.log(`========================================================================`);
  console.log(`📋 Total Targets : \x1b[1m${targets.length}\x1b[0m models in queue`);
  targets.forEach((t, i) => {
    console.log(`   ${i + 1}. \x1b[36m${t.model}\x1b[0m (\x1b[33m${t.provider}\x1b[0m | \x1b[35m${t.directiveKey}\x1b[0m)`);
  });
  console.log(`⚙️  Continue On Failure: ${baseOptions.continueOnFailure ? "YES (--continue)" : "NO (Fail-Fast)"}`);
  console.log(`========================================================================\n`);

  const results: Array<{
    target: ValidatedEvalArgs;
    summary?: EvalOrchestratorSummary;
    error?: string;
    passed: boolean;
  }> = [];

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i]!;
    console.log(`\n>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>`);
    console.log(`▶ \x1b[1m\x1b[32m[BATCH ${i + 1}/${targets.length}]\x1b[0m Evaluating: \x1b[1m\x1b[36m${target.model}\x1b[0m (\x1b[33m${target.provider}\x1b[0m)`);
    console.log(`>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>>\n`);

    const isTargetMessages =
      target.directiveKey.includes("-ms-") ||
      target.directiveKey.includes("-cl-") ||
      baseOptions.wire === "messages" ||
      baseOptions.gatewayUrl?.includes("/messages");

    if (isTargetMessages) {
      const { installAnthropicBridge } = await import("./anthropic_bridge");
      installAnthropicBridge();
    }

    const targetOpts: EvalOrchestratorOptions = {
      ...baseOptions,
      model: target.model,
      provider: target.provider,
      directiveKey: target.directiveKey,
      wire: isTargetMessages ? "messages" : baseOptions.wire,
      batchTargets: undefined,
    };

    try {
      const summary = await runMasterEvaluation(targetOpts);
      results.push({
        target,
        summary,
        passed: summary.allSuitesPassed,
      });

      if (!summary.allSuitesPassed && !baseOptions.continueOnFailure) {
        console.log(`\n🛑 Batch stopped after failure on ${target.model} (use --continue to evaluate remaining models).`);
        break;
      }
    } catch (err) {
      const errMsg = (err as Error).message;
      console.error(`\n❌ Error evaluating model ${target.model}:`, errMsg);
      results.push({
        target,
        error: errMsg,
        passed: false,
      });

      if (!baseOptions.continueOnFailure) {
        console.log(`\n🛑 Batch stopped after unhandled error on ${target.model} (use --continue to evaluate remaining models).`);
        break;
      }
    }
  }

  // Print Batch Summary Table
  console.log(`\n========================================================================================================================`);
  console.log(`🏁 \x1b[1m\x1b[36mCONSOLIDATED BATCH EVALUATION SUMMARY REPORT\x1b[0m`);
  console.log(`========================================================================================================================`);
  console.log(`| # | Model Identifier                   | Provider     | Status   | Role Recommendation          | Report Card`);
  console.log(`|---|------------------------------------|--------------|----------|------------------------------|-----------------------------------------`);

  for (let idx = 0; idx < results.length; idx++) {
    const r = results[idx]!;
    const num = String(idx + 1).padEnd(2);
    const m = r.target.model.padEnd(34).slice(0, 34);
    const p = r.target.provider.padEnd(12).slice(0, 12);
    const st = r.passed ? "\x1b[32mPASSED\x1b[0m  " : "\x1b[31mFAILED\x1b[0m  ";
    const role = (r.summary?.roleRecommendation.role ?? (r.error ? "ERROR" : "FAILED")).padEnd(28).slice(0, 28);
    const rep = (r.summary?.reportPath ?? `eval/reports/${r.target.model.replace(/[^a-zA-Z0-9._-]/g, "_")}.md`).padEnd(39).slice(0, 39);
    console.log(`| ${num}| ${m} | ${p} | ${st} | ${role} | ${rep}`);
  }
  console.log(`========================================================================================================================\n`);

  return results.every((r) => r.passed);
}

if (import.meta.main) {
  try {
    const options = parseCliArgs(process.argv.slice(2), { strict: true });
    const targets = options.batchTargets && options.batchTargets.length > 0
      ? options.batchTargets
      : [{
          model: options.model ?? "unknown",
          provider: options.provider ?? "unknown",
          providerCode: "xx",
          providerName: options.provider ?? "unknown",
          directiveKey: options.directiveKey ?? "lr-or-oa-ch-no",
        }];

    if (options.allWires) {
      // Multi-Wire Sequential Matrix Orchestration (Default)
      runBatchMultiWireEvaluation(targets, options)
        .then((allPassed) => {
          if (!allPassed && !options.continueOnFailure) {
            process.exit(1);
          }
        })
        .catch((err) => {
          console.error("\x1b[31mFatal error in multi-wire evaluation orchestrator:\x1b[0m", err);
          process.exit(1);
        });
    } else if (targets.length > 1) {
      // Multi-model single-wire batch mode
      runBatchEvaluation(targets, options)
        .then((allPassed) => {
          if (!allPassed && !options.continueOnFailure) {
            process.exit(1);
          }
        })
        .catch((err) => {
          console.error("\x1b[31mFatal error in batch evaluation orchestrator:\x1b[0m", err);
          process.exit(1);
        });
    } else {
      // Single-model single-wire mode
      if (
        options.wire === "messages" ||
        options.directiveKey?.includes("-ms-") ||
        options.directiveKey?.includes("-cl-") ||
        options.gatewayUrl?.includes("/messages")
      ) {
        // Anthropic Messages wire: bridge OpenAI-shaped stage traffic for the
        // whole process (idempotent). Native x-api-key callers pass through.
        installAnthropicBridge();
      }
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
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }
}
