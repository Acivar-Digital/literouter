import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { ProvidersConfigSchema, type ProviderConfigEntry } from "./schema";

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
  const parsed = ProvidersConfigSchema.parse(source);
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
