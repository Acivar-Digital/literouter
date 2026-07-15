
import { serve } from "bun";
import Redis from "ioredis";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// 1. Configuration & Environment
// ============================================================================
const LITEROUTER_PORT = parseInt(
  (Bun.env.LITEROUTER_PORT || "7766"),
  10,
);
const LITEROUTER_AUTH_KEY = Bun.env.LITEROUTER_AUTH_KEY || "";
const LITEROUTER_COLLAPSE_REASONING =
  (Bun.env.LITEROUTER_COLLAPSE_REASONING || "false").toLowerCase() === "true";
const LITEROUTER_ROTATE_DELAY_MS = parseInt(
  Bun.env.LITEROUTER_ROTATE_DELAY_MS || "10000",
  10,
);
const LITEROUTER_MAX_ATTEMPTS = parseInt(
  Bun.env.LITEROUTER_MAX_ATTEMPTS || "3",
  10,
);
const LITEROUTER_HTTP_TIMEOUT_MS =
  parseInt(Bun.env.LITEROUTER_HTTP_TIMEOUT || "300", 10) * 1000;

// Per-provider key rotation delay override (e.g. GOOGLE_MIN_DELAY_MS=0)
function getProviderDelayMs(provider: string): number {
  const envKey = `${provider.toUpperCase()}_MIN_DELAY_MS`;
  const val = Bun.env[envKey] as string | undefined;
  return val ? parseInt(val, 10) : LITEROUTER_ROTATE_DELAY_MS;
}

