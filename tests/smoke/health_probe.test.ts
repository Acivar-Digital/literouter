import { beforeEach, describe, expect, it } from "bun:test";
import { handleAppRequest, resetAllState } from "../../src/lib";

describe("Gateway Smoke Health Probes", () => {
  beforeEach(() => {
    resetAllState();
  });

  it("GET /health responds with 200 OK and healthy status under 50ms", async () => {
    const start = performance.now();
    const req = new Request("http://localhost:7766/health", {
      method: "GET",
    });

    const res = await handleAppRequest(req);
    const duration = performance.now() - start;

    expect(res.status).toBe(200);
    expect(duration).toBeLessThan(50);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("healthy");
    expect(body.uptime).toBeDefined();
    expect(body.timestamp).toBeDefined();
  });

  it("GET /v1/models probe with valid key returns 200 OK", async () => {
    const req = new Request("http://localhost:7766/v1/models", {
      method: "GET",
      headers: { Authorization: "Bearer lr-or-cl-ms-no" },
    });

    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { object: string };
    expect(body.object).toBe("list");
  });
});
