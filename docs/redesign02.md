# Architecture Blueprint: LiteRouter v4.1 — Provider Registry, Execution Strategies & Standardized Telemetry

- **Document Path**: `docs/redesign02.md`
- **Supersedes**: `docs/redesign01.md` (intern draft — reviewed and rejected; see audit notes below)
- **Status**: APPROVED FOR BUILD
- **Release Version**: **v4.1.0** (delivered on `main`, backed up to branch `v4.0`)
- **Target Subsystems**: `src/config/`, `src/engine/`, `src/telemetry/`, `src/handlers/`, `src/network/`, `config/providers.json`

---

## 0. Audit Disposition (Why redesign01 Was Rejected)

The intern's draft (`docs/redesign01.md`) correctly diagnosed the problems but had four production blockers:

| # | Blocker | Resolution in This Document |
|---|---------|----------------------------|
| B1 | Google Native fusion chains have no home in the architecture | §7 Provider Execution Strategies with explicit `NativeCascadeStrategy` |
| B2 | GCP billing guardrails have no home in the architecture | §7.4 `GcpGuardedStrategy` with pre-dispatch billing check |
| B3 | No feature flag or shadow-mode dispatch | §4 Dual-Path Feature Flag (`LITEROUTER_ENGINE`) |
| B4 | Circuit breaker behavior is unspecified | §8 Full circuit breaker state machine specification |

Additional gaps addressed: atomic config reload (§6.3), env deprecation warnings (§13.2), test coverage matrix (§15), graceful shutdown (§17.5), metrics hooks (§9.6), trace endpoint auth (§10.5), SQLite failure handling (§10.4).

---

## 1. Executive Summary

LiteRouter v4.0 works. Five handler files (~5,237 lines total) carry the full execution lifecycle: directive parsing, pacer acquisition, key selection, retry loops, upstream fetch, stream management, circuit breakers, quarantine, and 100+ copy-pasted telemetry calls. This works but creates three concrete problems:

1. **Configuration fragmentation**: Provider networking rules are split between `src/config/env.ts` (~60 env vars), hardcoded magic numbers in handlers (`Math.min(3, poolSize)`, `return 200`), and a partially-used `config/providers.json` (currently stores only identity, endpoints, and rate limits — no retry/pacer/cooldown config).

2. **Thundering herd on retry**: Retries execute with 0ms delay. When 3 concurrent OpenCode subagents all hit a 429 and retry instantly, all 3 hit the same provider within the same millisecond window, creating rate-limit cascades.

3. **Telemetry boilerplate**: `src/ui/logger.ts` has hardcoded `PROVIDER_NAMES` and `WIRE_NAMES` dictionaries. Adding a provider requires touching logger.ts, every handler that logs, and config. Handlers contain inconsistent telemetry: some omit `finish_reason`, some omit speed metrics, some use hardcoded provider strings.

### Solution Summary

| Component | Current State | Target State |
|-----------|--------------|--------------|
| Provider config | Split across env.ts + providers.json + hardcoded | `config/providers.json` is Single Source of Truth for all provider operational params |
| Execution mechanics | Duplicated in 5 handlers | Shared `src/engine/dispatch.ts` with pluggable `ProviderExecutionStrategy` per provider |
| Provider-specific logic | Embedded in handler bodies | Isolated strategy classes (`NativeCascadeStrategy`, `GcpGuardedStrategy`, `StandardStrategy`) |
| Telemetry | 100+ scattered log* calls, manual stopwatches | `RequestTelemetry` session class, zero raw `Date.now()` in handlers |
| Retry timing | 0ms instant retries | Bounded jitter delay (150-300ms default) from providers.json |
| Circuit breaker | Exists in code but undocumented | Fully specified state machine in §8 |

---

## 2. Architectural Principles

These are hard constraints. Violation of any principle requires re-review.

1. **Existing behavior is preserved exactly.** Every directive key, every wire format, every fusion chain, every billing guardrail, every circuit breaker behavior that works today MUST work identically after v4.1. This is a refactor, not a rewrite.

2. **Feature-flagged coexistence.** The old execution path and new execution path MUST coexist behind `LITEROUTER_ENGINE=v4|legacy`. The flag defaults to `legacy`. Switching to `v4` is opt-in per deployment.

3. **Provider-specific logic is not "unified" away.** Providers have genuinely different execution semantics (Google has cascade chains, GCP has billing guardrails, Zen has single-flight mode, Anthropic has bidirectional protocol translation). The dispatch engine provides shared infrastructure; provider strategies provide the specialization.

4. **Handlers become thin.** Handlers contain: (a) request parsing, (b) directive extraction, (c) delegation to the dispatch engine. They contain zero retry loops, zero pacer calls, zero `Date.now()` timers, zero key rotation logic.

5. **Zero new runtime dependencies.** Only `zod` and `bun:sqlite` (built-in). No ORMs, no logging frameworks, no metrics libraries (but structured hooks for future metrics export).

6. **Secrets stay in `.env.local`.** Operational config moves to `providers.json`. API keys never move to JSON. This boundary is inviolable.

### Non-Goals (Explicitly Out of Scope)

- Prometheus/Grafana metrics export (v4.2, hooks only in v4.1)
- Distributed tracing (OpenTelemetry spans) (v4.3)
- Multi-process / cluster mode (not needed; Bun single-thread is sufficient)
- Provider auto-discovery or dynamic registration at runtime
- Changes to directive key grammar or fusion preset format

---

## 3. Target Architecture

```
                          ┌───────────────────────────────────┐
                          │      config/providers.json        │
                          │   (Single Source of Truth)         │
                          │ • Identity (code, name, env_key)  │
                          │ • Endpoints & Headers             │
                          │ • request_retry config            │
                          │ • key_cooldown config             │
                          │ • pacer config                    │
                          │ • circuit_breaker config          │
                          │ • conserve_rules                  │
                          │ • limits                          │
                          │ • strategy (type identifier)      │
                          └─────────────┬─────────────────────┘
                                        │ Boot / POST /reset
                                        ▼
                          ┌───────────────────────────────────┐
                          │    src/config/providers.ts         │
                          │   (In-Memory Registry, O(1) maps) │
                          └─────────────┬─────────────────────┘
                                        │
                                        ▼
                          ┌───────────────────────────────────┐
                          │     LITEROUTER_ENGINE flag         │
                          │  ┌────────────┬──────────────┐    │
                          │  │  "legacy"  │    "v4"      │    │
                          │  │ (default)  │  (opt-in)    │    │
                          │  └─────┬──────┴──────┬───────┘    │
                          └────────┼─────────────┼────────────┘
                                   │             │
            ┌──────────────────────┘             └──────────────────────┐
            ▼                                                          ▼
  ┌───────────────────────┐                          ┌───────────────────────────────┐
  │  LEGACY PATH          │                          │  V4 PATH                      │
  │  (Current handlers,   │                          │                               │
  │   unchanged)          │                          │  ┌─────────────────────────┐  │
  └───────────────────────┘                          │  │  Route Handlers (Thin)  │  │
                                                     │  │  • Parse request        │  │
                                                     │  │  • Extract directive    │  │
                                                     │  │  • Delegate to engine   │  │
                                                     │  └──────────┬──────────────┘  │
                                                     │             │                 │
                                                     │             ▼                 │
                                                     │  ┌─────────────────────────┐  │
                                                     │  │  Payload Transformers   │  │
                                                     │  │  (Pure functions)       │  │
                                                     │  │  • clientToWire()       │  │
                                                     │  │  • wireToClient()       │  │
                                                     │  │  • createStreamXform()  │  │
                                                     │  └──────────┬──────────────┘  │
                                                     │             │                 │
                                                     │             ▼                 │
                                                     │  ┌─────────────────────────┐  │
                                                     │  │  Dispatch Engine        │  │
                                                     │  │  (src/engine/           │  │
                                                     │  │   dispatch.ts)          │  │
                                                     │  │  • Pacer acquisition    │  │
                                                     │  │  • Key selection        │  │
                                                     │  │  • Retry loop w/ jitter │  │
                                                     │  │  • Circuit breaker gate │  │
                                                     │  │  • Upstream fetch       │  │
                                                     │  │  • Telemetry lifecycle  │  │
                                                     │  └──────────┬──────────────┘  │
                                                     │             │                 │
                                                     │             ▼                 │
                                                     │  ┌─────────────────────────┐  │
                                                     │  │  Provider Strategy      │  │
                                                     │  │  (pluggable hooks)      │  │
                                                     │  │  • StandardStrategy     │  │
                                                     │  │  • NativeCascade        │  │
                                                     │  │  • GcpGuarded           │  │
                                                     │  │  • ZenSingleFlight      │  │
                                                     │  │  • AnthropicDirect      │  │
                                                     │  └─────────────────────────┘  │
                                                     └───────────────────────────────┘
                                                                   │
                                          ┌────────────────────────┼─────────────────────┐
                                          ▼                        ▼                     ▼
                            ┌──────────────────────┐ ┌──────────────────┐ ┌──────────────────────┐
                            │  RequestTelemetry    │ │ Terminal Logs    │ │  RAM Ring Buffer     │
                            │  (session lifecycle) │ │ (LOG_LEVEL)      │ │  (last 100, 32MB)    │
                            └──────────────────────┘ └──────────────────┘ └──────────┬───────────┘
                                                                                     │ Lazy flush
                                                                                     ▼
                                                                          ┌──────────────────────┐
                                                                          │  logs/traces.db      │
                                                                          │  (WAL, 30-day TTL)   │
                                                                          └──────────────────────┘
```

---

## 4. Feature Flag: Dual-Path Coexistence

### 4.1 The Flag

```bash
# .env.local or .env
LITEROUTER_ENGINE=legacy   # default — uses current handler execution paths unchanged
LITEROUTER_ENGINE=v4       # opt-in — uses new dispatch engine + provider strategies
```

### 4.2 Implementation in `src/index.ts`

The route dispatcher checks the engine flag and delegates accordingly:

```typescript
// src/index.ts — route dispatch modification
import { getEnv } from "./config/env";

function dispatchRoute(req: Request, rawKey: string, reqId: string): Promise<Response> {
  const engine = getEnv().LITEROUTER_ENGINE; // "legacy" | "v4"

  if (engine === "v4") {
    // New path: thin handler → transformer → dispatch engine → provider strategy
    return dispatchV4(req, rawKey, reqId);
  }

  // Legacy path: existing handler functions, completely untouched
  return dispatchLegacy(req, rawKey, reqId);
}
```

### 4.3 Validation Protocol for the Flag

The flag enables **A/B validation** of identical requests:

1. Run gateway with `LITEROUTER_ENGINE=legacy`. Execute full integration test suite. Record all response statuses, token counts, and timing.
2. Run gateway with `LITEROUTER_ENGINE=v4`. Execute identical test suite. Compare.
3. Diff must show: identical response statuses, identical token counts, timing within ±20%.
4. Only after A/B parity is confirmed does `v4` become the default.

### 4.4 Deprecation Timeline

| Phase | Duration | Default Engine | Legacy Code |
|-------|----------|----------------|-------------|
| v4.1.0 | Weeks 1-4 | `legacy` | Fully intact |
| v4.1.1 | Weeks 5-8 | `v4` | Intact, selectable |
| v4.2.0 | Week 9+ | `v4` only | Legacy handlers deleted |

### 4.5 Per-Request Override (Optional, Low Priority)

For debugging, allow per-request engine selection via header:

```http
X-LiteRouter-Engine: v4
X-LiteRouter-Engine: legacy
```

This header is checked ONLY if `LITEROUTER_ENGINE_OVERRIDE=true` (default: `false`). In production, per-request override should be disabled.

---

## 5. Configuration Specification: `config/providers.json`

### 5.1 Extended Schema — `src/config/schema.ts`

The existing `ProviderConfigEntrySchema` in `src/config/schema.ts` is extended with new optional fields. All new fields have defaults, so the CURRENT `config/providers.json` validates without modification (backward compatible).

