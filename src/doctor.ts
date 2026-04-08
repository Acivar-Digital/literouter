#!/usr/bin/env bun
/**
 * src/doctor.ts — Self-test for LiteRouter: validates config, provider keys, and server health.
 *
 * Usage: bun doctor
 */

import { getConfig } from "./config.js";
import { runPreflightTest } from "./test.js";
import { existsSync } from "fs";
import { join } from "path";

// ─── ANSI Colors ──────────────────────────────────────────────────────────────
const R = "\x1b[0m";
const bold = "\x1b[1m";
const dim = "\x1b[2m";
const green = "\x1b[32m";
const red = "\x1b[31m";
const yellow = "\x1b[33m";
const cyan = "\x1b[36m";
const white = "\x1b[97m";

async function main() {
  console.log(`\n${cyan}${bold}  LITEROUTER DOCTOR${R}\n`);

  // 1. Check config exists
  const configPath = join(process.cwd(), "config.json");
  if (!existsSync(configPath)) {
    console.log(`  ${red}✗${R} No config found at ${configPath}`);
    console.log(`  ${dim}Create config.json based on config.example.json.${R}\n`);
    process.exit(1);
  }

  const config = getConfig();

  // 2. Configuration Summary
  console.log(`  ${dim}Config:${R} ${configPath}`);
  console.log(`  ${dim}Provider keys:${R} ${config.apiKeys.length}`);
  console.log(`  ${dim}Models loaded:${R} ${Object.keys(config.models).join(", ")}`);
  console.log(`  ${dim}Auth key:${R} ${config.authKey ? "set" : "not set"}\n`);

  // 3. Provider Validation via preflight
  console.log(`  ${bold}${white}PROVIDER VALIDATION:${R}\n`);
  const testStats = await runPreflightTest(false);

  for (const result of testStats.testResults) {
    if (result.status === 'healthy') {
      console.log(`  ${green}✓${R} ${bold}${result.key}${R} ${green}healthy${R} ${dim}${result.latencyMs}ms${R}`);
    } else if (result.status === 'rate-limited') {
      console.log(`  ${yellow}⚡${R} ${bold}${result.key}${R} ${yellow}valid (rate limited)${R} ${dim}${result.latencyMs}ms${R}`);
    } else {
      console.log(`  ${red}✗${R} ${bold}${result.key}${R} ${red}${result.error}${R} ${dim}${result.latencyMs}ms${R}`);
    }
  }
  console.log("");

  // 4. Test Server
  console.log(`  ${bold}${white}SERVER STATUS:${R}\n`);
  const serverUrl = `http://${config.host}:${config.port}`;
  
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const res = await fetch(`${serverUrl}/health`, { signal: controller.signal });
    clearTimeout(timeout);

    if (res.ok) {
      console.log(`  ${green}✓${R} Server is running on ${serverUrl}`);

      // Try a basic completion request through the local router
      try {
        const testController = new AbortController();
        const testTimeout = setTimeout(() => testController.abort(), 10000);
        
        const headers: Record<string, string> = { "Content-Type": "application/json" };
        if (config.authKey) {
            headers["Authorization"] = `Bearer ${config.authKey}`;
        }

        // We use the first loaded model alias, or fall back to generic code
        const firstModelAlias = Object.keys(config.models)[0] || "code";

        const testRes = await fetch(`${serverUrl}/v1/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: firstModelAlias,
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1
          }),
          signal: testController.signal
        });
        clearTimeout(testTimeout);

        if (testRes.ok) {
          console.log(`  ${green}✓${R} Local routing completion succeeded`);
        } else {
          const errBody = await testRes.text();
          console.log(`  ${red}✗${R} Local routing failed: HTTP ${testRes.status} ${errBody.slice(0, 100)}`);
        }
      } catch (err) {
        console.log(`  ${yellow}⚠${R} Local routing failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      console.log(`  ${red}✗${R} Server health check returned HTTP ${res.status}`);
    }
  } catch {
    console.log(`  ${yellow}⚠${R} Server not running. Start with: ${bold}bun start${R}`);
  }

  // 5. Summary
  console.log(`\n${cyan}${"─".repeat(50)}${R}`);
  console.log(`  ${bold}${testStats.healthy}/${config.apiKeys.length}${R} providers healthy.${testStats.failed > 0 ? ` ${red}${testStats.failed} failed.${R}` : ""}`);
  console.log(`${cyan}${"─".repeat(50)}${R}\n`);
}

main().catch(console.error);
