import { getProviderConfig, getAllProviders, isRegisteredProvider } from "./providers";
import type { ProviderCode } from "./schema";

const PROVIDER_ENV_MAP: Readonly<Record<ProviderCode, string>> = {
  or: "OPENROUTER_API_KEYS",
  nv: "NVIDIA_API_KEYS",
  gg: "GOOGLE_API_KEYS",
  oa: "OPENAI_API_KEYS",
  an: "ANTHROPIC_API_KEYS",
  gq: "GROQ_API_KEYS",
  cb: "CEREBRAS_API_KEYS",
  ds: "DEEPSEEK_API_KEYS",
  ms: "MISTRAL_API_KEYS",
  tg: "TOGETHER_API_KEYS",
  zn: "ZEN_API_KEYS",
  tp: "TESTPROVIDER_API_KEYS",
  gc: "GCP_KEYS",
};

const INVALID_PLACEHOLDERS = new Set([
  "changeme",
  "todo",
  "your_key_here",
  "undefined",
  "null",
  "",
]);

function isUsableKey(rawKey: string): boolean {
  const normalized = rawKey.trim().toLowerCase();
  if (INVALID_PLACEHOLDERS.has(normalized)) {
    return false;
  }
  return normalized.length >= 4;
}

export function parseKeyList(rawEnvValue: string | undefined): readonly string[] {
  if (!rawEnvValue) {
    return [];
  }
  const tokens = rawEnvValue.split(",");
  const validKeys: string[] = [];
  for (const token of tokens) {
    const trimmed = token.trim();
    if (isUsableKey(trimmed)) {
      validKeys.push(trimmed);
    }
  }
  return Object.freeze(validKeys);
}

export function maskKey(apiKey: string): string {
  if (apiKey.length <= 8) {
    return "****";
  }
  const start = apiKey.slice(0, 4);
  const end = apiKey.slice(-4);
  return `${start}...${end}`;
}

export function getProviderEnvVarName(provider: ProviderCode): string {
  if (isRegisteredProvider(provider)) {
    const config = getProviderConfig(provider);
    if (config.env_key) {
      return config.env_key;
    }
  }
  return PROVIDER_ENV_MAP[provider];
}

export function loadKeyPools(
  envSource: Record<string, string | undefined>
): ReadonlyMap<ProviderCode, readonly string[]> {
  const poolMap = new Map<ProviderCode, readonly string[]>();
  const codes = new Set<ProviderCode>(
    Object.keys(PROVIDER_ENV_MAP) as ProviderCode[]
  );

  for (const provider of getAllProviders()) {
    codes.add(provider.code as ProviderCode);
  }

  for (const code of codes) {
    const envName = getProviderEnvVarName(code);
    let rawVal = envName ? envSource[envName] : undefined;
    if (code === "gc" && !rawVal) {
      rawVal = envSource.GCP_API_KEYS;
    }
    const parsedKeys = parseKeyList(rawVal);
    poolMap.set(code, parsedKeys);
  }
  return poolMap;
}

export function validateKeyPools(
  pools: ReadonlyMap<ProviderCode, readonly string[]>
): Record<string, number> {
  const summary: Record<string, number> = {};
  for (const [code, keys] of pools.entries()) {
    summary[code] = keys.length;
  }
  return summary;
}