```typescript
// src/config/schema.ts — NEW schemas (additions only, existing schemas untouched)

// ── Request Retry (prompt resilience across keys) ──────────────────────
export const RequestRetryDelaySchema = z.object({
  min_ms: z.number().int().nonnegative().default(150),
  max_ms: z.number().int().nonnegative().default(300),
}).refine((data) => data.max_ms >= data.min_ms, {
  message: "max_ms must be >= min_ms",
  path: ["max_ms"],
});

export const RequestRetrySchema = z.object({
  enabled: z.boolean().default(true),
  max_attempts: z.number().int().positive().default(3),
  delay: RequestRetryDelaySchema.default({}),
});

// ── Key Cooldown (individual key penalty box) ──────────────────────────
export const KeyCooldownSchema = z.object({
  enabled: z.boolean().default(true),
  initial_cooldown_ms: z.number().int().positive().default(10000),
  backoff_factor: z.number().positive().default(1.5),
  max_cooldown_ms: z.number().int().positive().default(60000),
  max_consecutive_failures: z.number().int().positive().default(5),
  jitter_percent: z.number().min(0).max(50).default(20),
  respect_retry_after: z.boolean().default(true),
  reset_after_success: z.boolean().default(true),
});

// ── Provider Pacer (FIFO conveyor belt) ────────────────────────────────
export const ProviderPacerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  min_delay_ms: z.number().int().nonnegative().default(200),
  max_delay_ms: z.number().int().nonnegative().default(500),
  max_queue_depth: z.number().int().positive().default(100),
  max_queue_wait_ms: z.number().int().positive().default(15000),
}).refine((data) => data.max_delay_ms >= data.min_delay_ms, {
  message: "max_delay_ms must be >= min_delay_ms",
  path: ["max_delay_ms"],
});

// ── Circuit Breaker (provider-level) ───────────────────────────────────
export const CircuitBreakerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  failure_threshold: z.number().int().positive().default(5),
  failure_window_ms: z.number().int().positive().default(60000),
  open_duration_ms: z.number().int().positive().default(30000),
  half_open_max_probes: z.number().int().positive().default(2),
  success_threshold_to_close: z.number().int().positive().default(2),
});

// ── Conserve Rules (hard daily quota locks) ────────────────────────────
export const ConserveRuleSchema = z.object({
  status: z.number().int(),
  contains: z.string().min(1),
  ttl: z.enum(["midnight_utc", "midnight_pacific", "indefinite", "1h", "24h"]).default("midnight_utc"),
  reason: z.string().min(1),
});

// ── Execution Strategy Identifier ──────────────────────────────────────
export const ProviderStrategySchema = z.enum([
  "standard",           // Default: pacer → key select → retry → fetch
  "native_cascade",     // Google Native: model chain fallback across tiers
  "gcp_guarded",        // GCP: billing guardrail pre-check + standard dispatch
  "zen_single_flight",  // Zen: optional single-attempt mode, session-id injection
  "anthropic_direct",   // Direct Anthropic: x-api-key auth, anthropic-version header
]).default("standard");

// ── Extended Provider Config Entry ─────────────────────────────────────
// This REPLACES the existing ProviderConfigEntrySchema
export const ProviderConfigEntrySchema = z.object({
  // ── Existing fields (unchanged) ──
  code: z.string().regex(/^[a-z0-9]{2,6}$/),
  base_url: z.string().url(),
  auth_header: z.enum(["Bearer", "x-api-key"]).default("Bearer"),
  headers: z.record(z.string(), z.string()).optional(),
  endpoints: ProviderEndpointsSchema,
  limits: z.record(z.string(), RateLimitSchema).optional(),
  conserve_rules: z.array(ConserveRuleSchema).optional().default([]),

  // ── NEW fields (all optional with defaults for backward compat) ──
  name: z.string().min(1).optional(),         // Display name. Falls back to JSON key titlecased.
  env_key: z.string().min(1).optional(),       // Env var name. Falls back to provider-code lookup in keys.ts.
  strategy: ProviderStrategySchema,
  request_retry: RequestRetrySchema.optional().default({}),
  key_cooldown: KeyCooldownSchema.optional().default({}),
  pacer: ProviderPacerConfigSchema.optional(),  // If absent, falls back to env var defaults (backward compat)
  circuit_breaker: CircuitBreakerConfigSchema.optional().default({}),
});
```

### 5.2 Extended `config/providers.json` (Annotated Canonical Example)

Only **new fields** are added to the existing JSON structure. All existing fields remain untouched. The `strategy` field is the key addition that tells the dispatch engine which execution strategy to use.

```jsonc
{
  "providers": {
    "openrouter": {
      // ── Existing fields (UNCHANGED) ──
      "code": "or",
      "base_url": "https://openrouter.ai",
      "auth_header": "Bearer",
      "headers": {
        "HTTP-Referer": "https://opencode.ai",
        "X-Title": "OpenCode",
        "User-Agent": "OpenCode/1.18.29"
      },
      "endpoints": {
        "ch": "/api/v1/chat/completions",
        "ms": "/api/v1/messages",
        "rs": "/api/v1/responses",
        "em": "/api/v1/embeddings",
        "md": "/api/v1/models"
      },
      "limits": {
        "default": { "rpm": 200, "rpd": 50000, "tpm": 20000000 }
      },
      "conserve_rules": [
        {
          "status": 429,
          "contains": "free-models-per-day",
          "ttl": "midnight_utc",
          "reason": "OpenRouter daily free models quota exhausted"
        }
      ],

      // ── NEW fields ──
      "name": "OpenRouter",
      "env_key": "OPENROUTER_API_KEYS",
      "strategy": "standard",
      "request_retry": {
        "enabled": true,
        "max_attempts": 3,
        "delay": { "min_ms": 150, "max_ms": 300 }
      },
      "key_cooldown": {
        "enabled": true,
        "initial_cooldown_ms": 10000,
        "backoff_factor": 1.5,
        "max_cooldown_ms": 60000,
        "max_consecutive_failures": 5,
        "jitter_percent": 20,
        "respect_retry_after": true,
        "reset_after_success": true
      },
      "pacer": {
        "enabled": true,
        "min_delay_ms": 200,
        "max_delay_ms": 500,
        "max_queue_depth": 100,
        "max_queue_wait_ms": 15000
      },
      "circuit_breaker": {
        "enabled": true,
        "failure_threshold": 5,
        "failure_window_ms": 60000,
        "open_duration_ms": 30000,
        "half_open_max_probes": 2,
        "success_threshold_to_close": 2
      }
    },

    "nvidia": {
      "code": "nv",
      "name": "NVIDIA NIM",
      "env_key": "NVIDIA_API_KEYS",
      "strategy": "standard",
      "base_url": "https://integrate.api.nvidia.com",
      "auth_header": "Bearer",
      "endpoints": {
        "ch": "/v1/chat/completions",
        "em": "/v1/embeddings",
        "md": "/v1/models"
      },
      "limits": { "default": { "rpm": 60, "rpd": 50000, "tpm": 10000000 } },
      "request_retry": { "enabled": true, "max_attempts": 3, "delay": { "min_ms": 150, "max_ms": 300 } },
      "pacer": { "enabled": true, "min_delay_ms": 200, "max_delay_ms": 500, "max_queue_depth": 100, "max_queue_wait_ms": 15000 },
      "circuit_breaker": { "enabled": true }
    },

    "google": {
      "code": "gg",
      "name": "Google AI Studio",
      "env_key": "GOOGLE_API_KEYS",
      "strategy": "native_cascade",
      "base_url": "https://generativelanguage.googleapis.com",
      "auth_header": "x-api-key",
      "endpoints": {
        "ch": "/v1beta/openai/chat/completions",
        "ob": "/v1beta/openai/chat/completions",
        "gc": "/v1beta/models/{model}:generateContent",
        "em": "/v1beta/models/{model}:embedContent",
        "md": "/v1beta/models"
      },
      "limits": { "default": { "rpm": 30, "rpd": 14400, "tpm": 1000000 } },
      "request_retry": { "enabled": true, "max_attempts": 3, "delay": { "min_ms": 200, "max_ms": 500 } },
      "pacer": { "enabled": true, "min_delay_ms": 200, "max_delay_ms": 500, "max_queue_depth": 100, "max_queue_wait_ms": 15000 },
      "circuit_breaker": { "enabled": false }
    },

    "zen": {
      "code": "zn",
      "name": "Zen",
      "env_key": "ZEN_API_KEYS",
      "strategy": "zen_single_flight",
      "base_url": "https://opencode.ai/zen",
      "auth_header": "Bearer",
      "headers": {
        "HTTP-Referer": "https://opencode.ai",
        "Referer": "https://opencode.ai",
        "X-Title": "OpenCode",
        "User-Agent": "OpenCode/1.18.29"
      },
      "endpoints": {
        "ch": "/v1/chat/completions",
        "md": "/v1/models",
        "rs": "/v1/responses"
      },
      "limits": { "default": { "rpm": 30, "rpd": 5000, "tpm": 1000000 } },
      "request_retry": { "enabled": true, "max_attempts": 1, "delay": { "min_ms": 0, "max_ms": 0 } },
      "pacer": { "enabled": true, "min_delay_ms": 200, "max_delay_ms": 500, "max_queue_depth": 100, "max_queue_wait_ms": 15000 },
      "circuit_breaker": { "enabled": false }
    },

    "gcp": {
      "code": "gc",
      "name": "Google Cloud (GCP)",
      "env_key": "GCP_KEYS",
      "strategy": "gcp_guarded",
      "base_url": "https://generativelanguage.googleapis.com",
      "auth_header": "Bearer",
      "endpoints": {
        "ch": "/v1beta/openai/chat/completions",
        "ob": "/v1beta/openai/chat/completions",
        "gc": "/v1beta/models/{model}:generateContent",
        "em": "/v1beta/models/{model}:embedContent",
        "md": "/v1beta/models"
      },
      "limits": { "default": { "rpm": 30, "rpd": 14400, "tpm": 16000 } },
      "request_retry": { "enabled": true, "max_attempts": 3, "delay": { "min_ms": 200, "max_ms": 500 } },
      "pacer": { "enabled": true, "min_delay_ms": 2000, "max_delay_ms": 3000, "max_queue_depth": 100, "max_queue_wait_ms": 240000 },
      "circuit_breaker": { "enabled": false }
    }
  }
}
```

> **Backward Compatibility Note**: The existing `config/providers.json` (which lacks `name`, `env_key`, `strategy`, `request_retry`, `key_cooldown`, `pacer`, and `circuit_breaker` fields) MUST continue to parse without errors. All new fields use Zod `.optional().default({})` or `.default("standard")`. The v4 engine falls back to current env-var-based defaults when JSON fields are absent.

### 5.3 The Clean `.env.local` Contract

Same purge table as redesign01 (Section 3.3B), with one critical addition: **Deprecation Warnings** (see §13.2).

**Retained in `.env.local`** (pure secrets and host primitives only):
```bash
# Host primitives
LITEROUTER_HOST=0.0.0.0
LITEROUTER_PORT=7766
LITEROUTER_TLS_ENABLED=true
LITEROUTER_TLS_CERT=certs/localhost.pem
LITEROUTER_TLS_KEY=certs/localhost-key.pem
LITEROUTER_HTTP2=true
LITEROUTER_H2_OUTBOUND=true

# Feature flag
LITEROUTER_ENGINE=legacy  # or "v4"

# Secret key pools
OPENROUTER_API_KEYS=sk-or-key1,sk-or-key2
NVIDIA_API_KEYS=nvapi-key1,nvapi-key2
GOOGLE_API_KEYS=AIzaSyKey1,AIzaSyKey2
ZEN_API_KEYS=zen-key1,zen-key2
GCP_KEYS=gc-key1,gc-key2

# Behavioral knobs that remain env-driven (not provider-specific)
LOG_LEVEL=info
LITEROUTER_STRIP_REASONING=false
LITEROUTER_AO_STRIP_REASONING=true
LITEROUTER_AO_MAX_TOKENS=32768
LITEROUTER_ENABLE_SCRUBBING=false
LITEROUTER_TTFT_TIMEOUT_MS=120000
LITEROUTER_STREAM_IDLE_TIMEOUT_MS=120000
LITEROUTER_HTTP_TIMEOUT_MS=300000
FUSION_STICKY_TTL_MS=300000
STREAM_STALL_MAX_RESENDS=2
KEEPALIVE_INTERVAL_MS=15000
LITEROUTER_ENGINE_OVERRIDE=false
```

---

## 6. In-Memory Provider Registry (`src/config/providers.ts`)

### 6.1 Store Interface

```typescript
// src/config/providers.ts

import { ProvidersConfigSchema, type ProviderConfigEntry } from "./schema";

interface ProviderRegistrySnapshot {
  readonly byCode: ReadonlyMap<string, ProviderConfigEntry>;
  readonly byName: ReadonlyMap<string, ProviderConfigEntry>;
}

// Atomic reference — single pointer swap on reload
let registry: ProviderRegistrySnapshot = { byCode: new Map(), byName: new Map() };

export function initProviderRegistry(rawConfig?: unknown): void {
  const parsed = ProvidersConfigSchema.parse(rawConfig ?? loadRawProvidersJson());
  const byCode = new Map<string, ProviderConfigEntry>();
  const byName = new Map<string, ProviderConfigEntry>();

  for (const [key, entry] of Object.entries(parsed.providers)) {
    byCode.set(entry.code.toLowerCase(), entry);
    byName.set(key.toLowerCase(), entry);
  }

  // Atomic single-pointer swap
  registry = Object.freeze({ byCode, byName });
}

export function getProviderConfig(codeOrName: string): ProviderConfigEntry {
  const norm = codeOrName.toLowerCase();
  const snap = registry; // Read once — consistent snapshot
  const entry = snap.byCode.get(norm) ?? snap.byName.get(norm);
  if (!entry) {
    throw new Error(`[ProviderRegistry] Unknown provider: "${codeOrName}"`);
  }
  return entry;
}

export function getProviderDisplayName(codeOrName: string): string {
  const norm = codeOrName.toLowerCase();
  const snap = registry;
  const entry = snap.byCode.get(norm) ?? snap.byName.get(norm);
  return entry?.name ?? codeOrName.toUpperCase();
}

export function isRegisteredProvider(code: string): boolean {
  return registry.byCode.has(code.toLowerCase());
}

export function getAllProviders(): readonly ProviderConfigEntry[] {
  return Array.from(registry.byCode.values());
}

function loadRawProvidersJson(): unknown {
  const path = `${import.meta.dir}/../../config/providers.json`;
  return JSON.parse(Bun.file(path).text());
}
```

