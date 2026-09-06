function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

function pad3(n: number): string {
  return n.toString().padStart(3, "0");
}

export function formatTimestamp(d: Date = new Date()): string {
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  const hh = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  const ss = pad2(d.getSeconds());
  const ms = pad3(d.getMilliseconds());
  return `[${mm}-${dd}-${hh}:${min}:${ss}:${ms}]`;
}

export const PROVIDER_NAMES: Readonly<Record<string, string>> = Object.freeze({
  or: "OpenRouter",
  nv: "NVIDIA NIM",
  gg: "Google",
  zn: "Zen",
  oa: "OpenAI",
  an: "Anthropic",
  gq: "Groq",
  cb: "Cerebras",
  ds: "DeepSeek",
  ms: "Mistral",
  tg: "Together",
  tp: "TestProvider",
  gc: "GCP (Gemma)",
});

export const WIRE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  oa: "OpenAI",
  cl: "Claude",
  gg: "Google",
  rs: "Responses",
});

export const EMOJI = Object.freeze({
  inbound: "🔵",
  ttft: "🟢",
  usage: "🟢",
  servedOk: "🟢",
  servedErr: "⚠️",
  rotate: "🔄",
  limit: "⚠️",
  retry: "🟠",
  exhausted: "🔴",
  amber: "🟡",
  pacer: "🐢",
  boot: "🚀",
  error: "💥",
  fusion: "🔗",
  finish: "🏁",
  finishTrunc: "⚠️",
  trace: "📝",
  prep: "📦",
  upstream: "🔌",
  stats: "📊",
  prune: "✂️",
  zap: "⚡",
  hourglass: "⏳",
  directive: "🎯",
  model: "🤖",
});

export function getProviderDisplayName(code: string): string {
  const normalized = code.toLowerCase();
  return PROVIDER_NAMES[normalized] || code.toUpperCase();
}

export function getWireDisplayName(code: string): string {
  const normalized = code.toLowerCase();
  return WIRE_NAMES[normalized] || code.toUpperCase();
}

export interface InboundLogDetails {
  readonly reqId: string;
  readonly method: string;
  readonly path: string;
  readonly clientAgent: string;
  readonly protocol?: string;
  readonly directiveStr?: string;
  readonly targetProvider?: string;
  readonly wireFormat?: string;
  readonly endpoint?: string;
  readonly model?: string;
  readonly keyIndex?: number;
  readonly totalKeys?: number;
  readonly nuances?: readonly string[];
  readonly referrer?: string;
}

export function logInbound(
  reqIdOrDetails: string | InboundLogDetails,
  method?: string,
  path?: string,
  clientAgent?: string,
  directiveStr?: string
): void {
  const ts = formatTimestamp();

  if (typeof reqIdOrDetails === "object") {
    const d = reqIdOrDetails;
    const client = d.clientAgent || "Unknown";
    const protoStr = d.protocol ? ` [${d.protocol}]` : "";
    console.log(`${EMOJI.inbound} ${ts} [${d.reqId}] Inbound ${d.method} ${d.path}${protoStr} from ${client}`);
    
    if (d.directiveStr) {
      const target = d.targetProvider ? getProviderDisplayName(d.targetProvider) : "Direct";
      const wire = d.wireFormat ? getWireDisplayName(d.wireFormat) : "OpenAI";
      const ep = d.endpoint ? ` | EP: ${d.endpoint}` : "";
      console.log(`    ${EMOJI.directive} Directive : ${d.directiveStr} -> Target: ${target} | Wire: ${wire}${ep}`);
    }

    if (d.model) {
      const provLabel = d.targetProvider ? getProviderDisplayName(d.targetProvider) : "Provider";
      let keyInfo = "";
      if (d.keyIndex !== undefined) {
        const keyIdx = d.keyIndex + 1;
        const keyTotal = d.totalKeys !== undefined ? `/${d.totalKeys}` : "";
        keyInfo = ` | Key: ${provLabel} [Key #${keyIdx}${keyTotal}]`;
      } else if (d.totalKeys !== undefined) {
        keyInfo = ` | Pool: ${provLabel} (${d.totalKeys} ${d.totalKeys === 1 ? "key" : "keys"})`;
      }
      const nuanceInfo = d.nuances && d.nuances.length > 0 && d.nuances[0] !== "no"
        ? ` | Nuances: [${d.nuances.join(", ")}]`
        : "";
      const refInfo = d.referrer ? ` | Ref: ${d.referrer}` : "";
      console.log(`    ${EMOJI.model} Model     : ${d.model}${keyInfo}${nuanceInfo}${refInfo}`);
    }
    return;
  }

  const reqId = reqIdOrDetails;
  const dir = directiveStr ? ` | Directive: ${directiveStr}` : "";
  console.log(`${EMOJI.inbound} ${ts} [${reqId}] Inbound ${method || "POST"} ${path || "/"} (${clientAgent || "Client"})${dir}`);
}

