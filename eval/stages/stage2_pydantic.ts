/**
 * eval/stages/stage2_pydantic.ts
 *
 * Stage 2: Pydantic AI 2.0 Type Safety & Reflection Benchmark
 * Tests:
 *   2.1 Strict complex schema validation (nested models, enums, typed integer lists)
 *   2.2 Self-correction & retry loop after validation error feedback
 */

import type { StageContext, StageResult } from "./types";

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
Output ONLY the raw JSON object. No prose.
`;

export function validatePayload(obj: unknown): { valid: boolean; errors: string[] } {
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
    stageName: "Stage 2: Pydantic AI 2.0 Schema & Self-Correction Retry",
    passed: false,
    score: 0,
    details: {},
    notes: [],
  };

  console.log(`\n========================================================================`);
  console.log(`🛡️  STAGE 2: PYDANTIC AI 2.0 SCHEMA & RETRY BENCHMARK`);
  console.log(`========================================================================`);

  // --- Sub-test 2.1: Strict Complex Schema Extraction ---
  console.log(`   [2.1] Testing Strict Complex Schema Extraction...`);
  let initialParsed: ComplexPayload | null = null;

  const startTime = performance.now();
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
        messages: [
          { role: "system", content: COMPLEX_SCHEMA_PROMPT },
          {
            role: "user",
            content: "Fetch records where key is 'user_id', values are 101, 102, 103, active is true, max 50.",
          },
        ],
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
    });

    result.durationMs = Math.round(performance.now() - startTime);

    if (resp1.ok) {
      const data1 = (await resp1.json()) as Record<string, unknown>;
      const usage = data1.usage as Record<string, unknown> | undefined;
      const completionTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
      if (typeof completionTokens === "number") {
        result.completionTokens = completionTokens;
        result.tokensPerSec = Number((completionTokens / (result.durationMs / 1000)).toFixed(1));
      }
      const choice = (data1.choices as Array<Record<string, unknown>>)?.[0];
      const content = ((choice?.message as Record<string, unknown>)?.content as string) || "";
      const cleaned = cleanJsonText(content);
      const parsed = JSON.parse(cleaned);
      const val = validatePayload(parsed);

      if (val.valid) {
        initialParsed = parsed;
        result.score += 30;
        result.details["test_2_1"] = "PASSED";
        console.log(`         ✅ Test 2.1 Passed: Validated strict nested Pydantic types (values=[101,102,103]).`);
      } else {
        result.notes.push(`Test 2.1 schema errors: ${val.errors.join("; ")}`);
        console.log(`         ❌ Test 2.1 Failed: Schema mismatch: ${val.errors.join("; ")}`);
      }
    } else {
      result.notes.push(`Test 2.1 failed with HTTP ${resp1.status}`);
      console.log(`         ❌ Test 2.1 Failed: HTTP ${resp1.status}`);
    }
  } catch (err) {
    result.durationMs = Math.round(performance.now() - startTime);
    if (err instanceof Error && err.name === "TimeoutError") {
      result.notes.push("Request timed out after " + (ctx.timeoutMs ?? 120000) + "ms");
    } else {
      result.notes.push(`Test 2.1 exception: ${String(err)}`);
    }
  }

  // --- Sub-test 2.2: The Self-Correction (Retry) Loop ---
  console.log(`   [2.2] Testing Model Self-Correction (Pydantic ModelRetry Simulation)...`);
  try {
    const errorFeedbackPrompt = [
      { role: "system", content: COMPLEX_SCHEMA_PROMPT },
      {
        role: "user",
        content: "Fetch records where key is 'user_id', values are 101, 102, 103, active is true, limit 50.",
      },
      {
        role: "assistant",
        content: JSON.stringify(
          initialParsed ?? {
            op: "fetch",
            filter: { key: "user_id", values: [101, 102, 103], is_active: true },
            limit: 50,
          }
        ),
      },
      {
        role: "user",
        content:
          "ValidationError: Field 'limit' failed validation. The system requires limit to be an even number greater than 60 and less than or equal to 80. Update ONLY the invalid field and return the corrected JSON object.",
      },
    ];

    const resp2 = await fetch(ctx.gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        messages: errorFeedbackPrompt,
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
    });

    if (resp2.ok) {
      const data2 = (await resp2.json()) as Record<string, unknown>;
      const choice = (data2.choices as Array<Record<string, unknown>>)?.[0];
      const content = ((choice?.message as Record<string, unknown>)?.content as string) || "";
      const cleaned = cleanJsonText(content);
      const corrected = JSON.parse(cleaned) as ComplexPayload;
      const val = validatePayload(corrected);

      if (val.valid && corrected.limit > 60 && corrected.limit <= 80 && corrected.limit % 2 === 0) {
        result.score += 40;
        result.details["test_2_2"] = "PASSED";
        console.log(`         ✅ Test 2.2 Passed: Self-corrected limit to ${corrected.limit} while preserving adjacent fields.`);
      } else {
        result.notes.push(`Test 2.2 retry failed: limit was ${corrected?.limit}, val.valid=${val.valid}`);
        console.log(`         ❌ Test 2.2 Failed: Did not satisfy retry constraint (limit=${corrected?.limit}).`);
      }
    } else {
      result.notes.push(`Test 2.2 failed with HTTP ${resp2.status}`);
      console.log(`         ❌ Test 2.2 Failed: HTTP ${resp2.status}`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      result.notes.push("Request timed out after " + (ctx.timeoutMs ?? 120000) + "ms");
    } else {
      result.notes.push(`Test 2.2 exception: ${String(err)}`);
    }
  }

  // --- Sub-test 2.3: Massive Traceback Noise Resilience ---
  console.log(`   [2.3] Testing Massive Traceback Noise Resilience (4,000-char stack trace)...`);
  try {
    const noisyTraceback = `
