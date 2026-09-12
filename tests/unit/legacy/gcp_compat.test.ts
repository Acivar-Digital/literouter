import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { parseDirective } from "../../../src/directive/parser";
import { validateDirective } from "../../../src/directive/validator";
import { loadKeyPools } from "../../../src/config/keys";
import { getEnv } from "../../../src/config/env";
import { getProviderConfig, initProviderRegistry } from "../../../src/config/providers";
import { clearPacerRegistry, getPacerForProvider } from "../../../src/network/pacer";
import {
  buildGcpAuthHeaders,
  handleGcpCompat,
  isGemmaModel,
  normalizeGcpModel,
} from "../../../src/handlers/gcp_compat";
import { globalCooldownManager, globalKeyPool, initializeKeyPools } from "../../../src/handlers/openai_compat";
import { handleAppRequest } from "../../../src/index";

describe("GCP Compatibility Architecture (gc)", () => {
  beforeEach(() => {
    initProviderRegistry();
    globalCooldownManager.clearAll();
    globalKeyPool.reset();
    clearPacerRegistry();
  });

  afterEach(() => {
    initProviderRegistry();
    delete process.env.GCP_ENABLE_RETRIES;
    delete process.env.GCP_ENABLE_QUARANTINE;
    delete process.env.GCP_ENABLE_CIRCUIT_BREAKER;
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

    it("reads GCP pacer config from provider config", () => {
      const prov = getProviderConfig("gc");
      expect(prov.pacer?.min_delay_ms).toBe(2000);
      expect(prov.pacer?.max_queue_wait_ms).toBe(240000);
    });
  });

  describe("Provider Config Resilience Controls (request_retry, key_cooldown, circuit_breaker)", () => {
    it("loads default resilience settings from provider config registry", () => {
      const prov = getProviderConfig("gc");
      expect(prov.request_retry.enabled).toBe(true);
      expect(prov.request_retry.max_attempts).toBe(3);
      expect(prov.request_retry.delay.min_ms).toBe(200);
      expect(prov.request_retry.delay.max_ms).toBe(500);
      expect(prov.key_cooldown.enabled).toBe(false);
      expect(prov.circuit_breaker.enabled).toBe(false);
    });

    it("respects disabled request_retry (process.env.GCP_ENABLE_RETRIES=false and provider config)", async () => {
      process.env.GCP_ENABLE_RETRIES = "false";
      const prov = getProviderConfig("gc");
      prov.request_retry.enabled = false;
      prov.pacer!.enabled = false;

      initializeKeyPools({ GCP_KEYS: "gcp-mock-key-1,gcp-mock-key-2" });

      let fetchCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        fetchCount++;
        return new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      try {
        const req = new Request("http://localhost:7766/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer lr-gc-oa-ch-no",
          },
          body: JSON.stringify({
            model: "gemma-2-27b-it",
            messages: [{ role: "user", content: "Hi" }],
          }),
        });

        const res = await handleGcpCompat(req, "lr-gc-oa-ch-no");
        expect(res.status).toBe(429);
        // Single-flight mode: terminates on attempt 1 without retrying key 2
        expect(fetchCount).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("retries across keys when request_retry.enabled is true", async () => {
      const prov = getProviderConfig("gc");
      prov.request_retry.enabled = true;
      prov.request_retry.delay.min_ms = 0;
      prov.request_retry.delay.max_ms = 0;
      prov.pacer!.enabled = false;

      initializeKeyPools({ GCP_KEYS: "gcp-mock-key-1,gcp-mock-key-2" });

      let fetchCount = 0;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        fetchCount++;
        if (fetchCount === 1) {
          return new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), {
            status: 429,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ choices: [{ message: { role: "assistant", content: "pong" } }] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as unknown as typeof fetch;

      try {
        const req = new Request("http://localhost:7766/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer lr-gc-oa-ch-no",
          },
          body: JSON.stringify({
            model: "gemma-2-27b-it",
            messages: [{ role: "user", content: "ping" }],
          }),
        });

        const res = await handleGcpCompat(req, "lr-gc-oa-ch-no");
        expect(res.status).toBe(200);
        expect(fetchCount).toBe(2);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("bypasses key quarantine when key_cooldown is disabled (process.env.GCP_ENABLE_QUARANTINE=false and provider config)", async () => {
      process.env.GCP_ENABLE_QUARANTINE = "false";
      const prov = getProviderConfig("gc");
      prov.key_cooldown.enabled = false;
      prov.request_retry.enabled = false;
      prov.pacer!.enabled = false;

      initializeKeyPools({ GCP_KEYS: "gcp-mock-key-1,gcp-mock-key-2" });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new Error("Network transport dropped");
      }) as unknown as typeof fetch;

      try {
        const req = new Request("http://localhost:7766/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer lr-gc-oa-ch-no",
          },
          body: JSON.stringify({
            model: "gemma-2-27b-it",
            messages: [{ role: "user", content: "ping" }],
          }),
        });

        const res = await handleGcpCompat(req, "lr-gc-oa-ch-no");
        expect(res.status).toBe(502);

        // Key should NOT be quarantined because key_cooldown is disabled
        const status = globalKeyPool.getStatus("gc");
        expect(status.total).toBe(2);
        expect(status.quarantined).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("quarantines key on network transport drop when key_cooldown.enabled is true", async () => {
      const prov = getProviderConfig("gc");
      prov.key_cooldown.enabled = true;
      prov.request_retry.enabled = false;
      prov.pacer!.enabled = false;

      initializeKeyPools({ GCP_KEYS: "gcp-mock-key-1,gcp-mock-key-2" });

      const originalFetch = globalThis.fetch;
      globalThis.fetch = (async () => {
        throw new Error("Network transport dropped");
      }) as unknown as typeof fetch;

      try {
        const req = new Request("http://localhost:7766/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer lr-gc-oa-ch-no",
          },
          body: JSON.stringify({
            model: "gemma-2-27b-it",
            messages: [{ role: "user", content: "ping" }],
          }),
        });

        const res = await handleGcpCompat(req, "lr-gc-oa-ch-no");
        expect(res.status).toBe(502);

        // Key SHOULD be quarantined because key_cooldown is enabled
        const status = globalKeyPool.getStatus("gc");
        expect(status.total).toBe(2);
        expect(status.quarantined).toBe(1);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("restores provider config cleanly after mutations via initProviderRegistry", () => {
      const prov = getProviderConfig("gc");
      prov.request_retry.enabled = false;
      prov.key_cooldown.enabled = false;
      prov.circuit_breaker.enabled = true;

      expect(getProviderConfig("gc").request_retry.enabled).toBe(false);
      expect(getProviderConfig("gc").key_cooldown.enabled).toBe(false);
      expect(getProviderConfig("gc").circuit_breaker.enabled).toBe(true);

      initProviderRegistry();

      expect(getProviderConfig("gc").request_retry.enabled).toBe(true);
      expect(getProviderConfig("gc").key_cooldown.enabled).toBe(false);
      expect(getProviderConfig("gc").circuit_breaker.enabled).toBe(false);
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
