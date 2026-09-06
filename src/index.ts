import { existsSync, readFileSync } from "node:fs";
import http2 from "node:http2";
import { resolve } from "node:path";
import type { Server } from "bun";
import { getEnv } from "./config/env";
import { loadKeyPools } from "./config/keys";
import { parseDirective } from "./directive/parser";
import { extractDirectiveToken } from "./directive/validator";
import { handleAnthropicCompat, handleAnthropicCountTokens } from "./handlers/anthropic_compat";
import { handleModelsDiscovery } from "./handlers/discovery";
import { handleGcpCompat } from "./handlers/gcp_compat";
import {
  handleGoogleInteractionsPassthrough,
  handleGoogleNative,
  handleGoogleOpenAIBeta,
} from "./handlers/google_native";
import {
  globalCooldownManager,
  globalKeyPool,
  handleOpenAICompat,
  initializeKeyPools,
  resetProvidersRegistryCache,
} from "./handlers/openai_compat";
import { getHttp2Pool, resetHttp2Pool } from "./network/h2_pool";
import { getAllCircuitBreakers, clearCircuitBreakerRegistry } from "./network/circuit_breaker";
import {
  clearPacerRegistry,
  getPacerForProvider,
  PacerQueueOverflowError,
} from "./network/pacer";
import { type BannerOptions, printBanner } from "./ui/banner";
import { logAmber, logError } from "./ui/logger";

function loadTlsOptions(tlsEnabledFlag?: boolean): { cert: string; key: string } | undefined {
  if (process.env.LITEROUTER_TLS_ENABLED === "false" || tlsEnabledFlag === false) {
    return undefined;
  }
  const certPath = resolve(process.cwd(), "certs", "localhost.pem");
  const keyPath = resolve(process.cwd(), "certs", "localhost-key.pem");

  if (existsSync(certPath) && existsSync(keyPath)) {
    try {
      const cert = readFileSync(certPath, "utf-8");
      const key = readFileSync(keyPath, "utf-8");
      return { cert, key };
    } catch (err) {
      logError("BOOT", "Failed to read TLS certificates", err);
      return undefined;
    }
  }
  return undefined;
}

