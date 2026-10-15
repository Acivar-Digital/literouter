import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetEnvCache } from "../../src/config/env";
import { verifyMasterSecret, resolveInferenceAuth } from "../../src/directive/validator";
import { handleAppRequest, resetAllState } from "../../src/lib";

describe("Step 1: Admin & Trace Authentication Lockdown", () => {
  const originalAuth = process.env.LITEROUTER_AUTH_KEY;

  beforeEach(() => {
    process.env.LITEROUTER_AUTH_KEY = "test-master-auth-secret";
    resetEnvCache();
    resetAllState();
  });

  afterEach(() => {
    if (originalAuth !== undefined) {
      process.env.LITEROUTER_AUTH_KEY = originalAuth;
    } else {
      delete process.env.LITEROUTER_AUTH_KEY;
    }
    resetEnvCache();
    resetAllState();
  });

  describe("verifyMasterSecret", () => {
    it("returns true for matching secrets", () => {
      expect(verifyMasterSecret("secret-123", "secret-123")).toBe(true);
    });

    it("returns false for non-matching secrets", () => {
      expect(verifyMasterSecret("secret-wrong", "secret-123")).toBe(false);
      expect(verifyMasterSecret("secret-1234", "secret-123")).toBe(false);
      expect(verifyMasterSecret("secret", "secret-123")).toBe(false);
    });

    it("returns false when candidate or expected is empty", () => {
      expect(verifyMasterSecret("", "secret-123")).toBe(false);
      expect(verifyMasterSecret("secret-123", "")).toBe(false);
      expect(verifyMasterSecret("", "")).toBe(false);
    });
  });

  describe("Admin /reset and /admin/pool/reset", () => {
    it("allows /reset with master auth key", async () => {
      const req = new Request("http://localhost:7766/reset", {
        method: "POST",
        headers: { Authorization: "Bearer test-master-auth-secret" },
      });
      const res = await handleAppRequest(req);
      expect(res.status).toBe(200);
      const json = await res.json() as { status: string };
      expect(json.status).toBe("ok");
    });

    it("rejects /reset with routing directive key", async () => {
      const req = new Request("http://localhost:7766/reset", {
        method: "POST",
        headers: { Authorization: "Bearer lr-or-oa-ch-no" },
      });
      const res = await handleAppRequest(req);
      expect(res.status).toBe(401);
      const json = await res.json() as { error: { message: string } };
      expect(json.error.message).toBe("Unauthorized admin access");
    });

    it("rejects /reset when LITEROUTER_AUTH_KEY is not configured", async () => {
      delete process.env.LITEROUTER_AUTH_KEY;
      resetEnvCache();
      const req = new Request("http://localhost:7766/reset", {
        method: "POST",
        headers: { Authorization: "Bearer test-master-auth-secret" },
      });
      const res = await handleAppRequest(req);
      expect(res.status).toBe(401);
      const json = await res.json() as { error: { message: string } };
      expect(json.error.message).toBe("Admin endpoints disabled: LITEROUTER_AUTH_KEY not configured");
    });

    it("allows /admin/pool/reset with master auth key", async () => {
      const req = new Request("http://localhost:7766/admin/pool/reset", {
        method: "POST",
        headers: { Authorization: "Bearer test-master-auth-secret" },
      });
      const res = await handleAppRequest(req);
      expect(res.status).toBe(200);
      const json = await res.json() as { status: string };
      expect(json.status).toBe("ok");
    });

    it("rejects /admin/pool/reset with routing directive key", async () => {
      const req = new Request("http://localhost:7766/admin/pool/reset", {
        method: "POST",
        headers: { Authorization: "Bearer lr-or-oa-ch-no" },
      });
      const res = await handleAppRequest(req);
      expect(res.status).toBe(401);
      const json = await res.json() as { error: { message: string } };
      expect(json.error.message).toBe("Unauthorized admin access");
    });
  });

  describe("Trace endpoint /v1/traces", () => {
    const originalEngine = process.env.LITEROUTER_ENGINE;

    beforeEach(() => {
      process.env.LITEROUTER_ENGINE = "v4.1";
      resetEnvCache();
    });

    afterEach(() => {
      if (originalEngine !== undefined) {
        process.env.LITEROUTER_ENGINE = originalEngine;
      } else {
        delete process.env.LITEROUTER_ENGINE;
      }
      resetEnvCache();
    });

    it("allows /v1/traces with master auth key", async () => {
      const req = new Request("http://localhost:7766/v1/traces", {
        method: "GET",
        headers: { Authorization: "Bearer test-master-auth-secret" },
      });
      const res = await handleAppRequest(req);
      expect(res.status).toBe(200);
      const json = await res.json() as { traces: unknown[] };
      expect(Array.isArray(json.traces)).toBe(true);
    });

    it("allows /v1/traces with x-literouter-key header", async () => {
      const req = new Request("http://localhost:7766/v1/traces", {
        method: "GET",
        headers: { "x-literouter-key": "test-master-auth-secret" },
      });
      const res = await handleAppRequest(req);
      expect(res.status).toBe(200);
    });

    it("rejects /v1/traces with routing directive key", async () => {
      const req = new Request("http://localhost:7766/v1/traces", {
        method: "GET",
        headers: { Authorization: "Bearer lr-or-oa-ch-no" },
      });
      const res = await handleAppRequest(req);
      expect(res.status).toBe(401);
      const json = await res.json() as { error: { message: string } };
      expect(json.error.message).toBe("Admin authentication required to access trace inspection endpoints");
    });

    it("rejects /v1/traces when LITEROUTER_AUTH_KEY is not configured", async () => {
      delete process.env.LITEROUTER_AUTH_KEY;
      resetEnvCache();
      const req = new Request("http://localhost:7766/v1/traces", {
        method: "GET",
        headers: { Authorization: "Bearer test-master-auth-secret" },
      });
      const res = await handleAppRequest(req);
      expect(res.status).toBe(401);
      const json = await res.json() as { error: { message: string } };
      expect(json.error.message).toBe("Admin authentication required to access trace inspection endpoints");
    });
  });

  describe("Inference authentication with LITEROUTER_AUTH_KEY", () => {
    it("resolves directive when authKey is in Authorization and directive in header", () => {
      const req = new Request("http://localhost:7766/v1/chat/completions", {
        headers: {
          Authorization: "Bearer test-master-auth-secret",
          "x-literouter-directive": "lr-or-oa-ch-no",
        },
      });
      const result = resolveInferenceAuth(req);
      expect(result.valid).toBe(true);
      expect(result.directiveStr).toBe("lr-or-oa-ch-no");
    });

    it("resolves directive when directive is in Authorization and authKey in x-literouter-key", () => {
      const req = new Request("http://localhost:7766/v1/chat/completions", {
        headers: {
          Authorization: "Bearer lr-or-oa-ch-no",
          "x-literouter-key": "test-master-auth-secret",
        },
      });
      const result = resolveInferenceAuth(req);
      expect(result.valid).toBe(true);
      expect(result.directiveStr).toBe("lr-or-oa-ch-no");
    });

    it("rejects when authKey is configured but no valid key is provided", () => {
      const req = new Request("http://localhost:7766/v1/chat/completions", {
        headers: {
          Authorization: "Bearer lr-or-oa-ch-no",
        },
      });
      const result = resolveInferenceAuth(req);
      expect(result.valid).toBe(false);
      expect(result.error).toBe("Authentication failed: valid LITEROUTER_AUTH_KEY required");
    });

    it("allows permissive directive when LITEROUTER_AUTH_KEY is unset", () => {
      delete process.env.LITEROUTER_AUTH_KEY;
      resetEnvCache();
      const req = new Request("http://localhost:7766/v1/chat/completions", {
        headers: {
          Authorization: "Bearer lr-or-oa-ch-no",
        },
      });
      const result = resolveInferenceAuth(req);
      expect(result.valid).toBe(true);
      expect(result.directiveStr).toBe("lr-or-oa-ch-no");
    });
  });
});
