# Architecture Plan: Provider Configuration Migration & In-Memory Store

- **Author**: LiteRouter Core Team
- **Tracking Issue**: `literouter-st5j`
- **Status**: Proposed / Alignment Complete
- **Target Files**: `config/providers.json`, `src/config/schema.ts`, `src/config/providers.ts`

---

## 1. Executive Summary

LiteRouter currently splits provider-related configuration across three disparate mechanisms:
1. **`.env` variables**: Scattered knobs like `OPENROUTER_MIN_DELAY_MS`, `ZEN_ENABLE_RETRIES`, `GCP_PACER_MAX_QUEUE_WAIT_MS`, alongside dead legacy parameters like `OPENROUTER_BASE_URL` and `REDIS_*`.
2. **Hardcoded code defaults**: Fixed retry attempt counts (`Math.min(3, poolSize)`), hardcoded URLs (`https://generativelanguage.googleapis.com`), and missing inter-attempt retry delays (0ms instant retries).
3. **`config/providers.json`**: An existing registry file that defines endpoints, base URLs, and headers, but is only parsed on-demand in `src/handlers/openai_compat.ts` rather than unified at boot time.

### Objectives
1. **Consolidate**: Move all provider-specific network topology, pacer rules, retry limits, bounded retry jitter, quarantine settings, and circuit breaker flags into `config/providers.json`.
2. **Eager In-Memory Store**: Load and validate `config/providers.json` into memory at server boot via `src/index.ts`. All handler lookups become $O(1)$ in-memory lookups with **zero runtime disk I/O**.
3. **Dynamic Lookups**: Replace all hardcoded attempt limits, endpoints, and delays with lookups against the in-memory provider configuration.
4. **Collision-Proof Jitter**: Incorporate bounded random jitter (`min_delay_ms` to `max_delay_ms`) on retries to eliminate "thundering herd" retry storms when concurrent agents hit rate limits.
5. **Hot Reloading**: Atomically re-validate and reload the provider configuration in RAM when `POST /reset` or `POST /admin/pool/reset` is called.
6. **Clean `.env`**: Strip dead and migrated parameters from `.env` and `.env.example`, leaving `.env` strictly for environment primitives (ports, host, TLS) and secret API keys.

---

## 2. Environment Audit: Current `.env` vs Target State

### Category A: Provider Settings to Move to `config/providers.json`

| Setting in `.env` | Current Usage | Target Location in `config/providers.json` |
|---|---|---|
| `OPENROUTER_MIN_DELAY_MS` | Pacer interval for `or` | `providers.openrouter.pacer.min_delay_ms` |
| `NVIDIA_MIN_DELAY_MS` | Pacer interval for `nv` | `providers.nvidia.pacer.min_delay_ms` |
| `ZEN_MIN_DELAY_MS` | Pacer interval for `zn` | `providers.zen.pacer.min_delay_ms` |
| `GOOGLE_MIN_DELAY_MS` | Pacer interval for `gg` | `providers.google.pacer.min_delay_ms` |
| `GCP_MIN_DELAY_MS` | Pacer interval for `gc` | `providers.gcp.pacer.min_delay_ms` |
| `GCP_PACER_MAX_QUEUE_WAIT_MS` | GCP pacer queue wait timeout | `providers.gcp.pacer.max_queue_wait_ms` |
| `TEST_PROVIDER_MIN_DELAY_MS` | Pacer interval for `tp` double | `providers.testprovider.pacer.min_delay_ms` |
| `OPENROUTER_ENABLE_QUARANTINE` | Quarantine toggle for `or` | `providers.openrouter.quarantine.enabled` |
| `ZEN_ENABLE_RETRIES` | Retry toggle for Zen | `providers.zen.retry.enabled` |
| `ZEN_ENABLE_QUARANTINE` | Quarantine toggle for Zen | `providers.zen.quarantine.enabled` |
| `ZEN_ENABLE_CIRCUIT_BREAKER`| Circuit breaker toggle for Zen | `providers.zen.circuit_breaker.enabled` |
| `ZEN_ENABLE_PACER` | Ingress pacer toggle for Zen | `providers.zen.pacer.enabled` |
| `GCP_ENABLE_RETRIES` | Retry toggle for GCP | `providers.gcp.retry.enabled` |
| `GCP_ENABLE_QUARANTINE` | Quarantine toggle for GCP | `providers.gcp.quarantine.enabled` |
| `GCP_ENABLE_CIRCUIT_BREAKER`| Circuit breaker toggle for GCP | `providers.gcp.circuit_breaker.enabled` |
| `GCP_ENABLE_PACER` | Ingress pacer toggle for GCP | `providers.gcp.pacer.enabled` |

