import {
  LITEROUTER_HTTP_TIMEOUT_MS,
  LITEROUTER_MAX_ATTEMPTS,
  LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS,
  LITEROUTER_NO_RESPONSE_TIMEOUT_MS,
  LITEROUTER_STREAM_IDLE_TIMEOUT_MS,
  cleanHeaders,
  getModelLimits,
  getProviderDelayMs,
  parseResetDelay,
  parseUsageFromJson,
  upstreamSignal,
} from "../config/env";
import { NoResponseError, fetchWithFirstByteTimeout } from "../network/fetcher";
import { StreamMeta, cleanGemmaPayload, cleanLatexSymbols, estimateTokens } from "../transformers/payload";
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

interface GoogleNativeErrorResult {
  action: "return" | "retry_same" | "continue";
  response?: Response;
  delayMs?: number;
}

async function processGoogleNativeError(
  resp: Response,
  activeKey: string,
  upstream_model: string,
  modelName: string,
  reqId?: string,
  currentRpm: number = 0,
  graceTried: boolean = false,
): Promise<GoogleNativeErrorResult> {
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

  const isQuota =
    errText.includes("cooldown") ||
    errText.includes("exhausted quota") ||
    resp.status === 429;

  const errorType = isQuota ? "429" : resp.status.toString();
  await router.reportError("google", activeKey, errorType, upstream_model, reset);

  logState(
    EMOJI.limit,
    `[PROVIDER_LIMIT ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} (${resp.status}) rpm ${currentRpm + 1}/${getModelLimits(modelName, "google").max_rpm}`,
  );

  if (reqId) {
    recordTrace(
      reqId,
      "upstream",
      { status: resp.status, body: errText },
      { model: modelName, provider: "google", status: resp.status },
    );
  }

  return { action: "continue" };
}

