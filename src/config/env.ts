import { EnvConfigSchema, type EnvConfig } from "./schema";

const DEFAULT_ENV_RECORD: Record<string, string> = {
  LITEROUTER_PORT: "7766",
  LITEROUTER_HOST: "0.0.0.0",
  LITEROUTER_TLS_ENABLED: "false",
  LITEROUTER_STRIP_REASONING: "true",
  LITEROUTER_NO_RESPONSE_TIMEOUT_MS: "5000",
  LITEROUTER_STREAM_IDLE_TIMEOUT_MS: "30000",
  LITEROUTER_HTTP_TIMEOUT_MS: "300000",
  COOLDOWN_RATE_LIMIT_TTL_SEC: "65",
  COOLDOWN_SERVER_ERROR_TTL_SEC: "10",
  COOLDOWN_AUTH_ERROR_TTL_SEC: "604800",
  FUSION_STICKY_TTL_MS: "300000",
  STREAM_STALL_MAX_RESENDS: "2",
  KEEPALIVE_INTERVAL_MS: "15000",
  LOG_LEVEL: "info",
};

function parseSafeEnv(source: Record<string, string | undefined>): EnvConfig {
  const result = EnvConfigSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }
  const fallback = EnvConfigSchema.parse(DEFAULT_ENV_RECORD);
  return fallback;
}

let cachedEnv: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (cachedEnv !== null) {
    return cachedEnv;
  }
  cachedEnv = parseSafeEnv(process.env);
  return cachedEnv;
}

export function resetEnvCache(): void {
  cachedEnv = null;
}

export function parseCustomEnv(customRecord: Record<string, string | undefined>): EnvConfig {
  return parseSafeEnv(customRecord);
}