function handleHardReset(): Response {
  globalCooldownManager.clearAll();
  globalKeyPool.reset();
  initializeKeyPools();
  clearCircuitBreakerRegistry();
  clearPacerRegistry();
  resetHttp2Pool();
  resetProvidersRegistryCache();
  return Response.json(
    {
      status: "ok",
      message: "Hard reset successful. Cooldowns, circuit breakers, pacers, and H2 pools reloaded.",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}

async function handleAdminPoolReset(req: Request, rawKey: string): Promise<Response> {
  const token = rawKey || extractDirectiveToken(req) || "";
  const authKey = getEnv().LITEROUTER_AUTH_KEY;
  const isValid = (authKey && token === authKey) || parseDirective(token) !== null;

  if (!isValid) {
    return Response.json(
      { error: { message: "Unauthorized admin access", type: "authentication_error" } },
      { status: 401 }
    );
  }

  const url = new URL(req.url);
  let provider = url.searchParams.get("provider")?.toLowerCase().trim();

  if (!provider && (req.method === "POST" || req.method === "PUT")) {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      try {
        const body = (await req.json()) as { provider?: unknown };
        if (typeof body?.provider === "string") {
          provider = body.provider.toLowerCase().trim();
        }
      } catch (err: unknown) {
        logAmber("ADMIN", `Failed to parse body JSON for pool reset: ${String(err)}`);
      }
    }
  }

  if (provider) {
    globalKeyPool.reset(provider);
    return Response.json(
      {
        status: "ok",
        message: `Reset pool for provider '${provider}'. Cooldowns and timers cleared.`,
        provider,
        timestamp: new Date().toISOString(),
      },
      { status: 200 }
    );
  }

  return handleHardReset();
}

function handleHealthCheck(): Response {
  const circuitStats: Record<string, unknown> = {};
  for (const [provider, breaker] of getAllCircuitBreakers().entries()) {
    circuitStats[provider] = breaker.getStats();
  }

  const h2Stats = getHttp2Pool().getSessionStats();

  return Response.json(
    {
      status: "healthy",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      h2_outbound: h2Stats,
      circuit_breakers: circuitStats,
    },
    { status: 200 }
  );
}

type RouteHandler = (req: Request, rawKey: string, reqId: string) => Promise<Response>;

const ROUTE_MAP: Readonly<Record<string, RouteHandler>> = {
  "/v1/chat/completions": handleOpenAICompat,
  "/v1/responses": handleOpenAICompat,
  "/v1/messages": handleAnthropicCompat,
  "/messages": handleAnthropicCompat,
  "/api/v1/messages": handleAnthropicCompat,
  "/v1/messages/count_tokens": handleAnthropicCountTokens,
  "/messages/count_tokens": handleAnthropicCountTokens,
  "/api/v1/messages/count_tokens": handleAnthropicCountTokens,
};

const SYSTEM_MAP: Readonly<Record<string, () => Response>> = {
  "/health": handleHealthCheck,
  "/reset": handleHardReset,
  "/api/hello": handleHealthCheck,
  "/hello": handleHealthCheck,
};

function dispatchModelsRoute(path: string, req: Request, rawKey: string): Promise<Response> | null {
  if (path === "/v1/models" || path === "/v1beta/models") {
    if (!rawKey) {
      return Promise.resolve(
        Response.json(
          {
            error: {
              message: "Missing API key directive. Directives format: lr-<prov>-<payload>-<compl>-<nuances>",
              type: "invalid_request_error",
              code: "invalid_api_key",
            },
          },
          { status: 401 }
        )
      );
    }
    const directive = parseDirective(rawKey);
    if (!directive) {
      return Promise.resolve(
        Response.json(
          {
            error: {
              message: `Invalid API key directive '${rawKey}'. Must follow lr-<provider>-<payload>-<completions>-<nuance>`,
              type: "invalid_request_error",
              code: "invalid_api_key",
            },
          },
          { status: 401 }
        )
      );
    }
    return handleModelsDiscovery(req, directive);
  }
  return null;
}

function dispatchGoogleBeta(path: string, req: Request, rawKey: string, reqId: string): Promise<Response> | null {
  if (path.startsWith("/v1beta/interactions") || path.startsWith("/v1beta/files/")) {
    return handleGoogleInteractionsPassthrough(req, rawKey, reqId);
  }
  if (path.startsWith("/v1beta/openai/")) {
    return handleGoogleOpenAIBeta(req, rawKey, reqId);
  }
  if (path.startsWith("/v1beta/models/")) {
    return handleGoogleNative(req, rawKey, reqId);
  }
  return null;
}

const ingressPacedRequests = new WeakSet<Request>();

async function acquireIngressPacer(req: Request, rawKey: string): Promise<Response | null> {
  if (ingressPacedRequests.has(req)) {
    return null;
  }
  const parsed = parseDirective(rawKey);
  const provider = parsed?.type === "direct" ? parsed.provider : null;
  // Skip "gc" here because S1 already paces gc ingress in handler to avoid double-pacing (2000ms x2)
  // For future unification, gc edge will replace handler ingress — for now keep gc handler-paced
  if (
    provider === null ||
    (provider !== "or" && provider !== "nv" && provider !== "zn" && provider !== "gg") ||
    !getEnv().LITEROUTER_PACER_ENABLED
  ) {
    return null;
  }
  try {
    await getPacerForProvider(provider, 0).acquire(req.signal);
    ingressPacedRequests.add(req);
    return null;
  } catch (err: unknown) {
    if (req.signal?.aborted || (err instanceof Error && err.message.includes("aborted"))) {
      return Response.json(
        { error: { message: "Request aborted by client", type: "client_closed_request" } },
        { status: 499 }
      );
    }
    if (err instanceof PacerQueueOverflowError) {
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
}

async function dispatchRoute(req: Request, rawKey: string, reqId: string): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/admin/pool/reset") {
    return handleAdminPoolReset(req, rawKey);
  }

  const sysHandler = SYSTEM_MAP[path];
  if (sysHandler) {
    return sysHandler();
  }

  const modelsRes = dispatchModelsRoute(path, req, rawKey);
  if (modelsRes !== null) {
    return modelsRes;
  }

  const pacerGate = await acquireIngressPacer(req, rawKey);
  if (pacerGate !== null) {
    return pacerGate;
  }

  const isGcpDirective = rawKey.startsWith("lr-gc-") || (() => {
    const parsed = parseDirective(rawKey);
    return parsed !== null && parsed.type === "direct" && parsed.provider === "gc";
  })();

  if (isGcpDirective && (path === "/v1/chat/completions" || path.startsWith("/v1beta/openai/"))) {
    return handleGcpCompat(req, rawKey, reqId);
  }

  const directHandler = ROUTE_MAP[path];
  if (directHandler) {
    return directHandler(req, rawKey, reqId);
  }

  const betaRes = dispatchGoogleBeta(path, req, rawKey, reqId);
  if (betaRes !== null) {
    return betaRes;
  }

  logAmber(reqId, `404 Route Not Found: ${req.method} ${path} from ${req.headers.get("user-agent") || "unknown"}`);
  return Response.json({ error: { message: `Not Found: ${path}`, type: "invalid_request_error" } }, { status: 404 });
}

export function resetAllState(): void {
  globalCooldownManager.clearAll();
  globalKeyPool.reset();
  initializeKeyPools();
  clearCircuitBreakerRegistry();
  clearPacerRegistry();
  resetHttp2Pool();
  resetProvidersRegistryCache();
}

export function getCooldownState(): Record<string, unknown> {
  return {};
}

export async function handleAppRequest(req: Request): Promise<Response> {
  initializeKeyPools();
  const reqId = `req_${Math.random().toString(36).slice(2, 9)}`;
  const rawKey = extractDirectiveToken(req) || "";
  const pacerGate = await acquireIngressPacer(req, rawKey);
  if (pacerGate !== null) {
    return pacerGate;
  }
  try {
    return await dispatchRoute(req, rawKey, reqId);
  } catch (err) {
    logError(reqId, "Unhandled exception in request handler", err);
    return Response.json({ error: { message: "Internal Gateway Error", type: "server_error" } }, { status: 500 });
  }
}

function nodeHeadersToFetchHeaders(rawHeaders: NodeJS.Dict<string | string[]>): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(rawHeaders)) {
    if (!key || key.startsWith(":") || value === undefined) {
      continue;
    }
    if (Array.isArray(value)) {
      for (const v of value) {
        headers.append(key, v);
      }
    } else {
      headers.set(key, value);
    }
  }
  return headers;
}

