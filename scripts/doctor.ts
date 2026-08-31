import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { getEnv } from "../src/config/env";
import { loadKeyPools, maskKey } from "../src/config/keys";
import type { ProviderCode } from "../src/config/schema";

// Inject mkcert root CA so Bun/Node fetch can verify local/proxy TLS certs
const caPath =
  process.env.SSL_CERT_FILE ||
  (process.env.HOME ? join(process.env.HOME, ".local/share/opencode2/mkcert/rootCA.pem") : "");
if (caPath && existsSync(caPath)) {
  process.env.NODE_EXTRA_CA_CERTS = caPath;
  process.env.SSL_CERT_FILE = caPath;
}

interface CheckItem {
  readonly label: string;
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly message: string;
}

interface ProbeResult {
  readonly provider: string;
  readonly maskedKey: string;
  readonly status: "PASS" | "WARN" | "FAIL";
  readonly message: string;
  readonly statusCode?: number;
}

const checks: CheckItem[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(filePath)) {
    return env;
  }
  try {
    const content = readFileSync(filePath, "utf-8");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const val = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      if (key) env[key] = val;
    }
  } catch (err) {
    void err;
  }
  return env;
}

function getCombinedEnv(): Record<string, string | undefined> {
  const envPath = resolve(process.cwd(), ".env");
  const envLocalPath = resolve(process.cwd(), ".env.local");
  const fromEnv = parseEnvFile(envPath);
  const fromEnvLocal = parseEnvFile(envLocalPath);
  return {
    ...fromEnv,
    ...fromEnvLocal,
    ...process.env,
  };
}

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

function checkKeyPools(combinedEnv: Record<string, string | undefined>): ReadonlyMap<ProviderCode, readonly string[]> {
  const pools = loadKeyPools(combinedEnv);
  let totalKeys = 0;

  for (const [provider, keys] of pools.entries()) {
    totalKeys += keys.length;
    auditPoolKeys(provider, keys);
  }

  if (totalKeys === 0) {
    checks.push({
      label: "Key Pools (.env.local)",
      status: "WARN",
      message: "No active API keys found in .env / .env.local",
    });
  } else {
    checks.push({
      label: "Key Pools (.env.local)",
      status: "PASS",
      message: `Loaded ${totalKeys} active keys across pools`,
    });
  }

  return pools;
}

async function pingLocalServer(): Promise<void> {
  const port = getEnv().LITEROUTER_PORT;
  for (const proto of ["https", "http"]) {
    try {
      const res = await fetch(`${proto}://localhost:${port}/health`, {
        signal: AbortSignal.timeout(1500),
        tls: { rejectUnauthorized: false },
      });
      if (res.ok) {
        checks.push({ label: `Ping Server (: ${port})`, status: "PASS", message: `Gateway is live (${proto.toUpperCase()})` });
        return;
      }
    } catch (err) {
      void err;
    }
  }

  checks.push({
    label: `Ping Server (: ${port})`,
    status: "WARN",
    message: "Gateway is not currently running (FYI only)",
  });
}