### 6.2 Boot Sequence Integration

```typescript
// In src/index.ts server startup, BEFORE route registration:
import { initProviderRegistry } from "./config/providers";

// 1. Load provider registry (fails fast on invalid JSON/schema)
try {
  initProviderRegistry();
  console.log(`[BOOT] Provider registry loaded: ${getAllProviders().length} providers`);
} catch (err) {
  console.error(`[BOOT] FATAL: Provider registry failed to load`, err);
  process.exit(1);
}

// 2. Existing key pool initialization (unchanged)
initializeKeyPools(process.env);

// 3. Emit deprecation warnings for purged env vars (§13.2)
emitEnvDeprecationWarnings();
```

### 6.3 Atomic Hot Reload on `POST /reset`

```typescript
// In handleHardReset():
export function handleHardReset(): Response {
  try {
    // Atomic: build new registry, then swap pointer
    initProviderRegistry(); // Throws on schema violation — old registry preserved
    reloadKeyPools();       // Existing behavior
    clearPacerRegistry();   // Existing behavior
    return new Response(JSON.stringify({ status: "ok", message: "Registry and pools reloaded" }));
  } catch (err) {
    // On failure: old registry remains active, zero downtime
    console.error(`[RESET] Registry reload failed, keeping previous config`, err);
    return new Response(JSON.stringify({ status: "error", message: String(err) }), { status: 500 });
  }
}
```

**Atomicity guarantee**: `initProviderRegistry()` builds the complete new `byCode` and `byName` maps, then performs a single pointer swap (`registry = Object.freeze({ byCode, byName })`). Because JavaScript is single-threaded and the swap is a single assignment statement, no in-flight request can observe a partially-constructed registry. If schema validation fails, the old registry is untouched.

---

## 7. Provider Execution Strategies (`src/engine/strategies/`)

This is the critical architectural innovation that redesign01 lacked. Provider-specific execution logic is NOT stuffed into a monolithic dispatch engine. Instead, the dispatch engine provides shared infrastructure (pacer, key selection, retry timing, telemetry) and delegates provider-specific decisions to **strategy objects**.

### 7.1 Strategy Interface

```typescript
// src/engine/strategy.ts

import type { ParsedDirective } from "../directive/types";
import type { ProviderConfigEntry } from "../config/schema";
import type { RequestTelemetry } from "../telemetry/session";
import type { SelectedKey } from "../config/keys";

export interface DispatchContext {
  readonly reqId: string;
  readonly directive: ParsedDirective;
  readonly providerConfig: ProviderConfigEntry;
  readonly telemetry: RequestTelemetry;
  readonly clientSignal: AbortSignal;
  readonly selectedKey: SelectedKey;
  readonly attempt: number;
  readonly maxAttempts: number;
}

export interface StrategyResult {
  readonly response: Response;
  readonly committed: boolean;  // true = bytes already sent to client, cannot retry
}

export interface ProviderExecutionStrategy {
  /**
   * Pre-dispatch hook. Called BEFORE pacer acquisition.
   * Use for: billing guardrails, model validation, payload mutation.
   * Return null to proceed. Return Response to short-circuit (e.g. 403 billing block).
   */
  preDispatch?(ctx: DispatchContext, body: Record<string, unknown>): Response | null;

  /**
   * Model resolution hook. Called AFTER pre-dispatch, BEFORE upstream fetch.
   * Use for: native cascade model selection, model name normalization.
   * Returns the resolved model name and upstream URL.
   * Default implementation: uses directive model + provider base_url + endpoint path.
   */
  resolveTarget?(ctx: DispatchContext, body: Record<string, unknown>): {
    model: string;
    upstreamUrl: string;
    extraHeaders?: Record<string, string>;
  };

  /**
   * Post-failure hook. Called when upstream returns a retryable error.
   * Use for: native cascade tier advancement, provider-specific error classification.
   * Return "retry_same_target" to retry with next key on same model.
   * Return "advance_target" to try next model in cascade (native_cascade only).
   * Return "fail_fast" to abort immediately.
   */
  classifyFailure?(ctx: DispatchContext, status: number, body?: string): "retry_same_target" | "advance_target" | "fail_fast";

  /**
   * Auth header builder. Override for providers with non-standard auth.
   * Default: { Authorization: `Bearer ${key}` } or { "x-api-key": key }
   */
  buildAuthHeaders?(key: string, incomingHeaders?: Headers): Record<string, string>;

  /**
   * Session header injection. Called for every outbound request.
   * Use for: Zen session-id, Anthropic anthropic-version header.
   */
  injectHeaders?(ctx: DispatchContext, headers: Record<string, string>): Record<string, string>;
}
```

### 7.2 `StandardStrategy` (Default)

Used by: OpenRouter (`or`), NVIDIA (`nv`), Together (`tg`), Cerebras (`cb`), Groq (`gq`), DeepSeek (`ds`), Mistral (`ms`), OpenAI Direct (`oa`), Test Provider (`tp`).

```typescript
// src/engine/strategies/standard.ts

export class StandardStrategy implements ProviderExecutionStrategy {
  // All hooks use defaults. No overrides needed.
  // This class exists as the explicit "no specialization" marker.
}
```

### 7.3 `NativeCascadeStrategy` (Google AI Studio)

Preserves the exact behavior of current `google_native.ts` lines 130-450 (the `executeNativeFusionCascade` function).

```typescript
// src/engine/strategies/native_cascade.ts

import { getNativeTierIndex, setNativeTierIndex } from "../../handlers/google_native"; // reuse existing state
import type { ProviderExecutionStrategy, DispatchContext } from "../strategy";

export class NativeCascadeStrategy implements ProviderExecutionStrategy {
  private readonly chains: Record<string, string[]>; // loaded from fusion.json native_chains

  constructor(chains: Record<string, string[]>) {
    this.chains = chains;
  }

  /**
   * Model resolution: if the requested model matches a native chain key
   * (e.g. "gemini-flash"), resolve to the current sticky tier model
   * (e.g. "gemini-3.8-flash").
   */
  resolveTarget(ctx: DispatchContext, body: Record<string, unknown>): {
    model: string;
    upstreamUrl: string;
    extraHeaders?: Record<string, string>;
  } {
    const requestedModel = String(body.model ?? "");
    const chain = this.chains[requestedModel];

    if (!chain || chain.length === 0) {
      // Not a chain model — pass through as-is (standard Google direct call)
      return {
        model: requestedModel,
        upstreamUrl: this.buildGoogleUrl(ctx, requestedModel),
      };
    }

    // Get the current sticky tier index for this chain
    const tierIdx = getNativeTierIndex(requestedModel);
    const resolvedModel = chain[tierIdx % chain.length];

    return {
      model: resolvedModel,
      upstreamUrl: this.buildGoogleUrl(ctx, resolvedModel),
      extraHeaders: {
        "x-literouter-chain": requestedModel,
        "x-literouter-tier": `${tierIdx + 1}/${chain.length}`,
      },
    };
  }

  /**
   * Failure classification: if upstream returns 404 (model deprecated),
   * advance to next tier in the chain. Otherwise, standard retry behavior.
   */
  classifyFailure(ctx: DispatchContext, status: number, body?: string): "retry_same_target" | "advance_target" | "fail_fast" {
    const requestedModel = String(ctx.directive.model ?? "");
    const chain = this.chains[requestedModel];

    if (chain && status === 404) {
      // Model not found — advance the cascade to next tier
      const currentIdx = getNativeTierIndex(requestedModel);
      const nextIdx = (currentIdx + 1) % chain.length;
      setNativeTierIndex(requestedModel, nextIdx);
      return "advance_target";
    }

    if (status === 429 || (status >= 500 && status <= 504)) {
      return "retry_same_target";
    }

    return "fail_fast";
  }

  /**
   * Google auth: uses x-goog-api-key header instead of Bearer.
   */
  buildAuthHeaders(key: string): Record<string, string> {
    return {
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    };
  }

  private buildGoogleUrl(ctx: DispatchContext, model: string): string {
    const base = ctx.providerConfig.base_url;
    const completionCode = ctx.directive.completion;
    const endpointTemplate = ctx.providerConfig.endpoints[completionCode];
    if (!endpointTemplate) {
      throw new Error(`No endpoint for completion code "${completionCode}" on provider "${ctx.providerConfig.code}"`);
    }
    // Replace {model} placeholder
    const path = endpointTemplate.replace("{model}", model);
    // For streaming: append ?alt=sse if needed (detected by dispatch engine from payload.stream)
    return `${base}${path}`;
  }
}
```

### 7.4 `GcpGuardedStrategy` (Google Cloud Platform)

Preserves the exact billing guardrail from current `gcp_compat.ts` lines 45-65 (the `isGemmaModel` check).

```typescript
// src/engine/strategies/gcp_guarded.ts

import type { ProviderExecutionStrategy, DispatchContext } from "../strategy";

export class GcpGuardedStrategy implements ProviderExecutionStrategy {
  /**
   * Pre-dispatch billing guardrail: ONLY Gemma models are allowed through GCP
   * to prevent accidental billing on paid Google models.
   */
  preDispatch(ctx: DispatchContext, body: Record<string, unknown>): Response | null {
    const model = String(body.model ?? "").toLowerCase();
    const normalized = model.replace(/^(gcp\/|google\/)/, "");

    if (!normalized.includes("gemma")) {
      return new Response(JSON.stringify({
        error: {
          code: "billing_guardrail_violation",
          message: `Billing Guardrail: Provider 'gc' is strictly restricted to free Gemma models to prevent GCP billing overruns. Model requested: ${body.model}`,
          type: "forbidden",
        }
      }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Normalize model name in body (strip gcp/google prefix)
    body.model = normalized;
    return null; // Proceed with dispatch
  }

  /**
   * GCP auth: sends both Bearer and x-goog-api-key headers.
   */
  buildAuthHeaders(key: string): Record<string, string> {
    return {
      "Authorization": `Bearer ${key}`,
      "x-goog-api-key": key,
      "Content-Type": "application/json",
    };
  }
}
```

### 7.5 `ZenSingleFlightStrategy` (Zen Provider)

Preserves the exact single-flight mode from current `openai_compat.ts` lines 415-425 and `openai_original.ts`.

```typescript
// src/engine/strategies/zen_single_flight.ts

import type { ProviderExecutionStrategy, DispatchContext } from "../strategy";
import { getEnv } from "../../config/env";
import { v4 as uuidv4 } from "crypto";

export class ZenSingleFlightStrategy implements ProviderExecutionStrategy {
  /**
   * Session header injection: Zen requires session-id for connection tracking.
   */
  injectHeaders(ctx: DispatchContext, headers: Record<string, string>): Record<string, string> {
    return {
      ...headers,
      "x-session-id": uuidv4(),
    };
  }

  /**
   * Failure classification: in single-flight mode, Zen errors are fail-fast
   * unless ZEN_ENABLE_RETRIES is true.
   */
  classifyFailure(ctx: DispatchContext, status: number): "retry_same_target" | "advance_target" | "fail_fast" {
    const env = getEnv();
    if (!env.ZEN_ENABLE_RETRIES) {
      return "fail_fast";
    }
    if (status === 429 || (status >= 500 && status <= 504)) {
      return "retry_same_target";
    }
    return "fail_fast";
  }
}
```

### 7.6 `AnthropicDirectStrategy` (Direct Anthropic)

Preserves the exact auth behavior from current `anthropic_compat.ts`.

```typescript
// src/engine/strategies/anthropic_direct.ts

import type { ProviderExecutionStrategy, DispatchContext } from "../strategy";

export class AnthropicDirectStrategy implements ProviderExecutionStrategy {
  /**
   * Anthropic uses x-api-key header and requires anthropic-version.
   */
  buildAuthHeaders(key: string): Record<string, string> {
    return {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    };
  }
}
```

### 7.7 Strategy Registry (Boot-Time Wiring)