export function logTtft(
  reqId: string,
  ttftMs: number,
  details = "Stream established",
  protocol?: string
): void {
  const ts = formatTimestamp();
  const protoStr = protocol ? ` [Upstream: ${protocol}]` : "";
  console.log(`${EMOJI.ttft} ${ts} [TTFT ${reqId}] TTFT = ${ttftMs}ms | ${details}${protoStr}`);
}

export interface UsageLogDetails {
  readonly reqId: string;
  readonly provider: string;
  readonly keyIndex?: number;
  readonly totalKeys?: number;
  readonly promptTokens: number;
  readonly reasoningTokens?: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly durationMs?: number;
}

export function formatTokenNumber(num: number): string {
  return num.toLocaleString("en-US");
}

export function logUsage(details: UsageLogDetails): void {
  const ts = formatTimestamp();
  const provName = getProviderDisplayName(details.provider);
  const keyIdx = details.keyIndex !== undefined ? details.keyIndex + 1 : 1;
  const totalKeysStr = details.totalKeys !== undefined ? `/${details.totalKeys}` : "";
  
  let speedStr = "";
  if (details.durationMs && details.durationMs > 0 && details.completionTokens > 0) {
    const sec = details.durationMs / 1000;
    const speed = (details.completionTokens / sec).toFixed(1);
    speedStr = ` | Speed=${speed} tok/s`;
  }

  const reasoningStr = details.reasoningTokens && details.reasoningTokens > 0
    ? ` | Reasoning=${formatTokenNumber(details.reasoningTokens)}`
    : "";

  console.log(`${EMOJI.usage} ${ts} [USAGE ${details.reqId}] ${provName} (Key #${keyIdx}${totalKeysStr})`);
  console.log(
    `    Tokens: Prompt=${formatTokenNumber(details.promptTokens)}${reasoningStr} | Completion=${formatTokenNumber(details.completionTokens)} | Total=${formatTokenNumber(details.totalTokens)}${speedStr}`
  );
}

export function logRotate(
  reqId: string,
  provider: string,
  oldIdx: number,
  newIdx: number,
  total: number,
  attempt?: number,
  maxAttempts?: number
): void {
  const ts = formatTimestamp();
  const provName = getProviderDisplayName(provider);
  const attemptStr = attempt && maxAttempts ? ` (Attempt ${attempt}/${maxAttempts})` : "";
  console.log(`${EMOJI.rotate} ${ts} [ROTATE ${reqId}] Advancing to ${provName} [Key #${newIdx + 1}/${total}] -> Retrying immediately${attemptStr}`);
}

export function getHttpStatusText(status: number): string {
  switch (status) {
    case 429:
      return "429 Too Many Requests";
    case 500:
      return "500 Internal Server Error";
    case 502:
      return "502 Bad Gateway";
    case 503:
      return "503 Service Unavailable";
    case 504:
      return "504 Gateway Timeout";
    default:
      return `HTTP ${status}`;
  }
}

export function extractErrorMessage(bodyText?: string): string | undefined {
  if (!bodyText || !bodyText.trim()) {
    return undefined;
  }
  const trimmed = bodyText.trim();
  try {
    const json = JSON.parse(trimmed) as Record<string, unknown>;
    if (json.error && typeof json.error === "object") {
      const errObj = json.error as Record<string, unknown>;
      if (typeof errObj.message === "string" && errObj.message) {
        return errObj.message;
      }
    }
    if (typeof json.error === "string" && json.error) {
      return json.error;
    }
    if (typeof json.message === "string" && json.message) {
      return json.message;
    }
    if (typeof json.detail === "string" && json.detail) {
      return json.detail;
    }
  } catch (parseErr) {
    void parseErr;
  }
  return trimmed;
}

export function logLimit(
  reqId: string,
  provider: string,
  keyIdx: number,
  status = 429,
  retryAfterSec?: number,
  totalKeys?: number,
  rawMessage?: string
): void {
  const ts = formatTimestamp();
  const provName = getProviderDisplayName(provider);
  const keyTotal = totalKeys !== undefined ? `/${totalKeys}` : "";
  const statusText = getHttpStatusText(status);
  console.warn(`${EMOJI.limit} ${ts} [LIMIT ${reqId}] ${provName} [Key #${keyIdx + 1}${keyTotal}] returned ${statusText}`);
  if (retryAfterSec) {
    console.warn(`    ${EMOJI.limit} Parsed Retry-After: ${retryAfterSec}s -> Quarantined Key #${keyIdx + 1} for ${retryAfterSec}s`);
  }
  if (rawMessage) {
    console.warn(`    ${EMOJI.limit} Upstream Error: "${rawMessage.slice(0, 300)}"`);
  }
}

