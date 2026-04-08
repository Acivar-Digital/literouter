/**
 * src/router.ts
 *
 * Minimal round-robin API key router.
 * Manages key rotation, 429 cooldowns, and 401/403 quarantine.
 */

import { getConfig } from "./config.js";
import { logger } from "./logger.js";

let counter = 0;
const deadKeys = new Set<string>();
const cooldowns = new Map<string, number>();

/**
 * Returns the next available API key in the rotation.
 * Deterministic: tries keys in order starting from the current counter.
 */
export function getNextKey(): string | null {
  const { apiKeys } = getConfig();
  const alive = apiKeys.filter((k) => !deadKeys.has(k));

  if (alive.length === 0) return null;

  const now = Date.now();
  const start = counter % alive.length;

  for (let i = 0; i < alive.length; i++) {
    const idx = (start + i) % alive.length;
    const key = alive[idx];
    const coolUntil = cooldowns.get(key) ?? 0;

    if (now >= coolUntil) {
      counter = (start + i + 1) % alive.length; // Advance counter for next call
      return key;
    }
  }

  return null; // All alive keys are on cooldown
}

/**
 * Handles provider errors by updating the state of the key.
 * 429 -> 60s cooldown
 * 401, 403 -> quarantine permanently
 */
export function reportError(key: string, status: number) {
  if (status === 429) {
    const cooldownMs = 60_000;
    cooldowns.set(key, Date.now() + cooldownMs);
    logger.info(`429 error for key ${key.slice(0, 10)}... | 60s cooldown`);
  } else if (status === 401 || status === 403) {
    deadKeys.add(key);
    logger.warn(`${status} error for key ${key.slice(0, 10)}... | Quarantined permanently`);
  }
}

/**
 * Returns current status of the router (cooldowns, dead keys).
 */
export function getRouterStatus() {
  const { apiKeys } = getConfig();
  const now = Date.now();
  const activeCooldowns = Array.from(cooldowns.entries())
    .filter(([_, until]) => until > now)
    .map(([key, until]) => ({
      key: `${key.slice(0, 10)}...`,
      remainingSec: Math.ceil((until - now) / 1000),
    }));

  return {
    totalKeys: apiKeys.length,
    deadKeysCount: deadKeys.size,
    quarantinedKeys: Array.from(deadKeys).map((k) => `${k.slice(0, 10)}...`),
    activeCooldowns,
    counterPosition: counter,
  };
}
