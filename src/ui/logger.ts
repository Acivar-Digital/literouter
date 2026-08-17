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
});

export const WIRE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  oa: "OpenAI",
  cl: "Claude",
  gg: "Google",
  rs: "Responses",
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
  readonly directiveStr?: string;
  readonly targetProvider?: string;
  readonly wireFormat?: string;
  readonly endpoint?: string;
  readonly model?: string;
  readonly keyIndex?: number;
  readonly totalKeys?: number;
  readonly nuances?: readonly string[];
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
    console.log(`🔵 ${ts} [${d.reqId}] Inbound ${d.method} ${d.path} from ${client}`);
    
    if (d.directiveStr) {
      const target = d.targetProvider ? getProviderDisplayName(d.targetProvider) : "Direct";
      const wire = d.wireFormat ? getWireDisplayName(d.wireFormat) : "OpenAI";
      const ep = d.endpoint ? ` | EP: ${d.endpoint}` : "";
      console.log(`    Directive : ${d.directiveStr} -> Target: ${target} | Wire: ${wire}${ep}`);
    }

    if (d.model) {
      const provLabel = d.targetProvider ? getProviderDisplayName(d.targetProvider) : "Provider";
      const keyIdx = d.keyIndex !== undefined ? d.keyIndex + 1 : 1;
      const keyTotal = d.totalKeys !== undefined ? `/${d.totalKeys}` : "";
      const keyInfo = `Key: ${provLabel} [Key #${keyIdx}${keyTotal}]`;
      const nuanceInfo = d.nuances && d.nuances.length > 0 && d.nuances[0] !== "no"
        ? ` | Nuances: [${d.nuances.join(", ")}]`
        : "";
      console.log(`    Model     : ${d.model} | ${keyInfo}${nuanceInfo}`);
    }
    return;
  }

  const reqId = reqIdOrDetails;
  const dir = directiveStr ? ` | Directive: ${directiveStr}` : "";
  console.log(`🔵 ${ts} [${reqId}] Inbound ${method || "POST"} ${path || "/"} (${clientAgent || "Client"})${dir}`);
}

export function logTtft(
  reqId: string,
  ttftMs: number,
  details = "Stream established"
): void {
  const ts = formatTimestamp();
  console.log(`🟢 ${ts} [TTFT ${reqId}] TTFT = ${ttftMs}ms | ${details}`);
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

  console.log(`🟢 ${ts} [USAGE ${details.reqId}] ${provName} (Key #${keyIdx}${totalKeysStr})`);
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
  console.log(`🔄 ${ts} [ROTATE ${reqId}] Advancing to ${provName} [Key #${newIdx + 1}/${total}] -> Retrying immediately${attemptStr}`);
}

export function logLimit(
  reqId: string,
  provider: string,
  keyIdx: number,
  status = 429,
  retryAfterSec?: number,
  totalKeys?: number
): void {
  const ts = formatTimestamp();
  const provName = getProviderDisplayName(provider);
  const keyTotal = totalKeys !== undefined ? `/${totalKeys}` : "";
  console.warn(`⚠️ ${ts} [LIMIT ${reqId}] ${provName} [Key #${keyIdx + 1}${keyTotal}] returned ${status} Too Many Requests`);
  if (retryAfterSec) {
    console.warn(`    Parsed Retry-After: ${retryAfterSec}s -> Quarantined Key #${keyIdx + 1} for ${retryAfterSec}s`);
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
  console.log(`🟠 ${ts} [RETRY ${reqId}] ${provName} [Key #${keyIdx + 1}] attempt ${attempt}/${maxAttempts} (${reason})`);
}

export function logExhausted(
  reqId: string,
  provider: string,
  backoffMs: number
): void {
  const ts = formatTimestamp();
  const provName = getProviderDisplayName(provider);
  console.error(`🔴 ${ts} [EXHAUSTED ${reqId}] All keys in ${provName} cooling down. Applying backoff: ${backoffMs}ms`);
}

export function logAmber(reqId: string, message: string): void {
  const ts = formatTimestamp();
  console.warn(`🟡 ${ts} [AMBER ${reqId}] ${message}`);
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
  console.log(`🟢 ${ts} [SERVED ${reqId}] HTTP ${status} in ${durationMs}ms${attemptStr}`);
}

export function logBoot(message: string): void {
  const ts = formatTimestamp();
  console.log(`🚀 ${ts} BOOT ${message}`);
}

export function logError(
  reqId: string,
  message: string,
  error?: unknown
): void {
  const ts = formatTimestamp();
  const errDetail = error instanceof Error ? ` - ${error.message}` : "";
  console.error(`💥 ${ts} [ERROR ${reqId}] ${message}${errDetail}`);
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
  console.log(`🔗 ${ts} [FUSION ${reqId}] Preset: ${preset} | Model: ${model} -> Tier ${tier} (${provName})`);
}

export function logTrace(reqId: string, tracePath: string): void {
  const ts = formatTimestamp();
  console.log(`📝 ${ts} [TRACE ${reqId}] Saved audit trace -> ${tracePath}`);
}

export function logSeparator(): void {
  console.log("────────────────────────────────────────────────────────────────────────────────");
}