const REDIS_HOST = Bun.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(Bun.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = Bun.env.REDIS_PASSWORD || undefined;
const REDIS_DB = parseInt(Bun.env.REDIS_DB || "0", 10);

const ZEN_BASE_URL = Bun.env.ZEN_BASE_URL || "https://opencode.ai/zen/v1";

const PROVIDER_API_URLS: Record<string, string> = {
  nvidia:
    (Bun.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1") +
    "/chat/completions",
  openrouter:
    (Bun.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1") +
    "/chat/completions",
  google: (() => {
    const g = Bun.env.GOOGLE_BASE_URL;
    if (g) {
      const base = g.endsWith("/openai")
        ? g
        : g.endsWith("/v1beta")
          ? `${g}/openai`
          : g;
      return base.endsWith("/chat/completions")
        ? base
        : `${base}/chat/completions`;
    }
    return "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
  })(),
  zen: `${ZEN_BASE_URL}/chat/completions`,
};

// ============================================================================
// 2. Model Limits & Registry
// ============================================================================
const MODEL_LIMITS: Record<string, any> = {
  "google/gemini-3.1-flash-lite": {
    max_tpm: 250000,
    max_rpm: 15,
    context_window: 250000,
  },
  "google/gemma": { max_tpm: 100000000, max_rpm: 15, context_window: 250000 },
};

const PROVIDER_LIMITS: Record<string, any> = {
  nvidia: { max_tpm: 1000000, max_rpm: 40, context_window: 1000000 },
  openrouter: { max_tpm: 1000000, max_rpm: 20, context_window: 1000000 },
};

const DEFAULT_LIMITS = {
  max_tpm: 1000000,
  max_rpm: 15,
  context_window: 1000000,
};

function getModelLimits(modelName: string, provider?: string) {
  if (provider) {
    const provLower = provider.toLowerCase();
    for (const [key, limits] of Object.entries(MODEL_LIMITS)) {
      if (
        key.includes("/") &&
        key.split("/")[0] === provLower &&
        modelName.includes(key.split("/")[1])
      ) {
        return limits;
      }
    }
    if (PROVIDER_LIMITS[provLower]) return PROVIDER_LIMITS[provLower];
  }
  for (const [key, limits] of Object.entries(MODEL_LIMITS)) {
    if (!key.includes("/") && modelName.includes(key)) return limits;
  }
  return DEFAULT_LIMITS;
}

function staticValidateKeys(provider: string, keysStr: string): string[] {
  if (!keysStr) return [];
  const rawKeys = keysStr
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);
  const placeholders = ["changeme", "placeholder", "your_key", "todo", "xxxx"];
  const validKeys: string[] = [];

  for (const key of rawKeys) {
    const lower = key.toLowerCase();
    const isPlaceholder = placeholders.some((p) => lower.includes(p));
    const hasBrackets = key.includes("<") || key.includes(">");
    const tooShort = key.length < 30;

    if (isPlaceholder || hasBrackets || tooShort) {
      console.warn(
        `[${provider}] Gate 1 Static Validator: Discarded invalid key.`,
      );
    } else {
      validKeys.push(key);
    }
  }
  return validKeys;
}

const API_KEYS = {
  google: staticValidateKeys("GOOGLE", Bun.env.GOOGLE_API_KEYS || ""),
  nvidia: staticValidateKeys("NVIDIA", Bun.env.NVIDIA_API_KEYS || ""),
  openrouter: staticValidateKeys(
    "OPENROUTER",
    Bun.env.OPENROUTER_API_KEYS || "",
  ),
  zen: staticValidateKeys("ZEN", Bun.env.ZEN_API_KEYS || ""),
};

interface ModelMeta {
  provider: string;
  upstream_model: string;
  api_url: string;
}

const MODEL_REGISTRY = new Map<string, ModelMeta>();
const FUSION_GROUPS = new Map<
  string,
  { description: string; chain: string[]; upstream?: string }
>();

const ROOT_DIR = import.meta.dir
  ? path.resolve(import.meta.dir, "../..")
  : process.cwd();

function loadRegistries() {
  try {
    const modelsPath = path.resolve(ROOT_DIR, "models.json");
    const modelsData = JSON.parse(fs.readFileSync(modelsPath, "utf-8"));
    for (const m of modelsData) {
      const provider = (m.provider || "").toLowerCase();
      const apiUrl = PROVIDER_API_URLS[provider];
      if (apiUrl) {
        MODEL_REGISTRY.set(m.system_id, {
          provider,
          upstream_model: m.upstream_id,
          api_url: apiUrl,
        });
      }
    }
    console.log(`Loaded ${MODEL_REGISTRY.size} models from models.json`);
  } catch (e) {
    console.error("Failed to load models.json:", e);
    process.exit(1);
  }

  try {
    const fusionPath = path.resolve(ROOT_DIR, "fusion.json");
    if (fs.existsSync(fusionPath)) {
      const fusionData = JSON.parse(fs.readFileSync(fusionPath, "utf-8"));
      for (const [id, data] of Object.entries(fusionData)) {
        FUSION_GROUPS.set(id, data as any);
      }
      console.log(
        `Loaded ${FUSION_GROUPS.size} fusion groups from fusion.json`,
      );
    }
  } catch (e) {
    console.error("Failed to load fusion.json:", e);
  }
}
loadRegistries();

// ============================================================================
// 3. Redis Router (ZSET + Lua Quota & Cooldowns)
// ============================================================================
const QUOTA_CHECK_SCRIPT = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local max_rpm = tonumber(ARGV[2])
local max_tpm = tonumber(ARGV[3])
local estimated_tokens = tonumber(ARGV[4])
local member_string = ARGV[5]

redis.call('ZREMRANGEBYSCORE', key, '-inf', now - 60)
local members = redis.call('ZRANGEBYSCORE', key, now - 60, now)

local current_rpm = #members
local current_tpm = 0

for i=1, #members do
    local mem = members[i]
    local colon_idx = string.find(mem, ":")
    if colon_idx then
        local tokens = tonumber(string.sub(mem, colon_idx + 1))
        if tokens then
            current_tpm = current_tpm + tokens
        end
    end
end

if current_rpm >= max_rpm or (current_tpm + estimated_tokens) > max_tpm then
    return {0, current_rpm, current_tpm}
else
    redis.call('ZADD', key, now, member_string)
    redis.call('EXPIRE', key, 120)
    return {1, current_rpm, current_tpm}
end
`;

class ModelFirstRouter {
  private redis: Redis | null = null;
  private scriptSha: string | null = null;
  private lastUsed = new Map<string, number>();
  private nextIndex = new Map<string, number>();

  constructor() {
    this.redis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
      db: REDIS_DB,
      lazyConnect: true,
    });
    this.redis.on("error", (err) => console.error("Redis error:", err));
  }

  async connect() {
    try {
      await this.redis!.connect();
      this.scriptSha = await this.redis!.script("LOAD", QUOTA_CHECK_SCRIPT);
      console.log("Connected to Redis/Valkey. Lua script loaded.");
    } catch (e) {
      console.error(
        "Failed to connect to Redis. Running in degraded mode (no quotas).",
        e,
      );
      this.redis = null;
    }
  }

  private hashKey(key: string): string {
    return new Bun.CryptoHasher("sha256")
      .update(key)
      .digest("hex")
      .substring(0, 16);
  }

  private getMinDelayMs(provider: string): number {
    const envOverride = Bun.env[`${provider.toUpperCase()}_MIN_DELAY_MS`] as string | undefined;
    return envOverride ? parseInt(envOverride, 10) : LITEROUTER_ROTATE_DELAY_MS;
  }

  async getAvailableKey(
    provider: string,
    modelName: string,
    estimatedTokens: number,
  ): Promise<{key: string; currentRpm: number}> {
    const keys = API_KEYS[provider as keyof typeof API_KEYS] || [];
    if (!keys.length)
      throw new Error(`No keys configured for provider: ${provider}`);

    if (!this.redis) {
      // Degraded mode: simple round-robin
      const idx = this.nextIndex.get(provider) || 0;
      this.nextIndex.set(provider, (idx + 1) % keys.length);
      return {key: keys[idx], currentRpm: 0};
    }

    const limits = getModelLimits(modelName, provider);
    const now = Date.now() / 1000;
    const minDelay = this.getMinDelayMs(provider) / 1000.0;
    const startIdx = this.nextIndex.get(provider) || 0;
    const n = keys.length;

    let lruCandidate: { key: string; idx: number; lastUsed: number } | null =
      null;

    for (let i = 0; i < n; i++) {
      const idx = (startIdx + i) % n;
      const key = keys[idx];
      const keyHash = this.hashKey(key);
      const lastUsedKey = `${provider}:${keyHash}`;
      const cooldownKey = `cooldown:${provider}:${keyHash}:${modelName}`;

      if (await this.redis.exists(cooldownKey)) continue;

      const lastUsedTime = this.lastUsed.get(lastUsedKey) || 0;
      const elapsed = now - lastUsedTime;

      if (elapsed < minDelay) {
        if (!lruCandidate || lastUsedTime < lruCandidate.lastUsed) {
          lruCandidate = { key, idx, lastUsed: lastUsedTime };
        }
        continue;
      }

      const rollingKey = `rolling:${provider}:${keyHash}:${modelName}`;
      const member = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}:${estimatedTokens}`;

      let res: any;
      try {
        res = await this.redis.evalsha(
          this.scriptSha!,
          1,
          rollingKey,
          now,
          limits.max_rpm,
          limits.max_tpm,
          estimatedTokens,
          member,
        );
      } catch (e) {
        res = await this.redis.eval(
          QUOTA_CHECK_SCRIPT,
          1,
          rollingKey,
          now,
          limits.max_rpm,
          limits.max_tpm,
          estimatedTokens,
          member,
        );
      }

      if (res[0] === 0) continue;

      this.lastUsed.set(lastUsedKey, now);
      this.nextIndex.set(provider, (idx + 1) % n);
      return {key, currentRpm: res[1]};
    }

    if (lruCandidate) {
      const { key, idx } = lruCandidate;
      const keyHash = this.hashKey(key);
      const rollingKey = `rolling:${provider}:${keyHash}:${modelName}`;
      const member = `${Date.now()}-${Math.random().toString(36).substring(2, 10)}:${estimatedTokens}`;

      let res: any;
      try {
        res = await this.redis.evalsha(
          this.scriptSha!,
          1,
          rollingKey,
          now,
          limits.max_rpm,
          limits.max_tpm,
          estimatedTokens,
          member,
        );
      } catch (e) {
        res = await this.redis.eval(
          QUOTA_CHECK_SCRIPT,
          1,
          rollingKey,
          now,
          limits.max_rpm,
          limits.max_tpm,
          estimatedTokens,
          member,
        );
      }

      if (res[0] === 1) {
        this.lastUsed.set(`${provider}:${keyHash}`, now);
        this.nextIndex.set(provider, (idx + 1) % n);
        return {key, currentRpm: res[1]};
      }
    }

    throw new Error(
      `All keys for ${provider} are in cooldown or have exhausted quota for model ${modelName}.`,
    );
  }

  async reportError(
    provider: string,
    key: string,
    errorType: string,
    modelName: string,
  ) {
    if (!this.redis) return;
    const keyHash = this.hashKey(key);
    const cooldownKey = `cooldown:${provider}:${keyHash}:${modelName}`;

    let ttl = 30;
    let state = `error_${errorType}`;

    if (["429", "rate_limit"].includes(errorType)) {
      ttl = 65;
      state = "rate_limited";
    } else if (["timeout", "503", "504"].includes(errorType)) {
      ttl = 10;
      state = "timed_out";
    } else if (
      ["401", "403", "auth", "permission_denied"].includes(errorType)
    ) {
      ttl = 604800;
      state = "quarantined";
    }

    await this.redis.set(cooldownKey, state, "EX", ttl);
    console.error(
      `[${provider.toUpperCase()}] Placed key ${keyHash} on ${state} cooldown for ${modelName} (TTL ${ttl}s)`,
    );
  }
}

