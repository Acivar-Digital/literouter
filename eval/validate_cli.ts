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
  batchTargets?: ValidatedEvalArgs[];
  sourceFile?: string;
}

/**
 * Parses a single line from a model targets file into ValidatedEvalArgs.
 */
export function parseModelLine(
  line: string,
  providersMap: Map<string, RegisteredProvider>,
  lineNum: number = 1
): ValidatedEvalArgs {
  const parts = line.includes(",")
    ? line.split(",").map((p) => p.trim())
    : line.split(/\s+/).map((p) => p.trim());
  const positionals = parts.filter(Boolean);

  if (positionals.length === 0) {
    throw new Error(`Line ${lineNum} is empty`);
  }

  let rawModel = positionals[0]!;
  let rawProvider = "";
  let rawKey = "";
  let providerInfo: RegisteredProvider | undefined;

  if (positionals.length >= 3) {
    rawProvider = positionals[1]!;
    rawKey = positionals[2]!;
  } else if (positionals.length === 2) {
    const second = positionals[1]!;
    if (second.startsWith("lr-")) {
      rawKey = second;
      const keyParts = second.split("-");
      const codeCandidate = keyParts[1]?.toLowerCase();
      if (codeCandidate && providersMap.has(codeCandidate)) {
        providerInfo = providersMap.get(codeCandidate);
        rawProvider = providerInfo!.key;
      } else if (codeCandidate) {
        rawProvider = codeCandidate;
      }
    } else if (providersMap.has(second.toLowerCase())) {
      rawProvider = second;
      providerInfo = providersMap.get(second.toLowerCase());
      rawKey = `lr-${providerInfo!.code}-oa-ch-no`;
    } else {
      rawProvider = second;
    }
  } else {
    // 1 positional: <model_name> only. Auto-infer provider and default directive key.
    const lower = rawModel.toLowerCase();
    if (lower.includes("union-alpha") || lower.startsWith("zen")) {
      rawProvider = "zen";
      rawKey = "lr-zn-cl-ms-no";
    } else if (lower.startsWith("nvidia/") || lower.startsWith("meta/")) {
      rawProvider = "nvidia";
      rawKey = "lr-nv-oa-ch-no";
    } else if (lower.startsWith("google/")) {
      rawProvider = "google";
      rawKey = "lr-gg-gg-gc-no";
    } else {
      rawProvider = "openrouter";
      rawKey = "lr-or-oa-ch-no";
    }
    providerInfo = providersMap.get(rawProvider);
  }

  if (!rawProvider) {
    throw new Error(
      `Line ${lineNum} ('${line}'): Unable to determine provider for model '${rawModel}'. Provide an 'lr-<provider>-...' key or specify provider.`
    );
  }

  if (!providerInfo) {
    providerInfo = providersMap.get(rawProvider.toLowerCase());
    if (!providerInfo) {
      throw new Error(
        `Line ${lineNum} ('${line}'): Unrecognized provider '${rawProvider}' in config/providers.json.`
      );
    }
  }

  if (!rawKey) {
    throw new Error(
      `Line ${lineNum} ('${line}'): Missing directive key for model '${rawModel}'.`
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

export interface WireDirectiveKeys {
  chat: string;
  responses: string;
  messages: string;
}

/**
 * Derives sibling directive keys for the three wires (chat, responses, messages)
 * by substituting the payload and completion codes (-oa-ch- / -oo-rs- / -cl-ms-).
 */
export function deriveWireDirectiveKeys(
  directiveKey: string,
  providerCode?: string
): WireDirectiveKeys {
  const trimmed = directiveKey.trim();
  const parts = trimmed.split("-");

  // Determine provider code: prefer explicit providerCode, else parse from key, else default 'or'
  const prov = (providerCode ?? (parts[0] === "lr" && parts[1] ? parts[1] : "or")).toLowerCase();

  // Extract nuance/options (suffix)
  let nuance = "no";
  if (parts.length >= 5) {
    nuance = parts.slice(4).join("-");
  } else if (parts.length === 4) {
    nuance = parts[3]!;
  }

  // Determine responses payload: if incoming key already used oa-rs, preserve it; otherwise oo-rs
  const rsPayload = trimmed.includes("-oa-rs-") ? "oa" : "oo";

  return {
    chat: `lr-${prov}-oa-ch-${nuance}`,
    responses: `lr-${prov}-${rsPayload}-rs-${nuance}`,
    messages: `lr-${prov}-cl-ms-${nuance}`,
  };
}

/**
 * Resolves the default gateway base URL:
 * 1. Explicit env override (LITEROUTER_URL / GATEWAY_URL)
 * 2. Primary Intranet Host: http://literouter.lan:7766
 */
export function getDefaultGatewayBaseUrl(): string {
  if (process.env.LITEROUTER_URL) return process.env.LITEROUTER_URL.replace(/\/+$/, "");
  if (process.env.GATEWAY_URL) return process.env.GATEWAY_URL.replace(/\/+$/, "");

  // Primary gateway endpoint (never localhost)
  return "http://literouter.lan:7766";
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
    "--file",
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
  scriptName: string = "eval/eval.ts",
  options: { allowDefaultFile?: boolean } = {}
): ValidatedEvalArgs {
  const { positionals, named } = extractPositionalAndNamed(argv);
  const providersMap = loadRegisteredProviders();
  const allowDefaultFile = options.allowDefaultFile ?? true;

  const resolveCandidateFile = (p: string): string | undefined => {
    if (existsSync(p)) return p;
    const fromCwd = join(process.cwd(), p);
    if (existsSync(fromCwd)) return fromCwd;
    const fromMeta = join(import.meta.dir, "..", p);
    if (existsSync(fromMeta)) return fromMeta;
    return undefined;
  };

  let effectivePositionals = [...positionals];
  let rawFilePath = typeof named["--file"] === "string" ? named["--file"] : undefined;
  if (
    !rawFilePath &&
    positionals.length === 1 &&
    (positionals[0]!.endsWith(".txt") || positionals[0]!.endsWith(".csv"))
  ) {
    rawFilePath = positionals[0]!;
    effectivePositionals = [];
  } else if (!rawFilePath && positionals.length === 0 && !named["--model"] && allowDefaultFile) {
    // Default to eval/reports/test-models.txt if no arguments provided and allowed
    const defaultTestFile = "eval/reports/test-models.txt";
    if (resolveCandidateFile(defaultTestFile)) {
      rawFilePath = defaultTestFile;
    }
  }

  let loadedFromDefaultFile = false;
  if (rawFilePath) {
    const resolvedPath = resolveCandidateFile(rawFilePath);
    if (!resolvedPath) {
      throw new Error(`\x1b[1m\x1b[31m❌ EVAL RUNNER FATAL ERROR: Specified file does not exist: ${rawFilePath}\x1b[0m`);
    }
    const content = readFileSync(resolvedPath, "utf-8");
    const lines = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith("#"));

    if (lines.length === 0) {
      throw new Error(`\x1b[1m\x1b[31m❌ EVAL RUNNER FATAL ERROR: Target models file is empty: ${resolvedPath}\x1b[0m`);
    }

    const batchTargets: ValidatedEvalArgs[] = lines.map((line, idx) =>
      parseModelLine(line, providersMap, idx + 1)
    );

    const primary = batchTargets[0]!;
    loadedFromDefaultFile = true;
    console.log(
      `\x1b[34mℹ️  Loaded ${batchTargets.length} model test target(s) from:\x1b[0m \x1b[1m${resolvedPath}\x1b[0m` +
      (batchTargets.length > 1 ? ` (${batchTargets.map((t) => t.model).join(", ")})` : "")
    );

    return {
      ...primary,
      batchTargets,
      sourceFile: resolvedPath,
    };
  }

  const validEntries = Array.from(
    new Map(Array.from(providersMap.values()).map((p) => [p.key, p])).values()
  );
  const validListFormatted = validEntries
    .map((p) => `    • ${p.key.padEnd(12)} (code: '${p.code}') — ${p.name}`)
    .join("\n");

  const usageBanner =
    `\x1b[1m\x1b[33mREQUIRED USAGE ORDER:\x1b[0m\n` +
    `  bun run ${scriptName} <model_name> <api_key> [options]         (Provider auto-inferred from key)\n` +
    `  bun run ${scriptName} <model_name> <provider> <api_key> [options]\n` +
    `  bun run ${scriptName} <file.txt> [options]\n\n` +
    `\x1b[1mARGUMENTS:\x1b[0m\n` +
    `  1. <model_name> : Model identifier (e.g. union-alpha, google/gemini-3.5-flash-lite)\n` +
    `  2. <provider>   : (Optional if using lr-<provider>-* key) Provider registered in config/providers.json\n` +
    `  3. <api_key>    : LiteRouter directive key (e.g. lr-zn-cl-ms-no, lr-or-oa-ch-no, lr-gg-gg-gc-no)\n\n` +
    `\x1b[1mREGISTERED PROVIDERS (config/providers.json):\x1b[0m\n` +
    `${validListFormatted}\n\n` +
    `\x1b[1mSTREAMLINED EXAMPLES (No provider needed):\x1b[0m\n` +
    `  bun run ${scriptName} union-alpha lr-zn-cl-ms-no --continue\n` +
    `  bun run ${scriptName} stealth/union-alpha lr-or-oa-ch-no --suites speed,code\n` +
    `  bun run ${scriptName} eval/reports/test-models.txt\n\n` +
    `\x1b[1mEXPLICIT EXAMPLES:\x1b[0m\n` +
    `  bun run ${scriptName} google/gemini-3.5-flash-lite google lr-gg-gg-gc-no\n` +
    `  bun run ${scriptName} union-alpha zen lr-zn-cl-ms-no --continue`;

  let rawModel = "";
  let rawProvider = "";
  let rawKey = "";
  let providerInfo: RegisteredProvider | undefined;

  // Check named options first
  if (typeof named["--model"] === "string") rawModel = named["--model"];
  if (typeof named["--provider"] === "string") rawProvider = named["--provider"];
  if (typeof named["--key"] === "string") rawKey = named["--key"];
  else if (typeof named["--directive"] === "string") rawKey = named["--directive"];

  // Positional parsing
  if (effectivePositionals.length >= 3) {
    // 3 positionals: <model> <provider> <api_key>
    rawModel = effectivePositionals[0]!;
    rawProvider = effectivePositionals[1]!;
    rawKey = effectivePositionals[2]!;
  } else if (effectivePositionals.length === 2) {
    rawModel = effectivePositionals[0]!;
    const second = effectivePositionals[1]!;

    if (second.startsWith("lr-")) {
      // Streamlined 2-positional form: <model> <directive_key> (infer provider from key)
      rawKey = second;
      const keyParts = second.split("-");
      const codeCandidate = keyParts[1]?.toLowerCase();
      if (codeCandidate && providersMap.has(codeCandidate)) {
        providerInfo = providersMap.get(codeCandidate);
        rawProvider = providerInfo!.key;
      } else if (codeCandidate) {
        rawProvider = codeCandidate;
      }
    } else if (providersMap.has(second.toLowerCase())) {
      // 2 positionals: <model> <provider> (key missing or in named flag)
      rawProvider = second;
    } else {
      rawProvider = second;
    }
  } else if (effectivePositionals.length === 1) {
    rawModel = effectivePositionals[0]!;
  }

  // If key was provided via flag and provider wasn't specified, attempt auto-inference
  if (rawKey.startsWith("lr-") && !rawProvider) {
    const keyParts = rawKey.split("-");
    const codeCandidate = keyParts[1]?.toLowerCase();
    if (codeCandidate && providersMap.has(codeCandidate)) {
      providerInfo = providersMap.get(codeCandidate);
      rawProvider = providerInfo!.key;
    }
  }

  // 1. Validate model_name
  if (!rawModel || rawModel.trim() === "") {
    throw new Error(
      `\x1b[1m\x1b[31m❌ EVAL RUNNER FATAL ERROR: Missing required argument #1: <model_name>\x1b[0m\n\n` +
      `You must specify the target model name as the FIRST argument (or pass a file containing <model>, <key>).\n\n` +
      `${usageBanner}`
    );
  }

  // 2. Validate provider
  if (!rawProvider || rawProvider.trim() === "") {
    throw new Error(
      `\x1b[1m\x1b[31m❌ EVAL RUNNER FATAL ERROR: Missing required argument #2: <provider>\x1b[0m\n\n` +
      `You must specify the provider as the SECOND argument (or pass an 'lr-<provider>-...' directive key directly).\n\n` +
      `${usageBanner}`
    );
  }

  if (!providerInfo) {
    const normalizedProvider = rawProvider.trim().toLowerCase();
    providerInfo = providersMap.get(normalizedProvider);
    if (!providerInfo) {
      throw new Error(
        `\x1b[1m\x1b[31m❌ EVAL RUNNER FATAL ERROR: Unrecognized provider '${rawProvider}'\x1b[0m\n\n` +
        `Provider '${rawProvider}' is NOT registered in config/providers.json!\n\n` +
        `\x1b[1mVALID PROVIDERS FOUND IN config/providers.json:\x1b[0m\n` +
        `${validListFormatted}\n\n` +
        `${usageBanner}`
      );
    }
  }

  // 3. Validate api_key (directive key)
  if (!rawKey || rawKey.trim() === "") {
    throw new Error(
      `\x1b[1m\x1b[31m❌ EVAL RUNNER FATAL ERROR: Missing required argument #3: <api_key>\x1b[0m\n\n` +
      `You must specify the LiteRouter directive key as the THIRD argument (after model '${rawModel}' and provider '${providerInfo.key}').\n\n` +
      `${usageBanner}`
    );
  }

  const singleTarget: ValidatedEvalArgs = {
    model: rawModel.trim(),
    provider: providerInfo.key,
    providerCode: providerInfo.code,
    providerName: providerInfo.name,
    directiveKey: rawKey.trim(),
  };

  return {
    ...singleTarget,
    batchTargets: [singleTarget],
  };
}
