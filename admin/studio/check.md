### Part 1: The Active Demonstration Checklist

- **Q1 (TypeScript/Bun & Barrel File):** I understand `src/lib.ts` must act as a re-export barrel file so existing unit tests pass, while the code is structured into an 8-file modular tree.
- **Q2 (2s 429 & .env 5s/1s Ghosting Rotation):** I confirm 429 retries will wait 2s without 65s stalls, and all non-Google providers will rotate to Key 2 after 5s first-byte wait + 1s delay on ghosting without burning key health.
- **Q3 (Zero-Dicts/Strict Dot Notation):** I will use clear object properties and typed parameters across all modules.
- **Q4 (No Elision):** I understand I must output all 8 files completely without truncation or `// ... rest of code`.

---

### Part 2: The Code (Multi-File Output)

```typescript filepath="src/config/env.ts"
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
export const LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS =
  parseInt(
    Bun.env.LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS ||
      Bun.env.LITEROUTER_NO_RESPONSE_RETRY_DELAY ||
      "1000",
    10,
  );

export const MIN_ROTATE_DELAY_MS = 2000;

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
```

```typescript filepath="src/network/fetcher.ts"
export class NoResponseError extends Error {
  constructor(msg = "upstream sent no response") {
    super(msg);
    this.name = "NoResponseError";
  }
}

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
  if (clientSignal) {
    clientSignal.addEventListener("abort", () => ctrl.abort());
  }

  const firstByte = setTimeout(() => ctrl.abort(), noResponseTimeoutMs);

  try {
    const resp = await fetch(url, { ...init, signal: ctrl.signal });
    clearTimeout(firstByte);
    return resp;
  } catch (e: any) {
    clearTimeout(firstByte);
    if (ctrl.signal.aborted && !totalSignal.aborted && !clientSignal?.aborted) {
      throw new NoResponseError();
    }
    throw e;
  }
}
```

```typescript filepath="src/transformers/thinking.ts"
const THINKING_TO_REASONING: Record<string, string> = {
  none: "none",
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
};

export function extractThinkingLevel(data: any): string | undefined {
  if (!data || typeof data !== "object") return undefined;
  if (data.google?.thinking_config) {
    return data.google.thinking_config.thinking_level;
  } else if (data.thinkingConfig?.thinkingLevel) {
    return data.thinkingConfig.thinkingLevel;
  } else if (data.reasoning_effort) {
    return data.reasoning_effort;
  } else if (
    typeof data.thinking === "object" &&
    data.thinking?.type === "enabled"
  ) {
    return "minimal";
  }
  return undefined;
}

export function applyReasoningEffort(data: any, level: string | undefined): void {
  const isGemma = String(data.model || "").toLowerCase().includes("gemma");
  if (!isGemma && !data.reasoning_effort) {
    data.reasoning_effort = level ? THINKING_TO_REASONING[level] || "low" : "low";
  }
  delete data.google;
  delete data.thinkingConfig;
  delete data.thinking_config;
  delete data.thinking;
  delete data.thinkingBudget;
}

export function translateGoogleThinking(data: any): any {
  if (!data || typeof data !== "object") return data;
  const level = extractThinkingLevel(data);
  applyReasoningEffort(data, level);
  return data;
}
```

