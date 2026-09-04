import type { DirectDirective, ParsedDirective } from "../directive/parser";
import { parseDirective } from "../directive/parser";
import { createUnauthorizedResponse, extractDirectiveToken, validateDirective } from "../directive/validator";
import { classifyTransportError, classifyUpstreamError } from "../network/classifier";
import {
  createResilientStream,
  fetchWithTtftGuard,
  type FetcherOptions,
  NoResponseError,
  sanitizeDownstreamHeaders,
} from "../network/fetcher";
import { type SelectedKey } from "../network/pool";
import { sanitizeAndTransformPayload } from "../transformers/payload";
import type { OpenAIRequestPayload } from "../transformers/nuances";
import { getEnv } from "../config/env";
import { getPacerForProvider, PacerQueueOverflowError } from "../network/pacer";
import { getCircuitBreakerForProvider } from "../network/circuit_breaker";
import {
  extractErrorMessage,
  logError,
  logExhausted,
  logFinishReason,
  logInbound,
  logLimit,
  logRotate,
  logSeparator,
  logServed,
  logTtft,
  logUsage,
  logWarn,
} from "../ui/logger";
import {
  DEFAULT_MAX_CONTEXT_TOKENS,
  DEFAULT_SAFE_CONTEXT_TOKENS,
  estimateOpenAITokens,
  extractContextLimit,
  isContextLengthError,
  pruneOpenAIPayload,
} from "../transformers/context_pruner";
import {
  globalKeyPool,
  type RequestClientOptions,
  resolveUpstreamEndpoint,
  UpstreamRetryableError,
  waitAndSelectKey,
} from "./openai_compat";

export interface GcpHandleOptions extends RequestClientOptions {
  readonly customPath?: string;
  readonly skipInboundLog?: boolean;
}

