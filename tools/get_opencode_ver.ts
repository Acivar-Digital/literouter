import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

async function getOpencodeVersion(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["opencode", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      return null;
    }

    const version = stdout.trim();
    return version.length > 0 ? version : null;
  } catch (error) {
    return null;
  }
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
