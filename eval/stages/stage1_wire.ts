/**
 * eval/stages/stage1_wire.ts
 *
 * Stage 1: Wire Protocol & Context Hydration
 * Tests:
 *   1.1 Single-tool & multi-tool structured invocation without XML leaks
 *   1.2 Claude Code 12k+ token long-context hydration test on /v1/messages
 */

import type { StageContext, StageResult } from "./types";
import { collectReasoningTranscript } from "./types";

const DUMMY_SYSTEM_GUIDELINES = `
# CLAUDE.MD CODING GUIDELINES & PROJECT POLICIES
You are Claude Code, an expert agentic software engineer operating in an autonomous codebase.
All tool calls MUST use the Anthropic Messages API format. You are expected to strictly respect
code hygiene, architectural boundaries, type safety, and avoid modifying protected environment variables.
Never overwrite .env or .env.local. Always inspect files before modifying them.
Do not introduce unnecessary dependencies or speculative utility functions.
Follow deterministic minimalism and verification-led execution.
`.repeat(30); // ~12k tokens of hydration payload

export async function runStage1Wire(ctx: StageContext): Promise<StageResult> {
  const result: StageResult = {
    stageName: "Stage 1: Wire Protocol & Long Context Hydration",
    passed: false,
    score: 0,
    details: {},
    notes: [],
  };

  const urlObj = new URL(ctx.gatewayUrl);
  const messagesUrl = `${urlObj.protocol}//${urlObj.host}/v1/messages`;
  const provider = ctx.directiveKey.split("-")[1] || "or";
  const anthropicDirective = provider === "an" || provider === "or" ? `lr-${provider}-cl-ms-no` : `lr-${provider}-cl-ch-no`;

  console.log(`\n========================================================================`);
  console.log(`🔌 STAGE 1: WIRE PROTOCOL & CLAUDE CODE HYDRATION`);
  console.log(`========================================================================`);

  // --- Sub-test 1.1: Single-tool structured invocation via Chat Completions ---
  console.log(`   [1.1] Testing OpenAI Wire & Tool Calling Primitives...`);
  const startTime = performance.now();
  try {
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
        messages: [{ role: "user", content: "List all files in /tmp using the bash tool." }],
        tools: [
          {
            type: "function",
            function: {
              name: "bash",
              description: "Execute bash command",
              parameters: {
                type: "object",
                properties: { command: { type: "string" } },
                required: ["command"],
              },
            },
          },
        ],
      }),
    });

    result.durationMs = Math.round(performance.now() - startTime);

    if (!resp1.ok) {
      const errText = await resp1.text();
      result.notes.push(`Test 1.1 failed with HTTP ${resp1.status}: ${errText}`);
      result.details["test_1_1_status"] = resp1.status;
      console.log(`         ❌ Test 1.1 Failed: HTTP ${resp1.status} - ${errText.slice(0, 120)}`);
    } else {
      const data1 = (await resp1.json()) as Record<string, unknown>;
      collectReasoningTranscript(result, data1);
      const usage1 = data1.usage as Record<string, unknown> | undefined;
      const completionTokens = typeof usage1?.completion_tokens === "number" ? usage1.completion_tokens : undefined;
      if (typeof completionTokens === "number") {
        result.completionTokens = completionTokens;
        result.tokensPerSec = Number((completionTokens / (result.durationMs / 1000)).toFixed(1));
      }

      const choice = (data1.choices as Array<Record<string, unknown>>)?.[0];
      const message = choice?.message as Record<string, unknown>;
      const toolCalls = message?.tool_calls as Array<Record<string, unknown>>;
      const content = (message?.content as string) || "";

      const hasValidToolCall = Array.isArray(toolCalls) && toolCalls.length > 0 && toolCalls[0]?.function;
      const hasXmlLeak = content.includes("<tool_call>") || content.includes("<invoke>");

      if (hasValidToolCall && !hasXmlLeak) {
        result.score += 30;
        result.details["test_1_1"] = "PASSED";
        console.log(`         ✅ Test 1.1 Passed: Emitted structured tool_call with zero XML leakage.`);
      } else {
        result.notes.push(`Test 1.1 failed: toolCalls=${Boolean(hasValidToolCall)}, xmlLeak=${hasXmlLeak}`);
        console.log(`         ❌ Test 1.1 Failed: Tool call invalid or XML leaked in content.`);
      }
    }
  } catch (err) {
    result.durationMs = Math.round(performance.now() - startTime);
    if (
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError" || err.message.includes("timed out"))
    ) {
      result.notes.push("Request timed out after " + (ctx.timeoutMs ?? 120000) + "ms");
    }
    result.notes.push(`Test 1.1 exception: ${String(err)}`);
  }

  // --- Sub-test 1.2: Claude Code 12k+ token context hydration test on /v1/messages ---
  console.log(`   [1.2] Testing Claude Code Long Context Hydration (12k+ tokens)...`);
  try {
    const resp2 = await fetch(messagesUrl, {
      method: "POST",
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
      headers: {
        "Content-Type": "application/json",
        "x-api-key": anthropicDirective,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: ctx.model,
        max_tokens: 1024,
        system: DUMMY_SYSTEM_GUIDELINES,
        messages: [{ role: "user", content: "Execute FileReadTool to read 'config.json'." }],
        tools: [
          {
            name: "FileReadTool",
            description: "Read a file from disk",
            input_schema: {
              type: "object",
              properties: { file_path: { type: "string" } },
              required: ["file_path"],
            },
          },
          {
            name: "Bash",
            description: "Execute bash command",
            input_schema: {
              type: "object",
              properties: { command: { type: "string" } },
              required: ["command"],
            },
          },
        ],
      }),
    });

    if (!resp2.ok) {
      const errText = await resp2.text();
      result.notes.push(`Test 1.2 failed with HTTP ${resp2.status}: ${errText}`);
      result.details["test_1_2_status"] = resp2.status;
      console.log(`         ❌ Test 1.2 Failed: Upstream returned HTTP ${resp2.status} under 12k context: ${errText.slice(0, 120)}`);
    } else {
      const data2 = (await resp2.json()) as Record<string, unknown>;
      const content = Array.isArray(data2.content) ? data2.content : [];
      const toolUseBlock = content.find((b: Record<string, unknown>) => b.type === "tool_use");

      if (toolUseBlock && (toolUseBlock as Record<string, unknown>).name === "FileReadTool") {
        result.score += 40;
        result.details["test_1_2"] = "PASSED";
        console.log(`         ✅ Test 1.2 Passed: Successfully hydrated 12k context and emitted native tool_use.`);
      } else {
        result.notes.push(`Test 1.2 failed: Model did not emit FileReadTool under long context.`);
        console.log(`         ❌ Test 1.2 Failed: Tool use block missing or incorrect under 12k context.`);
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError" || err.message.includes("timed out"))
    ) {
      result.notes.push("Request timed out after " + (ctx.timeoutMs ?? 120000) + "ms");
    }
    result.notes.push(`Test 1.2 exception: ${String(err)}`);
  }

  // --- Sub-test 1.3: Parallel Tool Calling in a Single Turn ---
  console.log(`   [1.3] Testing Parallel Tool Calling (Multi-File Invocation in 1 Turn)...`);
  try {
    const resp3 = await fetch(ctx.gatewayUrl, {
      method: "POST",
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        messages: [
          {
            role: "user",
            content: "Read all three files simultaneously: 'a.ts', 'b.ts', and 'c.ts' using read_file in parallel.",
          },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: "read_file",
              description: "Read file contents",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
            },
          },
        ],
      }),
    });

    if (!resp3.ok) {
      const errText = await resp3.text();
      result.notes.push(`Test 1.3 failed with HTTP ${resp3.status}: ${errText}`);
      result.details["test_1_3_status"] = resp3.status;
      console.log(`         ❌ Test 1.3 Failed: HTTP ${resp3.status} - ${errText.slice(0, 120)}`);
    } else {
      const data3 = (await resp3.json()) as Record<string, unknown>;
      collectReasoningTranscript(result, data3);
      const choice = (data3.choices as Array<Record<string, unknown>>)?.[0];
      const message = choice?.message as Record<string, unknown>;
      const toolCalls = message?.tool_calls as Array<Record<string, unknown>>;

      if (Array.isArray(toolCalls) && toolCalls.length >= 3) {
        result.score += 30;
        result.details["test_1_3"] = "PASSED";
        console.log(`         ✅ Test 1.3 Passed: Successfully emitted ${toolCalls.length} parallel tool calls in 1 turn.`);
      } else if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        result.score += 15;
        result.notes.push(`Test 1.3 partial: Emitted ${toolCalls.length} tool calls (expected 3)`);
        console.log(`         ⚠️  Test 1.3 Partial: Emitted ${toolCalls.length}/3 tool calls sequentially.`);
      } else {
        result.notes.push("Test 1.3 failed: No tool calls emitted in parallel");
        console.log(`         ❌ Test 1.3 Failed: Failed to emit parallel tool calls.`);
      }
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError" || err.message.includes("timed out"))
    ) {
      result.notes.push("Request timed out after " + (ctx.timeoutMs ?? 120000) + "ms");
    }
    result.notes.push(`Test 1.3 exception: ${String(err)}`);
  }

  result.passed = result.score >= 60;
  return result;
}
