import { serve } from "bun";
import Redis from "ioredis";
import * as crypto from "crypto";
import { readFileSync, existsSync } from "fs";
import * as path from "path";

// =====================================================================
// Configuration & Dynamic Model Registry
// =====================================================================
const LITEROUTER_PORT = 7767;
const LITEROUTER_AUTH_KEY = Bun.env.LITEROUTER_AUTH_KEY || "";
const LITEROUTER_COLLAPSE_REASONING =
  (Bun.env.LITEROUTER_COLLAPSE_REASONING || "false").toLowerCase() === "true";
const LITEROUTER_ROTATE_DELAY_MS = parseInt(
  Bun.env.LITEROUTER_ROTATE_DELAY_MS || "2000",
  10,
);

const REDIS_HOST = Bun.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = parseInt(Bun.env.REDIS_PORT || "6379", 10);
const REDIS_PASSWORD = Bun.env.REDIS_PASSWORD || undefined;

// Load models.json dynamically with parent directory fallback
let modelsFilePath = path.join(process.cwd(), "models.json");
if (!existsSync(modelsFilePath)) {
  modelsFilePath = path.join(process.cwd(), "..", "models.json");
}

let modelsJson: any[] = [];
try {
  modelsJson = JSON.parse(readFileSync(modelsFilePath, "utf-8"));
} catch (err) {
  console.error(`Failed to load models.json from ${modelsFilePath}:`, err);
  process.exit(1);
}

const BASE_URLS: Record<string, string> = {
  nvidia: Bun.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1",
  openrouter: Bun.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
  zen: Bun.env.ZEN_BASE_URL || "https://opencode.ai/zen/v1",
  google:
    (Bun.env.GOOGLE_BASE_URL
      ? Bun.env.GOOGLE_BASE_URL.endsWith("/openai")
        ? Bun.env.GOOGLE_BASE_URL
        : `${Bun.env.GOOGLE_BASE_URL}/openai`
      : null) || "https://generativelanguage.googleapis.com/v1beta/openai",
  mcpmart: Bun.env.MCPMART_BASE_URL || "https://mcpmart.example.com/v1",
};

const MODEL_REGISTRY: Record<string, any> = {};
for (const model of modelsJson) {
  const provider = model.provider.toLowerCase();
  const baseUrl = BASE_URLS[provider] || "";
  MODEL_REGISTRY[model.system_id] = {
    provider: provider,
    upstream_model: model.upstream_id,
    api_url: `${baseUrl}/chat/completions`,
  };
}

// =====================================================================
// Limits & Key Validation
// =====================================================================
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
    const providerLower = provider.toLowerCase();
    for (const [key, limits] of Object.entries(MODEL_LIMITS)) {
      if (key.includes("/")) {
        const [keyProv, keyModel] = key.split("/", 2);
        if (keyProv === providerLower && modelName.includes(keyModel))
          return limits;
      }
    }
    if (PROVIDER_LIMITS[providerLower]) return PROVIDER_LIMITS[providerLower];
  }
  for (const [key, limits] of Object.entries(MODEL_LIMITS)) {
    if (!key.includes("/") && modelName.includes(key)) return limits;
  }
  return DEFAULT_LIMITS;
}

function parseKeys(keysStr?: string): string[] {
  if (!keysStr) return [];
  const rawKeys = keysStr
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k);
  const validKeys: string[] = [];
  const placeholders = ["changeme", "placeholder", "your_key", "todo", "xxxx"];

  for (const key of rawKeys) {
    const lowerKey = key.toLowerCase();
    const isPlaceholder = placeholders.some((p) => lowerKey.includes(p));
    const hasAngleBrackets = key.includes("<") || key.includes(">");
    const tooShort = key.length < 30;

    if (!isPlaceholder && !hasAngleBrackets && !tooShort) {
      validKeys.push(key);
    } else {
      console.warn(
        `[Static Validator] Discarded invalid key: ${key.substring(0, 6)}...`,
      );
    }
  }
  return validKeys;
}

// =====================================================================
// Valkey/Redis Router
// =====================================================================
class ModelFirstRouter {
  redis: Redis;
  keys: Record<string, string[]>;

  constructor() {
    this.redis = new Redis({
      host: REDIS_HOST,
      port: REDIS_PORT,
      password: REDIS_PASSWORD,
    });
    this.keys = {
      google: parseKeys(Bun.env.GOOGLE_API_KEYS),
      nvidia: parseKeys(Bun.env.NVIDIA_API_KEYS),
      openrouter: parseKeys(Bun.env.OPENROUTER_API_KEYS),
      zen: parseKeys(Bun.env.ZEN_API_KEYS),
    };
  }

