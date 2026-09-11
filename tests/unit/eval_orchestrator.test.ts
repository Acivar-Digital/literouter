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
  });
});