```typescript
// src/engine/strategy_registry.ts

import type { ProviderExecutionStrategy } from "./strategy";
import { StandardStrategy } from "./strategies/standard";
import { NativeCascadeStrategy } from "./strategies/native_cascade";
import { GcpGuardedStrategy } from "./strategies/gcp_guarded";
import { ZenSingleFlightStrategy } from "./strategies/zen_single_flight";
import { AnthropicDirectStrategy } from "./strategies/anthropic_direct";
import { getAllProviders } from "../config/providers";
import { loadNativeChains } from "../config/fusion";

const strategyMap = new Map<string, ProviderExecutionStrategy>();

export function initStrategyRegistry(): void {
  const chains = loadNativeChains(); // from config/fusion.json

  const factories: Record<string, () => ProviderExecutionStrategy> = {
    standard: () => new StandardStrategy(),
    native_cascade: () => new NativeCascadeStrategy(chains),
    gcp_guarded: () => new GcpGuardedStrategy(),
    zen_single_flight: () => new ZenSingleFlightStrategy(),
    anthropic_direct: () => new AnthropicDirectStrategy(),
  };

  strategyMap.clear();
  for (const prov of getAllProviders()) {
    const strategyType = prov.strategy ?? "standard";
    const factory = factories[strategyType];
    if (!factory) {
      throw new Error(`[StrategyRegistry] Unknown strategy "${strategyType}" for provider "${prov.code}"`);
    }
    strategyMap.set(prov.code, factory());
  }
}

export function getStrategy(providerCode: string): ProviderExecutionStrategy {
  return strategyMap.get(providerCode) ?? new StandardStrategy();
}
```

---

## 8. Circuit Breaker Specification

The current `src/network/circuit_breaker.ts` implements a basic circuit breaker. This section specifies the full state machine that lives in `config/providers.json` and is enforced by the dispatch engine.

### 8.1 State Machine

```
     ┌─────────────────────────────────────────────────┐
     │                                                 │
     │   ┌──────────┐    failures >= threshold     ┌───┴────┐
     │   │  CLOSED  │ ──────────────────────────► │  OPEN  │
     │   │(normal)  │    within failure_window_ms  │(reject)│
     │   └────▲─────┘                              └───┬────┘
     │        │                                        │
     │        │ successes >= success_threshold          │ open_duration_ms
     │        │                                        │ elapsed
     │   ┌────┴──────────┐                             │
     │   │  HALF_OPEN    │ ◄───────────────────────────┘
     │   │(probe: max N) │
     │   └────┬──────────┘
     │        │
     │        │ probe failure
     │        │
     │        └──────────────────────────► OPEN (reset timer)
     │
     └─────────────────────────────────────────────────┘
```

### 8.2 Configuration Parameters (from `config/providers.json`)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `enabled` | `true` | Whether circuit breaker is active for this provider |
| `failure_threshold` | `5` | Number of failures within `failure_window_ms` to trip the breaker |
| `failure_window_ms` | `60000` | Sliding window for counting failures (60s) |
| `open_duration_ms` | `30000` | How long the breaker stays OPEN before transitioning to HALF_OPEN (30s) |
| `half_open_max_probes` | `2` | Maximum concurrent probe requests allowed in HALF_OPEN state |
| `success_threshold_to_close` | `2` | Number of consecutive probe successes needed to return to CLOSED |

### 8.3 Behavioral Contract

1. **CLOSED** (normal operation):
   - All requests pass through.
   - Failures are counted in a sliding window (`failure_window_ms`).
   - Failures outside the window are pruned on each check.
   - When `failures_in_window >= failure_threshold`, transition to OPEN.
   - Successes are not counted (irrelevant in CLOSED state).

2. **OPEN** (reject all traffic):
   - All requests receive immediate `HTTP 503` with body:
     ```json
     {
       "error": {
         "code": "circuit_breaker_open",
         "message": "Provider [name] circuit breaker is open. Retry after [remaining_ms]ms.",
         "type": "service_unavailable"
       }
     }
     ```
   - `Retry-After` header is set to `ceil(remaining_ms / 1000)`.
   - After `open_duration_ms` elapses, transition to HALF_OPEN.

3. **HALF_OPEN** (probing):
   - Up to `half_open_max_probes` concurrent requests are allowed through.
   - Additional requests are rejected with `503` (same as OPEN).
   - Each probe success increments a success counter.
   - When `consecutive_successes >= success_threshold_to_close`, transition to CLOSED (reset all counters).
   - Any probe failure immediately transitions back to OPEN (reset the `open_duration_ms` timer).

### 8.4 What Counts as a "Failure"

Only these upstream responses count as circuit breaker failures:

| HTTP Status | Counts? | Rationale |
|-------------|---------|-----------|
| 429 | **NO** | Rate limit is key-specific, not provider-wide. Handled by key_cooldown. |
| 500 | YES | Server error indicates provider instability |
| 502 | YES | Bad gateway |
| 503 | YES | Service unavailable |
| 504 | YES | Gateway timeout |
| 520-526 | YES | Cloudflare errors (OpenRouter) |
| Network error | YES | Connection refused, DNS failure, TLS handshake failure |
| TTFT timeout | YES | Provider accepted request but never responded |

**429 is explicitly excluded** from circuit breaker failure counting. Rate limits are per-key, not per-provider. A provider with 5 keys can have 4 keys rate-limited and still be healthy on the 5th. Key cooldown (§5.1 `KeyCooldownSchema`) handles 429s.

### 8.5 Interaction with Other Systems

- **Key Cooldown**: Independent. A key can be in cooldown while the circuit breaker is CLOSED. The breaker judges provider health; cooldown judges individual key health.
- **Pacer**: Independent. The pacer continues spacing requests even when the breaker is HALF_OPEN (probes still need pacing).
- **Conserve Rules**: Conserve rules lock individual keys. Circuit breaker locks the entire provider. They do not conflict.

---

## 9. Standardized Telemetry Contract (`RequestTelemetry`)

### 9.1 The Session Class

```typescript
// src/telemetry/session.ts

import { getProviderDisplayName } from "../config/providers";

export interface TelemetryInit {
  readonly reqId: string;
  readonly method: string;
  readonly path: string;
  readonly clientAgent: string;
  readonly protocol?: string;
  readonly directiveStr?: string;
  readonly targetProvider?: string;
  readonly wireFormat?: string;
  readonly endpoint?: string;
  readonly model?: string;
  readonly keyIndex?: number;
  readonly totalKeys?: number;
  readonly nuances?: readonly string[];
}

export interface UsageRecord {
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly reasoningTokens?: number;
  readonly totalTokens?: number;
  readonly finishReason?: string | null;
}

export class RequestTelemetry {
  private readonly startTime: number = performance.now();
  private firstTokenTime?: number;
  public readonly reqId: string;
  private readonly providerCode: string;
  private currentKeyIndex?: number;
  private totalKeys?: number;

  constructor(private readonly init: TelemetryInit) {
    this.reqId = init.reqId;
    this.providerCode = init.targetProvider ?? "unknown";
    this.currentKeyIndex = init.keyIndex;
    this.totalKeys = init.totalKeys;
  }

  // ── Lifecycle Methods ──

  /** Called once at request receipt. Emits inbound banner. */
  emitInbound(): void { /* structured log with provider display name from registry */ }

  /** Called on key rotation. Updates internal key index. */
  rotateKey(info: { fromIndex: number; toIndex: number; totalKeys: number; attempt: number; maxAttempts: number }): void { /* ... */ }

  /** Called on upstream rate limit or quota. */
  recordLimit(info: { status: number; retryAfterSec?: number; totalKeys?: number; rawMessage?: string }): void { /* ... */ }

  /** Called on first SSE chunk received. Idempotent (ignores second call). */
  markTtft(protocol?: string): void {
    if (this.firstTokenTime !== undefined) return;
    this.firstTokenTime = performance.now();
  }

  /** Called when tokens are extracted from response. Computes speed, emits usage. */
  recordUsage(record: UsageRecord): void { /* ... */ }

  /** Called at response completion. Emits served banner with total duration. */
  served(status: number, attempt?: number, maxAttempts?: number): void { /* ... */ }

  /** Called on error. */
  error(message: string, err?: unknown): void { /* ... */ }

  // ── Derived Metrics (for trace storage and future metrics export) ──

  /** Returns TTFT in ms, or undefined if no first token received. */
  getTtftMs(): number | undefined {
    return this.firstTokenTime !== undefined
      ? Math.round(this.firstTokenTime - this.startTime)
      : undefined;
  }

  /** Returns total request duration in ms. */
  getDurationMs(): number {
    return Math.round(performance.now() - this.startTime);
  }

  /** Returns structured snapshot for trace storage. */
  toTraceMetrics(): TraceMetrics {
    return {
      reqId: this.reqId,
      provider: this.providerCode,
      model: this.init.model ?? "unknown",
      durationMs: this.getDurationMs(),
      ttftMs: this.getTtftMs(),
    };
  }
}
```

### 9.2 Logger Consolidation

`src/ui/logger.ts` is NOT deleted (legacy path needs it). Instead:

1. The hardcoded `PROVIDER_NAMES` dictionary gains a fallback to the provider registry:
   ```typescript
   export function getProviderDisplayNameCompat(code: string): string {
     // Try static map first (backward compat), then registry
     return PROVIDER_NAMES[code] ?? getProviderDisplayName(code) ?? code.toUpperCase();
   }
   ```

2. New telemetry code in `src/telemetry/` imports provider display names from the registry, never from hardcoded maps.

3. When legacy path is eventually deleted (v4.2.0), `src/ui/logger.ts` is deleted with it.

### 9.3 What Handlers Call (v4 Path)

In the v4 path, handlers call exactly **zero** telemetry functions. The dispatch engine creates a `RequestTelemetry` instance and calls all lifecycle methods. Handlers only:
1. Parse the inbound request
2. Extract the directive
3. Call the payload transformer
4. Return the `DispatchRequest` to the engine

### 9.4 Terminal Output Compatibility

The new `RequestTelemetry` MUST produce terminal output that is **visually identical** to the current `log*` function output. Same emoji, same formatting, same timestamp format. The only difference is the source: one class vs 16 scattered functions.

### 9.5 LOG_LEVEL Filtering

| Level | What is emitted |
|-------|-----------------|
| `error` | Errors only |
| `warn` | Errors + rate limits + quarantine events |
| `info` (default) | All of `warn` + inbound/served banners + TTFT + usage + key rotation |
| `debug` | All of `info` + pacer queue ticks (dwell ≤ 50ms) + H2 pool traces + raw header dumps |

### 9.6 Metrics Hooks (Future-Proofing, Zero Implementation Now)

```typescript
// src/telemetry/hooks.ts — interface only, no implementation in v4.1

export interface MetricsHook {
  onRequestStart(reqId: string, provider: string, model: string): void;
  onRequestEnd(reqId: string, status: number, durationMs: number, ttftMs?: number): void;
  onKeyRotation(reqId: string, provider: string, fromKey: number, toKey: number): void;
  onCircuitBreakerStateChange(provider: string, oldState: string, newState: string): void;
}

// Default no-op implementation
export const noopMetrics: MetricsHook = {
  onRequestStart() {},
  onRequestEnd() {},
  onKeyRotation() {},
  onCircuitBreakerStateChange() {},
};

// In v4.2, this can be replaced with a Prometheus/StatsD exporter
// without touching any dispatch engine code.
```

---

## 10. Request Trace Subsystem

### 10.1 The 4 Correlated Legs

Every request captures 4 legs:

| Leg | What | When |
|-----|------|------|
| **Client Inbound** | Method, path, sanitized headers, request body | On handler entry |
| **Upstream Outbound** | Target URL, model, key index, sanitized headers, transformed body | Before upstream fetch |
| **Upstream Inbound** | Status, sanitized headers, response body (or streamed text) | After upstream response received |
| **Client Outbound** | Status, sanitized headers, response body | Before Response is returned |

### 10.2 Secret Redaction Pipeline

**Structural guarantee (not regex-only)**: The trace system uses an **allowlist approach**, not a denylist.

```typescript
// src/telemetry/sanitize.ts

const ALLOWED_HEADERS = new Set([
  "content-type", "accept", "user-agent", "x-title", "http-referer",
  "referer", "x-request-id", "x-literouter-model", "x-literouter-tier",
  "x-literouter-chain", "x-session-id", "anthropic-version",
  "retry-after", "x-ratelimit-limit-requests", "x-ratelimit-remaining-requests",
]);

const REDACTED_HEADERS = new Set([
  "authorization", "x-api-key", "api-key", "x-goog-api-key",
  "cookie", "set-cookie",
]);

export function sanitizeHeaders(headers: Headers | Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  const entries = headers instanceof Headers ? headers.entries() : Object.entries(headers);

  for (const [key, value] of entries) {
    const lower = key.toLowerCase();
    if (REDACTED_HEADERS.has(lower)) {
      result[lower] = "[REDACTED]";
    } else if (ALLOWED_HEADERS.has(lower)) {
      result[lower] = value;
    }
    // All other headers are silently dropped from traces (defense in depth)
  }
  return result;
}
```

**Why allowlist beats regex**: A new provider key format that doesn't match any regex pattern is automatically excluded by the structural guarantee — unknown headers are never stored. The regex approach from redesign01 would leak novel key formats.

Additionally, as a defense-in-depth secondary pass, body content undergoes regex scrubbing for known key patterns (same patterns as redesign01) to catch keys embedded in user message content or error bodies.

### 10.3 RAM Ring Buffer

