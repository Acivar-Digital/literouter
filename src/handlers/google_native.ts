import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getEnv } from "../config/env";
import { getProviderConfig } from "../config/providers";
import { createUnauthorizedResponse, validateDirective } from "../directive/validator";
import { fetchWithTtftGuard } from "../network/fetcher";
import { getPacerForProvider, PacerQueueOverflowError } from "../network/pacer";
import { isFatalAuthError } from "../network/pool";
import {
  EMOJI,
  logError,
  logFinishReason,
  logInbound,
  logInfo,
  logLimit,
  logSeparator,
  logServed,
  logTtft,
  logUsage,
  logWarn,
} from "../ui/logger";
import { globalKeyPool, handleOpenAICompat, resolveUpstreamEndpoint } from "./openai_compat";

function getGoogleMaxAttempts(): number {
  const ggConfig = getProviderConfig("gg");
  return ggConfig.request_retry.enabled ? ggConfig.request_retry.max_attempts : 1;
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const STRIPPED_UPSTREAM_HEADERS = new Set([
  "authorization",
  "x-goog-api-key",
  "host",
  "content-length",
]);
const STRIPPED_DOWNSTREAM_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);

export const DEFAULT_FLASH_CHAIN: readonly string[] = Object.freeze([
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
]);
export const DEFAULT_NATIVE_FLASH_CHAIN = DEFAULT_FLASH_CHAIN;

export const DEFAULT_FLASH_LITE_CHAIN: readonly string[] = Object.freeze([
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
]);

let cachedNativeChains: Readonly<Record<string, readonly string[]>> = {};
const nativeTierIndices = new Map<string, number>();

export function getNativeTierIndex(chainKey: string): number {
  return nativeTierIndices.get(chainKey) ?? 0;
}

export function setNativeTierIndex(chainKey: string, index: number): void {
  nativeTierIndices.set(chainKey, index);
}

export function resetNativeTierIndices(): void {
  nativeTierIndices.clear();
}

export function resetNativeFlashTierIndex(): void {
  resetNativeTierIndices();
}

export function getCurrentFlashTierIndex(): number {
  return getNativeTierIndex("gemini-flash");
}

export function normalizeGoogleNativeModel(rawModel: string): string {
  if (rawModel.startsWith("google/")) {
    return rawModel.slice("google/".length);
  }
  return rawModel;
}

export function resolveNativeChain(normalizedModel: string): readonly string[] | undefined {
  const configuredChain = cachedNativeChains[normalizedModel];
  if (Array.isArray(configuredChain) && configuredChain.length > 0) {
    return configuredChain;
  }
  if (normalizedModel === "gemini-flash") {
    return DEFAULT_FLASH_CHAIN;
  }
  if (normalizedModel === "gemini-flash-lite") {
    return DEFAULT_FLASH_LITE_CHAIN;
  }
  return undefined;
}

export function loadAndCacheNativeChains(): void {
  try {
    const configPath = resolve(process.cwd(), "config", "fusion.json");
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
      if (parsed.native_chains && typeof parsed.native_chains === "object") {
        cachedNativeChains = parsed.native_chains;
        logInfo(EMOJI.boot, `Loaded native_chains: ${Object.keys(parsed.native_chains).join(", ")}`);
        return;
      }
    }
  } catch {
    logWarn(EMOJI.error, "Failed to load native_chains from config/fusion.json — using hardcoded fallback");
  }
  cachedNativeChains = {};
}

export function getNativeChain(chainName: string): readonly string[] {
  const normalized = normalizeGoogleNativeModel(chainName);
  return resolveNativeChain(normalized) ?? [];
}

export function isNativeFusionModel(model: string): boolean {
  const normalized = normalizeGoogleNativeModel(model);
  const chain = resolveNativeChain(normalized);
  return chain !== undefined && chain.length > 0;
}

