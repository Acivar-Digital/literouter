import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getEnv,
  getLiteRouterEngine,
  isLiteRouterEngineOverrideEnabled,
  isV4Engine,
  parseCustomEnv,
  resetEnvCache,
  resolveEngine,
} from "../../src/config/env";
import { dispatchRoute, dispatchV4, handleAppRequest } from "../../src/index";

describe("LiteRouter Engine Dual-Path & Header Override (literouter-exqh.2 / exqh.23)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetEnvCache();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnv);
    resetEnvCache();
  });

  describe("Configuration & Environment Defaults", () => {
    it("evaluates LITEROUTER_ENGINE to 'v4.1' by default", () => {
      delete process.env.LITEROUTER_ENGINE;
      resetEnvCache();
      expect(getEnv().LITEROUTER_ENGINE).toBe("v4.1");
      expect(getLiteRouterEngine()).toBe("v4.1");
      expect(isV4Engine()).toBe(true);
    });

    it("evaluates LITEROUTER_ENGINE to 'v4.1' when explicitly set", () => {
      process.env.LITEROUTER_ENGINE = "v4.1";
      resetEnvCache();
      expect(getEnv().LITEROUTER_ENGINE).toBe("v4.1");
      expect(getLiteRouterEngine()).toBe("v4.1");
      expect(isV4Engine()).toBe(true);
    });

    it("evaluates LITEROUTER_ENGINE to 'legacy' when explicitly set", () => {
      process.env.LITEROUTER_ENGINE = "legacy";
      resetEnvCache();
      expect(getEnv().LITEROUTER_ENGINE).toBe("legacy");
      expect(getLiteRouterEngine()).toBe("legacy");
      expect(isV4Engine()).toBe(false);
    });

    it("evaluates LITEROUTER_ENGINE_OVERRIDE to false by default", () => {
      delete process.env.LITEROUTER_ENGINE_OVERRIDE;
      resetEnvCache();
      expect(getEnv().LITEROUTER_ENGINE_OVERRIDE).toBe(false);
      expect(isLiteRouterEngineOverrideEnabled()).toBe(false);
    });

    it("accepts custom env parsing for v4.1 engine", () => {
      const parsed = parseCustomEnv({
        LITEROUTER_ENGINE: "v4.1",
        LITEROUTER_ENGINE_OVERRIDE: "true",
      });
      expect(parsed.LITEROUTER_ENGINE).toBe("v4.1");
      expect(parsed.LITEROUTER_ENGINE_OVERRIDE).toBe(true);
    });
  });

  describe("resolveEngine & X-LiteRouter-Engine Header Override", () => {
    it("returns 'v4.1' by default without request", () => {
      delete process.env.LITEROUTER_ENGINE;
      resetEnvCache();
      expect(resolveEngine()).toBe("v4.1");
      expect(isV4Engine()).toBe(true);
    });

    it("ignores X-LiteRouter-Engine header when LITEROUTER_ENGINE_OVERRIDE is false", () => {
      process.env.LITEROUTER_ENGINE_OVERRIDE = "false";
      process.env.LITEROUTER_ENGINE = "legacy";
      resetEnvCache();

      const req = new Request("http://localhost:7766/v1/chat/completions", {
        headers: {
          "X-LiteRouter-Engine": "v4.1",
        },
      });

      expect(resolveEngine(req)).toBe("legacy");
      expect(isV4Engine(req)).toBe(false);
    });

    it("honors X-LiteRouter-Engine header when LITEROUTER_ENGINE_OVERRIDE is true", () => {
      process.env.LITEROUTER_ENGINE_OVERRIDE = "true";
      process.env.LITEROUTER_ENGINE = "legacy";
      resetEnvCache();

      const reqV4 = new Request("http://localhost:7766/v1/chat/completions", {
        headers: {
          "X-LiteRouter-Engine": "v4.1",
        },
      });
      expect(resolveEngine(reqV4)).toBe("v4.1");
      expect(isV4Engine(reqV4)).toBe(true);

      const reqLegacy = new Request("http://localhost:7766/v1/chat/completions", {
        headers: {
          "x-literouter-engine": "legacy",
        },
      });
      expect(resolveEngine(reqLegacy)).toBe("legacy");
      expect(isV4Engine(reqLegacy)).toBe(false);
    });

    it("falls back to base engine when X-LiteRouter-Engine header is invalid", () => {
      process.env.LITEROUTER_ENGINE_OVERRIDE = "true";
      process.env.LITEROUTER_ENGINE = "legacy";
      resetEnvCache();

      const req = new Request("http://localhost:7766/v1/chat/completions", {
        headers: {
          "X-LiteRouter-Engine": "invalid_engine",
        },
      });
      expect(resolveEngine(req)).toBe("legacy");
      expect(isV4Engine(req)).toBe(false);
    });
  });

  describe("Dual-Path Engine Routing & Dispatcher Verification (Slice 5.3)", () => {
    it("handles /health with 200 in legacy engine mode", async () => {
      process.env.LITEROUTER_ENGINE = "legacy";
      resetEnvCache();

      const req = new Request("http://localhost:7766/health");
      const resRoute = await dispatchRoute(req, "", "test_req_health_legacy");
      expect(resRoute.status).toBe(200);
      const jsonRoute = (await resRoute.json()) as { status: string };
      expect(jsonRoute.status).toBe("healthy");

      const resApp = await handleAppRequest(req);
      expect(resApp.status).toBe(200);
      const jsonApp = (await resApp.json()) as { status: string };
      expect(jsonApp.status).toBe("healthy");
    });

    it("handles /health with 200 in v4.1 engine mode", async () => {
      process.env.LITEROUTER_ENGINE = "v4.1";
      resetEnvCache();

      const req = new Request("http://localhost:7766/health");
      const resRoute = await dispatchRoute(req, "", "test_req_health_v4");
      expect(resRoute.status).toBe(200);
      const jsonRoute = (await resRoute.json()) as { status: string };
      expect(jsonRoute.status).toBe("healthy");

      const resApp = await handleAppRequest(req);
      expect(resApp.status).toBe(200);
      const jsonApp = (await resApp.json()) as { status: string };
      expect(jsonApp.status).toBe("healthy");
    });

    it("handles /health with 200 when X-LiteRouter-Engine: v4.1 header is passed", async () => {
      process.env.LITEROUTER_ENGINE = "legacy";
      process.env.LITEROUTER_ENGINE_OVERRIDE = "true";
      resetEnvCache();

      const req = new Request("http://localhost:7766/health", {
        headers: {
          "X-LiteRouter-Engine": "v4.1",
        },
      });

      const resRoute = await dispatchRoute(req, "", "test_req_health_hdr");
      expect(resRoute.status).toBe(200);
      const jsonRoute = (await resRoute.json()) as { status: string };
      expect(jsonRoute.status).toBe("healthy");

      const resApp = await handleAppRequest(req);
      expect(resApp.status).toBe(200);
      const jsonApp = (await resApp.json()) as { status: string };
      expect(jsonApp.status).toBe("healthy");
    });

    it("routes to legacy handler when LITEROUTER_ENGINE=legacy", async () => {
      process.env.LITEROUTER_ENGINE = "legacy";
      resetEnvCache();

      // In legacy mode, /v1/traces is not in legacy route map -> 404
      const traceReq = new Request("http://localhost:7766/v1/traces", {
        headers: {
          Authorization: "Bearer lr-zn-oa-ch-no",
        },
      });
      const traceRes = await handleAppRequest(traceReq);
      expect(traceRes.status).toBe(404);
      const traceJson = (await traceRes.json()) as { error: { message: string } };
      expect(traceJson.error.message).toContain("Not Found: /v1/traces");

      // In legacy mode, endpoint mismatch check fails fast with 400
      const mismatchReq = new Request("http://localhost:7766/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: "Bearer lr-zn-oo-rs-no",
        },
      });
      const mismatchRes = await handleAppRequest(mismatchReq);
      expect(mismatchRes.status).toBe(400);
    });

    it("routes to v4.1 dispatcher when LITEROUTER_ENGINE=v4.1", async () => {
      process.env.LITEROUTER_ENGINE = "v4.1";
      resetEnvCache();

      // In v4.1 mode, /v1/traces is a valid v4.1 route
      const traceReq = new Request("http://localhost:7766/v1/traces", {
        headers: {
          Authorization: "Bearer lr-zn-oa-ch-no",
        },
      });
      const traceRes = await handleAppRequest(traceReq);
      expect(traceRes.status).toBe(200);
      const traceJson = (await traceRes.json()) as { traces: unknown[] };
      expect(Array.isArray(traceJson.traces)).toBe(true);

      // In v4.1 mode, unknown route returns v4.1 404 format
      const unknownReq = new Request("http://localhost:7766/v1/unknown_test_route", {
        method: "POST",
        headers: {
          Authorization: "Bearer lr-zn-oa-ch-no",
        },
      });
      const unknownRes = await handleAppRequest(unknownReq);
      expect(unknownRes.status).toBe(404);
      const unknownJson = (await unknownRes.json()) as { error: { message: string; type: string } };
      expect(unknownJson.error.message).toBe("Route not found: POST /v1/unknown_test_route");
      expect(unknownJson.error.type).toBe("invalid_request_error");
    });

    it("routes to v4.1 dispatcher via X-LiteRouter-Engine: v4.1 when override is enabled", async () => {
      process.env.LITEROUTER_ENGINE = "legacy";
      process.env.LITEROUTER_ENGINE_OVERRIDE = "true";
      resetEnvCache();

      const traceReq = new Request("http://localhost:7766/v1/traces", {
        headers: {
          Authorization: "Bearer lr-zn-oa-ch-no",
          "X-LiteRouter-Engine": "v4.1",
        },
      });
      const traceRes = await handleAppRequest(traceReq);
      expect(traceRes.status).toBe(200);
      const traceJson = (await traceRes.json()) as { traces: unknown[] };
      expect(Array.isArray(traceJson.traces)).toBe(true);
    });

    it("dispatchV4 returns a Response directly", async () => {
      const req = new Request("http://localhost:7766/v1/traces");
      const res = await dispatchV4(req, "lr-zn-oa-ch-no", "test_v4_direct");
      expect(res).toBeInstanceOf(Response);
      expect(res.status).toBe(200);
    });
  });
});
