/**
 * eval/stages_rs/stage2_pydantic.ts
 *
 * Stage 2: Responses API Strict Schema & Self-Correction Retry Benchmark
 * Tests:
 *   2.1 Strict complex schema validation (nested objects, enums, typed integer lists)
 *   2.2 Self-correction & retry loop after validation error feedback
 */

import {
  extractAssistantText,
  type ResponsesApiResponse,
  type StageContext,
  type StageResult,
} from "./types";

interface QueryFilter {
  key: string;
  values: number[];
  is_active: boolean;
}

interface ComplexPayload {
  op: "fetch" | "mutate";
  filter: QueryFilter;
  limit: number;
}

const COMPLEX_SCHEMA_PROMPT = `
You are a strict data extraction engine for Pydantic AI 2.0.
Output a JSON object matching this schema:
{
  "op": "fetch" | "mutate",
  "filter": {
    "key": string,
    "values": number[], // Array of integers
    "is_active": boolean
  },
  "limit": number // Integer between 1 and 100
}
Output ONLY the raw JSON object. No prose, no markdown fences.
`;

function validatePayload(obj: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!obj || typeof obj !== "object") {
    return { valid: false, errors: ["Root is not an object"] };
  }
  const rec = obj as Record<string, unknown>;

  if (rec.op !== "fetch" && rec.op !== "mutate") {
    errors.push(`Invalid op: ${rec.op}`);
  }

  if (typeof rec.limit !== "number" || rec.limit <= 0 || rec.limit > 100) {
    errors.push(`Invalid limit: ${rec.limit} (must be integer 1-100)`);
  }

  if (!rec.filter || typeof rec.filter !== "object") {
    errors.push("Missing filter object");
  } else {
    const f = rec.filter as Record<string, unknown>;
    if (typeof f.key !== "string") errors.push("filter.key must be string");
    if (typeof f.is_active !== "boolean") errors.push("filter.is_active must be boolean");
    if (!Array.isArray(f.values) || !f.values.every((v) => typeof v === "number")) {
      errors.push("filter.values must be list of integers");
    }
  }

  return { valid: errors.length === 0, errors };
}

function cleanJsonText(raw: string): string {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```json")) {
    cleaned = cleaned.replace(/^```json\s*/i, "").replace(/\s*```$/i, "");
  } else if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```\s*/, "").replace(/\s*```$/, "");
  }
  return cleaned.trim();
}

export async function runStage2Pydantic(ctx: StageContext): Promise<StageResult> {
  const result: StageResult = {
    stageName: "Stage 2: Pydantic Schema & Self-Correction Retry",
    passed: false,
    score: 0,
    details: {},
    notes: [],
  };

  console.log(`\n========================================================================`);
  console.log(`🛡️  STAGE 2: RESPONSES API SCHEMA & RETRY BENCHMARK`);
  console.log(`========================================================================`);

  // --- Sub-test 2.1: Strict Complex Schema Extraction ---
  console.log(`   [2.1] Testing Strict Complex Schema Extraction...`);
  let initialParsed: ComplexPayload | null = null;

  try {
    const resp1 = await fetch(ctx.gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        input: [
          { role: "system", content: COMPLEX_SCHEMA_PROMPT },
          {
            role: "user",
            content: "Fetch records where key is 'user_id', values are 101, 102, 103, active is true, max 50.",
          },
        ],
      }),
    });

    if (resp1.ok) {
      const data1 = (await resp1.json()) as ResponsesApiResponse;
      const text = extractAssistantText(data1.output);
      const cleaned = cleanJsonText(text);
      const parsed = JSON.parse(cleaned);
      const val = validatePayload(parsed);

      if (val.valid) {
        result.score += 50;
        initialParsed = parsed as ComplexPayload;
        result.details["test_2_1"] = "PASSED";
        console.log(`         ✅ Test 2.1 Passed: Validated strict nested schema with zero schema drift.`);
      } else {
        result.notes.push(`Test 2.1 validation errors: ${val.errors.join(", ")}`);
        console.log(`         ❌ Test 2.1 Failed: Schema validation failed: ${val.errors.join("; ")}`);
      }
    } else {
      const errText = await resp1.text();
      result.notes.push(`Test 2.1 HTTP ${resp1.status}: ${errText}`);
      console.log(`         ❌ Test 2.1 Failed: HTTP ${resp1.status}`);
    }
  } catch (err) {
    result.notes.push(`Test 2.1 exception: ${String(err)}`);
    console.log(`         ❌ Test 2.1 Error: ${String(err)}`);
  }

  // --- Sub-test 2.2: Retry loop under validation failure ---
  console.log(`   [2.2] Testing Pydantic AI Self-Correction & Error Feedback Loop...`);
  try {
    const resp2 = await fetch(ctx.gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        input: [
          { role: "system", content: COMPLEX_SCHEMA_PROMPT },
          {
            role: "user",
            content: "Generate a payload with op='mutate', key='config_id', values=[1,2], active=false, limit=200.",
          },
          {
            role: "assistant",
            content: '{"op":"mutate","filter":{"key":"config_id","values":[1,2],"is_active":false},"limit":200}',
          },
          {
            role: "user",
            content: "Pydantic ValidationError: limit must be an integer between 1 and 100. Fix this error and return valid JSON.",
          },
        ],
      }),
    });

    if (resp2.ok) {
      const data2 = (await resp2.json()) as ResponsesApiResponse;
      const text2 = extractAssistantText(data2.output);
      const cleaned2 = cleanJsonText(text2);
      const parsed2 = JSON.parse(cleaned2);
      const val2 = validatePayload(parsed2);

      if (val2.valid && (parsed2 as ComplexPayload).limit <= 100) {
        result.score += 50;
        result.details["test_2_2"] = "PASSED";
        console.log(`         ✅ Test 2.2 Passed: Self-corrected invalid limit constraint after error feedback.`);
      } else {
        result.notes.push(`Test 2.2 retry failed: ${val2.errors.join(", ")}`);
        console.log(`         ❌ Test 2.2 Failed: Did not fix constraint violation.`);
      }
    } else {
      const errText = await resp2.text();
      result.notes.push(`Test 2.2 HTTP ${resp2.status}: ${errText}`);
      console.log(`         ❌ Test 2.2 Failed: HTTP ${resp2.status}`);
    }
  } catch (err) {
    result.notes.push(`Test 2.2 exception: ${String(err)}`);
    console.log(`         ❌ Test 2.2 Error: ${String(err)}`);
  }

  result.passed = result.score >= 50;
  return result;
}