type SelectedKey = NonNullable<ReturnType<typeof globalKeyPool.selectNextKey>>;
type GuardFetchResult = Awaited<ReturnType<typeof fetchWithTtftGuard>>;

interface GoogleUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
}

interface TelemetryScannerState {
  finishLogged: boolean;
  usageLogged: boolean;
  servedLogged: boolean;
  buffer: string;
  readonly decoder: TextDecoder;
  readonly startTime: number;
  readonly reqId: string;
  readonly keyIndex: number;
  readonly totalKeys: number;
  readonly status: number;
  readonly attempt: number;
  readonly maxAttempts: number;
}

interface NativeForwardContext {
  readonly req: Request;
  readonly rawKey: string;
  readonly reqId: string;
  readonly url: URL;
  readonly upstreamUrl: URL;
  readonly model: string;
  readonly bodyBuffer: ArrayBuffer;
}

function extractModelFromPath(pathname: string): string {
  const match = pathname.match(/\/(?:v1beta|v1)\/models\/([^:]+)/);
  const raw = match?.[1] ?? "gemini-2.5-flash";
  return normalizeGoogleNativeModel(raw);
}

function getGoogleNativeBaseUrl(): string {
  const mockPort = process.env.MOCK_GG_PORT;
  if (mockPort) {
    return `http://127.0.0.1:${mockPort}`;
  }
  const envBase = process.env.GOOGLE_NATIVE_BASE_URL;
  if (envBase) {
    return envBase.endsWith("/") ? envBase.slice(0, -1) : envBase;
  }
  return "https://generativelanguage.googleapis.com";
}

function buildGoogleNativeUpstreamUrl(url: URL): URL {
  const base = getGoogleNativeBaseUrl();
  const upstreamUrl = new URL(`${base}${url.pathname}${url.search}`);
  if (upstreamUrl.searchParams.has("key")) {
    upstreamUrl.searchParams.delete("key");
  }
  return upstreamUrl;
}

function buildTierUpstreamUrl(baseUpstreamUrl: URL, tierModel: string): URL {
  const cloned = new URL(baseUpstreamUrl.toString());
  cloned.pathname = cloned.pathname.replace(
    /\/(v1beta|v1)\/models\/[^:]+/,
    (match) => {
      const version = match.startsWith("/v1beta") ? "v1beta" : "v1";
      return `/${version}/models/${tierModel}`;
    }
  );
  return cloned;
}

function prepareUpstreamHeaders(reqHeaders: Headers, apiKey: string): Headers {
  const upstreamHeaders = new Headers();
  for (const [k, v] of reqHeaders) {
    if (!STRIPPED_UPSTREAM_HEADERS.has(k.toLowerCase())) {
      upstreamHeaders.set(k, v);
    }
  }
  upstreamHeaders.set("x-goog-api-key", apiKey);
  upstreamHeaders.set("accept-encoding", "identity");
  upstreamHeaders.set("user-agent", process.env.LITEROUTER_USER_AGENT || "OpenCode/1.18.29");
  upstreamHeaders.set("http-referer", process.env.LITEROUTER_HTTP_REFERER || "https://opencode.ai");
  upstreamHeaders.set("referer", process.env.LITEROUTER_HTTP_REFERER || "https://opencode.ai");
  upstreamHeaders.set("x-title", process.env.LITEROUTER_X_TITLE || "OpenCode");
  return upstreamHeaders;
}

function prepareDownstreamHeaders(resHeaders: Headers): Headers {
  const downstreamHeaders = new Headers();
  for (const [k, v] of resHeaders) {
    if (!STRIPPED_DOWNSTREAM_HEADERS.has(k.toLowerCase())) {
      downstreamHeaders.set(k, v);
    }
  }
  return downstreamHeaders;
}

