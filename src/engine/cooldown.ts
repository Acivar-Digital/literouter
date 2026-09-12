import type { KeyCooldownConfig } from "../config/schema";

/**
 * Calculates cooldown duration with exponential backoff, jitter, and Retry-After support.
 */
export function calculateCooldownMs(
  config: KeyCooldownConfig,
  consecutiveFailures: number,
  retryAfterMs?: number
): number {
  if (retryAfterMs !== undefined && config.respect_retry_after) {
    return Math.round(Math.max(0, retryAfterMs));
  }

  // Exponential backoff: initial * factor^failures
  const raw = config.initial_cooldown_ms * Math.pow(config.backoff_factor, consecutiveFailures);
  const capped = Math.min(raw, config.max_cooldown_ms);

  // Apply jitter: ± jitter_percent
  const jitterRange = capped * (config.jitter_percent / 100);
  const jitter = (Math.random() * 2 - 1) * jitterRange; // -jitterRange to +jitterRange

  return Math.round(Math.max(0, capped + jitter));
}
