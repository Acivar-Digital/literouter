
import { serve } from "bun";
import Redis from "ioredis";
import * as fs from "fs";
import * as path from "path";
import {
  MODEL_LIMITS,
  PROVIDER_LIMITS,
  DEFAULT_LIMITS,
  getModelLimits,
  staticValidateKeys,
  estimateTokens,
  cleanGemmaPayload,
  translateGoogleThinking,
  cleanLatexSymbols,
  mergeConsecutiveMessages,
  transformNonStreaming,
  NoResponseError,
  fetchWithFirstByteTimeout,
} from "./lib";

// ============================================================================
// 0. Emoji State Logging & Trace Archive
// ============================================================================

const ROOT_DIR = import.meta.dir
  ? path.resolve(import.meta.dir, "..")
  : process.cwd();

// Intuitive per-state emoji prefixes for terminal readability. Text tags are
// preserved alongside for grep-ability.
// Terminal timestamp: MM-DD-HH:MM:SS:MS (no year) so logic errors are catchable
// at a glance. Computed from the single Date source inside each log emitter.
function logTimestamp(): string {
  const d = new Date();
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(d.getMonth() + 1, 2)}-${p(d.getDate(), 2)}-${p(d.getHours(), 2)}:${p(d.getMinutes(), 2)}:${p(d.getSeconds(), 2)}:${p(d.getMilliseconds(), 3)}`;
}

function logState(emoji: string, msg: string): void {
  console.log(`${emoji} [${logTimestamp()}] ${msg}`);
}
function logWarn(emoji: string, msg: string): void {
  console.warn(`${emoji} [${logTimestamp()}] ${msg}`);
}
function logError(emoji: string, msg: string): void {
  console.error(`${emoji} [${logTimestamp()}] ${msg}`);
}

const EMOJI = {
  inbound: "🔵",
  rotate: "🔄",
  amber: "🟡",
  limit: "⚠️",
  exhausted: "🔴",
  served: "🟢",
  boot: "🚀",
  error: "💥",
  fusion: "🔗",
  trace: "📝",
};

// Trace archive: raw downstream (request body sent upstream) + upstream
// (provider response) matched by reqId. Written non-blocking (fire-and-forget)
// to avoid I/O lag on the request path. Cleared at boot (see clearTraces()).
const TRACES_DIR = path.resolve(ROOT_DIR, "logs", "traces");

function clearTraces(): void {
  try {
    if (fs.existsSync(TRACES_DIR)) {
      for (const f of fs.readdirSync(TRACES_DIR)) {
        fs.rmSync(path.join(TRACES_DIR, f), { force: true });
      }
    } else {
      fs.mkdirSync(TRACES_DIR, { recursive: true });
    }
    logState(EMOJI.trace, `Trace archive cleared at boot (${TRACES_DIR})`);
  } catch (e) {
    logError(EMOJI.error, `Failed to clear trace archive: ${e}`);
  }
}

// Append a trace part (downstream or upstream) for a reqId. Non-blocking:
// reads existing file if present, merges, writes back detached via void.
function recordTrace(
  reqId: string,
  part: "downstream" | "upstream",
  payload: unknown,
  meta: { model: string; provider: string; status?: number },
): void {
  void (async () => {
    try {
      fs.mkdirSync(TRACES_DIR, { recursive: true });
      const file = path.join(TRACES_DIR, `${reqId}.json`);
      let record: any = {};
      if (fs.existsSync(file)) {
        try {
          record = JSON.parse(fs.readFileSync(file, "utf-8"));
        } catch {
          record = {};
        }
      }
      record.reqId = reqId;
      record.model = meta.model;
      record.provider = meta.provider;
      if (meta.status !== undefined) record.status = meta.status;
      record.ts = record.ts || new Date().toISOString();
      record[part] = payload;
      fs.writeFileSync(file, JSON.stringify(record, null, 2), { mode: 0o600 });
    } catch (e) {
      // Trace archival must never break the request path.
      logError(EMOJI.error, `Trace write failed for ${reqId}/${part}: ${e}`);
    }
  })();
}

// ============================================================================
// 1. Configuration & Environment
// ============================================================================

const thoughtSignatureStore = new Map<string, string>();

function injectThoughtSignature(body: any): void {
  if (!body.messages) return;
  for (const msg of body.messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (!tc.extra_content?.google?.thought_signature && tc.id && thoughtSignatureStore.has(tc.id)) {
          tc.extra_content = tc.extra_content || {};
          tc.extra_content.google = tc.extra_content.google || {};
          tc.extra_content.google.thought_signature = thoughtSignatureStore.get(tc.id)!;
        }
      }
    }
  }
}

function extractThoughtSignature(data: any): void {
  const toolCalls = data.choices?.[0]?.message?.tool_calls || data.choices?.[0]?.delta?.tool_calls;
  if (!toolCalls) return;
  for (const tc of toolCalls) {
    if (tc.id && tc.extra_content?.google?.thought_signature) {
      thoughtSignatureStore.set(tc.id, tc.extra_content.google.thought_signature);
    }
  }
}
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
// First-byte timeout: if the upstream sends NO response headers within this
// window (the "no signal, no response" ghost — e.g. NVIDIA black-holing the
// first request), abort and rotate to the next key. Distinct from the 300s
// total timeout: silence is treated as a retryable ghost, not a real failure.
const NO_RESPONSE_TIMEOUT_MS =
  parseInt(Bun.env.LITEROUTER_NO_RESPONSE_TIMEOUT || "10", 10) * 1000;
const NO_RESPONSE_RETRY_DELAY_MS =
  parseInt(Bun.env.LITEROUTER_NO_RESPONSE_RETRY_DELAY || "5000", 10);

// Compose the server-side HTTP timeout with the incoming client's abort signal.
// When the client disconnects (e.g. hits "Stop"), req.signal aborts and the
// upstream fetch is cancelled immediately instead of burning tokens until the
// server timeout fires. This is the correct Bun translation of the implicit
// Drop/RST_STREAM mechanism mature proxies (Envoy/agentgateway) use in Rust.
function upstreamSignal(clientSignal?: AbortSignal): AbortSignal {
  if (!clientSignal) return AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS);
  return AbortSignal.any([
    clientSignal,
    AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS),
  ]);
}

// Per-provider key rotation delay override (e.g. GOOGLE_MIN_DELAY_MS=0).
// HARD FLOOR of 2s between key attempts — providers firewall-ban bursts, so
// the "2-sec rule" is never relaxable via env (a 0 override is clamped up).
const MIN_ROTATE_DELAY_MS = 2000;
function getProviderDelayMs(provider: string): number {
  const envKey = `${provider.toUpperCase()}_MIN_DELAY_MS`;
  const val = Bun.env[envKey] as string | undefined;
  return Math.max(val ? parseInt(val, 10) : LITEROUTER_ROTATE_DELAY_MS, MIN_ROTATE_DELAY_MS);
}

// Clamp a number into [min, max].
function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// Parse an upstream-stated reset delay (seconds) from the Retry-After header or
// a Google error body (quotaResetDelay / retryDelay). Returns the RAW value
// (no floor) so callers can decide clamping. Returns null if absent.
function parseResetDelay(headers: Headers, errText: string): number | null {
  const ra = headers.get("retry-after");
  if (ra) {
    const secs = parseInt(ra, 10);
    if (!isNaN(secs) && secs > 0) return secs;
  }
  const m = errText.match(/(?:quotaResetDelay|retryDelay)\D{0,8}(\d+)/i);
  if (m) {
    const v = parseInt(m[1], 10);
    if (!isNaN(v) && v > 0) return v;
  }
  return null;
}

// Extract token usage from either OpenAI-compat `usage` or Google-native
// `usageMetadata`. Returns null when this chunk carries no usage.
function parseUsageFromJson(json: any): {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
} | null {
  if (json?.usage) {
    const u = json.usage;
    return {
      prompt_tokens: u.prompt_tokens,
      completion_tokens: u.completion_tokens,
      total_tokens: u.total_tokens,
    };
  }
  if (json?.usageMetadata) {
    const um = json.usageMetadata;
    return {
      prompt_tokens: um.promptTokenCount,
      completion_tokens: um.candidatesTokenCount,
      total_tokens: um.totalTokenCount,
    };
  }
  return null;
}

// Metadata passed into stream transformers for observability sinks.
interface StreamMeta {
  reqId?: string;
  provider: string;
  modelName: string;
  upstream_model: string;
  activeKey: string;
  servedModelId?: string;
  requestStart: number;
}

// Sink observed usage + TTFT to logs and Redis (observability only — never
// alters the response bytes or blocks the request).
function sinkUsage(meta: StreamMeta, usage: any, ttftMs?: number) {
  if (usage) {
    logState(
      EMOJI.served,
      `[USAGE ${meta.reqId}] provider=${meta.provider} model=${meta.upstream_model} prompt=${usage.prompt_tokens ?? "?"} completion=${usage.completion_tokens ?? "?"} total=${usage.total_tokens ?? "?"}`,
    );
    router.recordUsage(meta.provider, meta.activeKey, meta.modelName, usage);
  }
  if (ttftMs != null) {
    logState(
      EMOJI.served,
      `[TTFT ${meta.reqId}] provider=${meta.provider} model=${meta.upstream_model} ${ttftMs}ms`,
    );
  }
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
// (MODEL_LIMITS, PROVIDER_LIMITS, DEFAULT_LIMITS, getModelLimits and
//  staticValidateKeys are imported from ./lib)
// ============================================================================

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
clearTraces();

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
  private redis: Redis;
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
    this.redis.on("error", (err) => {
      logError(EMOJI.error, `Redis error: ${err} — exiting (no fallback)`);
      process.exit(1);
    });
  }

  async connect() {
    try {
      await this.redis!.connect();
      this.scriptSha = await this.redis!.script("LOAD", QUOTA_CHECK_SCRIPT);
      console.log("Connected to Redis/Valkey. Lua script loaded.");
    } catch (e) {
      logError(EMOJI.error, `Failed to connect to Redis. Exiting (no fallback): ${e}`);
      process.exit(1);
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
    return Math.max(envOverride ? parseInt(envOverride, 10) : LITEROUTER_ROTATE_DELAY_MS, MIN_ROTATE_DELAY_MS);
  }

  async getAvailableKey(
    provider: string,
    modelName: string,
    estimatedTokens: number,
  ): Promise<{key: string; currentRpm: number}> {
    const keys = API_KEYS[provider as keyof typeof API_KEYS] || [];
    if (!keys.length)
      throw new Error(`No keys configured for provider: ${provider}`);

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
    ttlOverride?: number | null,
  ) {
    if (!this.redis) return;
    const keyHash = this.hashKey(key);
    const cooldownKey = `cooldown:${provider}:${keyHash}:${modelName}`;

    let ttl = 30;
    let state = `error_${errorType}`;

    if (["429", "rate_limit"].includes(errorType)) {
      ttl = 65;
      state = "rate_limited";
    } else if (
      ["timeout", "500", "502", "503", "504"].includes(errorType)
    ) {
      ttl = 10;
      state = "timed_out";
    } else if (
      ["401", "403", "auth", "permission_denied"].includes(errorType)
    ) {
      ttl = 604800;
      state = "quarantined";
    }

    // G1: honour an upstream-stated reset delay (Retry-After / quotaResetDelay)
    // instead of the fixed TTL above. Clamped to avoid absurd values.
    if (ttlOverride && ttlOverride > 0) {
      ttl = clamp(ttlOverride, 5, 7200);
    }
    // CRITICAL (Google 15rpm safety): a rate-limited key must NEVER be cooled
    // for less than the 65s window, or the rolling quota never decays and the
    // key is blocked forever. Honour longer upstream resets, never shorter.
    if (["429", "rate_limit"].includes(errorType) && ttlOverride && ttlOverride > 0) {
      ttl = Math.max(clamp(ttlOverride, 5, 7200), 65);
    }

    // Google is strict (15rpm/model, per-key quota pools) and a 5xx often
    // precedes a rate-limit block. Enforce a flat 65s floor on ANY Google
    // error so a key is never re-hit into a block-forever state.
    if (provider === "google" || provider === "nvidia") {
      ttl = Math.max(ttl, 65);
    }

    await this.redis.set(cooldownKey, state, "EX", ttl);
    console.error(
      `[${provider.toUpperCase()}] Placed key ${keyHash} on ${state} cooldown for ${modelName} (TTL ${ttl}s)`,
    );
  }

  // Observability-only: accumulate token usage per provider+model in Redis.
  // Never throws — a metrics write must never fail a live request.
  async recordUsage(
    provider: string,
    key: string,
    modelName: string,
    usage: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    },
  ) {
    if (!this.redis) return;
    const keyHash = this.hashKey(key);
    const hkey = `usage:${provider}:${modelName}`;
    try {
      await this.redis.hincrby(hkey, "prompt_tokens", usage.prompt_tokens || 0);
      await this.redis.hincrby(
        hkey,
        "completion_tokens",
        usage.completion_tokens || 0,
      );
      await this.redis.hincrby(hkey, "total_tokens", usage.total_tokens || 0);
      await this.redis.expire(hkey, 60 * 60 * 24 * 30); // 30d retention
    } catch (e) {
      // observability only — swallow
    }
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
// (estimateTokens, cleanGemmaPayload, cleanLatexSymbols, mergeConsecutiveMessages
//  and transformNonStreaming are imported from ./lib)
// ============================================================================

function createStreamTransformer(collapseReasoning: boolean, meta?: StreamMeta) {
  let buffer = "";
  let hasStartedThought = false;
  let hasEndedThought = false;
  let firstChunk = true;
  let capturedUsage: any = null;
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

            if (firstChunk) {
              firstChunk = false;
              if (meta) sinkUsage(meta, null, Date.now() - meta.requestStart);
            }
            const u = parseUsageFromJson(json);
            if (u) capturedUsage = u;

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
              extractThoughtSignature(json);
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
      if (meta) sinkUsage(meta, capturedUsage);
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
  reqId?: string,
  signal?: AbortSignal,
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
  if (provider === "google") reqJson = translateGoogleThinking(reqJson);
  if (upstream_model.toLowerCase().includes("gemma"))
    reqJson = cleanGemmaPayload(reqJson);
  logState(EMOJI.inbound, `[REQ ${reqId}] model=${modelName} provider=${provider} upstream=${upstream_model} stream=${!!reqJson.stream}`);
  if (reqId) recordTrace(reqId, "downstream", reqJson, { model: modelName, provider });

  const isStream = !!reqJson.stream;
  const requestStart = Date.now();
  const estimatedTokens = estimateTokens(
    JSON.stringify(reqJson.messages),
    reqJson.max_tokens || 2048,
  );
  const numKeys = (API_KEYS[provider as keyof typeof API_KEYS] || []).length;
  const maxAttempts = LITEROUTER_MAX_ATTEMPTS > 0 ? Math.min(numKeys, LITEROUTER_MAX_ATTEMPTS) : numKeys;
  const QUOTA_BACKOFF_MS = [65000, 90000, 120000];
  const TRANSIENT_BACKOFF_MS = [8000, 15000, 30000];
  let backoffLadder = QUOTA_BACKOFF_MS;
  let lastFailureQuota = false;
  let reuseKey: string | null = null;
  let graceTried = false;
  let noResponseAttempts = 0;

  for (let round = 0; round <= backoffLadder.length; round++) {
    let allKeysExhausted = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let activeKey = "";
      let currentRpm = 0;
      try {
        ({key: activeKey, currentRpm} = reuseKey
          ? {key: reuseKey, currentRpm: 0}
          : await router.getAvailableKey(
            provider,
            upstream_model,
            estimatedTokens,
          ));
        reuseKey = null;
        const headers = new Headers({
          Authorization: `Bearer ${activeKey}`,
          "Content-Type": "application/json",
        });

        injectThoughtSignature(reqJson);
        // G1-support: ensure OpenAI-compat upstreams emit a final `usage`
        // chunk so streaming token counts can be extracted (see design doc).
        if (isStream) {
          reqJson.stream_options = {
            ...(reqJson.stream_options || {}),
            include_usage: true,
          };
        }
        const resp = await fetchWithFirstByteTimeout(
          api_url,
          {
            method: "POST",
            headers,
            body: JSON.stringify(reqJson),
          },
          {
            noResponseTimeoutMs: NO_RESPONSE_TIMEOUT_MS,
            totalTimeoutMs: LITEROUTER_HTTP_TIMEOUT_MS,
            clientSignal: signal,
          },
        );

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
          const reset = parseResetDelay(resp.headers, errText);

          // G3: upstream says "retry in <=2s" -> re-hit the SAME key once
          // (after a 2s+ buffer) instead of burning a rotation. NEVER applies
          // to rate-limit (429) — a 429 key MUST rotate so its 15rpm window can
          // decay (see 65s floor in reportError). Distinct from client-abort
          // 499 no-op handled in the catch below.
          if (reset && reset <= 2 && !graceTried && resp.status !== 429) {
            graceTried = true;
            reuseKey = activeKey;
            await new Promise((r) => setTimeout(r, Math.max(reset, 2) * 1000 + 1500));
            continue;
          }

          // 502 transient retry: bad gateway means the proxy/load-balancer
          // layer rejected the request before the model ever saw it. Retry
          // the same key once with no cooldown — rotating keys for a proxy
          // hiccup doesn't help (they all hit the same edge).
          if (resp.status === 502 && !graceTried) {
            graceTried = true;
            reuseKey = activeKey;
            await new Promise((r) => setTimeout(r, 1500));
            continue;
          }

          if (
            errText.includes("cooldown") ||
            errText.includes("exhausted quota")
          ) {
            lastFailureQuota = true;
            await router.reportError(provider, activeKey, "429", upstream_model, reset);
            logState(EMOJI.limit, `[PROVIDER_LIMIT ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} (429) rpm ${currentRpm + 1}/${getModelLimits(modelName, provider).max_rpm}`);
          } else {
            await router.reportError(
              provider,
              activeKey,
              resp.status.toString(),
              upstream_model,
              reset,
            );
            if (resp.status === 429) lastFailureQuota = true;
            logState(EMOJI.limit, `[PROVIDER_LIMIT ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} (${resp.status}) rpm ${currentRpm + 1}/${getModelLimits(modelName, provider).max_rpm}`);
          }
          if (reqId) recordTrace(reqId, "upstream", { status: resp.status, body: errText }, { model: modelName, provider, status: resp.status });
          if (attempt < maxAttempts - 1) {
            await new Promise((r) => setTimeout(r, getProviderDelayMs(provider)));
          }
          continue;
        }

      const outHeaders = cleanHeaders(resp.headers);
      if (servedModelId) outHeaders.set("X-Literouter-Model", servedModelId);
      logState(EMOJI.served, `[${provider.toUpperCase()} ${reqId}] Served ${modelName} (upstream=${upstream_model}, key=${activeKey.substring(0, 6)}...) attempt ${attempt + 1}/${maxAttempts} rpm ${currentRpm + 1}/${getModelLimits(modelName, provider).max_rpm}`);
      if (reqId && isStream) recordTrace(reqId, "upstream", { status: resp.status, body: "(stream)" }, { model: modelName, provider, status: resp.status });

      const streamMeta: StreamMeta = {
        reqId,
        provider,
        modelName,
        upstream_model,
        activeKey,
        servedModelId,
        requestStart,
      };

      if (isStream) {
        return new Response(
          resp.body!.pipeThrough(
            createStreamTransformer(LITEROUTER_COLLAPSE_REASONING, streamMeta),
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
        extractThoughtSignature(data);
        const u = parseUsageFromJson(data);
        if (u) sinkUsage(streamMeta, u);
        if (reqId) recordTrace(reqId, "upstream", { status: resp.status, body: data }, { model: modelName, provider, status: resp.status });
        return new Response(JSON.stringify(data), {
          status: resp.status,
          headers: outHeaders,
        });
      }
    } catch (e: any) {
        // Client disconnected (user hit "Stop" / closed connection): per decision A,
        // this is a no-op. Do NOT penalize the key or trip the circuit breaker
        // on a healthy upstream. (Validated by Envoy/agentgateway Drop/RST_STREAM.)
        if (signal?.aborted) {
          return new Response(null, { status: 499 });
        }
        // No-response ghost (e.g. NVIDIA black-holing the first request): the
        // upstream sent NOTHING — no status, no signal, no backoff. The provider
        // never told us to cool down, so we DON'T penalize the key. Just wait
        // NO_RESPONSE_RETRY_DELAY_MS and rotate to the next key to retry. If we
        // exhaust all keys without a response, the loop falls through to the
        // 300s generic timeout below.
        if (e instanceof NoResponseError) {
          noResponseAttempts++;
          logWarn(EMOJI.amber, `[NO_RESPONSE ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} sent nothing within ${NO_RESPONSE_TIMEOUT_MS}ms, rotating key (no cooldown) [${noResponseAttempts}/${maxAttempts}]`);
          if (reqId) recordTrace(reqId, "upstream", { status: "no-response", body: "upstream sent no bytes" }, { model: modelName, provider, status: 0 });
          // Try each key exactly once. After all keys have ghosted, STOP —
          // fall through to the 300s generic timeout below (no round-loop retry).
          if (noResponseAttempts >= maxAttempts) {
            logState(EMOJI.exhausted, `[NO_RESPONSE ${reqId}] all ${maxAttempts} keys ghosted, stopping (no cooldown)`);
            break;
          }
          await new Promise((r) => setTimeout(r, NO_RESPONSE_RETRY_DELAY_MS));
          continue;
        }
        if (e.message.includes("All keys")) {
          allKeysExhausted = true;
          if (fromFusion) {
            return new Response(JSON.stringify({ error: e.message }), {
              status: 429,
            });
          }
          if (round < backoffLadder.length) {
            // G2: reason-aware backoff — quota exhaustion waits longer than
            // transient (5xx/timeout) failures.
            backoffLadder = lastFailureQuota ? QUOTA_BACKOFF_MS : TRANSIENT_BACKOFF_MS;
            logWarn(EMOJI.rotate, `[${provider.toUpperCase()} ${reqId}] All keys exhausted, backing off ${backoffLadder[round] / 1000}s (round ${round + 1}/${backoffLadder.length})`);
            await new Promise((r) => setTimeout(r, backoffLadder[round]));
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
        if (round === backoffLadder.length)
          return new Response(
            JSON.stringify({ error: "Upstream failed", details: e.message }),
            { status: 502 },
          );
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, getProviderDelayMs(provider)));
        }
      }
    }
    if (fromFusion) {
      return new Response(JSON.stringify({ error: "Max attempts exhausted" }), { status: 429 });
    }
    if (!allKeysExhausted) {
      break;
    }
  }
  logState(EMOJI.exhausted, `[SYSTEM_LIMIT ${reqId}] Max attempts (${LITEROUTER_MAX_ATTEMPTS}) reached for ${modelName}, all keys exhausted.`);
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
  reqId?: string,
  signal?: AbortSignal,
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
  logState(EMOJI.inbound, `[REQ-NATIVE ${reqId}] model=${modelName} action=${action} provider=google upstream=${upstream_model}`);
  if (reqId) recordTrace(reqId, "downstream", reqJson, { model: modelName, provider: "google" });

  const estimatedTokens = estimateTokens(JSON.stringify(reqJson), 1024);
  const numKeys = API_KEYS.google.length;
  const maxAttempts = LITEROUTER_MAX_ATTEMPTS > 0 ? Math.min(numKeys, LITEROUTER_MAX_ATTEMPTS) : numKeys;
  const requestStart = Date.now();
  const QUOTA_BACKOFF_MS = [65000, 90000, 120000];
  const TRANSIENT_BACKOFF_MS = [8000, 15000, 30000];
  let backoffLadder = QUOTA_BACKOFF_MS;
  let lastFailureQuota = false;
  let reuseKey: string | null = null;
  let graceTried = false;

  for (let round = 0; round <= backoffLadder.length; round++) {
    let allKeysExhausted = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      let activeKey = "";
      let currentRpm = 0;
      try {
        ({key: activeKey, currentRpm} = reuseKey
          ? {key: reuseKey, currentRpm: 0}
          : await router.getAvailableKey(
            "google",
            upstream_model,
            estimatedTokens,
          ));
        reuseKey = null;

        const url = new URL(
          `https://generativelanguage.googleapis.com/v1beta/models/${upstream_model}:${action}`,
        );
        queryParams.forEach((v, k) => url.searchParams.append(k, v));
        url.searchParams.set("key", activeKey);

        const headers = cleanHeaders(reqHeaders);
        headers.delete("authorization");

        console.log(`[GOOGLE-UPSTREAM] url=${url.toString().replace(activeKey, "REDACTED")}`);
        const resp = await fetch(url.toString(), {
          method: "POST",
          headers,
          body: Object.keys(reqJson).length ? JSON.stringify(reqJson) : undefined,
          signal: upstreamSignal(signal),
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
          const reset = parseResetDelay(resp.headers, errText);

          // G3: upstream says "retry in <=2s" -> re-hit the SAME key once
          // (after a 2s+ buffer). NEVER applies to rate-limit (429) — a 429
          // key MUST rotate so its 15rpm window can decay.
          if (reset && reset <= 2 && !graceTried && resp.status !== 429) {
            graceTried = true;
            reuseKey = activeKey;
            await new Promise((r) => setTimeout(r, Math.max(reset, 2) * 1000 + 1500));
            continue;
          }

          if (
            errText.includes("cooldown") ||
            errText.includes("exhausted quota")
          ) {
            lastFailureQuota = true;
            await router.reportError("google", activeKey, "429", upstream_model, reset);
            logState(EMOJI.limit, `[PROVIDER_LIMIT ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} (429) rpm ${currentRpm + 1}/${getModelLimits(modelName, "google").max_rpm}`);
          } else {
            await router.reportError(
              "google",
              activeKey,
              resp.status.toString(),
              upstream_model,
              reset,
            );
            if (resp.status === 429) lastFailureQuota = true;
            logState(EMOJI.limit, `[PROVIDER_LIMIT ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} (${resp.status}) rpm ${currentRpm + 1}/${getModelLimits(modelName, "google").max_rpm}`);
          }
          if (reqId) recordTrace(reqId, "upstream", { status: resp.status, body: errText }, { model: modelName, provider: "google", status: resp.status });
          if (attempt < maxAttempts - 1) {
            await new Promise((r) => setTimeout(r, getProviderDelayMs("google")));
          }
          continue;
        }

        const outHeaders = cleanHeaders(resp.headers);
      if (servedModelId) outHeaders.set("X-Literouter-Model", servedModelId);
      logState(EMOJI.served, `[GOOGLE ${reqId}] Served native ${modelName}:${action} (upstream=${upstream_model}, attempt ${attempt + 1}/${maxAttempts}, rpm ${currentRpm + 1}/${getModelLimits(modelName, "google").max_rpm})`);
      if (reqId) recordTrace(reqId, "upstream", { status: resp.status, body: "(stream)" }, { model: modelName, provider: "google", status: resp.status });

      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      const streamMeta: StreamMeta = {
        reqId,
        provider: "google",
        modelName,
        upstream_model,
        activeKey,
        servedModelId,
        requestStart,
      };
      let firstChunk = true;
      let capturedUsage: any = null;
      const transform = new TransformStream({
        transform(chunk, controller) {
          let text = decoder.decode(chunk, { stream: true });
          text = cleanLatexSymbols(text);

          if (firstChunk) {
            firstChunk = false;
            sinkUsage(streamMeta, null, Date.now() - requestStart);
          }
          // Capture token usage from Google-native SSE (`data: ` lines) or a
          // raw JSON body (non-streaming generateContent).
          const candidates = text.includes("data: ")
            ? text.split("\n").filter((l) => l.trim().startsWith("data: ")).map((l) => l.trim().substring(6).trim())
            : [text.trim()];
          for (const c of candidates) {
            if (!c || c === "[DONE]") continue;
            try {
              const j = JSON.parse(c);
              const u = parseUsageFromJson(j);
              if (u) capturedUsage = u;
            } catch {}
          }

          controller.enqueue(encoder.encode(text));
        },
        flush(controller) {
          sinkUsage(streamMeta, capturedUsage);
        },
      });

      return new Response(resp.body!.pipeThrough(transform), {
        status: resp.status,
        headers: outHeaders,
      });
    } catch (e: any) {
        // Client disconnected (user hit "Stop" / closed connection): per decision A,
        // this is a no-op. Do NOT penalize the key or trip the circuit breaker
        // on a healthy upstream. (Validated by Envoy/agentgateway Drop/RST_STREAM.)
        if (signal?.aborted) {
          return new Response(null, { status: 499 });
        }
        if (e.message.includes("All keys")) {
          allKeysExhausted = true;
          if (fromFusion) {
            return new Response(JSON.stringify({ error: e.message }), {
              status: 429,
            });
          }
          if (round < backoffLadder.length) {
            // G2: reason-aware backoff — quota exhaustion waits longer than
            // transient (5xx/timeout) failures.
            backoffLadder = lastFailureQuota ? QUOTA_BACKOFF_MS : TRANSIENT_BACKOFF_MS;
            logWarn(EMOJI.rotate, `[GOOGLE ${reqId}] All keys exhausted, backing off ${backoffLadder[round] / 1000}s (round ${round + 1}/${backoffLadder.length})`);
            await new Promise((r) => setTimeout(r, backoffLadder[round]));
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
        if (round === backoffLadder.length)
          return new Response(
            JSON.stringify({ error: "Upstream failed", details: e.message }),
            { status: 502 },
          );
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, getProviderDelayMs("google")));
        }
      }
    }
    if (fromFusion) {
      return new Response(JSON.stringify({ error: "Max attempts exhausted" }), { status: 429 });
    }
    if (!allKeysExhausted) {
      break;
    }
  }
  logState(EMOJI.exhausted, `[SYSTEM_LIMIT ${reqId}] Max attempts (${LITEROUTER_MAX_ATTEMPTS}) reached for ${modelName}, all keys exhausted.`);
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
  reqId?: string,
  signal?: AbortSignal,
): Promise<Response> {
  const isNativeUpstream = isNativeRoute || (group.upstream?.includes("/v1beta") ?? false);
  const chain: string[] = group.chain;
  const startIdx = getStickyStart(groupId, chain);
  logState(EMOJI.fusion, `[FUSION ${reqId}] group=${groupId} chain=${chain.join("->")} start=${chain[startIdx]}`);

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
        reqId,
        signal,
      );
    } else {
      resp = await executeOpenAICompat(
        upstreamId,
        reqJson,
        headers,
        upstreamId,
        true,
        reqId,
        signal,
      );
    }

    if (resp.status === 429 || resp.status >= 500) {
      openCircuit(upstreamId);
      logWarn(EMOJI.rotate, `[FUSION ${reqId}] ${groupId} -> ${upstreamId} failed (${resp.status}), advancing chain.`);
      continue;
    }

    if (resp.status >= 400 && resp.status < 500) {
      logWarn(EMOJI.limit, `[FUSION ${reqId}] ${groupId} -> ${upstreamId} halted on client error (${resp.status}).`);
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

async function executeGoogleInteractions(
  reqJson: any,
  reqHeaders: Headers,
  reqId?: string,
  signal?: AbortSignal,
): Promise<Response> {
  const agentName = reqJson.agent || reqJson.model || "antigravity-preview-05-2026";
  const upstream_model = "antigravity-preview-05-2026";
  const modelName = "google/antigravity-preview-05-2026";

  logState(EMOJI.inbound, `[REQ-INTERACTIONS ${reqId}] agent=${agentName} provider=google`);
  if (reqId) recordTrace(reqId, "downstream", reqJson, { model: modelName, provider: "google" });

  const estimatedTokens = estimateTokens(JSON.stringify(reqJson), 4096);
  const numKeys = API_KEYS.google.length;
  const maxAttempts = LITEROUTER_MAX_ATTEMPTS > 0 ? Math.min(numKeys, LITEROUTER_MAX_ATTEMPTS) : numKeys;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { key: activeKey, currentRpm } = await router.getAvailableKey(
        "google",
        upstream_model,
        estimatedTokens,
      );

      const url = "https://generativelanguage.googleapis.com/v1beta/interactions";
      const headers = cleanHeaders(reqHeaders);
      headers.set("x-goog-api-key", activeKey);
      headers.set("Content-Type", "application/json");
      headers.delete("authorization");

      console.log(`[GOOGLE-INTERACTIONS] url=${url} key=${activeKey.substring(0, 6)}...`);
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(reqJson),
        signal: upstreamSignal(signal),
      });

      if (resp.status >= 400) {
        const errText = await resp.text();
        await router.reportError("google", activeKey, resp.status.toString(), upstream_model);
        logState(EMOJI.limit, `[PROVIDER_LIMIT ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} (${resp.status})`);
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, getProviderDelayMs("google")));
          continue;
        }
        return new Response(errText, { status: resp.status, headers: cleanHeaders(resp.headers) });
      }

      const outHeaders = cleanHeaders(resp.headers);
      outHeaders.set("X-Literouter-Model", modelName);
      logState(EMOJI.served, `[GOOGLE ${reqId}] Served interactions agent=${agentName} (attempt ${attempt + 1}/${maxAttempts})`);

      const respText = await resp.text();
      return new Response(respText, { status: resp.status, headers: outHeaders });
    } catch (e: any) {
      if (e?.name === "AbortError" || signal?.aborted) {
        return new Response("Client Aborted", { status: 499 });
      }
      logWarn(EMOJI.limit, `[INTERACTIONS-ERROR ${reqId}] attempt=${attempt + 1}: ${e?.message || e}`);
    }
  }

  return new Response(JSON.stringify({ error: "All Google API keys exhausted for interactions" }), { status: 502 });
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
    const reqId = crypto.randomUUID();
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
          reqId,
          req.signal,
        );
      }
      return executeOpenAICompat(modelName, reqJson, req.headers, undefined, false, reqId, req.signal);
    }

    if (url.pathname === "/v1beta/interactions" || url.pathname === "/v1/interactions") {
      return executeGoogleInteractions(reqJson, req.headers, reqId, req.signal);
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
          reqId,
          req.signal,
        );
      }
      return executeGoogleNative(
        modelName,
        action,
        url.searchParams,
        reqJson,
        req.headers,
        undefined,
        false,
        reqId,
        req.signal,
      );
    }

    if (url.pathname === "/health") {
      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }

    return new Response("Not found", { status: 404 });
  },
});

logState(EMOJI.boot, `LiteRouter (Bun) running on port ${LITEROUTER_PORT}`);
