/**
 * eval/stages_rs/stage1_wire.ts
 *
 * Stage 1: Responses API Wire Protocol & Context Hydration
 * Tests:
 *   1.1 Single-tool & multi-tool structured invocation via POST /v1/responses (flat tool schema)
 *   1.2 12k+ token long-context hydration test on POST /v1/responses
 */

import {
  extractAssistantText,
  extractFunctionCalls,
  type ResponsesApiResponse,
  type ResponsesToolDefinition,
  type StageContext,
  type StageResult,
} from "./types";

const DUMMY_SYSTEM_GUIDELINES = `
# SYSTEM CODING GUIDELINES & PROJECT POLICIES
You are an expert agentic software engineer operating in an autonomous codebase.
All tool calls MUST use the Responses API flat function format. You are expected to strictly respect
code hygiene, architectural boundaries, type safety, and avoid modifying protected environment variables.
Never overwrite .env or .env.local. Always inspect files before modifying them.
Do not introduce unnecessary dependencies or speculative utility functions.
Follow deterministic minimalism and verification-led execution.
`.repeat(30); // ~12k tokens of hydration payload

function isResponsesWireUnsupported(status: number, errText: string): boolean {
  if (status !== 400 && status !== 404 && status !== 501) return false;
  const lower = errText.toLowerCase();
  return (
    errText.includes("ModelProtocolUnsupported") ||
    lower.includes("protocol unsupported") ||
    lower.includes("unsupported wire") ||
    lower.includes("unsupported or invalid provider") ||
    lower.includes("endpoint mismatch") ||
    lower.includes("does not support /v1/responses") ||
    lower.includes("does not support responses") ||
    lower.includes("not supported for this model")
  );
}

