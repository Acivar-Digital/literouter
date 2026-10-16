import { describe, expect, it } from "bun:test";
import { runStage1Wire } from "../../eval/stages_rs/stage1_wire";
import { formatWireVerdict, generateMarkdownReport, generateConsolidatedMarkdownReport, type EvalOrchestratorSummary, type ConsolidatedModelSummary, type WireResultSummary } from "../../eval/eval";
import { runCodeEvaluation } from "../../eval/code";
import type { StageContext } from "../../eval/stages/types";

describe("Eval Wire Protocol & N/A Semantics (S3 - S6)", () => {
  describe("1. S3: Stage 1 Responses Wire (stages_rs/stage1_wire.ts)", () => {
    it("should mark HTTP 400 ModelProtocolUnsupported as unsupportedWire N/A without 0-point failure verdict", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            error: {
              message: "ModelProtocolUnsupported: Wire /v1/responses is not supported for model test-model",
              type: "invalid_request_error",
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }) as unknown as typeof fetch;

      try {
        const ctx: StageContext = {
          model: "test-model",
          directiveKey: "lr-zn-oo-rs-no",
          gatewayUrl: "http://127.0.0.1:7766/v1/responses",
          runs: 1,
        };

        const result = await runStage1Wire(ctx);
        expect(result.unsupportedWire).toBe(true);
        expect(result.passed).toBe(false);
        expect(result.score).toBe(0);
        expect(result.error).toContain("ModelProtocolUnsupported");
        expect(result.details["unsupportedWire"]).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should detect 'protocol unsupported' or 'unsupported wire' in HTTP 400 response text", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return new Response("Unsupported wire protocol: /v1/responses not available on provider", {
          status: 400,
          headers: { "Content-Type": "text/plain" },
        });
      }) as unknown as typeof fetch;

      try {
        const ctx: StageContext = {
          model: "test-model",
          directiveKey: "lr-zn-oo-rs-no",
          gatewayUrl: "http://127.0.0.1:7766/v1/responses",
          runs: 1,
        };

        const result = await runStage1Wire(ctx);
        expect(result.unsupportedWire).toBe(true);
        expect(result.passed).toBe(false);
        expect(result.score).toBe(0);
        expect(result.error).toContain("ModelProtocolUnsupported");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("2. S4: Code Evaluation Suite fail-fast skip and allPassed preservation", () => {
    it("should not trigger fail-fast abort on unsupportedWire and preserve allPassed", async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        return new Response(
          JSON.stringify({
            error: { message: "ModelProtocolUnsupported: /v1/responses unsupported" },
          }),
          { status: 400 }
        );
      }) as unknown as typeof fetch;

      try {
        const summary = await runCodeEvaluation({
          model: "test-model",
          wire: "responses",
          directiveKey: "lr-zn-oo-rs-no",
          gatewayUrl: "http://127.0.0.1:7766/v1/responses",
          continueOnFailure: false,
        });

        // First stage unsupportedWire broke out of pipeline early
        expect(summary.unsupportedWire).toBe(true);
        expect(summary.results.length).toBe(1);
        expect(summary.results[0]?.unsupportedWire).toBe(true);
        // Does not falsify allPassed when skipped due to unsupported wire
        expect(summary.allPassed).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("3. S4: formatWireVerdict and report renderers emit N/A", () => {
    it("formatWireVerdict should return '⚪ N/A' when unsupportedWire is set", () => {
      const wireSummary: WireResultSummary = {
        wire: "responses",
        wireLabel: "Responses API",
        directiveKey: "lr-zn-oo-rs-no",
        gatewayUrl: "http://127.0.0.1:7766/v1/responses",
        passed: false,
        unsupportedWire: true,
      };

      expect(formatWireVerdict(wireSummary)).toBe("⚪ N/A");
    });

    it("formatWireVerdict should return '⚪ N/A' when codeSummary.unsupportedWire is set", () => {
      const wireSummary: WireResultSummary = {
        wire: "responses",
        wireLabel: "Responses API",
        directiveKey: "lr-zn-oo-rs-no",
        gatewayUrl: "http://127.0.0.1:7766/v1/responses",
        passed: false,
        summary: {
          model: "test-model",
          sanitizedModelName: "test-model",
          timestamp: new Date().toISOString(),
          directiveKey: "lr-zn-oo-rs-no",
          gatewayUrl: "http://127.0.0.1:7766/v1/responses",
          wire: "responses",
          suitesRun: ["code"],
          runs: 1,
          codeSummary: {
            model: "test-model",
            wire: "responses",
            directiveKey: "lr-zn-oo-rs-no",
            gatewayUrl: "http://127.0.0.1:7766/v1/responses",
            allPassed: true,
            unsupportedWire: true,
            results: [
              {
                stageName: "Stage 1: Wire Protocol & Long Context Hydration",
                passed: false,
                score: 0,
                unsupportedWire: true,
                details: {},
                notes: [],
              },
            ],
          },
          roleRecommendation: {
            role: "Rejected",
            badge: "🚫 REJECTED / UNVERIFIED",
            rationale: "Wire unsupported",
            strengths: [],
            caveats: [],
          },
          allSuitesPassed: true,
        },
      };

      expect(formatWireVerdict(wireSummary)).toBe("⚪ N/A");
    });

    it("formatWireVerdict should return '⚪ N/A' when error is ModelProtocolUnsupported", () => {
      const wireSummary: WireResultSummary = {
        wire: "responses",
        wireLabel: "Responses API",
        directiveKey: "lr-zn-oo-rs-no",
        gatewayUrl: "http://127.0.0.1:7766/v1/responses",
        passed: false,
        error: "HTTP 400: ModelProtocolUnsupported: Wire /v1/responses not supported",
      };

      expect(formatWireVerdict(wireSummary)).toBe("⚪ N/A");
    });

    it("generateMarkdownReport should render '⚪ N/A' for unsupported wire stages and verdict", () => {
      const summary: EvalOrchestratorSummary = {
        model: "test-model",
        sanitizedModelName: "test-model",
        timestamp: "2026-10-17T00:00:00.000Z",
        directiveKey: "lr-zn-oo-rs-no",
        gatewayUrl: "http://127.0.0.1:7766/v1/responses",
        wire: "responses",
        suitesRun: ["code"],
        runs: 1,
        codeSummary: {
          model: "test-model",
          wire: "responses",
          directiveKey: "lr-zn-oo-rs-no",
          gatewayUrl: "http://127.0.0.1:7766/v1/responses",
          allPassed: true,
          unsupportedWire: true,
          results: [
            {
              stageName: "Stage 1: Wire Protocol & Long Context Hydration",
              passed: false,
              score: 0,
              unsupportedWire: true,
              error: "ModelProtocolUnsupported: Wire /v1/responses not supported",
              details: {},
              notes: ["Wire unsupported"],
            },
          ],
        },
        roleRecommendation: {
          role: "Rejected",
          badge: "🚫 REJECTED / UNVERIFIED",
          rationale: "Wire unsupported",
          strengths: [],
          caveats: [],
        },
        allSuitesPassed: true,
      };

      const markdown = generateMarkdownReport(summary);
      expect(markdown).toContain("⚪ N/A");
      expect(markdown).toContain("⚪ **N/A (wire protocol unsupported)**");
      expect(markdown).toContain("Skipped: Wire protocol unsupported by target model / provider");
    });

    it("generateConsolidatedMarkdownReport should render '⚪ N/A' in comparison table", () => {
      const consolidated: ConsolidatedModelSummary = {
        model: "test-model",
        sanitizedModelName: "test-model",
        timestamp: "2026-10-17T00:00:00.000Z",
        gatewayHost: "http://127.0.0.1:7766",
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
            gatewayUrl: "http://127.0.0.1:7766/v1/chat/completions",
            passed: true,
          },
          responses: {
            wire: "responses",
            wireLabel: "Responses API",
            directiveKey: "lr-or-oo-rs-no",
            gatewayUrl: "http://127.0.0.1:7766/v1/responses",
            passed: false,
            unsupportedWire: true,
          },
          messages: {
            wire: "messages",
            wireLabel: "Anthropic Messages",
            directiveKey: "lr-or-cl-ms-no",
            gatewayUrl: "http://127.0.0.1:7766/v1/messages",
            passed: true,
          },
        },
        allWiresPassed: true,
        unifiedRoleRecommendation: {
          overallRole: "General Coder",
          badge: "💻 GENERAL CODER",
          rationale: "Strong coding performance on supported wires.",
          bestWireForOrchestrator: "Chat Completions (`lr-or-oa-ch-no`)",
          bestWireForCoder: "Chat Completions (`lr-or-oa-ch-no`)",
          bestWireForExplorer: "Anthropic Messages (`lr-or-cl-ms-no`)",
          strengths: ["Clean coding output"],
          caveats: ["Responses API wire unsupported"],
        },
      };

      const markdown = generateConsolidatedMarkdownReport(consolidated);
      expect(markdown).toContain("| **Overall Verdict** | 🟢 PASSED | ⚪ N/A | 🟢 PASSED |");
    });
  });

  describe("4. S6: Explicit wire flag overrides directive substring sniffing", () => {
    it("should honor explicit wire='chat' even when directiveKey contains '-cl-' (Claude segment)", () => {
      const { resolveWireAndDefaults } = require("../../eval/code");
      const resolved = resolveWireAndDefaults({
        wire: "chat",
        directiveKey: "lr-zn-cl-ch-no",
      });
      expect(resolved.wire).toBe("chat");
      expect(resolved.gatewayUrl).toContain("/v1/chat/completions");
      expect(resolved.directiveKey).toBe("lr-zn-cl-ch-no");
    });

    it("should honor explicit wire='responses' even with chat model name", () => {
      const { resolveWireAndDefaults } = require("../../eval/code");
      const resolved = resolveWireAndDefaults({
        wire: "responses",
        model: "openai/gpt-4o",
      });
      expect(resolved.wire).toBe("responses");
      expect(resolved.gatewayUrl).toContain("/v1/responses");
    });
  });
});
