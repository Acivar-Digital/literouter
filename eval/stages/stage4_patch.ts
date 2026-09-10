/**
 * eval/stages/stage4_patch.ts
 *
 * Stage 4: Surgical Coding & Patch Fidelity (str_replace / edit_file)
 * Tests:
 *   Instructs model to replace an exact 4-line block inside a nested indentation scope.
 *   Verifies byte-for-byte exact matching on `old_str` with zero line hallucination or offset drift.
 */

import type { StageContext, StageResult } from "./types";

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
  console.log(`✂️  STAGE 4: SURGICAL CODING & PATCH FIDELITY (str_replace)`);
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
        tools: [
          {
            type: "function",
            function: {
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
            },
          },
        ],
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      result.notes.push(`Test 4.1 failed with HTTP ${resp.status}`);
      console.log(`         ❌ Test 4.1 Failed: HTTP ${resp.status}`);
    } else {
      const data = (await resp.json()) as Record<string, unknown>;
      const choice = (data.choices as Array<Record<string, unknown>>)?.[0];
      const toolCalls = (choice?.message as Record<string, unknown>)?.tool_calls as Array<Record<string, unknown>>;

      if (!toolCalls || toolCalls.length === 0) {
        result.notes.push("Model did not invoke edit_file tool in Test 4.1");
        console.log(`         ❌ Test 4.1 Failed: edit_file tool not called.`);
      } else {
        const firstCall = toolCalls[0]?.function as Record<string, unknown>;
        const args = typeof firstCall?.arguments === "string" ? JSON.parse(firstCall.arguments) : firstCall?.arguments;

        const oldStr = args?.old_str as string | undefined;
        const newStr = args?.new_str as string | undefined;

        if (!oldStr) {
          result.notes.push("Missing old_str in edit_file arguments");
          console.log(`         ❌ Test 4.1 Failed: old_str is missing.`);
        } else {
          // Exact string match check against TARGET_SOURCE_CODE
          const matchesInFile = TARGET_SOURCE_CODE.includes(oldStr);
          const exactTargetMatch = oldStr.trim() === EXPECTED_OLD_STR.trim();
          const preservedLeadingSpaces = oldStr.startsWith("      "); // 6 leading spaces preserved

          if (matchesInFile && exactTargetMatch && preservedLeadingSpaces) {
            result.score += 50;
            result.details["test_4_1"] = "PASSED";
            console.log(`         ✅ Test 4.1 Passed: Byte-for-byte exact old_str indentation match (6 leading spaces).`);
          } else if (matchesInFile) {
            result.score += 25;
            result.details["test_4_1"] = "PARTIAL";
            console.log(`         ⚠️  Test 4.1 Partial: old_str matched in file, but scope or whitespace differed slightly.`);
          } else {
            result.notes.push(`Test 4.1 old_str does not exist in source file: "${oldStr.slice(0, 80)}"`);
            console.log(`         ❌ Test 4.1 Failed: old_str does NOT exist on disk. Indentation mismatch!`);
          }
        }
      }
    }
  } catch (err) {
    result.notes.push(`Test 4.1 exception: ${String(err)}`);
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
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        tools: [
          {
            type: "function",
            function: {
              name: "edit_file",
              description: "Performs surgical exact string replacement in a file",
              parameters: {
                type: "object",
                properties: {
                  path: { type: "string" },
                  old_str: { type: "string", description: "Exact unique string to replace" },
                  new_str: { type: "string", description: "New replacement string" },
                },
                required: ["path", "old_str", "new_str"],
              },
            },
          },
        ],
        messages: [{ role: "user", content: prompt42 }],
      }),
    });

    if (resp42.ok) {
      const data42 = (await resp42.json()) as Record<string, unknown>;
      const choice42 = (data42.choices as Array<Record<string, unknown>>)?.[0];
      const toolCalls42 = (choice42?.message as Record<string, unknown>)?.tool_calls as Array<Record<string, unknown>>;

      if (toolCalls42 && toolCalls42.length > 0) {
        const firstCall = toolCalls42[0]?.function as Record<string, unknown>;
        const args42 = typeof firstCall?.arguments === "string" ? JSON.parse(firstCall.arguments) : firstCall?.arguments;
        const oldStr42 = args42?.old_str as string | undefined;

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
      result.notes.push(`Test 4.2 failed with HTTP ${resp42.status}`);
      console.log(`         ❌ Test 4.2 Failed: HTTP ${resp42.status}`);
    }
  } catch (err) {
    result.notes.push(`Test 4.2 exception: ${String(err)}`);
  }

  result.passed = result.score >= 60;
  return result;
}
