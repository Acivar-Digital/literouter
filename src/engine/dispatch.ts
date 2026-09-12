import { getEnv } from "../config/env";
import { getProviderConfig } from "../config/providers";
import type { ProviderConfigEntry } from "../config/schema";
import type { ParsedDirective } from "../directive/types";
import { getCircuitBreaker } from "./circuit_breaker";
import { acquirePacer } from "./pacer_adapter";
import { calculateRetryDelay } from "./retry";
import { defaultClassifyFailure, type FailureAction } from "./status_classify";
import type { DispatchContext, ProviderExecutionStrategy } from "./strategy";
import { getStrategy } from "./strategy_registry";
import { safeClose, safeEnqueue, NoResponseError } from "../network/fetcher";
import { isProviderQuarantineEnabled } from "../network/pool";
import type { OutboundWirePayload, PayloadTransformerContract } from "./transformer";
import { globalKeyPool, overrideProviderUrl } from "../handlers/openai_compat";
import { RequestTelemetry, type UsageRecord } from "../telemetry/session";
import { traceBuffer, type SanitizedTrace } from "../telemetry/ring_buffer";
import { traceWriter } from "../telemetry/trace_writer";
import { sanitizeBody } from "../telemetry/sanitize";
import { extractErrorMessage } from "../ui/logger";
import { ensureSessionHeaders } from "./session_id";

export type { OutboundWirePayload, PayloadTransformerContract };

export interface DispatchRequest {
  readonly reqId: string;
  readonly method: string;
  readonly path: string;
  readonly directive: ParsedDirective;
  readonly rawInboundBody: Record<string, unknown>;
  readonly outboundPayload: OutboundWirePayload;
  readonly clientSignal: AbortSignal;
  readonly clientHeaders: Headers;
  readonly transformer: PayloadTransformerContract;
}

export interface ResolvedTarget {
  readonly model: string;
  readonly upstreamUrl: string;
  readonly extraHeaders?: Record<string, string>;
}

export type FetchFn = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

function defaultTarget(
  provConfig: ProviderConfigEntry,
  req: DispatchRequest
): ResolvedTarget {
  const endpointKey = req.outboundPayload.endpointKey as keyof typeof provConfig.endpoints;
  const endpointPath = (provConfig.endpoints[endpointKey] as string | undefined) ?? "";
  const base = provConfig.base_url.replace(/\/+$/, "");
  const rel = endpointPath.startsWith("/") ? endpointPath : `/${endpointPath}`;
  const model = String(req.rawInboundBody.model ?? "default");

  return {
    model,
    upstreamUrl: `${base}${rel}`,
  };
}

function defaultAuthHeaders(
  provConfig: ProviderConfigEntry,
  key: string
): Record<string, string> {
  const authType = provConfig.auth_header;
  if (authType === "x-api-key") {
    return { "x-api-key": key };
  }
  return { Authorization: `Bearer ${key}` };
}

function setHeaderCaseInsensitive(
  headers: Record<string, string>,
  key: string,
  value: string
): void {
  const lower = key.toLowerCase();
  for (const existingKey of Object.keys(headers)) {
    if (existingKey.toLowerCase() === lower) {
      delete headers[existingKey];
    }
  }
  headers[key] = value;
}

export const BANNED_OUTBOUND_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-encoding",
  "content-length",
]);

function isBannedOutboundHeader(key: string): boolean {
  const lowerKey = key.toLowerCase();
  return lowerKey === "host" || BANNED_OUTBOUND_HEADERS.has(lowerKey);
}

function mergeHeaderSource(
  target: Record<string, string>,
  source?: Record<string, string>,
  filterHopByHop = false
): void {
  if (!source) return;
  for (const [k, v] of Object.entries(source)) {
    if (filterHopByHop && isBannedOutboundHeader(k)) {
      continue;
    }
    setHeaderCaseInsensitive(target, k, v);
  }
}

