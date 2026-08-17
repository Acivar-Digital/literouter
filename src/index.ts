import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Server } from "bun";
import { getEnv } from "./config/env";
import { loadKeyPools } from "./config/keys";
import { parseDirective } from "./directive/parser";
import { extractDirectiveToken } from "./directive/validator";
import { handleAnthropicCompat } from "./handlers/anthropic_compat";
import { handleModelsDiscovery } from "./handlers/discovery";
import { handleGoogleNative, handleGoogleOpenAIBeta } from "./handlers/google_native";
import {
  globalCooldownManager,
  globalKeyPool,
  handleOpenAICompat,
  initializeKeyPools,
} from "./handlers/openai_compat";
import { type BannerOptions, printBanner } from "./ui/banner";
import { logError } from "./ui/logger";

function loadTlsOptions(): { cert: string; key: string } | undefined {
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
  return Response.json(
    {
      status: "ok",
      message: "Hard reset successful. Cooldowns and key pools reloaded.",
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}

function handleHealthCheck(): Response {
  return Response.json(
    {
      status: "healthy",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  );
}

type RouteHandler = (req: Request, rawKey: string, reqId: string) => Promise<Response>;

const ROUTE_MAP: Readonly<Record<string, RouteHandler>> = {
  "/v1/chat/completions": handleOpenAICompat,
  "/v1/messages": handleAnthropicCompat,
};

const SYSTEM_MAP: Readonly<Record<string, () => Response>> = {
  "/health": handleHealthCheck,
  "/reset": handleHardReset,
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
  if (path.startsWith("/v1beta/openai/")) {
    return handleGoogleOpenAIBeta(req, rawKey, reqId);
  }
  if (path.startsWith("/v1beta/models/")) {
    return handleGoogleNative(req, rawKey, reqId);
  }
  return null;
}

async function dispatchRoute(req: Request, rawKey: string, reqId: string): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  const sysHandler = SYSTEM_MAP[path];
  if (sysHandler) {
    return sysHandler();
  }

  const modelsRes = dispatchModelsRoute(path, req, rawKey);
  if (modelsRes !== null) {
    return modelsRes;
  }

  const directHandler = ROUTE_MAP[path];
  if (directHandler) {
    return directHandler(req, rawKey, reqId);
  }

  const betaRes = dispatchGoogleBeta(path, req, rawKey, reqId);
  if (betaRes !== null) {
    return betaRes;
  }

  return Response.json({ error: { message: `Not Found: ${path}`, type: "invalid_request_error" } }, { status: 404 });
}

export function resetAllState(): void {
  globalCooldownManager.clearAll();
  globalKeyPool.reset();
  initializeKeyPools();
}

export function getCooldownState(): Record<string, unknown> {
  return {};
}

export async function handleAppRequest(req: Request): Promise<Response> {
  initializeKeyPools();
  const reqId = `req_${Math.random().toString(36).slice(2, 9)}`;
  const rawKey = extractDirectiveToken(req) || "";
  try {
    return await dispatchRoute(req, rawKey, reqId);
  } catch (err) {
    logError(reqId, "Unhandled exception in request handler", err);
    return Response.json({ error: { message: "Internal Gateway Error", type: "server_error" } }, { status: 500 });
  }
}

export function createServer(portOverride?: number): Server<unknown> {
  initializeKeyPools();
  const env = getEnv();
  const port = portOverride ?? env.LITEROUTER_PORT;
  const tls = loadTlsOptions();

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

  return Bun.serve({
    port,
    hostname: env.LITEROUTER_HOST,
    tls: tls ? { cert: tls.cert, key: tls.key } : undefined,
    async fetch(req: Request) {
      const reqId = `req_${Math.random().toString(36).slice(2, 9)}`;
      const rawKey = extractDirectiveToken(req) || "";
      try {
        return await dispatchRoute(req, rawKey, reqId);
      } catch (err) {
        logError(reqId, "Unhandled exception in server route dispatch", err);
        return Response.json({ error: { message: "Internal Gateway Error", type: "server_error" } }, { status: 500 });
      }
    },
  });
}

if (import.meta.main) {
  createServer();
}
