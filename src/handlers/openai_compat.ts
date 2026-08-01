import {
  LITEROUTER_COLLAPSE_REASONING,
  LITEROUTER_HTTP_TIMEOUT_MS,
  LITEROUTER_MAX_ATTEMPTS,
  LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS,
  LITEROUTER_NO_RESPONSE_TIMEOUT_MS,
  cleanHeaders,
  getModelLimits,
  getProviderDelayMs,
  parseResetDelay,
  parseUsageFromJson,
} from "../config/env";
import { NoResponseError, fetchWithFirstByteTimeout } from "../network/fetcher";
import {
  StreamMeta,
  cleanGemmaPayload,
  cleanLatexSymbols,
  createStreamTransformer,
  estimateTokens,
  extractThoughtSignature,
  injectThoughtSignature,
  mergeConsecutiveMessages,
  transformNonStreaming,
} from "../transformers/payload";
import { translateGoogleThinking } from "../transformers/thinking";
import {
  API_KEYS,
  EMOJI,
  MODEL_REGISTRY,
  logState,
  logWarn,
  recordTrace,
  router,
  sinkUsage,
} from "../index";

interface OpenAIErrorProcessResult {
  action: "return" | "retry_same" | "continue";
  response?: Response;
  delayMs?: number;
}

async function processOpenAIError(
  resp: Response,
  provider: string,
  activeKey: string,
  upstream_model: string,
  modelName: string,
  reqId?: string,
  currentRpm: number = 0,
  graceTried: boolean = false,
): Promise<OpenAIErrorProcessResult> {
  if (resp.status === 400) {
    const errBody = await resp.text();
    return {
      action: "return",
      response: new Response(errBody, {
        status: 400,
        headers: cleanHeaders(resp.headers),
      }),
    };
  }

  const errText = await resp.text();
  const reset = parseResetDelay(resp.headers, errText);

  if (reset && reset <= 2 && !graceTried && resp.status !== 429) {
    return {
      action: "retry_same",
      delayMs: Math.max(reset, 2) * 1000 + 1500,
    };
  }

  if (resp.status === 502 && !graceTried) {
    return {
      action: "retry_same",
      delayMs: 1500,
    };
  }

  const isQuota =
    errText.includes("cooldown") ||
    errText.includes("exhausted quota") ||
    resp.status === 429;

  const errorType = isQuota ? "429" : resp.status.toString();
  await router.reportError(provider, activeKey, errorType, upstream_model, reset);

  logState(
    EMOJI.limit,
    `[PROVIDER_LIMIT ${reqId}] key=...${activeKey.slice(-6)} model=${upstream_model} (${resp.status}) rpm ${currentRpm + 1}/${getModelLimits(modelName, provider).max_rpm}`,
  );

  if (reqId) {
    recordTrace(
      reqId,
      "upstream",
      { status: resp.status, body: errText },
      { model: modelName, provider, status: resp.status },
    );
  }

  return { action: "continue" };
}

async function processOpenAISuccess(
  resp: Response,
  meta: {
    reqId?: string;
    provider: string;
    modelName: string;
    upstream_model: string;
    activeKey: string;
    servedModelId?: string;
    requestStart: number;
    isStream: boolean;
    attempt: number;
    maxAttempts: number;
    currentRpm: number;
  },
): Promise<Response> {
  const {
    reqId,
    provider,
    modelName,
    upstream_model,
    activeKey,
    servedModelId,
    requestStart,
    isStream,
    attempt,
    maxAttempts,
    currentRpm,
  } = meta;

  const outHeaders = cleanHeaders(resp.headers);
  if (servedModelId) outHeaders.set("X-Literouter-Model", servedModelId);

  logState(
    EMOJI.served,
    `[${provider.toUpperCase()} ${reqId}] Served ${modelName} (upstream=${upstream_model}, key=...${activeKey.slice(-6)}) attempt ${attempt + 1}/${maxAttempts} rpm ${currentRpm + 1}/${getModelLimits(modelName, provider).max_rpm}`,
  );

  if (reqId && isStream) {
    recordTrace(
      reqId,
      "upstream",
      { status: resp.status, body: "(stream)" },
      { model: modelName, provider, status: resp.status },
    );
  }

  const streamMeta: StreamMeta = {
    reqId,
    provider,
    modelName,
    upstream_model,
    activeKey,
    servedModelId,
    requestStart,
  };

  if (isStream) {
    return new Response(
      resp.body!.pipeThrough(
        createStreamTransformer(LITEROUTER_COLLAPSE_REASONING, streamMeta, sinkUsage),
      ),
      {
        status: resp.status,
        headers: outHeaders,
      },
    );
  } else {
    let text = await resp.text();
    text = cleanLatexSymbols(text);
    const data = transformNonStreaming(
      JSON.parse(text),
      LITEROUTER_COLLAPSE_REASONING,
    );
    extractThoughtSignature(data);
    const u = parseUsageFromJson(data);
    if (u) sinkUsage(streamMeta, u);
    if (reqId) {
      recordTrace(
        reqId,
        "upstream",
        { status: resp.status, body: data },
        { model: modelName, provider, status: resp.status },
      );
    }
    return new Response(JSON.stringify(data), {
      status: resp.status,
      headers: outHeaders,
    });
  }
}

