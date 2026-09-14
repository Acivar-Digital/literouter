import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ZodError } from "zod";
import { ProvidersConfigSchema, type ProviderConfigEntry } from "./schema";
import { logWarn, EMOJI } from "../ui/logger";

const logger = {
  warn: (msg: string) => logWarn(EMOJI.amber, msg),
};

interface ProviderRegistrySnapshot {
  readonly byCode: ReadonlyMap<string, ProviderConfigEntry>;
  readonly byName: ReadonlyMap<string, ProviderConfigEntry>;
}

// Atomic reference — single pointer swap on reload
let registry: ProviderRegistrySnapshot = {
  byCode: new Map(),
  byName: new Map(),
};

function loadRawProvidersJson(): unknown {
  const defaultPath = resolve(import.meta.dir, "../../config/providers.json");
  if (existsSync(defaultPath)) {
    try {
      const file = Bun.file(defaultPath);
      // Synchronous fast check if size available, read synchronously via readFileSync for safe atomic init
      if (typeof file.size === "number") {
        return JSON.parse(readFileSync(defaultPath, "utf-8"));
      }
    } catch {
      return JSON.parse(readFileSync(defaultPath, "utf-8"));
    }
    return JSON.parse(readFileSync(defaultPath, "utf-8"));
  }
  throw new Error(`[ProviderRegistry] providers.json not found at: ${defaultPath}`);
}

export function initProviderRegistry(rawConfig?: unknown): void {
  const source = rawConfig ?? loadRawProvidersJson();
  let parsed: ReturnType<typeof ProvidersConfigSchema.parse>;
  try {
    parsed = ProvidersConfigSchema.parse(source);
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      const formattedErrors = err.issues
        .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("\n");
      console.error(
        `[FATAL] [ProviderRegistry] Provider configuration validation failed loudly refusing to start:\n${formattedErrors}`
      );
    }
    throw err;
  }
  const byCode = new Map<string, ProviderConfigEntry>();
  const byName = new Map<string, ProviderConfigEntry>();

  for (const [key, entry] of Object.entries(parsed.providers)) {
    // Populate name if omitted in JSON
    const fullEntry: ProviderConfigEntry = {
      ...entry,
      name: entry.name ?? key,
    };
    byCode.set(entry.code.toLowerCase(), fullEntry);
    byName.set(key.toLowerCase(), fullEntry);
  }

  // Atomic single-pointer swap
  registry = Object.freeze({ byCode, byName });
}

export function getProviderConfig(codeOrName: string): ProviderConfigEntry {
  if (registry.byCode.size === 0) {
    initProviderRegistry();
  }
  const norm = codeOrName.toLowerCase();
  const snap = registry; // Read once — consistent snapshot
  const entry = snap.byCode.get(norm) ?? snap.byName.get(norm);
  if (!entry) {
    throw new Error(`[ProviderRegistry] Unknown provider: "${codeOrName}"`);
  }
  return entry;
}

export function getProviderDisplayName(codeOrName: string): string {
  if (registry.byCode.size === 0) {
    initProviderRegistry();
  }
  const norm = codeOrName.toLowerCase();
  const snap = registry;
  const entry = snap.byCode.get(norm) ?? snap.byName.get(norm);
  return entry?.name ?? codeOrName.toUpperCase();
}

export function isRegisteredProvider(code: string): boolean {
  if (registry.byCode.size === 0) {
    initProviderRegistry();
  }
  return registry.byCode.has(code.toLowerCase());
}

export function getAllProviders(): readonly ProviderConfigEntry[] {
  if (registry.byCode.size === 0) {
    initProviderRegistry();
  }
  return Array.from(registry.byCode.values());
}

export function overrideProviderUrl(url: string, providerCode: string): string {
  const code = providerCode.toUpperCase();
  const mockPort = process.env[`MOCK_${code}_PORT`];
  if (!mockPort) {
    return url;
  }
  try {
    const parsed = new URL(url);
    parsed.protocol = "http:";
    parsed.host = `localhost:${mockPort}`;
    return parsed.toString();
  } catch {
    logger.warn(`[overrideProviderUrl] Invalid MOCK_${code}_PORT env var — falling back to production URL`);
    return url;
  }
}

export function resolveUpstreamEndpoint(
  providerCodeOrName: string,
  endpointKey: string,
  model?: string
): { url: string; authHeader: "Bearer" | "x-api-key"; rawPath: string; headers: Record<string, string> } {
  if (isRegisteredProvider(providerCodeOrName)) {
    const p = getProviderConfig(providerCodeOrName);
    const endpoints = p.endpoints as Record<string, string | undefined>;
    const rawPath = endpoints[endpointKey] ?? (endpointKey.startsWith("/") ? endpointKey : undefined);
    if (rawPath) {
      const formatted = model !== undefined ? rawPath.replace("{model}", model) : rawPath;
      const originalUrl = `${p.base_url}${formatted.startsWith("/") ? formatted : `/${formatted}`}`;
      return {
        url: overrideProviderUrl(originalUrl, p.code),
        authHeader: p.auth_header ?? "Bearer",
        rawPath: formatted.startsWith("/") ? formatted : `/${formatted}`,
        headers: p.headers ?? {},
      };
    }
    throw new Error(
      `[resolveUpstreamEndpoint] Unknown endpoint key "${endpointKey}" for provider "${providerCodeOrName}"`
    );
  }

  return {
    url: overrideProviderUrl("https://openrouter.ai/api/v1/chat/completions", providerCodeOrName),
    authHeader: "Bearer",
    rawPath: "/api/v1/chat/completions",
    headers: {},
  };
}
