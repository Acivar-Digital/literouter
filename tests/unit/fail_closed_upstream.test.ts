import { describe, expect, it } from "bun:test";
import { overrideProviderUrl } from "../../src/handlers/openai_compat";

describe("Provider URL Override Unit Tests (literouter-960c)", () => {
  it("leaves upstream URLs unchanged when no mock port is set", () => {
    const liveUrls = [
      { url: "https://openrouter.ai/api/v1/chat/completions", code: "or" },
      { url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent", code: "gg" },
      { url: "https://api.anthropic.com/v1/messages", code: "an" },
      { url: "https://opencode.ai/zen/v1/chat/completions", code: "zn" },
      { url: "https://integrate.api.nvidia.com/v1/chat/completions", code: "nv" },
    ];

    for (const item of liveUrls) {
      const result = overrideProviderUrl(item.url, item.code);
      expect(result).toBe(item.url);
    }
  });

  it("respects MOCK_<CODE>_PORT if explicitly set", () => {
    process.env.MOCK_CUSTOM_PORT = "19999";
    try {
      const rewritten = overrideProviderUrl("https://custom.api/v1/chat", "custom");
      expect(rewritten).toBe("http://localhost:19999/v1/chat");
    } finally {
      delete process.env.MOCK_CUSTOM_PORT;
    }
  });

  it("returns original URL when invalid URL string is provided with mock port set", () => {
    process.env.MOCK_INVALID_PORT = "19999";
    try {
      const rewritten = overrideProviderUrl("not-a-valid-url", "invalid");
      expect(rewritten).toBe("not-a-valid-url");
    } finally {
      delete process.env.MOCK_INVALID_PORT;
    }
  });
});
