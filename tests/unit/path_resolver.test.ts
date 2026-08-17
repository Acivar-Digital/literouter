import { describe, expect, it } from "bun:test";
import providersConfig from "../../config/providers.json";

interface ProviderEndpointMap {
  [code: string]: {
    base_url: string;
    endpoints: Record<string, string>;
  };
}

function getProviderMap(): ProviderEndpointMap {
  const map: ProviderEndpointMap = {};
  for (const [, p] of Object.entries(providersConfig.providers)) {
    map[p.code] = {
      base_url: p.base_url,
      endpoints: p.endpoints,
    };
  }
  return map;
}

const providerMap = getProviderMap();

function resolveCompletionUrl(
  providerCode: string,
  completionCode: string,
  model?: string
): string | null {
  const provider = providerMap[providerCode];
  if (!provider) {
    return null;
  }
  const endpointTpl = provider.endpoints[completionCode];
  if (!endpointTpl) {
    return null;
  }
  const endpoint = model ? endpointTpl.replace("{model}", model) : endpointTpl;
  return `${provider.base_url}${endpoint}`;
}

function buildOutboundAuthHeaders(
  providerCode: string,
  completionCode: string,
  vendorApiKey: string
): { headers: Record<string, string>; queryAppend?: string } {
  if (providerCode === "an") {
    return {
      headers: {
        "x-api-key": vendorApiKey,
        "anthropic-version": "2023-06-01",
      },
    };
  }
  if (providerCode === "gg" && (completionCode === "gc" || completionCode === "em")) {
    return {
      headers: {},
      queryAppend: `key=${vendorApiKey}`,
    };
  }
  return {
    headers: {
      Authorization: `Bearer ${vendorApiKey}`,
    },
  };
}

describe("Path Resolver — providers.json Completion URL Mapping", () => {
  it("resolves OpenRouter chat completions endpoint (or, ch)", () => {
    const url = resolveCompletionUrl("or", "ch");
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
  });

  it("resolves OpenRouter messages endpoint (or, ms)", () => {
    const url = resolveCompletionUrl("or", "ms");
    expect(url).toBe("https://openrouter.ai/api/v1/messages");
  });

  it("resolves NVIDIA chat completions endpoint (nv, ch)", () => {
    const url = resolveCompletionUrl("nv", "ch");
    expect(url).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
  });

  it("resolves Google OpenAI-compat beta endpoint (gg, ob)", () => {
    const url = resolveCompletionUrl("gg", "ob");
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
  });

  it("resolves Google native generateContent with model substitution (gg, gc)", () => {
    const url = resolveCompletionUrl("gg", "gc", "gemini-2.5-pro");
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent"
    );
  });

  it("resolves Google embeddings with model substitution (gg, em)", () => {
    const url = resolveCompletionUrl("gg", "em", "text-embedding-004");
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent"
    );
  });

  it("resolves Anthropic direct messages endpoint (an, ms)", () => {
    const url = resolveCompletionUrl("an", "ms");
    expect(url).toBe("https://api.anthropic.com/v1/messages");
  });

  it("resolves Zen chat endpoint (zn, ch)", () => {
    const url = resolveCompletionUrl("zn", "ch");
    expect(url).toBe("https://api.zen.ai/v1/chat/completions");
  });

  it("returns null for non-existent completion code on provider", () => {
    const url = resolveCompletionUrl("zn", "im");
    expect(url).toBeNull();
  });
});

describe("Path Resolver — Outbound Auth Transformation", () => {
  it("formats standard Bearer header for OpenRouter", () => {
    const auth = buildOutboundAuthHeaders("or", "ch", "sk-or-v1-key123");
    expect(auth.headers["Authorization"]).toBe("Bearer sk-or-v1-key123");
    expect(auth.queryAppend).toBeUndefined();
  });

  it("formats standard Bearer header for NVIDIA NIM", () => {
    const auth = buildOutboundAuthHeaders("nv", "ch", "nvapi-secret-key");
    expect(auth.headers["Authorization"]).toBe("Bearer nvapi-secret-key");
  });

  it("formats x-api-key and anthropic-version for Anthropic direct", () => {
    const auth = buildOutboundAuthHeaders("an", "ms", "sk-ant-api03-test");
    expect(auth.headers["x-api-key"]).toBe("sk-ant-api03-test");
    expect(auth.headers["anthropic-version"]).toBe("2023-06-01");
    expect(auth.headers["Authorization"]).toBeUndefined();
  });

  it("formats Bearer header for Google OpenAI beta endpoint (ob)", () => {
    const auth = buildOutboundAuthHeaders("gg", "ob", "AIzaSySecretGoogleKey");
    expect(auth.headers["Authorization"]).toBe("Bearer AIzaSySecretGoogleKey");
    expect(auth.queryAppend).toBeUndefined();
  });

  it("formats query parameter ?key= for Google Native RPC (gc)", () => {
    const auth = buildOutboundAuthHeaders("gg", "gc", "AIzaSySecretGoogleKey");
    expect(auth.headers["Authorization"]).toBeUndefined();
    expect(auth.queryAppend).toBe("key=AIzaSySecretGoogleKey");
  });
});
