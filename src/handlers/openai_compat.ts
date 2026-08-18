import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadKeyPools } from "../config/keys";
import type { DirectDirective, ParsedDirective } from "../directive/parser";
import { parseDirective } from "../directive/parser";
import { createUnauthorizedResponse, validateDirective } from "../directive/validator";
import { FusionEngine } from "../fusion/engine";
import { classifyUpstreamError, type ErrorDisposition } from "../network/classifier";
import { CooldownManager } from "../network/cooldown";
import {
  createResilientStream,
  fetchWithTtftGuard,
  type FetcherOptions,
  NoResponseError,
  sanitizeDownstreamHeaders,
} from "../network/fetcher";
import { KeyPool, type SelectedKey } from "../network/pool";
import { sanitizeAndTransformPayload } from "../transformers/payload";
import type { OpenAIRequestPayload } from "../transformers/nuances";
import { createDotsStreamTransformer, parseDotsXml } from "../transformers/dots";
import type { FusionConfig, FusionTier } from "../config/schema";
import {
  logError,
  logInbound,
  logLimit,
  logRotate,
  logSeparator,
  logServed,
  logTtft,
  logUsage,
  type UsageLogDetails,
} from "../ui/logger";

interface ProviderEndpointConfig {
  readonly code: string;
  readonly base_url: string;
  readonly auth_header?: "Bearer" | "x-api-key";
  readonly endpoints: Record<string, string>;
}

interface ProvidersRegistry {
  readonly providers: Record<string, ProviderEndpointConfig>;
}

let cachedRegistry: ProvidersRegistry | null = null;

function getProvidersRegistry(): ProvidersRegistry {
  if (cachedRegistry !== null) {
    return cachedRegistry;
  }
  const filePath = resolve(process.cwd(), "config", "providers.json");
  if (!existsSync(filePath)) {
    return { providers: {} };
  }
  try {
    cachedRegistry = JSON.parse(readFileSync(filePath, "utf-8")) as ProvidersRegistry;
    return cachedRegistry;
  } catch {
    return { providers: {} };
  }
}

export function overrideProviderUrl(url: string, providerCode: string): string {
  const mockPort = process.env[`MOCK_${providerCode.toUpperCase()}_PORT`];
  if (!mockPort) {
    return url;
  }
  try {
    const parsed = new URL(url);
    parsed.protocol = "http:";
    parsed.host = `localhost:${mockPort}`;
    return parsed.toString();
  } catch {
    return url;
  }
}

export function resolveUpstreamEndpoint(
  providerCode: string,
  completionCode: string,
  model: string
): { url: string; authHeader: "Bearer" | "x-api-key"; rawPath: string } {
  const reg = getProvidersRegistry();
  for (const p of Object.values(reg.providers)) {
    if (p.code === providerCode && p.endpoints[completionCode]) {
      const rawPath = p.endpoints[completionCode] as string;
      const formatted = rawPath.replace("{model}", model);
      const originalUrl = `${p.base_url}${formatted}`;
      return {
        url: overrideProviderUrl(originalUrl, providerCode),
        authHeader: p.auth_header ?? "Bearer",
        rawPath: formatted,
      };
    }
  }
  return {
    url: overrideProviderUrl("https://openrouter.ai/api/v1/chat/completions", providerCode),
    authHeader: "Bearer",
    rawPath: "/api/v1/chat/completions",
  };
}

function buildAuthHeaders(
  authHeader: "Bearer" | "x-api-key",
  key: string,
  provider?: string
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Accept-Encoding": "identity",
  };
  if (authHeader === "x-api-key") {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = "2023-06-01";
  } else {
    headers["Authorization"] = `Bearer ${key}`;
  }
  if (provider === "gg") {
    headers["x-goog-api-key"] = key;
  }
  return headers;
}

export const globalCooldownManager = new CooldownManager();
export const globalKeyPool = new KeyPool(globalCooldownManager);