function handlePacerError(err: unknown, signal?: AbortSignal): Response {
  if (signal?.aborted || (err instanceof Error && err.message.includes("aborted"))) {
    return Response.json(
      { error: { message: "Request aborted", type: "client_closed_request" } },
      { status: 499 }
    );
  }
  if (err instanceof PacerQueueOverflowError) {
    return Response.json(
      {
        error: {
          message: err.message,
          type: "rate_limit_exceeded",
          code: "rate_limit_exceeded",
        },
      },
      {
        status: 429,
        headers: { "Retry-After": String(err.retryAfterSec) },
      }
    );
  }
  throw err;
}

async function acquireNativePacer(signal?: AbortSignal): Promise<Response | null> {
  const ggPacer = getProviderConfig("gg").pacer;
  if (!getEnv().LITEROUTER_PACER_ENABLED || !ggPacer?.enabled) {
    return null;
  }
  try {
    const pacer = getPacerForProvider("gg");
    await pacer.acquire(signal);
    return null;
  } catch (err: unknown) {
    return handlePacerError(err, signal);
  }
}

function resolveGoogleReferrer(model: string): string | undefined {
  const refHeaders = resolveUpstreamEndpoint("gg", "gc", model).headers;
  const refUa = refHeaders?.["User-Agent"];
  const refUrl = refHeaders?.["HTTP-Referer"] ?? refHeaders?.["Referer"];
  if (refUa && refUrl) {
    return `${refUa} @ ${refUrl}`;
  }
  return refUa ?? refUrl ?? undefined;
}

function logNativeInbound(
  reqId: string,
  req: Request,
  url: URL,
  model: string,
  rawKey: string,
  totalKeys: number
): void {
  logInbound({
    reqId,
    method: req.method,
    path: url.pathname,
    clientAgent: req.headers.get("user-agent") || "unknown",
    protocol: req.headers.get("x-http-version") || "HTTP/1.1",
    directiveStr: rawKey,
    targetProvider: "gg",
    wireFormat: "gg",
    endpoint: url.pathname,
    model,
    totalKeys,
    referrer: resolveGoogleReferrer(model),
  });
}

function validateGoogleDirective(rawKey: string): Response | null {
  const validation = validateDirective(rawKey);
  if (validation.valid === false) {
    return createUnauthorizedResponse(validation.error);
  }
  const directive = validation.directive;
  if (directive.type !== "direct" || directive.provider !== "gg") {
    return Response.json(
      {
        error: {
          message: "Google native requires a Google directive (lr-gg-*)",
          type: "invalid_request_error",
        },
      },
      { status: 400 }
    );
  }
  return null;
}

function getRequestBody(method: string, bodyBuffer: ArrayBuffer): ArrayBuffer | undefined {
  if (method === "GET" || method === "HEAD" || bodyBuffer.byteLength === 0) {
    return undefined;
  }
  return bodyBuffer;
}

function extractNumberByPattern(text: string, pattern: RegExp): number {
  const match = text.match(pattern);
  return match ? Number(match[1]) : 0;
}

function parseFinishReason(text: string): string | null {
  if (!text.includes("finishReason") && !text.includes("finish_reason")) {
    return null;
  }
  const match = text.match(/"finish_?reason"\s*:\s*"([^"]+)"/i);
  return match?.[1] ?? null;
}

function parseUsageMetadata(text: string): GoogleUsage | null {
  if (!text.includes("usageMetadata") && !text.includes("usage_metadata")) {
    return null;
  }
  const promptTokens = extractNumberByPattern(text, /"promptTokenCount"\s*:\s*(\d+)/i);
  const completionTokens = extractNumberByPattern(text, /"candidatesTokenCount"\s*:\s*(\d+)/i);
  const totalRaw = extractNumberByPattern(text, /"totalTokenCount"\s*:\s*(\d+)/i);
  const totalTokens = totalRaw > 0 ? totalRaw : promptTokens + completionTokens;
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0) {
    return null;
  }
  return { promptTokens, completionTokens, totalTokens };
}

