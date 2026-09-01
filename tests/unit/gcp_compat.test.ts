import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { parseDirective } from "../../src/directive/parser";
import { validateDirective } from "../../src/directive/validator";
import { loadKeyPools } from "../../src/config/keys";
import { getEnv } from "../../src/config/env";
import { clearPacerRegistry, getPacerForProvider } from "../../src/network/pacer";
import {
  buildGcpAuthHeaders,
  handleGcpCompat,
  isGemmaModel,
  normalizeGcpModel,
} from "../../src/handlers/gcp_compat";
import { globalCooldownManager, globalKeyPool, initializeKeyPools } from "../../src/handlers/openai_compat";
import { handleAppRequest } from "../../src/index";

describe("GCP Compatibility Architecture (gc)", () => {
  beforeEach(() => {
    globalCooldownManager.clearAll();
    globalKeyPool.reset();
    clearPacerRegistry();
  });

  afterEach(() => {
    globalCooldownManager.clearAll();
    globalKeyPool.reset();
    clearPacerRegistry();
  });

  describe("Directive Parsing", () => {
    it("parses GCP direct directive correctly", () => {
      const parsed = parseDirective("lr-gc-oa-ch-no");
      expect(parsed).not.toBeNull();
      expect(parsed?.type).toBe("direct");
      if (parsed?.type === "direct") {
        expect(parsed.provider).toBe("gc");
        expect(parsed.payload).toBe("oa");
        expect(parsed.completion).toBe("ch");
        expect(parsed.nuances).toEqual(["no"]);
      }
    });

    it("validates GCP direct key through validator", () => {
      const result = validateDirective("lr-gc-oa-ch-no");
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.directive.type).toBe("direct");
        if (result.directive.type === "direct") {
          expect(result.directive.provider).toBe("gc");
        }
      }
    });
  });

  describe("Gemma Model Detection & Billing Guardrail", () => {
    it("normalizes GCP model prefixes correctly", () => {
      expect(normalizeGcpModel("gcp/gemma-4-31b-it")).toBe("gemma-4-31b-it");
      expect(normalizeGcpModel("google/gemma-4-31b-it")).toBe("gemma-4-31b-it");
      expect(normalizeGcpModel("GCP/gemma-4-31b-it")).toBe("gemma-4-31b-it");
      expect(normalizeGcpModel("GOOGLE/gemma-4-31b-it")).toBe("gemma-4-31b-it");
      expect(normalizeGcpModel("gemma-4-31b-it")).toBe("gemma-4-31b-it");
      expect(normalizeGcpModel("")).toBe("");
      expect(normalizeGcpModel(null as unknown as string)).toBe("");
      expect(normalizeGcpModel(undefined as unknown as string)).toBe("");
    });

    it("identifies valid Gemma model variants with or without prefixes", () => {
      expect(isGemmaModel("gemma-2-27b-it")).toBe(true);
      expect(isGemmaModel("gemma-2-9b-it")).toBe(true);
      expect(isGemmaModel("gemma-2-2b-it")).toBe(true);
      expect(isGemmaModel("gemma-3-1b-it")).toBe(true);
      expect(isGemmaModel("gemma-3-4b-it")).toBe(true);
      expect(isGemmaModel("gemma-3-12b-it")).toBe(true);
      expect(isGemmaModel("gemma-3-27b-it")).toBe(true);
      expect(isGemmaModel("gemma-4-31b-it")).toBe(true);
      expect(isGemmaModel("gcp/gemma-4-31b-it")).toBe(true);
      expect(isGemmaModel("google/gemma-4-31b-it")).toBe(true);
      expect(isGemmaModel("google/gemma-2-9b-it")).toBe(true);
      expect(isGemmaModel("models/gemma-3-4b-it")).toBe(true);
      expect(isGemmaModel("GEMMA-2-27B-IT")).toBe(true);
      expect(isGemmaModel("GCP/GEMMA-4-31B-IT")).toBe(true);
    });

    it("rejects non-Gemma models", () => {
      expect(isGemmaModel("gemini-1.5-pro")).toBe(false);
      expect(isGemmaModel("gemini-2.5-flash")).toBe(false);
      expect(isGemmaModel("gpt-4o")).toBe(false);
      expect(isGemmaModel("claude-3-7-sonnet")).toBe(false);
      expect(isGemmaModel("deepseek-ai/deepseek-r1")).toBe(false);
      expect(isGemmaModel("")).toBe(false);
      expect(isGemmaModel(null as unknown as string)).toBe(false);
      expect(isGemmaModel(undefined as unknown as string)).toBe(false);
    });

    it("returns HTTP 403 Forbidden for non-Gemma model requests", async () => {
      initializeKeyPools({ GCP_KEYS: "gcp-test-dummy-key-0001" });

      const req = new Request("http://localhost:7766/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer lr-gc-oa-ch-no",
        },
        body: JSON.stringify({
          model: "gemini-1.5-pro",
          messages: [{ role: "user", content: "Hello" }],
        }),
      });

      const res = await handleGcpCompat(req, "lr-gc-oa-ch-no");
      expect(res.status).toBe(403);

      const json = (await res.json()) as { error: { message: string; type: string; code: number } };
      expect(json.error.code).toBe(403);
      expect(json.error.type).toBe("billing_guardrail_violation");
      expect(json.error.message).toContain("Billing Guardrail: Provider 'gc' is strictly restricted to free Gemma models");
      expect(json.error.message).toContain("gemini-1.5-pro");
    });
  });

  describe("Header Generation", () => {
    it("generates correct dual Google auth headers", () => {
      const headers = buildGcpAuthHeaders("nvapi-test-gcp-key-12345");
      expect(headers.Authorization).toBe("Bearer nvapi-test-gcp-key-12345");
      expect(headers["x-goog-api-key"]).toBe("nvapi-test-gcp-key-12345");
      expect(headers["Content-Type"]).toBe("application/json");
    });
  });

  describe("Key Pool Loading & Fallback", () => {
    it("loads keys from GCP_KEYS", () => {
      const pools = loadKeyPools({ GCP_KEYS: "gcp-key-1, gcp-key-2" });
      const keys = pools.get("gc");
      expect(keys).toEqual(["gcp-key-1", "gcp-key-2"]);
    });

    it("falls back to GCP_API_KEYS when GCP_KEYS is not set", () => {
      const pools = loadKeyPools({ GCP_API_KEYS: "gcp-fallback-1, gcp-fallback-2" });
      const keys = pools.get("gc");
      expect(keys).toEqual(["gcp-fallback-1", "gcp-fallback-2"]);
    });

    it("prefers GCP_KEYS over GCP_API_KEYS when both are present", () => {
      const pools = loadKeyPools({
        GCP_KEYS: "primary-key-1",
        GCP_API_KEYS: "fallback-key-1",
      });
      const keys = pools.get("gc");
      expect(keys).toEqual(["primary-key-1"]);
    });
  });

  describe("Pacer & Queue Dwell Configuration", () => {
    it("configures GCP pacer with 2000ms delay and 240000ms queue wait by default", () => {
      const pacer = getPacerForProvider("gc");
      expect(pacer.getMinInterval()).toBe(2000);
      expect(pacer.maxQueueWaitMs).toBe(240000);
    });

    it("reads GCP_MIN_DELAY_MS and GCP_PACER_MAX_QUEUE_WAIT_MS from environment schema", () => {
      const env = getEnv();
      expect(env.GCP_MIN_DELAY_MS).toBe(2000);
      expect(env.GCP_PACER_MAX_QUEUE_WAIT_MS).toBe(240000);
    });
  });

  describe("End-to-End Routing via handleAppRequest", () => {
    it("routes lr-gc-oa-ch-no request to billing guardrail when model is unauthorized", async () => {
      initializeKeyPools({ GCP_KEYS: "gcp-test-dummy-key-0001" });

      const req = new Request("http://localhost:7766/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer lr-gc-oa-ch-no",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          messages: [{ role: "user", content: "hi" }],
        }),
      });

      const res = await handleAppRequest(req);
      expect(res.status).toBe(403);
      const json = (await res.json()) as { error: { type: string } };
      expect(json.error.type).toBe("billing_guardrail_violation");
    });
  });
});