async function processGoogleNativeSuccess(
  resp: Response,
  meta: {
    reqId?: string;
    modelName: string;
    upstream_model: string;
    action: string;
    activeKey: string;
    servedModelId?: string;
    requestStart: number;
    attempt: number;
    maxAttempts: number;
    currentRpm: number;
  },
): Promise<Response> {
  const {
    reqId,
    modelName,
    upstream_model,
    action,
    activeKey,
    servedModelId,
    requestStart,
    attempt,
    maxAttempts,
    currentRpm,
  } = meta;

  const outHeaders = cleanHeaders(resp.headers);
  if (servedModelId) outHeaders.set("X-Literouter-Model", servedModelId);

  logState(
    EMOJI.served,
    `[GOOGLE ${reqId}] Served native ${modelName}:${action} (upstream=${upstream_model}, attempt ${attempt + 1}/${maxAttempts}, rpm ${currentRpm + 1}/${getModelLimits(modelName, "google").max_rpm})`,
  );

  if (reqId) {
    recordTrace(
      reqId,
      "upstream",
      { status: resp.status, body: "(stream)" },
      { model: modelName, provider: "google", status: resp.status },
    );
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const streamMeta: StreamMeta = {
    reqId,
    provider: "google",
    modelName,
    upstream_model,
    activeKey,
    servedModelId,
    requestStart,
  };

  let firstChunk = true;
  let capturedUsage: any = null;
  let idleTimer: any = null;
  let keepAliveTimer: any = null;

  const resetIdleTimer = (controller: TransformStreamDefaultController) => {
    if (idleTimer) clearTimeout(idleTimer);
    if (LITEROUTER_STREAM_IDLE_TIMEOUT_MS > 0) {
      idleTimer = setTimeout(() => {
        logWarn(
          EMOJI.amber,
          `[STREAM_IDLE_TIMEOUT ${meta?.reqId || ""}] provider=${meta?.provider || ""} model=${meta?.upstream_model || ""} no chunk received for ${LITEROUTER_STREAM_IDLE_TIMEOUT_MS}ms, closing stream`,
        );
        try {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          controller.terminate();
        } catch {}
      }, LITEROUTER_STREAM_IDLE_TIMEOUT_MS);
    }
  };

  const startKeepAlive = (controller: TransformStreamDefaultController) => {
    if (keepAliveTimer) clearInterval(keepAliveTimer);
    keepAliveTimer = setInterval(() => {
      try {
        controller.enqueue(encoder.encode(":\n\n"));
      } catch {}
    }, 15000);
  };

  const stopKeepAlive = () => {
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
  };

  const transform = new TransformStream({
    start(controller) {
      resetIdleTimer(controller);
      startKeepAlive(controller);
    },
    transform(chunk, controller) {
      resetIdleTimer(controller);
      let text = decoder.decode(chunk, { stream: true });
      text = cleanLatexSymbols(text);

      if (firstChunk) {
        firstChunk = false;
        sinkUsage(streamMeta, null, Date.now() - requestStart);
      }

      const candidates = text.includes("data: ")
        ? text
            .split("\n")
            .filter((l) => l.trim().startsWith("data: "))
            .map((l) => l.trim().substring(6).trim())
        : [text.trim()];

      for (const c of candidates) {
        if (!c || c === "[DONE]") continue;
        try {
          const j = JSON.parse(c);
          const u = parseUsageFromJson(j);
          if (u) capturedUsage = u;
        } catch {}
      }

      controller.enqueue(encoder.encode(text));
    },
    flush() {
      if (idleTimer) clearTimeout(idleTimer);
      stopKeepAlive();
      sinkUsage(streamMeta, capturedUsage);
    },
  });

  return new Response(resp.body!.pipeThrough(transform), {
    status: resp.status,
    headers: outHeaders,
  });
}

export async function executeGoogleNative(
  modelName: string,
  action: string,
  queryParams: URLSearchParams,
  reqJson: any,
  reqHeaders: Headers,
  servedModelId?: string,
  fromFusion?: boolean,
  reqId?: string,
  signal?: AbortSignal,
): Promise<Response> {
  const meta =
    MODEL_REGISTRY.get(modelName) || MODEL_REGISTRY.get(`google/${modelName}`);
  if (!meta) {
    return new Response(
      JSON.stringify({ error: `Model '${modelName}' not recognized.` }),
      { status: 400 },
    );
  }
  if (meta.provider !== "google") {
    return new Response(
      JSON.stringify({ error: `Model '${modelName}' is not a Google model.` }),
      { status: 400 },
    );
  }

  const { upstream_model } = meta;
  if (upstream_model.toLowerCase().includes("gemma")) {
    reqJson = cleanGemmaPayload(reqJson);
  }

  logState(
    EMOJI.inbound,
    `[REQ-NATIVE ${reqId}] model=${modelName} action=${action} provider=google upstream=${upstream_model}`,
  );
  if (reqId) recordTrace(reqId, "downstream", reqJson, { model: modelName, provider: "google" });

  const estimatedTokens = estimateTokens(JSON.stringify(reqJson), 1024);
  const numKeys = API_KEYS.google.length;
  const maxAttempts =
    LITEROUTER_MAX_ATTEMPTS > 0
      ? Math.min(numKeys, LITEROUTER_MAX_ATTEMPTS)
      : numKeys;
  const requestStart = Date.now();

  let reuseKey: string | null = null;
  let graceTried = false;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let activeKey = "";
    let currentRpm = 0;

    try {
      if (reuseKey) {
        activeKey = reuseKey;
        currentRpm = 0;
      } else {
        const keyObj = await router.getAvailableKey(
          "google",
          upstream_model,
          estimatedTokens,
        );
        activeKey = keyObj.key;
        currentRpm = keyObj.currentRpm;
      }
      reuseKey = null;

      const url = new URL(
        `https://generativelanguage.googleapis.com/v1beta/models/${upstream_model}:${action}`,
      );
      queryParams.forEach((v, k) => url.searchParams.append(k, v));
      url.searchParams.set("key", activeKey);

      const headers = cleanHeaders(reqHeaders);
      headers.delete("authorization");

      console.log(
        `[GOOGLE-UPSTREAM] url=${url.toString().replace(activeKey, "REDACTED")}`,
      );
      const resp = await fetchWithFirstByteTimeout(
        url.toString(),
        {
          method: "POST",
          headers,
          body: Object.keys(reqJson).length ? JSON.stringify(reqJson) : undefined,
        },
        {
          noResponseTimeoutMs: LITEROUTER_NO_RESPONSE_TIMEOUT_MS,
          totalTimeoutMs: LITEROUTER_HTTP_TIMEOUT_MS,
          clientSignal: signal,
        },
      );

      if (resp.status >= 400) {
        const errorResult = await processGoogleNativeError(
          resp,
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
              setTimeout(r, getProviderDelayMs("google")),
            );
          }
          continue;
        }
      }

      return await processGoogleNativeSuccess(resp, {
        reqId,
        modelName,
        upstream_model,
        action,
        activeKey,
        servedModelId,
        requestStart,
        attempt,
        maxAttempts,
        currentRpm,
      });
    } catch (e: any) {
      if (signal?.aborted) {
        return new Response(null, { status: 499 });
      }

      if (e instanceof NoResponseError) {
        logWarn(
          EMOJI.amber,
          `[NO_RESPONSE ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} sent nothing within ${LITEROUTER_NO_RESPONSE_TIMEOUT_MS}ms, rotating key (no cooldown)`,
        );
        if (reqId) {
          recordTrace(
            reqId,
            "upstream",
            { status: "no-response", body: "upstream sent no bytes" },
            { model: modelName, provider: "google", status: 0 },
          );
        }
        await new Promise((r) =>
          setTimeout(r, LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS),
        );
        continue;
      }

      if (e.message?.includes("All keys")) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 429,
        });
      }

      if (activeKey) {
        await router.reportError(
          "google",
          activeKey,
          "timeout",
          upstream_model,
        );
      }

      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, getProviderDelayMs("google")));
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