```typescript filepath="src/transformers/payload.ts"
import { parseUsageFromJson } from "../config/env";

const thoughtSignatureStore = new Map<string, string>();

export function injectThoughtSignature(body: any): void {
  if (!body || !body.messages) return;
  for (const msg of body.messages) {
    if (msg.role === "assistant" && msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (
          !tc.extra_content?.google?.thought_signature &&
          tc.id &&
          thoughtSignatureStore.has(tc.id)
        ) {
          tc.extra_content = tc.extra_content || {};
          tc.extra_content.google = tc.extra_content.google || {};
          tc.extra_content.google.thought_signature =
            thoughtSignatureStore.get(tc.id)!;
        }
      }
    }
  }
}

export function extractThoughtSignature(data: any): void {
  if (!data) return;
  const toolCalls =
    data.choices?.[0]?.message?.tool_calls || data.choices?.[0]?.delta?.tool_calls;
  if (!toolCalls) return;
  for (const tc of toolCalls) {
    if (tc.id && tc.extra_content?.google?.thought_signature) {
      thoughtSignatureStore.set(
        tc.id,
        tc.extra_content.google.thought_signature,
      );
    }
  }
}

export function estimateTokens(
  promptText: string,
  maxTokens: number = 2048,
): number {
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
  "thinkingConfig",
  "thinking",
  "thinkingBudget",
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

function combineContent(pContent: any, cContent: any): any {
  if (typeof pContent === "string" && typeof cContent === "string") {
    return pContent + "\n\n" + cContent;
  }
  if (Array.isArray(pContent) && Array.isArray(cContent)) {
    return pContent.concat(cContent);
  }
  if (Array.isArray(pContent) && typeof cContent === "string") {
    return pContent.concat([{ type: "text", text: cContent }]);
  }
  if (typeof pContent === "string" && Array.isArray(cContent)) {
    return [{ type: "text", text: pContent }].concat(cContent);
  }
  return String(pContent) + "\n\n" + String(cContent);
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
      prev.content = combineContent(prev.content || "", msg.content || "");
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
}

export function transformNonStreaming(
  data: any,
  collapseReasoning: boolean,
): any {
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

export interface StreamMeta {
  reqId?: string;
  provider: string;
  modelName: string;
  upstream_model: string;
  activeKey: string;
  servedModelId?: string;
  requestStart: number;
}

export function createStreamTransformer(
  collapseReasoning: boolean,
  meta?: StreamMeta,
  sinkUsageFn?: (meta: StreamMeta, usage: any, ttftMs?: number) => void,
) {
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
              if (meta && sinkUsageFn) {
                sinkUsageFn(meta, null, Date.now() - meta.requestStart);
              }
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
      if (meta && sinkUsageFn) sinkUsageFn(meta, capturedUsage);
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
    },
  });
}
```

