/**
 * eval/stages/stage3_agentic.ts
 *
 * Stage 3: Dynamic State & Agentic Loop Durability + Latency Benchmark
 * Tests:
 *   3.1 Multi-turn tool execution & observation ingestion
 *   3.2 Error recovery under tool failure (EACCES / permission denied)
 *   3.3 TTFT and streaming speed benchmark
 */

import type { StageContext, StageResult } from "./types";
import { appendReasoningTranscript, collectReasoningTranscript } from "./types";

const TOOL_PALETTE = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Reads the content of a file from disk",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "bash",
      description: "Runs a terminal bash command",
      parameters: {
        type: "object",
        properties: { command: { type: "string" } },
        required: ["command"],
      },
    },
  },
];

export async function runStage3Agentic(ctx: StageContext): Promise<StageResult> {
  const result: StageResult = {
    stageName: "Stage 3: Dynamic State, Agentic Loop & Speed",
    passed: false,
    score: 0,
    details: {},
    notes: [],
  };

  console.log(`\n========================================================================`);
  console.log(`🔄 STAGE 3: AGENTIC LOOP & STREAMING LATENCY`);
  console.log(`========================================================================`);

  // --- Sub-test 3.1: Multi-turn dependency chain ---
  console.log(`   [3.1] Testing 3-Turn Stateful Tool Observation Loop...`);
  const turn1Messages = [
    { role: "user", content: "Inspect /etc/hosts to check DNS loopback definitions." },
  ];

  let toolCallId = "call_test_01";
  let toolArgs = "";
  let completionTokens = 0;

  const startTime = performance.now();
  try {
    let ttftMs = 0;

    const resp1 = await fetch(ctx.gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: true,
        tools: TOOL_PALETTE,
        messages: turn1Messages,
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
    });

    if (!resp1.ok || !resp1.body) {
      result.notes.push(`Stage 3 Turn 1 failed with HTTP ${resp1.status}`);
      console.log(`         ❌ Turn 1 Failed: HTTP ${resp1.status}`);
      result.durationMs = Math.round(performance.now() - startTime);
      return result;
    }

    const reader = resp1.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";
    let selectedTool = "";
    let turn1Reasoning = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ") || trimmed === "data: [DONE]") continue;
        try {
          const json = JSON.parse(trimmed.slice(6));
          const delta = json.choices?.[0]?.delta;
          if (ttftMs === 0 && (delta?.content || delta?.tool_calls || delta?.reasoning_content)) {
            ttftMs = Math.round(performance.now() - startTime);
          }
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.id) toolCallId = tc.id;
              if (tc.function?.name) selectedTool += tc.function.name;
              if (tc.function?.arguments) toolArgs += tc.function.arguments;
            }
          }
          if (typeof delta?.reasoning_content === "string") {
            turn1Reasoning += delta.reasoning_content;
          }
          const streamUsage = (json as Record<string, unknown>).usage as { completion_tokens?: number } | undefined;
          if (typeof streamUsage?.completion_tokens === "number") {
            completionTokens += streamUsage.completion_tokens;
          }
        } catch (parseErr) {
          result.notes.push(`Failed to parse arguments JSON: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
        }
      }
    }

    result.details["ttft_ms"] = ttftMs;
    appendReasoningTranscript(result, turn1Reasoning);
    console.log(`         ⚡ Turn 1 TTFT: ${ttftMs}ms | Selected: ${selectedTool}`);

    if (selectedTool === "read_file") {
      result.score += 25;
      console.log(`         ✅ Turn 1 Passed: Selected 'read_file' correctly.`);
    } else {
      result.notes.push(`Turn 1 selected unexpected tool: ${selectedTool}`);
    }

    // --- Sub-test 3.2: Turn 2 Observation Feed ---
    console.log(`   [3.2] Testing Turn 2 Observation Ingestion...`);
    const turn2Messages = [
      ...turn1Messages,
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: toolCallId,
            type: "function",
            function: { name: "read_file", arguments: toolArgs || '{"path":"/etc/hosts"}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: toolCallId,
        content: "127.0.0.1 localhost\n::1 localhost ip6-localhost",
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
        tools: TOOL_PALETTE,
        messages: turn2Messages,
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
    });

    if (resp2.ok) {
      const data2 = (await resp2.json()) as Record<string, unknown>;
      collectReasoningTranscript(result, data2);
      const usage2 = data2.usage as { completion_tokens?: number } | undefined;
      if (typeof usage2?.completion_tokens === "number") {
        completionTokens += usage2.completion_tokens;
      }
      const content = ((data2.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>)?.content as string || "";
      if (content.toLowerCase().includes("127.0.0.1") || content.toLowerCase().includes("localhost")) {
        result.score += 25;
        console.log(`         ✅ Turn 2 Passed: Observation synthesized into final response.`);
      }
    }

    // --- Sub-test 3.3: Turn 3 Error Injection ---
    console.log(`   [3.3] Testing Turn 3 Error Recovery (EACCES Permission Denied)...`);
    const turn3Messages = [
      ...turn2Messages,
      {
        role: "user",
        content: "Now read /root/secret.key",
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_err_01",
            type: "function",
            function: { name: "read_file", arguments: '{"path":"/root/secret.key"}' },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_err_01",
        content: "Error: EACCES: permission denied, open '/root/secret.key'",
      },
    ];

    const resp3 = await fetch(ctx.gatewayUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: false,
        tools: TOOL_PALETTE,
        messages: turn3Messages,
      }),
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
    });

    if (resp3.ok) {
      const data3 = (await resp3.json()) as Record<string, unknown>;
      collectReasoningTranscript(result, data3);
      const usage3 = data3.usage as { completion_tokens?: number } | undefined;
      if (typeof usage3?.completion_tokens === "number") {
        completionTokens += usage3.completion_tokens;
      }
      const content3 = (((data3.choices as Array<Record<string, unknown>>)?.[0]?.message as Record<string, unknown>)?.content as string || "").toLowerCase();
      if (content3.includes("permission") || content3.includes("denied") || content3.includes("unable") || content3.includes("cannot access")) {
        result.score += 50;
        console.log(`         ✅ Turn 3 Passed: Successfully acknowledged and handled permission error.`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "TimeoutError") {
      result.notes.push(`Request timed out after ${ctx.timeoutMs ?? 120000}ms`);
    } else {
      result.notes.push(`Stage 3 exception: ${String(err)}`);
    }
  }

  result.durationMs = Math.round(performance.now() - startTime);
  if (completionTokens > 0) {
    result.completionTokens = completionTokens;
    const durSec = result.durationMs > 0 ? result.durationMs / 1000 : 0.001;
    result.tokensPerSec = Number((completionTokens / durSec).toFixed(1));
  }

  result.passed = result.score >= 50;
  return result;
}
