import type { ParsedDirective } from "../directive/parser";
import { validateDirective } from "../directive/validator";
import { sanitizeDownstreamHeaders } from "../network/fetcher";
import {
  buildAuthHeaders,
  globalKeyPool,
  initializeKeyPools,
  overrideProviderUrl,
} from "./openai_compat";
import {
  extractErrorMessage,
  formatTimestamp,
  logError,
  logInbound,
  logTtft,
  logWarn,
} from "../ui/logger";

export type Directive =
  | ParsedDirective
  | {
      readonly provider: string;
      readonly raw?: string;
      readonly type?: string;
      readonly [key: string]: unknown;
    };

export interface KeyPoolManager {
  getKey?(provider: string): string | null;
  selectNextKey?(provider: string): { key: string; index: number } | null;
  getNextKey?(provider: string): string | null;
}

export interface GatewayState {
  readonly keyPoolManager?: KeyPoolManager;
}

interface ResolvedRoute {
  readonly provider: string;
  readonly upstreamUrl: string;
  readonly key: string;
  readonly keyIndex: number;
}

const UPSTREAM_URLS: Readonly<Record<string, string>> = Object.freeze({
  zn: "https://opencode.ai/zen/v1/responses",
  or: "https://openrouter.ai/api/v1/responses",
  oa: "https://api.openai.com/v1/responses",
});

export function resolveUpstreamResponsesUrl(provider: string): string | null {
  const targetUrl = UPSTREAM_URLS[provider];
  if (!targetUrl) {
    return null;
  }
  return overrideProviderUrl(targetUrl, provider);
}

export function buildUpstreamHeaders(
  key: string,
  provider: string,
  incomingHeaders?: Headers
): Record<string, string> {
  const headers = buildAuthHeaders("Bearer", key, provider);
  if (incomingHeaders?.has("accept")) {
    headers["Accept"] = incomingHeaders.get("accept") ?? "*/*";
  }
  return headers;
}

function tryStateKeyPool(
  provider: string,
  manager?: KeyPoolManager
): { key: string; index: number } | null {
  if (!manager) {
    return null;
  }
  if (manager.selectNextKey) {
    return manager.selectNextKey(provider);
  }
  if (manager.getKey) {
    const key = manager.getKey(provider);
    return key ? { key, index: 0 } : null;
  }
  if (manager.getNextKey) {
    const key = manager.getNextKey(provider);
    return key ? { key, index: 0 } : null;
  }
  return null;
}

export function resolveApiKey(
  provider: string,
  state?: GatewayState
): { key: string; index: number } | null {
  const fromState = tryStateKeyPool(provider, state?.keyPoolManager);
  if (fromState) {
    return fromState;
  }
  initializeKeyPools();
  const selected = globalKeyPool.selectNextKey(provider);
  return selected ? { key: selected.key, index: selected.index } : null;
}

export function buildSseHeaders(): Headers {
  const headers = new Headers();
  headers.set("Content-Type", "text/event-stream");
  headers.set("Cache-Control", "no-cache");
  headers.set("Connection", "keep-alive");
  return headers;
}

function safeCloseController(controller: ReadableStreamDefaultController<Uint8Array>): void {
  try {
    controller.close();
  } catch (err: unknown) {
    logWarn("stream", `Controller close warning: ${err}`);
  }
}

function releaseReaderLock(reader: ReadableStreamDefaultReader<Uint8Array>): void {
  try {
    reader.releaseLock();
  } catch (err: unknown) {
    logWarn("stream", `Reader release lock warning: ${err}`);
  }
}

async function readLoop(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  let reading = true;
  while (reading) {
    const { done, value } = await reader.read();
    if (done) {
      reading = false;
      safeCloseController(controller);
    } else if (value) {
      controller.enqueue(value);
    }
  }
}

function setupAbortHandler(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  clientSignal?: AbortSignal,
  abortController?: AbortController
): () => void {
  const onAbort = () => {
    abortController?.abort();
    void reader.cancel("aborted");
    safeCloseController(controller);
  };
  if (clientSignal?.aborted) {
    onAbort();
  } else {
    clientSignal?.addEventListener("abort", onAbort, { once: true });
  }
  return () => {
    clientSignal?.removeEventListener("abort", onAbort);
  };
}

function handleStreamError(
  err: unknown,
  controller: ReadableStreamDefaultController<Uint8Array>,
  clientSignal?: AbortSignal
): void {
  if (clientSignal?.aborted) {
    return;
  }
  logWarn("stream", `Stream pump error: ${err}`);
  try {
    controller.error(err);
  } catch (controllerErr: unknown) {
    logWarn("stream", `Controller error warning: ${controllerErr}`);
  }
}

