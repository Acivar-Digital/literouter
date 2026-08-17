import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getEnv } from "../src/config/env";
import { loadKeyPools, maskKey } from "../src/config/keys";

interface CheckItem {
  readonly label: string;
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly message: string;
}

const checks: CheckItem[] = [];

function checkFile(name: string, required: boolean): void {
  const p = resolve(process.cwd(), name);
  if (!existsSync(p)) {
    checks.push({
      label: `File: ${name}`,
      status: required ? "FAIL" : "WARN",
      message: required ? "Missing required file" : "Optional file not found",
    });
    return;
  }
  checks.push({ label: `File: ${name}`, status: "PASS", message: "Found" });
}

function validateJson(name: string): void {
  const p = resolve(process.cwd(), name);
  if (!existsSync(p)) {
    return;
  }
  try {
    JSON.parse(readFileSync(p, "utf-8"));
    checks.push({ label: `JSON Schema: ${name}`, status: "PASS", message: "Valid JSON" });
  } catch (err) {
    const detail = err instanceof Error ? err.message : "Syntax error";
    checks.push({ label: `JSON Schema: ${name}`, status: "FAIL", message: `Parse error: ${detail}` });
  }
}

function auditPoolKeys(provider: string, keys: readonly string[]): void {
  for (const k of keys) {
    if (k.includes("changeme") || k.includes("todo") || k.length < 5) {
      checks.push({
        label: `Key Pool: ${provider}`,
        status: "WARN",
        message: `Suspicious placeholder key: ${maskKey(k)}`,
      });
    }
  }
}

function checkKeyPools(): void {
  const pools = loadKeyPools(process.env);
  let totalKeys = 0;

  for (const [provider, keys] of pools.entries()) {
    totalKeys += keys.length;
    auditPoolKeys(provider, keys);
  }

  if (totalKeys === 0) {
    checks.push({
      label: "Key Pools (.env.local)",
      status: "WARN",
      message: "No active API keys found in .env.local",
    });
  } else {
    checks.push({
      label: "Key Pools (.env.local)",
      status: "PASS",
      message: `Loaded ${totalKeys} active keys across pools`,
    });
  }
}

async function pingLocalServer(): Promise<void> {
  const port = getEnv().LITEROUTER_PORT;
  try {
    const res = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1000) });
    if (res.ok) {
      checks.push({ label: `Ping Server (: ${port})`, status: "PASS", message: "Gateway is live" });
    } else {
      checks.push({ label: `Ping Server (: ${port})`, status: "WARN", message: `Returned HTTP ${res.status}` });
    }
  } catch {
    checks.push({
      label: `Ping Server (: ${port})`,
      status: "WARN",
      message: "Gateway is not currently running (FYI only)",
    });
  }
}

async function runDoctor(): Promise<void> {
  console.log("================================================================================");
  console.log("🩺 LITEROUTER DIAGNOSTIC DOCTOR [NON-BLOCKING]");
  console.log("================================================================================");

  checkFile(".env", false);
  checkFile(".env.local", false);
  checkFile("config/providers.json", true);
  checkFile("config/fusion.json", true);
  checkFile("config/models.json", true);

  validateJson("config/providers.json");
  validateJson("config/fusion.json");
  validateJson("config/models.json");

  checkKeyPools();
  await pingLocalServer();

  for (const c of checks) {
    const tag = c.status === "PASS" ? "🟢 PASS" : c.status === "WARN" ? "🟡 WARN" : "🔴 FAIL";
    console.log(`${tag.padEnd(8, " ")} | ${c.label.padEnd(30, " ")} | ${c.message}`);
  }

  const fails = checks.filter((c) => c.status === "FAIL").length;
  const warns = checks.filter((c) => c.status === "WARN").length;
  console.log("================================================================================");
  console.log(`Doctor Summary: ${checks.length - fails - warns} passed, ${warns} warnings, ${fails} failures.`);
  console.log("================================================================================");
}

if (import.meta.main) {
  runDoctor();
}
