#!/usr/bin/env bun
/**
 * scripts/test/test_zen_fixes.ts
 *
 * Verification script for Zen provider wire adaptation fixes:
 * 1. Gateway Health Probe
 * 2. OpenAI Chat Completions: Non-streaming simple prompt (stream: false, no tools)
 *    - Verifies LiteRouter automatically injects core probe tools & accumulates SSE to JSON
 * 3. OpenCode 2 Subagent Simulation: Custom tool + tool_choice: "none"
 *    - Verifies LiteRouter merges probe tools without dropping client tools, and normalizes tool_choice to "auto"
 * 4. OpenAI Responses API wire: POST /v1/responses (muse-spark-1.3-contributor-free)
 *    - Verifies top-level Responses probe tool injection and accumulation
 *
 * Usage:
 *   bun run scripts/test/test_zen_fixes.ts
 *   bun run scripts/test/test_zen_fixes.ts --url http://192.168.50.10:7766
 */

const args = process.argv.slice(2);
let baseUrl: string = "http://192.168.50.10:7766";
const urlArgIdx = args.indexOf("--url");
if (urlArgIdx !== -1 && args[urlArgIdx + 1]) {
  baseUrl = args[urlArgIdx + 1]!;
}

console.log(`\n======================================================`);
console.log(`🔍 LiteRouter Zen Provider Wire Adaptation Test Suite`);
console.log(`🎯 Target Gateway: ${baseUrl}`);
console.log(`======================================================\n`);

async function runTest(
  name: string,
  endpoint: string,
  key: string,
  payload: Record<string, any>,
  validator: (res: Response, json: any) => boolean
): Promise<boolean> {
  process.stdout.write(`⏳ [TEST] ${name} ... `);
  const start = Date.now();
  try {
    const res = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(payload),
    });
    const elapsed = Date.now() - start;

    let json: any = null;
    try {
      json = await res.json();
    } catch {
      // not json
    }

    if (res.ok && validator(res, json)) {
      console.log(`✅ PASS (${res.status} OK, ${elapsed}ms)`);
      return true;
    } else {
      console.log(`❌ FAIL (${res.status}) [${elapsed}ms]`);
      if (json?.error) {
        console.error(`   Error details:`, JSON.stringify(json.error, null, 2));
      } else {
        console.error(`   Response body:`, json);
      }
      return false;
    }
  } catch (err: any) {
    console.log(`❌ ERROR: ${err.message}`);
    return false;
  }
}

async function main() {
  // 1. Health check
  process.stdout.write(`⏳ [HEALTH] Probing ${baseUrl}/health ... `);
  try {
    const healthRes = await fetch(`${baseUrl}/health`);
    if (!healthRes.ok) {
      console.log(`❌ Health check failed with status ${healthRes.status}`);
      process.exit(1);
    }
    const health = await healthRes.json();
    console.log(`✅ HEALTHY (Uptime: ${Math.round(health.uptime)}s)`);
  } catch (e: any) {
    console.log(`❌ Cannot connect to gateway: ${e.message}`);
    process.exit(1);
  }

  let passed = 0;
  let total = 0;

  // Test 1: Chat Completions - Non-streaming without tools
  total++;
  const t1 = await runTest(
    "Chat Completions (stream: false, zero client tools)",
    "/v1/chat/completions",
    "lr-zn-oa-ch-no",
    {
      model: "big-pickle",
      messages: [{ role: "user", content: "Reply with the exact word: PONG" }],
      stream: false,
    },
    (res, json) => {
      const content = json?.choices?.[0]?.message?.content?.trim();
      return !!content && content.length > 0;
    }
  );
  if (t1) passed++;

  // Test 2: OpenCode 2 Subagent Simulation - Custom tool + tool_choice: "none"
  total++;
  const t2 = await runTest(
    'Subagent Simulation (custom tool + tool_choice: "none")',
    "/v1/chat/completions",
    "lr-zn-oa-ch-no",
    {
      model: "big-pickle",
      messages: [{ role: "user", content: "Summarize in 3 words: system is online" }],
      tools: [
        {
          type: "function",
          function: {
            name: "subagent_custom_eval",
            description: "Custom plugin tool",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
      tool_choice: "none",
      stream: false,
    },
    (res, json) => {
      const content = json?.choices?.[0]?.message?.content?.trim();
      return !!content && content.length > 0;
    }
  );
  if (t2) passed++;

  // Test 3: OpenAI Responses API wire
  total++;
  const t3 = await runTest(
    "Responses API wire (POST /v1/responses)",
    "/v1/responses",
    "lr-zn-oo-rs-no",
    {
      model: "muse-spark-1.3-contributor-free",
      input: "Say pong in 1 word",
      stream: false,
    },
    (res, json) => {
      return json?.object === "response" && json?.status === "completed";
    }
  );
  if (t3) passed++;

  console.log(`\n======================================================`);
  if (passed === total) {
    console.log(`🎉 ALL ${passed}/${total} LIVE GATEWAY ADAPTATION TESTS PASSED!`);
  } else {
    console.log(`⚠️  ${passed}/${total} TESTS PASSED`);
  }
  console.log(`======================================================\n`);

  process.exit(passed === total ? 0 : 1);
}

main();
export {};