function scanFinishReason(text: string, state: TelemetryScannerState): void {
  if (state.finishLogged) {
    return;
  }
  const reason = parseFinishReason(text);
  if (reason) {
    logFinishReason(state.reqId, reason.toLowerCase());
    state.finishLogged = true;
  }
}

function scanUsageMetadata(text: string, state: TelemetryScannerState): void {
  if (state.usageLogged) {
    return;
  }
  const usage = parseUsageMetadata(text);
  if (!usage) {
    return;
  }
  const durationMs = Date.now() - state.startTime;
  logUsage({
    reqId: state.reqId,
    provider: "gg",
    keyIndex: state.keyIndex,
    totalKeys: state.totalKeys,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    durationMs,
  });
  state.usageLogged = true;
}

function scanChunkTelemetry(chunk: Uint8Array, state: TelemetryScannerState): void {
  if (chunk.byteLength === 0) {
    return;
  }
  const text = state.decoder.decode(chunk, { stream: true });
  state.buffer = (state.buffer + text).slice(-65536);
  scanFinishReason(state.buffer, state);
  scanUsageMetadata(state.buffer, state);
  if (state.finishLogged && state.usageLogged) {
    state.buffer = "";
  }
}

function emitStreamEndTelemetry(state: TelemetryScannerState): void {
  if (state.servedLogged) {
    return;
  }
  state.servedLogged = true;
  const remaining = state.decoder.decode();
  if (remaining.length > 0) {
    state.buffer = (state.buffer + remaining).slice(-65536);
    scanFinishReason(state.buffer, state);
    scanUsageMetadata(state.buffer, state);
  }
  state.buffer = "";
  const durationMs = Date.now() - state.startTime;
  logServed(state.reqId, durationMs, state.status, state.attempt, state.maxAttempts);
  logSeparator();
}

async function cancelRawReader(
  rawReader: ReadableStreamDefaultReader<Uint8Array>,
  reason: unknown
): Promise<void> {
  try {
    await rawReader.cancel(reason);
  } catch (err: unknown) {
    logWarn(EMOJI.limit, `Google native stream cancel warning: ${err}`);
  }
}

function yieldFirstChunk(
  firstChunk: Uint8Array,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: TelemetryScannerState
): void {
  if (firstChunk.byteLength === 0) {
    return;
  }
  scanChunkTelemetry(firstChunk, state);
  controller.enqueue(firstChunk);
}

async function handleNextChunk(
  rawReader: ReadableStreamDefaultReader<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  state: TelemetryScannerState
): Promise<void> {
  try {
    const { done, value } = await rawReader.read();
    if (done) {
      emitStreamEndTelemetry(state);
      controller.close();
      return;
    }
    if (value) {
      scanChunkTelemetry(value, state);
      controller.enqueue(value);
    }
  } catch (err: unknown) {
    emitStreamEndTelemetry(state);
    controller.error(err);
  }
}

function createMonitoredStream(
  firstChunk: Uint8Array,
  rawReader: ReadableStreamDefaultReader<Uint8Array>,
  state: TelemetryScannerState
): ReadableStream<Uint8Array> {
  let firstChunkYielded = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!firstChunkYielded) {
        firstChunkYielded = true;
        if (firstChunk.byteLength > 0) {
          yieldFirstChunk(firstChunk, controller, state);
          return;
        }
      }
      await handleNextChunk(rawReader, controller, state);
    },
    async cancel(reason) {
      emitStreamEndTelemetry(state);
      await cancelRawReader(rawReader, reason);
    },
  });
}

function logNativeInboundAttempt(
  context: NativeForwardContext,
  totalKeys: number,
  attempt: number
): void {
  if (attempt !== 1) {
    return;
  }
  logNativeInbound(
    context.reqId,
    context.req,
    context.url,
    context.model,
    context.rawKey,
    totalKeys
  );
}

function createPoolExhaustedResponse(): { retry: boolean; response: Response } {
  return {
    retry: false,
    response: Response.json(
      { error: { message: "Google key pool exhausted", type: "rate_limit_error" } },
      { status: 503 }
    ),
  };
}