export function normalizeGcpModel(model: string | undefined | null): string {
  if (!model || typeof model !== "string") {
    return "";
  }
  return model.replace(/^(?:gcp|google)\//i, "");
}

export function isGemmaModel(model: string | undefined | null): boolean {
  if (!model || typeof model !== "string") {
    return false;
  }
  const normalized = normalizeGcpModel(model).toLowerCase().trim();
  return normalized.includes("gemma");
}

export function buildGcpAuthHeaders(key: string): Record<string, string> {
  return {
    Authorization: `Bearer ${key}`,
    "x-goog-api-key": key,
    "Content-Type": "application/json",
  };
}

function mergeUint8Arrays(chunks: readonly Uint8Array[], totalLength: number): Uint8Array {
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function collectFullBody(
  firstChunk: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [firstChunk];
  let totalLength = firstChunk.length;
  let reading = true;

  while (reading) {
    const { done, value } = await reader.read();
    if (done) {
      reading = false;
    } else if (value) {
      chunks.push(value);
      totalLength += value.length;
    }
  }
  return mergeUint8Arrays(chunks, totalLength);
}

async function acquireGcpPacer(clientSignal: AbortSignal | undefined): Promise<number> {
  const env = getEnv();
  if (!env.LITEROUTER_PACER_ENABLED || !env.GCP_ENABLE_PACER) {
    return 0;
  }
  const dynamicMaxQueueDepth = globalKeyPool.getDynamicMaxQueueDepth("gc");
  const maxQueueDepth =
    env.LITEROUTER_PACER_MAX_QUEUE_DEPTH > 0
      ? env.LITEROUTER_PACER_MAX_QUEUE_DEPTH
      : dynamicMaxQueueDepth;

  const pacer = getPacerForProvider("gc", 0, {
    minIntervalMs: env.GCP_MIN_DELAY_MS,
    maxQueueDepth,
    maxQueueWaitMs: env.GCP_PACER_MAX_QUEUE_WAIT_MS,
  });

  const { queueDwellMs } = await pacer.acquire(clientSignal);
  return queueDwellMs;
}

async function executeGcpDirectCall(
  directive: DirectDirective,
  payload: OpenAIRequestPayload,
  clientSignal: AbortSignal | undefined,
  selected: SelectedKey,
  reqId: string,
  attempt: number,
  maxAttempts: number,
  _clientOptions?: RequestClientOptions
): Promise<Response> {
  const env = getEnv();
  const breaker = (env.LITEROUTER_CIRCUIT_BREAKER && env.GCP_ENABLE_CIRCUIT_BREAKER)
    ? getCircuitBreakerForProvider("gc")
    : null;

  if (breaker && !breaker.isAvailable()) {
    logWarn("💥", `[BREAKER ${reqId}] Provider 'gc' circuit breaker is OPEN. Fast-failing GCP request.`);
    throw new UpstreamRetryableError(
      "Provider 'gc' circuit breaker is OPEN",
      503,
      { action: "retry_rotate", reason: "circuit_breaker_open", quarantineTtlSec: 60 }
    );
  }

  const normalizedModel = normalizeGcpModel(payload.model);
  const activePayload = payload.model !== normalizedModel ? { ...payload, model: normalizedModel } : payload;
  const endpoint = resolveUpstreamEndpoint("gc", directive.completion || "ch", activePayload.model);
  const headers = buildGcpAuthHeaders(selected.key);
  const fetchOpts: FetcherOptions = {
    url: endpoint.url,
    method: "POST",
    headers,
    body: JSON.stringify(activePayload),
    clientSignal,
    provider: "gc",
    keyIndex: selected.index,
    model: activePayload.model,
  };

  const startTime = Date.now();

  const { response, ttftMs, firstChunk, rawReader, protocol } = await fetchWithTtftGuard(fetchOpts);
  const duration = Date.now() - startTime;

  const isStream = Boolean(payload.stream);

  if (response.status >= 400) {
    if (breaker && (response.status >= 500 || response.status === 529)) {
      breaker.recordFailure(true);
    } else if (breaker) {
      breaker.recordFailure(false);
    }

    const fullBody = await collectFullBody(firstChunk, rawReader);
    const bodyText = new TextDecoder().decode(fullBody);
    const classification = classifyUpstreamError({
      provider: "gc",
      status: response.status,
      headers: response.headers,
      bodyText,
    });

    if (env.GCP_ENABLE_QUARANTINE && classification.quarantineTtlSec > 0) {
      globalKeyPool.reportFailure(
        "gc",
        selected.index,
        response.status,
        response.headers,
        bodyText,
        Date.now(),
        classification.quarantineTtlSec
      );
    } else if (!env.GCP_ENABLE_QUARANTINE && classification.quarantineTtlSec > 0) {
      logWarn("⚡", `[GCP ${reqId}] Dumb-forwarder mode (GCP_ENABLE_QUARANTINE=false): Key ${selected.index} quarantine bypassed.`);
    }

    const rawErrorMsg = extractErrorMessage(bodyText);
    const ttlSec = env.GCP_ENABLE_QUARANTINE
      ? (classification.quarantineTtlSec > 0 ? classification.quarantineTtlSec : (response.status === 429 ? 60 : undefined))
      : undefined;
    logLimit(reqId, "gc", selected.index, response.status, ttlSec, selected.totalKeys, rawErrorMsg);

    if (env.GCP_ENABLE_RETRIES && isContextLengthError(response.status, bodyText) && !clientSignal?.aborted) {
      const detectedLimit = extractContextLimit(bodyText);
      const targetLimit = detectedLimit ? Math.floor(detectedLimit * 0.75) : DEFAULT_SAFE_CONTEXT_TOKENS;
      const pruned = pruneOpenAIPayload(payload, targetLimit);
      if (pruned.messages.length < payload.messages.length || estimateOpenAITokens(pruned) < estimateOpenAITokens(payload)) {
        logWarn("✂️", `[PRUNE ${reqId}] Context length exceeded upstream (${detectedLimit ?? "unknown"} tokens). Auto-pruned message turns and retrying...`);
        return executeGcpDirectCall(directive, pruned, clientSignal, selected, reqId, attempt, maxAttempts, _clientOptions);
      }
    }

    const canRetry =
      env.GCP_ENABLE_RETRIES &&
      classification.action === "retry_rotate" &&
      attempt < maxAttempts &&
      !clientSignal?.aborted;
    if (canRetry) {
      throw new UpstreamRetryableError(
        `Upstream error ${response.status}: ${classification.reason}`,
        response.status,
        classification
      );
    }

    if (!env.GCP_ENABLE_RETRIES && classification.action === "retry_rotate") {
      logWarn("⚡", `[GCP ${reqId}] Single-flight mode (GCP_ENABLE_RETRIES=false): Passing HTTP ${response.status} directly downstream.`);
    }

    logServed(reqId, duration, response.status, attempt, maxAttempts);
    logSeparator();

    return new Response(fullBody.buffer as ArrayBuffer, {
      status: response.status,
      headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
    });
  }

  breaker?.recordSuccess();
  globalKeyPool.reportSuccess("gc", selected.index);
  logTtft(reqId, ttftMs, isStream ? "Stream established" : "First chunk streamed downstream", protocol);

  if (!isStream) {
    const fullBody = await collectFullBody(firstChunk, rawReader);
    try {
      const decoded = new TextDecoder().decode(fullBody);
      const json = JSON.parse(decoded) as {
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          reasoning_tokens?: number;
          total_tokens?: number;
        };
      };
      if (json.usage) {
        logUsage({
          reqId,
          provider: "gc",
          keyIndex: selected.index,
          totalKeys: selected.totalKeys,
          promptTokens: json.usage.prompt_tokens || 0,
          reasoningTokens: json.usage.reasoning_tokens || 0,
          completionTokens: json.usage.completion_tokens || 0,
          totalTokens: json.usage.total_tokens || 0,
          durationMs: duration,
        });
      }
    } catch (parseErr) {
      void parseErr;
    }

    logServed(reqId, duration, response.status, attempt, maxAttempts);
    logSeparator();

    return new Response(fullBody.buffer as ArrayBuffer, {
      status: response.status,
      headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
    });
  }

  let currentKeyIndex = selected.index;
  let currentAttempt = attempt;

  const resilientStream = createResilientStream(firstChunk, rawReader, {
    protocol: "openai",
    onUsage: (u) => {
      const streamDuration = Date.now() - startTime;
      logUsage({
        reqId,
        provider: "gc",
        keyIndex: currentKeyIndex,
        totalKeys: selected.totalKeys,
        promptTokens: u.promptTokens,
        reasoningTokens: u.reasoningTokens,
        completionTokens: u.completionTokens,
        totalTokens: u.totalTokens,
        durationMs: streamDuration,
      });
      logServed(reqId, streamDuration, response.status, currentAttempt, maxAttempts);
      logSeparator();
    },
    onFinishReason: (finishReason) => {
      logFinishReason(reqId, finishReason);
    },
    retryProvider: async (reason: string, _hasEmittedTokens?: boolean) => {
      const classification = classifyTransportError(reason);
      if (env.GCP_ENABLE_QUARANTINE && classification.quarantineTtlSec > 0) {
        globalKeyPool.reportFailure("gc", currentKeyIndex, 500, undefined, reason, Date.now(), classification.quarantineTtlSec);
      }
      const ttlSec = env.GCP_ENABLE_QUARANTINE && classification.quarantineTtlSec > 0
        ? classification.quarantineTtlSec
        : undefined;
      logLimit(reqId, "gc", currentKeyIndex, 500, ttlSec, selected.totalKeys, reason);

      if (!env.GCP_ENABLE_RETRIES) {
        logWarn("⚡", `[GCP ${reqId}] Mid-stream drop occurred. Retries disabled via GCP_ENABLE_RETRIES=false. Closing stream.`);
        return null;
      }

      while (currentAttempt < maxAttempts) {
        currentAttempt++;
        if (clientSignal?.aborted) {
          return null;
        }
        const nextSelected = globalKeyPool.selectNextKey("gc");
        if (!nextSelected) {
          return null;
        }
        logRotate(reqId, "gc", currentKeyIndex, nextSelected.index, nextSelected.totalKeys, currentAttempt, maxAttempts);
        currentKeyIndex = nextSelected.index;

        const nextHeaders = buildGcpAuthHeaders(nextSelected.key);
        const nextFetchOpts: FetcherOptions = {
          url: endpoint.url,
          method: "POST",
          headers: nextHeaders,
          body: JSON.stringify(activePayload),
          clientSignal,
          provider: "gc",
          keyIndex: nextSelected.index,
          model: activePayload.model,
        };

        if (env.LITEROUTER_PACER_ENABLED && env.GCP_ENABLE_PACER) {
          await acquireGcpPacer(clientSignal);
        }

        try {
          const nextResult = await fetchWithTtftGuard(nextFetchOpts);
          if (nextResult.response.status >= 400) {
            if (env.GCP_ENABLE_QUARANTINE) {
              globalKeyPool.reportFailure("gc", nextSelected.index, nextResult.response.status);
            }
            continue;
          }
          globalKeyPool.reportSuccess("gc", nextSelected.index);
          return {
            firstChunk: nextResult.firstChunk,
            rawReader: nextResult.rawReader,
          };
        } catch (retryErr: unknown) {
          if (retryErr instanceof NoResponseError && env.GCP_ENABLE_QUARANTINE) {
            globalKeyPool.reportFailure("gc", nextSelected.index, 0, undefined, retryErr.message, Date.now(), 2);
          }
          continue;
        }
      }
      return null;
    },
  });

  return new Response(resilientStream, {
    status: response.status,
    headers: sanitizeDownstreamHeaders(response.headers),
  });
}

interface AttemptExecutionResult {
  readonly success: boolean;
  readonly response?: Response;
  readonly error?: unknown;
  readonly retryable: boolean;
}

async function tryGcpAttempt(
  directive: DirectDirective,
  transformed: OpenAIRequestPayload,
  clientSignal: AbortSignal | undefined,
  selected: SelectedKey,
  reqId: string,
  attempt: number,
  maxAttempts: number,
  startTime: number,
  clientOptions?: RequestClientOptions
): Promise<AttemptExecutionResult> {
  const env = getEnv();
  try {
    const res = await executeGcpDirectCall(directive, transformed, clientSignal, selected, reqId, attempt, maxAttempts, clientOptions);
    return { success: true, response: res, retryable: false };
  } catch (err: unknown) {
    if (clientSignal?.aborted) {
      return { success: false, error: err, retryable: false };
    }
    if (err instanceof Error && err.message.includes("aborted")) {
      return { success: false, error: err, retryable: false };
    }
    if (err instanceof PacerQueueOverflowError) {
      logWarn("⏳", `[PACER ${reqId}] GCP Pacer queue overflow: ${err.message} (Retry-After: ${err.retryAfterSec}s)`);
      logServed(reqId, Date.now() - startTime, 429, attempt, maxAttempts);
      logSeparator();
      return {
        success: true,
        response: Response.json(
          {
            error: {
              message: err.message,
              type: "rate_limit_exceeded",
              code: "rate_limit_exceeded",
            },
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(err.retryAfterSec),
              "Content-Type": "application/json",
            },
          }
        ),
        retryable: false,
      };
    }
    if (err instanceof UpstreamRetryableError) {
      return { success: false, error: err, retryable: true };
    }
    if (err instanceof NoResponseError) {
      if (env.GCP_ENABLE_QUARANTINE) {
        globalKeyPool.reportFailure("gc", selected.index, 0, undefined, err.message, Date.now(), 2);
      }
      if (!env.GCP_ENABLE_RETRIES) {
        logWarn("⚡", `[GCP ${reqId}] Single-flight mode (GCP_ENABLE_RETRIES=false): Upstream transport error: ${err.message}`);
        logServed(reqId, Date.now() - startTime, 502, attempt, maxAttempts);
        logSeparator();
        return {
          success: true,
          response: Response.json(
            {
              error: {
                message: `GCP upstream connection failed: ${err.message}`,
                type: "upstream_connection_error",
                code: 502,
              },
            },
            {
              status: 502,
              headers: { "Content-Type": "application/json" },
            }
          ),
          retryable: false,
        };
      }
      return { success: false, error: err, retryable: true };
    }
    logError(reqId, "Direct GCP request error", err);
    return { success: false, error: err, retryable: false };
  }
}

