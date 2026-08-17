import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ParsedDirective } from "../directive/parser";

export interface ModelItem {
  readonly id: string;
  readonly object: "model";
  readonly created: number;
  readonly owned_by: string;
  readonly permission: readonly unknown[];
}

export interface OpenAIModelsResponse {
  readonly object: "list";
  readonly data: readonly ModelItem[];
}

export interface GoogleModelItem {
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
  readonly inputTokenLimit?: number;
  readonly outputTokenLimit?: number;
}

export interface GoogleModelsResponse {
  readonly models: readonly GoogleModelItem[];
}

interface RawFusionConfig {
  readonly presets?: Record<string, { readonly models?: Record<string, unknown> }>;
}

interface RawCatalogConfig {
  readonly models?: ReadonlyArray<{ readonly id: string; readonly provider?: string }>;
}

function loadCatalogModels(): Array<{ id: string; owned_by: string }> {
  const p = resolve(process.cwd(), "config", "models.json");
  if (!existsSync(p)) {
    return [
      { id: "anthropic/claude-3.7-sonnet", owned_by: "openrouter" },
      { id: "deepseek/deepseek-r1", owned_by: "nvidia" },
      { id: "gemini-2.5-pro", owned_by: "google" },
    ];
  }
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as RawCatalogConfig;
    const entries = raw.models ?? [];
    return entries.map((meta) => ({
      id: meta.id,
      owned_by: meta.provider ?? "literouter",
    }));
  } catch {
    return [{ id: "gemini-2.5-pro", owned_by: "google" }];
  }
}

function loadFusionPresetModels(preset: string): Array<{ id: string; owned_by: string }> {
  const p = resolve(process.cwd(), "config", "fusion.json");
  if (!existsSync(p)) {
    return [];
  }
  try {
    const raw = JSON.parse(readFileSync(p, "utf-8")) as RawFusionConfig;
    const targetPreset = raw.presets?.[preset];
    if (!targetPreset?.models) {
      return [];
    }
    return Object.keys(targetPreset.models).map((id) => ({
      id,
      owned_by: `fusion:${preset}`,
    }));
  } catch {
    return [];
  }
}

function toOpenAIList(models: Array<{ id: string; owned_by: string }>): OpenAIModelsResponse {
  const now = Math.floor(Date.now() / 1000);
  const data: ModelItem[] = models.map((m) => ({
    id: m.id,
    object: "model",
    created: now,
    owned_by: m.owned_by,
    permission: [],
  }));
  return { object: "list", data };
}

function toGoogleList(models: Array<{ id: string; owned_by: string }>): GoogleModelsResponse {
  const formatted: GoogleModelItem[] = models.map((m) => ({
    name: m.id.startsWith("models/") ? m.id : `models/${m.id}`,
    displayName: m.id,
    description: `LiteRouter dynamically routed model (${m.owned_by})`,
  }));
  return { models: formatted };
}

function filterByDirective(directive: ParsedDirective | null): Array<{ id: string; owned_by: string }> {
  if (!directive) {
    return loadCatalogModels();
  }
  if (directive.type === "fusion") {
    const fusionModels = loadFusionPresetModels(directive.preset);
    return fusionModels.length > 0 ? fusionModels : loadCatalogModels();
  }
  const all = loadCatalogModels();
  const matched = all.filter((m) => m.owned_by.toLowerCase().includes(directive.provider.toLowerCase()));
  return matched.length > 0 ? matched : all;
}

export async function handleModelsDiscovery(
  req: Request,
  directive: ParsedDirective | null
): Promise<Response> {
  const url = new URL(req.url);
  const isGoogle = url.pathname.includes("/v1beta/");
  const filtered = filterByDirective(directive);

  if (isGoogle) {
    return Response.json(toGoogleList(filtered), { status: 200 });
  }

  return Response.json(toOpenAIList(filtered), { status: 200 });
}