### Category B: General Retry & Rotate Settings to Wire

| Setting in `.env` | Current State | Target State |
|---|---|---|
| `LITEROUTER_MAX_ATTEMPTS` | Ignored; hardcoded to `3` in handlers | Provider override `retry.max_attempts` with fallback to `5` |
| `LITEROUTER_ROTATE_DELAY_MS` | Missing; retries execute at 0ms delay | Provider `retry.jitter.min_delay_ms` / `max_delay_ms` (default 1500–3000ms) |

### Category C: Dead Legacy Knobs to Purge from `.env`
These are obsolete, unreferenced in code, or superseded by JSON schemas:
- `OPENROUTER_BASE_URL`, `NVIDIA_BASE_URL`, `GOOGLE_BASE_URL`, `GOOGLE_NATIVE_BASE_URL`, `ZEN_BASE_URL` (Superseded by `base_url` in JSON)
- `OPENROUTER_MODEL`, `NVIDIA_MODEL`, `GOOGLE_MODEL`, `ZEN_MODEL` (Unused; request payloads specify models)
- `GOOGLE_KEY_AS_QUERY_PARAM` (Dead code)
- `FUSION_UPSTREAM_URL`, `FUSION_UPSTREAM_URL_NATIVE` (Superseded by native `config/fusion.json`)
- `REDIS_HOST`, `REDIS_PORT`, `REDIS_DB`, `REDIS_PASSWORD` (Valkey replaced by in-memory `KeyPool`)

### Category D: Legitimate Server Primitives (Retained in `.env`)
- Core Server: `LITEROUTER_PORT`, `LITEROUTER_HOST`, `LITEROUTER_AUTH_KEY`, `LITEROUTER_TLS_ENABLED`, `LITEROUTER_HTTP2`, `LITEROUTER_H2_OUTBOUND`
- API Key Pools: `OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS`, `GOOGLE_API_KEYS`, `ZEN_API_KEYS`, `GCP_KEYS`, etc.
- System Timeouts: `LITEROUTER_HTTP_TIMEOUT_MS`, `LITEROUTER_TTFT_TIMEOUT_MS`, `LITEROUTER_STREAM_IDLE_TIMEOUT_MS`, `KEEPALIVE_INTERVAL_MS`
- Global Cooldowns: `COOLDOWN_RATE_LIMIT_TTL_SEC`, `COOLDOWN_SERVER_ERROR_TTL_SEC`, `COOLDOWN_AUTH_ERROR_TTL_SEC`

---

## 3. JSON Schema Specification (`config/providers.json`)

The Zod schema in `src/config/schema.ts` is extended to strictly validate provider configuration:

