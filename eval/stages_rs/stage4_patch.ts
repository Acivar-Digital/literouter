/**
 * eval/stages_rs/stage4_patch.ts
 *
 * Stage 4: Responses API Surgical Coding & Patch Fidelity (edit_file / str_replace)
 * Tests:
 *   Instructs model to replace an exact 4-line block inside a nested indentation scope.
 *   Verifies byte-for-byte exact matching on `old_str` with zero line hallucination or offset drift.
 */

import {
  extractFunctionCalls,
  type ResponsesApiResponse,
  type ResponsesToolDefinition,
  type StageContext,
  type StageResult,
} from "./types";
import {
  TARGET_SOURCE_CODE,
  EXPECTED_OLD_STR,
  testTamperRegex,
  TEST_TAMPER_REGEX,
  astPoisonRegex,
  AST_POISON_REGEX,
  gradeIndentation,
  checkTestTampering,
  checkAstPoison,
  type IndentationGradeResult,
} from "../stages/stage4_patch";

export {
  TARGET_SOURCE_CODE,
  EXPECTED_OLD_STR,
  testTamperRegex,
  TEST_TAMPER_REGEX,
  astPoisonRegex,
  AST_POISON_REGEX,
  gradeIndentation,
  checkTestTampering,
  checkAstPoison,
  type IndentationGradeResult,
};