const router = new ModelFirstRouter();
router.connect();

// ============================================================================
// 4. Fusion State (In-Memory Circuit Breaker & Sticky Fallback)
// ============================================================================
const CIRCUIT_TTL = 65000;
const STICKY_TTL = 300000;

const circuitOpenUntil = new Map<string, number>();
const stickyPosition = new Map<
  string,
  { upstreamId: string; expiry: number }
>();

function openCircuit(upstreamId: string) {
  circuitOpenUntil.set(upstreamId, Date.now() + CIRCUIT_TTL);
}
function closeCircuit(upstreamId: string) {
  circuitOpenUntil.delete(upstreamId);
}
function isCircuitOpen(upstreamId: string) {
  return Date.now() < (circuitOpenUntil.get(upstreamId) || 0);
}

function getStickyStart(groupId: string, chain: string[]): number {
  const entry = stickyPosition.get(groupId);
  if (!entry) return 0;
  if (Date.now() >= entry.expiry) {
    stickyPosition.delete(groupId);
    return 0;
  }
  const idx = chain.indexOf(entry.upstreamId);
  return idx > 0 ? idx : 0;
}
function setSticky(groupId: string, upstreamId: string) {
  stickyPosition.set(groupId, { upstreamId, expiry: Date.now() + STICKY_TTL });
}
function clearSticky(groupId: string) {
  stickyPosition.delete(groupId);
}