async function pumpStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>,
  clientSignal?: AbortSignal,
  abortController?: AbortController
): Promise<void> {
  const cleanup = setupAbortHandler(reader, controller, clientSignal, abortController);
  try {
    await readLoop(reader, controller);
  } catch (err: unknown) {
    handleStreamError(err, controller, clientSignal);
  } finally {
    cleanup();
    releaseReaderLock(reader);
  }
}

export function createStreamingResponse(
  upstreamResponse: Response,
  clientSignal?: AbortSignal,
  abortController?: AbortController
): Response {
  const upstreamBody = upstreamResponse.body;
  if (!upstreamBody) {
    return new Response(null, {
      status: upstreamResponse.status,
      headers: buildSseHeaders(),
    });
  }

  const reader = upstreamBody.getReader();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      void pumpStream(reader, controller, clientSignal, abortController);
    },
    cancel(reason) {
      abortController?.abort();
      return reader.cancel(reason);
    },
  });

  return new Response(stream, {
    status: upstreamResponse.status,
    headers: buildSseHeaders(),
  });
}

export async function createNonStreamingResponse(
  upstreamResponse: Response
): Promise<Response> {
  const arrayBuffer = await upstreamResponse.arrayBuffer();
  const sanitizedHeaders = sanitizeDownstreamHeaders(
    upstreamResponse.headers,
    arrayBuffer.byteLength
  );
  return new Response(arrayBuffer, {
    status: upstreamResponse.status,
    headers: sanitizedHeaders,
  });
}

export function shouldStreamResponse(
  upstreamResponse: Response,
  clientStreamRequested: boolean
): boolean {
  if (upstreamResponse.status >= 400) {
    return false;
  }
  const contentType = upstreamResponse.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    return true;
  }
  return clientStreamRequested;
}

function extractProviderFromString(rawKey: string): string | null {
  if (rawKey === "zn" || rawKey === "or" || rawKey === "oa") {
    return rawKey;
  }
  const validation = validateDirective(rawKey);
  if (validation.valid && validation.directive.type === "direct") {
    return validation.directive.provider;
  }
  return null;
}

export function extractProvider(
  directiveOrRawKey: Directive | string
): string | null {
  if (typeof directiveOrRawKey === "string") {
    return extractProviderFromString(directiveOrRawKey);
  }
  if (directiveOrRawKey && typeof directiveOrRawKey === "object" && "provider" in directiveOrRawKey) {
    const p = directiveOrRawKey.provider;
    return typeof p === "string" ? p : null;
  }
  return null;
}

interface ParsedRequestBody {
  readonly bodyText: string;
  readonly clientStream: boolean;
  readonly body: {
    readonly model?: string;
    readonly [key: string]: unknown;
  };
}

async function parseRequestBody(
  req: Request
): Promise<ParsedRequestBody> {
  try {
    const bodyText = await req.text();
    if (!bodyText) {
      return { bodyText: "", clientStream: false, body: {} };
    }
    const parsed = JSON.parse(bodyText) as Record<string, unknown>;
    const model = typeof parsed.model === "string" ? parsed.model : undefined;
    return {
      bodyText,
      clientStream: Boolean(parsed.stream),
      body: { ...parsed, model },
    };
  } catch (err: unknown) {
    logWarn("body", `Failed to inspect request body JSON: ${err}`);
    return { bodyText: "", clientStream: false, body: {} };
  }
}

async function executeUpstreamFetch(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers,
    body: body.length > 0 ? body : undefined,
    signal,
  });
}

function resolveRequestRoute(
  directiveOrRawKey: Directive | string,
  state?: GatewayState
): { route?: ResolvedRoute; errorResponse?: Response } {
  const provider = extractProvider(directiveOrRawKey);
  if (!provider || !UPSTREAM_URLS[provider]) {
    return {
      errorResponse: Response.json(
        {
          error: {
            message: `Unsupported or invalid provider '${String(provider)}' for /v1/responses. Supported: zn, or, oa`,
            type: "invalid_request_error",
          },
        },
        { status: 400 }
      ),
    };
  }

  const selectedKey = resolveApiKey(provider, state);
  if (!selectedKey) {
    return {
      errorResponse: Response.json(
        {
          error: {
            message: `No active API keys available for provider '${provider}'`,
            type: "insufficient_quota",
          },
        },
        { status: 429 }
      ),
    };
  }

  const upstreamUrl = resolveUpstreamResponsesUrl(provider);
  if (!upstreamUrl) {
    return {
      errorResponse: Response.json(
        {
          error: {
            message: `No upstream responses endpoint configured for provider '${provider}'`,
            type: "invalid_request_error",
          },
        },
        { status: 400 }
      ),
    };
  }

  return {
    route: {
      provider,
      upstreamUrl,
      key: selectedKey.key,
      keyIndex: selectedKey.index,
    },
  };
}