```typescript
// src/telemetry/ring_buffer.ts

interface SanitizedTrace {
  reqId: string;
  createdAt: number;
  provider: string;
  model: string;
  status: number;
  durationMs: number;
  ttftMs?: number;
  tokensPrompt?: number;
  tokensCompletion?: number;
  legs: {
    clientInbound: string;    // Sanitized JSON, max 64KB
    upstreamOutbound: string;
    upstreamInbound: string;
    clientOutbound: string;
  };
}

const MAX_TRACES = 100;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;  // 32MB
const MAX_LEG_BYTES = 64 * 1024;            // 64KB per leg

class TraceRingBuffer {
  private readonly buffer = new Map<string, SanitizedTrace>();
  private readonly order: string[] = [];
  private totalBytes = 0;

  push(trace: SanitizedTrace): void {
    // Truncate oversized legs
    for (const legKey of ["clientInbound", "upstreamOutbound", "upstreamInbound", "clientOutbound"] as const) {
      if (trace.legs[legKey].length > MAX_LEG_BYTES) {
        const originalSize = trace.legs[legKey].length;
        trace.legs[legKey] = trace.legs[legKey].slice(0, MAX_LEG_BYTES) +
          `\n... [TRUNCATED: original ${originalSize} bytes]`;
      }
    }

    const traceSize = this.estimateSize(trace);

    // Evict oldest until within bounds
    while (
      (this.buffer.size >= MAX_TRACES || this.totalBytes + traceSize > MAX_TOTAL_BYTES) &&
      this.order.length > 0
    ) {
      this.evictOldest();
    }

    this.buffer.set(trace.reqId, trace);
    this.order.push(trace.reqId);
    this.totalBytes += traceSize;
  }

  get(reqId: string): SanitizedTrace | undefined {
    return this.buffer.get(reqId);
  }

  getRecent(n: number): SanitizedTrace[] {
    return this.order.slice(-n).reverse().map(id => this.buffer.get(id)!).filter(Boolean);
  }

  getErrors(n: number): SanitizedTrace[] {
    return this.getRecent(MAX_TRACES).filter(t => t.status >= 400).slice(0, n);
  }

  private evictOldest(): void {
    const id = this.order.shift();
    if (id) {
      const trace = this.buffer.get(id);
      if (trace) {
        this.totalBytes -= this.estimateSize(trace);
        this.buffer.delete(id);
      }
    }
  }

  private estimateSize(trace: SanitizedTrace): number {
    return trace.legs.clientInbound.length +
           trace.legs.upstreamOutbound.length +
           trace.legs.upstreamInbound.length +
           trace.legs.clientOutbound.length + 512; // metadata overhead
  }
}

export const traceBuffer = new TraceRingBuffer();
```

### 10.4 Lazy SQLite Writer

```typescript
// src/telemetry/trace_writer.ts

import { Database } from "bun:sqlite";

const FLUSH_INTERVAL_MS = 30_000;
const FLUSH_COUNT_THRESHOLD = 100;
const FLUSH_BYTES_THRESHOLD = 16 * 1024 * 1024; // 16MB
const RETENTION_DAYS = 30;

class TraceWriter {
  private db: Database | null = null;
  private queue: SanitizedTrace[] = [];
  private queueBytes = 0;
  private flushTimer: Timer | null = null;
  private initError: Error | null = null;

  init(): void {
    try {
      this.db = new Database("logs/traces.db", { create: true });
      this.db.exec("PRAGMA journal_mode = WAL");
      this.db.exec("PRAGMA synchronous = NORMAL");
      this.db.exec(SCHEMA_SQL);
      this.pruneOldTraces();
      this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
    } catch (err) {
      // SQLite init failure is NON-FATAL. Gateway continues without persistence.
      // Traces remain in RAM ring buffer only.
      this.initError = err instanceof Error ? err : new Error(String(err));
      console.error(`[TraceWriter] SQLite init failed (non-fatal, RAM-only mode): ${this.initError.message}`);
    }
  }

  enqueue(trace: SanitizedTrace): void {
    if (this.initError) return; // SQLite unavailable, silently skip persistence

    this.queue.push(trace);
    this.queueBytes += JSON.stringify(trace).length;

    if (this.queue.length >= FLUSH_COUNT_THRESHOLD || this.queueBytes >= FLUSH_BYTES_THRESHOLD) {
      this.flush();
    }
  }

  flush(): void {
    if (!this.db || this.queue.length === 0) return;

    try {
      const insert = this.db.prepare(INSERT_SQL);
      const tx = this.db.transaction((traces: SanitizedTrace[]) => {
        for (const t of traces) {
          insert.run(
            t.reqId, t.createdAt, t.provider, t.model, t.status,
            t.durationMs, t.ttftMs ?? null,
            t.tokensPrompt ?? null, t.tokensCompletion ?? null,
            t.legs.clientInbound, t.legs.upstreamOutbound,
            t.legs.upstreamInbound, t.legs.clientOutbound,
          );
        }
      });
      tx(this.queue);
    } catch (err) {
      // Flush failure is non-fatal. Log and continue.
      console.error(`[TraceWriter] Flush failed (${this.queue.length} traces lost): ${err}`);
    } finally {
      this.queue = [];
      this.queueBytes = 0;
    }
  }

  /** Synchronous drain on process exit. */
  drainSync(): void {
    this.flush();
    if (this.flushTimer) clearInterval(this.flushTimer);
    this.db?.close();
  }

  private pruneOldTraces(): void {
    if (!this.db) return;
    try {
      this.db.exec(`DELETE FROM request_traces WHERE created_at < ${Date.now() - RETENTION_DAYS * 86400000}`);
    } catch (err) {
      console.error(`[TraceWriter] Prune failed (non-fatal): ${err}`);
    }
  }
}

export const traceWriter = new TraceWriter();

// Register shutdown hooks
process.on("beforeExit", () => traceWriter.drainSync());
process.on("SIGINT", () => { traceWriter.drainSync(); process.exit(0); });
process.on("SIGTERM", () => { traceWriter.drainSync(); process.exit(0); });
```

**Acknowledged data loss window**: On `SIGKILL` (uncatchable) or kernel OOM kill, up to 30 seconds of traces in the SQLite queue are lost. The RAM ring buffer is also lost. This is acceptable for a diagnostic subsystem. Traces are for debugging, not for billing or compliance.

### 10.5 Trace Inspection Endpoint

```typescript
// Registered in src/index.ts route dispatcher

// GET /v1/traces/:reqId
// GET /v1/traces?errors=true&n=5
```

**Authentication**: Trace endpoints require the same directive-key authorization as other endpoints. They are NOT auth-free like `/health`. An unauthenticated request to `/v1/traces` returns `401`.

### 10.6 Diagnostic CLI

```bash
# Query by request ID (hits RAM first, then SQLite)
bun run scripts/trace.ts <req_id>

# Recent errors
bun run scripts/trace.ts --errors -n 5

# Recent traces for a provider
bun run scripts/trace.ts --provider or -n 10
```

---

## 11. Unified Dispatch Engine (`src/engine/dispatch.ts`)

### 11.1 Dispatch Pipeline Contract

```typescript
// src/engine/dispatch.ts

export interface DispatchRequest {
  readonly reqId: string;
  readonly method: string;
  readonly path: string;
  readonly directive: ParsedDirective;
  readonly rawInboundBody: Record<string, unknown>;
  readonly outboundPayload: OutboundWirePayload;
  readonly clientSignal: AbortSignal;
  readonly clientHeaders: Headers;
  readonly transformer: PayloadTransformerContract;
}

export async function executeDispatchPipeline(req: DispatchRequest): Promise<Response> {
  // 1. Resolve provider config from registry
  const provConfig = getProviderConfig(req.directive.provider);
  const strategy = getStrategy(req.directive.provider);

  // 2. Create telemetry session
  const telemetry = new RequestTelemetry({ /* ... from req ... */ });
  telemetry.emitInbound();

  // 3. Circuit breaker gate
  const breaker = getCircuitBreaker(req.directive.provider, provConfig.circuit_breaker);
  if (breaker.isOpen()) {
    telemetry.error("Circuit breaker open");
    telemetry.served(503);
    return breaker.rejectResponse(provConfig.name);
  }

  // 4. Strategy pre-dispatch hook (billing guardrails, model validation)
  const preResult = strategy.preDispatch?.({ /* ctx */ }, req.rawInboundBody);
  if (preResult) {
    telemetry.served(preResult.status);
    return preResult;
  }

  // 5. Attempt loop
  const retryConfig = provConfig.request_retry;
  const maxAttempts = retryConfig.enabled ? retryConfig.max_attempts : 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // 5a. Pacer acquisition (provider-level FIFO)
    await acquirePacer(req.directive.provider, provConfig.pacer, req.clientSignal);

    // 5b. Key selection
    const key = await selectKey(req.directive.provider, req.clientSignal);
    if (!key) {
      telemetry.error("All keys exhausted or in cooldown");
      telemetry.served(429);
      return exhaustedResponse(provConfig.name);
    }

    // 5c. Strategy target resolution (cascade model selection, URL building)
    const target = strategy.resolveTarget?.(ctx, req.rawInboundBody) ?? defaultTarget(provConfig, req);

    // 5d. Build outbound headers (strategy auth + provider declarative headers)
    const authHeaders = strategy.buildAuthHeaders?.(key.value) ?? defaultAuthHeaders(provConfig, key.value);
    const injectedHeaders = strategy.injectHeaders?.(ctx, authHeaders) ?? authHeaders;
    const finalHeaders = { ...injectedHeaders, ...provConfig.headers }; // Declarative headers ALWAYS merge

    // 5e. Upstream fetch with TTFT guard
    try {
      const upstreamResponse = await fetchWithTtftGuard(target.upstreamUrl, {
        method: req.outboundPayload.method,
        headers: finalHeaders,
        body: JSON.stringify(req.outboundPayload.body),
        signal: req.clientSignal,
      });

      // 5f. Classify response
      if (upstreamResponse.status < 400) {
        // SUCCESS
        breaker.recordSuccess();
        if (provConfig.key_cooldown.reset_after_success) {
          resetKeyFailureStreak(req.directive.provider, key.index);
        }

        // Handle streaming or non-streaming response via transformer
        if (req.outboundPayload.isStreaming) {
          const stream = req.transformer.createWireToClientStream(req.directive, telemetry, req.clientSignal);
          // Pipe upstream body through transformer stream, then to client
          // telemetry.markTtft() called inside stream on first content chunk
          // telemetry.recordUsage() called inside stream on final chunk
          telemetry.served(upstreamResponse.status, attempt, maxAttempts);
          return new Response(upstreamResponse.body!.pipeThrough(stream), { /* headers */ });
        } else {
          const body = await upstreamResponse.json();
          const translated = req.transformer.transformWireToClient(body, req.directive);
          telemetry.recordUsage(extractUsage(body));
          telemetry.served(upstreamResponse.status, attempt, maxAttempts);
          return new Response(JSON.stringify(translated), { /* headers */ });
        }
      }

      // FAILURE CLASSIFICATION
      const classification = strategy.classifyFailure?.(ctx, upstreamResponse.status)
        ?? defaultClassifyFailure(upstreamResponse.status);

      if (classification === "fail_fast") {
        breaker.recordFailure(upstreamResponse.status);
        telemetry.served(upstreamResponse.status, attempt, maxAttempts);
        return upstreamResponse; // Pass through error to client
      }

      if (classification === "advance_target") {
        // Strategy advanced the cascade target — retry with new model
        telemetry.rotateKey({ /* ... */ });
        continue;
      }

      // classification === "retry_same_target"
      handleKeyCooldown(req.directive.provider, key.index, upstreamResponse.status, provConfig.key_cooldown);
      breaker.recordFailure(upstreamResponse.status);
      telemetry.recordLimit({ status: upstreamResponse.status });

      if (attempt < maxAttempts) {
        // Bounded jitter delay before next attempt
        const delayMs = calculateRetryDelay(retryConfig.delay, attempt);
        await Bun.sleep(delayMs);
        telemetry.rotateKey({ fromIndex: key.index, toIndex: -1, totalKeys: key.poolSize, attempt: attempt + 1, maxAttempts });
        continue;
      }

    } catch (err) {
      if (err instanceof NoResponseError) {
        // Ghost response — upstream accepted but sent no content
        breaker.recordFailure(0);
        telemetry.error("Ghost response (NoResponseError)", err);
        if (attempt < maxAttempts) {
          const delayMs = calculateRetryDelay(retryConfig.delay, attempt);
          await Bun.sleep(delayMs);
          continue;
        }
      }
      throw err; // Unrecoverable
    }
  }

  // All attempts exhausted
  telemetry.error("All retry attempts exhausted");
  telemetry.served(502);
  return exhaustedResponse(provConfig.name);
}
```

### 11.2 Retry Delay Calculation

```typescript
// src/engine/retry.ts

export function calculateRetryDelay(
  config: { min_ms: number; max_ms: number },
  attempt: number
): number {
  // Uniform random jitter between min_ms and max_ms
  const range = config.max_ms - config.min_ms;
  const jitter = Math.random() * range;
  return Math.round(config.min_ms + jitter);
}
```

