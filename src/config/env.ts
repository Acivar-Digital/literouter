export const MODEL_LIMITS: Record<string, any> = {};

export const PROVIDER_LIMITS: Record<string, any> = {
  nvidia: { max_tpm: 1000000, max_rpm: 40, context_window: 1000000 },
  openrouter: { max_tpm: 1000000, max_rpm: 20, context_window: 1000000 },
};

export const DEFAULT_LIMITS = {
  max_tpm: 1000000,
  max_rpm: 15,
  context_window: 1000000,
};

export function getModelLimits(modelName: string, provider?: string) {
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

export function staticValidateKeys(provider: string, keysStr: string): string[] {
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

export const LITEROUTER_PORT = parseInt(
  Bun.env.LITEROUTER_PORT || "7766",
  10,
);
export const LITEROUTER_AUTH_KEY = Bun.env.LITEROUTER_AUTH_KEY || "";
export const LITEROUTER_COLLAPSE_REASONING =
  (Bun.env.LITEROUTER_COLLAPSE_REASONING || "false").toLowerCase() === "true";
export const LITEROUTER_ROTATE_DELAY_MS = parseInt(
  Bun.env.LITEROUTER_ROTATE_DELAY_MS || "10000",
  10,
);
export const LITEROUTER_MAX_ATTEMPTS = parseInt(
  Bun.env.LITEROUTER_MAX_ATTEMPTS || "3",
  10,
);
export const LITEROUTER_HTTP_TIMEOUT_MS =
  parseInt(Bun.env.LITEROUTER_HTTP_TIMEOUT || "300", 10) * 1000;

export const LITEROUTER_NO_RESPONSE_TIMEOUT_MS =
  parseInt(Bun.env.LITEROUTER_NO_RESPONSE_TIMEOUT || "5", 10) * 1000;
export const LITEROUTER_STREAM_IDLE_TIMEOUT_MS =
  parseInt(
    Bun.env.LITEROUTER_STREAM_IDLE_TIMEOUT ||
      Bun.env.LITEROUTER_STREAM_IDLE_TIMEOUT_MS ||
      "30",
    10,
  ) * 1000;
export const LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS =
  parseInt(
    Bun.env.LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS ||
      Bun.env.LITEROUTER_NO_RESPONSE_RETRY_DELAY ||
      "1000",
    10,
  );

export const MIN_ROTATE_DELAY_MS = 2000;

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

export function logWarn(emoji: string, msg: string): void {
  const d = new Date();
  const p = (n: number, w: number) => String(n).padStart(w, "0");
  const ts = `${p(d.getMonth() + 1, 2)}-${p(d.getDate(), 2)}-${p(d.getHours(), 2)}:${p(d.getMinutes(), 2)}:${p(d.getSeconds(), 2)}:${p(d.getMilliseconds(), 3)}`;
  console.warn(`${emoji} [${ts}] ${msg}`);
}

export function getProviderDelayMs(provider: string): number {
  const envKey = `${provider.toUpperCase()}_MIN_DELAY_MS`;
  const val = Bun.env[envKey] as string | undefined;
  return Math.max(
    val ? parseInt(val, 10) : LITEROUTER_ROTATE_DELAY_MS,
    MIN_ROTATE_DELAY_MS,
  );
}

export function upstreamSignal(clientSignal?: AbortSignal): AbortSignal {
  if (!clientSignal) return AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS);
  return AbortSignal.any([
    clientSignal,
    AbortSignal.timeout(LITEROUTER_HTTP_TIMEOUT_MS),
  ]);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function parseResetDelay(headers: Headers, errText: string): number | null {
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

export function parseUsageFromJson(json: any): {
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

export function cleanHeaders(headers: Headers): Headers {
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

export const REDIS_HOST = Bun.env.REDIS_HOST || "127.0.0.1";
export const REDIS_PORT = parseInt(Bun.env.REDIS_PORT || "6379", 10);
export const REDIS_PASSWORD = Bun.env.REDIS_PASSWORD || undefined;
export const REDIS_DB = parseInt(Bun.env.REDIS_DB || "0", 10);

export const ZEN_BASE_URL = Bun.env.ZEN_BASE_URL || "https://opencode.ai/zen/v1";

export const PROVIDER_API_URLS: Record<string, string> = {
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
