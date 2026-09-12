import { getProviderConfig } from "../config/providers";
import type { ProviderConfigEntry } from "../config/schema";
import type { ParsedDirective } from "../directive/types";
import { getCircuitBreaker } from "./circuit_breaker";
import { calculateCooldownMs } from "./cooldown";
import { acquirePacer } from "./pacer_adapter";
import { calculateRetryDelay } from "./retry";
import { defaultClassifyFailure, type FailureAction } from "./status_classify";
import type { DispatchContext, ProviderExecutionStrategy } from "./strategy";
import { getStrategy } from "./strategy_registry";
import { safeClose, safeEnqueue } from "../network/fetcher";
import type { OutboundWirePayload, PayloadTransformerContract } from "./transformer";
import { globalKeyPool, overrideProviderUrl } from "../handlers/openai_compat";
import { RequestTelemetry, type UsageRecord } from "../telemetry/session";
import { traceBuffer, type SanitizedTrace } from "../telemetry/ring_buffer";
import { traceWriter } from "../telemetry/trace_writer";
import { sanitizeBody } from "../telemetry/sanitize";

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

function mergeHeaderSource(
  target: Record<string, string>,
  source?: Record<string, string>
): void {
  if (!source) return;
  for (const [k, v] of Object.entries(source)) {
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

  mergeHeaderSource(merged, payloadHeaders);
  mergeHeaderSource(merged, authHeaders);
  mergeHeaderSource(merged, injectedHeaders);
  mergeHeaderSource(merged, targetExtraHeaders);
  mergeHeaderSource(merged, provHeaders);

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

function createCutoffResilientStream(
  sourceStream: ReadableStream<Uint8Array>,
  onMidStreamError: (err: unknown) => void,
  clientSignal?: AbortSignal
): ReadableStream<Uint8Array> {
  const reader = sourceStream.getReader();
  let emittedDone = false;

  return new ReadableStream<Uint8Array>({
    async pull(controller): Promise<void> {
      try {
        const { done, value } = await reader.read();
        if (done) {
          safeClose(controller);
          return;
        }
        controller.enqueue(value);
      } catch (streamErr) {
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

  const poolSize = globalKeyPool.getPoolSize(providerCode);
  const initialKey = globalKeyPool.selectNextKey(providerCode);

  const initialCtx: DispatchContext = {
    reqId: req.reqId,
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

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (req.clientSignal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }

    await acquirePacer(providerCode, provConfig.pacer, req.clientSignal);

    const key = attempt === 1 && initialKey
      ? initialKey
      : globalKeyPool.selectNextKey(providerCode);

    if (!key) {
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
      const upstreamResponse = await fetchFn(target.upstreamUrl, {
        method: req.outboundPayload.method,
        headers: finalHeaders,
        body: JSON.stringify(req.outboundPayload.body),
        signal: req.clientSignal,
      });

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
            req.clientSignal
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
      const failureAction: FailureAction = strategy.classifyFailure?.(currentCtx, upstreamResponse.status)
        ?? defaultClassifyFailure(upstreamResponse.status);

      if (failureAction === "fail_fast") {
        breaker.recordFailure(upstreamResponse.status);
        telemetry.served(upstreamResponse.status, attempt, maxAttempts);
        recordTrace(telemetry, upstreamResponse.status, {
          clientInbound: sanitizeBody(req.rawInboundBody),
          upstreamOutbound: sanitizeBody(req.outboundPayload.body),
        });
        return upstreamResponse;
      }

      if (failureAction === "advance_target") {
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
      const retryAfterSec = parseRetryAfterSec(upstreamResponse.headers.get("retry-after"));
      const consecutiveFailures = globalKeyPool.getConsecutiveAuthFailures(providerCode, key.index);
      const cooldownMs = calculateCooldownMs(
        provConfig.key_cooldown,
        consecutiveFailures,
        retryAfterSec !== undefined ? retryAfterSec * 1000 : undefined
      );

      const cooldownSec = Math.max(1, Math.ceil(cooldownMs / 1000));
      globalKeyPool.quarantineKey(
        providerCode,
        key.index,
        cooldownSec,
        `status_${upstreamResponse.status}`,
        upstreamResponse.status
      );

      breaker.recordFailure(upstreamResponse.status);
      telemetry.recordLimit({
        status: upstreamResponse.status,
        retryAfterSec: cooldownSec,
        totalKeys: key.totalKeys,
      });

      if (attempt < maxAttempts) {
        const delayMs = calculateRetryDelay(retryConfig.delay, attempt);
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
      return upstreamResponse;
    } catch (err) {
      if (req.clientSignal.aborted) {
        throw err;
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