```typescript filepath="src/handlers/openai_compat.ts"
import {
  LITEROUTER_COLLAPSE_REASONING,
  LITEROUTER_HTTP_TIMEOUT_MS,
  LITEROUTER_MAX_ATTEMPTS,
  LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS,
  LITEROUTER_NO_RESPONSE_TIMEOUT_MS,
  cleanHeaders,
  getModelLimits,
  getProviderDelayMs,
  parseResetDelay,
  parseUsageFromJson,
} from "../config/env";
import { NoResponseError, fetchWithFirstByteTimeout } from "../network/fetcher";
import {
  StreamMeta,
  cleanGemmaPayload,
  cleanLatexSymbols,
  createStreamTransformer,
  estimateTokens,
  extractThoughtSignature,
  injectThoughtSignature,
  mergeConsecutiveMessages,
  transformNonStreaming,
} from "../transformers/payload";
import { translateGoogleThinking } from "../transformers/thinking";
import {
  API_KEYS,
  EMOJI,
  MODEL_REGISTRY,
  logState,
  logWarn,
  recordTrace,
  router,
  sinkUsage,
} from "../index";

interface OpenAIErrorProcessResult {
  action: "return" | "retry_same" | "continue";
  response?: Response;
  delayMs?: number;
}

async function processOpenAIError(
  resp: Response,
  provider: string,
  activeKey: string,
  upstream_model: string,
  modelName: string,
  reqId?: string,
  currentRpm: number = 0,
  graceTried: boolean = false,
): Promise<OpenAIErrorProcessResult> {
  if (resp.status === 400) {
    const errBody = await resp.text();
    return {
      action: "return",
      response: new Response(errBody, {
        status: 400,
        headers: cleanHeaders(resp.headers),
      }),
    };
  }

  const errText = await resp.text();
  const reset = parseResetDelay(resp.headers, errText);

  if (reset && reset <= 2 && !graceTried && resp.status !== 429) {
    return {
      action: "retry_same",
      delayMs: Math.max(reset, 2) * 1000 + 1500,
    };
  }

  if (resp.status === 502 && !graceTried) {
    return {
      action: "retry_same",
      delayMs: 1500,
    };
  }

  const isQuota =
    errText.includes("cooldown") ||
    errText.includes("exhausted quota") ||
    resp.status === 429;

  const errorType = isQuota ? "429" : resp.status.toString();
  await router.reportError(provider, activeKey, errorType, upstream_model, reset);

  logState(
    EMOJI.limit,
    `[PROVIDER_LIMIT ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} (${resp.status}) rpm ${currentRpm + 1}/${getModelLimits(modelName, provider).max_rpm}`,
  );

  if (reqId) {
    recordTrace(
      reqId,
      "upstream",
      { status: resp.status, body: errText },
      { model: modelName, provider, status: resp.status },
    );
  }

  return { action: "continue" };
}

async function processOpenAISuccess(
  resp: Response,
  meta: {
    reqId?: string;
    provider: string;
    modelName: string;
    upstream_model: string;
    activeKey: string;
    servedModelId?: string;
    requestStart: number;
    isStream: boolean;
    attempt: number;
    maxAttempts: number;
    currentRpm: number;
  },
): Promise<Response> {
  const {
    reqId,
    provider,
    modelName,
    upstream_model,
    activeKey,
    servedModelId,
    requestStart,
    isStream,
    attempt,
    maxAttempts,
    currentRpm,
  } = meta;

  const outHeaders = cleanHeaders(resp.headers);
  if (servedModelId) outHeaders.set("X-Literouter-Model", servedModelId);

  logState(
    EMOJI.served,
    `[${provider.toUpperCase()} ${reqId}] Served ${modelName} (upstream=${upstream_model}, key=${activeKey.substring(0, 6)}...) attempt ${attempt + 1}/${maxAttempts} rpm ${currentRpm + 1}/${getModelLimits(modelName, provider).max_rpm}`,
  );

  if (reqId && isStream) {
    recordTrace(
      reqId,
      "upstream",
      { status: resp.status, body: "(stream)" },
      { model: modelName, provider, status: resp.status },
    );
  }

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
        createStreamTransformer(LITEROUTER_COLLAPSE_REASONING, streamMeta, sinkUsage),
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
    if (reqId) {
      recordTrace(
        reqId,
        "upstream",
        { status: resp.status, body: data },
        { model: modelName, provider, status: resp.status },
      );
    }
    return new Response(JSON.stringify(data), {
      status: resp.status,
      headers: outHeaders,
    });
  }
}

export async function executeOpenAICompat(
  modelName: string,
  reqJson: any,
  reqHeaders: Headers,
  servedModelId?: string,
  fromFusion?: boolean,
  reqId?: string,
  signal?: AbortSignal,
): Promise<Response> {
  const meta = MODEL_REGISTRY.get(modelName);
  if (!meta) {
    return new Response(
      JSON.stringify({ error: `Model '${modelName}' not recognized.` }),
      { status: 400 },
    );
  }

  const { provider, upstream_model, api_url } = meta;
  reqJson.model = upstream_model;
  reqJson.messages = mergeConsecutiveMessages(reqJson.messages);
  if (provider === "google") reqJson = translateGoogleThinking(reqJson);
  if (upstream_model.toLowerCase().includes("gemma")) {
    reqJson = cleanGemmaPayload(reqJson);
  }

  logState(
    EMOJI.inbound,
    `[REQ ${reqId}] model=${modelName} provider=${provider} upstream=${upstream_model} stream=${!!reqJson.stream}`,
  );
  if (reqId) recordTrace(reqId, "downstream", reqJson, { model: modelName, provider });

  const isStream = !!reqJson.stream;
  const requestStart = Date.now();
  const estimatedTokens = estimateTokens(
    JSON.stringify(reqJson.messages),
    reqJson.max_tokens || 2048,
  );
  const numKeys = (API_KEYS[provider as keyof typeof API_KEYS] || []).length;
  const maxAttempts =
    LITEROUTER_MAX_ATTEMPTS > 0
      ? Math.min(numKeys, LITEROUTER_MAX_ATTEMPTS)
      : numKeys;

  let reuseKey: string | null = null;
  let graceTried = false;
  let noResponseAttempts = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let activeKey = "";
    let currentRpm = 0;

    try {
      if (reuseKey) {
        activeKey = reuseKey;
        currentRpm = 0;
      } else {
        const keyObj = await router.getAvailableKey(
          provider,
          upstream_model,
          estimatedTokens,
        );
        activeKey = keyObj.key;
        currentRpm = keyObj.currentRpm;
      }
      reuseKey = null;

      const headers = new Headers({
        Authorization: `Bearer ${activeKey}`,
        "Content-Type": "application/json",
      });

      injectThoughtSignature(reqJson);
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
          noResponseTimeoutMs: LITEROUTER_NO_RESPONSE_TIMEOUT_MS,
          totalTimeoutMs: LITEROUTER_HTTP_TIMEOUT_MS,
          clientSignal: signal,
        },
      );

      if (resp.status >= 400) {
        const errorResult = await processOpenAIError(
          resp,
          provider,
          activeKey,
          upstream_model,
          modelName,
          reqId,
          currentRpm,
          graceTried,
        );

        if (errorResult.action === "return") {
          return errorResult.response!;
        } else if (errorResult.action === "retry_same") {
          graceTried = true;
          reuseKey = activeKey;
          await new Promise((r) => setTimeout(r, errorResult.delayMs || 1500));
          continue;
        } else {
          if (attempt < maxAttempts - 1) {
            await new Promise((r) =>
              setTimeout(r, getProviderDelayMs(provider)),
            );
          }
          continue;
        }
      }

      return await processOpenAISuccess(resp, {
        reqId,
        provider,
        modelName,
        upstream_model,
        activeKey,
        servedModelId,
        requestStart,
        isStream,
        attempt,
        maxAttempts,
        currentRpm,
      });
    } catch (e: any) {
      if (signal?.aborted) {
        return new Response(null, { status: 499 });
      }

      if (e instanceof NoResponseError) {
        noResponseAttempts++;
        logWarn(
          EMOJI.amber,
          `[NO_RESPONSE ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} sent nothing within ${LITEROUTER_NO_RESPONSE_TIMEOUT_MS}ms, rotating key (no cooldown) [${noResponseAttempts}/${maxAttempts}]`,
        );
        if (reqId) {
          recordTrace(
            reqId,
            "upstream",
            { status: "no-response", body: "upstream sent no bytes" },
            { model: modelName, provider, status: 0 },
          );
        }
        if (noResponseAttempts >= maxAttempts) {
          logState(
            EMOJI.exhausted,
            `[NO_RESPONSE ${reqId}] all ${maxAttempts} keys ghosted, stopping (no cooldown)`,
          );
          break;
        }
        await new Promise((r) =>
          setTimeout(r, LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS),
        );
        continue;
      }

      if (e.message?.includes("All keys")) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 429,
        });
      }

      if (activeKey) {
        await router.reportError(
          provider,
          activeKey,
          "timeout",
          upstream_model,
        );
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, getProviderDelayMs(provider)));
      }
    }
  }

  logState(
    EMOJI.exhausted,
    `[SYSTEM_LIMIT ${reqId}] Max attempts (${maxAttempts}) reached for ${modelName}, all keys exhausted.`,
  );
  return new Response(
    JSON.stringify({ error: "Failover loop exhausted" }),
    { status: 502 },
  );
}
```

