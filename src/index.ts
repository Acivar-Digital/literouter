import { serve } from "bun";
import Redis from "ioredis";
import * as fs from "fs";
import * as path from "path";
import {
  LITEROUTER_AUTH_KEY,
  LITEROUTER_HTTP_TIMEOUT_MS,
  LITEROUTER_PORT,
  LITEROUTER_ROTATE_DELAY_MS,
  MIN_ROTATE_DELAY_MS,
  PROVIDER_API_URLS,
  REDIS_DB,
  REDIS_HOST,
  REDIS_PASSWORD,
  REDIS_PORT,
  clamp,
  getModelLimits,
  staticValidateKeys,
} from "./config/env";
import { StreamMeta } from "./transformers/payload";
import { executeOpenAICompat } from "./handlers/openai_compat";
import {
  executeGoogleInteractions,
  executeGoogleNative,
} from "./handlers/google_native";

// ============================================================================
// 0. Emoji State Logging & Trace Archive
// ============================================================================

const ROOT_DIR = import.meta.dir
  ? path.resolve(import.meta.dir, "..")
  : process.cwd();

function logTimestamp(): string {
  const d = new Date();
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  return `${p(d.getMonth() + 1, 2)}-${p(d.getDate(), 2)}-${p(d.getHours(), 2)}:${p(d.getMinutes(), 2)}:${p(d.getSeconds(), 2)}:${p(d.getMilliseconds(), 3)}`;
}

export function logState(emoji: string, msg: string): void {
  console.log(`${emoji} [${logTimestamp()}] ${msg}`);
}
export function logWarn(emoji: string, msg: string): void {
  console.warn(`${emoji} [${logTimestamp()}] ${msg}`);
}
export function logError(emoji: string, msg: string): void {
  console.error(`${emoji} [${logTimestamp()}] ${msg}`);
}

export const EMOJI = {
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

export function recordTrace(
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
      logError(EMOJI.error, `Trace write failed for ${reqId}/${part}: ${e}`);
    }
  })();
}

export function sinkUsage(meta: StreamMeta, usage: any, ttftMs?: number) {
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

// ============================================================================
// 1. API Keys & Registry Loading
// ============================================================================

export const API_KEYS = {
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

export const MODEL_REGISTRY = new Map<string, ModelMeta>();
export const FUSION_GROUPS = new Map<
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
// 2. Redis Router (ZSET + Lua Quota & Cooldowns)
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

export class ModelFirstRouter {
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
      await this.redis!.flushall();
      this.scriptSha = await this.redis!.script("LOAD", QUOTA_CHECK_SCRIPT);
      console.log("Connected to Redis/Valkey. Flushed state & loaded Lua script.");
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
    const envOverride = Bun.env[`${provider.toUpperCase()}_MIN_DELAY_MS`] as
      | string
      | undefined;
    return Math.max(
      envOverride ? parseInt(envOverride, 10) : LITEROUTER_ROTATE_DELAY_MS,
      MIN_ROTATE_DELAY_MS,
    );
  }

  async getAvailableKey(
    provider: string,
    modelName: string,
    estimatedTokens: number,
  ): Promise<{ key: string; currentRpm: number }> {
    const keys = API_KEYS[provider as keyof typeof API_KEYS] || [];
    if (!keys.length) {
      throw new Error(`No keys configured for provider: ${provider}`);
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
      return { key, currentRpm: res[1] };
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
        return { key, currentRpm: res[1] };
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

    if (ttlOverride && ttlOverride > 0) {
      ttl = clamp(ttlOverride, 5, 7200);
    }

    if (
      ["429", "rate_limit"].includes(errorType) &&
      ttlOverride &&
      ttlOverride > 0
    ) {
      ttl = Math.max(clamp(ttlOverride, 5, 7200), 65);
    }

    if (provider === "google" || provider === "nvidia") {
      ttl = Math.max(ttl, 65);
    }

    await this.redis.set(cooldownKey, state, "EX", ttl);
    console.error(
      `[${provider.toUpperCase()}] Placed key ${keyHash} on ${state} cooldown for ${modelName} (TTL ${ttl}s)`,
    );
  }

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
    const hkey = `usage:${provider}:${modelName}`;
    try {
      await this.redis.hincrby(hkey, "prompt_tokens", usage.prompt_tokens || 0);
      await this.redis.hincrby(
        hkey,
        "completion_tokens",
        usage.completion_tokens || 0,
      );
      await this.redis.hincrby(hkey, "total_tokens", usage.total_tokens || 0);
      await this.redis.expire(hkey, 60 * 60 * 24 * 30);
    } catch (e) {
      // observability only
    }
  }
}

export const router = new ModelFirstRouter();
router.connect();

// ============================================================================
// 3. Fusion State (In-Memory Circuit Breaker & Sticky Fallback)
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
  const isNativeUpstream =
    isNativeRoute || (group.upstream?.includes("/v1beta") ?? false);
  const chain: string[] = group.chain;
  const startIdx = getStickyStart(groupId, chain);
  logState(
    EMOJI.fusion,
    `[FUSION ${reqId}] group=${groupId} chain=${chain.join("->")} start=${chain[startIdx]}`,
  );

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
      logWarn(
        EMOJI.rotate,
        `[FUSION ${reqId}] ${groupId} -> ${upstreamId} failed (${resp.status}), advancing chain.`,
      );
      continue;
    }

    if (resp.status >= 400 && resp.status < 500) {
      logWarn(
        EMOJI.limit,
        `[FUSION ${reqId}] ${groupId} -> ${upstreamId} halted on client error (${resp.status}).`,
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

// ============================================================================
// 4. Server Entry Point
// ============================================================================

if (import.meta.main) {
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
      let reqJson: any = {};
      if (bodyText) {
        try {
          reqJson = JSON.parse(bodyText);
        } catch (e) {}
      }

      if (url.pathname === "/v1/chat/completions") {
        const modelName = reqJson.model;
        if (!modelName) {
          return new Response(
            JSON.stringify({ error: "Missing 'model' in request" }),
            { status: 400 },
          );
        }

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
        return executeOpenAICompat(
          modelName,
          reqJson,
          req.headers,
          undefined,
          false,
          reqId,
          req.signal,
        );
      }

      if (
        url.pathname === "/v1beta/interactions" ||
        url.pathname === "/v1/interactions"
      ) {
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
}
