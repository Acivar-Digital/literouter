import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import {
  sanitizeModelName,
  parseCliArgs,
  determineArchitecturalRole,
  generateMarkdownReport,
  writeMarkdownReport,
  ensureReportsDirectory,
  computePassAtK,
  computePercentile,
  computeMeanAndStdDev,
  computeConfidenceInterval,
  type EvalOrchestratorSummary,
} from "../../eval/eval";

describe("eval/eval.ts Master Orchestrator Unit Tests", () => {
  describe("sanitizeModelName", () => {
    it("should sanitize slashes, colons, and special characters", () => {
      expect(sanitizeModelName("nex-agi/nex-n2.5-pro:free")).toBe("nex-agi_nex-n2.5-pro_free");
      expect(sanitizeModelName("anthropic/claude-3.7-sonnet")).toBe("anthropic_claude-3.7-sonnet");
      expect(sanitizeModelName("inclusionai/ling-3.0-flash-fin:free")).toBe("inclusionai_ling-3.0-flash-fin_free");
      expect(sanitizeModelName("dots-studio/dots-3-note-preview:free")).toBe("dots-studio_dots-3-note-preview_free");
    });
  });

  describe("parseCliArgs", () => {
    it("should parse default arguments correctly", () => {
      const opts = parseCliArgs([]);
      expect(opts.suites).toEqual(["speed", "code", "web"]);
      expect(opts.runs).toBe(2);
      expect(opts.continueOnFailure).toBe(false);
      expect(opts.skipReport).toBe(false);
    });

    it("should parse custom suites, stage, reasoning, and flags", () => {
      const opts = parseCliArgs([
        "custom/model:tag",
        "--suites",
        "speed,code",
        "--stage",
        "4",
        "--reasoning",
        "high",
        "--key",
        "lr-nv-oa-ch-ts",
        "--continue",
        "--skip-report",
        "--runs",
        "5",
      ]);

      expect(opts.model).toBe("custom/model:tag");
      expect(opts.suites).toEqual(["speed", "code"]);
      expect(opts.stage).toBe(4);
      expect(opts.reasoningEffort).toBe("high");
      expect(opts.directiveKey).toBe("lr-nv-oa-ch-ts");
      expect(opts.continueOnFailure).toBe(true);
      expect(opts.skipReport).toBe(true);
      expect(opts.runs).toBe(5);
    });
  });

  describe("determineArchitecturalRole", () => {
    it("should recommend Orchestrator when code agentic & pydantic scores are high", () => {
      const codeSummary = {
        model: "test-model",
        wire: "chat" as const,
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "https://localhost:7766/v1/chat/completions",
        allPassed: true,
        results: [
          { stageName: "Stage 1: Wire Protocol", passed: true, score: 100, details: {}, notes: [] },
          { stageName: "Stage 2: Strict Pydantic AI 2.0 Types", passed: true, score: 95, details: {}, notes: [] },
          { stageName: "Stage 3: Dynamic State & Agentic Loop Durability", passed: true, score: 90, details: {}, notes: [] },
          { stageName: "Stage 4: Surgical Coding & Patch Fidelity", passed: true, score: 95, details: {}, notes: [] },
          { stageName: "Stage 5: Security & Injection Resilience", passed: true, score: 90, details: {}, notes: [] },
        ],
      };

      const role = determineArchitecturalRole(undefined, codeSummary, undefined);
      expect(role.role).toBe("Orchestrator");
      expect(role.badge).toContain("MASTER ORCHESTRATOR");
      expect(role.strengths).toContain("100% Code Certification Gates Passed");
    });

    it("should recommend General Coder when code has patch fidelity or web passes", () => {
      const codeSummary = {
        model: "test-model",
        wire: "chat" as const,
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "https://localhost:7766/v1/chat/completions",
        allPassed: false,
        results: [
          { stageName: "Stage 1: Wire Protocol", passed: true, score: 100, details: {}, notes: [] },
          { stageName: "Stage 2: Strict Pydantic AI 2.0 Types", passed: false, score: 40, details: {}, notes: [] },
          { stageName: "Stage 3: Dynamic State & Agentic Loop Durability", passed: false, score: 50, details: {}, notes: [] },
          { stageName: "Stage 4: Surgical Coding & Patch Fidelity", passed: true, score: 85, details: {}, notes: [] },
        ],
      };

      const role = determineArchitecturalRole(undefined, codeSummary, undefined);
      expect(role.role).toBe("General Coder");
      expect(role.badge).toContain("GENERAL CODER");
    });

    it("should recommend Explorer for fast low-latency models with simple capabilities", () => {
      const speedAgg = {
        model: "test-fast",
        successfulRuns: 2,
        avgTtftMs: 650,
        minTtftMs: 600,
        maxTtftMs: 700,
        avgDurationMs: 1500,
        avgTotalTokens: 100,
        avgSpeedTokPerSec: 65,
      };

      const role = determineArchitecturalRole(speedAgg, undefined, undefined);
      expect(role.role).toBe("Explorer");
      expect(role.badge).toContain("FAST EXPLORER");
    });
  });

  describe("generateMarkdownReport & writeMarkdownReport", () => {
    it("should synthesize a valid markdown report and write to file", () => {
      const summary: EvalOrchestratorSummary = {
        model: "test-provider/test-agent:free",
        sanitizedModelName: "test-provider_test-agent_free",
        timestamp: "2026-09-11T09:00:00.000Z",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "https://localhost:7766/v1/chat/completions",
        wire: "chat",
        suitesRun: ["speed", "code", "web"],
        speedResult: {
          allResults: {},
          aggregates: [
            {
              model: "test-provider/test-agent:free",
              successfulRuns: 2,
              avgTtftMs: 950,
              minTtftMs: 900,
              maxTtftMs: 1000,
              avgDurationMs: 2200,
              avgTotalTokens: 120,
              avgSpeedTokPerSec: 42.5,
            },
          ],
        },
        codeSummary: {
          model: "test-provider/test-agent:free",
          wire: "chat",
          directiveKey: "lr-or-oa-ch-no",
          gatewayUrl: "https://localhost:7766/v1/chat/completions",
          allPassed: true,
          results: [
            { stageName: "Stage 1: Wire Protocol", passed: true, score: 100, details: {}, notes: ["OK"] },
            { stageName: "Stage 2: Strict Pydantic AI 2.0 Types", passed: true, score: 100, details: {}, notes: ["Valid schema"] },
          ],
        },
        webResult: {
          model: "test-provider/test-agent:free",
          directiveKey: "lr-or-oa-ch-no",
          gatewayUrl: "https://localhost:7766/v1/chat/completions",
          allPassed: true,
          compositeScore: 92,
          totalDurationMs: 3400,
          isProductionReady: true,
          stages: [
            {
              stageNumber: 1,
              stageName: "Structure & Visual-to-DOM Fidelity",
              passed: true,
              score: 95,
              durationMs: 1200,
              checks: [{ name: "Grid layout", passed: true }],
            },
          ],
        },
        roleRecommendation: {
          role: "Orchestrator",
          badge: "🧠 MASTER ORCHESTRATOR",
          rationale: "Top tier performance across all benchmarks.",
          strengths: ["100% Code Certification Gates Passed"],
          caveats: [],
        },
        allSuitesPassed: true,
      };

      const md = generateMarkdownReport(summary);

      expect(md).toContain("# 🏛️ Model Evaluation Report Card: `test-provider/test-agent:free`");
      expect(md).toContain("MASTER ORCHESTRATOR");
      expect(md).toContain("Speed & Throughput Benchmark");
      expect(md).toContain("Code & Agentic Capability Scorecard");
      expect(md).toContain("Web Frontend & Vision-Language Scorecard");
      expect(md).toContain("Operational LiteRouter Deployment Guidance");

      // Test writing to disk
      const testDir = ensureReportsDirectory();
      const filePath = writeMarkdownReport(summary, testDir);
      expect(existsSync(filePath)).toBe(true);

      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("test-provider/test-agent:free");

      // Clean up test report file
      unlinkSync(filePath);
    });

    it("should include statistical analysis section when runs > 1", () => {
      const summary: EvalOrchestratorSummary = {
        model: "test-model",
        sanitizedModelName: "test-model",
        timestamp: "2026-09-11T09:00:00.000Z",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "https://localhost:7766/v1/chat/completions",
        wire: "chat",
        suitesRun: ["speed"],
        runs: 3,
        speedResult: {
          allResults: {
            "test-model": [
              {
                model: "test-model",
                run: 1,
                ttftMs: 500,
                totalDurationMs: 1200,
                thinkingTokens: 0,
                contentTokens: 100,
                totalTokens: 100,
                speedTokPerSec: 50,
                status: "OK",
              },
              {
                model: "test-model",
                run: 2,
                ttftMs: 600,
                totalDurationMs: 1400,
                thinkingTokens: 0,
                contentTokens: 100,
                totalTokens: 100,
                speedTokPerSec: 45,
                status: "OK",
              },
              {
                model: "test-model",
                run: 3,
                ttftMs: 550,
                totalDurationMs: 1300,
                thinkingTokens: 0,
                contentTokens: 100,
                totalTokens: 100,
                speedTokPerSec: 48,
                status: "OK",
              },
            ],
          },
          aggregates: [],
        },
        roleRecommendation: {
          role: "Explorer",
          badge: "⚡ FAST EXPLORER",
          rationale: "Fast streaming.",
          strengths: [],
          caveats: [],
        },
        allSuitesPassed: true,
      };

      const md = generateMarkdownReport(summary);

      expect(md).toContain("## 📊 Statistical Analysis (Runs: 3)");
      expect(md).toContain("| pass@1 (Sample Mean) |");
      expect(md).toContain("| pass@k |");
      expect(md).toContain("Single-attempt pass probability");
      expect(md).toContain("Success probability over k attempts");
      expect(md).toContain("| Median TTFT |");
      expect(md).toContain("550.0 ms");
      expect(md).toContain("| p95 Latency |");
      expect(md).toContain("| Std Deviation |");
      expect(md).toContain("| 95% Confidence Interval |");
    });

    it("should omit statistical analysis section when runs = 1", () => {
      const summary: EvalOrchestratorSummary = {
        model: "test-single-run",
        sanitizedModelName: "test-single-run",
        timestamp: "2026-09-11T09:00:00.000Z",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "https://localhost:7766/v1/chat/completions",
        wire: "chat",
        suitesRun: ["speed"],
        runs: 1,
        roleRecommendation: {
          role: "Explorer",
          badge: "⚡ FAST EXPLORER",
          rationale: "Single run test.",
          strengths: [],
          caveats: [],
        },
        allSuitesPassed: true,
      };

      const md = generateMarkdownReport(summary);
      expect(md).not.toContain("## 📊 Statistical Analysis");
    });
  });

  describe("Tiered Statistical Engine Utilities (M5)", () => {
    describe("computePassAtK", () => {
      it("should return 0 for invalid or empty inputs", () => {
        expect(computePassAtK(0, 0, 1)).toBe(0);
        expect(computePassAtK(-5, 2, 1)).toBe(0);
        expect(computePassAtK(10, 0, 2)).toBe(0);
        expect(computePassAtK(10, -1, 1)).toBe(0);
        expect(computePassAtK(10, 5, 0)).toBe(0);
      });

      it("should compute exact pass@1 as c / n", () => {
        expect(computePassAtK(10, 5, 1)).toBe(0.5);
        expect(computePassAtK(4, 3, 1)).toBe(0.75);
        expect(computePassAtK(2, 2, 1)).toBe(1.0);
      });

      it("should return 1.0 when n - c < k", () => {
        expect(computePassAtK(5, 5, 2)).toBe(1.0);
        expect(computePassAtK(5, 4, 2)).toBe(1.0);
        expect(computePassAtK(2, 1, 2)).toBe(1.0);
      });

      it("should compute unbiased estimator for k > 1 when n - c >= k", () => {
        // n=10, c=2, k=2:
        // 1 - (8/10 * 7/9) = 1 - 56/90 = 34/90 = 17/45 ~ 0.377777...
        const res = computePassAtK(10, 2, 2);
        expect(Math.abs(res - 17 / 45)).toBeLessThan(1e-6);
      });
    });

    describe("computePercentile", () => {
      it("should handle empty or single element array", () => {
        expect(computePercentile([], 50)).toBe(0);
        expect(computePercentile([42], 50)).toBe(42);
        expect(computePercentile([42], 95)).toBe(42);
      });

      it("should compute 50th percentile (median) with linear interpolation", () => {
        expect(computePercentile([10, 20, 30], 50)).toBe(20);
        expect(computePercentile([10, 20], 50)).toBe(15);
      });

      it("should compute 95th percentile", () => {
        // [10, 20, 30, 40], index = 0.95 * 3 = 2.85 -> 30 * 0.15 + 40 * 0.85 = 38.5
        const p95 = computePercentile([10, 20, 30, 40], 95);
        expect(p95).toBeCloseTo(38.5, 2);
      });

      it("should clamp percentile bounds between 0 and 100", () => {
        expect(computePercentile([10, 50, 90], -10)).toBe(10);
        expect(computePercentile([10, 50, 90], 150)).toBe(90);
      });
    });

    describe("computeMeanAndStdDev", () => {
      it("should handle empty or single element array", () => {
        expect(computeMeanAndStdDev([])).toEqual({ mean: 0, stdDev: 0 });
        expect(computeMeanAndStdDev([100])).toEqual({ mean: 100, stdDev: 0 });
      });

      it("should compute sample mean and sample standard deviation (N - 1)", () => {
        // [10, 20]: mean = 15, variance = ((10-15)^2 + (20-15)^2) / 1 = 50 -> stdDev = sqrt(50) ~ 7.071
        const { mean, stdDev } = computeMeanAndStdDev([10, 20]);
        expect(mean).toBe(15);
        expect(stdDev).toBeCloseTo(Math.sqrt(50), 4);
      });
    });

    describe("computeConfidenceInterval", () => {
      it("should handle empty or single element array", () => {
        expect(computeConfidenceInterval([])).toEqual({ lower: 0, upper: 0 });
        expect(computeConfidenceInterval([50])).toEqual({ lower: 50, upper: 50 });
      });

      it("should compute 95% confidence interval using sample SE and z=1.96", () => {
        // [10, 20]: mean = 15, stdDev = sqrt(50), se = sqrt(50)/sqrt(2) = 5
        // margin = 1.96 * 5 = 9.8 -> lower = 5.2, upper = 24.8
        const ci = computeConfidenceInterval([10, 20], 0.95);
        expect(ci.lower).toBeCloseTo(5.2, 1);
        expect(ci.upper).toBeCloseTo(24.8, 1);
      });
    });
  });
});
