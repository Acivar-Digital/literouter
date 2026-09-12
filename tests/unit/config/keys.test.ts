import { describe, it, expect, beforeEach } from "bun:test";
import {
  parseKeyList,
  maskKey,
  getProviderEnvVarName,
  loadKeyPools,
  validateKeyPools,
} from "../../../src/config/keys";
import { initProviderRegistry } from "../../../src/config/providers";
import type { ProviderCode } from "../../../src/config/schema";

describe("keys.ts — Dynamic Key Management", () => {
  beforeEach(() => {
    initProviderRegistry();
  });

  describe("parseKeyList", () => {
    it("returns empty array for undefined or empty input", () => {
      expect(parseKeyList(undefined)).toEqual([]);
      expect(parseKeyList("")).toEqual([]);
      expect(parseKeyList("   ")).toEqual([]);
    });

    it("parses comma-separated tokens and trims whitespace", () => {
      const parsed = parseKeyList(" key-one , key-two , key-three ");
      expect(parsed).toEqual(["key-one", "key-two", "key-three"]);
    });

    it("discards tokens shorter than 4 characters", () => {
      const parsed = parseKeyList("abc, 12, valid-key");
      expect(parsed).toEqual(["valid-key"]);
    });

    it("discards known invalid placeholders", () => {
      const parsed = parseKeyList("changeme, todo, your_key_here, undefined, null, valid-key-1");
      expect(parsed).toEqual(["valid-key-1"]);
    });

    it("returns a frozen array", () => {
      const parsed = parseKeyList("valid-key");
      expect(Object.isFrozen(parsed)).toBe(true);
    });
  });

  describe("maskKey", () => {
    it("masks keys <= 8 chars to ****", () => {
      expect(maskKey("1234")).toBe("****");
      expect(maskKey("12345678")).toBe("****");
    });

    it("masks keys > 8 chars showing first 4 and last 4", () => {
      expect(maskKey("sk-ant-api-12345678")).toBe("sk-a...5678");
      expect(maskKey("nvapi-long-secret-key-9999")).toBe("nvap...9999");
    });
  });

  describe("getProviderEnvVarName", () => {
    it("dynamically retrieves env_key from registered provider config", () => {
      expect(getProviderEnvVarName("or")).toBe("OPENROUTER_API_KEYS");
      expect(getProviderEnvVarName("nv")).toBe("NVIDIA_API_KEYS");
      expect(getProviderEnvVarName("gg")).toBe("GOOGLE_API_KEYS");
      expect(getProviderEnvVarName("oa")).toBe("OPENAI_API_KEYS");
      expect(getProviderEnvVarName("an")).toBe("ANTHROPIC_API_KEYS");
      expect(getProviderEnvVarName("gq")).toBe("GROQ_API_KEYS");
      expect(getProviderEnvVarName("cb")).toBe("CEREBRAS_API_KEYS");
      expect(getProviderEnvVarName("ds")).toBe("DEEPSEEK_API_KEYS");
      expect(getProviderEnvVarName("ms")).toBe("MISTRAL_API_KEYS");
      expect(getProviderEnvVarName("tg")).toBe("TOGETHER_API_KEYS");
      expect(getProviderEnvVarName("zn")).toBe("ZEN_API_KEYS");
      expect(getProviderEnvVarName("tp")).toBe("TESTPROVIDER_API_KEYS");
      expect(getProviderEnvVarName("gc")).toBe("GCP_KEYS");
    });

    it("falls back to PROVIDER_ENV_MAP when provider lacks env_key", () => {
      const customConfig = {
        providers: {
          customprov: {
            code: "oa",
            base_url: "https://api.custom.ai",
            endpoints: { ch: "/v1/chat" },
          },
        },
      };
      initProviderRegistry(customConfig);
      // 'oa' in customConfig has no env_key, so it falls back to PROVIDER_ENV_MAP['oa']
      expect(getProviderEnvVarName("oa")).toBe("OPENAI_API_KEYS");
    });
  });

  describe("loadKeyPools", () => {
    it("loads keys for all providers using getProviderEnvVarName", () => {
      const envSource = {
        OPENROUTER_API_KEYS: "sk-or-1, sk-or-2",
        NVIDIA_API_KEYS: "nvapi-1",
        OPENAI_API_KEYS: "sk-oa-1, sk-oa-2",
        ANTHROPIC_API_KEYS: "sk-ant-1",
        ZEN_API_KEYS: "zen-key-1",
      };

      const pools = loadKeyPools(envSource);
      expect(pools.get("or")).toEqual(["sk-or-1", "sk-or-2"]);
      expect(pools.get("nv")).toEqual(["nvapi-1"]);
      expect(pools.get("oa")).toEqual(["sk-oa-1", "sk-oa-2"]);
      expect(pools.get("an")).toEqual(["sk-ant-1"]);
      expect(pools.get("zn")).toEqual(["zen-key-1"]);
      expect(pools.get("gg")).toEqual([]);
      expect(pools.get("cb")).toEqual([]);
    });

    it("supports GCP fallback from GCP_API_KEYS when GCP_KEYS is absent", () => {
      const pools1 = loadKeyPools({ GCP_KEYS: "gcp-direct-1" });
      expect(pools1.get("gc")).toEqual(["gcp-direct-1"]);

      const pools2 = loadKeyPools({ GCP_API_KEYS: "gcp-fallback-1, gcp-fallback-2" });
      expect(pools2.get("gc")).toEqual(["gcp-fallback-1", "gcp-fallback-2"]);
    });

    it("dynamically reads custom env_key from registry", () => {
      const customConfig = {
        providers: {
          customopenai: {
            code: "oa",
            name: "Custom OpenAI",
            env_key: "MY_CUSTOM_OPENAI_KEY",
            base_url: "https://api.openai.com",
            endpoints: { ch: "/v1/chat" },
          },
        },
      };
      initProviderRegistry(customConfig);

      const pools = loadKeyPools({
        MY_CUSTOM_OPENAI_KEY: "custom-token-1234",
        OPENAI_API_KEYS: "old-token-should-not-be-used",
      });

      expect(pools.get("oa")).toEqual(["custom-token-1234"]);
    });
  });

  describe("validateKeyPools", () => {
    it("returns summary counts of valid keys per provider", () => {
      const pools = new Map<ProviderCode, readonly string[]>([
        ["or", ["key-1", "key-2"]],
        ["nv", ["key-3"]],
        ["gg", []],
      ]);

      const summary = validateKeyPools(pools);
      expect(summary).toEqual({
        or: 2,
        nv: 1,
        gg: 0,
      });
    });
  });
});