function logTtftDetails(
  reqId: string,
  pathname: string,
  ttftMs: number,
  protocol: string
): void {
  const isStream = pathname.includes(":streamGenerateContent");
  const detail = isStream ? "Stream established" : "First chunk streamed downstream";
  logTtft(reqId, ttftMs, detail, protocol);
}

async function executeNativeFetch(
  context: NativeForwardContext,
  selected: SelectedKey
): Promise<GuardFetchResult> {
  const upstreamHeaders = prepareUpstreamHeaders(context.req.headers, selected.key);
  const body = getRequestBody(context.req.method, context.bodyBuffer);
  const bodyString = body ? Buffer.from(body).toString("utf-8") : undefined;

  return fetchWithTtftGuard({
    url: context.upstreamUrl.toString(),
    method: context.req.method as "GET" | "POST",
    headers: Object.fromEntries(upstreamHeaders.entries()),
    body: bodyString,
    clientSignal: context.req.signal,
    provider: "gg",
    keyIndex: selected.index,
    model: context.model,
  });
}

async function handleNativeResponse(
  guardResult: GuardFetchResult,
  context: NativeForwardContext,
  selected: SelectedKey,
  attempt: number,
  startTime: number,
  maxAttempts: number
): Promise<{ retry: boolean; response: Response }> {
  const { response: res, ttftMs, firstChunk, rawReader, protocol } = guardResult;

  if (res.status === 401 || res.status === 403) {
    logError(
      context.reqId,
      `Google native upstream auth failure (${res.status}): Key #${selected.index + 1} rejected. Failing fast.`
    );
    try {
      globalKeyPool.reportFailure("gg", selected.index, res.status);
    } catch (_err) {
      void _err;
    }
    const scannerState: TelemetryScannerState = {
      finishLogged: false,
      usageLogged: false,
      servedLogged: false,
      buffer: "",
      decoder: new TextDecoder(),
      startTime,
      reqId: context.reqId,
      keyIndex: selected.index,
      totalKeys: selected.totalKeys,
      status: res.status,
      attempt,
      maxAttempts,
    };
    const monitoredStream = createMonitoredStream(firstChunk, rawReader, scannerState);
    const downstreamHeaders = prepareDownstreamHeaders(res.headers);
    return {
      retry: false,
      response: new Response(monitoredStream, {
        status: res.status,
        statusText: res.statusText,
        headers: downstreamHeaders,
      }),
    };
  }

  const isRetryable = RETRYABLE_STATUSES.has(res.status);

  if (isRetryable) {
    logLimit(context.reqId, "gg", selected.index, res.status, undefined, selected.totalKeys);
    globalKeyPool.reportFailure("gg", selected.index, res.status);
    await cancelRawReader(rawReader, "retry");
    if (attempt < maxAttempts) {
      return { retry: true, response: res };
    }
  } else {
    globalKeyPool.reportSuccess("gg", selected.index);
  }

  logTtftDetails(context.reqId, context.url.pathname, ttftMs, protocol);

  const scannerState: TelemetryScannerState = {
    finishLogged: false,
    usageLogged: false,
    servedLogged: false,
    buffer: "",
    decoder: new TextDecoder(),
    startTime,
    reqId: context.reqId,
    keyIndex: selected.index,
    totalKeys: selected.totalKeys,
    status: res.status,
    attempt,
    maxAttempts,
  };

  const monitoredStream = createMonitoredStream(firstChunk, rawReader, scannerState);
  const downstreamHeaders = prepareDownstreamHeaders(res.headers);
  return {
    retry: false,
    response: new Response(monitoredStream, {
      status: res.status,
      statusText: res.statusText,
      headers: downstreamHeaders,
    }),
  };
}

