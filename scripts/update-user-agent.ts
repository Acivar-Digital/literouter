import { existsSync, readFileSync, writeFileSync } from "fs";
import { resolve } from "path";

export interface UpdateUserAgentOptions {
  dryRun?: boolean;
  skipReset?: boolean;
}

export interface UpdateUserAgentResult {
  updated: boolean;
  opencodeVersion: string;
  openrouter: {
    current: string;
    target: string;
    changed: boolean;
  };
  zen: {
    current: string;
    target: string;
    changed: boolean;
  };
}

/**
 * Extracts a bare semver from `opencode --version`.
 *
 * `opencode --version` can return multiple formats ("opencode v2.1.4", "opencode 2.1.4",
 * "opencode opencode v2.0.22"). We extract semver cleanly using regex.
 * Upstream Zen requires semver >= 1.18.0 and rejects beta/RC tags with 426 UpgradeRequired.
 * If opencode is missing or unparseable, falls back to compliant floor "1.18.30".
 */
export async function getOpencodeVersion(): Promise<string> {
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
      if (match && !match[4]) {
        const [, major, minor, patch] = match;
        const parsed = `${major}.${minor}.${patch}`;
        if (Number(major) > 1 || (Number(major) === 1 && Number(minor) >= 18)) {
          return parsed;
        }
      }
    }
  } catch (err: unknown) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ [WARN] Failed to inspect 'opencode --version' (${errorDetail}); falling back to 1.18.30`);
    return "1.18.30";
  }

  console.warn("⚠️ [WARN] 'opencode' binary missing or invalid version; falling back to 1.18.30");
  return "1.18.30";
}

/**
 * Discovers the active OpenCode version and updates config/providers.json
 * for both OpenRouter and Zen providers.
 */
export async function updateUserAgent(
  options: UpdateUserAgentOptions = {}
): Promise<UpdateUserAgentResult> {
  const opencodeVersion = await getOpencodeVersion();
  const bunVersion = Bun.version;

  const targetOpenRouterUa = `OpenCode/${opencodeVersion}`;
  const targetZenUa = `opencode/${opencodeVersion} ai-sdk/provider-utils/4.0.23 runtime/bun/${bunVersion}`;

  const configPath = resolve(__dirname, "../config/providers.json");
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}`);
  }

  const rawData = readFileSync(configPath, "utf-8");
  const json = JSON.parse(rawData);

  if (!json.providers) {
    throw new Error("Invalid providers.json: missing 'providers' object");
  }

  const currentOpenRouterUa = json.providers?.openrouter?.headers?.["User-Agent"] ?? "";
  const currentZenUa = json.providers?.zen?.headers?.["User-Agent"] ?? "";

  const openRouterChanged = currentOpenRouterUa !== targetOpenRouterUa;
  const zenChanged = currentZenUa !== targetZenUa;
  const updated = openRouterChanged || zenChanged;

  const result: UpdateUserAgentResult = {
    updated,
    opencodeVersion,
    openrouter: {
      current: currentOpenRouterUa,
      target: targetOpenRouterUa,
      changed: openRouterChanged,
    },
    zen: {
      current: currentZenUa,
      target: targetZenUa,
      changed: zenChanged,
    },
  };

  if (options.dryRun) {
    console.log(`🔍 [DRY RUN] Detected OpenCode version: ${opencodeVersion}`);
    console.log(`  - OpenRouter: ${currentOpenRouterUa} ➔ ${targetOpenRouterUa} (${openRouterChanged ? "CHANGE" : "unchanged"})`);
    console.log(`  - Zen:        ${currentZenUa} ➔ ${targetZenUa} (${zenChanged ? "CHANGE" : "unchanged"})`);
    return result;
  }

  if (!updated) {
    console.log(`✓ OpenCode User-Agent headers are already up-to-date (${opencodeVersion}) in config/providers.json.`);
    return result;
  }

  if (json.providers.openrouter?.headers) {
    json.providers.openrouter.headers["User-Agent"] = targetOpenRouterUa;
  }
  if (json.providers.zen?.headers) {
    json.providers.zen.headers["User-Agent"] = targetZenUa;
  }

  writeFileSync(configPath, JSON.stringify(json, null, 2) + "\n", "utf-8");
  console.log(`✓ Updated OpenCode User-Agent headers in config/providers.json (v${opencodeVersion}):`);
  if (openRouterChanged) {
    console.log(`  - OpenRouter: ${currentOpenRouterUa || "(none)"} ➔ ${targetOpenRouterUa}`);
  }
  if (zenChanged) {
    console.log(`  - Zen:        ${currentZenUa || "(none)"} ➔ ${targetZenUa}`);
  }

  // Attempt hot-reload if not skipped
  if (!options.skipReset) {
    await attemptGatewayReset();
  }

  return result;
}

/**
 * Attempts an authenticated POST /reset to hot-reload config/providers.json
 * in the active LiteRouter gateway if running.
 */
async function attemptGatewayReset(): Promise<void> {
  const locPath = resolve(__dirname, "../config/location.json");
  if (!existsSync(locPath)) return;

  try {
    const loc = JSON.parse(readFileSync(locPath, "utf-8"));
    const host = loc.host || "127.0.0.1";
    const port = loc.port || 7766;
    const protocol = loc.tls_enabled ? "https" : "http";
    const url = `${protocol}://${host}:${port}/reset`;

    const authKey = process.env.LITEROUTER_AUTH_KEY;
    if (!authKey) {
      console.log(`ℹ️ [Hot-Reload] LITEROUTER_AUTH_KEY not set in environment; skipping live /reset`);
      return;
    }

    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authKey}`,
      },
      signal: AbortSignal.timeout(2000),
    });

    if (res.ok) {
      console.log(`✓ Hot-reloaded running LiteRouter gateway at ${url} (POST /reset -> 200 OK)`);
    } else {
      console.warn(`⚠️ [Hot-Reload] POST /reset returned status ${res.status}`);
    }
  } catch (err: unknown) {
    const errorDetail = err instanceof Error ? err.message : String(err);
    console.log(`ℹ️ [Hot-Reload] LiteRouter gateway offline (${errorDetail}); updated headers will take effect at next start.`);
  }
}

export async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const skipReset = args.includes("--skip-reset");

  try {
    await updateUserAgent({ dryRun, skipReset });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`⚠️ [WARN] Error updating User-Agent: ${msg}`);
    process.exit(0);
  }
}

if (import.meta.main) {
  main();
}