**Why not exponential backoff for retries?** The `request_retry` delay is a fast relay breath between keys (150-300ms). We want prompt resilience, not key punishment. Key punishment is handled by `key_cooldown` with its own exponential backoff. Mixing two exponential backoffs would create excessively long waits for the downstream editor.

### 11.3 Key Cooldown Calculation

```typescript
// src/engine/cooldown.ts

export function calculateCooldownMs(
  config: KeyCooldownConfig,
  consecutiveFailures: number,
  retryAfterMs?: number
): number {
  if (retryAfterMs && config.respect_retry_after) {
    return retryAfterMs;  // Upstream Retry-After takes precedence
  }

  // Exponential backoff: initial * factor^failures
  const raw = config.initial_cooldown_ms * Math.pow(config.backoff_factor, consecutiveFailures);
  const capped = Math.min(raw, config.max_cooldown_ms);

  // Apply jitter: ± jitter_percent
  const jitterRange = capped * (config.jitter_percent / 100);
  const jitter = (Math.random() * 2 - 1) * jitterRange; // -jitterRange to +jitterRange

  return Math.round(Math.max(0, capped + jitter));
}
```

### 11.4 HTTP Status Classification (Deterministic)

```typescript
// src/engine/status_classify.ts

export type FailureAction = "fail_fast" | "retry_same_target" | "advance_target";

const FAIL_FAST_STATUSES = new Set([400, 404, 413, 414, 422, 451, 501, 505]);
const KEY_ROTATION_STATUSES = new Set([401, 403, 429]);
const TRANSIENT_RETRY_STATUSES = new Set([500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526]);

export function defaultClassifyFailure(status: number): FailureAction {
  if (FAIL_FAST_STATUSES.has(status)) return "fail_fast";
  if (KEY_ROTATION_STATUSES.has(status)) return "retry_same_target";
  if (TRANSIENT_RETRY_STATUSES.has(status)) return "retry_same_target";
  return "fail_fast"; // Unknown status = don't retry
}
```

### 11.5 Mid-Stream Cutoff Rule

Once the first byte/chunk has been committed (piped to the downstream client via `ReadableStream`):

1. The response is **committed**. The HTTP status and headers have been sent.
2. Any subsequent upstream error cleanly terminates the SSE stream with `data: [DONE]\n\n`.
3. No secondary re-execution occurs.
4. The telemetry records the partial response.
5. The circuit breaker records a failure (if the upstream error was in a retryable category).

This prevents corrupting editor buffers (Claude Code, OpenCode) that are parsing a partially-received SSE stream.

### 11.6 Mandatory Client Attribution Headers

The dispatch engine MUST merge `providerConfig.headers` (from `config/providers.json`) into every outbound upstream request. For OpenRouter and Zen, this includes:

```http
HTTP-Referer: https://opencode.ai
X-Title: OpenCode
User-Agent: OpenCode/1.18.29
```

These headers are merged AFTER strategy headers and auth headers, so they cannot be accidentally overridden. The merge order is:
1. Strategy auth headers (`buildAuthHeaders`)
2. Strategy injected headers (`injectHeaders`)
3. Provider declarative headers (`providerConfig.headers`) — **WINS on conflict**

### 11.7 Pacer Conveyor Logic

The existing `src/network/pacer.ts` (`RequestPacer` with `FastFifoQueue`) is reused with one modification: configuration now comes from `config/providers.json` instead of env vars.

```typescript
// In dispatch engine:
function acquirePacer(provider: string, pacerConfig: ProviderPacerConfig | undefined, signal: AbortSignal): Promise<void> {
  if (!pacerConfig?.enabled) return Promise.resolve();

  const pacer = getPacerForProvider(provider, 0, {
    minIntervalMs: pacerConfig.min_delay_ms,
    maxQueueDepth: pacerConfig.max_queue_depth,
    maxQueueWaitMs: pacerConfig.max_queue_wait_ms,
  });

  return pacer.acquire(signal).then(() => {});
}
```

The pacer `max_delay_ms` is used as the upper bound for inter-dispatch jitter spacing. The pacer selects a random delay in `[min_delay_ms, max_delay_ms]` for each dispatch tick.

---

## 12. Payload Transformer Contract

### 12.1 Interface

```typescript
// src/engine/transformer.ts

import type { ParsedDirective } from "../directive/types";
import type { RequestTelemetry } from "../telemetry/session";

export interface OutboundWirePayload {
  readonly endpointKey: string;  // "ch", "ms", "rs", "gc", "ob"
  readonly method: "POST" | "GET";
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown>;
  readonly isStreaming: boolean;
}

export interface PayloadTransformerContract {
  /** Pure: converts client request body to upstream wire format */
  transformClientToWire(
    inboundBody: Record<string, unknown>,
    directive: ParsedDirective,
    headers: Headers
  ): OutboundWirePayload;

  /** Pure: converts upstream non-streaming response to client format */
  transformWireToClient(
    upstreamJson: unknown,
    directive: ParsedDirective
  ): unknown;

  /**
   * Returns a TransformStream for streaming response translation.
   *
   * DESIGN NOTE: This method receives `telemetry` because the stream transformer
   * must call `telemetry.markTtft()` on first content chunk and
   * `telemetry.recordUsage()` on final chunk. This is a pragmatic trade-off:
   * the alternative (dispatch engine parsing every SSE chunk across 5 different
   * wire formats) would require the engine to understand all wire formats,
   * which defeats decoupling.
   *
   * The telemetry dependency is injectable and mockable in tests.
   */
  createWireToClientStream(
    directive: ParsedDirective,
    telemetry: RequestTelemetry,
    clientSignal: AbortSignal
  ): TransformStream<Uint8Array, Uint8Array>;
}
```

### 12.2 Telemetry Coupling Rationale

The audit correctly identified that `createWireToClientStream` taking `RequestTelemetry` makes the transformer "not purely stateless." This is an intentional, documented trade-off:

- **Option A** (rejected): Dispatch engine parses all SSE formats (OpenAI, Anthropic, Google, Responses). This makes the engine format-aware, defeating the entire purpose of decoupling.
- **Option B** (rejected): Emit telemetry events via EventEmitter or callback. This adds complexity without reducing coupling.
- **Option C** (chosen): Transformer receives a narrow telemetry interface. The transformer calls `markTtft()` and `recordUsage()`. The telemetry object is injectable and trivially mockable in tests (`{ markTtft: () => {}, recordUsage: () => {} }`).

The transformer remains **functionally deterministic** for its primary job (byte transformation). The telemetry calls are side effects that do not affect the output bytes.

### 12.3 Transformer Implementations (One Per Wire Format)

| Wire | Transformer Source | Extracted From |
|------|-------------------|----------------|
| `oa` (OpenAI Chat) | `src/transformers/openai_chat.ts` | `src/handlers/openai_compat.ts` payload/stream logic |
| `oo` (OpenAI Responses) | `src/transformers/openai_responses.ts` | `src/handlers/openai_original.ts` payload/stream logic |
| `cl` (Anthropic Messages) | `src/transformers/anthropic_messages.ts` | `src/handlers/anthropic_compat.ts` translate functions |
| `ao` (Anthropic→OpenAI cross-wire) | `src/transformers/anthropic_openai_xwire.ts` | `src/handlers/anthropic_compat.ts` cross-wire logic |
| `gg` (Google Native) | `src/transformers/google_native.ts` | `src/handlers/google_native.ts` request/response format |

Each transformer is extracted by moving the PURE transformation functions out of the handler files. The execution mechanics (retry, pacer, fetch) stay behind in the handler (for legacy path) and are deleted when legacy path is removed.

---

## 13. Environment Cleanup

### 13.1 Purge Table

Identical to redesign01 Section 3.3B. Every purged knob has a new home in `config/providers.json`.

### 13.2 Deprecation Warnings at Boot

**Critical gap from redesign01 fixed here.** When the v4 engine boots, it checks for purged env vars and emits warnings:

```typescript
// src/config/deprecation.ts

const DEPRECATED_ENV_VARS: Record<string, string> = {
  "LITEROUTER_AUTH_KEY": "Removed. Client auth uses directive keys (lr-...).",
  "LITEROUTER_PACER_ENABLED": "Moved to config/providers.json -> pacer.enabled",
  "LITEROUTER_PACER_MAX_RPM": "Moved to config/providers.json -> pacer.min_delay_ms",
  "LITEROUTER_PACER_MAX_QUEUE_DEPTH": "Moved to config/providers.json -> pacer.max_queue_depth",
  "LITEROUTER_PACER_MAX_QUEUE_WAIT_MS": "Moved to config/providers.json -> pacer.max_queue_wait_ms",
  "COOLDOWN_RATE_LIMIT_TTL_SEC": "Moved to config/providers.json -> key_cooldown",
  "COOLDOWN_SERVER_ERROR_TTL_SEC": "Moved to config/providers.json -> key_cooldown",
  "COOLDOWN_AUTH_ERROR_TTL_SEC": "Moved to config/providers.json -> key_cooldown",
  "OPENROUTER_BASE_URL": "Moved to config/providers.json -> base_url",
  "NVIDIA_BASE_URL": "Moved to config/providers.json -> base_url",
  "OPENROUTER_MIN_DELAY_MS": "Moved to config/providers.json -> pacer.min_delay_ms",
  "NVIDIA_MIN_DELAY_MS": "Moved to config/providers.json -> pacer.min_delay_ms",
  "ZEN_MIN_DELAY_MS": "Moved to config/providers.json -> pacer.min_delay_ms",
  "GOOGLE_MIN_DELAY_MS": "Moved to config/providers.json -> pacer.min_delay_ms",
  "GCP_MIN_DELAY_MS": "Moved to config/providers.json -> pacer.min_delay_ms",
  "GCP_PACER_MAX_QUEUE_WAIT_MS": "Moved to config/providers.json -> pacer.max_queue_wait_ms",
  "GCP_ENABLE_RETRIES": "Moved to config/providers.json -> request_retry.enabled",
  "GCP_ENABLE_QUARANTINE": "Moved to config/providers.json -> key_cooldown.enabled",
  "GCP_ENABLE_CIRCUIT_BREAKER": "Moved to config/providers.json -> circuit_breaker.enabled",
  "GCP_ENABLE_PACER": "Moved to config/providers.json -> pacer.enabled",
  "ZEN_ENABLE_RETRIES": "Moved to config/providers.json -> request_retry.enabled (strategy: zen_single_flight)",
  "ZEN_ENABLE_QUARANTINE": "Moved to config/providers.json -> key_cooldown.enabled",
  "ZEN_ENABLE_CIRCUIT_BREAKER": "Moved to config/providers.json -> circuit_breaker.enabled",
  "ZEN_ENABLE_PACER": "Moved to config/providers.json -> pacer.enabled",
  "LITEROUTER_HTTP_REFERER": "Moved to config/providers.json -> headers",
  "LITEROUTER_X_TITLE": "Moved to config/providers.json -> headers",
  "LITEROUTER_USER_AGENT": "Moved to config/providers.json -> headers",
  "OPENROUTER_ENABLE_QUARANTINE": "Moved to config/providers.json -> key_cooldown.enabled",
  "LITEROUTER_CIRCUIT_BREAKER": "Moved to config/providers.json -> circuit_breaker.enabled",
};

export function emitEnvDeprecationWarnings(): void {
  for (const [envVar, message] of Object.entries(DEPRECATED_ENV_VARS)) {
    if (process.env[envVar] !== undefined) {
      console.warn(`⚠️  [DEPRECATION] "${envVar}" is set but IGNORED in v4 engine. ${message}`);
    }
  }
}
```

**These warnings are only emitted when `LITEROUTER_ENGINE=v4`.** In `legacy` mode, the env vars are still consumed as before.

---

## 14. Graceful Shutdown

### 14.1 In-Flight Request Draining

On `SIGTERM` or `SIGINT`:

1. Stop accepting new connections (close the listener).
2. Wait up to `LITEROUTER_IDLE_TIMEOUT_SEC` (default: 60s) for in-flight requests to complete.
3. For each in-flight streaming response that hasn't finished:
   a. Emit `data: [DONE]\n\n` to cleanly terminate the SSE stream.
   b. Close the response.
4. Flush SQLite trace writer (`traceWriter.drainSync()`).
5. Close HTTP/2 pool sessions.
6. Exit.

### 14.2 Implementation Sketch

```typescript
// src/lifecycle/shutdown.ts

let draining = false;
const inFlightRequests = new Set<string>();

export function registerInFlight(reqId: string): void {
  inFlightRequests.add(reqId);
}

export function deregisterInFlight(reqId: string): void {
  inFlightRequests.delete(reqId);
  if (draining && inFlightRequests.size === 0) {
    finalizeDrain();
  }
}

function initiateDrain(): void {
  draining = true;
  console.log(`[SHUTDOWN] Draining ${inFlightRequests.size} in-flight requests...`);

  // Hard deadline: force exit after timeout
  const timeout = (getEnv().LITEROUTER_IDLE_TIMEOUT_SEC ?? 60) * 1000;
  setTimeout(() => {
    console.warn(`[SHUTDOWN] Drain timeout reached. Force exiting with ${inFlightRequests.size} requests abandoned.`);
    finalizeDrain();
  }, timeout);
}

function finalizeDrain(): void {
  traceWriter.drainSync();
  // closeH2Pool();
  process.exit(0);
}

process.on("SIGTERM", initiateDrain);
process.on("SIGINT", initiateDrain);
```