export function logRetry(
  reqId: string,
  provider: string,
  keyIdx: number,
  attempt: number,
  maxAttempts: number,
  reason: string
): void {
  const ts = formatTimestamp();
  const provName = getProviderDisplayName(provider);
  console.log(`${EMOJI.retry} ${ts} [RETRY ${reqId}] ${provName} [Key #${keyIdx + 1}] attempt ${attempt}/${maxAttempts} (${reason})`);
}

export function logExhausted(
  reqId: string,
  provider: string,
  backoffMs: number
): void {
  const ts = formatTimestamp();
  const provName = getProviderDisplayName(provider);
  console.error(`${EMOJI.exhausted} ${ts} [EXHAUSTED ${reqId}] All keys in ${provName} cooling down. Applying backoff: ${backoffMs}ms`);
}

export function logAmber(reqId: string, message: string): void {
  const ts = formatTimestamp();
  console.warn(`${EMOJI.amber} ${ts} [AMBER ${reqId}] ${message}`);
}

export function logPacer(
  reqId: string,
  provider: string,
  dwellMs: number,
  stats: { queueDepth: number; avgDwellMs: number; minIntervalMs: number }
): void {
  const ts = formatTimestamp();
  const provName = getProviderDisplayName(provider);
  console.log(
    `${EMOJI.pacer} ${ts} [PACER ${reqId}] ${provName} dwell=${dwellMs}ms depth=${stats.queueDepth} avg=${stats.avgDwellMs}ms interval=${stats.minIntervalMs}ms`
  );
}

export function logServed(
  reqId: string,
  durationMs: number,
  status = 200,
  attempt?: number,
  maxAttempts?: number
): void {
  const ts = formatTimestamp();
  const attemptStr = attempt && maxAttempts && maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "";
  const icon = status >= 400 ? EMOJI.servedErr : EMOJI.servedOk;
  if (status >= 400) {
    console.warn(`${icon} ${ts} [SERVED ${reqId}] HTTP ${status} in ${durationMs}ms${attemptStr}`);
  } else {
    console.log(`${icon} ${ts} [SERVED ${reqId}] HTTP ${status} in ${durationMs}ms${attemptStr}`);
  }
}

export function logBoot(message: string): void {
  const ts = formatTimestamp();
  console.log(`${EMOJI.boot} ${ts} BOOT ${message}`);
}

export function logError(
  reqId: string,
  message: string,
  error?: unknown
): void {
  const ts = formatTimestamp();
  const errDetail = error instanceof Error ? ` - ${error.message}` : "";
  console.error(`${EMOJI.error} ${ts} [ERROR ${reqId}] ${message}${errDetail}`);
}

export function logFusion(
  reqId: string,
  preset: string,
  model: string,
  tier: number,
  provider: string
): void {
  const ts = formatTimestamp();
  const provName = getProviderDisplayName(provider);
  console.log(`${EMOJI.fusion} ${ts} [FUSION ${reqId}] Preset: ${preset} | Model: ${model} -> Tier ${tier} (${provName})`);
}

/** Log an info line. Prefer a value from EMOJI for the first argument. */
export function logInfo(emoji: string, message: string): void {
  const ts = formatTimestamp();
  console.log(`${emoji} ${ts} ${message}`);
}

/** Log a warning line. Prefer a value from EMOJI for the first argument. */
export function logWarn(emoji: string, message: string): void {
  const ts = formatTimestamp();
  console.warn(`${emoji} ${ts} ${message}`);
}

export function logFinishReason(
  reqId: string,
  finishReason?: string | null
): void {
  if (!finishReason || typeof finishReason !== "string") {
    return;
  }
  if (finishReason === "length") {
    logWarn(EMOJI.finishTrunc, `[FINISH ${reqId}] Upstream token truncation occurred (finish_reason=length)`);
  } else {
    logInfo(EMOJI.finish, `[FINISH ${reqId}] Stream finished: finish_reason=${finishReason}`);
  }
}

export function logTrace(reqId: string, tracePath: string): void {
  const ts = formatTimestamp();
  console.log(`${EMOJI.trace} ${ts} [TRACE ${reqId}] Saved audit trace -> ${tracePath}`);
}

export function logSeparator(): void {
  console.log("────────────────────────────────────────────────────────────────────────────────");
}