async function pipeWebResponseToNode(
  webRes: Response,
  _nodeReq: http2.Http2ServerRequest,
  nodeRes: http2.Http2ServerResponse
): Promise<void> {
  if (nodeRes.destroyed || nodeRes.writableEnded) {
    return;
  }

  nodeRes.statusCode = webRes.status;
  webRes.headers.forEach((val, key) => {
    const lower = key.toLowerCase();
    if (lower !== "transfer-encoding" && lower !== "connection") {
      nodeRes.setHeader(key, val);
    }
  });

  if (!webRes.body) {
    if (!nodeRes.writableEnded && !nodeRes.destroyed) {
      nodeRes.end();
    }
    return;
  }

  const reader = webRes.body.getReader();
  let isAborted = false;

  const cancelReader = () => {
    if (isAborted) return;
    isAborted = true;
    reader.cancel().catch((cancelErr: unknown) => {
      console.debug("[H2 Server] Reader cancel error:", cancelErr);
    });
  };

  const onResClose = () => {
    if (!nodeRes.writableEnded) {
      cancelReader();
    }
  };

  nodeRes.once("close", onResClose);

  try {
    while (!isAborted && !nodeRes.destroyed && !nodeRes.writableEnded) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value && !nodeRes.destroyed && !nodeRes.writableEnded) {
        const canContinue = nodeRes.write(value);
        if (!canContinue && !nodeRes.destroyed && !nodeRes.writableEnded) {
          await new Promise<void>((resolve) => nodeRes.once("drain", resolve));
        }
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err ?? "");
    const isStreamAbort =
      isAborted ||
      nodeRes.destroyed ||
      msg.includes("The pending stream has been canceled") ||
      msg.includes("ERR_HTTP2_STREAM_CANCEL") ||
      msg.includes("aborted");

    if (!isStreamAbort) {
      logError("STREAM", "Stream read error during HTTP/2 response piping", err);
    }
    if (!nodeRes.destroyed && !nodeRes.writableEnded) {
      try {
        nodeRes.destroy(err instanceof Error ? err : new Error(String(err)));
      } catch (destroyErr: unknown) {
        console.debug("[H2 Server] Error destroying nodeRes stream:", destroyErr);
      }
    }
  } finally {
    nodeRes.removeListener("close", onResClose);
    if (!nodeRes.writableEnded && !nodeRes.destroyed) {
      try {
        nodeRes.end();
      } catch (endErr: unknown) {
        console.debug("[H2 Server] Error ending nodeRes stream:", endErr);
      }
    }
  }
}