export function mergeOutboundHeaders(
  authHeaders: Record<string, string>,
  injectedHeaders: Record<string, string>,
  provHeaders?: Record<string, string>,
  targetExtraHeaders?: Record<string, string>,
  payloadHeaders?: Record<string, string>
): Record<string, string> {
  const merged: Record<string, string> = {};
  setHeaderCaseInsensitive(merged, "content-type", "application/json");

  mergeHeaderSource(merged, payloadHeaders, true);
  mergeHeaderSource(merged, authHeaders);
  mergeHeaderSource(merged, injectedHeaders);
  mergeHeaderSource(merged, targetExtraHeaders);
  mergeHeaderSource(merged, provHeaders);

  ensureSessionHeaders(merged, payloadHeaders);

  return merged;
}

function parseRetryAfterSec(headerVal: string | null): number | undefined {
  if (!headerVal) return undefined;
  const num = Number(headerVal);
  if (!Number.isNaN(num) && num >= 0) {
    return num;
  }
  const dateMs = Date.parse(headerVal);
  if (!Number.isNaN(dateMs)) {
    const diffSec = Math.ceil((dateMs - Date.now()) / 1000);
    return Math.max(0, diffSec);
  }
  return undefined;
}

function extractUsage(body: unknown): UsageRecord {
  if (body && typeof body === "object" && "usage" in body) {
    const raw = (body as { usage?: Record<string, unknown> }).usage;
    if (raw && typeof raw === "object") {
      const promptTokens = typeof raw.prompt_tokens === "number" ? raw.prompt_tokens : 0;
      const completionTokens = typeof raw.completion_tokens === "number" ? raw.completion_tokens : 0;
      const totalTokens = typeof raw.total_tokens === "number" ? raw.total_tokens : promptTokens + completionTokens;
      return {
        promptTokens,
        completionTokens,
        totalTokens,
      };
    }
  }
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
}

const DONE_CHUNK = new TextEncoder().encode("data: [DONE]\n\n");

function isAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as { name?: unknown; code?: unknown };
  return rec.name === "AbortError" || rec.code === 20;
}

function resolveTtftTimeoutMs(): number {
  const env = getEnv();
  const configured = env.LITEROUTER_TTFT_TIMEOUT_MS || env.LITEROUTER_NO_RESPONSE_TIMEOUT_MS;
  return configured && configured > 0 ? configured : 120000;
}

