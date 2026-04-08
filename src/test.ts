#!/usr/bin/env bun
/**
 * src/test.ts — Preflight test for LiteRouter.
 * Checks all configured upstream API keys to ensure they are valid and reachable.
 */

import { getConfig } from "./config.js";

// ─── ANSI Colors ──────────────────────────────────────────────────────────────
const R = "\x1b[0m";
const bold = "\x1b[1m";
const dim = "\x1b[2m";
const green = "\x1b[32m";
const red = "\x1b[31m";
const yellow = "\x1b[33m";
const cyan = "\x1b[36m";

export async function runPreflightTest(logProgress = true) {
  const config = getConfig();
  
  if (logProgress) {
    console.log(`\n${cyan}${bold}  LITEROUTER PREFLIGHT TEST${R}\n`);
    console.log(`  ${dim}Base URL :${R} ${config.baseUrl}`);
    console.log(`  ${dim}Template :${R} ${config.template}`);
    console.log(`  ${dim}Testing  :${R} ${config.apiKeys.length} key(s)\n`);
  }

  if (config.apiKeys.length === 0) {
    console.log(`  ${red}✗${R} No API keys found in configuration.`);
    return { healthy: 0, failed: 0, testResults: [] };
  }

  let healthy = 0;
  let failed = 0;
  const testResults = [];

  for (let i = 0; i < config.apiKeys.length; i++) {
    const key = config.apiKeys[i];
    const keyDisplay = `Key ${i + 1} (${key.slice(0, 8)}...)`;
    
    if (logProgress) process.stdout.write(`  ${dim}Testing ${keyDisplay}...${R}`);

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`
        },
        body: JSON.stringify({
          model: config.model || "gpt-4o",
          messages: [{ role: "user", content: "hello" }],
          max_tokens: 1
        }),
        signal: controller.signal
      });
      clearTimeout(timeout);
      
      const latencyMs = Date.now() - start;

      if (res.ok) {
        healthy++;
        testResults.push({ key: keyDisplay, status: 'healthy', latencyMs });
        if (logProgress) console.log(`\r  ${green}✓${R} ${bold}${keyDisplay}${R} ${green}healthy${R} ${dim}${latencyMs}ms${R}`);
      } else if (res.status === 429) {
        healthy++; // 429 means key is valid but quota/rate limited
        testResults.push({ key: keyDisplay, status: 'rate-limited', latencyMs });
        if (logProgress) console.log(`\r  ${yellow}⚡${R} ${bold}${keyDisplay}${R} ${yellow}valid (rate limited)${R} ${dim}${latencyMs}ms${R}`);
      } else {
        failed++;
        const errorText = await res.text();
        testResults.push({ key: keyDisplay, status: 'error', error: `HTTP ${res.status}`, latencyMs });
        if (logProgress) console.log(`\r  ${red}✗${R} ${bold}${keyDisplay}${R} ${red}HTTP ${res.status}${R} ${dim}${latencyMs}ms${R} - ${errorText.slice(0, 100)}`);
      }
    } catch (err) {
      failed++;
      const latencyMs = Date.now() - start;
      const errMsg = err instanceof Error ? err.message : String(err);
      testResults.push({ key: keyDisplay, status: 'error', error: errMsg, latencyMs });
      if (logProgress) console.log(`\r  ${red}✗${R} ${bold}${keyDisplay}${R} ${red}${errMsg}${R} ${dim}${latencyMs}ms${R}`);
    }
  }

  if (logProgress) {
    console.log(`\n${cyan}${"─".repeat(50)}${R}`);
    console.log(`  ${bold}${healthy}/${config.apiKeys.length}${R} keys healthy.${failed > 0 ? ` ${red}${failed} failed.${R}` : ""}`);
    console.log(`${cyan}${"─".repeat(50)}${R}\n`);
  }

  return { healthy, failed, testResults };
}

// If run directly
if (import.meta.main) {
  runPreflightTest().catch(console.error);
}