export async function runStage4Patch(ctx: StageContext): Promise<StageResult> {
  const result: StageResult = {
    stageName: "Stage 4: Surgical Coding & Patch Fidelity (str_replace)",
    passed: false,
    score: 0,
    details: {},
    notes: [],
  };

  console.log(`\n========================================================================`);
  console.log(`✂️  STAGE 4: RESPONSES API SURGICAL CODING & PATCH FIDELITY`);
  console.log(`========================================================================`);
  console.log(`   [4.1] Testing Exact Indentation & old_str Matching...`);

  const prompt = `
You are an expert autonomous software engineer.
Here is the source file 'src/metrics.ts':
\`\`\`typescript
${TARGET_SOURCE_CODE}
\`\`\`

Task:
Call the 'edit_file' tool to replace the TARGET SCOPE block inside the increment() method.
Replace it with:
      const step = val * 3;
      this.count += step;

Rules:
1. 'old_str' MUST match the existing code in the file EXACTLY, character-for-character, including all 6 leading spaces on each line.
2. Do not omit any lines or use '// rest of code' comments.
`;

  const editFileTool: ResponsesToolDefinition = {
    type: "function",
    name: "edit_file",
    description: "Performs surgical exact string replacement in a file",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_str: { type: "string", description: "Exact string to replace" },
        new_str: { type: "string", description: "New replacement string" },
      },
      required: ["path", "old_str", "new_str"],
    },
  };

  try {
    const resp = await fetch(ctx.gatewayUrl, {
      method: "POST",
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        tools: [editFileTool],
        input: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      result.notes.push(`Test 4.1 failed with HTTP ${resp.status}`);
      console.log(`         ❌ Test 4.1 Failed: HTTP ${resp.status}`);
    } else {
      const data = (await resp.json()) as ResponsesApiResponse;
      const functionCalls = extractFunctionCalls(data.output);

      if (functionCalls.length === 0) {
        result.notes.push("Model did not invoke edit_file tool in Test 4.1");
        console.log(`         ❌ Test 4.1 Failed: edit_file tool not called.`);
      } else {
        const firstCall = functionCalls[0];
        if (!firstCall) {
          result.notes.push("Missing firstCall in functionCalls array");
        } else {
          const args = typeof firstCall.arguments === "string" ? JSON.parse(firstCall.arguments) : firstCall.arguments;

          const path = args?.path as string | undefined;
          const oldStr = args?.old_str as string | undefined;
          const newStr = args?.new_str as string | undefined;

          // M3 Hard Veto: VETO_TEST_TAMPERING
          if (path && checkTestTampering(path)) {
            result.vetoTriggered = "VETO_TEST_TAMPERING";
            result.passed = false;
            result.score = 0;
            result.notes.push("CRITICAL SECURITY FAILURE: Model attempted to tamper with test suite or configuration file: " + path);
            console.log(`         🚨 VETO TRIGGERED: VETO_TEST_TAMPERING (${path})`);
            return result;
          }

          // M4 Hard Veto: VETO_AST_POISON
          const matchedPoison = newStr ? checkAstPoison(newStr) : null;
          if (matchedPoison) {
            result.vetoTriggered = "VETO_AST_POISON";
            result.passed = false;
            result.score = 0;
            result.notes.push("CRITICAL QUALITY FAILURE: Model injected type suppression or swallowed exception: " + matchedPoison);
            console.log(`         🚨 VETO TRIGGERED: VETO_AST_POISON (${matchedPoison})`);
            return result;
          }

          if (!oldStr) {
            result.notes.push("Missing old_str in edit_file arguments");
            console.log(`         ❌ Test 4.1 Failed: old_str is missing.`);
          } else {
            const grade = gradeIndentation(oldStr);
            if (grade.status === "PASSED") {
              result.score += grade.score;
              result.details["test_4_1"] = "PASSED";
              result.details["indentation_fidelity"] = "PERFECT";
              console.log(`         ✅ Test 4.1 Passed: Byte-for-byte exact old_str indentation match (6 leading spaces).`);
            } else if (grade.status === "PARTIAL") {
              result.score += grade.score;
              result.details["test_4_1"] = "PARTIAL";
              result.details["indentation_fidelity"] = "TRIMMED_MATCH";
              console.log(`         ⚠️  Test 4.1 Partial: old_str matched in file, but scope or whitespace differed slightly.`);
            } else {
              if (grade.notes) result.notes.push(grade.notes);
              console.log(`         ❌ Test 4.1 Failed: old_str does NOT exist on disk. Indentation mismatch!`);
            }
          }
        }
      }
    }
  } catch (err) {
    result.notes.push(`Test 4.1 exception: ${String(err)}`);
    console.log(`         ❌ Test 4.1 Error: ${String(err)}`);
  }

  // --- Sub-test 4.2: Ambiguous Duplicate String Disambiguation ---
  console.log(`   [4.2] Testing Ambiguous Duplicate String Disambiguation...`);
  const AMBIGUOUS_SOURCE = `
function handleAlpha(x: number): boolean {
  // SCOPE ALPHA
  const valid = x > 0;
  return valid;
}

function handleBeta(x: number): boolean {
  // SCOPE BETA
  const valid = x > 0;
  return valid;
}
`.trim();

  const prompt42 = `
Here is source file 'src/validators.ts':
\`\`\`typescript
${AMBIGUOUS_SOURCE}
\`\`\`

Task:
Call the 'edit_file' tool to modify handleBeta() so that 'const valid = x > 0;' becomes 'const valid = x >= 10;'.

CRITICAL RULE:
The code block 'const valid = x > 0;\\n  return valid;' appears in BOTH handleAlpha and handleBeta.
If your 'old_str' matches multiple locations, the tool will FAIL with an ambiguous match error.
You MUST include enough surrounding context (e.g. 'function handleBeta' or '// SCOPE BETA') in 'old_str' so that it matches EXACTLY ONCE in the file.
`;

  try {
    const resp42 = await fetch(ctx.gatewayUrl, {
      method: "POST",
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        tools: [editFileTool],
        input: [{ role: "user", content: prompt42 }],
      }),
    });

    if (resp42.ok) {
      const data42 = (await resp42.json()) as ResponsesApiResponse;
      const functionCalls42 = extractFunctionCalls(data42.output);

      if (functionCalls42.length > 0) {
        const firstCall = functionCalls42[0];
        if (firstCall) {
          const args42 = typeof firstCall.arguments === "string" ? JSON.parse(firstCall.arguments) : firstCall.arguments;
          const path42 = args42?.path as string | undefined;
          const oldStr42 = args42?.old_str as string | undefined;
          const newStr42 = args42?.new_str as string | undefined;

          // M3 Hard Veto: VETO_TEST_TAMPERING
          if (path42 && checkTestTampering(path42)) {
            result.vetoTriggered = "VETO_TEST_TAMPERING";
            result.passed = false;
            result.score = 0;
            result.notes.push("CRITICAL SECURITY FAILURE: Model attempted to tamper with test suite or configuration file: " + path42);
            console.log(`         🚨 VETO TRIGGERED: VETO_TEST_TAMPERING (${path42})`);
            return result;
          }

          // M4 Hard Veto: VETO_AST_POISON
          const matchedPoison42 = newStr42 ? checkAstPoison(newStr42) : null;
          if (matchedPoison42) {
            result.vetoTriggered = "VETO_AST_POISON";
            result.passed = false;
            result.score = 0;
            result.notes.push("CRITICAL QUALITY FAILURE: Model injected type suppression or swallowed exception: " + matchedPoison42);
            console.log(`         🚨 VETO TRIGGERED: VETO_AST_POISON (${matchedPoison42})`);
            return result;
          }

          if (oldStr42) {
            const firstIdx = AMBIGUOUS_SOURCE.indexOf(oldStr42);
            const lastIdx = AMBIGUOUS_SOURCE.lastIndexOf(oldStr42);
            const occursExactlyOnce = firstIdx !== -1 && firstIdx === lastIdx;
            const targetsBeta = oldStr42.includes("handleBeta") || oldStr42.includes("SCOPE BETA");

            if (occursExactlyOnce && targetsBeta) {
              result.score += 50;
              result.details["test_4_2"] = "PASSED";
              console.log(`         ✅ Test 4.2 Passed: Disambiguated duplicate string with unique surrounding context.`);
            } else if (firstIdx !== -1 && !occursExactlyOnce) {
              result.notes.push("Test 4.2 failed: old_str matched multiple locations in file");
              console.log(`         ❌ Test 4.2 Failed: old_str matches MULTIPLE locations (ambiguous patch).`);
            } else {
              result.notes.push("Test 4.2 failed: old_str does not match target handleBeta scope");
              console.log(`         ❌ Test 4.2 Failed: old_str does not target handleBeta scope.`);
            }
          }
        }
      } else {
        result.notes.push("Model did not invoke edit_file tool in Test 4.2");
        console.log(`         ❌ Test 4.2 Failed: edit_file tool not called.`);
      }
    } else {
      result.notes.push(`Test 4.2 failed with HTTP ${resp42.status}`);
      console.log(`         ❌ Test 4.2 Failed: HTTP ${resp42.status}`);
    }
  } catch (err) {
    result.notes.push(`Test 4.2 exception: ${String(err)}`);
    console.log(`         ❌ Test 4.2 Error: ${String(err)}`);
  }

  result.passed = result.score >= 60;
  return result;
}
