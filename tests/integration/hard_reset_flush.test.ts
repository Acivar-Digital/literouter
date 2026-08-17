import { beforeEach, describe, expect, it } from "bun:test";
import { getCooldownState, handleAppRequest, resetAllState } from "../../src/lib";

describe("Operational Hard Reset & Flush Integration", () => {
  beforeEach(() => {
    resetAllState();
  });

  it("handles GET /reset and flushes all rate limits and quarantines", async () => {
    const req = new Request("http://localhost:7766/reset", {
      method: "GET",
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");

    const cooldowns = getCooldownState();
    expect(Object.keys(cooldowns).length).toBe(0);
  });

  it("handles POST /reset unfreezing quarantined key states", async () => {
    const req = new Request("http://localhost:7766/reset", {
      method: "POST",
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
  });
});
