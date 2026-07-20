// Pure, side-effect-free gateway helpers.
// Extracted from src/index.ts so they can be unit-tested with `bun test`
// without importing the server bootstrap (serve / router.connect).

export const MODEL_LIMITS: Record<string, any> = {
  "google/gemini-3.1-flash-lite": {
    max_tpm: 250000,
    max_rpm: 15,
    context_window: 250000,
  },
  "google/gemma": { max_tpm: 100000000, max_rpm: 15, context_window: 250000 },
};

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

export function estimateTokens(promptText: string, maxTokens: number = 2048): number {
  return Math.floor(promptText.length / 4) + maxTokens;
}

const GEMMA_UNSUPPORTED = new Set([
  "presence_penalty",
  "frequency_penalty",
  "logit_bias",
  "user",
  "seed",
  "logprobs",
  "top_logprobs",
]);

export function cleanGemmaPayload(data: any): any {
  if (Array.isArray(data)) return data.map(cleanGemmaPayload);
  if (data !== null && typeof data === "object") {
    const cleaned: any = {};
    for (const [k, v] of Object.entries(data)) {
      if (!GEMMA_UNSUPPORTED.has(k)) {
        cleaned[k] = cleanGemmaPayload(v);
      }
    }
    return cleaned;
  }
  return data;
}

// Google's /v1beta/openai/chat/completions accepts `reasoning_effort`
// (gemini-flash family) but REJECTS the native-genai `google` block,
// `thinkingConfig`, `thinking`, and `thinkingBudget`. It also rejects ANY
// thinking control for gemma models ("Thinking level is not supported").
// Translate the client's extra_body={"google": {"thinking_config": {...}}}
// into the accepted form: gemini -> reasoning_effort; gemma -> dropped
// (runs at Google default, which already thinks).
const THINKING_TO_REASONING: Record<string, string> = {
  none: "none",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

export function translateGoogleThinking(data: any): any {
  if (!data || typeof data !== "object") return data;
  let level: string | undefined;
  if (data.google?.thinking_config) {
    level = data.google.thinking_config.thinking_level;
  } else if (data.thinkingConfig?.thinkingLevel) {
    level = data.thinkingConfig.thinkingLevel;
  } else if (data.reasoning_effort) {
    level = data.reasoning_effort;
  } else if (typeof data.thinking === "object" && data.thinking?.type === "enabled") {
    level = "minimal";
  }
  const isGemma = String(data.model || "").toLowerCase().includes("gemma");
  // LiteRouter sets minimal thinking by default for models that support it,
  // so clients don't need to send any thinking config at all.
  if (!isGemma && !data.reasoning_effort) {
    data.reasoning_effort = level ? THINKING_TO_REASONING[level] || "low" : "low";
  }
  // Every native/thinking key is rejected on the OpenAI-compat path.
  delete data.google;
  delete data.thinkingConfig;
  delete data.thinking_config;
  delete data.thinking;
  delete data.thinkingBudget;
  return data;
}

export function cleanLatexSymbols(text: string): string {
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

export function mergeConsecutiveMessages(messages: any[]): any[] {
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

export function transformNonStreaming(data: any, collapseReasoning: boolean): any {
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

// Thrown when the upstream returns absolutely nothing (no status, no headers,
// no body) within NO_RESPONSE_TIMEOUT_MS. Carries no cooldown signal because
// the provider never told us to back off — it just ghosted.
export class NoResponseError extends Error {
  constructor(msg = "upstream sent no response") {
    super(msg);
    this.name = "NoResponseError";
  }
}

// First-byte timeout layered on top of the total timeout. If the upstream opens
// the connection but sends nothing within `noResponseTimeoutMs`, we abort and
// throw NoResponseError so the caller rotates keys instead of hanging for the
// full `totalTimeoutMs`. `clientSignal` (optional) cancels on user disconnect.
export async function fetchWithFirstByteTimeout(
  url: string,
  init: RequestInit,
  opts: {
    noResponseTimeoutMs: number;
    totalTimeoutMs: number;
    clientSignal?: AbortSignal;
  },
): Promise<Response> {
  const { noResponseTimeoutMs, totalTimeoutMs, clientSignal } = opts;
  const ctrl = new AbortController();
  const totalSignal = clientSignal
    ? AbortSignal.any([clientSignal, AbortSignal.timeout(totalTimeoutMs)])
    : AbortSignal.timeout(totalTimeoutMs);
  totalSignal.addEventListener("abort", () => ctrl.abort());
  if (clientSignal) clientSignal.addEventListener("abort", () => ctrl.abort());

  const firstByte = setTimeout(() => ctrl.abort(), noResponseTimeoutMs);

  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(firstByte);
    return resp;
  } catch (e: any) {
    clearTimeout(firstByte);
    if (ctrl.signal.aborted && !totalSignal.aborted && !(clientSignal?.aborted)) {
      throw new NoResponseError();
    }
    throw e;
  }
}