  hashKey(key: string) {
    return crypto
      .createHash("sha256")
      .update(key)
      .digest("hex")
      .substring(0, 16);
  }

  async getAvailableKey(
    provider: string,
    modelName: string,
    estimatedTokens: number,
  ): Promise<string> {
    const candidateKeys = this.keys[provider.toLowerCase()] || [];
    if (candidateKeys.length === 0)
      throw new Error(`NoDeploymentsAvailable: No keys configured for provider: ${provider}`);

    const limits = getModelLimits(modelName, provider);
    const minuteTs = Math.floor(Date.now() / 60000);

    for (const key of candidateKeys) {
      const keyHash = this.hashKey(key);
      const cooldownKey = `cooldown:${provider}:${keyHash}:${modelName}`;

      if (await this.redis.exists(cooldownKey)) continue;

      const tpmKey = `quota:${provider}:${keyHash}:${modelName}:tpm:${minuteTs}`;
      const rpmKey = `quota:${provider}:${keyHash}:${modelName}:rpm:${minuteTs}`;

      const usage = await this.redis.mget(tpmKey, rpmKey);
      const currentTpm = parseInt(usage[0] || "0", 10);
      const currentRpm = parseInt(usage[1] || "0", 10);

      if (
        currentRpm >= limits.max_rpm ||
        currentTpm + estimatedTokens > limits.max_tpm
      ) {
        console.warn(
          `[${provider.toUpperCase()}] Key ${keyHash} skipped due to quota limits for ${modelName}. ` +
          `TPM: ${currentTpm}/${limits.max_tpm}, RPM: ${currentRpm}/${limits.max_rpm}.`
        );
        continue;
      }

      const pipe = this.redis.pipeline();
      pipe.incrby(tpmKey, estimatedTokens);
      pipe.expire(tpmKey, 60);
      pipe.incr(rpmKey);
      pipe.expire(rpmKey, 60);
      await pipe.exec();

      return key;
    }
    throw new Error(
      `NoDeploymentsAvailable: All keys for ${provider} are in cooldown or have exhausted quota for model ${modelName}.`
    );
  }

  async reportError(
    provider: string,
    key: string,
    errorType: string,
    modelName: string,
  ) {
    const keyHash = this.hashKey(key);
    const cooldownKey = `cooldown:${provider}:${keyHash}:${modelName}`;
    let ttl = 30;
    let state = `error_${errorType}`;

    if (["429", "rate_limit"].includes(errorType)) {
      ttl = 60;
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
      `[${provider.toUpperCase()}] Placed key ${keyHash} on ${state} cooldown for model ${modelName} with TTL ${ttl}s.`
    );
  }
}

const router = new ModelFirstRouter();