```typescript
export const RetryJitterSchema = z.object({
  enabled: z.boolean().default(true),
  min_delay_ms: z.number().int().nonnegative().default(1500),
  max_delay_ms: z.number().int().nonnegative().default(3000),
});

export const ProviderRetrySchema = z.object({
  enabled: z.boolean().default(true),
  max_attempts: z.number().int().positive().default(3),
  jitter: RetryJitterSchema.default({}),
});

export const ProviderPacerSchema = z.object({
  enabled: z.boolean().default(true),
  min_delay_ms: z.number().int().nonnegative().default(200),
  max_queue_depth: z.number().int().positive().default(100),
  max_queue_wait_ms: z.number().int().positive().default(15000),
});

export const ProviderQuarantineSchema = z.object({
  enabled: z.boolean().default(true),
  default_ttl_sec: z.number().int().positive().default(65),
  server_error_ttl_sec: z.number().int().positive().default(10),
  auth_error_ttl_sec: z.number().int().positive().default(300),
  max_ttl_sec: z.number().int().positive().default(604800),
});

export const ProviderCircuitBreakerSchema = z.object({
  enabled: z.boolean().default(false),
  failure_threshold: z.number().int().positive().default(5),
  cooldown_ms: z.number().int().positive().default(60000),
  max_canary_duration_ms: z.number().int().positive().default(60000),
});

export const ProviderConfigEntrySchema = z.object({
  code: ProviderCodeSchema,
  base_url: z.string().url(),
  auth_header: z.enum(["Bearer", "x-api-key"]).default("Bearer"),
  headers: z.record(z.string(), z.string()).optional(),
  endpoints: ProviderEndpointsSchema,
  retry: ProviderRetrySchema.default({}),
  pacer: ProviderPacerSchema.default({}),
  circuit_breaker: ProviderCircuitBreakerSchema.default({}),
  quarantine: ProviderQuarantineSchema.default({}),
  limits: z.record(z.string(), RateLimitSchema),
  conserve_rules: z.array(z.any()).optional(),
});
```

### Complete Example Provider Block (`openrouter`):
```json
{
  "openrouter": {
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
    "retry": {
      "enabled": true,
      "max_attempts": 5,
      "jitter": {
        "enabled": true,
        "min_delay_ms": 1500,
        "max_delay_ms": 3000
      }
    },
    "pacer": {
      "enabled": true,
      "min_delay_ms": 200,
      "max_queue_depth": 100,
      "max_queue_wait_ms": 15000
    },
    "circuit_breaker": {
      "enabled": false,
      "failure_threshold": 5,
      "cooldown_ms": 60000
    },
    "quarantine": {
      "enabled": true,
      "default_ttl_sec": 65,
      "server_error_ttl_sec": 10,
      "auth_error_ttl_sec": 300,
      "max_ttl_sec": 604800
    },
    "limits": {
      "default": { "rpm": 20, "rpd": 1000, "tpm": 1000000 }
    },
    "conserve_rules": [
      {
        "status": 429,
        "contains": "free-models-per-day",
        "ttl": "midnight_utc",
        "reason": "openrouter_daily_free_quota_exhausted"
      }
    ]
  }
}
```

---

## 4. Codebase Audit: Hardcoded Parameters

A full static scan across `src/` identified all hardcoded constants, fallback URLs, and fixed limits that must be eradicated and replaced with dynamic lookups into the in-memory provider configuration store:

### 4.1 Upstream URLs & Endpoints
| File & Line | Current Hardcoded Code | Target Dynamic In-Memory Lookup |
|---|---|---|
| `src/handlers/openai_compat.ts:140` | `overrideProviderUrl("https://openrouter.ai/api/v1/chat/completions", providerCode)` | `resolveUpstreamEndpoint(providerCode, "ch")` |
| `src/handlers/openai_original.ts:66-68` | Hardcoded map: `zn: "https://opencode.ai/zen/v1/responses"`, `or: "https://openrouter.ai/api/v1/responses"`, `oa: "https://api.openai.com/v1/responses"` | `resolveUpstreamEndpoint(provider, "rs")` |
| `src/handlers/google_native.ts:169` | `return "https://generativelanguage.googleapis.com";` | `getProviderConfig("gg").base_url` |
| `src/handlers/google_native.ts:203-204` | Hardcoded default referer `"https://opencode.ai"` | Read from `getProviderConfig("gg").headers["HTTP-Referer"]` |