// ============================================================================
// 5. Payload Processing Utilities
// ============================================================================
function estimateTokens(promptText: string, maxTokens: number = 2048): number {
  return Math.floor(promptText.length / 4) + maxTokens;
}

function cleanGemmaPayload(data: any): any {
  if (Array.isArray(data)) return data.map(cleanGemmaPayload);
  if (data !== null && typeof data === "object") {
    const cleaned: any = {};
    for (const [k, v] of Object.entries(data)) {
      if (k !== "thinkingConfig" && k !== "thinking_config") {
        cleaned[k] = cleanGemmaPayload(v);
      }
    }
    return cleaned;
  }
  return data;
}

function cleanLatexSymbols(text: string): string {
  let res = text.replace(/\\{1,2}times\s*(\d+(?:\.\d+)?)/g, "× $1");
  const replacements: [RegExp, string][] = [
    [
      /(\$\\\\rightarrow\$|\\\\rightarrow|\$\\\\to\$|\\\\to|\$\\rightarrow\$|\\rightarrow|\$\\to\$|\\to)/g,
      "→",
    ],
    [/(\$\\\\times\$|\\\\times|\$\\times\$|\\times)/g, "×"],
  ];
  for (const [reg, rep] of replacements) {
    res = res.replace(reg, rep);
  }
  return res;
}