export async function executeOpenAICompat(
  modelName: string,
  reqJson: any,
  reqHeaders: Headers,
  servedModelId?: string,
  fromFusion?: boolean,
  reqId?: string,
  signal?: AbortSignal,
): Promise<Response> {
  const meta = MODEL_REGISTRY.get(modelName);
  if (!meta) {
    return new Response(
      JSON.stringify({ error: `Model '${modelName}' not recognized.` }),
      { status: 400 },
    );
  }

  const { provider, upstream_model, api_url } = meta;
  reqJson.model = upstream_model;
  reqJson.messages = mergeConsecutiveMessages(reqJson.messages);
  if (provider === "google") reqJson = translateGoogleThinking(reqJson);
  if (upstream_model.toLowerCase().includes("gemma")) {
    reqJson = cleanGemmaPayload(reqJson);
  }

  logState(
    EMOJI.inbound,
    `[REQ ${reqId}] model=${modelName} provider=${provider} upstream=${upstream_model} stream=${!!reqJson.stream}`,
  );
  if (reqId) recordTrace(reqId, "downstream", reqJson, { model: modelName, provider });

  const isStream = !!reqJson.stream;
  const requestStart = Date.now();
  const estimatedTokens = estimateTokens(
    JSON.stringify(reqJson.messages),
    reqJson.max_tokens || 2048,
  );
  const numKeys = (API_KEYS[provider as keyof typeof API_KEYS] || []).length;
  const maxAttempts =
    LITEROUTER_MAX_ATTEMPTS > 0
      ? Math.min(numKeys, LITEROUTER_MAX_ATTEMPTS)
      : numKeys;

  let reuseKey: string | null = null;
  let graceTried = false;
  let noResponseAttempts = 0;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let activeKey = "";
    let currentRpm = 0;

    try {
      if (reuseKey) {
        activeKey = reuseKey;
        currentRpm = 0;
      } else {
        const keyObj = await router.getAvailableKey(
          provider,
          upstream_model,
          estimatedTokens,
        );
        activeKey = keyObj.key;
        currentRpm = keyObj.currentRpm;
      }
      reuseKey = null;

      const headers = new Headers({
        Authorization: `Bearer ${activeKey}`,
        "Content-Type": "application/json",
      });

      injectThoughtSignature(reqJson);
      if (isStream) {
        reqJson.stream_options = {
          ...(reqJson.stream_options || {}),
          include_usage: true,
        };
      }

      const resp = await fetchWithFirstByteTimeout(
        api_url,
        {
          method: "POST",
          headers,
          body: JSON.stringify(reqJson),
        },
        {
          noResponseTimeoutMs: LITEROUTER_NO_RESPONSE_TIMEOUT_MS,
          totalTimeoutMs: LITEROUTER_HTTP_TIMEOUT_MS,
          clientSignal: signal,
        },
      );

      if (resp.status >= 400) {
        const errorResult = await processOpenAIError(
          resp,
          provider,
          activeKey,
          upstream_model,
          modelName,
          reqId,
          currentRpm,
          graceTried,
        );

        if (errorResult.action === "return") {
          return errorResult.response!;
        } else if (errorResult.action === "retry_same") {
          graceTried = true;
          reuseKey = activeKey;
          await new Promise((r) => setTimeout(r, errorResult.delayMs || 1500));
          continue;
        } else {
          if (attempt < maxAttempts - 1) {
            await new Promise((r) =>
              setTimeout(r, getProviderDelayMs(provider)),
            );
          }
          continue;
        }
      }

      return await processOpenAISuccess(resp, {
        reqId,
        provider,
        modelName,
        upstream_model,
        activeKey,
        servedModelId,
        requestStart,
        isStream,
        attempt,
        maxAttempts,
        currentRpm,
      });
    } catch (e: any) {
      if (signal?.aborted) {
        return new Response(null, { status: 499 });
      }

      if (e instanceof NoResponseError) {
        noResponseAttempts++;
        logWarn(
          EMOJI.retry,
          `[NO_RESPONSE ${reqId}] key=...${activeKey.slice(-6)} model=${upstream_model} upstream idle/ghost detected within ${LITEROUTER_NO_RESPONSE_TIMEOUT_MS}ms, rotating key (no cooldown) [${noResponseAttempts}/${maxAttempts}]`,
        );
        if (reqId) {
          recordTrace(
            reqId,
            "upstream",
            { status: "no-response", body: "upstream sent 0 content tokens" },
            { model: modelName, provider, status: 0 },
          );
        }
        if (noResponseAttempts >= maxAttempts) {
          logState(
            EMOJI.exhausted,
            `[NO_RESPONSE ${reqId}] all ${maxAttempts} keys ghosted, stopping (no cooldown)`,
          );
          break;
        }
        continue;
      }

      if (e.message?.includes("All keys")) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 429,
        });
      }

      if (activeKey) {
        await router.reportError(
          provider,
          activeKey,
          "timeout",
          upstream_model,
        );
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, getProviderDelayMs(provider)));
      }
    }
  }

  logState(
    EMOJI.exhausted,
    `[SYSTEM_LIMIT ${reqId}] Max attempts (${maxAttempts}) reached for ${modelName}, all keys exhausted.`,
  );
  return new Response(
    JSON.stringify({ error: "Failover loop exhausted" }),
    { status: 502 },
  );
}
