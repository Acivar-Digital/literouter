import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetEnvCache } from "../../src/config/env";
import { handleAppRequest, resetAllState } from "../../src/lib";

describe("Hard Reset Endpoint (/reset)", () => {
  const originalAuthKey = process.env.LITEROUTER_AUTH_KEY;

  beforeEach(() => {
    process.env.LITEROUTER_AUTH_KEY = "test-admin-secret-key-123";
    resetEnvCache();
    resetAllState();
  });

  afterEach(() => {
    if (originalAuthKey !== undefined) {
      process.env.LITEROUTER_AUTH_KEY = originalAuthKey;
    } else {
      delete process.env.LITEROUTER_AUTH_KEY;
    }
    resetEnvCache();
    resetAllState();
  });

  it("rejects unauthorized access when no token is provided", async () => {
    const req = new Request("http://localhost:7766/reset", {
      method: "POST",
    });
    const res = await handleAppRequest(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string; type: string } };
    expect(body.error.type).toBe("authentication_error");
    expect(body.error.message).toBe("Unauthorized admin access");
  });

  it("rejects unauthorized access when an invalid token is provided", async () => {
    const req = new Request("http://localhost:7766/reset", {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid-secret-token",
      },
    });
    const res = await handleAppRequest(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string; type: string } };
    expect(body.error.type).toBe("authentication_error");
    expect(body.error.message).toBe("Unauthorized admin access");
  });

  it("allows access with valid master LITEROUTER_AUTH_KEY", async () => {
    const req = new Request("http://localhost:7766/reset", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-admin-secret-key-123",
      },
    });
    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; message: string; timestamp: string };
    expect(body.status).toBe("ok");
    expect(body.message).toContain("Hard reset successful");
  });

  it("allows access with valid directive token in Authorization header", async () => {
    const req = new Request("http://localhost:7766/reset", {
      method: "POST",
      headers: {
        Authorization: "Bearer lr-oa-oa-ch-no",
      },
    });
    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; message: string };
    expect(body.status).toBe("ok");
  });

  it("ensures /health remains public without authentication", async () => {
    const req = new Request("http://localhost:7766/health", {
      method: "GET",
    });
    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("healthy");
  });
});
