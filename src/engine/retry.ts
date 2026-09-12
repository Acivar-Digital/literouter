/**
 * Uniform random bounded retry delay calculation.
 */

export interface RetryDelayConfig {
  min_ms: number;
  max_ms: number;
}

export function calculateRetryDelay(
  config: RetryDelayConfig,
  attempt: number
): number {
  void attempt; // reserved for potential future attempt-aware backoff strategies

  const min = Math.min(config.min_ms, config.max_ms);
  const max = Math.max(config.min_ms, config.max_ms);

  if (min === max) {
    return Math.round(min);
  }

  const range = max - min;
  const jitter = Math.random() * range;
  return Math.round(min + jitter);
}
