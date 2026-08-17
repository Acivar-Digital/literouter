import type { FusionTier } from "../config/schema";

export interface StickyPosition {
  readonly tierPriority: number;
  readonly apikey: string;
  readonly model: string;
  readonly expiresAt: number;
}

export const FUSION_STICKY_TTL_MS = 300000; // 5 minutes

function makeCacheKey(preset: string, model: string): string {
  return `${preset}:${model}`;
}

export class StickyPositionCache {
  private readonly positions = new Map<string, StickyPosition>();
  private readonly defaultTtlMs: number;

  public constructor(ttlMs: number = FUSION_STICKY_TTL_MS) {
    this.defaultTtlMs = ttlMs;
  }

  public getStickyTier(
    preset: string,
    model: string,
    now: number = Date.now()
  ): StickyPosition | null {
    const key = makeCacheKey(preset, model);
    const entry = this.positions.get(key);
    if (!entry) {
      return null;
    }
    if (now >= entry.expiresAt) {
      this.positions.delete(key);
      return null;
    }
    return entry;
  }

  public setStickyTier(
    preset: string,
    model: string,
    tier: FusionTier,
    customTtlMs?: number,
    now: number = Date.now()
  ): void {
    const key = makeCacheKey(preset, model);
    const ttl = customTtlMs ?? this.defaultTtlMs;
    const entry: StickyPosition = {
      tierPriority: tier.priority,
      apikey: tier.apikey,
      model: tier.model,
      expiresAt: now + ttl,
    };
    this.positions.set(key, entry);
  }

  public clearStickyTier(preset: string, model: string): void {
    const key = makeCacheKey(preset, model);
    this.positions.delete(key);
  }

  public clearAll(): void {
    this.positions.clear();
  }
}