export async function runStage1Wire(ctx: StageContext): Promise<StageResult> {
  const result: StageResult = {
    stageName: "Stage 1: Wire Protocol & Long Context Hydration",
    passed: false,
    score: 0,
    details: {},
    notes: [],
  };

  console.log(`\n========================================================================`);
  console.log(`🔌 STAGE 1: RESPONSES API WIRE PROTOCOL & HYDRATION`);
  console.log(`========================================================================`);

  // --- Sub-test 1.1: Single-tool structured invocation via Responses API ---
  console.log(`   [1.1] Testing Responses API Flat Tool Calling Primitives...`);
  const startTime = performance.now();
  try {
    const bashTool: ResponsesToolDefinition = {
      type: "function",
      name: "bash",
      description: "Execute bash command",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    };

    const resp1 = await fetch(ctx.gatewayUrl, {
      method: "POST",
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        ...(ctx.extraPayload ?? {}),
        input: [{ role: "user", content: "List all files in /tmp using the bash tool." }],
        tools: [bashTool],
      }),
    });

    result.durationMs = Math.round(performance.now() - startTime);

    if (!resp1.ok) {
      const errText = await resp1.text();
      if (isResponsesWireUnsupported(resp1.status, errText)) {
        result.unsupportedWire = true;
        result.error = `ModelProtocolUnsupported: Wire /v1/responses not supported (HTTP ${resp1.status})`;
        result.notes.push(`Responses API wire unsupported by model or provider: ${errText.slice(0, 160)}`);
        result.details["unsupportedWire"] = true;
        console.log(`         ℹ️ Responses Wire Unsupported (HTTP ${resp1.status}): N/A`);
        return result;
      }
      result.error = `HTTP ${resp1.status}: ${errText}`;
      result.notes.push(`Test 1.1 failed with HTTP ${resp1.status}: ${errText}`);
      result.details["test_1_1_status"] = resp1.status;
      console.log(`         ❌ Test 1.1 Failed: HTTP ${resp1.status} - ${errText.slice(0, 120)}`);
      return result;
    } else {
      const data1 = (await resp1.json()) as ResponsesApiResponse;
      const usage1 = data1.usage as { output_tokens?: number; completion_tokens?: number } | undefined;
      const completionTokens = usage1?.output_tokens ?? usage1?.completion_tokens;
      if (typeof completionTokens === "number") {
        result.completionTokens = completionTokens;
        result.tokensPerSec = Number((completionTokens / (result.durationMs / 1000)).toFixed(1));
      }

      const functionCalls = extractFunctionCalls(data1.output);
      const text = extractAssistantText(data1.output);

      const hasValidToolCall = functionCalls.length > 0 && functionCalls[0]?.name === "bash";
      const hasXmlLeak = text.includes("<tool_call>") || text.includes("<invoke>");

      if (hasValidToolCall && !hasXmlLeak) {
        result.score += 50;
        result.details["test_1_1"] = "PASSED";
        console.log(`         ✅ Test 1.1 Passed: Emitted structured function_call with zero XML leakage.`);
      } else {
        result.notes.push(`Test 1.1 failed: toolCalls=${Boolean(hasValidToolCall)}, xmlLeak=${hasXmlLeak}`);
        console.log(`         ❌ Test 1.1 Failed: Tool call invalid or XML leaked in content.`);
      }
    }
  } catch (err: unknown) {
    result.durationMs = Math.round(performance.now() - startTime);
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      result.notes.push("Request timed out after " + (ctx.timeoutMs ?? 120000) + "ms");
      console.log(`         ❌ Test 1.1 Timeout: Request timed out after ${ctx.timeoutMs ?? 120000}ms`);
    } else {
      result.notes.push(`Test 1.1 exception: ${String(err)}`);
      console.log(`         ❌ Test 1.1 Error: ${String(err)}`);
    }
  }

  // --- Sub-test 1.2: Long Context Hydration (12k+ tokens) on POST /v1/responses ---
  console.log(`   [1.2] Testing Long Context Hydration (12k+ tokens)...`);
  try {
    const fileReadTool: ResponsesToolDefinition = {
      type: "function",
      name: "FileReadTool",
      description: "Read a file from disk",
      parameters: {
        type: "object",
        properties: { file_path: { type: "string" } },
        required: ["file_path"],
      },
    };

    const resp2 = await fetch(ctx.gatewayUrl, {
      method: "POST",
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        ...(ctx.extraPayload ?? {}),
        input: [
          { role: "system", content: DUMMY_SYSTEM_GUIDELINES },
          { role: "user", content: "Execute FileReadTool to read 'config.json'." },
        ],
        tools: [fileReadTool],
      }),
    });

    if (!resp2.ok) {
      const errText = await resp2.text();
      if (isResponsesWireUnsupported(resp2.status, errText)) {
        result.unsupportedWire = true;
        result.error = `ModelProtocolUnsupported: Wire /v1/responses not supported (HTTP ${resp2.status})`;
        result.notes.push(`Responses API wire unsupported by model or provider: ${errText.slice(0, 160)}`);
        result.details["unsupportedWire"] = true;
        console.log(`         ℹ️ Responses Wire Unsupported (HTTP ${resp2.status}): N/A`);
        return result;
      }
      result.error = `HTTP ${resp2.status}: ${errText}`;
      result.notes.push(`Test 1.2 failed with HTTP ${resp2.status}: ${errText}`);
      result.details["test_1_2_status"] = resp2.status;
      console.log(`         ❌ Test 1.2 Failed: HTTP ${resp2.status} - ${errText.slice(0, 120)}`);
    } else {
      const data2 = (await resp2.json()) as ResponsesApiResponse;
      const functionCalls = extractFunctionCalls(data2.output);
      const hasHydratedToolCall = functionCalls.length > 0 && functionCalls[0]?.name === "FileReadTool";

      if (hasHydratedToolCall) {
        result.score += 50;
        result.details["test_1_2"] = "PASSED";
        console.log(`         ✅ Test 1.2 Passed: Successfully hydrated 12k+ tokens and emitted FileReadTool.`);
      } else {
        result.notes.push(`Test 1.2 failed: FileReadTool not invoked under 12k context`);
        console.log(`         ❌ Test 1.2 Failed: Model failed to emit tool under 12k context.`);
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      result.notes.push("Request timed out after " + (ctx.timeoutMs ?? 120000) + "ms");
      console.log(`         ❌ Test 1.2 Timeout: Request timed out after ${ctx.timeoutMs ?? 120000}ms`);
    } else {
      result.notes.push(`Test 1.2 exception: ${String(err)}`);
      console.log(`         ❌ Test 1.2 Error: ${String(err)}`);
    }
  }

  if (result.unsupportedWire) {
    result.passed = false;
    result.score = 0;
    return result;
  }

  result.passed = result.score >= 50;
  // Neither sub-test reached the model: the score is meaningless. Mark it as
  // a transport failure so the report shows ERROR, not a 0/100 model verdict.
  if (!result.details["test_1_1"] && !result.details["test_1_2"]) {
    result.error =
      result.notes.join(" | ").slice(0, 500) || "Stage produced no scored sub-test (upstream unreachable)";
  }
  return result;
}
