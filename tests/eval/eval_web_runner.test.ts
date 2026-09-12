/**
 * tests/eval/eval_web_runner.test.ts
 *
 * Unit tests for eval/web.ts: CLI arguments, cooldown pacing parity, and speed telemetry.
 */

import { describe, expect, it } from "bun:test";
import {
  parseArgs,
  normalizeWebOptions,
  type WebEvalOptions,
  type WebEvalResult,
  type WebPipelineResult,
  type WebStageResult,
} from "../../eval/web";

describe("Web Evaluation Runner (eval/web.ts)", () => {
  describe("parseArgs --cooldown CLI argument", () => {
    it("defaults cooldownMs to 2000 when omitted", () => {
      const opts = parseArgs([]);
      expect(opts.cooldownMs).toBe(2000);
    });

    it("parses valid --cooldown <ms> correctly", () => {
      const opts = parseArgs(["--cooldown", "3500"]);
      expect(opts.cooldownMs).toBe(3500);
    });

    it("parses --cooldown along with other options and model positional argument", () => {
      const opts = parseArgs([
        "custom/vision-model:free",
        "--cooldown",
        "1000",
        "--stage",
        "2",
        "--continue",
      ]);
      expect(opts.model).toBe("custom/vision-model:free");
      expect(opts.cooldownMs).toBe(1000);
      expect(opts.stage).toBe(2);
      expect(opts.continueOnFailure).toBe(true);
    });

    it("ignores invalid non-numeric cooldown values", () => {
      const opts = parseArgs(["--cooldown", "invalid"]);
      expect(opts.cooldownMs).toBe(2000);
    });
  });

  describe("normalizeWebOptions cooldownMs parity", () => {
    it("uses default cooldownMs: 2000 if not provided", () => {
      const norm = normalizeWebOptions({});
      expect(norm.cooldownMs).toBe(2000);
    });

    it("preserves explicit cooldownMs", () => {
      const norm = normalizeWebOptions({ cooldownMs: 500 });
      expect(norm.cooldownMs).toBe(500);
    });

    it("preserves cooldownMs: 0 when cooldown is disabled", () => {
      const norm = normalizeWebOptions({ cooldownMs: 0 });
      expect(norm.cooldownMs).toBe(0);
    });
  });

  describe("Speed & Latency Telemetry Types", () => {
    it("verifies WebPipelineResult and WebStageResult type aliases and durationMs field", () => {
      const mockStage: WebStageResult = {
        stageNumber: 1,
        stageName: "Structure & Visual-to-DOM Fidelity",
        passed: true,
        score: 100,
        durationMs: 450,
        checks: [{ name: "Grid layout", passed: true }],
      };

      const mockPipeline: WebPipelineResult = {
        model: "test-model",
        directiveKey: "lr-or-oa-ch-no",
        gatewayUrl: "https://localhost:7766/v1/chat/completions",
        allPassed: true,
        compositeScore: 100,
        totalDurationMs: 450,
        durationMs: 450,
        isProductionReady: true,
        stages: [mockStage],
      };

      expect(mockStage.durationMs).toBe(450);
      expect(mockPipeline.durationMs).toBe(450);
      expect(mockPipeline.totalDurationMs).toBe(450);
    });
  });
});