// =====================================================================
// Payload Sanitization & Stream Transformers
// =====================================================================
function mergeConsecutiveMessages(messages: any[]) {
  if (!messages || messages.length === 0) return [];
  const merged = [];
  for (const msg of messages) {
    if (merged.length === 0) {
      merged.push({ ...msg });
      continue;
    }
    const prev = merged[merged.length - 1];
    if (prev.role === msg.role) {
      const prevContent = prev.content || "";
      const currContent = msg.content || "";
      if (typeof prevContent === "string" && typeof currContent === "string") {
        prev.content = prevContent + "\n\n" + currContent;
      } else if (Array.isArray(prevContent) && Array.isArray(currContent)) {
        prev.content = prevContent.concat(currContent);
      } else if (
        Array.isArray(prevContent) &&
        typeof currContent === "string"
      ) {
        prev.content = prevContent.concat([
          { type: "text", text: currContent },
        ]);
      } else if (
        typeof prevContent === "string" &&
        Array.isArray(currContent)
      ) {
        prev.content = [{ type: "text", text: prevContent }].concat(
          currContent,
        );
      } else {
        prev.content = String(prevContent) + "\n\n" + String(currContent);
      }
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
}

function cleanLatexSymbols(text: string): string {
  let cleaned = text.replace(/\$\\{1,2}times\s*(\d+(?:\.\d+)?)\$/g, "× $1");
  const replacements = [
    ["$\\\\rightarrow$", "→"],
    ["\\\\rightarrow", "→"],
    ["$\\\\to$", "→"],
    ["\\\\to", "→"],
    ["$\\rightarrow$", "→"],
    ["\\rightarrow", "→"],
    ["$\\to$", "→"],
    ["\\to", "→"],
    ["$\\\\times$", "×"],
    ["\\\\times", "×"],
    ["$\\times$", "×"],
    ["\\times", "×"],
  ];
  for (const [target, rep] of replacements) {
    cleaned = cleaned.split(target).join(rep);
  }
  return cleaned;
}

function cleanGemmaPayload(data: any): any {
  if (data && typeof data === "object") {
    if (Array.isArray(data)) {
      return data.map(cleanGemmaPayload);
    }
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(data)) {
      if (k !== "thinkingConfig" && k !== "thinking_config") {
        cleaned[k] = cleanGemmaPayload(v);
      }
    }
    return cleaned;
  }
  return data;
}

function verifyAuthKey(req: Request, url: URL): boolean {
  if (!LITEROUTER_AUTH_KEY) return true;

  // 1. Bearer Token
  const authHeader = req.headers.get("Authorization") || "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.split("Bearer ")[1].trim();
    if (token === LITEROUTER_AUTH_KEY) return true;
  }

  // 2. x-goog-api-key header
  const googKey = req.headers.get("x-goog-api-key") || "";
  if (googKey.trim() === LITEROUTER_AUTH_KEY) return true;

  // 3. key query parameter
  const queryKey = url.searchParams.get("key") || "";
  if (queryKey.trim() === LITEROUTER_AUTH_KEY) return true;

  return false;
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

              if (typeof rawReasoning === "object" && rawReasoning !== null) {
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
              choices[0].delta = delta;
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
        const closingChunk = {
          choices: [{ index: 0, delta: { content: "\n</thought>\n" } }],
        };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(closingChunk)}\n\n`),
        );
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });
}

function transformNonStreaming(data: any, collapseReasoning: boolean) {
  const choices = data.choices || [];
  if (choices.length === 0) return data;

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
      const originalContent = message.content || "";
      message.content = `<thought>\n${reasoning}\n</thought>\n${originalContent}`;
      message.reasoning_content = null;
    } else {
      message.reasoning_content = reasoning;
    }
  }

  choices[0].message = message;
  data.choices = choices;
  return data;
}

// =====================================================================
// Bun HTTP Server
// =====================================================================
serve({
  port: LITEROUTER_PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Google native SDK pass-through route
    if (url.pathname.startsWith("/v1beta/models/")) {
      const modelNameAndAction = url.pathname.substring("/v1beta/models/".length);
      const parts = modelNameAndAction.split(":");
      const modelName = parts[0];
      const action = parts[1] || "generateContent";

      // Auth Gate
      if (!verifyAuthKey(req, url)) {
        return new Response(
          JSON.stringify({ error: "Unauthorized client credentials" }),
          { status: 401 },
        );
      }

      let meta = MODEL_REGISTRY[modelName];
      if (!meta) {
        meta = MODEL_REGISTRY["google/" + modelName];
      }

      if (!meta) {
        return new Response(
          JSON.stringify({ error: `Model '${modelName}' is not recognized or whitelisted in LiteRouter.` }),
          { status: 400 },
        );
      }

      if (meta.provider !== "google") {
        return new Response(
          JSON.stringify({ error: `Model '${modelName}' is not a Google model and cannot be queried via Google REST endpoint.` }),
          { status: 400 },
        );
      }

      let reqJson;
      try {
        reqJson = await req.json();
      } catch (e) {
        reqJson = {};
      }

      if (meta.upstream_model.toLowerCase().includes("gemma")) {
        reqJson = cleanGemmaPayload(reqJson);
      }

      const estimatedTokens = Math.floor(JSON.stringify(reqJson).length / 4) + 1024;

      for (let attempt = 0; attempt < 3; attempt++) {
        let activeKey = null;
        try {
          activeKey = await router.getAvailableKey(
            meta.provider,
            meta.upstream_model,
            estimatedTokens,
          );

          const targetUrl = new URL(`https://generativelanguage.googleapis.com/v1beta/models/${meta.upstream_model}:${action}`);
          for (const [k, v] of url.searchParams.entries()) {
            targetUrl.searchParams.set(k, v);
          }
          targetUrl.searchParams.set("key", activeKey);

          const headers: Record<string, string> = {};
          req.headers.forEach((v, k) => {
            if (!["host", "authorization", "content-length"].includes(k.toLowerCase())) {
              headers[k] = v;
            }
          });

          const upstreamRes = await fetch(targetUrl.toString(), {
            method: "POST",
            headers,
            body: JSON.stringify(reqJson),
          });

          if (!upstreamRes.ok) {
            const status = upstreamRes.status.toString();
            await router.reportError(
              meta.provider,
              activeKey,
              status,
              meta.upstream_model,
            );
            if (attempt === 2)
              return new Response(`Upstream failed: ${status}`, { status: 502 });
            continue;
          }

          const responseHeaders: Record<string, string> = {};
          upstreamRes.headers.forEach((v, k) => {
            if (!["transfer-encoding", "content-encoding"].includes(k.toLowerCase())) {
              responseHeaders[k] = v;
            }
          });

          return new Response(upstreamRes.body, {
            status: upstreamRes.status,
            headers: responseHeaders,
          });

        } catch (e: any) {
          if (e.message.includes("NoDeploymentsAvailable")) {
            if (attempt === 2) {
              console.error(`No keys available for ${meta.provider} on model ${meta.upstream_model}: ${e.message}`);
              return new Response(JSON.stringify({ error: e.message }), {
                status: 429,
              });
            }
            await new Promise((r) => setTimeout(r, LITEROUTER_ROTATE_DELAY_MS));
            continue;
          }
          if (activeKey)
            await router.reportError(
              meta.provider,
              activeKey,
              "timeout",
              meta.upstream_model,
            );
          if (attempt === 2) {
            console.error(`Failover loop exhausted on Google native route: ${e.message}`);
            return new Response(
              JSON.stringify({ error: `All upstream nodes failed to resolve request: ${e.message}` }),
              { status: 502 },
            );
          }
        }
      }
      return new Response(JSON.stringify({ error: "Failover loop exhausted." }), {
        status: 502,
      });
    }

    if (url.pathname !== "/v1/chat/completions") {
      return new Response("Not Found", { status: 404 });
    }

    // Auth Gate
    if (!verifyAuthKey(req, url)) {
      return new Response(
        JSON.stringify({ error: "Unauthorized client credentials" }),
        { status: 401 },
      );
    }

    let reqJson;
    try {
      reqJson = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Invalid payload JSON" }), {
        status: 400,
      });
    }

    const modelName = reqJson.model;
    let meta = MODEL_REGISTRY[modelName];
    if (!meta) {
      meta = MODEL_REGISTRY["google/" + modelName];
    }

    if (!meta) {
      return new Response(
        JSON.stringify({ error: `Model '${modelName}' is not recognized or whitelisted in LiteRouter.` }),
        { status: 400 },
      );
    }

    reqJson.model = meta.upstream_model;
    if (meta.upstream_model.toLowerCase().includes("gemma")) {
      reqJson = cleanGemmaPayload(reqJson);
    }
    reqJson.messages = mergeConsecutiveMessages(reqJson.messages || []);
    const isStream = reqJson.stream === true;
    const estimatedTokens =
      Math.floor(JSON.stringify(reqJson.messages).length / 4) +
      (reqJson.max_tokens || 2048);

    // Failover Loop
    for (let attempt = 0; attempt < 3; attempt++) {
      let activeKey = null;
      try {
        activeKey = await router.getAvailableKey(
          meta.provider,
          meta.upstream_model,
          estimatedTokens,
        );

        const upstreamRes = await fetch(meta.api_url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(reqJson),
        });

        if (!upstreamRes.ok) {
          const status = upstreamRes.status.toString();
          await router.reportError(
            meta.provider,
            activeKey,
            status,
            meta.upstream_model,
          );
          if (attempt === 2)
            return new Response(
              JSON.stringify({ error: `All upstream nodes failed to resolve request: Server error '${status}'` }),
              { status: 502 }
            );
          continue;
        }

        if (isStream) {
          const transformStream = createStreamTransformer(
            LITEROUTER_COLLAPSE_REASONING,
          );
          return new Response(upstreamRes.body!.pipeThrough(transformStream), {
            headers: { "Content-Type": "text/event-stream" },
          });
        } else {
          const text = await upstreamRes.text();
          const cleanedText = cleanLatexSymbols(text);
          const data = JSON.parse(cleanedText);
          const transformed = transformNonStreaming(
            data,
            LITEROUTER_COLLAPSE_REASONING,
          );
          return new Response(JSON.stringify(transformed), {
            headers: { "Content-Type": "application/json" },
          });
        }
      } catch (e: any) {
        if (e.message.includes("NoDeploymentsAvailable")) {
          if (attempt === 2) {
            console.error(`No keys available for ${meta.provider} on model ${meta.upstream_model}: ${e.message}`);
            return new Response(JSON.stringify({ error: e.message }), {
              status: 429,
            });
          }
          await new Promise((r) => setTimeout(r, LITEROUTER_ROTATE_DELAY_MS));
          continue;
        }
        if (activeKey)
          await router.reportError(
            meta.provider,
            activeKey,
            "timeout",
            meta.upstream_model,
          );
        if (attempt === 2) {
          console.error(`Failover loop exhausted on OpenAI route: ${e.message}`);
          return new Response(
            JSON.stringify({ error: `All upstream nodes failed to resolve request: ${e.message}` }),
            { status: 502 },
          );
        }
      }
    }
    return new Response(JSON.stringify({ error: "Failover loop exhausted." }), {
      status: 502,
    });
  },
});

console.log(`🚀 LiteRouter running on port ${LITEROUTER_PORT}`);
