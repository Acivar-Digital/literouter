import type { ProviderPacerConfig } from "../config/schema";
import { getPacerForProvider } from "../network/pacer";

/**
 * Calculates a paced interval with jitter between min_delay_ms and max_delay_ms.
 */
export function calculatePacerIntervalMs(
  pacerConfig: Pick<ProviderPacerConfig, "min_delay_ms" | "max_delay_ms">
): number {
  if (pacerConfig.max_delay_ms > pacerConfig.min_delay_ms) {
    const jitterRange = pacerConfig.max_delay_ms - pacerConfig.min_delay_ms;
    return Math.round(pacerConfig.min_delay_ms + Math.random() * jitterRange);
  }
  return pacerConfig.min_delay_ms;
}

/**
 * Acquires a rate-limiting slot from the provider pacer.
 * If pacer is not enabled or configuration is undefined, returns immediately.
 *
 * @param provider Provider identifier (e.g. "or", "nv", "gg")
 * @param pacerConfig Declarative provider pacer configuration
 * @param signal Optional abort signal to cancel queued wait
 */
export async function acquirePacer(
  provider: string,
  pacerConfig: ProviderPacerConfig | undefined,
  signal?: AbortSignal
): Promise<void> {
  if (!pacerConfig?.enabled) return;

  const intervalMs = calculatePacerIntervalMs(pacerConfig);

  const pacer = getPacerForProvider(provider, 0, {
    minIntervalMs: intervalMs,
    maxQueueDepth: pacerConfig.max_queue_depth,
    maxQueueWaitMs: pacerConfig.max_queue_wait_ms,
  });

  await pacer.acquire(signal);
}
