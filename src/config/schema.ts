import { z } from "zod";

export const ProviderCodeSchema = z.enum([
  "or",
  "nv",
  "gg",
  "oa",
  "an",
  "gq",
  "cb",
  "ds",
  "ms",
  "tg",
  "zn",
  "tp",
  "gc",
]);

export const PayloadCodeSchema = z.enum(["oa", "cl", "gg", "rs", "ao"]);

export const CompletionCodeSchema = z.enum([
  "ch",
  "ms",
  "ob",
  "gc",
  "im",
  "em",
  "au",
  "md",
]);

export const NuanceCodeSchema = z.enum([
  "no",
  "dp",
  "ts",
  "gm",
  "g3",
  "sb",
  "tc",
]);

export const RateLimitSchema = z.object({
  rpm: z.number().int().nonnegative(),
  rpd: z.number().int().nonnegative(),
  tpm: z.number().int().nonnegative(),
});

export const ProviderEndpointsSchema = z.record(
  CompletionCodeSchema,
  z.string().min(1)
);

export const ProviderConfigEntrySchema = z.object({
  code: ProviderCodeSchema,
  base_url: z.string().url(),
  auth_header: z.enum(["Bearer", "x-api-key"]).default("Bearer"),
  endpoints: ProviderEndpointsSchema,
  limits: z.record(z.string(), RateLimitSchema),
});

export const ProvidersConfigSchema = z.object({
  providers: z.record(z.string(), ProviderConfigEntrySchema),
});

export const FusionTierSchema = z.object({
  priority: z.number().int().positive(),
  apikey: z.string().min(1),
  model: z.string().min(1),
});

export const FusionModelConfigSchema = z.object({
  tiers: z.array(FusionTierSchema).min(1),
});

export const FusionPresetSchema = z.object({
  strategy: z.literal("sticky_fallback"),
  timeout_ms: z.number().int().positive().default(30000),
  models: z.record(z.string(), FusionModelConfigSchema),
});

export const FusionConfigSchema = z.object({
  $schema: z.string().optional(),
  version: z.string().default("3.1"),
  presets: z.record(z.string(), FusionPresetSchema),
});

export const ModelCatalogEntrySchema = z.object({
  id: z.string().min(1),
  provider: z.string().min(1),
  category: z.string().min(1),
  supports_thinking: z.boolean().default(false),
  supports_tools: z.boolean().default(false),
  context_window: z.number().int().positive(),
  quota: RateLimitSchema.optional(),
});

export const ModelsConfigSchema = z.object({
  models: z.array(ModelCatalogEntrySchema),
});

const TRUTHY_SET: ReadonlySet<string> = new Set(["true", "1", "yes"]);
const FALSY_SET: ReadonlySet<string> = new Set(["false", "0", "no"]);

function parseBooleanString(val: unknown): unknown {
  if (typeof val !== "string") {
    return val;
  }
  const lower = val.toLowerCase().trim();
  if (TRUTHY_SET.has(lower)) {
    return true;
  }
  if (FALSY_SET.has(lower)) {
    return false;
  }
  return val;
}

export const BooleanCoerceSchema = z.preprocess(parseBooleanString, z.boolean());

export const EnvConfigSchema = z.object({
  LITEROUTER_PORT: z.coerce.number().int().positive().default(7766),
  LITEROUTER_HOST: z.string().default("0.0.0.0"),
  LITEROUTER_AUTH_KEY: z.string().default(""),
  LITEROUTER_TLS_ENABLED: BooleanCoerceSchema.default(false),
  LITEROUTER_HTTP2: BooleanCoerceSchema.default(false),
  LITEROUTER_STRIP_REASONING: BooleanCoerceSchema.default(false),
  LITEROUTER_AO_STRIP_REASONING: BooleanCoerceSchema.default(true),
  LITEROUTER_AO_MAX_TOKENS: z.coerce.number().int().nonnegative().default(32768),
  LITEROUTER_ENABLE_SCRUBBING: BooleanCoerceSchema.default(false),
  LITEROUTER_TTFT_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  LITEROUTER_NO_RESPONSE_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  LITEROUTER_STREAM_IDLE_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  LITEROUTER_HTTP_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  LITEROUTER_IDLE_TIMEOUT_SEC: z.coerce.number().int().positive().default(60),
  COOLDOWN_RATE_LIMIT_TTL_SEC: z.coerce.number().int().positive().default(65),
  COOLDOWN_SERVER_ERROR_TTL_SEC: z.coerce.number().int().positive().default(10),
  COOLDOWN_AUTH_ERROR_TTL_SEC: z.coerce.number().int().positive().default(604800),
  FUSION_STICKY_TTL_MS: z.coerce.number().int().positive().default(300000),
  STREAM_STALL_MAX_RESENDS: z.coerce.number().int().nonnegative().default(2),
  KEEPALIVE_INTERVAL_MS: z.coerce.number().int().positive().default(15000),
  LITEROUTER_HTTP_REFERER: z.string().default(""),
  LITEROUTER_X_TITLE: z.string().default(""),
  LITEROUTER_H2_OUTBOUND: BooleanCoerceSchema.default(true),
  LITEROUTER_PACER_ENABLED: BooleanCoerceSchema.default(true),
  LITEROUTER_CIRCUIT_BREAKER: BooleanCoerceSchema.default(true),
  LITEROUTER_PACER_MAX_RPM: z.coerce.number().int().positive().default(600),
  LITEROUTER_PACER_MAX_QUEUE_DEPTH: z.coerce.number().int().positive().default(100),
  LITEROUTER_PACER_MAX_QUEUE_WAIT_MS: z.coerce.number().int().positive().default(15000),
  OPENROUTER_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(200),
  NVIDIA_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(200),
  ZEN_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(200),
  GOOGLE_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(200),
  GCP_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(2000),
  GCP_PACER_MAX_QUEUE_WAIT_MS: z.coerce.number().int().positive().default(240000),
  TEST_PROVIDER_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(0),
  MOCK_TP_PORT: z.coerce.number().int().positive().default(8999),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ProviderCode = z.infer<typeof ProviderCodeSchema>;
export type PayloadCode = z.infer<typeof PayloadCodeSchema>;
export type CompletionCode = z.infer<typeof CompletionCodeSchema>;
export type NuanceCode = z.infer<typeof NuanceCodeSchema>;
export type RateLimit = z.infer<typeof RateLimitSchema>;
export type ProviderConfigEntry = z.infer<typeof ProviderConfigEntrySchema>;
export type ProvidersConfig = z.infer<typeof ProvidersConfigSchema>;
export type FusionTier = z.infer<typeof FusionTierSchema>;
export type FusionModelConfig = z.infer<typeof FusionModelConfigSchema>;
export type FusionPreset = z.infer<typeof FusionPresetSchema>;
export type FusionConfig = z.infer<typeof FusionConfigSchema>;
export type ModelCatalogEntry = z.infer<typeof ModelCatalogEntrySchema>;
export type ModelsConfig = z.infer<typeof ModelsConfigSchema>;
export type EnvConfig = z.infer<typeof EnvConfigSchema>;