async function fetchWithTtftGuard(
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  clientSignal: AbortSignal
): Promise<Response> {
  const linked = new AbortController();
  const onClientAbort = (): void => {
    linked.abort(clientSignal.reason);
  };
  if (clientSignal.aborted) {
    linked.abort(clientSignal.reason);
  } else {
    clientSignal.addEventListener("abort", onClientAbort, { once: true });
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      linked.abort(new DOMException(`TTFT exceeded ${timeoutMs}ms`, "TimeoutError"));
      reject(new NoResponseError(`Upstream TTFT timeout after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([fetchFn(url, { ...init, signal: linked.signal }), timeoutPromise]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    clientSignal.removeEventListener("abort", onClientAbort);
  }
}

function buildTtftTimeoutResponse(reqId: string, timeoutMs: number): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: `Upstream TTFT timeout after ${timeoutMs}ms`,
        type: "timeout_error",
        code: "ttft_timeout",
      },
    }),
    {
      status: 504,
      headers: { "content-type": "application/json", "x-request-id": reqId },
    }
  );
}

function createCleanErrorResponse(
  upstreamResponse: Response,
  errText: string
): Response {
  const cleanHeaders = new Headers(upstreamResponse.headers);
  cleanHeaders.delete("content-encoding");
  cleanHeaders.delete("content-length");
  cleanHeaders.delete("transfer-encoding");
  return new Response(errText, {
    status: upstreamResponse.status,
    statusText: upstreamResponse.statusText,
    headers: cleanHeaders,
  });
}

function createCutoffResilientStream(
  sourceStream: ReadableStream<Uint8Array>,
  onMidStreamError: (err: unknown) => void,
  clientSignal?: AbortSignal,
  onStreamComplete?: () => void
): ReadableStream<Uint8Array> {
  const reader = sourceStream.getReader();
  let emittedDone = false;
  let cleanedUp = false;

  const doCleanup = () => {
    if (!cleanedUp) {
      cleanedUp = true;
      if (clientSignal) {
        clientSignal.removeEventListener("abort", doCleanup);
      }
      onStreamComplete?.();
    }
  };

  if (clientSignal?.aborted) {
    doCleanup();
  } else if (clientSignal) {
    clientSignal.addEventListener("abort", doCleanup, { once: true });
  }

  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      try {
        const { done, value } = await reader.read();
        if (done) {
          doCleanup();
          safeClose(controller);
          return;
        }
        controller.enqueue(value);
      } catch (streamErr) {
        doCleanup();
        if (clientSignal?.aborted || isAbortError(streamErr)) {
          safeClose(controller);
          return;
        }
        onMidStreamError(streamErr);
        if (!emittedDone) {
          emittedDone = true;
          safeEnqueue(controller, DONE_CHUNK);
        }
        safeClose(controller);
      }
    },
    async cancel(reason): Promise<void> {
      doCleanup();
      await reader.cancel(reason);
    },
  });
}

function buildDirectiveTelemetryParams(req: DispatchRequest): {
  targetProvider?: string;
  wireFormat?: string;
  endpoint?: string;
  nuances?: readonly string[];
} {
  if (req.directive.type === "direct") {
    return {
      targetProvider: req.directive.provider,
      wireFormat: req.directive.wire,
      endpoint: req.directive.completion,
      nuances: req.directive.nuances,
    };
  }
  return {
    targetProvider: "fusion",
    wireFormat: "oa",
    endpoint: "ch",
  };
}

function recordTrace(
  telemetry: RequestTelemetry,
  status: number,
  legs: {
    clientInbound?: string;
    upstreamOutbound?: string;
    upstreamInbound?: string;
    clientOutbound?: string;
  }
): void {
  const metrics = telemetry.toTraceMetrics();
  const trace: SanitizedTrace = {
    reqId: metrics.reqId,
    createdAt: Date.now(),
    provider: metrics.provider,
    model: metrics.model,
    status,
    durationMs: metrics.durationMs,
    ttftMs: metrics.ttftMs,
    tokensPrompt: metrics.promptTokens,
    tokensCompletion: metrics.completionTokens,
    legs: {
      clientInbound: legs.clientInbound ?? "",
      upstreamOutbound: legs.upstreamOutbound ?? "",
      upstreamInbound: legs.upstreamInbound ?? "",
      clientOutbound: legs.clientOutbound ?? "",
    },
  };
  traceBuffer.push(trace);
  traceWriter.enqueue(trace);
}

export async function executeDispatchPipeline(
  req: DispatchRequest,
  fetchFn: FetchFn = fetch
): Promise<Response> {
  const providerCode = req.directive.type === "direct" ? req.directive.provider : "or";
  const provConfig = getProviderConfig(providerCode);
  const strategy: ProviderExecutionStrategy = getStrategy(providerCode);

  const dirParams = buildDirectiveTelemetryParams(req);
  const modelName = String(req.rawInboundBody.model ?? "unknown");

  const telemetry = new RequestTelemetry({
    reqId: req.reqId,
    method: req.method,
    path: req.path,
    clientAgent: req.clientHeaders.get("user-agent") ?? "Unknown",
    directiveStr: req.directive.raw,
    model: modelName,
    ...dirParams,
  });
  telemetry.emitInbound();

  const breaker = getCircuitBreaker(providerCode, provConfig.circuit_breaker);
  if (breaker.isOpen()) {
    telemetry.error("Circuit breaker open");
    telemetry.served(503);
    recordTrace(telemetry, 503, {
      clientInbound: sanitizeBody(req.rawInboundBody),
      clientOutbound: JSON.stringify({
        error: {
          code: "circuit_breaker_open",
          message: `Provider ${provConfig.name ?? providerCode} circuit breaker is open.`,
          type: "service_unavailable",
        },
      }),
    });
    return breaker.rejectResponse(provConfig.name ?? providerCode);
  }

  if (breaker.getState() === "HALF_OPEN" && !breaker.canProbe()) {
    telemetry.error("Circuit breaker half-open probe limit reached");
    telemetry.served(503);
    recordTrace(telemetry, 503, {
      clientInbound: sanitizeBody(req.rawInboundBody),
      clientOutbound: JSON.stringify({
        error: {
          code: "breaker_open",
          message: `Provider ${provConfig.name ?? providerCode} circuit breaker half-open probe limit reached.`,
          type: "service_unavailable",
        },
      }),
    });
    return new Response(
      JSON.stringify({
        error: {
          code: "breaker_open",
          message: `Provider ${provConfig.name ?? providerCode} circuit breaker half-open probe limit reached.`,
          type: "service_unavailable",
        },
      }),
      {
        status: 503,
        headers: { "content-type": "application/json", "x-request-id": req.reqId },
      }
    );
  }

  const poolSize = globalKeyPool.getPoolSize(providerCode);
  const initialKey = globalKeyPool.selectNextKey(providerCode);

  const initialCtx: DispatchContext = {
    reqId: req.reqId,
    path: req.path,
    directive: req.directive,
    providerConfig: provConfig,
    telemetry,
    clientSignal: req.clientSignal,
    selectedKey: {
      key: initialKey?.key ?? "",
      index: initialKey?.index ?? 0,
      poolSize: Math.max(1, poolSize),
    },
    attempt: 1,
    maxAttempts: provConfig.request_retry.enabled ? provConfig.request_retry.max_attempts : 1,
  };

  const preResult = strategy.preDispatch?.(initialCtx, req.rawInboundBody);
  if (preResult) {
    telemetry.served(preResult.status);
    recordTrace(telemetry, preResult.status, {
      clientInbound: sanitizeBody(req.rawInboundBody),
    });
    return preResult;
  }

  const retryConfig = provConfig.request_retry;
  const maxAttempts = retryConfig.enabled ? retryConfig.max_attempts : 1;
  const ttftTimeoutMs = resolveTtftTimeoutMs();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (req.clientSignal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    const pacerLease = await acquirePacer(providerCode, provConfig.pacer, req.clientSignal);

    const key = attempt === 1 && initialKey
      ? initialKey
      : globalKeyPool.selectNextKey(providerCode);

    if (!key) {
      pacerLease?.release();
      telemetry.error("All keys exhausted or in cooldown");
      telemetry.served(429, attempt, maxAttempts);
      recordTrace(telemetry, 429, {
        clientInbound: sanitizeBody(req.rawInboundBody),
        clientOutbound: JSON.stringify({
          error: {
            message: "All keys in cooldown or exhausted",
            type: "rate_limit_error",
            code: "keys_exhausted",
          },
        }),
      });
      return new Response(
        JSON.stringify({
          error: {
            message: "All keys in cooldown or exhausted",
            type: "rate_limit_error",
            code: "keys_exhausted",
          },
        }),
        {
          status: 429,
          headers: { "content-type": "application/json", "x-request-id": req.reqId },
        }
      );
    }

    telemetry.setKeyIndex(key.index, key.totalKeys);

    const currentCtx: DispatchContext = {
      ...initialCtx,
      selectedKey: {
        key: key.key,
        index: key.index,
        poolSize: Math.max(1, key.totalKeys),
      },
      attempt,
      maxAttempts,
    };

    const resolvedTarget = strategy.resolveTarget?.(currentCtx, req.rawInboundBody) ?? defaultTarget(provConfig, req);
    const target: ResolvedTarget = {
      ...resolvedTarget,
      upstreamUrl: overrideProviderUrl(resolvedTarget.upstreamUrl, providerCode),
    };
    const authHeaders = strategy.buildAuthHeaders?.(key.key, req.clientHeaders) ?? defaultAuthHeaders(provConfig, key.key);
    const injectedHeaders = strategy.injectHeaders?.(currentCtx, authHeaders) ?? authHeaders;
    const finalHeaders = mergeOutboundHeaders(
      authHeaders,
      injectedHeaders,
      provConfig.headers,
      target.extraHeaders,
      req.outboundPayload.headers
    );

    try {
      const upstreamResponse = await fetchWithTtftGuard(
        fetchFn,
        target.upstreamUrl,
        {
          method: req.outboundPayload.method,
          headers: finalHeaders,
          body: JSON.stringify(req.outboundPayload.body),
          signal: req.clientSignal,
        },
        ttftTimeoutMs,
        req.clientSignal
      );

      if (upstreamResponse.status < 400) {
        breaker.recordSuccess();
        if (provConfig.key_cooldown.reset_after_success) {
          globalKeyPool.reportSuccess(providerCode, key.index);
        }

        if (req.outboundPayload.isStreaming) {
          const wireTransformStream = req.transformer.createWireToClientStream(
            req.directive,
            telemetry,
            req.clientSignal
          );

          const rawBody = upstreamResponse.body ?? new ReadableStream<Uint8Array>();
          const transformedStream = rawBody.pipeThrough(wireTransformStream);

          const resilientStream = createCutoffResilientStream(
            transformedStream,
            (streamErr) => {
              breaker.recordFailure(500);
              telemetry.error("Mid-stream upstream failure encountered", streamErr);
            },
            req.clientSignal,
            () => pacerLease?.release()
          );

          telemetry.served(upstreamResponse.status, attempt, maxAttempts);
          recordTrace(telemetry, upstreamResponse.status, {
            clientInbound: sanitizeBody(req.rawInboundBody),
            upstreamOutbound: sanitizeBody(req.outboundPayload.body),
            clientOutbound: "[STREAM]",
          });

          return new Response(resilientStream, {
            status: upstreamResponse.status,
            statusText: upstreamResponse.statusText,
            headers: {
              "content-type": "text/event-stream; charset=utf-8",
              "cache-control": "no-cache",
              connection: "keep-alive",
              "x-request-id": req.reqId,
            },
          });
        }

        const jsonBody = (await upstreamResponse.json()) as Record<string, unknown>;
        const clientJson = req.transformer.transformWireToClient(jsonBody, req.directive);
        telemetry.recordUsage(extractUsage(jsonBody));
        telemetry.served(upstreamResponse.status, attempt, maxAttempts);
        recordTrace(telemetry, upstreamResponse.status, {
          clientInbound: sanitizeBody(req.rawInboundBody),
          upstreamOutbound: sanitizeBody(req.outboundPayload.body),
          upstreamInbound: sanitizeBody(jsonBody),
          clientOutbound: sanitizeBody(clientJson),
        });

        pacerLease?.release();
        return new Response(JSON.stringify(clientJson), {
          status: upstreamResponse.status,
          statusText: upstreamResponse.statusText,
          headers: {
            "content-type": "application/json",
            "x-request-id": req.reqId,
          },
        });
      }

      // Upstream failure classification
      const errText = await upstreamResponse.text();
      const rawErrorMsg = extractErrorMessage(errText);
      const quarantineEnabled = isProviderQuarantineEnabled(providerCode);
      const rawRetryAfterSec = parseRetryAfterSec(upstreamResponse.headers.get("retry-after"));
      const retryAfterSec = quarantineEnabled ? rawRetryAfterSec : undefined;

      telemetry.recordLimit({
        status: upstreamResponse.status,
        retryAfterSec,
        totalKeys: key.totalKeys,
        rawMessage: rawErrorMsg,
        hasUpstreamRetryAfter: retryAfterSec !== undefined,
      });

      const failureAction: FailureAction = strategy.classifyFailure?.(currentCtx, upstreamResponse.status)
        ?? defaultClassifyFailure(upstreamResponse.status);

      if (failureAction === "fail_fast") {
        pacerLease?.release();
        breaker.recordFailure(upstreamResponse.status);
        telemetry.served(upstreamResponse.status, attempt, maxAttempts);
        recordTrace(telemetry, upstreamResponse.status, {
          clientInbound: sanitizeBody(req.rawInboundBody),
          upstreamOutbound: sanitizeBody(req.outboundPayload.body),
        });
        return createCleanErrorResponse(upstreamResponse, errText);
      }

      if (failureAction === "advance_target") {
        pacerLease?.release();
        telemetry.rotateKey({
          fromIndex: key.index,
          toIndex: -1,
          totalKeys: key.totalKeys,
          attempt,
          maxAttempts,
        });
        continue;
      }

      // failureAction === "retry_same_target"
      pacerLease?.release();
      breaker.recordFailure(upstreamResponse.status);

      if (attempt < maxAttempts) {
        const delayMs = retryAfterSec !== undefined
          ? Math.min(retryAfterSec * 1000, 15000)
          : calculateRetryDelay(retryConfig.delay, attempt);
        await Bun.sleep(delayMs);
        telemetry.rotateKey({
          fromIndex: key.index,
          toIndex: -1,
          totalKeys: key.totalKeys,
          attempt: attempt + 1,
          maxAttempts,
        });
        continue;
      }

      telemetry.served(upstreamResponse.status, attempt, maxAttempts);
      recordTrace(telemetry, upstreamResponse.status, {
        clientInbound: sanitizeBody(req.rawInboundBody),
        upstreamOutbound: sanitizeBody(req.outboundPayload.body),
      });
      return createCleanErrorResponse(upstreamResponse, errText);
    } catch (err) {
      pacerLease?.release();
      if (req.clientSignal.aborted) {
        throw err;
      }

      if (err instanceof NoResponseError) {
        breaker.recordFailure(504);
        telemetry.error("Upstream TTFT timeout during dispatch attempt", err);

        if (attempt < maxAttempts) {
          const delayMs = calculateRetryDelay(retryConfig.delay, attempt);
          await Bun.sleep(delayMs);
          continue;
        }

        telemetry.served(504, attempt, maxAttempts);
        recordTrace(telemetry, 504, {
          clientInbound: sanitizeBody(req.rawInboundBody),
          upstreamOutbound: sanitizeBody(req.outboundPayload.body),
        });
        return buildTtftTimeoutResponse(req.reqId, ttftTimeoutMs);
      }

      breaker.recordFailure(0);
      telemetry.error("Network or fetch error during dispatch attempt", err);

      if (attempt < maxAttempts) {
        const delayMs = calculateRetryDelay(retryConfig.delay, attempt);
        await Bun.sleep(delayMs);
        continue;
      }

      telemetry.served(500, attempt, maxAttempts);
      recordTrace(telemetry, 500, {
        clientInbound: sanitizeBody(req.rawInboundBody),
        upstreamOutbound: sanitizeBody(req.outboundPayload.body),
      });

      throw err;
    }
  }

  telemetry.error("All retry attempts exhausted");
  telemetry.served(502);
  recordTrace(telemetry, 502, {
    clientInbound: sanitizeBody(req.rawInboundBody),
    upstreamOutbound: sanitizeBody(req.outboundPayload.body),
  });
  return new Response(
    JSON.stringify({
      error: {
        message: `Provider ${provConfig.name ?? providerCode} retry attempts exhausted`,
        type: "gateway_error",
        code: "retries_exhausted",
      },
    }),
    {
      status: 502,
      headers: { "content-type": "application/json" },
    }
  );
}
