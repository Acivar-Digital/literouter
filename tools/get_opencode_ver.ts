import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

async function getOpencodeVersion(): Promise<string | null> {
  // Support both OpenCode v2 and legacy OpenCode v1
  for (const bin of ["opencode2", "opencode"]) {
    try {
      const proc = Bun.spawn([bin, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      if (exitCode === 0) {
        const raw = stdout.trim();
        const version = raw.replace(/^opencode2?[\/@\s]*/i, "").trim();
        // Upstream Zen checks semver >= 1.18.0. Beta tags like 0.0.0-beta-* trigger
        // HTTP 426 UpgradeRequired. Skip beta tags to allow fallback to stable release semver.
        if (version.startsWith("0.0.0") || version.includes("beta")) {
          continue;
        }
        if (version.length > 0) {
          return version;
        }
      }
    } catch {
      // Try next binary
    }
  }
  // Default to compliant stable runtime version if only beta or no binary is present
  return "1.18.30";
}

async function main() {
  const opencodeVersion = await getOpencodeVersion();
  if (!opencodeVersion) {
    console.warn("⚠️ [WARN] 'opencode' command not found or returned error. Skipping User-Agent update.");
    process.exit(0);
  }

  const bunVersion = Bun.version;
  const userAgent = `opencode/${opencodeVersion} ai-sdk/provider-utils/4.0.23 runtime/bun/${bunVersion}`;

  const configPath = resolve(__dirname, "../config/providers.json");
  if (!existsSync(configPath)) {
    console.warn(`⚠️ [WARN] Config file not found at ${configPath}. Skipping User-Agent update.`);
    process.exit(0);
  }

  try {
    const rawData = readFileSync(configPath, "utf-8");
    const json = JSON.parse(rawData);

    if (!json.providers?.zen?.headers) {
      console.warn("⚠️ [WARN] providers.zen.headers not found in config/providers.json. Skipping.");
      process.exit(0);
    }

    const currentAgent = json.providers.zen.headers["User-Agent"];
    if (currentAgent === userAgent) {
      console.log(`✓ OpenCode User-Agent is already up-to-date: ${userAgent}`);
      process.exit(0);
    }

    json.providers.zen.headers["User-Agent"] = userAgent;
    writeFileSync(configPath, JSON.stringify(json, null, 2) + "\n", "utf-8");
    console.log(`✓ Updated OpenCode User-Agent in config/providers.json:`);
    console.log(`  From: ${currentAgent}`);
    console.log(`  To:   ${userAgent}`);
  } catch (err: any) {
    console.warn(`⚠️ [WARN] Failed to update config/providers.json: ${err?.message || err}`);
    process.exit(0);
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.warn(`⚠️ [WARN] Unexpected error in get_opencode_ver: ${err?.message || err}`);
    process.exit(0);
  });
}