async function executeGcpAttemptLoop(
  directive: DirectDirective,
  transformed: OpenAIRequestPayload,
  clientSignal: AbortSignal | undefined,
  reqId: string,
  clientOptions?: RequestClientOptions
): Promise<Response> {
  const env = getEnv();
  const poolSize = globalKeyPool.getPoolSize("gc");
  const maxAttempts = env.GCP_ENABLE_RETRIES
    ? Math.min(3, Math.max(1, poolSize))
    : 1;
  let lastError: unknown = null;
  let prevKeyIndex = -1;
  const startTime = Date.now();
  const maxWaitMs = env.GCP_PACER_MAX_QUEUE_WAIT_MS || 240000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (clientSignal?.aborted) {
      return Response.json(
        { error: { message: "Request aborted by client", type: "client_closed_request" } },
        { status: 499 }
      );
    }

    const dwellMs = Date.now() - startTime;
    if (env.GCP_ENABLE_QUARANTINE && globalKeyPool.shouldLoadShed("gc", dwellMs, maxWaitMs)) {
      const minTtl = globalKeyPool.getMinQuarantineTtlMs("gc");
      const retryAfterSec = Math.max(1, Math.ceil(minTtl / 1000));
      return Response.json(
        { error: { message: "Provider 'gc' unavailable: all keys in cooldown exceed wait budget.", type: "service_unavailable" } },
        {
          status: 503,
          headers: {
            "Retry-After": String(retryAfterSec),
          },
        }
      );
    }

    try {
      await acquireGcpPacer(clientSignal);
    } catch (err: unknown) {
      if (clientSignal?.aborted || (err instanceof Error && err.message.includes("aborted"))) {
        return Response.json(
          { error: { message: "Request aborted by client", type: "client_closed_request" } },
          { status: 499 }
        );
      }
      if (err instanceof PacerQueueOverflowError) {
        logWarn("⏳", `[PACER ${reqId}] GCP Pacer queue overflow: ${err.message} (Retry-After: ${err.retryAfterSec}s)`);
        logServed(reqId, Date.now() - startTime, 429, attempt, maxAttempts);
        logSeparator();
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
            headers: {
              "Retry-After": String(err.retryAfterSec),
              "Content-Type": "application/json",
            },
          }
        );
      }
      throw err;
    }

    let selected: SelectedKey | null = null;
    try {
      selected = await waitAndSelectKey("gc", startTime, maxWaitMs, clientSignal);
    } catch (err) {
      void err;
    }

    if (!selected) {
      if (clientSignal?.aborted) {
        return Response.json(
          { error: { message: "Request aborted by client", type: "client_closed_request" } },
          { status: 499 }
        );
      }
      const minTtl = globalKeyPool.getMinQuarantineTtlMs("gc");
      logExhausted(reqId, "gc", minTtl);
      return Response.json(
        {
          error: {
            message: "All GCP API keys are currently rate-limited or in cooldown.",
            type: "rate_limit_exceeded",
            code: "all_keys_in_cooldown",
          },
        },
        {
          status: 429,
          headers: {
            "Retry-After": "5",
            "Content-Type": "application/json",
          },
        }
      );
    }

    if (attempt > 1) {
      logRotate(reqId, "gc", prevKeyIndex, selected.index, selected.totalKeys, attempt, maxAttempts);
    }
    prevKeyIndex = selected.index;

    const outcome = await tryGcpAttempt(directive, transformed, clientSignal, selected, reqId, attempt, maxAttempts, startTime, clientOptions);
    if (outcome.success && outcome.response) {
      return outcome.response;
    }
    lastError = outcome.error;
    if (clientSignal?.aborted || (lastError instanceof Error && lastError.message.includes("aborted"))) {
      return Response.json(
        { error: { message: "Request aborted by client", type: "client_closed_request" } },
        { status: 499 }
      );
    }
    if (!outcome.retryable) {
      throw lastError;
    }
  }

  logError(reqId, "GCP request attempts exhausted", lastError);
  const errMsg = lastError instanceof Error ? lastError.message : "All GCP request attempts failed";
  const statusCode = lastError instanceof UpstreamRetryableError ? lastError.status : 502;
  logServed(reqId, Date.now() - startTime, statusCode, maxAttempts, maxAttempts);
  logSeparator();
  return Response.json(
    { error: { message: `GCP request attempts exhausted - ${errMsg}`, type: "gateway_error" } },
    { status: statusCode }
  );
}