async function probeGoogleKey(key: string): Promise<ProbeResult> {
  const masked = maskKey(key);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${encodeURIComponent(key)}`;
  const payload = {
    contents: [{ parts: [{ text: "ping" }] }],
    generationConfig: { maxOutputTokens: 10 },
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 200) {
      return { provider: "Google Gemini", maskedKey: masked, status: "PASS", message: "200 OK (Healthy)", statusCode: 200 };
    }
    if (res.status === 401 || res.status === 403) {
      return { provider: "Google Gemini", maskedKey: masked, status: "FAIL", message: `HTTP ${res.status} Unauthorized / Forbidden`, statusCode: res.status };
    }
    if (res.status === 429) {
      return { provider: "Google Gemini", maskedKey: masked, status: "WARN", message: "HTTP 429 Rate Limited (Active)", statusCode: 429 };
    }
    return { provider: "Google Gemini", maskedKey: masked, status: "WARN", message: `HTTP ${res.status} Upstream Warning`, statusCode: res.status };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { provider: "Google Gemini", maskedKey: masked, status: "WARN", message: `Connection error: ${detail}` };
  }
}

async function probeNvidiaKey(key: string): Promise<ProbeResult> {
  const masked = maskKey(key);
  const url = "https://integrate.api.nvidia.com/v1/chat/completions";
  const payload = {
    model: "meta/llama-3.1-8b-instruct",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 10,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 200) {
      return { provider: "NVIDIA NIM", maskedKey: masked, status: "PASS", message: "200 OK (Healthy)", statusCode: 200 };
    }
    if (res.status === 401 || res.status === 403) {
      return { provider: "NVIDIA NIM", maskedKey: masked, status: "FAIL", message: `HTTP ${res.status} Unauthorized / Forbidden`, statusCode: res.status };
    }
    if (res.status === 429) {
      return { provider: "NVIDIA NIM", maskedKey: masked, status: "WARN", message: "HTTP 429 Rate Limited (Active)", statusCode: 429 };
    }
    return { provider: "NVIDIA NIM", maskedKey: masked, status: "WARN", message: `HTTP ${res.status} Upstream Warning`, statusCode: res.status };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { provider: "NVIDIA NIM", maskedKey: masked, status: "WARN", message: `Connection error: ${detail}` };
  }
}

async function probeOpenrouterKey(key: string): Promise<ProbeResult> {
  const masked = maskKey(key);
  const url = "https://openrouter.ai/api/v1/chat/completions";
  const payload = {
    model: "openrouter/free:nitro",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 10,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://literouter.local",
        "X-Title": "LiteRouter Doctor",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000),
    });

    if (res.status === 200) {
      return { provider: "OpenRouter", maskedKey: masked, status: "PASS", message: "200 OK (Healthy)", statusCode: 200 };
    }
    if (res.status === 401 || res.status === 403) {
      return { provider: "OpenRouter", maskedKey: masked, status: "FAIL", message: `HTTP ${res.status} Unauthorized / Forbidden`, statusCode: res.status };
    }
    if (res.status === 429) {
      return { provider: "OpenRouter", maskedKey: masked, status: "WARN", message: "HTTP 429 Rate Limited (Active)", statusCode: 429 };
    }
    return { provider: "OpenRouter", maskedKey: masked, status: "WARN", message: `HTTP ${res.status} Upstream Warning`, statusCode: res.status };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { provider: "OpenRouter", maskedKey: masked, status: "WARN", message: `Connection error: ${detail}` };
  }
}

async function probeZenKey(key: string): Promise<ProbeResult> {
  const masked = maskKey(key);
  const url = "https://opencode.ai/zen/v1/chat/completions";
  const payload = {
    model: "big-pickle",
    messages: [{ role: "user", content: "ping" }],
    max_tokens: 10,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });

    if (res.status === 200) {
      return { provider: "Zen", maskedKey: masked, status: "PASS", message: "200 OK (Healthy)", statusCode: 200 };
    }
    if (res.status === 401 || res.status === 403) {
      return { provider: "Zen", maskedKey: masked, status: "FAIL", message: `HTTP ${res.status} Unauthorized / Forbidden`, statusCode: res.status };
    }
    if (res.status === 429) {
      let msg = "HTTP 429 Rate Limited (Active)";
      try {
        const body = (await res.json()) as { error?: { message?: string } };
        if (body?.error?.message) msg = `HTTP 429: ${body.error.message}`;
      } catch (err) {
        void err;
      }
      return { provider: "Zen", maskedKey: masked, status: "WARN", message: msg, statusCode: 429 };
    }
    return { provider: "Zen", maskedKey: masked, status: "WARN", message: `HTTP ${res.status} Upstream Warning`, statusCode: res.status };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { provider: "Zen", maskedKey: masked, status: "WARN", message: `Connection error: ${detail}` };
  }
}

async function probePoolSequential(
  providerLabel: string,
  keys: readonly string[],
  probeFn: (key: string) => Promise<ProbeResult>,
  delayMs = 1000
): Promise<ProbeResult[]> {
  if (keys.length === 0) {
    return [];
  }
  const results: ProbeResult[] = [];
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const res = await probeFn(key);
    results.push(res);
    const tag = res.status === "PASS" ? "🟢 PASS" : res.status === "WARN" ? "🟡 WARN" : "🔴 FAIL";
    console.log(`${tag.padEnd(8, " ")} | ${`Key: ${res.maskedKey}`.padEnd(20, " ")} | ${res.message}`);
    if (i < keys.length - 1 && delayMs > 0) {
      await sleep(delayMs);
    }
  }
  return results;
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

  const combinedEnv = getCombinedEnv();
  const pools = checkKeyPools(combinedEnv);
  await pingLocalServer();

  console.log("\n--- [1/2] Local Files, Schema & Server Health ---");
  for (const c of checks) {
    const tag = c.status === "PASS" ? "🟢 PASS" : c.status === "WARN" ? "🟡 WARN" : "🔴 FAIL";
    console.log(`${tag.padEnd(8, " ")} | ${c.label.padEnd(30, " ")} | ${c.message}`);
  }

  console.log("\n--- [2/2] Upstream API Key Health Probes (1s delay between keys) ---");

  const rawArgs = process.argv.slice(2).map((a) => a.toLowerCase().replace(/^--?/, ""));
  let targetProvider: "gg" | "nv" | "or" | "zn" | null = null;
  for (const arg of rawArgs) {
    const clean = (arg.startsWith("provider=") ? arg.split("=")[1] : arg) ?? "";
    if (["gg", "google", "gemini"].includes(clean)) targetProvider = "gg";
    else if (["nv", "nvidia", "nim"].includes(clean)) targetProvider = "nv";
    else if (["or", "openrouter"].includes(clean)) targetProvider = "or";
    else if (["zn", "zen"].includes(clean)) targetProvider = "zn";
  }

  const probeResults: ProbeResult[] = [];

  const googleKeys = pools.get("gg") ?? [];
  if (targetProvider && targetProvider !== "gg") {
    console.log("\n[Google Gemini] ⏭️ Skipped (filter active).");
  } else if (googleKeys.length > 0) {
    console.log(`\n[Google Gemini] Probing ${googleKeys.length} key(s)...`);
    const res = await probePoolSequential("Google Gemini", googleKeys, probeGoogleKey, 1000);
    probeResults.push(...res);
  } else {
    console.log("\n[Google Gemini] ⏭️ Skipped: No keys configured.");
  }

  const nvidiaKeys = pools.get("nv") ?? [];
  if (targetProvider && targetProvider !== "nv") {
    console.log("\n[NVIDIA NIM] ⏭️ Skipped (filter active).");
  } else if (nvidiaKeys.length > 0) {
    console.log(`\n[NVIDIA NIM] Probing ${nvidiaKeys.length} key(s)...`);
    const res = await probePoolSequential("NVIDIA NIM", nvidiaKeys, probeNvidiaKey, 1000);
    probeResults.push(...res);
  } else {
    console.log("\n[NVIDIA NIM] ⏭️ Skipped: No keys configured.");
  }

  const openrouterKeys = pools.get("or") ?? [];
  if (targetProvider && targetProvider !== "or") {
    console.log("\n[OpenRouter] ⏭️ Skipped (filter active).");
  } else if (openrouterKeys.length > 0) {
    console.log(`\n[OpenRouter] Probing ${openrouterKeys.length} key(s)...`);
    const res = await probePoolSequential("OpenRouter", openrouterKeys, probeOpenrouterKey, 1000);
    probeResults.push(...res);
  } else {
    console.log("\n[OpenRouter] ⏭️ Skipped: No keys configured.");
  }

  const zenKeys = pools.get("zn") ?? [];
  if (targetProvider && targetProvider !== "zn") {
    console.log("\n[Zen] ⏭️ Skipped (filter active).");
  } else if (zenKeys.length > 0) {
    console.log(`\n[Zen] Probing ${zenKeys.length} key(s)...`);
    const res = await probePoolSequential("Zen", zenKeys, probeZenKey, 1000);
    probeResults.push(...res);
  } else {
    console.log("\n[Zen] ⏭️ Skipped: No keys configured.");
  }

  const systemFails = checks.filter((c) => c.status === "FAIL").length;
  const systemWarns = checks.filter((c) => c.status === "WARN").length;
  const systemPass = checks.length - systemFails - systemWarns;

  const keyPass = probeResults.filter((r) => r.status === "PASS").length;
  const keyWarn = probeResults.filter((r) => r.status === "WARN").length;
  const keyFail = probeResults.filter((r) => r.status === "FAIL").length;

  console.log("\n================================================================================");
  console.log("📋 Diagnostic Summary:");
  console.log(`- System Checks: ${systemPass} passed, ${systemWarns} warnings, ${systemFails} failures`);
  if (probeResults.length > 0) {
    console.log(`- Key Probes:    ${probeResults.length} total (${keyPass} healthy, ${keyWarn} warning/rate-limited, ${keyFail} failed)`);
  } else {
    console.log("- Key Probes:    0 probed");
  }
  console.log("================================================================================");
}

if (import.meta.main) {
  runDoctor();
}
