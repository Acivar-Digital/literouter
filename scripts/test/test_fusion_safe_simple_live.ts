import { readFileSync } from "fs";
import { resolve } from "path";

// Read location config to get gateway host and port
const loc = JSON.parse(readFileSync(resolve(process.cwd(), "config/location.json"), "utf-8"));
const host = loc.host || "10.32.34.172";
const port = loc.port || 7766;
const gatewayUrl = `http://${host}:${port}/v1/chat/completions`;

// Read LITEROUTER_AUTH_KEY from .env or .env.local if needed
function getAuthKey(): string {
  try {
    const envLocal = readFileSync(resolve(process.cwd(), ".env.local"), "utf-8");
    const m = envLocal.match(/LITEROUTER_AUTH_KEY=([^\r\n]+)/);
    if (m && m[1]) return m[1].trim();
  } catch {}
  return "test-key";
}

const authKey = getAuthKey();

async function testFusionPreset(presetName: string, modelName: string) {
  console.log(`\n================================================================================`);
  console.log(` PROBING LIVE GATEWAY: Preset '${presetName}' -> Model '${modelName}'`);
  console.log(` Target: ${gatewayUrl}`);
  console.log(` Simulated Client Payload: temperature=0.9, reasoning_effort="high"`);
  console.log(`================================================================================`);

  const payload = {
    model: modelName,
    messages: [
      {
        role: "user",
        content: "What is 12 + 13? Reply with just the number.",
      },
    ],
    temperature: 0.9,
    reasoning_effort: "high",
    max_tokens: 150,
  };

  const start = performance.now();
  const res = await fetch(gatewayUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer lr-fse-${presetName}`,
      "x-literouter-key": authKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const duration = Math.round(performance.now() - start);

  if (!res.ok) {
    console.error(`❌ HTTP ${res.status}:`, await res.text());
    return false;
  }

  const json = (await res.json()) as any;
  const choice = json.choices?.[0];
  const msg = choice?.message;
  const content = msg?.content ?? "";
  const reasoning = msg?.reasoning ?? msg?.reasoning_content;
  const hasThinkTag = content.includes("<think>");
  const reasoningTokens = json.usage?.completion_tokens_details?.reasoning_tokens ?? 0;

  console.log(`✅ Status: HTTP ${res.status} OK in ${duration}ms`);
  console.log(`   - Model returned: ${json.model}`);
  console.log(`   - Content: "${content.trim()}"`);
  console.log(`   - message.reasoning returned: ${reasoning !== undefined}`);
  console.log(`   - <think> in content: ${hasThinkTag}`);
  console.log(`   - reasoning_tokens billed: ${reasoningTokens}`);
  console.log(`   - total_tokens: ${json.usage?.total_tokens}`);

  const passed = res.status === 200 && content.length > 0 && !hasThinkTag && reasoning === undefined;
  console.log(`>>> VERIFICATION: ${passed ? "PASS (Settings strictly enforced, zero reasoning leaked)" : "FAIL"}`);
  return passed;
}

async function main() {
  const test1 = await testFusionPreset("simple", "simple");
  await new Promise((r) => setTimeout(r, 800));
  const test2 = await testFusionPreset("safe", "safe");

  console.log("\n================================================================================");
  console.log(`FINAL RESULT: ${test1 && test2 ? "ALL FUSION PRESETS WORKING CORRECTLY" : "FAILURE DETECTED"}`);
  console.log("================================================================================\n");

  if (!test1 || !test2) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal test error:", err);
  process.exit(1);
});