### 4.2 Retry Limits & Delay Intervals
| File & Line | Current Hardcoded Code | Target Dynamic In-Memory Lookup |
|---|---|---|
| `src/handlers/openai_compat.ts:802` | `const maxAttempts = isZenLoop && !env.ZEN_ENABLE_RETRIES ? 1 : Math.min(3, Math.max(1, poolSize));` | `prov.retry.enabled ? Math.min(prov.retry.max_attempts, poolSize) : 1` |
| `src/handlers/anthropic_compat.ts:1297` | `const maxAttempts = Math.min(3, Math.max(1, poolSize));` | `prov.retry.enabled ? Math.min(prov.retry.max_attempts, poolSize) : 1` |
| `src/handlers/gcp_compat.ts:484-485` | `const maxAttempts = env.GCP_ENABLE_RETRIES ? Math.min(3, Math.max(1, poolSize)) : 1;` | `prov.retry.enabled ? Math.min(prov.retry.max_attempts, poolSize) : 1` |
| `src/handlers/openai_original.ts:743-744` | `const maxAttempts = isZen ? (env.ZEN_ENABLE_RETRIES ? Math.min(3, Math.max(1, poolSize)) : 1) : 1;` | `prov.retry.enabled ? Math.min(prov.retry.max_attempts, poolSize) : 1` |
| Retry Loops (`openai_compat.ts`, `anthropic_compat.ts`, `gcp_compat.ts`, `openai_original.ts`) | Instant 0ms retry on key rotation | `const delay = calculateRetryDelay(prov.retry.jitter); if (delay > 0) await Bun.sleep(delay);` |

### 4.3 Pacer Defaults & Queue Constraints
| File & Line | Current Hardcoded Code | Target Dynamic In-Memory Lookup |
|---|---|---|
| `src/network/pacer.ts:97, 244` | Hardcoded `return 200;` interval fallback | `getProviderConfig(provider).pacer.min_delay_ms` |
| `src/network/pacer.ts:101, 265` | Hardcoded `maxQueueDepth ?? 1000` / `100` | `getProviderConfig(provider).pacer.max_queue_depth` |
| `src/network/pacer.ts:105, 258-268` | Hardcoded `provider === "gc" ? env.GCP_PACER_MAX_QUEUE_WAIT_MS : 15000` | `getProviderConfig(provider).pacer.max_queue_wait_ms` |
| `src/network/pacer.ts:228-245` | Hardcoded `switch(provider)` matching `env.OPENROUTER_MIN_DELAY_MS`, etc. | `getProviderConfig(provider).pacer.min_delay_ms` |

### 4.4 Quarantine TTLs & Circuit Breaker Thresholds
| File & Line | Current Hardcoded Code | Target Dynamic In-Memory Lookup |
|---|---|---|
| `src/network/circuit_breaker.ts:19` | Default `{ failureThreshold: 5, cooldownMs: 60000 }` | Read from `getProviderConfig(provider).circuit_breaker` |
| `src/network/classifier.ts:182-184` & `src/network/pool.ts:139-144` | Hardcoded auth error ladder: `300s`, `1800s`, `86400s` | Base ladder on `prov.quarantine.auth_error_ttl_sec` |
| `src/network/classifier.ts:208` | Hardcoded server error `quarantineTtlSec: 10` | `prov.quarantine.server_error_ttl_sec` |
| `src/network/classifier.ts:160` | Hardcoded credit exhaustion `SEVEN_DAYS_SEC: 604800` | `prov.quarantine.max_ttl_sec` |
| `src/network/cooldown.ts:117` & `classifier.ts:170` | Fallback rate limit cooldown `RATE_LIMIT_DEFAULT_SEC = 65` | `prov.quarantine.default_ttl_sec` |

---

## 5. In-Memory Store Architecture (`src/config/providers.ts`)

To avoid reading `config/providers.json` from the filesystem during requests:

1. **Eager Boot Loading**:
   - `initProviderRegistry()` runs during `src/index.ts` server initialization.
   - It synchronously loads `config/providers.json`, validates it through `ProvidersConfigSchema` (Zod), and populates an in-memory `Map<string, ProviderConfigEntry>` indexed by both full provider name (e.g. `openrouter`) and 2-letter code (e.g. `or`).
   - If validation fails, LiteRouter terminates immediately with a descriptive schema error (Fail-Fast).
2. **Zero Runtime Disk I/O**:
   - All runtime handlers query `getProviderConfig(code)` in $O(1)$ memory time.
3. **Hot Reload on `/reset`**:
   - When `POST /reset` or `POST /admin/pool/reset` is invoked, `reloadProviderRegistry()` re-reads disk, validates the new structure, and performs an atomic in-memory swap.