async function dispatchUpstreamFetch(
  route: ResolvedRoute,
  bodyText: string,
  clientHeaders: Headers,
  signal: AbortSignal,
  reqId: string
): Promise<{ response?: Response; errorResponse?: Response }> {
  const upstreamHeaders = buildUpstreamHeaders(route.key, route.provider, clientHeaders);
  try {
    const res = await executeUpstreamFetch(route.upstreamUrl, upstreamHeaders, bodyText, signal);
    if (res.status >= 400) {
      globalKeyPool.reportFailure(route.provider, route.keyIndex, res.status);
    } else {
      globalKeyPool.reportSuccess(route.provider, route.keyIndex);
    }
    return { response: res };
  } catch (err: unknown) {
    globalKeyPool.reportFailure(route.provider, route.keyIndex, 502);
    logError(reqId, `Upstream request to ${route.upstreamUrl} failed`, err);
    return {
      errorResponse: Response.json(
        {
          error: {
            message: `Upstream request failed: ${extractErrorMessage(String(err)) ?? String(err)}`,
            type: "server_error",
          },
        },
        { status: 502 }
      ),
    };
  }
}

function extractReqContext(stateOrReqId?: GatewayState | string): {
  reqId: string;
  state?: GatewayState;
} {
  if (typeof stateOrReqId === "string") {
    return { reqId: stateOrReqId };
  }
  return {
    reqId: `req_${Math.random().toString(36).slice(2, 9)}`,
    state: stateOrReqId,
  };
}

function createClientAbortedResponse(): Response {
  return Response.json(
    { error: { message: "Request aborted by client", type: "client_closed_request" } },
    { status: 499 }
  );
}

function bindAbortSignal(
  clientSignal: AbortSignal,
  abortController: AbortController
): () => void {
  const onAbort = () => abortController.abort();
  clientSignal.addEventListener("abort", onAbort, { once: true });
  return () => clientSignal.removeEventListener("abort", onAbort);
}

function resolveDirectiveString(
  directiveOrRawKey: Directive | string,
  fallback: string
): string {
  if (typeof directiveOrRawKey === "string") {
    return directiveOrRawKey;
  }
  return typeof directiveOrRawKey.raw === "string"
    ? directiveOrRawKey.raw
    : fallback;
}

export async function handleOpenAiOriginal(
  req: Request,
  directive: Directive,
  state?: GatewayState
): Promise<Response>;
export async function handleOpenAiOriginal(
  req: Request,
  rawKey: string,
  stateOrReqId?: GatewayState | string
): Promise<Response>;
export async function handleOpenAiOriginal(
  req: Request,
  directiveOrRawKey: Directive | string,
  stateOrReqId?: GatewayState | string
): Promise<Response> {
  const { reqId, state } = extractReqContext(stateOrReqId);
  const routeResult = resolveRequestRoute(directiveOrRawKey, state);
  if (routeResult.errorResponse) {
    return routeResult.errorResponse;
  }
  const route = routeResult.route as ResolvedRoute;

  if (req.signal.aborted) {
    return createClientAbortedResponse();
  }

  const { bodyText, clientStream, body } = await parseRequestBody(req);
  const directiveStr = resolveDirectiveString(directiveOrRawKey, route.provider);
  const method = req.method;
  const path = new URL(req.url, "http://localhost").pathname;
  const clientAgent = req.headers.get("user-agent") ?? "unknown";
  const protocol = req.headers.get("x-http-version") ?? "HTTP/1.1";
  const targetProvider = route.provider;

  logInbound({
    reqId,
    method,
    path,
    clientAgent,
    protocol,
    directiveStr,
    targetProvider,
    wireFormat: "oo",
    endpoint: "/v1/responses",
    model: body.model,
  });

  const abortController = new AbortController();
  const cleanup = bindAbortSignal(req.signal, abortController);

  const startTime = Date.now();
  const fetchResult = await dispatchUpstreamFetch(
    route,
    bodyText,
    req.headers,
    abortController.signal,
    reqId
  );
  if (fetchResult.errorResponse) {
    cleanup();
    return req.signal.aborted ? createClientAbortedResponse() : fetchResult.errorResponse;
  }

  const ttftMs = Date.now() - startTime;
  const upstreamRes = fetchResult.response as Response;
  const isStream = shouldStreamResponse(upstreamRes, clientStream);
  logTtft(reqId, ttftMs, isStream ? "Stream established" : "First chunk streamed downstream");

  if (isStream) {
    return createStreamingResponse(upstreamRes, req.signal, abortController);
  }

  cleanup();
  return createNonStreamingResponse(upstreamRes);
}