function mergeConsecutiveMessages(messages: any[]): any[] {
  if (!messages || !Array.isArray(messages)) return [];
  const merged: any[] = [];
  for (const msg of messages) {
    if (merged.length === 0) {
      merged.push({ ...msg });
      continue;
    }
    const prev = merged[merged.length - 1];
    if (prev.role === msg.role) {
      const pContent = prev.content || "";
      const cContent = msg.content || "";
      if (typeof pContent === "string" && typeof cContent === "string") {
        prev.content = pContent + "\n\n" + cContent;
      } else if (Array.isArray(pContent) && Array.isArray(cContent)) {
        prev.content = pContent.concat(cContent);
      } else if (Array.isArray(pContent) && typeof cContent === "string") {
        prev.content = pContent.concat([{ type: "text", text: cContent }]);
      } else if (typeof pContent === "string" && Array.isArray(cContent)) {
        prev.content = [{ type: "text", text: pContent }].concat(cContent);
      } else {
        prev.content = String(pContent) + "\n\n" + String(cContent);
      }
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
}

function transformNonStreaming(data: any, collapseReasoning: boolean): any {
  const choices = data.choices || [];
  if (!choices.length) return data;

  const message = choices[0].message || {};
  const rawReasoning =
    message.reasoning_content ||
    message.reasoningContent ||
    message.thought ||
    message.thought_summary;

  let reasoning = "";
  if (typeof rawReasoning === "object" && rawReasoning !== null) {
    reasoning = rawReasoning.reasoningContent || rawReasoning.text || "";
  } else if (typeof rawReasoning === "string") {
    reasoning = rawReasoning;
  }

  delete message.reasoningContent;
  delete message.thought;
  delete message.thought_summary;

  if (reasoning) {
    if (collapseReasoning) {
      const orig = message.content || "";
      message.content = `<thought>\n${reasoning}\n</thought>\n${orig}`;
      message.reasoning_content = null;
    } else {
      message.reasoning_content = reasoning;
    }
  }
  return data;
}

function createStreamTransformer(collapseReasoning: boolean) {
  let buffer = "";
  let hasStartedThought = false;
  let hasEndedThought = false;
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  return new TransformStream({
    transform(chunk, controller) {
      buffer += cleanLatexSymbols(decoder.decode(chunk, { stream: true }));
      let lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("data: ")) {
          const dataStr = line.substring(6).trim();
          if (dataStr === "[DONE]") continue;

          try {
            const json = JSON.parse(dataStr);
            const choices = json.choices || [];
            if (choices.length > 0) {
              const delta = choices[0].delta || {};
              const rawReasoning =
                delta.reasoning_content ||
                delta.reasoningContent ||
                delta.thought ||
                delta.thought_summary;
              let reasoning = "";
              if (
                typeof rawReasoning === "object" &&
                rawReasoning !== null
              ) {
                reasoning =
                  rawReasoning.reasoningContent || rawReasoning.text || "";
              } else if (typeof rawReasoning === "string") {
                reasoning = rawReasoning;
              }

              delete delta.reasoningContent;
              delete delta.thought;
              delete delta.thought_summary;

              if (reasoning) {
                if (collapseReasoning) {
                  let contentDelta = "";
                  if (!hasStartedThought) {
                    contentDelta += "<thought>\n";
                    hasStartedThought = true;
                  }
                  contentDelta += reasoning;
                  delta.content = contentDelta;
                  delta.reasoning_content = null;
                } else {
                  delta.reasoning_content = reasoning;
                }
              } else if (
                collapseReasoning &&
                hasStartedThought &&
                !hasEndedThought
              ) {
                const standardContent = delta.content;
                if (
                  standardContent ||
                  delta.tool_calls ||
                  delta.function_call
                ) {
                  delta.content = "\n</thought>\n" + (standardContent || "");
                  hasEndedThought = true;
                }
              }
              json.choices = choices;
            }
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify(json)}\n\n`),
            );
          } catch (e) {
            controller.enqueue(encoder.encode(`data: ${dataStr}\n\n`));
          }
        }
      }
    },
    flush(controller) {
      if (collapseReasoning && hasStartedThought && !hasEndedThought) {
        const closing = {
          choices: [{ index: 0, delta: { content: "\n</thought>\n" } }],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(closing)}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });
}

// ============================================================================
// 6. Core Handlers
// ============================================================================
function verifyAuthKey(req: Request, url: URL): boolean {
  if (!LITEROUTER_AUTH_KEY) return true;
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    if (authHeader.slice(7).trim() === LITEROUTER_AUTH_KEY) return true;
  }
  const googKey = req.headers.get("x-goog-api-key") || "";
  if (googKey.trim() === LITEROUTER_AUTH_KEY) return true;
  const queryKey = url.searchParams.get("key") || "";
  if (queryKey.trim() === LITEROUTER_AUTH_KEY) return true;
  return false;
}

function cleanHeaders(headers: Headers): Headers {
  const h = new Headers(headers);
  [
    "host",
    "content-length",
    "content-encoding",
    "transfer-encoding",
    "connection",
  ].forEach((k) => h.delete(k));
  return h;
}

async function executeOpenAICompat(
  modelName: string,
  reqJson: any,
  reqHeaders: Headers,
  servedModelId?: string,
  fromFusion?: boolean,
): Promise<Response> {
  const meta = MODEL_REGISTRY.get(modelName);
  if (!meta)
    return new Response(
      JSON.stringify({ error: `Model '${modelName}' not recognized.` }),
      { status: 400 },
    );

  const { provider, upstream_model, api_url } = meta;
  reqJson.model = upstream_model;
  reqJson.messages = mergeConsecutiveMessages(reqJson.messages);
  if (upstream_model.toLowerCase().includes("gemma"))
    reqJson = cleanGemmaPayload(reqJson);
  console.log(`[REQ] model=${modelName} provider=${provider} upstream=${upstream_model} stream=${!!reqJson.stream}`);

  const isStream = !!reqJson.stream;
  const estimatedTokens = estimateTokens(
    JSON.stringify(reqJson.messages),
    reqJson.max_tokens || 2048,
  );
  const numKeys = (API_KEYS[provider as keyof typeof API_KEYS] || []).length;
  const maxAttempts = LITEROUTER_MAX_ATTEMPTS > 0 ? Math.min(numKeys, LITEROUTER_MAX_ATTEMPTS) : numKeys;
  const BACKOFF_MS = [65000, 90000, 120000];

  for (let round = 0; round <= BACKOFF_MS.length; round++) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let activeKey = "";
      let currentRpm = 0;
      try {
        ({key: activeKey, currentRpm} = await router.getAvailableKey(
          provider,
          upstream_model,
          estimatedTokens,
        ));
        const headers = new Headers({
          Authorization: `Bearer ${activeKey}`,
          "Content-Type": "application/json",
        });

        const resp = await fetch(api_url, {
          method: "POST",
          headers,
          body: JSON.stringify(reqJson),
          signal: AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS),
        });

        if (resp.status >= 400) {
          if (resp.status === 400) {
            const errBody = await resp.text();
            return new Response(errBody, {
              status: 400,
              headers: cleanHeaders(resp.headers),
            });
          }
          const errText = await resp.text();
          const errSnippet = errText.substring(0, 300).replace(/\n/g, " ");
          if (
            errText.includes("cooldown") ||
            errText.includes("exhausted quota")
          ) {
            await router.reportError(provider, activeKey, "429", upstream_model);
            console.log(`[PROVIDER_LIMIT] key=${activeKey.substring(0, 6)}... model=${upstream_model} (${resp.status}) rpm ${currentRpm + 1}/${getModelLimits(modelName, provider).max_rpm} body=${errSnippet}`);
          } else {
            await router.reportError(
              provider,
              activeKey,
              resp.status.toString(),
              upstream_model,
            );
            console.log(`[PROVIDER_LIMIT] key=${activeKey.substring(0, 6)}... model=${upstream_model} (${resp.status}) rpm ${currentRpm + 1}/${getModelLimits(modelName, provider).max_rpm} body=${errSnippet}`);
          }
          continue;
        }

      const outHeaders = cleanHeaders(resp.headers);
      if (servedModelId) outHeaders.set("X-Literouter-Model", servedModelId);
      console.log(`[${provider.toUpperCase()}] Served ${modelName} (upstream=${upstream_model}, key=${activeKey.substring(0, 6)}...) attempt ${attempt + 1}/${maxAttempts} rpm ${currentRpm + 1}/${getModelLimits(modelName, provider).max_rpm}`);

      if (isStream) {
        return new Response(
          resp.body!.pipeThrough(
            createStreamTransformer(LITEROUTER_COLLAPSE_REASONING),
          ),
          {
            status: resp.status,
            headers: outHeaders,
          },
        );
      } else {
        let text = await resp.text();
        text = cleanLatexSymbols(text);
        const data = transformNonStreaming(
          JSON.parse(text),
          LITEROUTER_COLLAPSE_REASONING,
        );
        return new Response(JSON.stringify(data), {
          status: resp.status,
          headers: outHeaders,
        });
      }
    } catch (e: any) {
        if (e.message.includes("All keys")) {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, getProviderDelayMs(provider)));
            continue;
          }
          if (fromFusion) {
            return new Response(JSON.stringify({ error: e.message }), {
              status: 429,
            });
          }
          if (round < BACKOFF_MS.length) {
            console.warn(
              `[${provider.toUpperCase()}] All keys exhausted, backing off ${BACKOFF_MS[round] / 1000}s (round ${round + 1}/${BACKOFF_MS.length})`,
            );
            await new Promise((r) => setTimeout(r, BACKOFF_MS[round]));
            break;
          }
          return new Response(JSON.stringify({ error: e.message }), {
            status: 429,
          });
        }
        if (activeKey)
          await router.reportError(
            provider,
            activeKey,
            "timeout",
            upstream_model,
          );
        if (round === BACKOFF_MS.length)
          return new Response(
            JSON.stringify({ error: "Upstream failed", details: e.message }),
            { status: 502 },
          );
      }
    }
    if (fromFusion) {
      return new Response(JSON.stringify({ error: "Max attempts exhausted" }), { status: 429 });
    }
  }
  console.log(`[SYSTEM_LIMIT] Max attempts (${LITEROUTER_MAX_ATTEMPTS}) reached for ${modelName}, all keys exhausted.`);
  return new Response(JSON.stringify({ error: "Failover loop exhausted" }), {
    status: 502,
  });
}

async function executeGoogleNative(
  modelName: string,
  action: string,
  queryParams: URLSearchParams,
  reqJson: any,
  reqHeaders: Headers,
  servedModelId?: string,
  fromFusion?: boolean,
): Promise<Response> {
  let meta =
    MODEL_REGISTRY.get(modelName) || MODEL_REGISTRY.get(`google/${modelName}`);
  if (!meta)
    return new Response(
      JSON.stringify({ error: `Model '${modelName}' not recognized.` }),
      { status: 400 },
    );
  if (meta.provider !== "google")
    return new Response(
      JSON.stringify({ error: `Model '${modelName}' is not a Google model.` }),
      { status: 400 },
    );

  const { upstream_model } = meta;
  if (upstream_model.toLowerCase().includes("gemma"))
    reqJson = cleanGemmaPayload(reqJson);
  console.log(`[REQ-NATIVE] model=${modelName} action=${action} provider=google upstream=${upstream_model}`);

  const estimatedTokens = estimateTokens(JSON.stringify(reqJson), 1024);
  const numKeys = API_KEYS.google.length;
  const maxAttempts = LITEROUTER_MAX_ATTEMPTS > 0 ? Math.min(numKeys, LITEROUTER_MAX_ATTEMPTS) : numKeys;
  const BACKOFF_MS = [65000, 90000, 120000];

  for (let round = 0; round <= BACKOFF_MS.length; round++) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let activeKey = "";
      let currentRpm = 0;
      try {
        ({key: activeKey, currentRpm} = await router.getAvailableKey(
          "google",
          upstream_model,
          estimatedTokens,
        ));

        const url = new URL(
          `https://generativelanguage.googleapis.com/v1beta/models/${upstream_model}:${action}`,
        );
        queryParams.forEach((v, k) => url.searchParams.append(k, v));
        url.searchParams.set("key", activeKey);

        const headers = cleanHeaders(reqHeaders);
        headers.delete("authorization");

        const resp = await fetch(url.toString(), {
          method: "POST",
          headers,
          body: Object.keys(reqJson).length ? JSON.stringify(reqJson) : undefined,
          signal: AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS),
        });

        if (resp.status >= 400) {
          if (resp.status === 400) {
            const errBody = await resp.text();
            return new Response(errBody, {
              status: 400,
              headers: cleanHeaders(resp.headers),
            });
          }
          const errText = await resp.text();
          const errSnippet = errText.substring(0, 300).replace(/\n/g, " ");
          if (
            errText.includes("cooldown") ||
            errText.includes("exhausted quota")
          ) {
            await router.reportError("google", activeKey, "429", upstream_model);
            console.log(`[PROVIDER_LIMIT] key=${activeKey.substring(0, 6)}... model=${upstream_model} (429) rpm ${currentRpm + 1}/${getModelLimits(modelName, "google").max_rpm} body=${errSnippet}`);
          } else {
            await router.reportError(
              "google",
              activeKey,
              resp.status.toString(),
              upstream_model,
            );
            console.log(`[PROVIDER_LIMIT] key=${activeKey.substring(0, 6)}... model=${upstream_model} (${resp.status}) rpm ${currentRpm + 1}/${getModelLimits(modelName, "google").max_rpm} body=${errSnippet}`);
          }
          await new Promise((r) => setTimeout(r, getProviderDelayMs("google")));
          continue;
        }

        const outHeaders = cleanHeaders(resp.headers);
      if (servedModelId) outHeaders.set("X-Literouter-Model", servedModelId);
      console.log(`[GOOGLE] Served native ${modelName}:${action} (upstream=${upstream_model}, attempt ${attempt + 1}/${maxAttempts}, rpm ${currentRpm + 1}/${getModelLimits(modelName, "google").max_rpm})`);

        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        const transform = new TransformStream({
          transform(chunk, controller) {
            let text = decoder.decode(chunk, { stream: true });
            text = cleanLatexSymbols(text);
            controller.enqueue(encoder.encode(text));
          },
        });

        return new Response(resp.body!.pipeThrough(transform), {
          status: resp.status,
          headers: outHeaders,
        });
      } catch (e: any) {
        if (e.message.includes("All keys")) {
          if (attempt < maxAttempts) {
            await new Promise((r) => setTimeout(r, getProviderDelayMs("google")));
            continue;
          }
          if (fromFusion) {
            return new Response(JSON.stringify({ error: e.message }), {
              status: 429,
            });
          }
          if (round < BACKOFF_MS.length) {
            console.warn(
              `[GOOGLE] All keys exhausted, backing off ${BACKOFF_MS[round] / 1000}s (round ${round + 1}/${BACKOFF_MS.length})`,
            );
            await new Promise((r) => setTimeout(r, BACKOFF_MS[round]));
            break;
          }
          return new Response(JSON.stringify({ error: e.message }), {
            status: 429,
          });
        }
        if (activeKey)
          await router.reportError(
            "google",
            activeKey,
            "timeout",
            upstream_model,
          );
        if (round === BACKOFF_MS.length)
          return new Response(
            JSON.stringify({ error: "Upstream failed", details: e.message }),
            { status: 502 },
          );
      }
    }
    if (fromFusion) {
      return new Response(JSON.stringify({ error: "Max attempts exhausted" }), { status: 429 });
    }
  }
  console.log(`[SYSTEM_LIMIT] Max attempts (${LITEROUTER_MAX_ATTEMPTS}) reached for ${modelName}, all keys exhausted.`);
  return new Response(JSON.stringify({ error: "Failover loop exhausted" }), {
    status: 502,
  });
}

