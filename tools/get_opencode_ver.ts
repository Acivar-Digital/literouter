import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

async function getOpencodeVersion(): Promise<string | null> {
  // Extract a bare semver rather than stripping prefixes. `opencode --version`
  // has printed several shapes across releases ("opencode v2.0.22",
  // "opencode 2.0.22", "opencode opencode v2.0.22"), and stripping only one
  // leading token leaves "opencode v2.0.22" in place. That residue reaches
  // config/providers.json verbatim, and upstream Zen answers a malformed
  // version with 403 FreeTierError -- NOT the 426 UpgradeRequired a rejected
  // version would give, which is why this went unnoticed.
  const SEMVER = /(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/;

  try {
    const proc = Bun.spawn(["opencode", "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode === 0) {
      const match = SEMVER.exec(stdout.trim());
      // Beta/RC tags (0.0.0-beta-*, x.y.z-beta.*) are rejected upstream with
      // 426 UpgradeRequired, so they are not eligible here.
      if (match && !match[4]) {
        const [, major, minor, patch] = match;
        const parsed = `${major}.${minor}.${patch}`;
        // Upstream Zen requires semver >= 1.18.0. Never emit a value below
        // that floor; an older runtime uses the compliant default instead.
        if (Number(major) > 1 || (Number(major) === 1 && Number(minor) >= 18)) {
          return parsed;
        }
      }
    }
  } catch {
    // Binary missing or unusable -- fall through to the compliant default.
  }

  // Default to a compliant stable runtime version when no binary is present or
  // its output is unparseable.
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