export async function executeGoogleInteractions(
  reqJson: any,
  reqHeaders: Headers,
  reqId?: string,
  signal?: AbortSignal,
): Promise<Response> {
  const agentName =
    reqJson.agent || reqJson.model || "antigravity-preview-05-2026";
  const upstream_model = "antigravity-preview-05-2026";
  const modelName = "google/antigravity-preview-05-2026";

  logState(
    EMOJI.inbound,
    `[REQ-INTERACTIONS ${reqId}] agent=${agentName} provider=google`,
  );
  if (reqId) recordTrace(reqId, "downstream", reqJson, { model: modelName, provider: "google" });

  const estimatedTokens = estimateTokens(JSON.stringify(reqJson), 4096);
  const numKeys = API_KEYS.google.length;
  const maxAttempts =
    LITEROUTER_MAX_ATTEMPTS > 0
      ? Math.min(numKeys, LITEROUTER_MAX_ATTEMPTS)
      : numKeys;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const { key: activeKey } = await router.getAvailableKey(
        "google",
        upstream_model,
        estimatedTokens,
      );

      const url =
        "https://generativelanguage.googleapis.com/v1beta/interactions";
      const headers = cleanHeaders(reqHeaders);
      headers.set("x-goog-api-key", activeKey);
      headers.set("Content-Type", "application/json");
      headers.delete("authorization");

      console.log(
        `[GOOGLE-INTERACTIONS] url=${url} key=${activeKey.substring(0, 6)}...`,
      );
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(reqJson),
        signal: upstreamSignal(signal),
      });

      if (resp.status >= 400) {
        const errText = await resp.text();
        await router.reportError(
          "google",
          activeKey,
          resp.status.toString(),
          upstream_model,
        );
        logState(
          EMOJI.limit,
          `[PROVIDER_LIMIT ${reqId}] key=${activeKey.substring(0, 6)}... model=${upstream_model} (${resp.status})`,
        );
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, getProviderDelayMs("google")));
          continue;
        }
        return new Response(errText, {
          status: resp.status,
          headers: cleanHeaders(resp.headers),
        });
      }

      const outHeaders = cleanHeaders(resp.headers);
      outHeaders.set("X-Literouter-Model", modelName);
      logState(
        EMOJI.served,
        `[GOOGLE ${reqId}] Served interactions agent=${agentName} (attempt ${attempt + 1}/${maxAttempts})`,
      );

      const respText = await resp.text();
      return new Response(respText, {
        status: resp.status,
        headers: outHeaders,
      });
    } catch (e: any) {
      if (e?.name === "AbortError" || signal?.aborted) {
        return new Response("Client Aborted", { status: 499 });
      }
      logWarn(
        EMOJI.limit,
        `[INTERACTIONS-ERROR ${reqId}] attempt=${attempt + 1}: ${e?.message || e}`,
      );
    }
  }

  return new Response(
    JSON.stringify({
      error: "All Google API keys exhausted for interactions",
    }),
    { status: 502 },
  );
}
