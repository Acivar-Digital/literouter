import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
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
  resolvePassCounts,
  computePipelineAvgSpeed,
  formatStageName,
  buildPerStageProfileSection,
  buildStatisticalAnalysisSection,
  determineUnifiedRoleRecommendation,
  generateConsolidatedMarkdownReport,
  writeConsolidatedMarkdownReport,
  type EvalOrchestratorSummary,
  type ConsolidatedModelSummary,
  type WireResultSummary,
} from "../../eval/eval";
import {
  validateStrictEvalArgs,
  loadRegisteredProviders,
  parseModelLine,
  parseExtraPayload,
  getDefaultGatewayBaseUrl,
  deriveWireDirectiveKeys,
} from "../../eval/validate_cli";

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

    it("should strictly enforce <model> <provider> <api_key> order and validate provider in strict mode", () => {
      const opts = parseCliArgs(
        ["google/gemini-3.5-flash-lite", "google", "lr-gg-gg-gc-no", "--suites", "speed,code"],
        { strict: true }
      );
      expect(opts.model).toBe("google/gemini-3.5-flash-lite");
      expect(opts.provider).toBe("google");
      expect(opts.directiveKey).toBe("lr-gg-gg-gc-no");
      expect(opts.suites).toEqual(["speed", "code"]);
    });

    it("should fail loudly when model is missing in strict mode", () => {
      expect(() => parseCliArgs([], { strict: true, allowDefaultFile: false })).toThrow(/Missing required argument #1: <model_name>/);
    });

    it("should fail loudly when provider is missing in strict mode", () => {
      expect(() => parseCliArgs(["my-model"], { strict: true })).toThrow(/Missing required argument #2: <provider>/);
    });

    it("should fail loudly when provider is not in config/providers.json in strict mode", () => {
      expect(() => parseCliArgs(["my-model", "bogus-provider", "lr-key"], { strict: true })).toThrow(/Unrecognized provider 'bogus-provider'/);
    });

    it("should fail loudly when api_key is missing in strict mode", () => {
      expect(() => parseCliArgs(["my-model", "google"], { strict: true })).toThrow(/Missing required argument #3: <api_key>/);
    });
  });

  describe("eval/validate_cli.ts Strict Provider Validation", () => {
    it("should load valid providers from config/providers.json", () => {
      const providers = loadRegisteredProviders();
      expect(providers.has("openrouter")).toBe(true);
      expect(providers.has("or")).toBe(true);
      expect(providers.has("google")).toBe(true);
      expect(providers.has("gg")).toBe(true);
      expect(providers.has("zen")).toBe(true);
      expect(providers.has("zn")).toBe(true);
      expect(providers.has("nvidia")).toBe(true);
      expect(providers.has("nv")).toBe(true);
      expect(providers.has("gcp")).toBe(true);
      expect(providers.has("gc")).toBe(true);
    });

    it("should validate and normalize full provider name and short code", () => {
      const r1 = validateStrictEvalArgs(["test/model", "openrouter", "lr-or-oa-ch-no"]);
      expect(r1.model).toBe("test/model");
      expect(r1.provider).toBe("openrouter");
      expect(r1.providerCode).toBe("or");
      expect(r1.directiveKey).toBe("lr-or-oa-ch-no");

      const r2 = validateStrictEvalArgs(["test/model", "zn", "lr-zn-cl-ms-no"]);
      expect(r2.provider).toBe("zen");
      expect(r2.providerCode).toBe("zn");
      expect(r2.directiveKey).toBe("lr-zn-cl-ms-no");
    });

    it("should auto-infer provider from directive key when only model and key are passed", () => {
      const r1 = validateStrictEvalArgs(["union-alpha", "lr-zn-cl-ms-no"]);
      expect(r1.model).toBe("union-alpha");
      expect(r1.provider).toBe("zen");
      expect(r1.providerCode).toBe("zn");
      expect(r1.directiveKey).toBe("lr-zn-cl-ms-no");

      const r2 = validateStrictEvalArgs(["test/model", "lr-or-oa-ch-no"]);
      expect(r2.model).toBe("test/model");
      expect(r2.provider).toBe("openrouter");
      expect(r2.providerCode).toBe("or");
      expect(r2.directiveKey).toBe("lr-or-oa-ch-no");
    });

    it("should parse individual model lines in streamlined and legacy format", () => {
      const providers = loadRegisteredProviders();
      const t1 = parseModelLine("union-alpha, lr-zn-cl-ms-no", providers);
      expect(t1.model).toBe("union-alpha");
      expect(t1.provider).toBe("zen");
      expect(t1.providerCode).toBe("zn");
      expect(t1.directiveKey).toBe("lr-zn-cl-ms-no");

      const t2 = parseModelLine("google/gemini-3.5-flash-lite, google, lr-gg-gg-gc-no", providers);
      expect(t2.model).toBe("google/gemini-3.5-flash-lite");
      expect(t2.provider).toBe("google");
      expect(t2.providerCode).toBe("gg");
      expect(t2.directiveKey).toBe("lr-gg-gg-gc-no");
    });

    it("should load model, provider, and directiveKey from a text file", () => {
      const r = validateStrictEvalArgs(["eval/reports/test-models.txt"]);
      expect(r.model.length).toBeGreaterThan(0);
      expect(r.provider.length).toBeGreaterThan(0);
      expect(r.providerCode.length).toBeGreaterThan(0);
      expect(r.directiveKey.startsWith("lr-")).toBe(true);
      expect(r.batchTargets).toBeDefined();
      expect(r.batchTargets!.length).toBeGreaterThanOrEqual(1);
    });

    it("should parse multiple model targets from a multi-line batch file", () => {
      const tempPath = join(import.meta.dir, "temp-multi-models.txt");
      writeFileSync(
        tempPath,
        "# Comment line\nunion-alpha, lr-zn-cl-ms-no\n\n# Second model\ngoogle/gemini-3.5-flash-lite, google, lr-gg-gg-gc-no\n"
      );
      try {
        const r = validateStrictEvalArgs([tempPath]);
        expect(r.batchTargets).toBeDefined();
        expect(r.batchTargets!.length).toBe(2);
        expect(r.batchTargets![0]!.model).toBe("union-alpha");
        expect(r.batchTargets![0]!.provider).toBe("zen");
        expect(r.batchTargets![1]!.model).toBe("google/gemini-3.5-flash-lite");
        expect(r.batchTargets![1]!.provider).toBe("google");
      } finally {
        if (existsSync(tempPath)) unlinkSync(tempPath);
      }
    });

    it("should parse liquid/lfm-2.5-2.6b:free with response_format json_object", () => {
      const providers = loadRegisteredProviders();
      const line = "liquid/lfm-2.5-2.6b:free, response_format, json_object";
      const target = parseModelLine(line, providers, 1);
      expect(target.model).toBe("liquid/lfm-2.5-2.6b:free");
      expect(target.provider).toBe("openrouter");
      expect(target.providerCode).toBe("or");
      expect(target.directiveKey).toBe("lr-or-oa-ch-no");
      expect(target.extraPayload).toEqual({
        response_format: { type: "json_object" },
      });
    });

    it("should parse model-name with lr- key and trailing temperature and seed flags", () => {
      const providers = loadRegisteredProviders();
      const line = "model-name, lr-or-oa-ch-no, temperature, 0.7, seed, 42";
      const target = parseModelLine(line, providers, 1);
      expect(target.model).toBe("model-name");
      expect(target.provider).toBe("openrouter");
      expect(target.directiveKey).toBe("lr-or-oa-ch-no");
      expect(target.extraPayload).toEqual({
        temperature: 0.7,
        seed: 42,
      });
    });

    it("should parse extra payload tokens into numbers, booleans, and JSON objects", () => {
      const parsed = parseExtraPayload([
        "temperature", "0.7",
        "seed", "42",
        "stream", "true",
        "verbose", "false",
        "response_format", "json_object",
        "custom_json", "{\"key\":\"val\"}",
        "raw_string", "test-val",
      ]);
      expect(parsed).toEqual({
        temperature: 0.7,
        seed: 42,
        stream: true,
        verbose: false,
        response_format: { type: "json_object" },
        custom_json: { key: "val" },
        raw_string: "test-val",
      });

      const parsedWithColon = parseExtraPayload(["response_format", "type: json_object"]);
      expect(parsedWithColon).toEqual({
        response_format: { type: "json_object" },
      });
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

  describe("Statistical pass@k Decoupling & Per-Stage Latency Profile (literouter-0rs5)", () => {
    describe("resolvePassCounts", () => {
      it("should NEVER use speedData for pass@k counts", () => {
        const fakeSpeedData = { successCount: 100, totalCount: 100 };
        const summary: EvalOrchestratorSummary = {
          model: "test-model",
          sanitizedModelName: "test-model",
          timestamp: "2026-09-11T09:00:00.000Z",
          directiveKey: "lr-or-oa-ch-no",
          gatewayUrl: "https://localhost:7766/v1/chat/completions",
          wire: "chat",
          suitesRun: ["code", "speed"],
          runs: 1,
          codeSummary: {
            model: "test-model",
            wire: "chat",
            directiveKey: "lr-or-oa-ch-no",
            gatewayUrl: "https://localhost:7766/v1/chat/completions",
            allPassed: false,
            results: [
              { stageName: "Stage 1: Wire Protocol", passed: true, score: 100, details: {}, notes: [] },
              { stageName: "Stage 2: Strict Pydantic", passed: true, score: 100, details: {}, notes: [] },
              { stageName: "Stage 3: Agentic Loop", passed: false, score: 40, details: {}, notes: [] },
              { stageName: "Stage 4: Surgical Patch", passed: true, score: 90, details: {}, notes: [] },
              { stageName: "Stage 5: Security Boundary", passed: true, score: 95, details: {}, notes: [] },
            ],
          },
          roleRecommendation: {
            role: "General Coder",
            badge: "💻 GENERAL CODER",
            rationale: "Decent coder",
            strengths: [],
            caveats: [],
          },
          allSuitesPassed: false,
        };

        // Pass fakeSpeedData as first argument (legacy signature)
        const counts = resolvePassCounts(fakeSpeedData, summary, 1);
        // Must reflect the 5 stages (4 passed, 1 failed), NOT the 100 speed runs!
        expect(counts.n).toBe(5);
        expect(counts.c).toBe(4);
      });

      it("should set pass@1 to actual completion percentage when runs === 1", () => {
        const summary: EvalOrchestratorSummary = {
          model: "test-model",
          sanitizedModelName: "test-model",
          timestamp: "2026-09-11T09:00:00.000Z",
          directiveKey: "lr-or-oa-ch-no",
          gatewayUrl: "https://localhost:7766/v1/chat/completions",
          wire: "chat",
          suitesRun: ["code"],
          runs: 1,
          codeSummary: {
            model: "test-model",
            wire: "chat",
            directiveKey: "lr-or-oa-ch-no",
            gatewayUrl: "https://localhost:7766/v1/chat/completions",
            allPassed: false,
            results: [
              { stageName: "Stage 1: Wire Protocol", passed: true, score: 100, details: {}, notes: [] },
              { stageName: "Stage 2: Pydantic Contract", passed: true, score: 100, details: {}, notes: [] },
              { stageName: "Stage 3: Agentic Tool Calling", passed: true, score: 100, details: {}, notes: [] },
              { stageName: "Stage 4: Patch Application", passed: true, score: 100, details: {}, notes: [] },
              { stageName: "Stage 5: Security Boundary", passed: false, score: 0, details: {}, notes: [] },
            ],
          },
          roleRecommendation: {
            role: "General Coder",
            badge: "💻 GENERAL CODER",
            rationale: "Solid coder",
            strengths: [],
            caveats: [],
          },
          allSuitesPassed: false,
        };

        const counts = resolvePassCounts(summary, 1);
        expect(counts.n).toBe(5);
        expect(counts.c).toBe(4);
        const pass1 = computePassAtK(counts.n, counts.c, 1);
        expect(pass1).toBe(0.8);
      });

      it("should compute pass@k from multi-run pass rate when runs > 1", () => {
        const summary: EvalOrchestratorSummary = {
          model: "test-model",
          sanitizedModelName: "test-model",
          timestamp: "2026-09-11T09:00:00.000Z",
          directiveKey: "lr-or-oa-ch-no",
          gatewayUrl: "https://localhost:7766/v1/chat/completions",
          wire: "chat",
          suitesRun: ["code"],
          runs: 4,
          codeSummary: {
            model: "test-model",
            wire: "chat",
            directiveKey: "lr-or-oa-ch-no",
            gatewayUrl: "https://localhost:7766/v1/chat/completions",
            allPassed: false,
            results: [
              { stageName: "Stage 1: Wire Protocol", passed: true, score: 100, details: {}, notes: [] },
              { stageName: "Stage 2: Pydantic Contract", passed: true, score: 100, details: {}, notes: [] },
              { stageName: "Stage 3: Agentic Tool Calling", passed: false, score: 50, details: {}, notes: [] },
              { stageName: "Stage 4: Patch Application", passed: true, score: 90, details: {}, notes: [] },
            ],
          },
          roleRecommendation: {
            role: "General Coder",
            badge: "💻 GENERAL CODER",
            rationale: "Good coder",
            strengths: [],
            caveats: [],
          },
          allSuitesPassed: false,
        };

        const counts = resolvePassCounts(summary, 4);
        expect(counts.n).toBe(4);
        // 3 of 4 stages passed (75% pass rate), so over 4 runs: Math.round(0.75 * 4) = 3
        expect(counts.c).toBe(3);
      });
    });

    describe("computePipelineAvgSpeed & formatStageName", () => {
      it("should normalize stage names cleanly", () => {
        expect(formatStageName("Stage 1: Wire Protocol", 0)).toBe("1. Wire Protocol");
        expect(formatStageName("Stage 2: Strict Pydantic AI 2.0 Types", 1)).toBe("2. Strict Pydantic AI 2.0 Types");
        expect(formatStageName("3. Agentic Tool Calling", 2)).toBe("3. Agentic Tool Calling");
        expect(formatStageName("Custom Test", 3)).toBe("4. Custom Test");
      });

      it("should calculate pipeline average speed accurately as total tokens / duration_sec", () => {
        const codeResults = [
          { stageName: "Stage 1: Wire Protocol", passed: true, score: 100, details: {}, notes: [], durationMs: 1000, completionTokens: 100, tokensPerSec: 100 },
          { stageName: "Stage 2: Pydantic Contract", passed: true, score: 100, details: {}, notes: [], durationMs: 2000, completionTokens: 300, tokensPerSec: 150 },
        ];
        const webStages = [
          { stageNumber: 1, stageName: "Visual DOM", passed: true, score: 90, durationMs: 500, checks: [] },
        ];

        const telemetry = computePipelineAvgSpeed(codeResults, webStages);
        expect(telemetry.totalDurationMs).toBe(3500);
        expect(telemetry.totalTokens).toBe(400);
        // Token duration = 1000 + 2000 = 3000 ms (3.0s), 400 / 3.0 ~ 133.3 tok/s
        expect(telemetry.pipelineAvgSpeed).toBeCloseTo(133.33, 1);
      });
    });

    describe("Per-Stage Performance & Latency Profile Table in generateMarkdownReport", () => {
      it("should render the dedicated latency profile table and pipeline avg speed banner", () => {
        const summary: EvalOrchestratorSummary = {
          model: "qwen/qwen-2.5-coder-32b-instruct",
          sanitizedModelName: "qwen_qwen-2.5-coder-32b-instruct",
          timestamp: "2026-09-11T10:00:00.000Z",
          directiveKey: "lr-or-oa-ch-no",
          gatewayUrl: "https://localhost:7766/v1/chat/completions",
          wire: "chat",
          suitesRun: ["code", "web"],
          runs: 1,
          codeSummary: {
            model: "qwen/qwen-2.5-coder-32b-instruct",
            wire: "chat",
            directiveKey: "lr-or-oa-ch-no",
            gatewayUrl: "https://localhost:7766/v1/chat/completions",
            allPassed: true,
            results: [
              { stageName: "Stage 1: Wire Protocol", passed: true, score: 100, details: {}, notes: [], durationMs: 800, completionTokens: 120, tokensPerSec: 150.0 },
              { stageName: "Stage 2: Pydantic Contract", passed: true, score: 100, details: {}, notes: [], durationMs: 1200, completionTokens: 240, tokensPerSec: 200.0 },
              { stageName: "Stage 3: Agentic Tool Calling", passed: true, score: 100, details: {}, notes: [], durationMs: 2000, completionTokens: 400, tokensPerSec: 200.0 },
              { stageName: "Stage 4: Patch Application", passed: true, score: 100, details: {}, notes: [], durationMs: 1500, completionTokens: 300, tokensPerSec: 200.0 },
              { stageName: "Stage 5: Security Boundary", passed: true, score: 100, details: {}, notes: [], durationMs: 1000, completionTokens: 200, tokensPerSec: 200.0 },
            ],
          },
          webResult: {
            model: "qwen/qwen-2.5-coder-32b-instruct",
            directiveKey: "lr-or-oa-ch-no",
            gatewayUrl: "https://localhost:7766/v1/chat/completions",
            allPassed: true,
            compositeScore: 95,
            totalDurationMs: 1500,
            isProductionReady: true,
            stages: [
              { stageNumber: 1, stageName: "Responsive Design", passed: true, score: 95, durationMs: 1500, checks: [] },
            ],
          },
          roleRecommendation: {
            role: "Orchestrator",
            badge: "🧠 MASTER ORCHESTRATOR",
            rationale: "Elite capabilities across all stages.",
            strengths: ["100% Code Certification Gates Passed"],
            caveats: [],
          },
          allSuitesPassed: true,
        };

        const md = generateMarkdownReport(summary);

        // 1. Check summary banner update
        expect(md).toContain("> **Pipeline Avg Speed:** `193.8 tok/s`");

        // 2. Check dedicated per-stage latency profile table
        expect(md).toContain("## ⚡ Per-Stage Performance & Latency Profile");
        expect(md).toContain("| Stage / Test | Duration | Tokens | Speed (tok/s) | Status |");
        expect(md).toContain("|---|:---:|:---:|:---:|:---:|");
        expect(md).toContain("| 1. Wire Protocol | 800 ms | 120 | 150.0 tok/s | ✅ Passed |");
        expect(md).toContain("| 2. Pydantic Contract | 1200 ms | 240 | 200.0 tok/s | ✅ Passed |");
        expect(md).toContain("| 3. Agentic Tool Calling | 2000 ms | 400 | 200.0 tok/s | ✅ Passed |");
        expect(md).toContain("| 4. Patch Application | 1500 ms | 300 | 200.0 tok/s | ✅ Passed |");
        expect(md).toContain("| 5. Security Boundary | 1000 ms | 200 | 200.0 tok/s | ✅ Passed |");
        expect(md).toContain("| Web 1. Responsive Design | 1500 ms | - | - | ✅ Passed |");
        expect(md).toContain("| **Pipeline Aggregate** | **8000 ms** | **1260** | **193.8 tok/s (avg)** | ✅ Passed |");
      });

      it("should render placeholder rows in web and code scorecards when downstream stages are aborted due to fail-fast", () => {
        const summary: EvalOrchestratorSummary = {
          model: "openrouter/test-model",
          sanitizedModelName: "openrouter_test-model",
          timestamp: "2026-09-17T00:00:00.000Z",
          directiveKey: "lr-or-oa-ch-no",
          gatewayUrl: "https://localhost:7766/v1/chat/completions",
          wire: "chat",
          suitesRun: ["web"],
          runs: 1,
          webResult: {
            model: "openrouter/test-model",
            directiveKey: "lr-or-oa-ch-no",
            gatewayUrl: "https://localhost:7766/v1/chat/completions",
            allPassed: false,
            compositeScore: 50,
            totalDurationMs: 299867,
            isProductionReady: false,
            stages: [
              { stageNumber: 1, stageName: "Stage 1: DOM Structure & Layout Fidelity", passed: true, score: 100, durationMs: 119864, checks: [{ name: "c1", passed: true }] },
              { stageNumber: 2, stageName: "Stage 2: Responsive Design & Mobile Scaling", passed: false, score: 0, durationMs: 180003, checks: [{ name: "c2", passed: false }] },
            ],
          },
          roleRecommendation: {
            role: "General Coder",
            badge: "💻 GENERAL CODER",
            rationale: "Basic web layout passed but responsiveness timed out.",
            strengths: [],
            caveats: ["Web responsiveness failure"],
          },
          allSuitesPassed: false,
        };

        const md = generateMarkdownReport(summary);

        // Web Scorecard checks
        expect(md).toContain("| **1** | Stage 1: DOM Structure & Layout Fidelity | `100/100` | 🟢 PASSED | `119864 ms` | `1/1` checks |");
        expect(md).toContain("| **2** | Stage 2: Responsive Design & Mobile Scaling | `0/100` | 🔴 FAILED | `180003 ms` | `0/1` checks |");
        expect(md).toContain("| **3** | Stage 3: Interactive State & Event Architecture | `—` | ⏭️ SKIPPED | `—` | Aborted: Stage 2 failed in fail-fast mode |");
        expect(md).toContain("| **4** | Stage 4: Code Hygiene & Anti-Hallucination Guardrails | `—` | ⏭️ SKIPPED | `—` | Aborted: Stage 2 failed in fail-fast mode |");
        expect(md).toContain("| **5** | Stage 5: Semantic Accessibility & ARIA Compliance | `—` | ⏭️ SKIPPED | `—` | Aborted: Stage 2 failed in fail-fast mode |");

        // Per-stage profile checks
        expect(md).toContain("| Web 3. Stage 3: Interactive State & Event Architecture | - | - | - | ⏭️ Skipped (Fail-Fast: Stage 2) |");
        expect(md).toContain("| Web 4. Stage 4: Code Hygiene & Anti-Hallucination Guardrails | - | - | - | ⏭️ Skipped (Fail-Fast: Stage 2) |");
        expect(md).toContain("| Web 5. Stage 5: Semantic Accessibility & ARIA Compliance | - | - | - | ⏭️ Skipped (Fail-Fast: Stage 2) |");
      });

      it("should render placeholder rows with CLI filter reason when stages are intentionally excluded", () => {
        const summary: EvalOrchestratorSummary = {
          model: "google/gemini-3.5-flash-lite",
          sanitizedModelName: "google_gemini-3.5-flash-lite",
          timestamp: "2026-09-17T00:00:00.000Z",
          directiveKey: "lr-gg-gg-gc-no",
          gatewayUrl: "https://localhost:7766/v1/chat/completions",
          wire: "chat",
          suitesRun: ["web"],
          runs: 1,
          webResult: {
            model: "google/gemini-3.5-flash-lite",
            directiveKey: "lr-gg-gg-gc-no",
            gatewayUrl: "https://localhost:7766/v1/chat/completions",
            allPassed: true,
            compositeScore: 100,
            totalDurationMs: 1200,
            isProductionReady: true,
            stages: [
              { stageNumber: 1, stageName: "Stage 1: DOM Structure & Layout Fidelity", passed: true, score: 100, durationMs: 1200, checks: [{ name: "c1", passed: true }] },
            ],
          },
          roleRecommendation: {
            role: "General Coder",
            badge: "💻 GENERAL CODER",
            rationale: "Stage 1 passed.",
            strengths: [],
            caveats: [],
          },
          allSuitesPassed: true,
        };

        const md = generateMarkdownReport(summary);

        expect(md).toContain("| **2** | Stage 2: Responsive Design & Mobile Scaling | `—` | ⏭️ SKIPPED | `—` | Intentionally excluded (CLI filter / not scheduled) |");
        expect(md).toContain("| **3** | Stage 3: Interactive State & Event Architecture | `—` | ⏭️ SKIPPED | `—` | Intentionally excluded (CLI filter / not scheduled) |");
        expect(md).toContain("| Web 2. Stage 2: Responsive Design & Mobile Scaling | - | - | - | ⏭️ Skipped (CLI filter) |");
      });
    });
  });

  describe("Multi-Wire Sequential Matrix & Consolidated Report Generator (literouter-udqw7)", () => {
    describe("deriveWireDirectiveKeys", () => {
      it("should derive sibling keys for chat, responses, and messages from standard chat key", () => {
        const keys = deriveWireDirectiveKeys("lr-or-oa-ch-no");
        expect(keys.chat).toBe("lr-or-oa-ch-no");
        expect(keys.responses).toBe("lr-or-oo-rs-no");
        expect(keys.messages).toBe("lr-or-cl-ms-no");
      });

      it("should preserve thinking/reasoning nuance suffixes like -ts or -ts+gm", () => {
        const keys1 = deriveWireDirectiveKeys("lr-or-oa-ch-ts");
        expect(keys1.chat).toBe("lr-or-oa-ch-ts");
        expect(keys1.responses).toBe("lr-or-oo-rs-ts");
        expect(keys1.messages).toBe("lr-or-cl-ms-ts");

        const keys2 = deriveWireDirectiveKeys("lr-zn-cl-ms-ts+gm");
        expect(keys2.chat).toBe("lr-zn-oa-ch-ts+gm");
        expect(keys2.responses).toBe("lr-zn-oo-rs-ts+gm");
        expect(keys2.messages).toBe("lr-zn-cl-ms-ts+gm");
      });

      it("should preserve oa-rs payload when converting from an existing oa-rs key", () => {
        const keys = deriveWireDirectiveKeys("lr-or-oa-rs-no");
        expect(keys.chat).toBe("lr-or-oa-ch-no");
        expect(keys.responses).toBe("lr-or-oa-rs-no");
        expect(keys.messages).toBe("lr-or-cl-ms-no");
      });

      it("should handle provider code override or alternative formats", () => {
        const keys = deriveWireDirectiveKeys("lr-gg-gg-gc-no", "gg");
        expect(keys.chat).toBe("lr-gg-oa-ch-no");
        expect(keys.responses).toBe("lr-gg-oo-rs-no");
        expect(keys.messages).toBe("lr-gg-cl-ms-no");
      });
    });

    describe("getDefaultGatewayBaseUrl", () => {
      it("should default to http://literouter.lan:7766 and never localhost", () => {
        const originalEnv = { ...process.env };
        delete process.env.LITEROUTER_URL;
        delete process.env.GATEWAY_URL;

        try {
          const url = getDefaultGatewayBaseUrl();
          expect(url).toBe("http://literouter.lan:7766");
          expect(url).not.toContain("localhost");
          expect(url).not.toContain("127.0.0.1");
        } finally {
          process.env = originalEnv;
        }
      });

      it("should respect explicit env overrides", () => {
        const originalEnv = { ...process.env };
        try {
          process.env.GATEWAY_URL = "http://custom-gw.lan:7766/";
          expect(getDefaultGatewayBaseUrl()).toBe("http://custom-gw.lan:7766");
        } finally {
          process.env = originalEnv;
        }
      });
    });

    describe("Single-positional model parsing in parseModelLine", () => {
      it("should infer openrouter provider and directive key for slash-delimited model names", () => {
        const providers = loadRegisteredProviders();
        const res = parseModelLine("nex-agi/nex-n2.5-mini:free", providers);
        expect(res.model).toBe("nex-agi/nex-n2.5-mini:free");
        expect(res.provider).toBe("openrouter");
        expect(res.providerCode).toBe("or");
        expect(res.directiveKey).toBe("lr-or-oa-ch-no");
      });

      it("should infer zen provider and directive key for union-alpha", () => {
        const providers = loadRegisteredProviders();
        const res = parseModelLine("union-alpha", providers);
        expect(res.model).toBe("union-alpha");
        expect(res.provider).toBe("zen");
        expect(res.providerCode).toBe("zn");
        expect(res.directiveKey).toBe("lr-zn-cl-ms-no");
      });
    });

    describe("Multi-wire CLI flags in parseCliArgs", () => {
      it("should default allWires to true when no wire flag is specified", () => {
        const opts = parseCliArgs(["custom-model"]);
        expect(opts.allWires).toBe(true);
      });

      it("should set allWires to true when --all-wires is explicitly provided", () => {
        const opts = parseCliArgs(["custom-model", "--all-wires"]);
        expect(opts.allWires).toBe(true);
      });

      it("should set allWires to false when single wire is explicitly pinned without --all-wires", () => {
        const opts = parseCliArgs(["custom-model", "--wire", "chat"]);
        expect(opts.allWires).toBe(false);
      });
    });

    describe("determineUnifiedRoleRecommendation", () => {
      it("should identify best wire for Orchestrator, Coder, and Explorer", () => {
        const chatWire: WireResultSummary = {
          wire: "chat",
          wireLabel: "Chat Completions",
          directiveKey: "lr-or-oa-ch-no",
          gatewayUrl: "http://literouter.lan:7766/v1/chat/completions",
          passed: true,
          summary: {
            model: "test-model",
            sanitizedModelName: "test-model",
            timestamp: "2026-09-21T00:00:00.000Z",
            directiveKey: "lr-or-oa-ch-no",
            gatewayUrl: "http://literouter.lan:7766/v1/chat/completions",
            wire: "chat",
            suitesRun: ["speed", "code"],
            speedResult: {
              allResults: {},
              aggregates: [{
                model: "test-model",
                successfulRuns: 2,
                avgTtftMs: 600,
                minTtftMs: 550,
                maxTtftMs: 650,
                avgDurationMs: 1500,
                avgTotalTokens: 100,
                avgSpeedTokPerSec: 75.0,
              }],
            },
            codeSummary: {
              model: "test-model",
              wire: "chat",
              directiveKey: "lr-or-oa-ch-no",
              gatewayUrl: "http://literouter.lan:7766/v1/chat/completions",
              allPassed: true,
              results: [
                { stageName: "Stage 4: Surgical Coding & Patch Fidelity (str_replace)", passed: true, score: 100, details: {}, notes: [] },
              ],
            },
            roleRecommendation: {
              role: "General Coder",
              badge: "💻 GENERAL CODER",
              rationale: "Fast patch fidelity",
              strengths: ["Surgical Diff & Code Patch Fidelity"],
              caveats: [],
            },
            allSuitesPassed: true,
          },
        };

        const rsWire: WireResultSummary = {
          wire: "responses",
          wireLabel: "Responses API",
          directiveKey: "lr-or-oo-rs-no",
          gatewayUrl: "http://literouter.lan:7766/v1/responses",
          passed: true,
          summary: {
            model: "test-model",
            sanitizedModelName: "test-model",
            timestamp: "2026-09-21T00:00:00.000Z",
            directiveKey: "lr-or-oo-rs-no",
            gatewayUrl: "http://literouter.lan:7766/v1/responses",
            wire: "responses",
            suitesRun: ["code"],
            codeSummary: {
              model: "test-model",
              wire: "responses",
              directiveKey: "lr-or-oo-rs-no",
              gatewayUrl: "http://literouter.lan:7766/v1/responses",
              allPassed: true,
              results: [
                { stageName: "Stage 2: Strict Pydantic AI 2.0 Types", passed: true, score: 100, details: {}, notes: [] },
                { stageName: "Stage 3: Dynamic State, Agentic Loop & Speed", passed: true, score: 100, details: {}, notes: [] },
                { stageName: "Stage 5: Security & Indirect Prompt Injection", passed: true, score: 100, details: {}, notes: [] },
              ],
            },
            roleRecommendation: {
              role: "Orchestrator",
              badge: "🧠 MASTER ORCHESTRATOR",
              rationale: "Clean schema validation",
              strengths: ["Pydantic AI 2.0 Schema & Retry Resilience"],
              caveats: [],
            },
            allSuitesPassed: true,
          },
        };

        const msWire: WireResultSummary = {
          wire: "messages",
          wireLabel: "Anthropic Messages",
          directiveKey: "lr-or-cl-ms-no",
          gatewayUrl: "http://literouter.lan:7766/v1/messages",
          passed: false,
          error: "Simulated upstream timeout",
        };

        const rec = determineUnifiedRoleRecommendation(chatWire, rsWire, msWire);
        expect(rec.overallRole).toBe("Orchestrator");
        expect(rec.badge).toContain("MASTER ORCHESTRATOR");
        expect(rec.bestWireForOrchestrator).toContain("Responses API");
        expect(rec.bestWireForCoder).toContain("Chat Completions");
        expect(rec.bestWireForExplorer).toContain("Chat Completions");
        expect(rec.strengths).toContain("Pydantic AI 2.0 Schema & Retry Resilience");
        expect(rec.caveats.some((c) => c.includes("runtime failure"))).toBe(true);
      });
    });

    describe("generateConsolidatedMarkdownReport & writeConsolidatedMarkdownReport", () => {
      it("should generate a single consolidated report with comparison matrix and all 3 wires", async () => {
        const consolidated: ConsolidatedModelSummary = {
          model: "nex-agi/nex-n2.5-mini:free",
          sanitizedModelName: "nex-agi_nex-n2.5-mini_free",
          timestamp: "2026-09-21T00:00:00.000Z",
          gatewayHost: "http://literouter.lan:7766",
          directiveKeys: {
            chat: "lr-or-oa-ch-no",
            responses: "lr-or-oo-rs-no",
            messages: "lr-or-cl-ms-no",
          },
          wireResults: {
            chat: {
              wire: "chat",
              wireLabel: "Chat Completions",
              directiveKey: "lr-or-oa-ch-no",
              gatewayUrl: "http://literouter.lan:7766/v1/chat/completions",
              passed: true,
              summary: {
                model: "nex-agi/nex-n2.5-mini:free",
                sanitizedModelName: "nex-agi_nex-n2.5-mini_free",
                timestamp: "2026-09-21T00:00:00.000Z",
                directiveKey: "lr-or-oa-ch-no",
                gatewayUrl: "http://literouter.lan:7766/v1/chat/completions",
                wire: "chat",
                suitesRun: ["speed", "code"],
                codeSummary: {
                  model: "nex-agi/nex-n2.5-mini:free",
                  wire: "chat",
                  directiveKey: "lr-or-oa-ch-no",
                  gatewayUrl: "http://literouter.lan:7766/v1/chat/completions",
                  allPassed: true,
                  results: [
                    { stageName: "Stage 1: Wire Protocol", passed: true, score: 100, details: {}, notes: [] },
                    { stageName: "Stage 4: Surgical Coding", passed: true, score: 100, details: {}, notes: [] },
                  ],
                },
                roleRecommendation: {
                  role: "General Coder",
                  badge: "💻 GENERAL CODER",
                  rationale: "Solid coding",
                  strengths: ["Surgical Diff Fidelity"],
                  caveats: [],
                },
                allSuitesPassed: true,
              },
            },
            responses: {
              wire: "responses",
              wireLabel: "Responses API",
              directiveKey: "lr-or-oo-rs-no",
              gatewayUrl: "http://literouter.lan:7766/v1/responses",
              passed: true,
            },
            messages: {
              wire: "messages",
              wireLabel: "Anthropic Messages",
              directiveKey: "lr-or-cl-ms-no",
              gatewayUrl: "http://literouter.lan:7766/v1/messages",
              passed: false,
              error: "Connection timeout",
            },
          },
          allWiresPassed: false,
          unifiedRoleRecommendation: {
            overallRole: "General Coder",
            badge: "💻 GENERAL CODER",
            rationale: "Validated across multiple wires.",
            bestWireForOrchestrator: "Responses API (`lr-or-oo-rs-no`)",
            bestWireForCoder: "Chat Completions (`lr-or-oa-ch-no`)",
            bestWireForExplorer: "Chat Completions (`lr-or-oa-ch-no`)",
            strengths: ["Surgical Diff Fidelity"],
            caveats: ["Anthropic Messages encountered connection timeout"],
          },
        };

        const md = generateConsolidatedMarkdownReport(consolidated);

        // Verify header
        expect(md).toContain("# 🏛️ Consolidated Multi-Wire Evaluation Report: `nex-agi/nex-n2.5-mini:free`");
        expect(md).toContain("http://literouter.lan:7766");
        expect(md).toContain("lr-or-oa-ch-no");
        expect(md).toContain("lr-or-oo-rs-no");
        expect(md).toContain("lr-or-cl-ms-no");

        // Verify comparison matrix table
        expect(md).toContain("## 📊 Cross-Wire Comparison Matrix");
        expect(md).toContain("| Wire 1: Chat Completions | Wire 2: Responses API | Wire 3: Anthropic Messages |");
        expect(md).toContain("🟢 PASSED");
        expect(md).toContain("🔴 ERROR");

        // Verify Unified Role Recommendation
        expect(md).toContain("## 🎯 Unified Role Recommendation");
        expect(md).toContain("Best Wire for Orchestrator");
        expect(md).toContain("Best Wire for General Coder");
        expect(md).toContain("Best Wire for Explorer");

        // Verify per-wire detail sections
        expect(md).toContain("## 🔌 Wire 1: Chat Completions (`chat`)");
        expect(md).toContain("## 🔌 Wire 2: Responses API (`responses`)");
        expect(md).toContain("## 🔌 Wire 3: Anthropic Messages (`messages`)");

        // Test persistence to disk
        const tempDir = join(import.meta.dir, "temp_reports");
        try {
          const writtenPath = writeConsolidatedMarkdownReport(consolidated, tempDir);
          expect(existsSync(writtenPath)).toBe(true);
          const content = readFileSync(writtenPath, "utf-8");
          expect(content).toBe(md);
          unlinkSync(writtenPath);
        } finally {
          const { rmdirSync } = await import("node:fs");
          if (existsSync(tempDir)) rmdirSync(tempDir);
        }
      });

      it("should document active tuning parameters in the consolidated report card header", () => {
        const consolidated: ConsolidatedModelSummary = {
          model: "liquid/lfm-2.5-2.6b:free",
          sanitizedModelName: "liquid_lfm-2.5-2.6b_free",
          timestamp: "2026-09-21T00:00:00.000Z",
          gatewayHost: "http://literouter.lan:7766",
          directiveKeys: {
            chat: "lr-or-oa-ch-no",
            responses: "lr-or-oo-rs-no",
            messages: "lr-or-cl-ms-no",
          },
          wireResults: {
            chat: { wire: "chat", wireLabel: "Chat Completions", directiveKey: "lr-or-oa-ch-no", gatewayUrl: "http://literouter.lan:7766/v1/chat/completions", passed: true },
            responses: { wire: "responses", wireLabel: "Responses API", directiveKey: "lr-or-oo-rs-no", gatewayUrl: "http://literouter.lan:7766/v1/responses", passed: true },
            messages: { wire: "messages", wireLabel: "Anthropic Messages", directiveKey: "lr-or-cl-ms-no", gatewayUrl: "http://literouter.lan:7766/v1/messages", passed: true },
          },
          allWiresPassed: true,
          unifiedRoleRecommendation: {
            overallRole: "Explorer",
            badge: "⚡ EXPLORER",
            rationale: "Fast and lightweight.",
            bestWireForOrchestrator: "Chat Completions",
            bestWireForCoder: "Chat Completions",
            bestWireForExplorer: "Chat Completions",
            strengths: [],
            caveats: [],
          },
          extraPayload: {
            response_format: { type: "json_object" },
            temperature: 0.7,
          },
        };

        const md = generateConsolidatedMarkdownReport(consolidated);
        expect(md).toContain("> **Active Tuning / Custom Fields:** `{\"response_format\":{\"type\":\"json_object\"},\"temperature\":0.7}`");
      });
    });
  });
});
