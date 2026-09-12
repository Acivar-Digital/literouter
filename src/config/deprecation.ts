import { resolveEngine, getEnv } from "./env";

export const DEPRECATED_ENV_VARS: Readonly<Record<string, string>> = Object.freeze({
  "LITEROUTER_AUTH_KEY": "Removed. Client auth uses directive keys (lr-...).",
  "LITEROUTER_PACER_ENABLED": "Moved to config/providers.json -> pacer.enabled",
  "LITEROUTER_PACER_MAX_RPM": "Moved to config/providers.json -> pacer.min_delay_ms",
  "LITEROUTER_PACER_MAX_QUEUE_DEPTH": "Moved to config/providers.json -> pacer.max_queue_depth",
  "LITEROUTER_PACER_MAX_QUEUE_WAIT_MS": "Moved to config/providers.json -> pacer.max_queue_wait_ms",
  "COOLDOWN_RATE_LIMIT_TTL_SEC": "Moved to config/providers.json -> key_cooldown",
  "COOLDOWN_SERVER_ERROR_TTL_SEC": "Moved to config/providers.json -> key_cooldown",
  "COOLDOWN_AUTH_ERROR_TTL_SEC": "Moved to config/providers.json -> key_cooldown",
  "OPENROUTER_BASE_URL": "Moved to config/providers.json -> base_url",
  "NVIDIA_BASE_URL": "Moved to config/providers.json -> base_url",
  "OPENROUTER_MIN_DELAY_MS": "Moved to config/providers.json -> pacer.min_delay_ms",
  "NVIDIA_MIN_DELAY_MS": "Moved to config/providers.json -> pacer.min_delay_ms",
  "ZEN_MIN_DELAY_MS": "Moved to config/providers.json -> pacer.min_delay_ms",
  "GOOGLE_MIN_DELAY_MS": "Moved to config/providers.json -> pacer.min_delay_ms",
  "GCP_MIN_DELAY_MS": "Moved to config/providers.json -> pacer.min_delay_ms",
  "GCP_PACER_MAX_QUEUE_WAIT_MS": "Moved to config/providers.json -> pacer.max_queue_wait_ms",
  "GCP_ENABLE_RETRIES": "Moved to config/providers.json -> request_retry.enabled",
  "GCP_ENABLE_QUARANTINE": "Moved to config/providers.json -> key_cooldown.enabled",
  "GCP_ENABLE_CIRCUIT_BREAKER": "Moved to config/providers.json -> circuit_breaker.enabled",
  "GCP_ENABLE_PACER": "Moved to config/providers.json -> pacer.enabled",
  "ZEN_ENABLE_RETRIES": "Moved to config/providers.json -> request_retry.enabled (strategy: zen_single_flight)",
  "ZEN_ENABLE_QUARANTINE": "Moved to config/providers.json -> key_cooldown.enabled",
  "ZEN_ENABLE_CIRCUIT_BREAKER": "Moved to config/providers.json -> circuit_breaker.enabled",
  "ZEN_ENABLE_PACER": "Moved to config/providers.json -> pacer.enabled",
  "LITEROUTER_HTTP_REFERER": "Moved to config/providers.json -> headers",
  "LITEROUTER_X_TITLE": "Moved to config/providers.json -> headers",
  "LITEROUTER_USER_AGENT": "Moved to config/providers.json -> headers",
  "OPENROUTER_ENABLE_QUARANTINE": "Moved to config/providers.json -> key_cooldown.enabled",
  "LITEROUTER_CIRCUIT_BREAKER": "Moved to config/providers.json -> circuit_breaker.enabled",
});

export function emitEnvDeprecationWarnings(): void {
  const isV4 = resolveEngine() === "v4.1" || getEnv().LITEROUTER_ENGINE === "v4.1";
  if (!isV4) {
    return;
  }

  for (const [envVar, message] of Object.entries(DEPRECATED_ENV_VARS)) {
    if (process.env[envVar] !== undefined) {
      console.warn(`⚠️  [DEPRECATION] "${envVar}" is set but IGNORED in v4.1 engine. ${message}`);
    }
  }
}