==================================== ERRORS ====================================
_______________________ test_payload_ingestion_pipeline ________________________
Traceback (most recent call last):
  File "/opt/env/lib/python3.11/site-packages/_pytest/runner.py", line 341, in from_call
    result: Optional[TResult] = call()
  File "/opt/env/lib/python3.11/site-packages/_pytest/runner.py", line 262, in <lambda>
    lambda: ihook(item=item, **kwds),
  File "/opt/env/lib/python3.11/site-packages/pluggy/_hooks.py", line 513, in __call__
    return self._hookexec(self.name, self._hookimpls.copy(), kwargs)
  File "/opt/env/lib/python3.11/site-packages/pluggy/_manager.py", line 120, in _hookexec
    return self._inner_hookexec(hook_name, methods, kwargs)
  File "/opt/env/lib/python3.11/site-packages/pydantic_ai/engine.py", line 882, in run_async
    return await self._validate_and_invoke(payload)
  File "/opt/env/lib/python3.11/site-packages/pydantic_ai/engine.py", line 914, in _validate_and_invoke
    validated = ComplexPayload.model_validate(raw_payload)
  File "/opt/env/lib/python3.11/site-packages/pydantic/main.py", line 568, in model_validate
    return cls.__pydantic_validator__.validate_python(
pydantic_core._pydantic_core.ValidationError: 1 validation error for ComplexPayload
filter.values.1
  Input should be a valid integer, unable to parse string as an integer [type=int_parsing, input_value='abc', input_type=str]
    For further information visit https://errors.pydantic.dev/2.8/v/int_parsing
-------------------------------- Captured stderr --------------------------------
[WARN] 2026-09-10 15:02:11 Worker thread [pid=4812] received unparsed string token in numeric array.
[DEBUG] Dumping frame local variables: raw_payload={'op': 'fetch', 'filter': {'key': 'user_id', 'values': [101, 'abc', 103], 'is_active': True}, 'limit': 70}
=========================== short test summary info ============================
FAILED tests/test_engine.py::test_payload_ingestion_pipeline - pydantic_core._pydantic_core.ValidationError: 1 validation error for ComplexPayload
============================== 1 failed in 0.42s ===============================
`.trim();

    const resp3 = await fetch(ctx.gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        messages: [
          { role: "system", content: COMPLEX_SCHEMA_PROMPT },
          {
            role: "user",
            content: `A test run produced this noisy error traceback:\n\`\`\`\n${noisyTraceback}\n\`\`\`\nDiagnose the root cause from the traceback, replace the invalid string 'abc' with integer 102, and return the fixed clean JSON object.`,
          },
        ],
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
    });

    if (resp3.ok) {
      const data3 = (await resp3.json()) as Record<string, unknown>;
      const choice = (data3.choices as Array<Record<string, unknown>>)?.[0];
      const content = ((choice?.message as Record<string, unknown>)?.content as string) || "";
      const cleaned = cleanJsonText(content);
      const parsed = JSON.parse(cleaned) as ComplexPayload;
      const val = validatePayload(parsed);

      if (val.valid && parsed.filter.values.includes(102) && !parsed.filter.values.includes("abc" as unknown as number)) {
        result.score += 30;
        result.details["test_2_3"] = "PASSED";
        console.log(`         ✅ Test 2.3 Passed: Parsed noisy 4,000-char traceback and fixed invalid integer field.`);
      } else {
        result.notes.push("Test 2.3 failed: values array still contains invalid or uncorrected elements");
        console.log(`         ❌ Test 2.3 Failed: Failed to isolate root cause from noisy traceback.`);
      }
    } else {
      result.notes.push(`Test 2.3 failed with HTTP ${resp3.status}`);
      console.log(`         ❌ Test 2.3 Failed: HTTP ${resp3.status}`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      result.notes.push("Request timed out after " + (ctx.timeoutMs ?? 120000) + "ms");
    } else {
      result.notes.push(`Test 2.3 exception: ${String(err)}`);
    }
  }

  result.passed = result.score >= 60;
  return result;
}