function handleFetchNetworkError(
  err: unknown,
  reqId: string,
  keyIndex: number,
  isLastAttempt: boolean
): { retry: boolean; response: Response } {
  globalKeyPool.reportFailure("gg", keyIndex, 502);
  logError(reqId, `Google native upstream network failure: ${err}`);
  if (!isLastAttempt) {
    return { retry: true, response: new Response(null, { status: 502 }) };
  }
  return {
    retry: false,
    response: Response.json(
      { error: { message: "Upstream Google request failed", type: "server_error" } },
      { status: 502 }
    ),
  };
}

async function attemptNativeForward(
  context: NativeForwardContext,
  attempt: number,
  maxAttempts: number = getGoogleMaxAttempts()
): Promise<{ retry: boolean; response: Response }> {
  const pacerError = await acquireNativePacer(context.req.signal);
  if (pacerError) {
    return { retry: false, response: pacerError };
  }

  const selected = globalKeyPool.selectNextKey("gg");
  if (!selected) {
    return createPoolExhaustedResponse();
  }

  logNativeInboundAttempt(context, selected.totalKeys, attempt);

  const startTime = Date.now();
  try {
    const guardResult = await executeNativeFetch(context, selected);
    return await handleNativeResponse(guardResult, context, selected, attempt, startTime, maxAttempts);
  } catch (err: unknown) {
    if (isFatalAuthError(err)) {
      logError(context.reqId, `Google native fatal auth error: ${err.message}`);
      return {
        retry: false,
        response: Response.json(
          { error: { message: err.message, type: "authentication_error", code: err.status } },
          { status: err.status }
        ),
      };
    }
    const isLast = attempt >= maxAttempts;
    return handleFetchNetworkError(err, context.reqId, selected.index, isLast);
  }
}

function buildFusionServedResponse(
  outcomeResponse: Response,
  tierModel: string,
  tierIdx: number
): Response {
  const resHeaders = new Headers(outcomeResponse.headers);
  for (const h of STRIPPED_DOWNSTREAM_HEADERS) {
    resHeaders.delete(h);
  }
  resHeaders.set("x-literouter-model", tierModel);
  resHeaders.set("x-literouter-tier", String(tierIdx + 1));

  return new Response(outcomeResponse.body, {
    status: outcomeResponse.status,
    statusText: outcomeResponse.statusText,
    headers: resHeaders,
  });
}

type TierOutcome =
  | { readonly kind: "success"; readonly response: Response }
  | { readonly kind: "fast_advance"; readonly response: Response }
  | { readonly kind: "fast_fail"; readonly response: Response }
  | { readonly kind: "exhausted"; readonly response?: Response };

async function executeTierKeyLoop(
  context: NativeForwardContext,
  chainKey: string,
  tierModel: string,
  tierIdx: number,
  totalTiers: number,
  chain: readonly string[]
): Promise<TierOutcome> {
  const totalActiveKeys = Math.max(1, globalKeyPool.getPoolSize("gg"));
  let lastResponse: Response | undefined;

  for (let attempt = 1; attempt <= totalActiveKeys; attempt++) {
    const outcome = await attemptNativeForward(context, attempt, totalActiveKeys);
    lastResponse = outcome.response;
    if (outcome.retry) {
      continue;
    }

    const status = outcome.response.status;
    if (status === 401 || status === 403) {
      logError(
        context.reqId,
        `[FUSION ${context.reqId}] Tier ${tierIdx + 1} (${tierModel}) -> ${status} Fatal Auth Failure. Halting cascade.`
      );
      return { kind: "fast_fail", response: outcome.response };
    }

    if (status === 404) {
      const nextModel = chain[(tierIdx + 1) % totalTiers];
      logWarn(
        EMOJI.fusion,
        `[FUSION ${context.reqId}] Tier ${tierIdx + 1} (${tierModel}) → 404. Cascading to Tier ${((tierIdx + 1) % totalTiers) + 1} (${nextModel})`
      );
      return { kind: "fast_advance", response: outcome.response };
    }

    if (status < 429) {
      setNativeTierIndex(chainKey, tierIdx);
      logInfo(
        EMOJI.fusion,
        `[FUSION ${context.reqId}] Tier ${tierIdx + 1} (${tierModel}) → ${status} OK. Served by Tier ${tierIdx + 1}.`
      );
      return {
        kind: "success",
        response: buildFusionServedResponse(outcome.response, tierModel, tierIdx),
      };
    }
  }

  const nextModel = chain[(tierIdx + 1) % totalTiers];
  logWarn(
    EMOJI.fusion,
    `[FUSION ${context.reqId}] Tier ${tierIdx + 1} (${tierModel}) → all ${totalActiveKeys} keys exhausted. Cascading to Tier ${((tierIdx + 1) % totalTiers) + 1} (${nextModel})`
  );
  return { kind: "exhausted", response: lastResponse };
}

