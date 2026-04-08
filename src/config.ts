/**
 * src/config.ts
 *
 * JSON-based configuration for LiteRouter.
 * Reads settings from config.json with template-based provider selection.
 *
 * The config has a `server.template` field ("openrouter" | "gemini") that
 * selects which provider section to use for baseUrl, model, temperature, etc.
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { TemplateName } from "./templates/index.js";

export interface ProviderConfig {
  baseUrl: string;
  model: string;
  temperature: number | null;
  thinkingMode: "high" | "medium" | "low" | null;
  provider?: string | null;
  apiKeys?: string[];
}

export interface RouterConfig {
  // Server
  port: number;
  host: string;
  authKey: string | null;
  template: TemplateName;

  // Active provider (resolved from template)
  baseUrl: string;
  model: string;
  temperature: number | null;
  thinkingMode: "high" | "medium" | "low" | null;
  provider?: string | null;

  // All provider configs (for diagnostics / hot-swap)
  providers: Record<string, ProviderConfig>;

  // Keys
  apiKeys: string[];
}

const CONFIG_PATH = join(process.cwd(), "config.json");
const VALID_TEMPLATES: ReadonlySet<string> = new Set(["openrouter", "gemini"]);
const VALID_THINKING: ReadonlySet<string> = new Set(["high", "medium", "low"]);

let cachedConfig: RouterConfig | null = null;

function parseProviderSection(section: Record<string, unknown>): ProviderConfig {
  const rawThinking = typeof section.thinkingMode === "string"
    ? section.thinkingMode.toLowerCase()
    : null;

  return {
    baseUrl: (String(section.baseUrl || "")).replace(/\/$/, ""),
    model: String(section.model || ""),
    temperature: typeof section.temperature === "number" ? section.temperature : null,
    thinkingMode: rawThinking && VALID_THINKING.has(rawThinking)
      ? (rawThinking as "high" | "medium" | "low")
      : null,
    provider: typeof section.provider === "string" ? section.provider : null,
    apiKeys: Array.isArray(section.apiKeys) ? section.apiKeys.map(String) : undefined,
  };
}

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
    const globalApiKeys: string[] = Array.isArray(json.apiKeys) ? json.apiKeys.map(String) : [];

    // Validate template selection
    const template = String(server.template || "openrouter").toLowerCase();
    if (!VALID_TEMPLATES.has(template)) {
      const valid = Array.from(VALID_TEMPLATES).join(", ");
      throw new Error(
        `[Config] Invalid server.template "${template}". Valid: ${valid}`
      );
    }

    // Parse all provider sections
    const providers: Record<string, ProviderConfig> = {};
    for (const name of VALID_TEMPLATES) {
      if (json[name]) {
        providers[name] = parseProviderSection(json[name]);
      }
    }

    // Resolve active provider from template
    const active = providers[template];
    if (!active) {
      throw new Error(
        `[Config] Template "${template}" selected but no "${template}" section found in config.json.`
      );
    }

    // Resolve apiKeys: template-specific first, then global
    const apiKeys = active.apiKeys || globalApiKeys;

    if (!active.baseUrl) console.warn("[Config] Warning: active provider baseUrl is not set.");
    if (apiKeys.length === 0) console.warn("[Config] Warning: apiKeys array is empty.");

    cachedConfig = {
      port: typeof server.port === "number" ? server.port : parseInt(server.port || "7766", 10),
      host: server.host || "0.0.0.0",
      authKey: server.authKey || null,
      template: template as TemplateName,
      baseUrl: active.baseUrl,
      model: active.model,
      temperature: active.temperature,
      thinkingMode: active.thinkingMode,
      provider: active.provider,
      providers,
      apiKeys,
    };

    return cachedConfig;
  } catch (error) {
    // Re-throw config parse errors without wrapping twice
    if (error instanceof Error && error.message.startsWith("[Config]")) {
      throw error;
    }
    throw new Error(`[Config] Failed to parse config.json: ${error}`);
  }
}