export async function handleGcpCompat(
  req: Request,
  directiveOrRawKey?: ParsedDirective | string,
  reqIdOrOptions?: string | GcpHandleOptions,
  maybeOptions?: GcpHandleOptions
): Promise<Response> {
  const reqId =
    typeof reqIdOrOptions === "string"
      ? reqIdOrOptions
      : `req_${Math.random().toString(36).slice(2, 9)}`;

  const options = typeof reqIdOrOptions === "object" ? reqIdOrOptions : maybeOptions;

  let directive: ParsedDirective | null = null;
  let rawDirectiveStr = "";

  if (typeof directiveOrRawKey === "string") {
    rawDirectiveStr = directiveOrRawKey;
    const valResult = validateDirective(directiveOrRawKey);
    if (!valResult.valid) {
      return createUnauthorizedResponse(valResult.error);
    }
    directive = valResult.directive;
  } else if (directiveOrRawKey && typeof directiveOrRawKey === "object") {
    directive = directiveOrRawKey;
    rawDirectiveStr = directive.raw || "lr-gc-oa-ch-no";
  } else {
    rawDirectiveStr = extractDirectiveToken(req) || "";
    const valResult = validateDirective(rawDirectiveStr);
    if (!valResult.valid) {
      return createUnauthorizedResponse(valResult.error);
    }
    directive = valResult.directive;
  }

  if (directive.type !== "direct" || directive.provider !== "gc") {
    // If directive is not gc direct, coerce to gc direct directive
    directive = {
      type: "direct",
      raw: rawDirectiveStr,
      provider: "gc",
      payload: directive.type === "direct" ? directive.payload : "oa",
      completion: directive.type === "direct" ? directive.completion : "ch",
      nuances: directive.type === "direct" ? directive.nuances : ["no"],
    };
  }

  let body: OpenAIRequestPayload;
  try {
    body = (await req.json()) as OpenAIRequestPayload;
  } catch (err: unknown) {
    logError(reqId, "Failed to parse JSON body for GCP", err);
    return Response.json(
      { error: { message: "Malformed JSON body", type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  if (typeof body.model === "string") {
    body = { ...body, model: normalizeGcpModel(body.model) };
  }

  // Zero-Cost Billing Guardrail: Provider 'gc' strictly restricted to Gemma models
  if (!isGemmaModel(body.model)) {
    return Response.json(
      {
        error: {
          message: `Billing Guardrail: Provider 'gc' is strictly restricted to free Gemma models to prevent GCP billing overruns. Model requested: ${body.model}`,
          type: "billing_guardrail_violation",
          code: 403,
        },
      },
      { status: 403 }
    );
  }

  if (!options?.skipInboundLog) {
    const path = options?.customPath || new URL(req.url).pathname;
    const clientAgent = req.headers.get("user-agent") || "unknown";
    const endpoint = resolveUpstreamEndpoint("gc", directive.completion || "ch", body.model);
    const poolSize = globalKeyPool.getPoolSize("gc");

    logInbound({
      reqId,
      method: req.method,
      path,
      clientAgent,
      protocol: req.headers.get("x-http-version") || "HTTP/1.1",
      directiveStr: rawDirectiveStr,
      targetProvider: "gc",
      wireFormat: directive.payload,
      endpoint: endpoint?.rawPath,
      model: body.model,
      totalKeys: poolSize,
      nuances: directive.nuances,
    });
  }

  let effectiveBody = body;
  const initialTokens = estimateOpenAITokens(body);
  if (initialTokens > DEFAULT_MAX_CONTEXT_TOKENS) {
    effectiveBody = pruneOpenAIPayload(body, DEFAULT_SAFE_CONTEXT_TOKENS);
    logWarn("✂️", `[PRUNE ${reqId}] Proactively pruned OpenAI messages: ${initialTokens} -> ${estimateOpenAITokens(effectiveBody)} tokens.`);
  }

  const clientOptions: RequestClientOptions = {
    userAgent: req.headers.get("user-agent") || undefined,
    headers: req.headers,
  };

  const env = getEnv();
  const transformed = sanitizeAndTransformPayload(effectiveBody, {
    nuances: directive.nuances,
    targetWire: directive.payload,
    enableScrubbing: env.LITEROUTER_ENABLE_SCRUBBING,
    globalStripReasoning: env.LITEROUTER_STRIP_REASONING,
    aoStripReasoning: env.LITEROUTER_AO_STRIP_REASONING,
  });

  return executeGcpAttemptLoop(directive, transformed, req.signal, reqId, clientOptions);
}
