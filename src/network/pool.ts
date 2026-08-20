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

export class KeyPool {
  private readonly pools = new Map<string, readonly string[]>();
  private readonly pointers = new Map<string, number>();
  private readonly cooldownManager: CooldownManager;

  public constructor(cooldownManager?: CooldownManager) {
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

  public reportSuccess(provider: string, index: number): void {
    const keyId = this.makeKeyId(provider, index);
    this.cooldownManager.clearCooldown(keyId);
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
    return this.cooldownManager.quarantineKey(keyId, status, headers, body, now, customTtlSec);
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
    return this.cooldownManager.quarantineKeyWithTtl(keyId, ttlSec, reason, status, now);
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

  public reset(): void {
    this.pointers.clear();
    this.cooldownManager.clearAll();
  }
}
