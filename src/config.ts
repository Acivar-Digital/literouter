/**
 * src/config.ts
 *
 * JSON-based configuration for LiteRouter.
 * Reads settings from config.json.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

export interface ModelConfig {
  provider?: string | null;
  model: string;
}

export interface RouterConfig {
  // Server
  port: number;
  host: string;
  authKey: string | null;

  // OpenRouter base config
  baseUrl: string;
  apiKeys: string[];

  // Models Dictionary mapping (e.g. 'code', 'chat', 'light', 'large')
  models: Record<string, ModelConfig>;
}

const CONFIG_PATH = join(process.cwd(), "config.json");
let cachedConfig: RouterConfig | null = null;

export function getConfig(): RouterConfig {
  if (cachedConfig) return cachedConfig;

  if (!existsSync(CONFIG_PATH)) {
    throw new Error(
      `[Config] Error: config.json not found at ${CONFIG_PATH}. ` +
      `Please create it using config.example.json as a template.`
    );
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const json = JSON.parse(raw);

    const server = json.server || {};
    const openrouter = json.openrouter || {};
    const modelsRaw = json.models || {};

    const apiKeys: string[] = Array.isArray(openrouter.apiKeys) 
      ? openrouter.apiKeys.map(String) 
      : [];

    const baseUrl = (String(openrouter.baseUrl || "https://openrouter.ai/api/v1")).replace(/\/$/, "");

    if (!baseUrl) console.warn("[Config] Warning: baseUrl is not set.");
    if (apiKeys.length === 0) console.warn("[Config] Warning: apiKeys array is empty.");

    const models: Record<string, ModelConfig> = {};
    for (const [key, val] of Object.entries(modelsRaw)) {
      if (val && typeof val === "object") {
        const v = val as Record<string, any>;
        models[key] = {
          provider: typeof v.provider === "string" ? v.provider : null,
          model: String(v.model || ""),
        };
      }
    }

    if (Object.keys(models).length === 0) {
      console.warn("[Config] Warning: No models defined in config.models!");
    }

    cachedConfig = {
      port: typeof server.port === "number" ? server.port : parseInt(server.port || "7766", 10),
      host: server.host || "0.0.0.0",
      authKey: server.authKey || null,
      baseUrl,
      apiKeys,
      models,
    };

    return cachedConfig;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("[Config]")) {
      throw error;
    }
    throw new Error(`[Config] Failed to parse config.json: ${error}`);
  }
}