4. **Endpoint Resolution**:
   - `resolveUpstreamEndpoint()` moves into `src/config/providers.ts`, becoming the single canonical source of URL generation across all handlers.

---

## 6. Jitter Runtime Logic & Provider Tuning

### Jitter Calculation Algorithm
```typescript
export function calculateRetryDelay(jitter: { enabled: boolean; min_delay_ms: number; max_delay_ms: number }): number {
  if (!jitter.enabled) {
    return jitter.min_delay_ms;
  }
  const min = Math.max(0, jitter.min_delay_ms);
  const max = Math.max(min, jitter.max_delay_ms);
  if (min === max) {
    return min;
  }
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
```

### Provider Tuning Matrix

| Provider Code | `min_delay_ms` | `max_delay_ms` | `enabled` | Architectural Rationale |
|---|---|---|---|---|
| **`or` (OpenRouter)** | `1500` | `3000` | `true` | High concurrency provider; 1.5s window avoids subagent collisions on free tiers. |
| **`zn` (Zen)** | `1000` | `2500` | `true` | Fast local proxy; keeps TTFT snappy during key rotations. |
| **`nv` (NVIDIA)** | `1000` | `2000` | `true` | NIM infrastructure resets fast; tight window preserves throughput. |
| **`gg` (Google)** | `1000` | `2500` | `true` | Native Gemini API; avoids quota burst collisions. |
| **`gc` (GCP Vertex)** | `2000` | `4000` | `true` | Google Cloud IAM/quota buckets reset slowly; wider window prevents cascading 429s. |
| **`tp` (Test Provider)**| `0` | `0` | `false` | Zero delay, jitter disabled; ensures unit tests run at maximum speed with deterministic behavior. |

---

## 7. Setting Semantics: Deep Lifecycle Breakdown

At first glance, `pacer`, `retry`, `quarantine`, and `circuit_breaker` all relate to "delay and resilience." However, they operate at **four fundamentally different layers of the request lifecycle**:

```
[Inbound Client Request]
          │
          ▼
┌──────────────────────────────────────┐
│ 1. PACER (Entrance Traffic Cop)      │ ◄── Spaces requests apart BEFORE they hit upstream
└─────────────────┬────────────────────┘
                  │ (Single Key Selected from Pool)
                  ▼
┌──────────────────────────────────────┐
│ 2. RETRY LOOP (Single-Request Loop)  │ ◄── What to do if THIS attempt fails: rotate key & retry
└─────────────────┬────────────────────┘
                  │ (Key Fails: 429, 401, 502)
         ┌────────┴────────┐
         ▼                 ▼
┌─────────────────┐ ┌────────────────────────┐
│ 3. QUARANTINE   │ │ 4. CIRCUIT BREAKER     │
│ (Single Key)    │ │ (Entire Provider)      │
│ "Park THIS key; │ │ "EVERY key is failing! │
│ use others."    │ │ Stop calling provider."│
└─────────────────┘ └────────────────────────┘
```

### Direct Comparison Matrix

| Dimension | 1. Pacer (`pacer`) | 2. Retry (`retry`) | 3. Quarantine (`quarantine`) | 4. Circuit Breaker (`circuit_breaker`) |
|---|---|---|---|---|
| **What is its target?** | The **entire inbound traffic flow** for a provider | A **single in-flight request** | A **single specific API key** | The **entire upstream provider** |
| **When does it act?** | **BEFORE** making any outbound network call | **DURING** request processing after a failure | **AFTER** a key encounters a failure | **AFTER** multiple requests fail across all keys |
| **What is its goal?** | Prevent burst rate-limits (space calls 200ms apart) | Give the caller a successful response without failing | Stop other requests from wasting time on a dead/exhausted key | Protect gateway resources when upstream provider has an outage |
| **If disabled (`false`):** | Requests hit upstream instantly with 0ms spacing | Fails on the first error; no key rotation attempted | Key stays active; future requests will hit the bad key again | Gateway keeps hammering upstream even if provider is down |

---

## 8. Quarantine Duration: How Long Are Bad Keys Parked?

When a key fails, LiteRouter classifies the error and assigns a duration (TTL) dynamically:

