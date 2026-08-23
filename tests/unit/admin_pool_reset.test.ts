import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetEnvCache } from "../../src/config/env";
import {
  globalCooldownManager,
  globalKeyPool,
  handleAppRequest,
  resetAllState,
} from "../../src/lib";

describe("Admin Pool Reset Endpoint (/admin/pool/reset)", () => {
  const originalAuthKey = process.env.LITEROUTER_AUTH_KEY;
  const originalOpenAiKeys = process.env.OPENAI_API_KEYS;

  beforeEach(() => {
    process.env.LITEROUTER_AUTH_KEY = "test-admin-secret-key-123";
    process.env.OPENAI_API_KEYS = "sk-test-key-1,sk-test-key-2";
    resetEnvCache();
    resetAllState();
  });

  afterEach(() => {
    if (originalAuthKey !== undefined) {
      process.env.LITEROUTER_AUTH_KEY = originalAuthKey;
    } else {
      delete process.env.LITEROUTER_AUTH_KEY;
    }
    if (originalOpenAiKeys !== undefined) {
      process.env.OPENAI_API_KEYS = originalOpenAiKeys;
    } else {
      delete process.env.OPENAI_API_KEYS;
    }
    resetEnvCache();
    resetAllState();
  });

  it("rejects unauthorized access when no token is provided", async () => {
    const req = new Request("http://localhost:7766/admin/pool/reset", {
      method: "POST",
    });
    const res = await handleAppRequest(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string; type: string } };
    expect(body.error.type).toBe("authentication_error");
    expect(body.error.message).toBe("Unauthorized admin access");
  });

  it("rejects unauthorized access when an invalid token is provided", async () => {
    const req = new Request("http://localhost:7766/admin/pool/reset", {
      method: "POST",
      headers: {
        Authorization: "Bearer invalid-token-xyz",
      },
    });
    const res = await handleAppRequest(req);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe("Unauthorized admin access");
  });

  it("allows access with valid master LITEROUTER_AUTH_KEY and performs hard reset if no provider", async () => {
    const req = new Request("http://localhost:7766/admin/pool/reset", {
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
    const req = new Request("http://localhost:7766/admin/pool/reset", {
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

  it("resets a specific provider via query parameter", async () => {
    globalCooldownManager.quarantineKey("or:0", 429);
    expect(globalCooldownManager.isQuarantined("or:0")).toBe(true);

    const req = new Request("http://localhost:7766/admin/pool/reset?provider=or", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-admin-secret-key-123",
      },
    });
    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; message: string; provider: string };
    expect(body.status).toBe("ok");
    expect(body.provider).toBe("or");
    expect(body.message).toContain("Reset pool for provider 'or'");
    expect(globalCooldownManager.isQuarantined("or:0")).toBe(false);
  });

  it("resets a specific provider via JSON body", async () => {
    globalCooldownManager.quarantineKey("nv:1", 500);
    expect(globalCooldownManager.isQuarantined("nv:1")).toBe(true);

    const req = new Request("http://localhost:7766/admin/pool/reset", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-admin-secret-key-123",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ provider: "NV " }),
    });
    const res = await handleAppRequest(req);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; message: string; provider: string };
    expect(body.status).toBe("ok");
    expect(body.provider).toBe("nv");
    expect(body.message).toContain("Reset pool for provider 'nv'");
    expect(globalCooldownManager.isQuarantined("nv:1")).toBe(false);
  });
});
