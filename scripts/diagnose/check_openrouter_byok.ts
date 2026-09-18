import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!existsSync(filePath)) return env;

  const content = readFileSync(filePath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

function mask(str: string, keepPrefix = 6, keepSuffix = 4): string {
  if (!str || str.length <= keepPrefix + keepSuffix) return "***";
  return `${str.slice(0, keepPrefix)}...${str.slice(-keepSuffix)}`;
}

async function main() {
  const repoRoot = resolve(import.meta.dir, "..");
  const envLocalPath = resolve(repoRoot, ".env.local");
  const envPath = resolve(repoRoot, ".env");

  const localEnv = parseEnvFile(envLocalPath);
  const rootEnv = parseEnvFile(envPath);

  const mgmtKey =
    process.env.OPENROUTER_MGMT_KEYS ||
    localEnv.OPENROUTER_MGMT_KEYS ||
    rootEnv.OPENROUTER_MGMT_KEYS;
  const byokKey =
    process.env.OPENROUTER_BYOK_KEYS ||
    localEnv.OPENROUTER_BYOK_KEYS ||
    rootEnv.OPENROUTER_BYOK_KEYS;

  console.log("=================================================");
  console.log("    OpenRouter BYOK Diagnostics & Audit Tool     ");
  console.log("=================================================\n");

  if (!mgmtKey) {
    console.error(
      "❌ Error: OPENROUTER_MGMT_KEYS not found in environment or .env.local"
    );
    process.exit(1);
  }

  console.log(`[1] Management Key: ${mask(mgmtKey)}`);
  if (byokKey) {
    console.log(`[2] BYOK Client Key: ${mask(byokKey)}`);
  } else {
    console.log(
      "[-] BYOK Client Key: (Not set in OPENROUTER_BYOK_KEYS, will audit workspace generally)"
    );
  }

  // 1. Fetch Completion Keys
  console.log("\nFetching OpenRouter Workspace Keys (GET /api/v1/keys)...");
  let keysData: any[] = [];
  try {
    const keysRes = await fetch("https://openrouter.ai/api/v1/keys", {
      headers: { Authorization: `Bearer ${mgmtKey}` },
    });
    if (!keysRes.ok) {
      console.error(`❌ Failed to fetch keys: HTTP ${keysRes.status}`);
      console.error(await keysRes.text());
      process.exit(1);
    }
    const json = await keysRes.json();
    keysData = json.data || [];
  } catch (err: any) {
    console.error(`❌ Network error while listing keys: ${err.message}`);
    process.exit(1);
  }

  console.log(`Found ${keysData.length} API key(s) in workspace:\n`);
  let matchedHash: string | null = null;

  for (const k of keysData) {
    const labelSuffix = k.label ? k.label.split("...").pop() : "";
    const isTarget =
      byokKey &&
      labelSuffix &&
      labelSuffix.length >= 3 &&
      byokKey.endsWith(labelSuffix);
    if (isTarget) {
      matchedHash = k.hash;
    }
    const indicator = isTarget ? "👉 [TARGET BYOK KEY]" : "  ";
    console.log(`${indicator} Name: "${k.name}"`);
    console.log(`     Label:                 ${k.label}`);
    console.log(`     Hash:                  ${k.hash}`);
    console.log(`     Credit Limit:          ${k.limit ?? "Unlimited"}`);
    console.log(
      `     Include BYOK in Limit: ${k.include_byok_in_limit} (Should be false)`
    );
    console.log(`     Total Usage:           $${k.usage}`);
    console.log(`     BYOK Usage:            $${k.byok_usage}`);
    console.log(`     Disabled:              ${k.disabled}\n`);
  }

  // 2. Fetch BYOK Credentials
  console.log("Fetching BYOK Credentials (GET /api/v1/byok)...");
  let byokList: any[] = [];
  try {
    const byokRes = await fetch("https://openrouter.ai/api/v1/byok", {
      headers: { Authorization: `Bearer ${mgmtKey}` },
    });
    if (!byokRes.ok) {
      console.error(`❌ Failed to fetch BYOK credentials: HTTP ${byokRes.status}`);
      console.error(await byokRes.text());
      process.exit(1);
    }
    const json = await byokRes.json();
    byokList = json.data || [];
  } catch (err: any) {
    console.error(`❌ Network error while listing BYOK credentials: ${err.message}`);
    process.exit(1);
  }

  console.log(`\nFound ${byokList.length} registered BYOK credential(s):\n`);

  let allByokOnly = true;
  let allRequired = true;
  let allBoundToKey = true;
  let allActive = true;

  console.log(
    "| #  | Name                      | Provider         | Label       | Order | BYOK-Only | Required | Fallback | Bound? |"
  );
  console.log(
    "|----|---------------------------|------------------|-------------|-------|-----------|----------|----------|--------|"
  );

  byokList.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  for (let i = 0; i < byokList.length; i++) {
    const c = byokList[i];
    if (!c.is_byok_only) allByokOnly = false;
    if (!c.is_required) allRequired = false;
    if (c.disabled) allActive = false;

    const isBound =
      matchedHash && Array.isArray(c.allowed_api_key_hashes)
        ? c.allowed_api_key_hashes.includes(matchedHash)
        : c.allowed_api_key_hashes?.length > 0;

    if (!isBound && matchedHash) allBoundToKey = false;

    const num = String(i + 1).padStart(2, " ");
    const name = (c.name || "Untitled").padEnd(25, " ").slice(0, 25);
    const prov = (c.provider || "").padEnd(16, " ").slice(0, 16);
    const lbl = (c.label || "").padEnd(11, " ").slice(0, 11);
    const ord = String(c.sort_order ?? 0).padStart(5, " ");
    const byokOnly = String(c.is_byok_only).padEnd(9, " ");
    const req = String(c.is_required).padEnd(8, " ");
    const fb = String(c.is_fallback).padEnd(8, " ");
    const bnd = String(isBound ?? false).padEnd(6, " ");

    console.log(
      `| ${num} | ${name} | ${prov} | ${lbl} | ${ord} | ${byokOnly} | ${req} | ${fb} | ${bnd} |`
    );
  }

  console.log("\n-------------------------------------------------");
  console.log("                 AUDIT SUMMARY                   ");
  console.log("-------------------------------------------------");
  console.log(`Total Credentials Registered:    ${byokList.length}`);
  console.log(
    `All "Never use shared capacity":  ${allByokOnly && allRequired ? "✅ PASS" : "⚠️ WARN (Some keys have shared capacity enabled)"}`
  );
  console.log(
    `All Active & Enabled:            ${allActive ? "✅ PASS" : "⚠️ WARN (Some keys disabled)"}`
  );
  if (matchedHash) {
    console.log(
      `All Bound Strictly to BYOK Key:  ${allBoundToKey ? "✅ PASS" : "⚠️ WARN (Some keys not restricted to target key)"}`
    );
  }

  // 3. Optional Probe
  const shouldProbe = process.argv.includes("--probe");
  if (shouldProbe) {
    if (!byokKey) {
      console.log("\n⚠️ Cannot run live probe: OPENROUTER_BYOK_KEYS not set.");
      return;
    }
    console.log("\nRunning live chat completion probe with streaming...");
    try {
      const probeRes = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${byokKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3.5-flash-lite",
          messages: [{ role: "user", content: "Ping! Reply with 'PONG' only." }],
          stream: true,
          provider: {
            order: ["google-ai-studio"],
            allow_fallbacks: false,
          },
        }),
      });

      if (!probeRes.ok) {
        console.error(`❌ Probe failed: HTTP ${probeRes.status}`);
        console.error(await probeRes.text());
      } else {
        const text = await probeRes.text();
        const isByok = text.includes('"is_byok":true') || text.includes('"cost":0');
        console.log(`✅ Probe successful! (HTTP 200)`);
        console.log(`   BYOK Zero-Cost Verified: ${isByok ? "✅ YES ($0)" : "❌ Check usage"}`);
      }
    } catch (e: any) {
      console.error(`❌ Probe request error: ${e.message}`);
    }
  } else {
    console.log("\n💡 Tip: Run `bun scripts/check_openrouter_byok.ts --probe` to perform a live zero-cost inference test.");
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