async function executeFusion(
  groupId: string,
  group: any,
  reqJson: any,
  headers: Headers,
  queryParams: URLSearchParams,
  isNativeRoute: boolean,
  action: string,
): Promise<Response> {
  const isNativeUpstream = isNativeRoute || (group.upstream?.includes("/v1beta") ?? false);
  const chain: string[] = group.chain;
  const startIdx = getStickyStart(groupId, chain);
  console.log(`[FUSION] group=${groupId} chain=${chain.join("->")} start=${chain[startIdx]}`);

  for (let i = startIdx; i < chain.length; i++) {
    const upstreamId = chain[i];
    if (isCircuitOpen(upstreamId)) continue;

    let resp: Response;
    if (isNativeUpstream) {
      resp = await executeGoogleNative(
        upstreamId,
        action || "generateContent",
        queryParams,
        reqJson,
        headers,
        upstreamId,
        true,
      );
    } else {
      resp = await executeOpenAICompat(
        upstreamId,
        reqJson,
        headers,
        upstreamId,
        true,
      );
    }

    if (resp.status === 429 || resp.status >= 500) {
      openCircuit(upstreamId);
      console.warn(
        `[FUSION] ${groupId} -> ${upstreamId} failed (${resp.status}), advancing chain.`,
      );
      continue;
    }

    if (resp.status >= 400 && resp.status < 500) {
      console.warn(
        `[FUSION] ${groupId} -> ${upstreamId} halted on client error (${resp.status}).`,
      );
      return resp;
    }

    closeCircuit(upstreamId);
    if (i > 0) setSticky(groupId, upstreamId);
    else clearSticky(groupId);

    return resp;
  }

  return new Response(
    JSON.stringify({
      error: "All fusion backends exhausted",
      model: groupId,
      attempted: chain,
    }),
    { status: 429 },
  );
}

