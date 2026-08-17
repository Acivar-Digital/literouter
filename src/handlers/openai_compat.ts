import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadKeyPools } from "../config/keys";
import type { DirectDirective, ParsedDirective } from "../directive/parser";
import { parseDirective } from "../directive/parser";
import { createUnauthorizedResponse, validateDirective } from "../directive/validator";
import { FusionEngine } from "../fusion/engine";
import { CooldownManager } from "../network/cooldown";
import { createResilientStream, fetchWithTtftGuard, type FetcherOptions, NoResponseError } from "../network/fetcher";
import { KeyPool, type SelectedKey } from "../network/pool";
import { sanitizeAndTransformPayload } from "../transformers/payload";
import type { OpenAIRequestPayload } from "../transformers/nuances";
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
  logTtft(reqId, ttftMs, isStream ? "Stream established" : "First chunk streamed downstream");

  if (response.status < 400) {
    globalKeyPool.reportSuccess(directive.provider, selected.index);
  } else if (response.status === 429) {
    const retrySec = parseRetryAfterHeader(response.headers) ?? 60;
    globalKeyPool.reportFailure(directive.provider, selected.index, 429, response.headers);
    logLimit(reqId, directive.provider, selected.index, 429, retrySec, selected.totalKeys);
  }

  if (!isStream) {
    const fullBody = await collectFullBody(firstChunk, rawReader);
    try {
      const decoded = new TextDecoder().decode(fullBody);
      const json = JSON.parse(decoded) as Record<string, unknown>;
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
    } catch {
      // Body is not json
    }

    logServed(reqId, duration, response.status, attempt, maxAttempts);
    logSeparator();

    return new Response(fullBody.buffer as ArrayBuffer, {
      status: response.status,
      headers: response.headers,
    });
  }

  const resilientStream = createResilientStream(firstChunk, rawReader, {
    onUsage: (u) => {
      const streamDuration = Date.now() - startTime;
      logUsage({
        reqId,
        provider: directive.provider,
        keyIndex: selected.index,
        totalKeys: selected.totalKeys,
        promptTokens: u.promptTokens,
        reasoningTokens: u.reasoningTokens,
        completionTokens: u.completionTokens,
        totalTokens: u.totalTokens,
        durationMs: streamDuration,
      });
      logServed(reqId, streamDuration, response.status, attempt, maxAttempts);
      logSeparator();
    },
  });

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
  throw lastError;
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
