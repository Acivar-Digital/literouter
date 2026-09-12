import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { dispatchRoute, resetAllState } from "../../src/index";
import { initProviderRegistry } from "../../src/config/providers";
import * as pacerModule from "../../src/network/pacer";

describe("Index Ingress Pacer Dynamic Configuration (literouter-xkuv)", () => {
  beforeEach(() => {
    resetAllState();
    initProviderRegistry();
  });

  afterEach(() => {
    resetAllState();
    initProviderRegistry();
  });

  it("dynamically acquires pacer for registered providers with pacer enabled", async () => {
    const acquireSpy = spyOn(pacerModule.RequestPacer.prototype, "acquire").mockImplementation(
      async () => ({ queueDwellMs: 0, release: () => {} })
    );

    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    try {
      // Direct call with openrouter key (pacer.enabled: true)
      await dispatchRoute(req, "lr-or-oa-ch-no", "req-test-pacer-dynamic");
    } catch (err: unknown) {
      // Upstream mock error is expected; we only verify ingress pacer acquisition
      expect(err).toBeDefined();
    }

    expect(acquireSpy).toHaveBeenCalled();
    acquireSpy.mockRestore();
  });

  it("bypasses ingress pacer when provider config has pacer.enabled = false", async () => {
    // Custom providers config where 'or' pacer is explicitly disabled
    initProviderRegistry({
      providers: {
        openrouter: {
          code: "or",
          name: "OpenRouter",
          env_key: "OPENROUTER_API_KEYS",
          base_url: "https://openrouter.ai",
          endpoints: { ch: "/v1/chat/completions" },
          request_retry: {
            enabled: true,
            max_attempts: 3,
            delay: { min_ms: 150, max_ms: 300 },
          },
          key_cooldown: {
            enabled: true,
            initial_cooldown_ms: 10000,
            max_cooldown_ms: 60000,
          },
          pacer: {
            enabled: false,
            min_delay_ms: 100,
            max_delay_ms: 500,
            max_queue_depth: 100,
            max_queue_wait_ms: 15000,
          },
          circuit_breaker: {
            enabled: true,
            failure_threshold: 5,
            failure_window_ms: 60000,
            open_duration_ms: 30000,
          },
        },
      },
    });

    const acquireSpy = spyOn(pacerModule.RequestPacer.prototype, "acquire").mockImplementation(
      async () => ({ queueDwellMs: 0, release: () => {} })
    );

    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    try {
      await dispatchRoute(req, "lr-or-oa-ch-no", "req-test-pacer-disabled");
    } catch (err: unknown) {
      expect(err).toBeDefined();
    }

    expect(acquireSpy).not.toHaveBeenCalled();
    acquireSpy.mockRestore();
  });

  it("bypasses ingress pacer for unregistered provider codes", async () => {
    const acquireSpy = spyOn(pacerModule.RequestPacer.prototype, "acquire").mockImplementation(
      async () => ({ queueDwellMs: 0, release: () => {} })
    );

    const req = new Request("http://localhost:7766/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "test-model",
        messages: [{ role: "user", content: "hello" }],
      }),
    });

    try {
      // 'xx' is an unregistered provider
      await dispatchRoute(req, "lr-xx-oa-ch-no", "req-test-pacer-unknown");
    } catch (err: unknown) {
      expect(err).toBeDefined();
    }

    expect(acquireSpy).not.toHaveBeenCalled();
    acquireSpy.mockRestore();
  });
});
