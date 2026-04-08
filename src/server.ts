#!/usr/bin/env bun
/**
 * src/server.ts
 *
 * OpenAI-compatible HTTP server for LiteRouter.
 * Exposes /v1/chat/completions and /health endpoints.
 * Routes to OpenRouter and maps requested models to specific multi-model configurations.
 */

import { getConfig } from "./config.js";
import { getNextKey, getRouterStatus, reportError } from "./router.js";
import { logger } from "./logger.js";

const config = getConfig();

function checkAuth(req: Request): boolean {
  if (!config.authKey) return true;
  const auth = req.headers.get("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  return token === config.authKey;
}

/**
 * Forwards a request to the upstream base URL with a picked key.
 * Handles both streaming and non-streaming responses.
 */
async function handleChat(req: Request): Promise<Response> {
  if (!checkAuth(req)) {
    return Response.json(
      { error: { message: "Invalid API key", type: "invalid_request_error" } },
      { status: 401 }
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch (err) {
    return Response.json(
      { error: { message: "Invalid JSON body", type: "invalid_request_error" } },
      { status: 400 }
    );
  }

  const key = getNextKey();
  if (!key) {
    return Response.json(
      { error: "No available API keys. All keys might be on cooldown or quarantined." },
      { status: 503 }
    );
  }

  // Map requested model to configured model and provider
  const requestedModel = body.model;
  let providerToUse = null;

  if (requestedModel && config.models[requestedModel]) {
    const mapped = config.models[requestedModel];
    body.model = mapped.model;
    if (mapped.provider) {
      providerToUse = mapped.provider;
    }
  }

  // Default to streaming if not specified
  body.stream = body.stream ?? true;
  
  if (providerToUse) {
    body.provider = {
      order: [providerToUse],
    };
  }

  console.log(
    `[▶️ Sending] Forwarding to upstream: ` +
    `model=${body.model} | requested_alias=${requestedModel} | ` +
    `temp=${body.temperature ?? "def"}`
  );

  const targetUrl = `${config.baseUrl}/chat/completions`;

  const bodyStr = JSON.stringify(body);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 seconds

  const options: RequestInit = {
    method: "POST",
    headers,
    body: bodyStr,
    signal: controller.signal,
  };

  try {
    const upstream = await fetch(targetUrl, options);
    clearTimeout(timeoutId);

    if (upstream.status === 429 || upstream.status === 401 || upstream.status === 403) {
      reportError(key, upstream.status);
    }

    if (!upstream.ok) {
      let errMsg = `Upstream ${upstream.status}`;
      try {
        const errText = await upstream.text();
        errMsg = errText;
      } catch { /* ignore */ }
      
      console.log(`[⚠️ Error] Upstream returned ${upstream.status}: ${errMsg.slice(0, 200)}`);
      
      // Always return OpenAI-compatible error format so the client doesn't retry
      return Response.json(
        { error: { message: errMsg, type: "upstream_error", code: upstream.status } },
        { status: upstream.status }
      );
    }

    if (body.stream) {
      // we don't natively transform chunks anymore since it is OpenRouter OpenAI-compatible Native!
      
      const transformer = new TransformStream({
        transform(chunk, controller) {
          const text = new TextDecoder().decode(chunk);
          const lines = text.split("\n");
          let output = "";

          for (const line of lines) {
            if (!line.trim()) continue;

            const isDataLine = line.startsWith("data: ");
            const rawJson = isDataLine ? line.slice(6) : line;

            if (rawJson.startsWith("[DONE]")) {
              output += "data: [DONE]\n\n";
              continue;
            }

            try {
              let data = JSON.parse(rawJson);
              
              // 2. OpenAI spec fixes (like missing index in tool_calls)
              if (data?.choices?.[0]?.delta?.tool_calls) {
                for (let i = 0; i < data.choices[0].delta.tool_calls.length; i++) {
                  if (typeof data.choices[0].delta.tool_calls[i].index === "undefined") {
                    data.choices[0].delta.tool_calls[i].index = i;
                  }
                }
              }

              if (data) {
                output += `data: ${JSON.stringify(data)}\n\n`;
              }
            } catch {
              // Pass through non-JSON lines or malformed parts
            }
          }
          if (output) {
            controller.enqueue(new TextEncoder().encode(output));
          }
        }
      });

      return new Response(upstream.body?.pipeThrough(transformer), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    let data = await upstream.json();
    return Response.json(data);
  } catch (err) {
    logger.error(`Error fetching from ${targetUrl}`, err);
    return Response.json(
      { error: { message: "Upstream error or network issue.", type: "upstream_error" } },
      { status: 502 }
    );
  }
}

/**
 * Status endpoint showing router state.
 */
function handleHealth(): Response {
  return Response.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    config: {
      baseUrl: config.baseUrl || "Not set",
      port: config.port,
      host: config.host,
      authEnabled: !!config.authKey,
      models: Object.keys(config.models),
    },
    router: getRouterStatus(),
  });
}

const server = Bun.serve({
  port: config.port,
  hostname: config.host,
  async fetch(req) {
    const url = new URL(req.url);

    if (req.method === "POST" && url.pathname === "/v1/chat/completions") {
      return handleChat(req);
    }

    if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
      return handleHealth();
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
});

console.log(`\n🚀 LiteRouter is listening on http://${config.host}:${config.port}`);
console.log(`[Config] Base URL: ${config.baseUrl}`);
console.log(`[Config] Models Loaded: ${Object.keys(config.models).join(", ")}`);
console.log(`[Config] Auth: ${config.authKey ? "Enabled" : "Disabled"}`);
console.log(`\n☁️  Waiting for requests...\n`);

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