export function initializeKeyPools(envSource: Record<string, string | undefined> = process.env): void {
  const pools = loadKeyPools(envSource);
  for (const [code, keys] of pools.entries()) {
    if (keys.length > 0) {
      globalKeyPool.setPool(code, keys);
    } else {
      globalKeyPool.setPool(code, [`sk-stub-${code}-mock-key-1`, `sk-stub-${code}-mock-key-2`]);
    }
  }
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

export class UpstreamRetryableError extends Error {
  public readonly status: number;
  public readonly classification: ErrorDisposition;

  public constructor(message: string, status: number, classification: ErrorDisposition) {
    super(message);
    this.name = "UpstreamRetryableError";
    this.status = status;
    this.classification = classification;
  }
}

export function parseRetryAfterHeader(headers: Headers): number | undefined {
  const ra = headers.get("retry-after");
  if (!ra) {
    return undefined;
  }
  const parsed = Number.parseInt(ra, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

async function executeDirectCall(
  directive: DirectDirective,
  payload: OpenAIRequestPayload,
  clientSignal: AbortSignal | undefined,
  selected: SelectedKey,
  reqId: string,
  attempt: number,
  maxAttempts: number
): Promise<Response> {
  const endpoint = resolveUpstreamEndpoint(directive.provider, directive.completion, payload.model);
  const headers = buildAuthHeaders(endpoint.authHeader, selected.key, directive.provider);
  const fetchOpts: FetcherOptions = {
    url: endpoint.url,
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    clientSignal,
    provider: directive.provider,
    keyIndex: selected.index,
  };

  const startTime = Date.now();
  const { response, ttftMs, firstChunk, rawReader } = await fetchWithTtftGuard(fetchOpts);
  const duration = Date.now() - startTime;

  const isStream = Boolean(payload.stream);

  if (response.status >= 400) {
    const fullBody = await collectFullBody(firstChunk, rawReader);
    const bodyText = new TextDecoder().decode(fullBody);
    const classification = classifyUpstreamError({
      provider: directive.provider,
      status: response.status,
      headers: response.headers,
      bodyText,
    });

    if (classification.quarantineTtlSec > 0) {
      globalKeyPool.reportFailure(
        directive.provider,
        selected.index,
        response.status,
        response.headers,
        bodyText,
        Date.now(),
        classification.quarantineTtlSec
      );
    }

    if (response.status === 429 || classification.quarantineTtlSec > 0) {
      const ttlSec = classification.quarantineTtlSec > 0 ? classification.quarantineTtlSec : 60;
      logLimit(reqId, directive.provider, selected.index, response.status, ttlSec, selected.totalKeys);
    }

    const canRetry = classification.action === "retry_rotate" && attempt < maxAttempts && !clientSignal?.aborted;
    if (canRetry) {
      throw new UpstreamRetryableError(
        `Upstream error ${response.status}: ${classification.reason}`,
        response.status,
        classification
      );
    }

    logServed(reqId, duration, response.status, attempt, maxAttempts);
    logSeparator();

    return new Response(fullBody.buffer as ArrayBuffer, {
      status: response.status,
      headers: sanitizeDownstreamHeaders(response.headers, fullBody.byteLength),
    });
  }

  globalKeyPool.reportSuccess(directive.provider, selected.index);
  logTtft(reqId, ttftMs, isStream ? "Stream established" : "First chunk streamed downstream");

  if (!isStream) {
    const fullBody = await collectFullBody(firstChunk, rawReader);
    let finalBody: Uint8Array = fullBody;
    try {
      const decoded = new TextDecoder().decode(fullBody);
      const json = JSON.parse(decoded) as Record<string, unknown>;

      if (directive.nuances.includes("tc") || payload.model.toLowerCase().includes("dots")) {
        const choice = (json.choices as Array<{ message?: { content?: string | null; tool_calls?: unknown }; finish_reason?: string }>)?.[0];
        if (choice?.message?.content && typeof choice.message.content === "string") {
          const { cleanText, toolCalls } = parseDotsXml(choice.message.content);
          if (toolCalls.length > 0) {
            choice.message.content = cleanText || null;
            choice.message.tool_calls = toolCalls;
            choice.finish_reason = "tool_calls";
            finalBody = new TextEncoder().encode(JSON.stringify(json));
          }
        }
      }

      if (json.usage && typeof json.usage === "object") {
        const u = json.usage as Record<string, unknown>;
        const promptTokens = typeof u.prompt_tokens === "number" ? u.prompt_tokens : 0;
        const completionTokens = typeof u.completion_tokens === "number" ? u.completion_tokens : 0;
        const totalTokens = typeof u.total_tokens === "number" ? u.total_tokens : promptTokens + completionTokens;
        let reasoningTokens: number | undefined;
        if (u.completion_tokens_details && typeof u.completion_tokens_details === "object") {
          const details = u.completion_tokens_details as Record<string, unknown>;
          if (typeof details.reasoning_tokens === "number") {
            reasoningTokens = details.reasoning_tokens;
          }
        }
        logUsage({
          reqId,
          provider: directive.provider,
          keyIndex: selected.index,
          totalKeys: selected.totalKeys,
          promptTokens,
          reasoningTokens,
          completionTokens,
          totalTokens,
          durationMs: duration,
        });
      }
    } catch (parseErr) {
      void parseErr;
    }

    logServed(reqId, duration, response.status, attempt, maxAttempts);
    logSeparator();

    return new Response(finalBody.buffer as ArrayBuffer, {
      status: response.status,
      headers: sanitizeDownstreamHeaders(response.headers, finalBody.byteLength),
    });
  }

  let currentKeyIndex = selected.index;
  let currentAttempt = attempt;

  let resilientStream = createResilientStream(firstChunk, rawReader, {
    onUsage: (u) => {
      const streamDuration = Date.now() - startTime;
      logUsage({
        reqId,
        provider: directive.provider,
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
    retryProvider: async (reason: string) => {
      globalKeyPool.reportFailure(directive.provider, currentKeyIndex, 500, undefined, reason, Date.now(), 60);
      logLimit(reqId, directive.provider, currentKeyIndex, 500, 60, selected.totalKeys);

      while (currentAttempt < maxAttempts) {
        currentAttempt++;
        if (clientSignal?.aborted) {
          return null;
        }
        const nextSelected = globalKeyPool.selectNextKey(directive.provider);
        if (!nextSelected) {
          return null;
        }
        logRotate(reqId, directive.provider, currentKeyIndex, nextSelected.index, nextSelected.totalKeys, currentAttempt, maxAttempts);
        currentKeyIndex = nextSelected.index;

        const nextHeaders = buildAuthHeaders(endpoint.authHeader, nextSelected.key, directive.provider);
        const nextFetchOpts: FetcherOptions = {
          url: endpoint.url,
          method: "POST",
          headers: nextHeaders,
          body: JSON.stringify(payload),
          clientSignal,
          provider: directive.provider,
          keyIndex: nextSelected.index,
        };

        try {
          const nextResult = await fetchWithTtftGuard(nextFetchOpts);
          if (nextResult.response.status >= 400) {
            globalKeyPool.reportFailure(directive.provider, nextSelected.index, nextResult.response.status);
            continue;
          }
          globalKeyPool.reportSuccess(directive.provider, nextSelected.index);
          return {
            firstChunk: nextResult.firstChunk,
            rawReader: nextResult.rawReader,
            reader: nextResult.rawReader,
          };
        } catch (fetchErr: unknown) {
          void fetchErr;
          globalKeyPool.reportFailure(directive.provider, nextSelected.index, 500);
          continue;
        }
      }
      return null;
    },
  });

  if (directive.nuances.includes("tc") || payload.model.toLowerCase().includes("dots")) {
    resilientStream = resilientStream.pipeThrough(createDotsStreamTransformer());
  }

  return new Response(resilientStream, {
    status: response.status,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

interface AttemptExecutionResult {
  readonly success: boolean;
  readonly response?: Response;
  readonly error?: unknown;
  readonly retryable: boolean;
}

async function tryDirectAttempt(
  directive: DirectDirective,
  transformed: OpenAIRequestPayload,
  clientSignal: AbortSignal | undefined,
  selected: SelectedKey,
  reqId: string,
  attempt: number,
  maxAttempts: number
): Promise<AttemptExecutionResult> {
  try {
    const res = await executeDirectCall(directive, transformed, clientSignal, selected, reqId, attempt, maxAttempts);
    return { success: true, response: res, retryable: false };
  } catch (err: unknown) {
    if (clientSignal?.aborted) {
      return { success: false, error: err, retryable: false };
    }
    if (err instanceof UpstreamRetryableError) {
      return { success: false, error: err, retryable: true };
    }
    if (err instanceof NoResponseError) {
      globalKeyPool.reportFailure(directive.provider, selected.index, 429);
      logLimit(reqId, directive.provider, selected.index, 429, 60, selected.totalKeys);
      return { success: false, error: err, retryable: true };
    }
    logError(reqId, "Direct request error", err);
    return { success: false, error: err, retryable: false };
  }
}

async function executeSingleAttemptLoop(
  directive: DirectDirective,
  transformed: OpenAIRequestPayload,
  clientSignal: AbortSignal | undefined,
  reqId: string
): Promise<Response> {
  const poolSize = globalKeyPool.getPoolSize(directive.provider);
  const maxAttempts = Math.min(3, Math.max(1, poolSize));
  let lastError: unknown = null;
  let prevKeyIndex = -1;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const selected = globalKeyPool.selectNextKey(directive.provider);
    if (!selected) {
      logLimit(reqId, directive.provider, 0, 429, 60, poolSize);
      return Response.json(
        { error: { message: `All API keys for provider '${directive.provider}' are cooling down.`, type: "insufficient_quota" } },
        { status: 429 }
      );
    }

    if (attempt > 0) {
      logRotate(reqId, directive.provider, prevKeyIndex, selected.index, selected.totalKeys, attempt + 1, maxAttempts);
    }
    prevKeyIndex = selected.index;

    const outcome = await tryDirectAttempt(directive, transformed, clientSignal, selected, reqId, attempt + 1, maxAttempts);
    if (outcome.response) {
      return outcome.response;
    }
    lastError = outcome.error;
    if (!outcome.retryable) {
      throw lastError;
    }
  }
  logError(reqId, "Direct request attempts exhausted", lastError);
  const errMsg = lastError instanceof Error ? lastError.message : "All direct request attempts failed";
  const statusCode = lastError instanceof UpstreamRetryableError ? lastError.status : 502;
  return Response.json(
    { error: { message: `Direct request attempts exhausted - ${errMsg}`, type: "gateway_error" } },
    { status: statusCode }
  );
}

export async function executeDirectRequest(
  directive: DirectDirective,
  body: OpenAIRequestPayload,
  clientSignal: AbortSignal | undefined,
  reqId: string
): Promise<Response> {
  const transformed = sanitizeAndTransformPayload(body, {
    nuances: directive.nuances,
    targetWire: directive.payload,
  });
  return executeSingleAttemptLoop(directive, transformed, clientSignal, reqId);
}

function loadFusionConfig(): FusionConfig {
  const p = resolve(process.cwd(), "config", "fusion.json");
  if (!existsSync(p)) {
    return { version: "3.1", presets: {} };
  }
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as FusionConfig;
  } catch {
    return { version: "3.1", presets: {} };
  }
}

async function tryExecuteTier(
  tier: FusionTier,
  body: OpenAIRequestPayload,
  clientSignal: AbortSignal | undefined,
  reqId: string
): Promise<Response | null> {
  const tierDirective = parseDirective(tier.apikey);
  if (!tierDirective || tierDirective.type !== "direct") {
    return null;
  }
  const tierBody: OpenAIRequestPayload = { ...body, model: tier.model };
  try {
    const res = await executeDirectRequest(tierDirective, tierBody, clientSignal, reqId);
    return res.status < 400 ? res : null;
  } catch {
    return null;
  }
}

export async function executeFusionFlow(
  presetName: string,
  body: OpenAIRequestPayload,
  clientSignal: AbortSignal | undefined,
  reqId: string
): Promise<Response> {
  const fusionCfg = loadFusionConfig();
  const engine = new FusionEngine(fusionCfg);
  const plan = engine.createExecutionPlan(presetName, body.model);

  if (!plan || plan.orderedTiers.length === 0) {
    return Response.json(
      { error: { message: `No fusion configuration found for model '${body.model}' in preset '${presetName}'.`, type: "invalid_request_error" } },
      { status: 404 }
    );
  }

  for (const tier of plan.orderedTiers) {
    const res = await tryExecuteTier(tier, body, clientSignal, reqId);
    if (res !== null) {
      engine.handleTierSuccess(presetName, body.model, tier);
      return res;
    }
    engine.handleTierFailure(presetName, body.model, tier);
  }

  return Response.json(
    { error: { message: `All fallback tiers exhausted for model '${body.model}'.`, type: "service_unavailable" } },
    { status: 503 }
  );
}

export interface HandleOptions {
  readonly customPath?: string;
  readonly skipInboundLog?: boolean;
}

export async function handleOpenAICompat(
  req: Request,
  rawKey: string,
  reqId: string,
  options?: HandleOptions
): Promise<Response> {
  const validation = validateDirective(rawKey);
  if (validation.valid === false) {
    return createUnauthorizedResponse(validation.error);
  }

  const directive = validation.directive;

  let body: OpenAIRequestPayload;
  try {
    body = (await req.json()) as OpenAIRequestPayload;
  } catch (err: unknown) {
    logError(reqId, "Failed to parse JSON body", err);
    return Response.json({ error: { message: "Malformed JSON body", type: "invalid_request_error" } }, { status: 400 });
  }

  if (!options?.skipInboundLog) {
    const path = options?.customPath || new URL(req.url).pathname;
    const clientAgent = req.headers.get("user-agent") || "unknown";
    const endpoint = directive.type === "direct"
      ? resolveUpstreamEndpoint(directive.provider, directive.completion, body.model)
      : undefined;
    const poolSize = directive.type === "direct" ? globalKeyPool.getPoolSize(directive.provider) : 1;

    logInbound({
      reqId,
      method: req.method,
      path,
      clientAgent,
      directiveStr: rawKey,
      targetProvider: directive.type === "direct" ? directive.provider : directive.preset,
      wireFormat: directive.type === "direct" ? directive.payload : "oa",
      endpoint: endpoint?.rawPath,
      model: body.model,
      keyIndex: 0,
      totalKeys: poolSize,
      nuances: directive.type === "direct" ? directive.nuances : undefined,
    });
  }

  if (directive.type === "fusion") {
    return executeFusionFlow(directive.preset, body, req.signal, reqId);
  }

  return executeDirectRequest(directive, body, req.signal, reqId);
}
