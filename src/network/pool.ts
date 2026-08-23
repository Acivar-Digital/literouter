import { EventEmitter } from "node:events";
import type { ProviderCode } from "../directive/parser";
import { CooldownManager, type KeyCooldownState } from "./cooldown";

export interface SelectedKey {
  readonly key: string;
  readonly index: number;
  readonly totalKeys: number;
}

export interface PoolStatus {
  readonly total: number;
  readonly active: number;
  readonly quarantined: number;
}

export class KeyPool extends EventEmitter {
  private readonly pools = new Map<string, readonly string[]>();
  private readonly pointers = new Map<string, number>();
  private readonly consecutiveAuthFailures = new Map<string, number>();
  private readonly activeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly cooldownManager: CooldownManager;

  public constructor(cooldownManager?: CooldownManager) {
    super();
    this.cooldownManager = cooldownManager ?? new CooldownManager();
  }

  public setPool(provider: ProviderCode | string, keys: readonly string[]): void {
    this.pools.set(provider, Object.freeze([...keys]));
    if (!this.pointers.has(provider)) {
      this.pointers.set(provider, 0);
    }
  }

  public getCooldownManager(): CooldownManager {
    return this.cooldownManager;
  }

  private makeKeyId(provider: string, index: number): string {
    return `${provider}:${index}`;
  }

  private getKeys(provider: string): readonly string[] {
    return this.pools.get(provider) ?? [];
  }

  private advancePointer(provider: string, total: number): void {
    const curr = this.pointers.get(provider) ?? 0;
    this.pointers.set(provider, (curr + 1) % total);
  }

  private tryPickIndex(
    provider: string,
    idx: number,
    keys: readonly string[],
    now: number
  ): SelectedKey | null {
    const keyId = this.makeKeyId(provider, idx);
    if (this.cooldownManager.isQuarantined(keyId, now)) {
      return null;
    }
    const key = keys[idx];
    if (!key) {
      return null;
    }
    this.advancePointer(provider, keys.length);
    return { key, index: idx, totalKeys: keys.length };
  }

  public selectNextKey(provider: ProviderCode | string, now: number = Date.now()): SelectedKey | null {
    const keys = this.getKeys(provider);
    const total = keys.length;
    if (total === 0) {
      return null;
    }
    const startIndex = this.pointers.get(provider) ?? 0;
    for (let offset = 0; offset < total; offset += 1) {
      const idx = (startIndex + offset) % total;
      const picked = this.tryPickIndex(provider, idx, keys, now);
      if (picked !== null) {
        return picked;
      }
    }
    return null;
  }

  private scheduleAvailabilityTimer(keyId: string, provider: string, ttlMs: number): void {
    const existing = this.activeTimers.get(keyId);
    if (existing) {
      clearTimeout(existing);
      this.activeTimers.delete(keyId);
    }
    if (ttlMs > 0) {
      const timer = setTimeout(() => {
        this.activeTimers.delete(keyId);
        this.emit(`available:${provider}`, provider);
        this.emit("available", provider);
      }, ttlMs);
      this.activeTimers.set(keyId, timer);
    }
  }

  public reportSuccess(provider: string, index: number): void {
    const keyId = this.makeKeyId(provider, index);
    this.cooldownManager.clearCooldown(keyId);
    this.consecutiveAuthFailures.delete(keyId);
    const existing = this.activeTimers.get(keyId);
    if (existing) {
      clearTimeout(existing);
      this.activeTimers.delete(keyId);
    }
    this.emit(`available:${provider}`, provider);
    this.emit("available", provider);
  }

  private computeTieredAuthTtl(keyId: string): number {
    const count = (this.consecutiveAuthFailures.get(keyId) ?? 0) + 1;
    this.consecutiveAuthFailures.set(keyId, count);
    if (count === 1) {
      return 300;
    }
    if (count === 2) {
      return 1800;
    }
    return 86400;
  }

  public reportFailure(
    provider: string,
    index: number,
    status: number,
    headers?: Headers | Record<string, string>,
    body?: string,
    now: number = Date.now(),
    customTtlSec?: number
  ): KeyCooldownState {
    const keyId = this.makeKeyId(provider, index);
    let effectiveTtlSec = customTtlSec;
    if ((status === 401 || status === 403) && customTtlSec === undefined) {
      effectiveTtlSec = this.computeTieredAuthTtl(keyId);
    }
    const state = this.cooldownManager.quarantineKey(keyId, status, headers, body, now, effectiveTtlSec);
    this.scheduleAvailabilityTimer(keyId, provider, state.quarantinedUntil - now);
    return state;
  }

