import { beforeEach, describe, expect, it } from "bun:test";
import { RateLimitTracker } from "../../src/network/zdist";

describe("Rate Limit Tracker — Sliding Window RPM", () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    tracker = new RateLimitTracker();
  });

  it("records requests and counts within sliding 60s window", () => {
    tracker.recordRequest("openrouter", 0);
    tracker.recordRequest("openrouter", 0);
    tracker.recordRequest("openrouter", 0);

    const status = tracker.checkLimits("openrouter", 0, 20, 1000);
    expect(status.currentRpm).toBe(3);
  });

  it("tracks RPM independently per key index", () => {
    tracker.recordRequest("nvidia", 0);
    tracker.recordRequest("nvidia", 1);
    tracker.recordRequest("nvidia", 1);

    expect(tracker.checkLimits("nvidia", 0, 20, 1000).currentRpm).toBe(1);
    expect(tracker.checkLimits("nvidia", 1, 20, 1000).currentRpm).toBe(2);
  });

  it("detects 95% threshold approach for RPM ceiling", () => {
    for (let i = 0; i < 18; i++) {
      tracker.recordRequest("openrouter", 0);
    }
    expect(tracker.checkLimits("openrouter", 0, 20, 1000).isNearThreshold).toBe(false);

    tracker.recordRequest("openrouter", 0);
    const status = tracker.checkLimits("openrouter", 0, 20, 1000);
    expect(status.currentRpm).toBe(19);
    expect(status.isNearThreshold).toBe(true);
  });
});

describe("Rate Limit Tracker — Daily RPD Quota", () => {
  let tracker: RateLimitTracker;

  beforeEach(() => {
    tracker = new RateLimitTracker();
  });

  it("records and returns daily cumulative requests", () => {
    for (let i = 0; i < 50; i++) {
      tracker.recordRequest("google", 0);
    }
    const status = tracker.checkLimits("google", 0, 1000, 1000);
    expect(status.currentRpd).toBe(50);
  });

  it("detects 95% threshold approach for daily RPD quota", () => {
    for (let i = 0; i < 94; i++) {
      tracker.recordRequest("google", 0);
    }
    expect(tracker.checkLimits("google", 0, 1000, 100).isNearThreshold).toBe(false);

    tracker.recordRequest("google", 0);
    const status = tracker.checkLimits("google", 0, 1000, 100);
    expect(status.currentRpd).toBe(95);
    expect(status.isNearThreshold).toBe(true);
  });

  it("clears all counters on hard reset", () => {
    tracker.recordRequest("zen", 0);
    tracker.recordRequest("zen", 0);
    expect(tracker.checkLimits("zen", 0, 10, 10).currentRpm).toBe(2);

    tracker.reset();
    expect(tracker.checkLimits("zen", 0, 10, 10).currentRpm).toBe(0);
    expect(tracker.checkLimits("zen", 0, 10, 10).currentRpd).toBe(0);
  });
});
