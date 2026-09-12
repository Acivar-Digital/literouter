import { getEnv } from "../config/env";

let isDraining = false;
const inFlightRequests = new Set<Promise<unknown>>();
const listeners = new Set<() => void>();

function notifyIfDrained(): void {
  if (inFlightRequests.size === 0) {
    for (const listener of listeners) {
      listener();
    }
  }
}

/**
 * Tracks an in-flight promise. Removes it upon settlement and notifies drain listeners.
 */
export function trackInFlight<T>(promise: Promise<T>): Promise<T> {
  const untyped = promise as Promise<unknown>;
  inFlightRequests.add(untyped);

  const cleanup = (): void => {
    inFlightRequests.delete(untyped);
    if (isDraining) {
      notifyIfDrained();
    }
  };

  promise.then(cleanup, cleanup);
  return promise;
}

/**
 * Returns current count of in-flight requests.
 */
export function getInFlightCount(): number {
  return inFlightRequests.size;
}

/**
 * Initiates draining of all tracked in-flight requests.
 * Resolves when all requests complete or timeout is reached.
 */
export async function drainInFlight(timeoutMs?: number): Promise<void> {
  isDraining = true;
  if (inFlightRequests.size === 0) {
    return;
  }

  const defaultTimeout = (getEnv().LITEROUTER_IDLE_TIMEOUT_SEC ?? 60) * 1000;
  const effectiveTimeout = timeoutMs ?? defaultTimeout;

  await new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const onDone = (): void => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      listeners.delete(onDone);
      resolve();
    };

    listeners.add(onDone);

    timer = setTimeout(() => {
      listeners.delete(onDone);
      resolve();
    }, effectiveTimeout);
  });
}

/**
 * Resets drain state (primarily for unit tests).
 */
export function resetDrainState(): void {
  isDraining = false;
  inFlightRequests.clear();
  listeners.clear();
}

/**
 * Registers process-level signal handlers for graceful shutdown.
 */
export function registerShutdownHandlers(
  onDrainComplete?: () => void | Promise<void>
): void {
  const handleSignal = async (signal: string): Promise<void> => {
    console.log(`[SHUTDOWN] Received ${signal}. Draining ${getInFlightCount()} in-flight requests...`);
    await drainInFlight();
    if (onDrainComplete) {
      await onDrainComplete();
    }
  };

  process.on("SIGINT", () => {
    void handleSignal("SIGINT");
  });

  process.on("SIGTERM", () => {
    void handleSignal("SIGTERM");
  });
}