async function executeNativeFusionCascade(
  req: Request,
  rawKey: string,
  reqId: string,
  url: URL,
  baseUpstreamUrl: URL,
  bodyBuffer: ArrayBuffer,
  chainKey = "gemini-flash",
  chain: readonly string[] = resolveNativeChain(chainKey) ?? DEFAULT_FLASH_CHAIN
): Promise<Response> {
  const totalTiers = chain.length;
  if (totalTiers === 0) {
    return Response.json(
      { error: { message: `No native chain configured for ${chainKey}`, type: "configuration_error" } },
      { status: 500 }
    );
  }

  const startTier = getNativeTierIndex(chainKey);
  let lastResponse: Response | undefined;

  for (let cycleStep = 0; cycleStep < totalTiers; cycleStep++) {
    const tierIdx = (startTier + cycleStep) % totalTiers;
    const tierModel = chain[tierIdx] ?? chain[0] ?? "gemini-3.5-flash";
    const tierUpstreamUrl = buildTierUpstreamUrl(baseUpstreamUrl, tierModel);

    const context: NativeForwardContext = {
      req,
      rawKey,
      reqId,
      url,
      upstreamUrl: tierUpstreamUrl,
      model: tierModel,
      bodyBuffer,
    };

    const outcome = await executeTierKeyLoop(context, chainKey, tierModel, tierIdx, totalTiers, chain);
    if (outcome.kind === "success" || outcome.kind === "fast_fail") {
      return outcome.response;
    }
    lastResponse = outcome.response;
    setNativeTierIndex(chainKey, (startTier + cycleStep + 1) % totalTiers);
  }

  logWarn(EMOJI.exhausted, `[FUSION ${reqId}] All ${totalTiers} tiers exhausted. Returning 503.`);
  return Response.json(
    { error: { message: "All Google native fusion tiers exhausted", type: "service_unavailable" } },
    { status: 503 }
  );
}

async function executeSingleModelForward(context: NativeForwardContext): Promise<Response> {
  const maxAttempts = getGoogleMaxAttempts();
  let lastResponse: Response | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const outcome = await attemptNativeForward(context, attempt, maxAttempts);
    if (!outcome.retry) {
      return outcome.response;
    }
    lastResponse = outcome.response;
  }

  return (
    lastResponse ??
    Response.json(
      { error: { message: "Google request failed after retries", type: "server_error" } },
      { status: 502 }
    )
  );
}

