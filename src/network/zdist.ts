export interface RateLimitStatus {
  readonly currentRpm: number;
  readonly currentRpd: number;
  readonly isRpmExceeded: boolean;
  readonly isRpdExceeded: boolean;
  readonly isNearThreshold: boolean;
}

const PREEMPTIVE_THRESHOLD_RATIO = 0.95;
const RPM_WINDOW_MS = 60000;

function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

interface KeyUsageRecord {
  timestamps: number[];
  dailyCount: number;
  dailyDate: string;
}

export class RateLimitTracker {
  private readonly usage = new Map<string, KeyUsageRecord>();

  private getKeyId(provider: string, keyIndex: number): string {
    return `${provider}:${keyIndex}`;
  }

  private getOrCreateRecord(keyId: string, now: number): KeyUsageRecord {
    const today = formatUtcDate(new Date(now));
    let record = this.usage.get(keyId);
    if (!record) {
      record = { timestamps: [], dailyCount: 0, dailyDate: today };
      this.usage.set(keyId, record);
      return record;
    }
    if (record.dailyDate !== today) {
      record.dailyDate = today;
      record.dailyCount = 0;
    }
    return record;
  }

  private pruneOldTimestamps(record: KeyUsageRecord, now: number): void {
    const windowStart = now - RPM_WINDOW_MS;
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);
  }

  public recordRequest(provider: string, keyIndex: number, now: number = Date.now()): void {
    const keyId = this.getKeyId(provider, keyIndex);
    const record = this.getOrCreateRecord(keyId, now);
    this.pruneOldTimestamps(record, now);
    record.timestamps.push(now);
    record.dailyCount += 1;
  }

  private isExceeded(current: number, limit: number): boolean {
    return limit > 0 && current >= limit;
  }

  private isNearLimit(current: number, limit: number): boolean {
    if (limit <= 0) {
      return false;
    }
    const threshold = Math.floor(limit * PREEMPTIVE_THRESHOLD_RATIO);
    return current >= threshold;
  }

  public checkLimits(
    provider: string,
    keyIndex: number,
    rpmLimit: number,
    rpdLimit: number,
    now: number = Date.now()
  ): RateLimitStatus {
    const keyId = this.getKeyId(provider, keyIndex);
    const record = this.getOrCreateRecord(keyId, now);
    this.pruneOldTimestamps(record, now);

    const rpm = record.timestamps.length;
    const rpd = record.dailyCount;
    const isRpmExceeded = this.isExceeded(rpm, rpmLimit);
    const isRpdExceeded = this.isExceeded(rpd, rpdLimit);

    const nearRpm = this.isNearLimit(rpm, rpmLimit);
    const nearRpd = this.isNearLimit(rpd, rpdLimit);

    return {
      currentRpm: rpm,
      currentRpd: rpd,
      isRpmExceeded,
      isRpdExceeded,
      isNearThreshold: nearRpm || nearRpd,
    };
  }

  public reset(): void {
    this.usage.clear();
  }
}