| Failure Type | HTTP Code | Trigger / Upstream Signal | Quarantine Duration (TTL) | Source / Behavior |
|---|---|---|---|---|
| **Transport Timeout / Reset** | `0` / timeout | TTFT exceeded, connection reset | **2 seconds** | Key is briefly rested for transient glitch |
| **Server Error** | `500`, `502`, `503`, `504` | Upstream outage / internal server error | `quarantine.server_error_ttl_sec` (**10s**) | Key is parked until server stabilizes |
| **Standard Rate Limit** | `429` | Upstream rate limit reached | **Upstream `Retry-After` header** (or `default_ttl_sec`: **65s**) | Uses vendor header if present; otherwise default fallback |
| **Conserve Quota Rule** | `429` | e.g. OpenRouter `"free-models-per-day"` | **Until Midnight UTC** | Parked until upstream daily quota resets |
| **Total Credit Exhaustion** | `429` | Body contains `"insufficient credits"` or `"quota exceeded"` | `quarantine.max_ttl_sec` (**7 days**) | Key is completely out of funds; parked until `/reset` |
| **Authentication Error** | `401`, `403` | Invalid key, revoked key | **Tiered backoff**: 300s (5m) ➔ 1800s (30m) ➔ 86,400s (24h) | Prevents repeated auth failures triggering account bans |

---

## 9. Implementation Phasing

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Schema & Types Definition                         │
│ • Update src/config/schema.ts with nested provider types   │
│ • Add RetryJitterSchema, QuarantineSchema, etc.             │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Phase 2: In-Memory Provider Registry Module                │
│ • Create src/config/providers.ts                           │
│ • Implement init, reload, getProviderConfig, endpoint lookup│
│ • Wire into src/index.ts boot and reset routes             │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Phase 3: Migrate config/providers.json                     │
│ • Populate retry, jitter, pacer, quarantine blocks         │
│ • Validate against schema via bun run scripts/doctor.ts    │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Phase 4: Wire Handlers & Network Pacer                      │
│ • Update openai_compat.ts, anthropic_compat.ts, etc.       │
│ • Insert calculateRetryDelay() and sleep in retry loops     │
│ • Refactor pacer.ts to query provider in-memory config     │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ Phase 5: Clean .env & Verification                          │
│ • Remove dead legacy variables from .env and .env.example   │
│ • Run bun test, typecheck, and integration smoke tests      │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. Verification & Definition of Done

1. **Type Safety**: `bun run typecheck` (`tsc --noEmit`) passes with zero errors.
2. **Unit Suite**: `bun test` passes with 100% exit code 0.
3. **Doctor Diagnostics**: `bun run scripts/doctor.ts` passes schema verification.
4. **Jitter Verification**: Unit tests verify that `calculateRetryDelay` produces values strictly within `[min_delay_ms, max_delay_ms]`, and deterministic `min_delay_ms` when `enabled: false`.
5. **Zero API Key Leakage**: No API keys or `.env.local` contents are altered or touched.

---

## Appendix A: Comprehensive Field Glossary

### 1. Provider Core Configuration

| Field Name | Type | Scope | Default | Description |
|---|---|---|---|---|
| `code` | `string` | Provider | *(Required)* | 2-letter directive provider code (`or`, `nv`, `gg`, `zn`, `gc`, `oa`, `an`, etc.). |
| `base_url` | `string (url)` | Provider | *(Required)* | Base HTTPS URL of the upstream provider API (e.g. `https://openrouter.ai`). |
| `auth_header` | `enum` | Provider | `"Bearer"` | Header type used for passing API keys (`"Bearer"` or `"x-api-key"`). |
| `headers` | `object` | Provider | `{}` | Static headers injected into every request (e.g. `HTTP-Referer`, `User-Agent`, `X-Title`). |
| `endpoints` | `object` | Provider | *(Required)* | Map of completion codes (`ch`, `ms`, `rs`, `em`, `md`, `gc`) to path templates (e.g. `/v1/chat/completions`). |

---

### 2. Retry Settings (`provider.retry`)

