/**
 * eval/validate_cli.ts
 *
 * Deterministic intake and validation for LiteRouter evaluation scripts.
 * Enforces positional argument order:
 *   1. <model_name>
 *   2. <provider>  (validated against config/providers.json)
 *   3. <api_key>   (LiteRouter directive key, e.g. lr-xx-xx-xx-xx)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RegisteredProvider {
  key: string;      // e.g. "openrouter", "google"
  code: string;     // e.g. "or", "gg"
  name: string;     // e.g. "OpenRouter", "Google AI Studio"
  envKey?: string;
}

export interface ValidatedEvalArgs {
  model: string;
  provider: string;
  providerCode: string;
  providerName: string;
  directiveKey: string;
}

/**
 * Resolves the path to config/providers.json.
 */
export function getProvidersConfigPath(): string {
  const candidates = [
    join(process.cwd(), "config", "providers.json"),
    join(import.meta.dir, "..", "config", "providers.json"),
    "/home/yapilwsl/arthityap/literouter/config/providers.json",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return candidates[0]!;
}

/**
 * Loads and validates providers registered in config/providers.json.
 */
export function loadRegisteredProviders(configPath?: string): Map<string, RegisteredProvider> {
  const filePath = configPath ?? getProvidersConfigPath();
  if (!existsSync(filePath)) {
    throw new Error(
      `❌ FATAL: Providers configuration file not found at: ${filePath}\n` +
      `Ensure /home/yapilwsl/arthityap/literouter/config/providers.json exists.`
    );
  }

  let parsed: { providers?: Record<string, { code?: string; name?: string; env_key?: string }> };
  try {
    const raw = readFileSync(filePath, "utf-8");
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `❌ FATAL: Failed to parse providers configuration JSON at: ${filePath}\n` +
      `Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!parsed.providers || typeof parsed.providers !== "object") {
    throw new Error(
      `❌ FATAL: Malformed providers configuration at: ${filePath}. Missing 'providers' dictionary.`
    );
  }

  const registry = new Map<string, RegisteredProvider>();
  for (const [key, p] of Object.entries(parsed.providers)) {
    const code = (p.code ?? key).toLowerCase();
    const entry: RegisteredProvider = {
      key: key.toLowerCase(),
      code,
      name: p.name ?? key,
      envKey: p.env_key,
    };
    // Index by both full key ("openrouter") and short code ("or")
    registry.set(key.toLowerCase(), entry);
    registry.set(code, entry);
  }

  return registry;
}

/**
 * Extracts positional arguments while skipping known CLI options and their values.
 */
export function extractPositionalAndNamed(argv: string[]): {
  positionals: string[];
  named: Record<string, string | boolean>;
} {
  const positionals: string[] = [];
  const named: Record<string, string | boolean> = {};

  const takesArg = new Set([
    "--key",
    "--directive",
    "--provider",
    "--model",
    "--url",
    "--wire",
    "--suites",
    "--stage",
    "--reasoning",
    "--runs",
    "--cooldown",
    "--timeout",
    "--max-tokens",
    "--image",
  ]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-h" || arg === "--help") {
      named.help = true;
      continue;
    }
    if (arg.startsWith("--") || arg.startsWith("-")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        const flag = arg.slice(0, eqIdx);
        const val = arg.slice(eqIdx + 1);
        named[flag] = val;
        continue;
      }
      if (takesArg.has(arg) && i + 1 < argv.length && !argv[i + 1]!.startsWith("-")) {
        named[arg] = argv[++i]!;
        continue;
      }
      named[arg] = true;
      continue;
    }
    // Positional argument
    positionals.push(arg);
  }

  return { positionals, named };
}

/**
 * Validates CLI arguments strictly enforcing the order:
 *   1. <model_name>
 *   2. <provider>
 *   3. <api_key> (LiteRouter directive key)
 *
 * If any of them are missing or if provider is not in config/providers.json,
 * throws a descriptive Error.
 */
export function validateStrictEvalArgs(
  argv: string[],
  scriptName: string = "eval/eval.ts"
): ValidatedEvalArgs {
  const { positionals, named } = extractPositionalAndNamed(argv);
  const providersMap = loadRegisteredProviders();

  const validEntries = Array.from(
    new Map(Array.from(providersMap.values()).map((p) => [p.key, p])).values()
  );
  const validListFormatted = validEntries
    .map((p) => `    • ${p.key.padEnd(12)} (code: '${p.code}') — ${p.name}`)
    .join("\n");

  const usageBanner =
    `\x1b[1m\x1b[33mREQUIRED USAGE ORDER:\x1b[0m\n` +
    `  bun run ${scriptName} <model_name> <provider> <api_key> [options]\n\n` +
    `\x1b[1mARGUMENTS (IN EXACT ORDER):\x1b[0m\n` +
    `  1. <model_name> : Model identifier (e.g. google/gemini-3.5-flash-lite, stealth/union-alpha)\n` +
    `  2. <provider>   : Provider registered in config/providers.json\n` +
    `  3. <api_key>    : LiteRouter directive key (e.g. lr-gg-gg-gc-no, lr-or-oa-ch-no)\n\n` +
    `\x1b[1mREGISTERED PROVIDERS (config/providers.json):\x1b[0m\n` +
    `${validListFormatted}\n\n` +
    `\x1b[1mEXAMPLES:\x1b[0m\n` +
    `  bun run ${scriptName} google/gemini-3.5-flash-lite google lr-gg-gg-gc-no\n` +
    `  bun run ${scriptName} stealth/union-alpha openrouter lr-or-oa-ch-no --suites speed,code\n` +
    `  bun run ${scriptName} union-alpha zen lr-zn-cl-ms-no --continue`;

  // 1. Validate model_name
  const rawModel = positionals[0] ?? (typeof named["--model"] === "string" ? named["--model"] : "");
  if (!rawModel || rawModel.trim() === "") {
    throw new Error(
      `\x1b[1m\x1b[31m❌ EVAL RUNNER FATAL ERROR: Missing required argument #1: <model_name>\x1b[0m\n\n` +
      `You must specify the target model name as the FIRST argument.\n\n` +
      `${usageBanner}`
    );
  }

  // 2. Validate provider
  const rawProvider = positionals[1] ?? (typeof named["--provider"] === "string" ? named["--provider"] : "");
  if (!rawProvider || rawProvider.trim() === "") {
    throw new Error(
      `\x1b[1m\x1b[31m❌ EVAL RUNNER FATAL ERROR: Missing required argument #2: <provider>\x1b[0m\n\n` +
      `You must specify the provider as the SECOND argument (after model '${rawModel}').\n\n` +
      `${usageBanner}`
    );
  }

  const normalizedProvider = rawProvider.trim().toLowerCase();
  const providerInfo = providersMap.get(normalizedProvider);
  if (!providerInfo) {
    throw new Error(
      `\x1b[1m\x1b[31m❌ EVAL RUNNER FATAL ERROR: Unrecognized provider '${rawProvider}'\x1b[0m\n\n` +
      `Provider '${rawProvider}' is NOT registered in config/providers.json!\n\n` +
      `\x1b[1mVALID PROVIDERS FOUND IN config/providers.json:\x1b[0m\n` +
      `${validListFormatted}\n\n` +
      `${usageBanner}`
    );
  }

  // 3. Validate api_key (directive key)
  const rawKey =
    positionals[2] ??
    (typeof named["--key"] === "string"
      ? named["--key"]
      : typeof named["--directive"] === "string"
        ? named["--directive"]
        : "");

  if (!rawKey || rawKey.trim() === "") {
    throw new Error(
      `\x1b[1m\x1b[31m❌ EVAL RUNNER FATAL ERROR: Missing required argument #3: <api_key>\x1b[0m\n\n` +
      `You must specify the LiteRouter directive key as the THIRD argument (after model '${rawModel}' and provider '${providerInfo.key}').\n\n` +
      `${usageBanner}`
    );
  }

  return {
    model: rawModel.trim(),
    provider: providerInfo.key,
    providerCode: providerInfo.code,
    providerName: providerInfo.name,
    directiveKey: rawKey.trim(),
  };
}
