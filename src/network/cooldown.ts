export interface KeyCooldownState {
  readonly quarantinedUntil: number;
  readonly reason: string;
  readonly lastErrorStatus?: number;
}

export interface ParsedResetDelay {
  readonly delayMs: number;
  readonly isGraceRetry: boolean;
}

const DEFAULT_COOLDOWN_SEC = 30;
const RATE_LIMIT_DEFAULT_SEC = 65;
const SERVER_ERROR_DEFAULT_SEC = 10;
const AUTH_ERROR_DEFAULT_SEC = 604800; // 7 days

const MIN_CLAMP_MS = 5000;
const MAX_CLAMP_MS = 7200000; // 2 hours
const GRACE_RETRY_THRESHOLD_MS = 2000;

const EXHAUSTION_LADDER_MS = Object.freeze([65000, 90000, 120000]);

function clampDuration(delayMs: number): number {
  if (delayMs < MIN_CLAMP_MS) {
    return MIN_CLAMP_MS;
  }
  if (delayMs > MAX_CLAMP_MS) {
    return MAX_CLAMP_MS;
  }
  return delayMs;
}

function parseDateHeader(val: string): number | null {
  const dateMs = Date.parse(val);
  if (Number.isNaN(dateMs)) {
    return null;
  }
  const diff = dateMs - Date.now();
  return diff > 0 ? diff : 0;
}

function parseHeaderValue(headerVal: string | null | undefined): number | null {
  if (!headerVal) {
    return null;
  }
  const trimmed = headerVal.trim();
  const numericSec = Number.parseFloat(trimmed);
  if (!Number.isNaN(numericSec) && numericSec > 0) {
    return Math.round(numericSec * 1000);
  }
  return parseDateHeader(trimmed);
}

function extractMatchMs(pattern: RegExp, text: string): number | null {
  const match = pattern.exec(text);
  if (!match || !match[1]) {
    return null;
  }
  const val = Number.parseFloat(match[1]);
  const isMs = match[2]?.toLowerCase() === "ms";
  return isMs ? Math.round(val) : Math.round(val * 1000);
}

const QUOTA_RESET_REGEX = /quotaResetDelay["']?\s*:\s*["']?(\d+(?:\.\d+)?)(s|ms)?/i;
const RETRY_AFTER_REGEX = /retry[_-]?after["']?\s*:\s*["']?(\d+(?:\.\d+)?)(s|ms)?/i;

function parseBodyRegex(bodyText: string | undefined): number | null {
  if (!bodyText) {
    return null;
  }
  const quotaMs = extractMatchMs(QUOTA_RESET_REGEX, bodyText);
  if (quotaMs !== null) {
    return quotaMs;
  }
  return extractMatchMs(RETRY_AFTER_REGEX, bodyText);
}

function getHeaderString(headers?: Headers | Record<string, string>): string | null | undefined {
  if (!headers) {
    return undefined;
  }
  if (headers instanceof Headers) {
    return headers.get("retry-after");
  }
  return headers["retry-after"];
}

export function parseResetDelay(
  headers?: Headers | Record<string, string>,
  errorBody?: string
): ParsedResetDelay {
  const headerVal = getHeaderString(headers);
  const extractedMs = parseHeaderValue(headerVal) ?? parseBodyRegex(errorBody);

  if (extractedMs === null) {
    return { delayMs: RATE_LIMIT_DEFAULT_SEC * 1000, isGraceRetry: false };
  }
  const isGrace = extractedMs > 0 && extractedMs <= GRACE_RETRY_THRESHOLD_MS;
  const delayMs = isGrace ? extractedMs : clampDuration(extractedMs);
  return { delayMs, isGraceRetry: isGrace };
}

const STATUS_TTL_MAP: Readonly<Record<number, number>> = {
  429: RATE_LIMIT_DEFAULT_SEC,
  401: AUTH_ERROR_DEFAULT_SEC,
  403: AUTH_ERROR_DEFAULT_SEC,
  400: 0,
  404: 0,
  500: SERVER_ERROR_DEFAULT_SEC,
  502: SERVER_ERROR_DEFAULT_SEC,
  503: SERVER_ERROR_DEFAULT_SEC,
  504: SERVER_ERROR_DEFAULT_SEC,
};

export function computeStatusTtlSec(status: number): number {
  const mapped = STATUS_TTL_MAP[status];
  if (mapped !== undefined) {
    return mapped;
  }
  return DEFAULT_COOLDOWN_SEC;
}

export function getExhaustionBackoffMs(attemptCount: number): number {
  const safeIndex = Math.min(Math.max(0, attemptCount), EXHAUSTION_LADDER_MS.length - 1);
  const fallback = EXHAUSTION_LADDER_MS[0] ?? 65000;
  return EXHAUSTION_LADDER_MS[safeIndex] ?? fallback;
}

export class CooldownManager {
  private readonly states = new Map<string, KeyCooldownState>();

  public isQuarantined(keyId: string, now: number = Date.now()): boolean {
    const state = this.states.get(keyId);
    if (!state) {
      return false;
    }
    if (now >= state.quarantinedUntil) {
      this.states.delete(keyId);
      return false;
    }
    return true;
  }

  public getRemainingMs(keyId: string, now: number = Date.now()): number {
    const state = this.states.get(keyId);
    if (!state) {
      return 0;
    }
    const remaining = state.quarantinedUntil - now;
    return remaining > 0 ? remaining : 0;
  }

  public getMinQuarantineTtlMs(provider: string, now: number = Date.now()): number {
    const prefix = `${provider}:`;
    let minTtl = Number.POSITIVE_INFINITY;

    for (const [keyId, state] of this.states.entries()) {
      if (keyId === provider || keyId.startsWith(prefix)) {
        if (now >= state.quarantinedUntil) {
          this.states.delete(keyId);
          continue;
        }
        const remaining = state.quarantinedUntil - now;
        if (remaining > 0 && remaining < minTtl) {
          minTtl = remaining;
        }
      }
    }

    return Number.isFinite(minTtl) ? minTtl : 0;
  }

  public quarantineKey(
    keyId: string,
    status: number,
    headers?: Headers | Record<string, string>,
    errorBody?: string,
    now: number = Date.now(),
    customTtlSec?: number
  ): KeyCooldownState {
    let ttlMs = customTtlSec !== undefined ? customTtlSec * 1000 : computeStatusTtlSec(status) * 1000;
    if (customTtlSec === undefined && status === 429) {
      const reset = parseResetDelay(headers, errorBody);
      ttlMs = reset.delayMs;
    }
    const state: KeyCooldownState = {
      quarantinedUntil: now + ttlMs,
      reason: `HTTP ${status}`,
      lastErrorStatus: status,
    };
    if (ttlMs > 0) {
      this.states.set(keyId, state);
    }
    return state;
  }

  public quarantineKeyWithTtl(
    keyId: string,
    ttlSec: number,
    reason: string = "quarantined",
    status?: number,
    now: number = Date.now()
  ): KeyCooldownState {
    const ttlMs = ttlSec * 1000;
    const state: KeyCooldownState = {
      quarantinedUntil: now + ttlMs,
      reason,
      lastErrorStatus: status,
    };
    if (ttlMs > 0) {
      this.states.set(keyId, state);
    }
    return state;
  }

  public clearCooldown(keyId: string): void {
    this.states.delete(keyId);
  }

  public clearAll(): void {
    this.states.clear();
  }
}