// ============================================================================
// 7. Server Entry Point
// ============================================================================
serve({
  port: LITEROUTER_PORT,
  idleTimeout: Math.min(LITEROUTER_HTTP_TIMEOUT_MS / 1000, 255),
  async fetch(req: Request) {
    const url = new URL(req.url);
    if (!verifyAuthKey(req, url)) {
      return new Response("Unauthorized", { status: 401 });
    }
    const bodyText = await req.text();
    let reqJson = {};
    if (bodyText) {
      try {
        reqJson = JSON.parse(bodyText);
      } catch (e) {}
    }

    if (url.pathname === "/v1/chat/completions") {
      const modelName = (reqJson as any).model;
      if (!modelName)
        return new Response(
          JSON.stringify({ error: "Missing 'model' in request" }),
          { status: 400 },
        );

      if (FUSION_GROUPS.has(modelName)) {
        return executeFusion(
          modelName,
          FUSION_GROUPS.get(modelName)!,
          reqJson,
          req.headers,
          url.searchParams,
          false,
          "",
        );
      }
      return executeOpenAICompat(modelName, reqJson, req.headers);
    }

    const nativeMatch = url.pathname.match(
      /^\/v1beta\/(?:models\/)?([^:]+)(?::(.*))?$/,
    );
    if (nativeMatch) {
      const modelName = nativeMatch[1];
      const action = nativeMatch[2] || "generateContent";

      if (FUSION_GROUPS.has(modelName)) {
        return executeFusion(
          modelName,
          FUSION_GROUPS.get(modelName)!,
          reqJson,
          req.headers,
          url.searchParams,
          true,
          action,
        );
      }
      return executeGoogleNative(
        modelName,
        action,
        url.searchParams,
        reqJson,
        req.headers,
      );
    }

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
});

console.log(`🚀 LiteRouter (Bun) running on port ${LITEROUTER_PORT}`);
