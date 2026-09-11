import { describe, expect, it } from "bun:test";
import { UnmockedOutboundCallError } from "../preload";

describe("Test Preload Air-Gap & Key Sanitizer", () => {
  it("sanitizes provider keys in process.env and sets test mode env flags", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(process.env.LITEROUTER_TEST_MODE).toBe("true");

    const requiredKeys = [
      "GOOGLE_API_KEYS",
      "GCP_KEYS",
      "GCP_API_KEYS",
      "OPENROUTER_API_KEYS",
      "NVIDIA_API_KEYS",
      "ZEN_API_KEYS",
      "ANTHROPIC_API_KEYS",
    ];

    for (const key of requiredKeys) {
      const val = process.env[key];
      expect(val).toBeDefined();
      expect(val).toContain("mock-");
      expect(val).toContain("-stub-key-");
    }
  });

  it("blocks unmocked outbound fetch to known LLM domains with UnmockedOutboundCallError", async () => {
    const blockedUrls = [
      "https://generativelanguage.googleapis.com/v1beta/models",
      "https://openrouter.ai/api/v1/chat/completions",
      "https://api.anthropic.com/v1/messages",
      "https://integrate.api.nvidia.com/v1/chat/completions",
      "https://opencode.ai/zen/v1/chat/completions",
    ];

    for (const url of blockedUrls) {
      let caughtError: unknown = null;
      try {
        await fetch(url);
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeInstanceOf(UnmockedOutboundCallError);
      expect((caughtError as Error).message).toBe(
        `Outbound live API request blocked in test environment to: ${url}`
      );
    }
  });

  it("blocks unmocked outbound fetch when passed a Request object or URL object", async () => {
    const url = "https://openrouter.ai/api/v1/models";

    // URL object
    expect(() => fetch(new URL(url))).toThrow(UnmockedOutboundCallError);

    // Request object
    expect(() => fetch(new Request(url))).toThrow(UnmockedOutboundCallError);
  });

  it("allows loopback requests to pass through without UnmockedOutboundCallError", async () => {
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("ok");
      },
    });

    try {
      const res = await fetch(`http://127.0.0.1:${server.port}/health`);
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toBe("ok");

      const resLocal = await fetch(`http://localhost:${server.port}/health`);
      expect(resLocal.status).toBe(200);
    } finally {
      server.stop(true);
    }
  });
});