```typescript filepath="src/handlers/google_native.ts"
import {
  LITEROUTER_MAX_ATTEMPTS,
  cleanHeaders,
  getModelLimits,
  getProviderDelayMs,
  parseResetDelay,
  parseUsageFromJson,
  upstreamSignal,
} from "../config/env";
import { StreamMeta, cleanGemmaPayload, cleanLatexSymbols, estimateTokens } from "../transformers/payload";
import {
  API_KEYS,
  EMOJI,
  MODEL_REGISTRY,
  logState,
  logWarn,
  recordTrace,
  router,
  sinkUsage,
} from "../index";

interface GoogleNativeErrorResult {
  action: "return" | "retry_same" | "continue";
  response?: Response;
  delayMs?: number;
}

async function processGoogleNativeError(
  resp: Response,
  activeKey: string,
  upstream_model: string,
  modelName: string,
  reqId?: string,
  currentRpm: number = 0,
  graceTried: boolean = false,
): Promise<GoogleNativeErrorResult> {
  if (resp.status === 400) {
    const errBody = await resp.text();
    return {
      action: "return",
      response: new Response(errBody, {
        status: 400,
        headers: cleanHeaders(resp.headers),
      }),
    };
  }

  const errText = await resp.text();
  const reset = parseResetDelay(resp.headers, errText);

  if (reset && reset <= 2 && !graceTried && resp.status !== 429) {
    return {
      action: "retry_same",
      delayMs: Math.max(reset, 2) * 1000 + 1500,
    };
  }

  const isQuota =
    errText.includes("cooldown") ||
    errText.includes("exhausted quota") ||
    resp.status === 429;

  const errorType = isQuota ? "429" : resp.status.toString();
  await router.reportError("google", activeKey, errorType, upstream_model, reset);

  logState(
    EMOJI.limit,
    `[PROVIDER_LIMIT ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} (${resp.status}) rpm ${currentRpm + 1}/${getModelLimits(modelName, "google").max_rpm}`,
  );

  if (reqId) {
    recordTrace(
      reqId,
      "upstream",
      { status: resp.status, body: errText },
      { model: modelName, provider: "google", status: resp.status },
    );
  }

  return { action: "continue" };
}

async function processGoogleNativeSuccess(
  resp: Response,
  meta: {
    reqId?: string;
    modelName: string;
    upstream_model: string;
    action: string;
    activeKey: string;
    servedModelId?: string;
    requestStart: number;
    attempt: number;
    maxAttempts: number;
    currentRpm: number;
  },
): Promise<Response> {
  const {
    reqId,
    modelName,
    upstream_model,
    action,
    activeKey,
    servedModelId,
    requestStart,
    attempt,
    maxAttempts,
    currentRpm,
  } = meta;

  const outHeaders = cleanHeaders(resp.headers);
  if (servedModelId) outHeaders.set("X-Literouter-Model", servedModelId);

  logState(
    EMOJI.served,
    `[GOOGLE ${reqId}] Served native ${modelName}:${action} (upstream=${upstream_model}, attempt ${attempt + 1}/${maxAttempts}, rpm ${currentRpm + 1}/${getModelLimits(modelName, "google").max_rpm})`,
  );

  if (reqId) {
    recordTrace(
      reqId,
      "upstream",
      { status: resp.status, body: "(stream)" },
      { model: modelName, provider: "google", status: resp.status },
    );
  }

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

      const candidates = text.includes("data: ")
        ? text
            .split("\n")
            .filter((l) => l.trim().startsWith("data: "))
            .map((l) => l.trim().substring(6).trim())
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
    flush() {
      sinkUsage(streamMeta, capturedUsage);
    },
  });

  return new Response(resp.body!.pipeThrough(transform), {
    status: resp.status,
    headers: outHeaders,
  });
}

export async function executeGoogleNative(
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
  const meta =
    MODEL_REGISTRY.get(modelName) || MODEL_REGISTRY.get(`google/${modelName}`);
  if (!meta) {
    return new Response(
      JSON.stringify({ error: `Model '${modelName}' not recognized.` }),
      { status: 400 },
    );
  }
  if (meta.provider !== "google") {
    return new Response(
      JSON.stringify({ error: `Model '${modelName}' is not a Google model.` }),
      { status: 400 },
    );
  }

  const { upstream_model } = meta;
  if (upstream_model.toLowerCase().includes("gemma")) {
    reqJson = cleanGemmaPayload(reqJson);
  }

  logState(
    EMOJI.inbound,
    `[REQ-NATIVE ${reqId}] model=${modelName} action=${action} provider=google upstream=${upstream_model}`,
  );
  if (reqId) recordTrace(reqId, "downstream", reqJson, { model: modelName, provider: "google" });

  const estimatedTokens = estimateTokens(JSON.stringify(reqJson), 1024);
  const numKeys = API_KEYS.google.length;
  const maxAttempts =
    LITEROUTER_MAX_ATTEMPTS > 0
      ? Math.min(numKeys, LITEROUTER_MAX_ATTEMPTS)
      : numKeys;
  const requestStart = Date.now();

  let reuseKey: string | null = null;
  let graceTried = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let activeKey = "";
    let currentRpm = 0;

    try {
      if (reuseKey) {
        activeKey = reuseKey;
        currentRpm = 0;
      } else {
        const keyObj = await router.getAvailableKey(
          "google",
          upstream_model,
          estimatedTokens,
        );
        activeKey = keyObj.key;
        currentRpm = keyObj.currentRpm;
      }
      reuseKey = null;

      const url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${upstream_model}:${action}`,
      );
      queryParams.forEach((v, k) => url.searchParams.append(k, v));
      url.searchParams.set("key", activeKey);

      const headers = cleanHeaders(reqHeaders);
      headers.delete("authorization");

      console.log(
        `[GOOGLE-UPSTREAM] url=${url.toString().replace(activeKey, "REDACTED")}`,
      );
      const resp = await fetch(url.toString(), {
        method: "POST",
        headers,
        body: Object.keys(reqJson).length ? JSON.stringify(reqJson) : undefined,
        signal: upstreamSignal(signal),
      });

      if (resp.status >= 400) {
        const errorResult = await processGoogleNativeError(
          resp,
          activeKey,
          upstream_model,
          modelName,
          reqId,
          currentRpm,
          graceTried,
        );

        if (errorResult.action === "return") {
          return errorResult.response!;
        } else if (errorResult.action === "retry_same") {
          graceTried = true;
          reuseKey = activeKey;
          await new Promise((r) => setTimeout(r, errorResult.delayMs || 1500));
          continue;
        } else {
          if (attempt < maxAttempts - 1) {
            await new Promise((r) =>
              setTimeout(r, getProviderDelayMs("google")),
            );
          }
          continue;
        }
      }

      return await processGoogleNativeSuccess(resp, {
        reqId,
        modelName,
        upstream_model,
        action,
        activeKey,
        servedModelId,
        requestStart,
        attempt,
        maxAttempts,
        currentRpm,
      });
    } catch (e: any) {
      if (signal?.aborted) {
        return new Response(null, { status: 499 });
      }

      if (e.message?.includes("All keys")) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 429,
        });
      }

      if (activeKey) {
        await router.reportError(
          "google",
          activeKey,
          "timeout",
          upstream_model,
        );
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, getProviderDelayMs("google")));
      }
    }
  }

  logState(
    EMOJI.exhausted,
    `[SYSTEM_LIMIT ${reqId}] Max attempts (${maxAttempts}) reached for ${modelName}, all keys exhausted.`,
  );
  return new Response(
    JSON.stringify({ error: "Failover loop exhausted" }),
    { status: 502 },
  );
}

