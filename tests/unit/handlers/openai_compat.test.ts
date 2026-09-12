import { describe, expect, it, beforeEach, spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getProviderEndpointConfig,
  resetProvidersRegistryCache,
  resolveUpstreamEndpoint,
  buildAuthHeaders,
  wrapStreamWithPacerLease,
  acquireProviderPacer,
  executeDirectRequest,
  initializeKeyPools,
} from "../../../src/handlers/openai_compat";
import { getProviderConfig, isRegisteredProvider } from "../../../src/config/providers";
import { getPacerForProvider } from "../../../src/network/pacer";

describe("openai_compat handler unit tests", () => {
  beforeEach(() => {
    resetProvidersRegistryCache();
  });

  describe("getProviderEndpointConfig", () => {
    it("returns configuration for registered providers", () => {
      const orConfig = getProviderEndpointConfig("or");
      expect(orConfig).toBeDefined();
      expect(orConfig?.code).toBe("or");
      expect(orConfig?.base_url).toBe("https://openrouter.ai");
      expect(orConfig?.conserve_rules).toBeDefined();
      expect(Array.isArray(orConfig?.conserve_rules)).toBe(true);

      const znConfig = getProviderEndpointConfig("zn");
      expect(znConfig).toBeDefined();
      expect(znConfig?.code).toBe("zn");
      expect(znConfig?.base_url).toBe("https://opencode.ai/zen");

      const nvConfig = getProviderEndpointConfig("nv");
      expect(nvConfig).toBeDefined();
      expect(nvConfig?.code).toBe("nv");
    });

    it("returns undefined for unregistered providers", () => {
      const unknown = getProviderEndpointConfig("nonexistent_provider_xyz");
      expect(unknown).toBeUndefined();
    });

    it("matches getProviderConfig output for valid providers", () => {
      const viaEndpointConfig = getProviderEndpointConfig("or");
      const viaProviderConfig = getProviderConfig("or");

      expect(viaEndpointConfig?.code).toBe(viaProviderConfig.code);
      expect(viaEndpointConfig?.base_url).toBe(viaProviderConfig.base_url);
      expect(viaEndpointConfig?.auth_header).toBe(viaProviderConfig.auth_header);
      expect(viaEndpointConfig?.endpoints).toEqual(viaProviderConfig.endpoints);
    });
  });

  describe("request_retry configuration and zero-hardcoding", () => {
    it("provides deterministic retry counts from providers.json without hardcoding", () => {
      const znConfig = getProviderConfig("zn");
      expect(znConfig.request_retry.enabled).toBe(true);
      expect(znConfig.request_retry.max_attempts).toBe(3);

      const orConfig = getProviderConfig("or");
      expect(orConfig.request_retry.enabled).toBe(true);
      expect(orConfig.request_retry.max_attempts).toBe(3);

      const nvConfig = getProviderConfig("nv");
      expect(nvConfig.request_retry.enabled).toBe(true);
      expect(nvConfig.request_retry.max_attempts).toBe(3);
    });

    it("contains valid retry delay bounds for jitter computation", () => {
      const providers = ["or", "nv", "gg", "zn", "gc"];
      for (const prov of providers) {
        if (isRegisteredProvider(prov)) {
          const config = getProviderConfig(prov);
          const { min_ms, max_ms } = config.request_retry.delay;
          expect(min_ms).toBeGreaterThanOrEqual(0);
          expect(max_ms).toBeGreaterThanOrEqual(min_ms);

          // Test jitter formula
          const delayMs =
            min_ms < max_ms
              ? min_ms + Math.floor(Math.random() * (max_ms - min_ms + 1))
              : min_ms;
          expect(delayMs).toBeGreaterThanOrEqual(min_ms);
          expect(delayMs).toBeLessThanOrEqual(max_ms);
        }
      }
    });

    it("verifies source code does not contain hardcoded Math.min(3, ...) in openai_compat.ts", () => {
      const sourcePath = resolve(import.meta.dir, "../../../src/handlers/openai_compat.ts");
      const source = readFileSync(sourcePath, "utf-8");

      expect(source.includes("Math.min(3,")).toBe(false);
      expect(source.includes("isZenLoop && !env.ZEN_ENABLE_RETRIES")).toBe(false);
      expect(source.includes("getProvidersRegistry")).toBe(false);
      expect(source.includes("cachedRegistry")).toBe(false);
      expect(source.includes('!["or", "nv", "zn", "gg"].includes')).toBe(false);
      expect(source.includes("ZEN_ENABLE_")).toBe(false);
    });

    it("verifies dynamic pacer configuration is loaded via getProviderConfig", () => {
      const orConfig = getProviderConfig("or");
      expect(orConfig.pacer).toBeDefined();
      expect(orConfig.pacer?.enabled).toBe(true);

      const znConfig = getProviderConfig("zn");
      expect(znConfig.pacer).toBeDefined();
      expect(znConfig.pacer?.enabled).toBe(true);

      const nvConfig = getProviderConfig("nv");
      expect(nvConfig.pacer).toBeDefined();
      expect(nvConfig.pacer?.enabled).toBe(true);
    });
  });

  describe("resolveUpstreamEndpoint and buildAuthHeaders", () => {
    it("resolves endpoint with model substitution for known provider", () => {
      const endpoint = resolveUpstreamEndpoint("or", "ch", "deepseek/deepseek-r1");
      expect(endpoint.url).toContain("openrouter.ai");
      expect(endpoint.url).toContain("/api/v1/chat/completions");
      expect(endpoint.authHeader).toBe("Bearer");
    });

    it("falls back to openrouter default for unknown provider", () => {
      const fallback = resolveUpstreamEndpoint("unknown_code", "ch", "some-model");
      expect(fallback.url).toContain("openrouter.ai");
    });

    it("builds correct auth headers for bearer and api-key providers", () => {
      const bearerHeaders = buildAuthHeaders("Bearer", "test-token-123", "or");
      expect(bearerHeaders["Authorization"]).toBe("Bearer test-token-123");
      expect(bearerHeaders["Content-Type"]).toBe("application/json");

      const apiKeyHeaders = buildAuthHeaders("x-api-key", "test-token-456");
      expect(apiKeyHeaders["x-api-key"]).toBe("test-token-456");
      expect(apiKeyHeaders["anthropic-version"]).toBe("2023-06-01");
    });
  });

  describe("pacer lease lifecycle", () => {
    describe("wrapStreamWithPacerLease", () => {
      it("calls lease.release() when stream reaches EOF (done: true)", async () => {
        let releaseCount = 0;
        const mockLease = {
          queueDwellMs: 10,
          release: () => {
            releaseCount++;
          },
        };

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("chunk 1"));
            controller.enqueue(new TextEncoder().encode("chunk 2"));
            controller.close();
          },
        });

        const wrapped = wrapStreamWithPacerLease(stream, mockLease);
        const reader = wrapped.getReader();

        const chunk1 = await reader.read();
        expect(chunk1.done).toBe(false);
        expect(releaseCount).toBe(0);

        const chunk2 = await reader.read();
        expect(chunk2.done).toBe(false);
        expect(releaseCount).toBe(0);

        const chunk3 = await reader.read();
        expect(chunk3.done).toBe(true);
        expect(releaseCount).toBe(1);
      });

      it("calls lease.release() when stream reader encounters an error", async () => {
        let releaseCount = 0;
        const mockLease = {
          queueDwellMs: 5,
          release: () => {
            releaseCount++;
          },
        };

        let pullCount = 0;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            pullCount++;
            if (pullCount === 1) {
              controller.enqueue(new TextEncoder().encode("chunk"));
            } else {
              controller.error(new Error("simulated stream read failure"));
            }
          },
        });

        const wrapped = wrapStreamWithPacerLease(stream, mockLease);
        const reader = wrapped.getReader();

        const chunk = await reader.read();
        expect(chunk.done).toBe(false);
        expect(releaseCount).toBe(0);

        await expect(reader.read()).rejects.toThrow("simulated stream read failure");
        expect(releaseCount).toBe(1);
      });

      it("calls lease.release() when stream is cancelled by consumer (cancel())", async () => {
        let releaseCount = 0;
        const mockLease = {
          queueDwellMs: 12,
          release: () => {
            releaseCount++;
          },
        };

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("chunk 1"));
          },
        });

        const wrapped = wrapStreamWithPacerLease(stream, mockLease);
        const reader = wrapped.getReader();

        const chunk = await reader.read();
        expect(chunk.done).toBe(false);
        expect(releaseCount).toBe(0);

        await reader.cancel("client disconnected");
        expect(releaseCount).toBe(1);
      });

      it("ensures release() is only called once (idempotent)", async () => {
        let releaseCount = 0;
        const mockLease = {
          queueDwellMs: 0,
          release: () => {
            releaseCount++;
          },
        };

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        });

        const wrapped = wrapStreamWithPacerLease(stream, mockLease);
        const reader = wrapped.getReader();

        const res = await reader.read();
        expect(res.done).toBe(true);
        expect(releaseCount).toBe(1);

        // Subsequent cancel should be a no-op for release
        await reader.cancel("cancelled after eof");
        expect(releaseCount).toBe(1);

        // Subsequent read should also not call release again
        const after = await reader.read();
        expect(after.done).toBe(true);
        expect(releaseCount).toBe(1);
      });
    });

    describe("acquireProviderPacer", () => {
      it("returns a lease object with queueDwellMs and release()", async () => {
        const lease = await acquireProviderPacer("or");
        expect(lease).toBeDefined();
        expect(typeof lease?.queueDwellMs).toBe("number");
        expect(lease?.queueDwellMs).toBeGreaterThanOrEqual(0);
        expect(typeof lease?.release).toBe("function");

        lease?.release();
      });
    });

    describe("retryable failure release lifecycle", () => {
      it("calls pacerLease.release() immediately before sleeping for retry delay when an attempt encounters a retryable failure", async () => {
        initializeKeyPools({ OPENROUTER_API_KEYS: "sk-or-v1-key1,sk-or-v1-key2" });
        const events: string[] = [];

        const pacer = getPacerForProvider("or");
        const origAcquire = pacer.acquire.bind(pacer);
        pacer.acquire = async (sig?: AbortSignal) => {
          const lease = await origAcquire(sig);
          const origRel = lease.release;
          lease.release = () => {
            events.push("release");
            origRel();
          };
          events.push("acquire");
          return lease;
        };

        const sleepSpy = spyOn(Bun, "sleep").mockImplementation(async () => {
          events.push("sleep");
        });

        let callCount = 0;
        const origFetch = globalThis.fetch;
        globalThis.fetch = (async () => {
          callCount++;
          if (callCount === 1) {
            throw new TypeError("Simulated transport failure triggering retry");
          }
          return new Response(
            JSON.stringify({
              id: "chatcmpl-retry-test",
              object: "chat.completion",
              created: Date.now(),
              model: "deepseek/deepseek-r1",
              choices: [{ message: { role: "assistant", content: "ok after retry" }, finish_reason: "stop" }],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }) as unknown as typeof globalThis.fetch;

        try {
          const res = await executeDirectRequest(
            { type: "direct", raw: "lr-or-oa-ch-no", provider: "or", payload: "oa", completion: "ch", nuances: ["no"] },
            { model: "deepseek/deepseek-r1", messages: [{ role: "user", content: "hello" }] },
            undefined,
            "req-pacer-retry-lifecycle"
          );

          expect(res.status).toBe(200);
          expect(callCount).toBe(2);

          // Verify exact sequence: lease acquired -> released immediately on failure -> sleep for retry -> re-acquired -> released on 200 completion
          expect(events).toEqual(["acquire", "release", "sleep", "acquire", "release"]);
        } finally {
          globalThis.fetch = origFetch;
          sleepSpy.mockRestore();
          pacer.acquire = origAcquire;
        }
      });
    });
  });
});