  public quarantineKey(
    provider: string,
    index: number,
    ttlSec: number,
    reason?: string,
    status?: number,
    now: number = Date.now()
  ): KeyCooldownState {
    const keyId = this.makeKeyId(provider, index);
    const state = this.cooldownManager.quarantineKeyWithTtl(keyId, ttlSec, reason, status, now);
    this.scheduleAvailabilityTimer(keyId, provider, state.quarantinedUntil - now);
    return state;
  }

  public getConsecutiveAuthFailures(provider: string, index: number): number {
    const keyId = this.makeKeyId(provider, index);
    return this.consecutiveAuthFailures.get(keyId) ?? 0;
  }

  public async waitForKeyAvailable(
    provider: ProviderCode | string,
    timeoutMs: number,
    signal?: AbortSignal,
    now: number = Date.now()
  ): Promise<SelectedKey | null> {
    const immediate = this.selectNextKey(provider, now);
    if (immediate !== null) {
      return immediate;
    }
    if (timeoutMs <= 0 || signal?.aborted) {
      return null;
    }
    return new Promise<SelectedKey | null>((resolve) => {
      let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
      const eventName = `available:${provider}`;

      const cleanup = (): void => {
        if (timeoutTimer !== null) {
          clearTimeout(timeoutTimer);
          timeoutTimer = null;
        }
        this.removeListener(eventName, onAvailable);
        if (signal) {
          signal.removeEventListener("abort", onAbort);
        }
      };

      const onAvailable = (): void => {
        const selected = this.selectNextKey(provider);
        if (selected !== null) {
          cleanup();
          resolve(selected);
        }
      };

      const onAbort = (): void => {
        cleanup();
        resolve(null);
      };

      timeoutTimer = setTimeout(() => {
        cleanup();
        resolve(this.selectNextKey(provider));
      }, timeoutMs);

      this.on(eventName, onAvailable);
      if (signal) {
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  public getPoolSize(provider: string): number {
    return this.getKeys(provider).length;
  }

  public getStatus(provider: string, now: number = Date.now()): PoolStatus {
    const keys = this.getKeys(provider);
    const total = keys.length;
    let quarantined = 0;
    for (let i = 0; i < total; i += 1) {
      const keyId = this.makeKeyId(provider, i);
      if (this.cooldownManager.isQuarantined(keyId, now)) {
        quarantined += 1;
      }
    }
    return { total, active: total - quarantined, quarantined };
  }

  public getMinQuarantineTtlMs(provider: string, now: number = Date.now()): number {
    return this.cooldownManager.getMinQuarantineTtlMs(provider, now);
  }

  public getDynamicMaxQueueDepth(provider: string): number {
    const status = this.getStatus(provider);
    return Math.max(10, status.active * 10);
  }

  public shouldLoadShed(
    provider: string,
    currentDwellMs: number,
    maxWaitMs: number = 20000,
    now: number = Date.now()
  ): boolean {
    const status = this.getStatus(provider, now);
    if (status.active > 0) return false;
    if (status.total === 0) return false;
    const minTtl = this.getMinQuarantineTtlMs(provider, now);
    const remainingWaitMs = Math.max(0, maxWaitMs - currentDwellMs);
    return minTtl > remainingWaitMs;
  }

  private resetProvider(provider: string): void {
    this.pointers.delete(provider);
    const prefix = `${provider}:`;
    for (const [keyId, timer] of this.activeTimers) {
      if (keyId === provider || keyId.startsWith(prefix)) {
        clearTimeout(timer);
        this.activeTimers.delete(keyId);
      }
    }
    for (const keyId of this.consecutiveAuthFailures.keys()) {
      if (keyId === provider || keyId.startsWith(prefix)) {
        this.consecutiveAuthFailures.delete(keyId);
      }
    }
    const keys = this.getKeys(provider);
    for (let i = 0; i < keys.length; i += 1) {
      this.cooldownManager.clearCooldown(this.makeKeyId(provider, i));
    }
    this.emit(`available:${provider}`, provider);
    this.emit("available", provider);
  }

  public reset(provider?: string): void {
    if (provider) {
      this.resetProvider(provider);
      return;
    }
    this.pointers.clear();
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
    this.consecutiveAuthFailures.clear();
    this.cooldownManager.clearAll();
    this.emit("available");
  }
}