export interface LiteRouterServer {
  readonly port: number;
  readonly stop: () => void | Promise<void>;
}

export function createServer(portOverride?: number): Server<unknown> | LiteRouterServer {
  initializeKeyPools();
  const env = getEnv();
  const port = portOverride ?? env.LITEROUTER_PORT;
  const tls = loadTlsOptions(env.LITEROUTER_TLS_ENABLED);

  const pools = loadKeyPools(process.env);
  const keyPools = Array.from(pools.entries())
    .map(([code, keys]) => ({ provider: code, activeKeys: keys.length }))
    .filter((p) => p.activeKeys > 0);

  const bannerOpts: BannerOptions = {
    port,
    tlsEnabled: Boolean(tls),
    stripReasoning: env.LITEROUTER_STRIP_REASONING,
    keyPools,
  };
  printBanner(bannerOpts);

  if (tls && env.LITEROUTER_HTTP2) {
    const h2Server = http2.createSecureServer(
      {
        cert: tls.cert,
        key: tls.key,
        allowHTTP1: true,
        ALPNProtocols: ["h2", "http/1.1"],
      },
      async (nodeReq, nodeRes) => {
        nodeReq.on("error", () => {});
        nodeRes.on("error", () => {});

        const abortController = new AbortController();
        const onAbort = () => {
          if (!nodeRes.writableEnded) {
            abortController.abort();
          }
        };
        nodeReq.once("aborted", onAbort);
        nodeRes.once("close", onAbort);

        const chunks: Buffer[] = [];
        nodeReq.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        nodeReq.on("end", async () => {
          const reqId = `req_${Math.random().toString(36).slice(2, 9)}`;
          try {
            const hasBody = !["GET", "HEAD"].includes(nodeReq.method || "");
            const body = hasBody && chunks.length > 0 ? Buffer.concat(chunks) : undefined;
            const authority = (nodeReq.headers[":authority"] as string) || nodeReq.headers.host || `localhost:${port}`;
            const url = `https://${authority}${nodeReq.url}`;

            const fetchHeaders = nodeHeadersToFetchHeaders(nodeReq.headers);
            fetchHeaders.set("x-http-version", `HTTP/${nodeReq.httpVersion}`);

            const req = new Request(url, {
              method: nodeReq.method,
              headers: fetchHeaders,
              body,
              signal: abortController.signal,
            });

            const webRes = await handleAppRequest(req);
            await pipeWebResponseToNode(webRes, nodeReq, nodeRes);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err ?? "");
            const isClientAbort =
              abortController.signal.aborted ||
              nodeRes.destroyed ||
              msg.includes("The pending stream has been canceled") ||
              msg.includes("ERR_HTTP2_STREAM_CANCEL") ||
              msg.includes("aborted") ||
              msg.includes("premature close");

            if (isClientAbort) {
              logAmber(reqId, `Downstream HTTP/2 client stream aborted/canceled: ${msg}`);
            } else {
              logError(reqId, "Unhandled exception in HTTP/2 server route dispatch", err);
              if (!nodeRes.headersSent && !nodeRes.destroyed) {
                nodeRes.writeHead(500, { "content-type": "application/json" });
                nodeRes.end(JSON.stringify({ error: { message: "Internal Gateway Error", type: "server_error" } }));
              }
            }
          } finally {
            nodeReq.removeListener("aborted", onAbort);
            nodeRes.removeListener("close", onAbort);
          }
        });
      }
    );

    h2Server.on("clientError", (_err, socket) => {
      if (!socket.destroyed) {
        socket.destroy();
      }
    });

    h2Server.on("unknownProtocol", (socket) => {
      if (!socket.destroyed) {
        socket.destroy();
      }
    });

    h2Server.listen(port, env.LITEROUTER_HOST);

    return {
      port,
      stop: () =>
        new Promise<void>((resolve) => {
          h2Server.close(() => resolve());
        }),
    };
  }

  return Bun.serve({
    port,
    hostname: env.LITEROUTER_HOST,
    idleTimeout: env.LITEROUTER_IDLE_TIMEOUT_SEC,
    tls: tls ? { cert: tls.cert, key: tls.key } : undefined,
    async fetch(req: Request) {
      return handleAppRequest(req);
    },
  });
}

if (import.meta.main) {
  createServer();
}