export async function handleGoogleNative(
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> {
  const authError = validateGoogleDirective(rawKey);
  if (authError) {
    return authError;
  }

  const url = new URL(req.url);
  const baseUpstreamUrl = buildGoogleNativeUpstreamUrl(url);
  const requestedModel = extractModelFromPath(url.pathname);
  const normalizedModel = normalizeGoogleNativeModel(requestedModel);
  const bodyBuffer = await req.arrayBuffer();

  const chain = resolveNativeChain(normalizedModel);
  if (chain && chain.length > 0) {
    return executeNativeFusionCascade(
      req,
      rawKey,
      reqId,
      url,
      baseUpstreamUrl,
      bodyBuffer,
      normalizedModel,
      chain
    );
  }

  const context: NativeForwardContext = {
    req,
    rawKey,
    reqId,
    url,
    upstreamUrl: baseUpstreamUrl,
    model: requestedModel,
    bodyBuffer,
  };

  return executeSingleModelForward(context);
}

export async function handleGoogleOpenAIBeta(
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> {
  return handleOpenAICompat(req, rawKey, reqId);
}

/**
 * Verbatim pass-through for the Antigravity Agent Interactions API
 * (`POST /v1beta/interactions`, `GET /v1beta/files/{id}:download`).
 *
 * The directive (api-key as filter) selects the Google provider; the request
 * path + query are forwarded as-is to GOOGLE_NATIVE_BASE_URL and authenticated
 * with a rotated key from the `gg` pool. The gateway master key (sk-lr-*) is
 * intentionally NOT accepted here.
 */
export async function handleGoogleInteractionsPassthrough(
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> {
  const validation = validateDirective(rawKey);
  if (validation.valid === false) {
    return createUnauthorizedResponse(validation.error);
  }
  const directive = validation.directive;
  if (directive.type !== "direct" || directive.provider !== "gg") {
    return Response.json(
      {
        error: {
          message: "Antigravity interactions requires a Google directive (lr-gg-*)",
          type: "invalid_request_error",
        },
      },
      { status: 400 }
    );
  }

  const url = new URL(req.url);
  const base = getGoogleNativeBaseUrl();
  const upstreamUrl = new URL(`${base}${url.pathname}${url.search}`);

  const pacerError = await acquireNativePacer(req.signal);
  if (pacerError) {
    return pacerError;
  }

  const selected = globalKeyPool.selectNextKey("gg");
  if (!selected) {
    return Response.json(
      { error: { message: "Google key pool exhausted", type: "rate_limit_error" } },
      { status: 503 }
    );
  }

  const upstreamHeaders = prepareUpstreamHeaders(req.headers, selected.key);
  const ggReferrer = resolveGoogleReferrer("antigravity");

  logInbound({
    reqId,
    method: req.method,
    path: url.pathname,
    clientAgent: req.headers.get("user-agent") || "unknown",
    protocol: req.headers.get("x-http-version") || "HTTP/1.1",
    directiveStr: rawKey,
    targetProvider: "gg",
    wireFormat: "gg",
    endpoint: url.pathname,
    model: "antigravity",
    totalKeys: selected.totalKeys,
    referrer: ggReferrer,
  });

  try {
    const upstreamReq = new Request(upstreamUrl.toString(), {
      method: req.method,
      headers: upstreamHeaders,
      body: req.body,
      signal: req.signal,
    });
    const res = await fetch(upstreamReq);
    if (res.status === 401 || res.status === 403) {
      logError(
        reqId,
        `Google interactions passthrough upstream auth failure (${res.status}): Key #${selected.index + 1} rejected. Failing fast.`
      );
      try {
        globalKeyPool.reportFailure("gg", selected.index, res.status);
      } catch (_err) {
        void _err;
      }
    } else if (res.status >= 400) {
      globalKeyPool.reportFailure("gg", selected.index, res.status);
    } else {
      globalKeyPool.reportSuccess("gg", selected.index);
    }
    const outHeaders = prepareDownstreamHeaders(res.headers);
    return new Response(res.body, { status: res.status, headers: outHeaders });
  } catch (err: unknown) {
    globalKeyPool.reportFailure("gg", selected.index, 502);
    logError(reqId, `Google interactions passthrough upstream failure: ${err}`);
    return Response.json(
      { error: { message: "Upstream Google interactions request failed", type: "server_error" } },
      { status: 502 }
    );
  }
}

export {
  GoogleNativeTransformer,
  googleNativeTransformer,
  type GoogleUsage,
  parseFinishReason,
  parseUsageMetadata,
} from "../transformers/google_native";