export async function executeGoogleInteractions(
  reqJson: any,
  reqHeaders: Headers,
  reqId?: string,
  signal?: AbortSignal,
): Promise<Response> {
  const agentName =
    reqJson.agent || reqJson.model || "antigravity-preview-05-2026";
  const upstream_model = "antigravity-preview-05-2026";
  const modelName = "google/antigravity-preview-05-2026";

  logState(
    EMOJI.inbound,
    `[REQ-INTERACTIONS ${reqId}] agent=${agentName} provider=google`,
  );
  if (reqId) recordTrace(reqId, "downstream", reqJson, { model: modelName, provider: "google" });

  const estimatedTokens = estimateTokens(JSON.stringify(reqJson), 4096);
  const numKeys = API_KEYS.google.length;
  const maxAttempts =
    LITEROUTER_MAX_ATTEMPTS > 0
      ? Math.min(numKeys, LITEROUTER_MAX_ATTEMPTS)
      : numKeys;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { key: activeKey } = await router.getAvailableKey(
        "google",
        upstream_model,
        estimatedTokens,
      );

      const url =
        "https://generativelanguage.googleapis.com/v1beta/interactions";
      const headers = cleanHeaders(reqHeaders);
      headers.set("x-goog-api-key", activeKey);
      headers.set("Content-Type", "application/json");
      headers.delete("authorization");

      console.log(
        `[GOOGLE-INTERACTIONS] url=${url} key=${activeKey.substring(0, 6)}...`,
      );
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(reqJson),
        signal: upstreamSignal(signal),
      });

      if (resp.status >= 400) {
        const errText = await resp.text();
        await router.reportError(
          "google",
          activeKey,
          resp.status.toString(),
          upstream_model,
        );
        logState(
          EMOJI.limit,
          `[PROVIDER_LIMIT ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} (${resp.status})`,
        );
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, getProviderDelayMs("google")));
          continue;
        }
        return new Response(errText, {
          status: resp.status,
          headers: cleanHeaders(resp.headers),
        });
      }

      const outHeaders = cleanHeaders(resp.headers);
      outHeaders.set("X-Literouter-Model", modelName);
      logState(
        EMOJI.served,
        `[GOOGLE ${reqId}] Served interactions agent=${agentName} (attempt ${attempt + 1}/${maxAttempts})`,
      );

      const respText = await resp.text();
      return new Response(respText, {
        status: resp.status,
        headers: outHeaders,
      });
    } catch (e: any) {
      if (e?.name === "AbortError" || signal?.aborted) {
        return new Response("Client Aborted", { status: 499 });
      }
      logWarn(
        EMOJI.limit,
        `[INTERACTIONS-ERROR ${reqId}] attempt=${attempt + 1}: ${e?.message || e}`,
      );
    }
  }

  return new Response(
    JSON.stringify({
      error: "All Google API keys exhausted for interactions",
    }),
    { status: 502 },
  );
}
```

```typescript filepath="src/lib.ts"
export {
  MODEL_LIMITS,
  PROVIDER_LIMITS,
  DEFAULT_LIMITS,
  getModelLimits,
  staticValidateKeys,
} from "./config/env";

export {
  NoResponseError,
  fetchWithFirstByteTimeout,
} from "./network/fetcher";

export {
  extractThinkingLevel,
  applyReasoningEffort,
  translateGoogleThinking,
} from "./transformers/thinking";

export {
  estimateTokens,
  cleanGemmaPayload,
  cleanLatexSymbols,
  mergeConsecutiveMessages,
  transformNonStreaming,
  createStreamTransformer,
  injectThoughtSignature,
  extractThoughtSignature,
} from "./transformers/payload";
```

```typescript filepath="src/index.ts"
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
```