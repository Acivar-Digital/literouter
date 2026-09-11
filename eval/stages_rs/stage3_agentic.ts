/**
 * eval/stages_rs/stage3_agentic.ts
 *
 * Stage 3: Responses API Dynamic State, Agentic Loop Durability & Streaming TTFT
 * Tests:
 *   3.1 Streaming invocation, TTFT measurement & tool selection (read_file)
 *   3.2 Multi-turn observation ingestion via function_call_output in input array
 *   3.3 Error recovery under tool failure (EACCES permission denied)
 */

import {
  extractAssistantText,
  type ResponsesApiResponse,
  type ResponsesToolDefinition,
  type StageContext,
  type StageResult,
} from "./types";

const TOOL_PALETTE: ResponsesToolDefinition[] = [
  {
    type: "function",
    name: "read_file",
    description: "Reads the content of a file from disk",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    type: "function",
    name: "bash",
    description: "Runs a terminal bash command",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
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
  console.log(`🔄 STAGE 3: RESPONSES API AGENTIC LOOP & STREAMING LATENCY`);
  console.log(`========================================================================`);

  // --- Sub-test 3.1: Turn 1 Streaming & Tool Selection ---
  console.log(`   [3.1] Testing Responses API Streaming & Tool Selection...`);
  const turn1Input = [
    { role: "user", content: "Inspect /etc/hosts to check DNS loopback definitions." },
  ];

  let toolCallId = "call_test_01";
  let toolArgs = "";
  let selectedTool = "";

  try {
    const start = performance.now();
    let ttftMs = 0;

    const resp1 = await fetch(ctx.gatewayUrl, {
      method: "POST",
      signal: AbortSignal.timeout(ctx.timeoutMs ?? 120000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ctx.directiveKey}`,
      },
      body: JSON.stringify({
        model: ctx.model,
        stream: true,
        tools: TOOL_PALETTE,
        input: turn1Input,
      }),
    });

    if (!resp1.ok || !resp1.body) {
      result.notes.push(`Stage 3 Turn 1 failed with HTTP ${resp1.status}`);
      console.log(`         ❌ Turn 1 Failed: HTTP ${resp1.status}`);
      return result;
    }

    const reader = resp1.body.getReader();
    const decoder = new TextDecoder();
    let lineBuffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      lineBuffer += decoder.decode(value, { stream: true });
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data: ")) continue;
        const payloadStr = trimmed.slice(6).trim();
        if (payloadStr === "[DONE]") continue;

        try {
          const eventObj = JSON.parse(payloadStr);
          const type = eventObj.type as string | undefined;

          // Record TTFT on first substantive delta or added item
          if (ttftMs === 0 && (type === "response.output_text.delta" || type === "response.output_item.added" || type === "response.in_progress")) {
            ttftMs = Math.round(performance.now() - start);
          }

          // In Responses API SSE, output_item.added / output_item.done carries function_call
          if (eventObj.item && eventObj.item.type === "function_call") {
            const item = eventObj.item;
            if (item.call_id) toolCallId = item.call_id;
            if (item.name) selectedTool = item.name;
            if (item.arguments) toolArgs = item.arguments;
          }

          // Arguments deltas
          if (type === "response.function_call_arguments.delta" && eventObj.delta) {
            toolArgs += eventObj.delta;
          }

          // Completed response snapshot fallback
          if (type === "response.completed" && eventObj.response?.output) {
            for (const outItem of eventObj.response.output) {
              if (outItem.type === "function_call") {
                selectedTool = outItem.name;
                toolCallId = outItem.call_id || outItem.id || toolCallId;
                if (outItem.arguments) toolArgs = outItem.arguments;
              }
            }
          }
        } catch (parseErr) {
          result.notes.push(`Stage 3 SSE chunk parse warning: ${String(parseErr)}`);
        }
      }
    }

    result.details["ttft_ms"] = ttftMs;
    console.log(`         ⚡ Turn 1 TTFT: ${ttftMs}ms | Selected: ${selectedTool}`);

    if (selectedTool === "read_file") {
      result.score += 25;
      console.log(`         ✅ Turn 1 Passed: Selected 'read_file' correctly.`);
    } else {
      result.notes.push(`Turn 1 selected unexpected tool: ${selectedTool}`);
      console.log(`         ⚠️ Turn 1 Note: Selected tool was '${selectedTool}'`);
    }

    // --- Sub-test 3.2: Turn 2 Observation Ingestion via function_call_output ---
    console.log(`   [3.2] Testing Turn 2 Observation Ingestion...`);
    const turn2Input = [
      ...turn1Input,
      {
        type: "function_call",
        call_id: toolCallId,
        name: "read_file",
        arguments: toolArgs || '{"path":"/etc/hosts"}',
      },
      {
        type: "function_call_output",
        call_id: toolCallId,
        output: "127.0.0.1 localhost\n::1 localhost ip6-localhost",
      },
    ];

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
        tools: TOOL_PALETTE,
        input: turn2Input,
      }),
    });

    if (resp2.ok) {
      const data2 = (await resp2.json()) as ResponsesApiResponse;
      const content = extractAssistantText(data2.output).toLowerCase();
      if (content.includes("127.0.0.1") || content.includes("localhost")) {
        result.score += 25;
        console.log(`         ✅ Turn 2 Passed: Observation synthesized into final response.`);
      } else {
        result.notes.push("Turn 2 failed to include observation content");
        console.log(`         ❌ Turn 2 Failed: Output did not reflect hosts content.`);
      }
    } else {
      result.notes.push(`Turn 2 failed with HTTP ${resp2.status}`);
      console.log(`         ❌ Turn 2 Failed: HTTP ${resp2.status}`);
    }

    // --- Sub-test 3.3: Turn 3 Error Recovery (EACCES Permission Denied) ---
    console.log(`   [3.3] Testing Turn 3 Error Recovery (EACCES Permission Denied)...`);
    const turn3Input = [
      ...turn2Input,
      {
        role: "user",
        content: "Now read /root/secret.key",
      },
      {
        type: "function_call",
        call_id: "call_err_01",
        name: "read_file",
        arguments: '{"path":"/root/secret.key"}',
      },
      {
        type: "function_call_output",
        call_id: "call_err_01",
        output: "Error: EACCES: permission denied, open '/root/secret.key'",
      },
    ];

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
        tools: TOOL_PALETTE,
        input: turn3Input,
      }),
    });

    if (resp3.ok) {
      const data3 = (await resp3.json()) as ResponsesApiResponse;
      const content3 = extractAssistantText(data3.output).toLowerCase();
      if (
        content3.includes("permission") ||
        content3.includes("denied") ||
        content3.includes("unable") ||
        content3.includes("cannot access") ||
        content3.includes("eacces")
      ) {
        result.score += 50;
        console.log(`         ✅ Turn 3 Passed: Successfully acknowledged and handled permission error.`);
      } else {
        result.notes.push("Turn 3 failed to recognize permission error");
        console.log(`         ❌ Turn 3 Failed: Error not acknowledged.`);
      }
    } else {
      result.notes.push(`Turn 3 failed with HTTP ${resp3.status}`);
      console.log(`         ❌ Turn 3 Failed: HTTP ${resp3.status}`);
    }
  } catch (err: unknown) {
    if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
      result.notes.push("Request timed out after " + (ctx.timeoutMs ?? 120000) + "ms");
      console.log(`         ❌ Stage 3 Timeout: Request timed out after ${ctx.timeoutMs ?? 120000}ms`);
    } else {
      result.notes.push(`Stage 3 exception: ${String(err)}`);
      console.log(`         ❌ Stage 3 Error: ${String(err)}`);
    }
  }

  result.passed = result.score >= 50;
  return result;
}
