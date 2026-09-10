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

const TARGET_SOURCE_CODE = `
export class MetricsCollector {
  private count = 0;

  public increment(val: number): void {
    if (val > 0) {
      // TARGET SCOPE START
      const step = val * 2;
      this.count += step;
      this.logTelemetry("increment", step);
      // TARGET SCOPE END
    }
  }

  public decrement(val: number): void {
    if (val > 0) {
      this.count -= val;
    }
  }
}
`.trim();

const EXPECTED_OLD_STR = `      // TARGET SCOPE START
      const step = val * 2;
      this.count += step;
      this.logTelemetry("increment", step);
      // TARGET SCOPE END`;

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
          return result;
        }
        const args = typeof firstCall.arguments === "string" ? JSON.parse(firstCall.arguments) : firstCall.arguments;

        const oldStr = args?.old_str as string | undefined;
        const newStr = args?.new_str as string | undefined;

        const matchesExpected = oldStr === EXPECTED_OLD_STR;
        const targetLinesMatch =
          oldStr?.includes("const step = val * 2;") &&
          oldStr?.includes("this.logTelemetry(\"increment\", step);");

        if (matchesExpected) {
          result.score = 100;
          result.passed = true;
          result.details["indentation_fidelity"] = "PERFECT";
          console.log(`         ✅ Test 4.1 Passed: Byte-for-byte exact indentation match on old_str (100/100).`);
        } else if (targetLinesMatch) {
          result.score = 80;
          result.passed = true;
          result.details["indentation_fidelity"] = "TRIMMED_MATCH";
          console.log(`         ⚠️ Test 4.1 Partial: Correct block matched but indentation slightly drifted (80/100).`);
        } else {
          result.notes.push(`old_str mismatch: received: ${JSON.stringify(oldStr)}`);
          console.log(`         ❌ Test 4.1 Failed: old_str did not match target scope.`);
        }
      }
    }
  } catch (err) {
    result.notes.push(`Stage 4 exception: ${String(err)}`);
    console.log(`         ❌ Stage 4 Error: ${String(err)}`);
  }

  return result;
}