| Field Name | Type | Scope | Default | Description |
|---|---|---|---|---|
| `retry.enabled` | `boolean` | Provider | `true` | When `true`, gateway rotates keys and retries failed calls. When `false`, acts as a dumb forwarder. |
| `retry.max_attempts` | `integer` | Provider | `3` | Maximum number of keys to try for a single client request before returning an error to the user. |
| `retry.jitter.enabled` | `boolean` | Provider | `true` | When `true`, delays between retries are randomized between `min_delay_ms` and `max_delay_ms`. |
| `retry.jitter.min_delay_ms` | `integer` | Provider | `1500` | Minimum sleep duration (in ms) before rotating to the next key attempt. |
| `retry.jitter.max_delay_ms` | `integer` | Provider | `3000` | Maximum sleep duration (in ms) before rotating to the next key attempt. |

---

### 3. Pacer Settings (`provider.pacer`)

| Field Name | Type | Scope | Default | Description |
|---|---|---|---|---|
| `pacer.enabled` | `boolean` | Provider | `true` | Enables the FIFO conveyor belt queue that paces inbound requests. |
| `pacer.min_delay_ms` | `integer` | Provider | `200` | Minimum spacing (in ms) between successive calls to upstream (e.g. 200ms = max 5 req/s per pipe). |
| `pacer.max_queue_depth` | `integer` | Provider | `100` | Maximum number of requests allowed to wait in queue before rejecting with HTTP 429. |
| `pacer.max_queue_wait_ms`| `integer` | Provider | `15000` | Maximum time a request can wait in the queue before timing out (e.g. 240,000ms for slow GCP pacers). |

---

### 4. Quarantine Settings (`provider.quarantine`)

| Field Name | Type | Scope | Default | Description |
|---|---|---|---|---|
| `quarantine.enabled` | `boolean` | Provider | `true` | When `true`, keys that fail (429, 401, 5xx) are temporarily parked so other requests skip them. |
| `quarantine.default_ttl_sec` | `integer` | Provider | `65` | Default duration (in seconds) to park a key on rate-limit (429) if no `Retry-After` header is returned. |
| `quarantine.server_error_ttl_sec` | `integer` | Provider | `10` | Duration (in seconds) to park a key when the upstream returns a 5xx transient server error. |
| `quarantine.auth_error_ttl_sec` | `integer` | Provider | `300` | Base duration (in seconds) to park a key on 401/403 authentication failure (increases exponentially). |
| `quarantine.max_ttl_sec` | `integer` | Provider | `604800` | Ceiling duration (7 days) for keys with exhausted daily/monthly credits. |

---

### 5. Circuit Breaker Settings (`provider.circuit_breaker`)

| Field Name | Type | Scope | Default | Description |
|---|---|---|---|---|
| `circuit_breaker.enabled` | `boolean` | Provider | `false` | When `true`, trips the entire provider offline if multiple requests fail across all keys. |
| `circuit_breaker.failure_threshold` | `integer` | Provider | `5` | Number of consecutive critical 5xx/crash failures required to trip the breaker from CLOSED to OPEN. |
| `circuit_breaker.cooldown_ms` | `integer` | Provider | `60000` | Duration (in ms) the breaker stays OPEN before sending a single canary probe in HALF_OPEN state. |
| `circuit_breaker.max_canary_duration_ms` | `integer` | Provider | `60000` | Maximum lease duration for the single canary test request while in HALF_OPEN state. |

---

### 6. Rate Limits & Quotas (`provider.limits`)

| Field Name | Type | Scope | Default | Description |
|---|---|---|---|---|
| `limits.<model>.rpm` | `integer` | Model/Prov | `30` | Requests Per Minute limit tracked by the local rate limiter. |
| `limits.<model>.rpd` | `integer` | Model/Prov | `1000` | Requests Per Day limit tracked by the local rate limiter. |
| `limits.<model>.tpm` | `integer` | Model/Prov | `1000000` | Tokens Per Minute ceiling for request tracking. |
| `conserve_rules` | `array` | Provider | `[]` | Pattern-matching rules on HTTP status + error body string to trigger targeted parking (e.g. midnight UTC). |
