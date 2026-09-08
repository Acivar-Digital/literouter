import { getEnv } from "../config/env";
import { createUnauthorizedResponse, validateDirective } from "../directive/validator";
import { fetchWithTtftGuard } from "../network/fetcher";
import { getPacerForProvider, PacerQueueOverflowError } from "../network/pacer";
import {
  EMOJI,
  logError,
  logFinishReason,
  logInbound,
  logLimit,
  logSeparator,
  logServed,
  logTtft,
  logUsage,
  logWarn,
} from "../ui/logger";
import { globalKeyPool, handleOpenAICompat, resolveUpstreamEndpoint } from "./openai_compat";

const MAX_NATIVE_ATTEMPTS = 3;
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
  const match = pathname.match(/\/v1beta\/models\/([^:]+)/);
  const raw = match?.[1] ?? "gemini-2.5-flash";
  return raw.startsWith("google/") ? raw.slice(7) : raw;
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

function prepareUpstreamHeaders(reqHeaders: Headers, apiKey: string): Headers {
  const upstreamHeaders = new Headers();
  for (const [k, v] of reqHeaders) {
    if (!STRIPPED_UPSTREAM_HEADERS.has(k.toLowerCase())) {
      upstreamHeaders.set(k, v);
    }
  }
  upstreamHeaders.set("x-goog-api-key", apiKey);
  upstreamHeaders.set("accept-encoding", "identity");
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
  if (!getEnv().LITEROUTER_PACER_ENABLED) {
    return null;
  }
  try {
    const env = getEnv();
    const dynamicMaxQueueDepth = globalKeyPool.getDynamicMaxQueueDepth("gg");
    const maxQueueDepth =
      env.LITEROUTER_PACER_MAX_QUEUE_DEPTH > 0
        ? env.LITEROUTER_PACER_MAX_QUEUE_DEPTH
        : dynamicMaxQueueDepth;
    const pacer = getPacerForProvider("gg", 0, { maxQueueDepth });
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
  logServed(state.reqId, durationMs, state.status, state.attempt, MAX_NATIVE_ATTEMPTS);
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
  startTime: number
): Promise<{ retry: boolean; response: Response }> {
  const { response: res, ttftMs, firstChunk, rawReader, protocol } = guardResult;
  const isRetryable = RETRYABLE_STATUSES.has(res.status);

  if (isRetryable) {
    logLimit(context.reqId, "gg", selected.index, res.status, undefined, selected.totalKeys);
    globalKeyPool.reportFailure("gg", selected.index, res.status);
    await cancelRawReader(rawReader, "retry");
    if (attempt < MAX_NATIVE_ATTEMPTS) {
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
  attempt: number
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
    return await handleNativeResponse(guardResult, context, selected, attempt, startTime);
  } catch (err: unknown) {
    const isLast = attempt >= MAX_NATIVE_ATTEMPTS;
    return handleFetchNetworkError(err, context.reqId, selected.index, isLast);
  }
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
  const context: NativeForwardContext = {
    req,
    rawKey,
    reqId,
    url,
    upstreamUrl: buildGoogleNativeUpstreamUrl(url),
    model: extractModelFromPath(url.pathname),
    bodyBuffer: await req.arrayBuffer(),
  };

  let lastResponse: Response | undefined;
  for (let attempt = 1; attempt <= MAX_NATIVE_ATTEMPTS; attempt++) {
    const outcome = await attemptNativeForward(context, attempt);
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
  const base = process.env.GOOGLE_NATIVE_BASE_URL || "https://generativelanguage.googleapis.com";
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
    globalKeyPool.reportSuccess("gg", selected.index);
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