---

## 15. Phased Implementation & Validation Protocol

```
┌──────────────────────────────────────────────────────────────────┐
│ PHASE 0: Baseline & Safety                                       │
│ ────────────────────────                                         │
│ • git branch v4.0 (backup current main)                          │
│ • Bump package.json: 4.0.0 → 4.1.0                              │
│ • Add LITEROUTER_ENGINE env var to env.ts (default: "legacy")    │
│ • Add dual-path dispatch in src/index.ts                         │
│ • Verify: bun test passes, legacy path is default                │
│                                                                  │
│ Gate: git branch shows v4.0                                      │
│       bun test exit code 0                                       │
│       curl health returns 200                                    │
│       LITEROUTER_ENGINE=legacy is operational                    │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│ PHASE 1: Configuration Foundation                                │
│ ────────────────────────────────                                 │
│ Files created/modified:                                          │
│   • src/config/schema.ts (extend with new Zod schemas)           │
│   • src/config/providers.ts (new: in-memory registry)            │
│   • src/config/deprecation.ts (new: env deprecation warnings)    │
│   • config/providers.json (extend with new optional fields)      │
│   • src/index.ts (wire boot load + POST /reset reload)           │
│                                                                  │
│ Test coverage required:                                          │
│   • Schema validation: valid config parses; missing fields       │
│     use defaults; invalid min/max rejected                       │
│   • Registry: getProviderConfig by code and name; unknown        │
│     provider throws; getAllProviders returns all                  │
│   • Backward compat: current providers.json (no new fields)      │
│     parses without errors                                        │
│   • Hot reload: initProviderRegistry called twice; second        │
│     call with modified JSON; old queries return new values        │
│   • Atomic reload: initProviderRegistry with invalid JSON;       │
│     old registry preserved                                       │
│   • Deprecation: mock env with deprecated vars; warnings emitted │
│                                                                  │
│ Gate: bun test exit code 0                                       │
│       bun run typecheck exit code 0                              │
│       Legacy path still operational (LITEROUTER_ENGINE=legacy)   │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│ PHASE 2: Telemetry Engine                                        │
│ ────────────────────────                                         │
│ Files created:                                                   │
│   • src/telemetry/session.ts (RequestTelemetry class)            │
│   • src/telemetry/sanitize.ts (header/body sanitization)         │
│   • src/telemetry/ring_buffer.ts (RAM ring buffer)               │
│   • src/telemetry/trace_writer.ts (lazy SQLite flusher)          │
│   • src/telemetry/hooks.ts (MetricsHook interface, noop impl)    │
│   • scripts/trace.ts (CLI inspection tool)                       │
│                                                                  │
│ Test coverage required:                                          │
│   • RequestTelemetry: TTFT calculation accurate; idempotent      │
│     markTtft; speed calculation correct; duration monotonic       │
│   • Sanitize: auth headers redacted; allowed headers preserved;  │
│     unknown headers dropped; body key patterns scrubbed          │
│   • Ring buffer: max 100 traces; oversized leg truncated at      │
│     64KB; 32MB total cap; eviction is FIFO; getErrors filters    │
│   • Trace writer: flush on count/bytes threshold; drainSync      │
│     writes all queued; init failure = non-fatal RAM-only mode    │
│   • Trace writer: prune deletes traces > 30 days                 │
│   • Sanitize: regression test with each known key format         │
│     (sk-or-v1-..., nvapi-..., AIzaSy..., sk-lr-...)             │
│                                                                  │
│ Gate: bun test exit code 0                                       │
│       bun run typecheck exit code 0                              │
│       Legacy path unaffected                                     │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│ PHASE 3: Dispatch Engine & Strategies                            │
│ ──────────────────────────────────                               │
│ Files created:                                                   │
│   • src/engine/strategy.ts (ProviderExecutionStrategy interface) │
│   • src/engine/strategy_registry.ts (boot-time wiring)           │
│   • src/engine/dispatch.ts (unified dispatch pipeline)           │
│   • src/engine/retry.ts (calculateRetryDelay)                    │
│   • src/engine/cooldown.ts (calculateCooldownMs)                 │
│   • src/engine/status_classify.ts (HTTP status classification)   │
│   • src/engine/strategies/standard.ts                            │
│   • src/engine/strategies/native_cascade.ts                      │
│   • src/engine/strategies/gcp_guarded.ts                         │
│   • src/engine/strategies/zen_single_flight.ts                   │
│   • src/engine/strategies/anthropic_direct.ts                    │
│   • src/lifecycle/shutdown.ts (graceful drain)                    │
│                                                                  │
│ Test coverage required:                                          │
│   • calculateRetryDelay: output in [min, max] range; 1000+       │
│     samples verify uniform distribution bounds                   │
│   • calculateCooldownMs: exponential growth correct; capped at   │
│     max; jitter within ±percent; Retry-After override works;     │
│     success reset clears streak                                  │
│   • Status classification: every status code in FAIL_FAST,       │
│     KEY_ROTATION, TRANSIENT_RETRY sets tested; unknown = fail    │
│   • Circuit breaker: CLOSED→OPEN on threshold failures within    │
│     window; OPEN rejects with 503; OPEN→HALF_OPEN after timeout; │
│     HALF_OPEN→CLOSED on success threshold; HALF_OPEN→OPEN on     │
│     probe failure; 429 does NOT count as breaker failure          │
│   • NativeCascadeStrategy: resolveTarget returns sticky tier;    │
│     classifyFailure returns advance_target on 404; tier wraps    │
│     around; non-chain models pass through                        │
│   • GcpGuardedStrategy: preDispatch blocks non-Gemma with 403;  │
│     allows gemma-4-31b; strips gcp/ prefix; buildAuthHeaders    │
│     includes both Bearer and x-goog-api-key                     │
│   • ZenSingleFlightStrategy: classifyFailure = fail_fast when   │
│     ZEN_ENABLE_RETRIES=false; injectHeaders adds session-id     │
│   • AnthropicDirectStrategy: buildAuthHeaders uses x-api-key    │
│   • Dispatch pipeline (integration): mock upstream server;       │
│     verify retry on 429 with jitter delay; verify key rotation;  │
│     verify circuit breaker trips after threshold; verify          │
│     mid-stream cutoff rule; verify ghost response detection;     │
│     verify mandatory client attribution headers present on       │
│     upstream request; verify pacer spacing                       │
│   • Shutdown: in-flight tracking; drain timeout                  │
│                                                                  │
│ Gate: bun test exit code 0                                       │
│       bun run typecheck exit code 0                              │
│       Legacy path unaffected                                     │
│       LITEROUTER_ENGINE=v4 boots without errors (no traffic yet) │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│ PHASE 4: Payload Transformers (Extract from Handlers)            │
│ ─────────────────────────────────────────────────────            │
│ Files created:                                                   │
│   • src/transformers/openai_chat.ts                              │
│   • src/transformers/openai_responses.ts                         │
│   • src/transformers/anthropic_messages.ts                       │
│   • src/transformers/anthropic_openai_xwire.ts                   │
│   • src/transformers/google_native.ts                            │
│   • src/engine/transformer.ts (PayloadTransformerContract)       │
│                                                                  │
│ Extraction process (per transformer):                            │
│ a. Identify pure transformation functions in the handler         │
│ b. Move them to the transformer file (zero logic changes)        │
│ c. Handler retains the functions as re-exports (backward compat) │
│ d. Transformer implements PayloadTransformerContract              │
│ e. Unit test transformer in isolation with static fixtures        │
│ f. Verify handler still works in legacy mode                     │
│                                                                  │
│ Execute one handler at a time. Gate after each:                   │
│                                                                  │
│ 4A: openai_chat transformer                                      │
│     Gate: bun test && LITEROUTER_ENGINE=legacy curl smoke OK     │
│                                                                  │
│ 4B: anthropic_messages transformer                               │
│     Gate: bun test && LITEROUTER_ENGINE=legacy curl smoke OK     │
│                                                                  │
│ 4C: google_native transformer                                    │
│     Gate: bun test && LITEROUTER_ENGINE=legacy curl smoke OK     │
│                                                                  │
│ 4D: openai_responses transformer                                 │
│     Gate: bun test && LITEROUTER_ENGINE=legacy curl smoke OK     │
│                                                                  │
│ 4E: anthropic_openai_xwire transformer                           │
│     Gate: bun test && LITEROUTER_ENGINE=legacy curl smoke OK     │
│                                                                  │
│ Test coverage required (per transformer):                        │
│   • transformClientToWire: static request in → wire payload out  │
│   • transformWireToClient: static upstream JSON → client JSON    │
│   • createWireToClientStream: mock SSE byte stream → verify      │
│     output bytes match expected; telemetry.markTtft called on    │
│     first content chunk; telemetry.recordUsage called on final   │
│   • Anthropic: translateAnthropicToOpenAI round-trip preserves   │
│     tool calls, system prompt, image blocks                      │
│   • Google Native: generateContent format differs from OpenAI;   │
│     streaming telemetry scanner detects finish/usage             │
│                                                                  │
│ Gate: ALL bun test pass                                          │
│       bun run typecheck exit code 0                              │
│       Both legacy and v4 paths boot cleanly                      │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│ PHASE 5: V4 Route Handlers (Thin Shims)                          │
│ ───────────────────────────────────────                          │
│ Files created:                                                   │
│   • src/handlers/v4/openai_chat.ts                               │
│   • src/handlers/v4/anthropic_messages.ts                        │
│   • src/handlers/v4/google_native.ts                             │
│   • src/handlers/v4/gcp_compat.ts                                │
│   • src/handlers/v4/openai_responses.ts                          │
│   • src/handlers/v4/router.ts (dispatchV4 function)              │
│                                                                  │
│ Each v4 handler is < 50 lines:                                   │
│   1. Parse request body                                          │
│   2. Extract and validate directive                              │
│   3. Select transformer based on wire format                     │
│   4. Call executeDispatchPipeline()                               │
│   5. Return response                                             │
│                                                                  │
│ Gate: LITEROUTER_ENGINE=v4 + full integration test suite         │
│       A/B comparison (§4.3): v4 produces identical outcomes      │
│       to legacy for all integration test scenarios               │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│ PHASE 6: A/B Validation & Default Flip                           │
│ ──────────────────────────────────────                           │
│ • Run LITEROUTER_ENGINE=legacy: full suite → record results      │
│ • Run LITEROUTER_ENGINE=v4: full suite → record results          │
│ • Compare: identical statuses, token counts, timing ±20%         │
│ • Downstream agent verification (§17.4):                         │
│   - OpenCode 2: lr-zn-oa-ch-no smoke test                       │
│   - Claude Code: lr-or-cl-ms-no smoke test                      │
│   - Pydantic AI: lr-nv-oa-ch-no smoke test                      │
│ • Flip default: LITEROUTER_ENGINE default → "v4"                 │
│                                                                  │
│ Gate: A/B parity confirmed                                       │
│       All 3 downstream agents verified                           │
│       Manual approval from operator                              │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────────┐
│ PHASE 7: Dead Code Cleanup (v4.2.0, SEPARATE PR)                 │
│ ────────────────────────────────────────────                     │
│ NOT part of v4.1. Only after v4 default has been stable for      │
│ 2+ weeks in production.                                          │
│                                                                  │
│ • Delete legacy handlers (execution mechanics only; pure          │
│   transformation functions already moved to src/transformers/)    │
│ • Delete src/ui/logger.ts (replaced by src/telemetry/)           │
│ • Delete deprecated env var support from src/config/env.ts       │
│ • Delete LITEROUTER_ENGINE flag (v4 is the only path)            │
│ • Purge dead env vars from .env.example                          │
│                                                                  │
│ Gate: bun test && uv run pytest tests/integration/               │
│       bun run typecheck                                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## 16. Test Strategy: Required Coverage Matrix

### 16.1 Unit Tests (bun test)

| Test File | What It Tests | Min Cases |
|-----------|---------------|-----------|
| `tests/unit/config/schema.test.ts` | Zod schema validation for all new schemas | 20+ |
| `tests/unit/config/providers.test.ts` | Registry init, lookup, hot reload, atomic failure | 10+ |
| `tests/unit/config/deprecation.test.ts` | Env deprecation warning emission | 5+ |
| `tests/unit/engine/retry.test.ts` | `calculateRetryDelay` bounds, distribution | 5+ |
| `tests/unit/engine/cooldown.test.ts` | Exponential backoff, cap, jitter, Retry-After | 10+ |
| `tests/unit/engine/status_classify.test.ts` | Every status code classification | 20+ |
| `tests/unit/engine/circuit_breaker.test.ts` | Full state machine (CLOSED→OPEN→HALF_OPEN→CLOSED, HALF_OPEN→OPEN) | 15+ |
| `tests/unit/engine/strategies/*.test.ts` | Each strategy's hooks | 25+ total |
| `tests/unit/engine/dispatch.test.ts` | Full dispatch pipeline with mock upstream | 20+ |
| `tests/unit/telemetry/session.test.ts` | TTFT, duration, speed, usage formatting | 10+ |
| `tests/unit/telemetry/sanitize.test.ts` | Header allowlist, body scrubbing, key patterns | 15+ |
| `tests/unit/telemetry/ring_buffer.test.ts` | Count cap, size cap, leg truncation, FIFO eviction | 10+ |
| `tests/unit/telemetry/trace_writer.test.ts` | Flush triggers, drain, init failure, prune | 10+ |
| `tests/unit/transformers/*.test.ts` | Each transformer's 3 contract methods | 30+ total |

### 16.2 Integration Tests (uv run pytest)

| Test | What It Validates |
|------|-------------------|
| `tests/integration/test_v4_smoke.py` | LITEROUTER_ENGINE=v4 boot, health, basic chat completion |
| `tests/integration/test_v4_ab_parity.py` | A/B: v4 vs legacy produce identical outcomes for shared test cases |
| `tests/integration/test_attribution_headers.py` | HTTP-Referer, X-Title, User-Agent present on upstream (via test provider echo) |
| `tests/integration/test_circuit_breaker.py` | Breaker trips after N failures, rejects with 503, recovers |
| `tests/integration/test_key_rotation.py` | 429 triggers rotation to next key; all keys exhausted returns 429 |
| `tests/integration/test_retry_jitter.py` | Retry delay is non-zero (> 100ms between retries) |
| `tests/integration/test_trace_endpoint.py` | `/v1/traces` returns sanitized traces; auth required |

### 16.3 Mandatory Test Properties

All tests MUST follow the test hygiene playbook (`.opencode2/skills/literouter/test-hygiene-playbook.md`):

- **Air-gapped**: Zero outbound network calls. Use `tp` (test provider) at `127.0.0.1:8999`.
- **No real keys**: All tests use mock stub tokens (`sk-test-stub-0001`).
- **Deterministic**: No flaky timing-dependent assertions. Use `Bun.sleep()` mocks where needed.
- **Teardown symmetry**: Every `beforeEach` has a matching `afterEach` that clears state.

---

## 17. Deployment & Operations Runbook

### 17.1 Pre-Flight Checklist

- [ ] `git branch` shows `v4.0` pointing to pre-migration commit
- [ ] `.env.local` permissions: `644`, root-owned (`bash scripts/protect.sh`)
- [ ] `.env.local` contains valid key lines for all `env_key` fields in `providers.json`
- [ ] `bun run typecheck` — 0 errors
- [ ] `bun test` — exit code 0
- [ ] `uv run pytest tests/integration/` — exit code 0
- [ ] `uv run ruff check .` — 0 errors

### 17.2 Deployment Sequence

```bash
# 1. Start with legacy (safe default)
export LITEROUTER_ENGINE=legacy
bash scripts/start.sh

# 2. Verify legacy is operational
curl -sk https://localhost:7766/health
bun run scripts/doctor.ts

# 3. Switch to v4 (when ready)
export LITEROUTER_ENGINE=v4
bash scripts/restart.sh

# 4. Verify v4 is operational
curl -sk https://localhost:7766/health
curl -sk -X POST https://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer lr-zn-oa-ch-no" \
  -H "Content-Type: application/json" \
  -d '{"model":"big-pickle","messages":[{"role":"user","content":"ping"}]}'
```

### 17.3 Hot Reload (Zero Downtime)

```bash
# Reload providers.json without restart
curl -sk -X POST https://localhost:7766/reset
```

Scope: Updates provider config (headers, retry settings, pacer rates, conserve rules).
Limitations: Cannot change port, host, TLS certs, or `LITEROUTER_ENGINE` flag.

### 17.4 Downstream Agent Verification

| Agent | Directive | Verification |
|-------|-----------|-------------|
| OpenCode 2 | `lr-zn-oa-ch-no` | Thinking block stripping + XML tool passthrough |
| Claude Code | `lr-or-cl-ms-no` | Anthropic Messages protocol + streaming input tokens |
| Pydantic AI | `lr-nv-oa-ch-no` | Structured JSON + HTTP/2 reuse |

### 17.5 Emergency Rollback (< 30 seconds)

```bash
# 1. Stop v4.1
bash scripts/stop.sh

# 2. Hard revert to v4.0
git reset --hard v4.0

# 3. Clean deps
bun install --frozen-lockfile

# 4. Restart proven v4.0
bash scripts/start.sh

# 5. Verify
curl -sk https://localhost:7766/health
bun run scripts/doctor.ts
```

### 17.6 Intermediate Rollback (Keep v4.1 Code, Use Legacy Path)

If v4 engine has issues but v4.1 code is otherwise fine:

```bash
# Just switch the flag — no code revert needed
export LITEROUTER_ENGINE=legacy
bash scripts/restart.sh
```

This is the primary advantage of the dual-path design. Full code rollback is the nuclear option.

---

## 18. Definition of Done

A phase is complete when ALL of these hold:

1. **Zero new runtime dependencies**: Only `zod` (existing) and `bun:sqlite` (built-in).
2. **`bun run typecheck`**: 0 errors.
3. **`bun test`**: exit code 0.
4. **`uv run pytest tests/integration/`**: exit code 0.
5. **`uv run ruff check .`**: 0 errors (Python test files).
6. **Legacy path operational**: `LITEROUTER_ENGINE=legacy` works identically to pre-v4.1.
7. **Zero API key leakage**: `.env.local` untouched. No keys in traces, logs, or test fixtures.
8. **Client attribution preserved**: `HTTP-Referer`, `X-Title`, `User-Agent` verified on upstream requests.
9. **Circuit breaker specified and tested**: Full state machine with trip/recovery tests.
10. **Fusion chains preserved**: `gemini-flash` cascade works identically in v4 path.
11. **GCP billing guardrail preserved**: Non-Gemma models blocked with 403 in v4 path.

---

## 19. File Inventory (New and Modified)

### New Files

| Path | Phase | Lines (Est.) | Purpose |
|------|-------|-------------|---------|
| `src/config/providers.ts` | 1 | 80 | In-memory provider registry |
| `src/config/deprecation.ts` | 1 | 50 | Env deprecation warnings |
| `src/telemetry/session.ts` | 2 | 150 | RequestTelemetry class |
| `src/telemetry/sanitize.ts` | 2 | 80 | Header/body sanitization |
| `src/telemetry/ring_buffer.ts` | 2 | 100 | RAM trace ring buffer |
| `src/telemetry/trace_writer.ts` | 2 | 120 | Lazy SQLite flusher |
| `src/telemetry/hooks.ts` | 2 | 25 | MetricsHook interface (noop) |
| `scripts/trace.ts` | 2 | 80 | CLI trace inspector |
| `src/engine/strategy.ts` | 3 | 60 | Strategy interface |
| `src/engine/strategy_registry.ts` | 3 | 40 | Boot-time strategy wiring |
| `src/engine/dispatch.ts` | 3 | 250 | Unified dispatch pipeline |
| `src/engine/retry.ts` | 3 | 15 | Retry delay calculation |
| `src/engine/cooldown.ts` | 3 | 30 | Key cooldown calculation |
| `src/engine/status_classify.ts` | 3 | 25 | HTTP status classification |
| `src/engine/strategies/standard.ts` | 3 | 10 | Default (no-op) strategy |
| `src/engine/strategies/native_cascade.ts` | 3 | 80 | Google model chain cascade |
| `src/engine/strategies/gcp_guarded.ts` | 3 | 40 | GCP billing guardrail |
| `src/engine/strategies/zen_single_flight.ts` | 3 | 35 | Zen session-id + single-flight |
| `src/engine/strategies/anthropic_direct.ts` | 3 | 20 | Anthropic x-api-key auth |
| `src/lifecycle/shutdown.ts` | 3 | 45 | Graceful drain |
| `src/engine/transformer.ts` | 4 | 30 | PayloadTransformerContract |
| `src/transformers/openai_chat.ts` | 4 | 200 | Extracted from handler |
| `src/transformers/openai_responses.ts` | 4 | 150 | Extracted from handler |
| `src/transformers/anthropic_messages.ts` | 4 | 250 | Extracted from handler |
| `src/transformers/anthropic_openai_xwire.ts` | 4 | 150 | Extracted from handler |
| `src/transformers/google_native.ts` | 4 | 150 | Extracted from handler |
| `src/handlers/v4/router.ts` | 5 | 60 | V4 route dispatcher |
| `src/handlers/v4/openai_chat.ts` | 5 | 30 | Thin v4 handler |
| `src/handlers/v4/anthropic_messages.ts` | 5 | 30 | Thin v4 handler |
| `src/handlers/v4/google_native.ts` | 5 | 30 | Thin v4 handler |
| `src/handlers/v4/gcp_compat.ts` | 5 | 30 | Thin v4 handler |
| `src/handlers/v4/openai_responses.ts` | 5 | 30 | Thin v4 handler |
| **Total new** | | **~2,530** | |

### Modified Files

| Path | Phase | Change |
|------|-------|--------|
| `src/config/schema.ts` | 1 | Add new Zod schemas (extend, not replace) |
| `src/config/env.ts` | 0-1 | Add `LITEROUTER_ENGINE` var, add fallback compatibility |
| `config/providers.json` | 1 | Add optional new fields to existing provider blocks |
| `src/index.ts` | 0 | Add dual-path dispatch, boot registry init, shutdown hooks |
| `src/ui/logger.ts` | 2 | Add registry fallback for display names (additive only) |
| `package.json` | 0 | Version bump 4.0.0 → 4.1.0 |

### Untouched Files (Explicitly)

| Path | Reason |
|------|--------|
| `src/handlers/openai_compat.ts` | Legacy path. Untouched until Phase 7 (v4.2.0). |
| `src/handlers/anthropic_compat.ts` | Legacy path. |
| `src/handlers/google_native.ts` | Legacy path. Functions may be IMPORTED by strategies, never modified. |
| `src/handlers/gcp_compat.ts` | Legacy path. |
| `src/handlers/openai_original.ts` | Legacy path. |
| `src/network/pacer.ts` | Reused by v4 engine. Config source changes, but pacer code is untouched. |
| `src/network/cooldown.ts` | Reused by legacy path. V4 engine uses new cooldown calculation. |
| `src/network/fetcher.ts` | Reused by both paths. Untouched. |
| `src/network/circuit_breaker.ts` | Legacy path. V4 engine has its own circuit breaker from providers.json config. |
| `src/network/h2_pool.ts` | Reused by both paths. Untouched. |
| `config/fusion.json` | Read-only by NativeCascadeStrategy. Untouched. |
| `.env.local` | **NEVER TOUCHED. INVIOLABLE.** |

---

## 20. Architectural Decision Log

| # | Decision | Rationale | Alternative Rejected |
|---|----------|-----------|---------------------|
| ADR-1 | Feature flag dual-path instead of big-bang rewrite | Enables A/B validation under real traffic; intermediate rollback without code revert | Monolithic rewrite on main (redesign01) — too risky |
| ADR-2 | Strategy pattern instead of unified engine | Providers have genuinely different semantics (cascades, guardrails, auth) | Monolithic dispatch that tries to handle all cases (redesign01) — creates god function |
| ADR-3 | Telemetry injected into stream transformer | Engine cannot parse 5 different SSE formats; transformer knows the format | EventEmitter-based telemetry — added complexity without gain |
| ADR-4 | Header allowlist for trace sanitization | Defense-in-depth: novel key formats in unknown headers are automatically excluded | Regex denylist (redesign01) — would leak novel key formats |
| ADR-5 | SQLite failure is non-fatal | Traces are diagnostic, not transactional; RAM ring buffer provides fallback | Fatal SQLite init — would prevent gateway boot over diagnostics |
| ADR-6 | 429 excluded from circuit breaker failures | Rate limits are per-key, not per-provider; key_cooldown handles 429 | Counting 429 as breaker failure — would trip breaker on normal key rotation |
| ADR-7 | Legacy handler code untouched until v4.2 | Minimizes blast radius; enables instant rollback by switching one env var | Inline editing of handlers (redesign01) — irreversible changes |
| ADR-8 | Retry delay is uniform random, not exponential | request_retry is fast relay between keys (150-300ms); key_cooldown already does exponential | Exponential retry + exponential cooldown — double exponential creates excessive waits |
| ADR-9 | providers.json new fields are all optional with defaults | Current providers.json validates unchanged; zero-breakage schema extension | Required fields (redesign01) — would require simultaneous JSON + code changes |
| ADR-10 | Env deprecation warnings, not hard failures | Existing Docker/CI scripts that set old vars continue to work; operators see migration path | Silent ignore (redesign01) — operators wouldn't know their config is unused |

---

*End of document. This blueprint is self-contained. A builder requires only this file, the existing codebase, and the AGENTS.md operational mandates.*
