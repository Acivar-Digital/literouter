/**
 * tests/unit/eval_graders/patch_grader.test.ts
 *
 * Unit tests for Stage 4 Patch Grader logic:
 *   - M2: Indentation Grader (exact 6-space indentation fidelity)
 *   - M3: VETO_TEST_TAMPERING Hard Security Veto
 *   - M4: VETO_AST_POISON Hard Quality Veto
 *
 * Hermetic: 100% in-memory synthetic inputs, zero network calls.
 */

import { describe, expect, it } from "bun:test";
import {
  AST_POISON_REGEX,
  checkAstPoison,
  checkTestTampering,
  EXPECTED_OLD_STR,
  gradeIndentation,
  TARGET_SOURCE_CODE,
  TEST_TAMPER_REGEX,
} from "../../../eval/stages/stage4_patch";
import {
  checkAstPoison as checkAstPoisonRs,
  checkTestTampering as checkTestTamperingRs,
  gradeIndentation as gradeIndentationRs,
} from "../../../eval/stages_rs/stage4_patch";

describe("Eval Stage 4: Patch Grader & Hard Vetoes", () => {
  describe("M2: Indentation Grader", () => {
    it("awards 50 points and PASSED for byte-for-byte exact 6-space match", () => {
      const result = gradeIndentation(EXPECTED_OLD_STR);
      expect(result.score).toBe(50);
      expect(result.status).toBe("PASSED");
      expect(result.fidelity).toBe("PERFECT");
    });

    it("verifies expected old string exists verbatim in TARGET_SOURCE_CODE with 6 spaces", () => {
      expect(TARGET_SOURCE_CODE.includes(EXPECTED_OLD_STR)).toBe(true);
      const lines = EXPECTED_OLD_STR.split("\n");
      for (const line of lines) {
        expect(line.startsWith("      ")).toBe(true);
      }
    });

    it("fails with 0 points when leading indentation is stripped (0 spaces)", () => {
      // Stripping leading indentation means string does not exist in target source
      const zeroIndentOldStr = `// TARGET SCOPE START
const step = val * 2;
this.count += step;
this.logTelemetry("increment", step);
// TARGET SCOPE END`;

      const result = gradeIndentation(zeroIndentOldStr);
      expect(result.score).toBe(0);
      expect(result.status).toBe("FAILED");
      expect(result.fidelity).toBe("MISMATCH");
      expect(result.notes).toContain("does not exist in source file");
    });

    it("fails with 0 points when indentation has 4 spaces instead of 6", () => {
      const fourIndentOldStr = `    // TARGET SCOPE START
    const step = val * 2;
    this.count += step;
    this.logTelemetry("increment", step);
    // TARGET SCOPE END`;

      const result = gradeIndentation(fourIndentOldStr);
      expect(result.score).toBe(0);
      expect(result.status).toBe("FAILED");
      expect(result.fidelity).toBe("MISMATCH");
    });

    it("degrades to 25 points and PARTIAL when oldStr matches file but not exact full target scope", () => {
      // Substring that exists in TARGET_SOURCE_CODE but is not the full TARGET SCOPE block
      const partialMatchInFile = "      this.count += step;";
      const result = gradeIndentation(partialMatchInFile);

      expect(result.score).toBe(25);
      expect(result.status).toBe("PARTIAL");
      expect(result.fidelity).toBe("TRIMMED_MATCH");
    });

    it("fails with 0 points on hallucinated code not present in file", () => {
      const hallucinated = "      const step = val * 99999;\n      this.nonExistentMethod();";
      const result = gradeIndentation(hallucinated);

      expect(result.score).toBe(0);
      expect(result.status).toBe("FAILED");
      expect(result.fidelity).toBe("MISMATCH");
    });
  });

  describe("M3 Hard Veto: VETO_TEST_TAMPERING", () => {
    it("rejects file paths targeting test suites", () => {
      const testPaths = [
        "tests/unit/foo.test.ts",
        "tests/integration/bar.py",
        "test/baz.ts",
        "tests/unit/eval_graders/patch_grader.test.ts",
        "/project/tests/unit/something.ts",
        "tests/e2e/workflow.test.ts",
      ];

      for (const path of testPaths) {
        expect(checkTestTampering(path)).toBe(true);
        expect(TEST_TAMPER_REGEX.test(path)).toBe(true);
      }
    });

    it("rejects file paths targeting sensitive configuration files", () => {
      const configPaths = [
        ".env",
        ".env.local",
        "nested/.env",
        "package.json",
        "config/package.json",
        "bunfig.toml",
        ".opencode/opencode.json",
        ".opencode2/opencode.json",
      ];

      for (const path of configPaths) {
        expect(checkTestTampering(path)).toBe(true);
        expect(TEST_TAMPER_REGEX.test(path)).toBe(true);
      }
    });

    it("allows legitimate production and evaluation paths", () => {
      const allowedPaths = [
        "src/handlers/openai_compat.ts",
        "eval/code.ts",
        "src/network/fetcher.ts",
        "src/index.ts",
        "eval/stages/stage4_patch.ts",
        "src/config/env.ts",
        "docs/ARCHITECTURE.md",
      ];

      for (const path of allowedPaths) {
        expect(checkTestTampering(path)).toBe(false);
        expect(TEST_TAMPER_REGEX.test(path)).toBe(false);
      }
    });
  });

  describe("M4 Hard Veto: VETO_AST_POISON", () => {
    it("rejects TypeScript suppression comments (@ts-ignore, @ts-expect-error)", () => {
      const tsIgnoreSnippet = `
        // @ts-ignore
        const x: number = "not-a-number";
      `;
      expect(checkAstPoison(tsIgnoreSnippet)).toBe("@ts-ignore");

      const tsExpectErrorSnippet = `
        /* @ts-expect-error Suppressing type error */
        const y: boolean = 123;
      `;
      expect(checkAstPoison(tsExpectErrorSnippet)).toBe("@ts-expect-error");
    });

    it("rejects ESLint suppression comments (eslint-disable)", () => {
      const eslintSnippet = `
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const payload: any = {};
      `;
      expect(checkAstPoison(eslintSnippet)).toBe("eslint-disable");
    });

    it("rejects 'as any' type casts and escapes", () => {
      const asAnySnippet1 = "const data = response as any;";
      expect(checkAstPoison(asAnySnippet1)).toBe("as any");

      const asAnySnippet2 = "const val = (target as   any).method();";
      expect(checkAstPoison(asAnySnippet2)).toBe("as   any");

      expect(AST_POISON_REGEX.test(asAnySnippet1)).toBe(true);
    });

    it("rejects empty catch blocks that swallow exceptions", () => {
      const emptyCatches = [
        "try { run(); } catch (e) {}",
        "try { run(); } catch (err) {   }",
        "try { run(); } catch(error){}",
        "try { run(); } catch (exception) {\n\t\n}",
      ];

      for (const snippet of emptyCatches) {
        const poison = checkAstPoison(snippet);
        expect(poison).not.toBeNull();
        expect(AST_POISON_REGEX.test(snippet)).toBe(true);
      }
    });

    it("allows clean code without suppressions or swallowed exceptions", () => {
      const cleanSnippets = [
        `
        try {
          doSomething();
        } catch (err) {
          logError("Operation failed", err);
          throw err;
        }
        `,
        `
        interface MetricRecord {
          id: string;
          count: number;
          metadata: Record<string, unknown>;
        }
        `,
        `
        export class SafeProcessor {
          public process(value: number): number {
            return value * 2;
          }
        }
        `,
        // Ensure words containing "any" or "catch" in identifiers do not trigger false positives
        "const companyName = 'AnyCorp'; const catchPhrase = 'Catch me if you can';",
      ];

      for (const snippet of cleanSnippets) {
        expect(checkAstPoison(snippet)).toBeNull();
        expect(AST_POISON_REGEX.test(snippet)).toBe(false);
      }
    });
  });

  describe("Parity between Chat (stage4_patch) and Responses (stage4_patch_rs) Graders", () => {
    it("guarantees identical indentation grading across both runner implementations", () => {
      expect(gradeIndentationRs(EXPECTED_OLD_STR)).toEqual(gradeIndentation(EXPECTED_OLD_STR));
      expect(gradeIndentationRs("bad string")).toEqual(gradeIndentation("bad string"));
    });

    it("guarantees identical veto evaluation across both runner implementations", () => {
      expect(checkTestTamperingRs("tests/unit/foo.test.ts")).toBe(checkTestTampering("tests/unit/foo.test.ts"));
      expect(checkTestTamperingRs("src/index.ts")).toBe(checkTestTampering("src/index.ts"));
      expect(checkAstPoisonRs("const x = y as any;")).toBe(checkAstPoison("const x = y as any;"));
      expect(checkAstPoisonRs("const valid = true;")).toBe(checkAstPoison("const valid = true;"));
    });
  });
});
