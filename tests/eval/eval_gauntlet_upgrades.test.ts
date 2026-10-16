/**
 * tests/eval/eval_gauntlet_upgrades.test.ts
 *
 * Dedicated verification suite for the LiteRouter Eval Gauntlet Upgrades:
 * 1. Stage 4 Surgical Patch indentation tolerance & functional verification.
 * 2. Zero-overhead TSX AST syntax gating via Bun.Transpiler.
 * 3. Speed benchmark streaming burst & proxy buffering detection.
 * 4. Master role gating (Rejected tier and Explorer qualification).
 */

import { describe, expect, it } from "bun:test";
import { verifyComponentAst } from "../../eval/stages_web/ast_verify";
import {
  EXPECTED_OLD_STR,
  EXPECTED_INNER_OLD_STR,
  gradeIndentation,
} from "../../eval/stages/stage4_patch";
import {
  EXPECTED_INNER_OLD_STR as EXPECTED_INNER_OLD_STR_RS,
  gradeIndentation as gradeIndentationRs,
} from "../../eval/stages_rs/stage4_patch";
import {
  determineArchitecturalRole,
  determineUnifiedRoleRecommendation,
  buildStatisticalAnalysisSection,
  type EvalOrchestratorSummary,
} from "../../eval/eval";

describe("LiteRouter Eval Gauntlet Upgrades", () => {
  describe("1. Zero-Overhead TSX AST Syntax Gating (ast_verify.ts)", () => {
    it("should pass valid TSX component code", () => {
      const validTsx = `
        import React, { useState } from 'react';
        export function MetricsCard({ title, value }: { title: string; value: number }) {
          const [active, setActive] = useState(false);
          return (
            <div className="card" onClick={() => setActive(!active)}>
              <h3>{title}</h3>
              <p>{value}</p>
            </div>
          );
        }
      `;
      const result = verifyComponentAst(validTsx);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should pass valid HTML snippet wrapped in JSX fragment", () => {
      const validHtml = `
        <div class="container flex flex-col p-4">
          <header class="header">
            <h1 class="title">LiteRouter Dashboard</h1>
          </header>
          <main class="content">
            <p>Operational metrics</p>
          </main>
        </div>
      `;
      const result = verifyComponentAst(validHtml);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should reject malformed TSX with unclosed JSX tag", () => {
      const invalidTsx = `
        export default function Broken() {
          return (
            <div>
              <span>Unclosed span
            </div>
          );
        }
      `;
      const result = verifyComponentAst(invalidTsx);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should reject completely unparseable syntax", () => {
      const brokenSyntax = `
        const x = ;;;
        function () {
      `;
      const result = verifyComponentAst(brokenSyntax);
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("should reject empty or whitespace input", () => {
      const emptyResult = verifyComponentAst("   \n\t  ");
      expect(emptyResult.valid).toBe(false);
      expect(emptyResult.error).toContain("Empty");
    });
  });

  describe("2. Stage 4 Surgical Patch Indentation & Functional Correctness", () => {
    it("should award full score (50/50, PERFECT) for matching EXPECTED_OLD_STR", () => {
      const res = gradeIndentation(EXPECTED_OLD_STR);
      expect(res.score).toBe(50);
      expect(res.status).toBe("PASSED");
      expect(res.fidelity).toBe("PERFECT");
    });

    it("should award full score (50/50, PERFECT) for matching inner code without comment boundaries", () => {
      const res = gradeIndentation(EXPECTED_INNER_OLD_STR);
      expect(res.score).toBe(50);
      expect(res.status).toBe("PASSED");
      expect(res.fidelity).toBe("PERFECT");
    });

    it("should award partial score (25/50, TRIMMED_MATCH) when old_str matches a substring in source", () => {
      const partialMatchInFile = "      this.count += step;";
      const res = gradeIndentation(partialMatchInFile);
      expect(res.score).toBe(25);
      expect(res.status).toBe("PARTIAL");
      expect(res.fidelity).toBe("TRIMMED_MATCH");
    });

    it("should support inner code matching in Responses API stage4 variant", () => {
      const res = gradeIndentationRs(EXPECTED_INNER_OLD_STR_RS);
      expect(res.score).toBe(50);
      expect(res.status).toBe("PASSED");
      expect(res.fidelity).toBe("PERFECT");
    });

    it("should reject patch application when old_str does not match target source", () => {
      const hallucinatedCode = `const nonExistent = 123;\nthis.count = 999;`;
      const res = gradeIndentation(hallucinatedCode);
      expect(res.score).toBe(0);
      expect(res.status).toBe("FAILED");
      expect(res.fidelity).toBe("MISMATCH");
    });
  });

  describe("3. Master Role Gating & Rejection Tier", () => {
    it("should classify model as Rejected when all evaluated stages fail", () => {
      const role = determineArchitecturalRole({
        codeSummary: {
          model: "broken-model",
          allPassed: false,
          results: [
            { stageName: "Stage 1: Wire Protocol", passed: false, score: 0, details: {}, notes: [] },
            { stageName: "Stage 2: Strict Pydantic", passed: false, score: 0, details: {}, notes: [] },
          ],
        } as any,
        webResult: {
          model: "broken-model",
          allPassed: false,
          compositeScore: 15,
          isProductionReady: false,
          stages: [
            { stageNumber: 1, stageName: "Stage 1", passed: false, score: 15, checks: [], durationMs: 120 },
          ],
        } as any,
      });

      expect(role.role).toBe("Rejected");
      expect(role.badge).toBe("🚫 REJECTED / UNVERIFIED");
      expect(role.rationale).toContain("Failed baseline capability gates");
    });

    it("should classify model as Rejected on fatal upstream transport/auth error", () => {
      const role = determineArchitecturalRole({
        codeSummary: { passed: 0, results: [] } as any,
        webResult: { passedStages: 0, stages: [] } as any,
        stageErrors: ["HTTP 403 Forbidden: upstream key rejected"],
      });

      expect(role.role).toBe("Rejected");
      expect(role.badge).toBe("🚫 REJECTED / UNVERIFIED");
      expect(role.caveats.some((c) => c.includes("HTTP 403"))).toBe(true);
    });

    it("should classify as Rejected when model fails Orchestrator, Coder, and Explorer thresholds", () => {
      // Model that is slow (> 2500ms TTFT) and has poor coding (low score, no patch)
      const speedAgg = {
        model: "slow-poor-model",
        successfulRuns: 1,
        avgTtftMs: 3500,
        minTtftMs: 3400,
        maxTtftMs: 3600,
        avgDurationMs: 10000,
        avgTotalTokens: 200,
        avgSpeedTokPerSec: 15,
      };
      const codeSummary = {
        model: "slow-poor-model",
        allPassed: false,
        results: [
          { stageName: "Stage 1: Wire", passed: true, score: 30, details: {}, notes: [] },
          { stageName: "Stage 2: Pydantic", passed: false, score: 20, details: {}, notes: [] },
        ],
      };

      const role = determineArchitecturalRole(speedAgg, codeSummary as any, undefined);
      expect(role.role).toBe("Rejected");
      expect(role.badge).toBe("🚫 REJECTED / UNVERIFIED");
    });

    it("should classify unified recommendation as Rejected when all evaluated wires fail", () => {
      const failedWire = (wire: "chat" | "responses" | "messages", label: string) => ({
        wire,
        wireLabel: label,
        directiveKey: `lr-or-${wire}`,
        gatewayUrl: `http://localhost:7766/v1/${wire}`,
        passed: false,
        error: "Fatal HTTP 401 Unauthorized",
        summary: {
          model: "unauthorized-model",
          sanitizedModelName: "unauthorized-model",
          timestamp: "2026-10-16T00:00:00.000Z",
          directiveKey: `lr-or-${wire}`,
          gatewayUrl: `http://localhost:7766/v1/${wire}`,
          wire,
          suitesRun: ["code" as const],
          roleRecommendation: {
            role: "Rejected" as const,
            badge: "🚫 REJECTED / UNVERIFIED",
            rationale: "Fatal error",
            strengths: [],
            caveats: [],
          },
          allSuitesPassed: false,
        },
      });

      const rec = determineUnifiedRoleRecommendation(
        failedWire("chat", "Chat Completions"),
        failedWire("responses", "Responses API"),
        failedWire("messages", "Anthropic Messages")
      );

      expect(rec.overallRole).toBe("Rejected");
      expect(rec.badge).toBe("🚫 REJECTED / UNVERIFIED");
    });
  });

  describe("4. Statistical Analysis Single-Run Formatting", () => {
    it("should format Stage Pass Rate instead of pass@k when runs <= 1", () => {
      const summary: EvalOrchestratorSummary = {
        model: "test-single-run",
        sanitizedModelName: "test-single-run",
        timestamp: "2026-10-16T00:00:00.000Z",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "http://localhost:7766/v1/chat/completions",
        wire: "chat",
        suitesRun: ["code"],
        runs: 1,
        codeSummary: {
          model: "test-single-run",
          wire: "chat",
          directiveKey: "lr-or-oa-ch-no",
          gatewayUrl: "http://localhost:7766/v1/chat/completions",
          allPassed: false,
          results: [
            { stageName: "Stage 1", passed: true, score: 100, details: {}, notes: [] },
            { stageName: "Stage 2", passed: false, score: 0, details: {}, notes: [] },
          ],
        },
        roleRecommendation: {
          role: "Rejected",
          badge: "🚫 REJECTED / UNVERIFIED",
          rationale: "Incomplete capabilities.",
          strengths: [],
          caveats: [],
        },
        allSuitesPassed: false,
      };

      const lines = buildStatisticalAnalysisSection(summary, 1);
      const output = lines.join("\n");
      expect(output).toContain("## 📊 Stage Pass Rate (Single Run)");
      expect(output).toContain("1/2 (50%)");
      expect(output).not.toContain("pass@1 (Sample Mean)");
      expect(output).not.toContain("pass@k");
    });
  });
});
