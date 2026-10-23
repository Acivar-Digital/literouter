import { describe, it, expect, beforeEach } from "bun:test";
import {
  initProviderRegistry,
  getProviderConfig,
  isRegisteredProvider,
  resolveUpstreamEndpoint,
} from "../../../src/config/providers";
import { loadKeyPools } from "../../../src/config/keys";
import { KeyPool } from "../../../src/network/pool";

describe("Groq Provider Registration & Key Pool Management", () => {
  beforeEach(() => {
    initProviderRegistry();
  });

  it("registers groq (gq) correctly in ProviderRegistry", () => {
    expect(isRegisteredProvider("gq")).toBe(true);

    const config = getProviderConfig("gq");
    expect(config.code).toBe("gq");
    const configByName = getProviderConfig("groq");
    expect(configByName.code).toBe("gq");
    expect(config.name).toBe("Groq");
    expect(config.base_url).toBe("https://api.groq.com/openai");
    expect(config.auth_header).toBe("Bearer");
    expect(config.strategy).toBe("standard");
    expect(config.env_key).toBe("GROQ_API_KEYS");
  });

  it("configures Groq RequestPacer to protect against RPM/TPM bursts", () => {
    const config = getProviderConfig("gq");
    expect(config.pacer.enabled).toBe(true);
    expect(config.pacer.min_delay_ms).toBe(300);
    expect(config.pacer.max_delay_ms).toBe(500);
    expect(config.pacer.max_queue_depth).toBe(500);
    expect(config.pacer.max_queue_wait_ms).toBe(15000);
  });

  it("configures Groq request retry parameters", () => {
    const config = getProviderConfig("gq");
    expect(config.request_retry.enabled).toBe(true);
    expect(config.request_retry.max_attempts).toBe(3);
    expect(config.request_retry.delay.min_ms).toBe(150);
    expect(config.request_retry.delay.max_ms).toBe(500);
  });

  it("resolves Groq chat completion and models endpoints", () => {
    const ch = resolveUpstreamEndpoint("gq", "ch", "qwen/qwen3.8-27b");
    expect(ch.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(ch.authHeader).toBe("Bearer");

    const md = resolveUpstreamEndpoint("gq", "md");
    expect(md.url).toBe("https://api.groq.com/openai/v1/models");
  });

  it("loads Groq keys from environment into KeyPool", () => {
    const mockEnv = {
      GROQ_API_KEYS: "gsk_test1,gsk_test2,gsk_test3,gsk_test4,gsk_test5,gsk_test6",
    };
    const pools = loadKeyPools(mockEnv);
    const groqKeys = pools.get("gq");
    expect(groqKeys).toBeDefined();
    expect(groqKeys?.length).toBe(6);
    expect(groqKeys?.[0]).toBe("gsk_test1");
    expect(groqKeys?.[5]).toBe("gsk_test6");
  });

  it("rotates keys in round-robin order across all keys", () => {
    const pool = new KeyPool();
    const mockKeys = ["gsk_keyA", "gsk_keyB", "gsk_keyC"];
    pool.setPool("gq", mockKeys);

    const k1 = pool.selectNextKey("gq");
    expect(k1?.key).toBe("gsk_keyA");
    expect(k1?.index).toBe(0);

    const k2 = pool.selectNextKey("gq");
    expect(k2?.key).toBe("gsk_keyB");
    expect(k2?.index).toBe(1);

    const k3 = pool.selectNextKey("gq");
    expect(k3?.key).toBe("gsk_keyC");
    expect(k3?.index).toBe(2);

    const k4 = pool.selectNextKey("gq");
    expect(k4?.key).toBe("gsk_keyA");
    expect(k4?.index).toBe(0);
  });

  it("quarantines tripped key on 429 without dropping remaining keys", () => {
    const pool = new KeyPool();
    const mockKeys = ["gsk_keyA", "gsk_keyB", "gsk_keyC"];
    pool.setPool("gq", mockKeys);

    // Pick first key (keyA, index 0)
    const k1 = pool.selectNextKey("gq");
    expect(k1?.key).toBe("gsk_keyA");

    // Simulate 429 on keyA: quarantine for 10 seconds
    pool.quarantineKey("gq", 0, 10);

    // Next selections must skip keyA and rotate between keyB and keyC
    const k2 = pool.selectNextKey("gq");
    expect(k2?.key).toBe("gsk_keyB");

    const k3 = pool.selectNextKey("gq");
    expect(k3?.key).toBe("gsk_keyC");

    const k4 = pool.selectNextKey("gq");
    expect(k4?.key).toBe("gsk_keyB");
  });
});
