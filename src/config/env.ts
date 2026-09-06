import { EnvConfigSchema, type EnvConfig } from "./schema";

const DEFAULT_ENV_RECORD: Record<string, string> = {
  LITEROUTER_PORT: "7766",
  LITEROUTER_HOST: "0.0.0.0",
  LITEROUTER_AUTH_KEY: "",
  LITEROUTER_TLS_ENABLED: "false",
  LITEROUTER_HTTP2: "true",
  LITEROUTER_STRIP_REASONING: "false",
  LITEROUTER_AO_STRIP_REASONING: "true",
  LITEROUTER_AO_MAX_TOKENS: "32768",
  LITEROUTER_ENABLE_SCRUBBING: "false",
  LITEROUTER_TTFT_TIMEOUT_MS: "120000",
  LITEROUTER_NO_RESPONSE_TIMEOUT_MS: "120000",
  LITEROUTER_STREAM_IDLE_TIMEOUT_MS: "120000",
  LITEROUTER_HTTP_TIMEOUT_MS: "300000",
  LITEROUTER_IDLE_TIMEOUT_SEC: "60",
  COOLDOWN_RATE_LIMIT_TTL_SEC: "65",
  COOLDOWN_SERVER_ERROR_TTL_SEC: "10",
  COOLDOWN_AUTH_ERROR_TTL_SEC: "604800",
  FUSION_STICKY_TTL_MS: "300000",
  STREAM_STALL_MAX_RESENDS: "2",
  KEEPALIVE_INTERVAL_MS: "15000",
  LITEROUTER_HTTP_REFERER: "https://opencode.ai",
  LITEROUTER_X_TITLE: "OpenCode",
  LITEROUTER_USER_AGENT: "OpenCode/1.0.0",
  LITEROUTER_H2_OUTBOUND: "true",
  LITEROUTER_PACER_ENABLED: "true",
  LITEROUTER_CIRCUIT_BREAKER: "true",
  LITEROUTER_PACER_MAX_RPM: "600",
  LITEROUTER_PACER_MAX_QUEUE_DEPTH: "100",
  LITEROUTER_PACER_MAX_QUEUE_WAIT_MS: "15000",
  OPENROUTER_MIN_DELAY_MS: "200",
  NVIDIA_MIN_DELAY_MS: "200",
  ZEN_MIN_DELAY_MS: "200",
  GOOGLE_MIN_DELAY_MS: "200",
  GCP_MIN_DELAY_MS: "2000",
  GCP_PACER_MAX_QUEUE_WAIT_MS: "240000",
  GCP_ENABLE_RETRIES: "true",
  GCP_ENABLE_QUARANTINE: "true",
  GCP_ENABLE_CIRCUIT_BREAKER: "false",
  GCP_ENABLE_PACER: "true",
  ZEN_ENABLE_RETRIES: "true",
  ZEN_ENABLE_QUARANTINE: "true",
  ZEN_ENABLE_CIRCUIT_BREAKER: "false",
  ZEN_ENABLE_PACER: "true",
  TEST_PROVIDER_MIN_DELAY_MS: "0",
  MOCK_TP_PORT: "8999",
  LOG_LEVEL: "info",
};

function parseSafeEnv(source: Record<string, string | undefined>): EnvConfig {
  const normalized: Record<string, string | undefined> = { ...source };
  if (!normalized.LITEROUTER_IDLE_TIMEOUT_SEC && normalized.LITEROUTER_IDLE_TIMEOUT) {
    normalized.LITEROUTER_IDLE_TIMEOUT_SEC = normalized.LITEROUTER_IDLE_TIMEOUT;
  }
  if (!normalized.LITEROUTER_STREAM_IDLE_TIMEOUT_MS && normalized.LITEROUTER_STREAM_IDLE_TIMEOUT) {
    const val = Number(normalized.LITEROUTER_STREAM_IDLE_TIMEOUT);
    normalized.LITEROUTER_STREAM_IDLE_TIMEOUT_MS = String(val < 1000 ? val * 1000 : val);
  }
  if (!normalized.LITEROUTER_HTTP_TIMEOUT_MS && normalized.LITEROUTER_HTTP_TIMEOUT) {
    const val = Number(normalized.LITEROUTER_HTTP_TIMEOUT);
    normalized.LITEROUTER_HTTP_TIMEOUT_MS = String(val < 1000 ? val * 1000 : val);
  }
  if (!normalized.LITEROUTER_TTFT_TIMEOUT_MS && normalized.LITEROUTER_TTFT_TIMEOUT) {
    const val = Number(normalized.LITEROUTER_TTFT_TIMEOUT);
    normalized.LITEROUTER_TTFT_TIMEOUT_MS = String(val < 1000 ? val * 1000 : val);
  }
  if (!normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS && normalized.LITEROUTER_NO_RESPONSE_TIMEOUT) {
    const val = Number(normalized.LITEROUTER_NO_RESPONSE_TIMEOUT);
    normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS = String(val < 1000 ? val * 1000 : val);
  }
  if (!normalized.LITEROUTER_TTFT_TIMEOUT_MS && normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS) {
    normalized.LITEROUTER_TTFT_TIMEOUT_MS = normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS;
  }
  if (!normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS && normalized.LITEROUTER_TTFT_TIMEOUT_MS) {
    normalized.LITEROUTER_NO_RESPONSE_TIMEOUT_MS = normalized.LITEROUTER_TTFT_TIMEOUT_MS;
  }
  if (normalized.LITEROUTER_HTTP2 === undefined && normalized.LITEROUTER_ENFORCE_HTTP2 !== undefined) {
    normalized.LITEROUTER_HTTP2 = normalized.LITEROUTER_ENFORCE_HTTP2;
  }
  if (!normalized.LITEROUTER_HTTP_REFERER) {
    normalized.LITEROUTER_HTTP_REFERER = "https://opencode.ai";
  }
  if (!normalized.LITEROUTER_X_TITLE) {
    normalized.LITEROUTER_X_TITLE = "OpenCode";
  }
  if (!normalized.LITEROUTER_USER_AGENT) {
    normalized.LITEROUTER_USER_AGENT = "OpenCode/1.0.0";
  }
  const result = EnvConfigSchema.safeParse(normalized);
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
