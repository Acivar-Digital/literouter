#!/usr/bin/env bun
/**
 * src/server.ts
 *
 * OpenAI-compatible HTTP server for LiteRouter.
 * Exposes /v1/chat/completions and /health endpoints.
 * Uses provider templates for correct thinking/reasoning injection.
 */

import { getConfig } from "./config.js";
import { getNextKey, getRouterStatus, reportError } from "./router.js";
import { getTemplate } from "./templates/index.js";
import { logger } from "./logger.js";

const config = getConfig();
const template = getTemplate(config.template);

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

  // 1. Generic model name alias: "code"
  if (body.model === "code") {
    body.model = config.model;
  } else if (config.model && !body.model) {
    body.model = config.model;
  }

  // 2. Temperature injection (server config overrides client)
  if (config.temperature !== null) {
    body.temperature = config.temperature;
  }

  // 3. Provider template injection (streaming defaults + thinking mode + provider)
  let finalBody = body;
  if (template.transformRequest) {
    finalBody = template.transformRequest(body, {
      mode: config.thinkingMode,
      provider: config.provider,
    });
  } else {
    template.applyTemplateConfig(body, { 
      mode: config.thinkingMode, 
      provider: config.provider 
    });
  }

  console.log(
    `[▶️ Sending] Forwarding to upstream: ` +
    `template=${config.template} | model=${finalBody.model || body.model} | ` +
    `temp=${finalBody.temperature ?? body.temperature ?? "def"} | thinking=${config.thinkingMode ?? "none"}`
  );

  // Pass original body to targetUrlCallback so it can read body.stream for URL selection
  const targetUrl = template.targetUrlCallback 
    ? template.targetUrlCallback(config.baseUrl, body, key)
    : `${config.baseUrl}/chat/completions`;

  const bodyStr = JSON.stringify(finalBody);
  const headers: Record<string, string> = {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };

  // Allow templates to customize headers (e.g. native Gemini uses query param, so remove Auth header)
  if (template.applyHeaders) {
    template.applyHeaders(headers, key);
  }

  const options: RequestInit = {
    method: "POST",
    headers,
    body: bodyStr,
  };

  try {
    const upstream = await fetch(targetUrl, options);

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
      const streamId = `chatcmpl-${Date.now()}`;
      
      const transformer = new TransformStream({
        transform(chunk, controller) {
          const text = new TextDecoder().decode(chunk);
          const lines = text.split("\n");
          let output = "";

          for (const line of lines) {
            if (!line.trim()) continue;

            // Use data line if present, or handle raw lines (native Gemini uses raw JSON in SSE stream)
            const isDataLine = line.startsWith("data: ");
            const rawJson = isDataLine ? line.slice(6) : line;

            if (rawJson.startsWith("[DONE]")) {
              output += "data: [DONE]\n\n";
              continue;
            }

            try {
              let data = JSON.parse(rawJson);
              
              // 1. Template transformation (e.g. Native Gemini -> OpenAI)
              if (template.transformChunk) {
                data = template.transformChunk(data, { model: body.model, id: streamId });
              }

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
        },
        // Gemini's native stream does NOT send [DONE]. We must emit it when the stream closes.
        flush(controller) {
          controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
        },
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
    if (template.transformResponse) {
      data = template.transformResponse(data, { model: body.model, id: `chatcmpl-${Date.now()}` });
    }
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
      template: config.template,
      baseUrl: config.baseUrl || "Not set",
      model: config.model || "Not set",
      port: config.port,
      host: config.host,
      temperature: config.temperature,
      thinkingMode: config.thinkingMode,
      authEnabled: !!config.authKey,
      providers: Object.keys(config.providers),
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
console.log(`[Config] Template: ${config.template}`);
console.log(`[Config] Base URL: ${config.baseUrl}`);
console.log(`[Config] Model: ${config.model} (Alias: code)`);
if (config.temperature !== null) console.log(`[Config] Temp: ${config.temperature}`);
if (config.thinkingMode) console.log(`[Config] Thinking: ${config.thinkingMode}`);
console.log(`[Config] Auth: ${config.authKey ? "Enabled" : "Disabled"}`);
console.log(`[Config] Available templates: ${Object.keys(config.providers).join(", ")}`);
console.log(`\n☁️  Waiting for requests...\n`);

process.on("SIGINT", () => {
  server.stop();
  process.exit(0);
});
