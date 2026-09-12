# Architecture Blueprint: Unified Provider Registry & Standardized Request Telemetry (LiteRouter v4.1)

- **Document Path**: `docs/redesign01.md`
- **Tracking Issues**: `literouter-st5j` (Provider Settings Migration), `literouter-kp27` (Centralized Telemetry)
- **Status**: Proposed / Under Collaborative Review
- **Release Version**: **v4.1.0** (Implemented directly in `main`)
- **Safety Pre-requisite**: **Backup current `main` branch to branch `v4.0`** before executing any code changes.
- **Target Subsystems**: `src/config/`, `src/telemetry/`, `src/handlers/`, `src/network/`, `config/providers.json`

---

## 1. Executive Summary & Problem Statement

LiteRouter currently suffers from two deeply intertwined architectural bottlenecks that impede horizontal scaling:

1. **Configuration Fragmentation (`literouter-st5j`)**:
   - Provider networking rules (endpoints, retry limits, pacers, quarantine TTLs, circuit breakers) are split between `.env` knobs, hardcoded magic numbers (`Math.min(3, poolSize)`, `return 200`), and a partially-used `config/providers.json`.
   - Retries execute instantly with 0ms delays, causing thundering-herd rate-limit cascades across concurrent subagents.

2. **Telemetry Inversion & Boilerplate Bloat (`literouter-kp27`)**:
   - Every time a provider or wire format is added, developers must manually update `PROVIDER_NAMES` and `WIRE_NAMES` dictionaries inside `src/ui/logger.ts`.
   - The 5 inbound handlers (`openai_compat.ts`, `anthropic_compat.ts`, `google_native.ts`, `gcp_compat.ts`, `openai_original.ts`) contain **over 100 copy-pasted calls** to individual `log*` functions.
   - Handlers are burdened with stopwatch calculations (`Date.now() - startTime`), speed math (`tok/s`), and token parsing, resulting in stark inconsistencies: some handlers omit `finish_reason`, some omit speed metrics, and some use hardcoded provider strings (`"gc"`, `"gg"`).

### Core Architectural Solution
We converge these initiatives into a clean, functionally decoupled redesign:
- **`config/providers.json` becomes the Single Source of Truth** for network topology, provider identity (display names, codes), retry/jitter parameters, pacer rates, and quarantine policies.
- **An Eager In-Memory Store (`src/config/providers.ts`)** loads at boot, delivering $O(1)$ memory lookups with zero runtime disk I/O and atomic hot-reloading on `POST /reset`.
- **Pure Stateless Payload Transformers**: Handlers are stripped of all execution mechanics. They contain **zero `Date.now()` timers, zero sleep/jitter delays, zero pacer queues, zero key rotation loops, and zero network calls**. They are 100% pure transformers that map inbound requests to target wire formats and stream responses back.
- **A Single Unified Dispatch Engine (`src/engine/dispatch.ts`)**: All gateway execution mechanics—pacer queuing, key pool rotation, retry loops with jitter, circuit breakers, quarantine, upstream HTTP/2 fetching, and lifecycle telemetry—live in **one central runner**.
- **Bidirectional Leg Tracing with Zero-Disk-I/O Ring Buffer**: Both legs (client inbound/outbound and upstream outbound/inbound) are captured in an in-memory ring buffer (last 100 traces) for instantaneous inspection, with lazy batch writes to `bun:sqlite` (`logs/traces.db`) using generous RAM buffering (30s interval or 100 traces/16MB cap) reducing disk writes by 95%+.

---

## 2. Target Architecture Diagram

```
                        ┌──────────────────────────────┐
                        │    config/providers.json     │
                        │  (Single Source of Truth)    │
                        │ • Identity (code, name)      │
                        │ • Endpoints & Headers        │
                        │ • Retry & Jitter settings    │
                        │ • Pacer & Quarantine rules   │
                        └──────────────┬───────────────┘
                                       │ Boot / POST /reset
                                       ▼
                        ┌──────────────────────────────┐
                        │   src/config/providers.ts    │
                        │    (In-Memory RAM Store)     │
                        └──────────────┬───────────────┘
                                       │
                                       ▼
[Downstream Request] ──► ┌──────────────────────────────┐
                         │    Inbound Route Handlers    │  (Thin Shims)
                         │  • Parse directive (lr-...)  │
                         └─────────────┬────────────────┘
                                       │
                                       ▼
                         ┌──────────────────────────────┐
                         │   Pure Payload Transformers  │  (Stateless Functions)
                         │  • transformClientToWire()   │  • Zero network
                         │  • transformWireToClient()   │  • Zero timers / sleep
                         └─────────────┬────────────────┘  • Zero pacer / retries
                                       │ Transformed Payload
                                       ▼
                         ┌──────────────────────────────┐
                         │ Unified Dispatch Pipeline    │  (src/engine/dispatch.ts)
                         │ • Provider Pacer Conveyor    │
                         │ • Key Rotation & Selection   │
                         │ • Bounded Jitter Delay       │
                         │ • Quarantine & Breakers      │
                         │ • Upstream Fetch (H2 / HTTP) │
                         │ • RequestTelemetry Lifecycle │
                         └─────────────┬────────────────┘
                                       │
                         ┌─────────────┴────────────────┐
                         │ Captures 4 Correlated Legs   │
                         ▼                              ▼
          ┌──────────────────────────────┐    ┌──────────────────────────────┐
          │   RAM Ring Buffer (Last 100) │    │  Terminal Pretty / JSON Log  │
          │  • 0ms CLI trace inspection  │    │  • LOG_LEVEL filtered        │
          └──────────────┬───────────────┘    └──────────────────────────────┘
                         │ Lazy Flush (30s / 16MB)
                         ▼
          ┌──────────────────────────────┐
          │     logs/traces.db (WAL)     │
          │  • Native bun:sqlite         │
          │  • 30-day retention prune    │
          └──────────────────────────────┘
```

---

## 3. Configuration Specification (`config/providers.json`)

### 3.1 Extended Provider Entry Schema
Every provider block defines its display identity alongside operational parameters:

```typescript
// src/config/schema.ts

export const RequestRetryDelaySchema = z.object({
  min_ms: z.number().int().nonnegative().default(150),
  max_ms: z.number().int().nonnegative().default(300),
}).refine((data) => data.max_ms >= data.min_ms, {
  message: "max_ms must be greater than or equal to min_ms",
  path: ["max_ms"],
});

export const RequestRetrySchema = z.object({
  enabled: z.boolean().default(true),
  max_attempts: z.number().int().positive().default(3), // How many keys this prompt may try before returning error to client
  delay_between_attempts_ms: RequestRetryDelaySchema.default({}),
});

export const KeyCooldownSchema = z.object({
  enabled: z.boolean().default(true),
  initial_cooldown_ms: z.number().int().positive().default(10000), // First 429 puts key on bench for 10s
  backoff_factor: z.number().positive().default(1.5), // Consecutive 429s scale: 10s -> 15s -> 22.5s
  max_cooldown_ms: z.number().int().positive().default(60000), // Cap backoff at 60s
  max_consecutive_failures: z.number().int().positive().default(5), // After 5 consecutive 429s, key benched for max_cooldown_ms
  jitter_percent: z.number().min(0).max(50).default(20), // +/- 20% jitter prevents thundering herd wake-up
  respect_retry_after: z.boolean().default(true), // Upstream Retry-After header takes precedence if present
  reset_after_success: z.boolean().default(true), // A single successful request resets failure streak back to 0
});

export const ProviderPacerSchema = z.object({
  enabled: z.boolean().default(true),
  min_delay_ms: z.number().int().nonnegative(), // Mandatory: Minimum spacing between dispatches
  max_delay_ms: z.number().int().nonnegative(), // Mandatory: Maximum spacing for conveyor range jitter (must be >= min_delay_ms)
  max_conveyor_queue_sla_ms: z.number().int().positive().default(45000), // Reject with HTTP 503 if estimated conveyor wait exceeds SLA
}).refine((data) => data.max_delay_ms >= data.min_delay_ms, {
  message: "max_delay_ms must be greater than or equal to min_delay_ms",
  path: ["max_delay_ms"],
});

export const ConserveRuleSchema = z.object({
  status: z.number().int(), // HTTP status triggering conservation (e.g. 429, 402)
  contains: z.string().min(1), // Normalized substring/regex in response body indicating true quota exhaustion
  ttl: z.enum(["midnight_utc", "midnight_pacific", "indefinite", "1h", "24h"]).default("midnight_utc"),
  reason: z.string().min(1), // Descriptive label for logs and telemetry
});

export const ProviderConfigEntrySchema = z.object({
  code: z.string().regex(/^[a-z0-9]{2,6}$/),
  name: z.string().min(1), // Canonical display name: e.g. "OpenRouter", "NVIDIA NIM"
  env_key: z.string().min(1), // Mandatory: Exact environment variable name in .env.local (e.g. "OPENROUTER_API_KEYS", "GCP_KEYS")
  base_url: z.string().url(),
  auth_header: z.enum(["Bearer", "x-api-key"]).default("Bearer"),
  headers: z.record(z.string(), z.string()).optional(),
  endpoints: ProviderEndpointsSchema,
  request_retry: RequestRetrySchema.default({}),
  key_cooldown: KeyCooldownSchema.default({}),
  pacer: ProviderPacerSchema,
  conserve_rules: z.array(ConserveRuleSchema).default([]),
  limits: z.record(z.string(), RateLimitSchema).optional(),
});
```

### 3.2 Canonical Provider Block Example (`config/providers.json`)
```json
{
  "openrouter": {
    "code": "or",
    "name": "OpenRouter",
    "env_key": "OPENROUTER_API_KEYS",
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
    "request_retry": {
      "enabled": true,
      "max_attempts": 3,
      "delay_between_attempts_ms": {
        "min_ms": 150,
        "max_ms": 300
      }
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
      "max_conveyor_queue_sla_ms": 45000
    },
    "conserve_rules": [
      {
        "status": 429,
        "contains": "free-models-per-day",
        "ttl": "midnight_utc",
        "reason": "OpenRouter daily free models quota exhausted"
      }
    ]
  }
}
```

### 3.3 The Clean `.env.local` Contract: Pure Secrets & Hardware Vault

In this redesign, `.env` and `.env.local` are completely stripped of application logic, provider URLs, retry/pacer parameters, and vestigial admin passwords. `.env.local` serves **strictly as the protected source of truth for secret API keys and physical hardware/port bindings**.

#### A. Retained in `.env.local` (Pure Secrets & Host Primitives):
```bash
# Physical Process Primitives (Varies by host/deployment)
LITEROUTER_HOST=0.0.0.0
LITEROUTER_PORT=7766
LITEROUTER_TLS_ENABLED=true
LITEROUTER_TLS_CERT=certs/localhost.pem
LITEROUTER_TLS_KEY=certs/localhost-key.pem
LITEROUTER_HTTP2=true
LITEROUTER_H2_OUTBOUND=true

# Upstream Secret Key Pools (Protected via protect.sh, mode 644)
OPENROUTER_API_KEYS=sk-or-key1,sk-or-key2
NVIDIA_API_KEYS=nvapi-key1,nvapi-key2
GOOGLE_API_KEYS=AIzaSyKey1,AIzaSyKey2
ZEN_API_KEYS=zen-key1,zen-key2
GCP_KEYS=gc-key1,gc-key2
```
*(Note: Client authentication requires NO static admin key. Downstream clients authenticate and route using standard Directive Keys: `Authorization: Bearer lr-<provider>-<payload>-<completions>-<nuances>` or `lr-fse-<preset>`)*.

#### B. Permanently Purged from `.env` & `.env.example`:
| Purged Knob | Why It Is Purged | New Home |
|---|---|---|
| `LITEROUTER_AUTH_KEY` | Dead vestigial knob; client authentication uses directive keys (`lr-...`). Reset routes use directives or auth-free `/reset` | Removed completely |
| `LITEROUTER_PACER_*` (`LITEROUTER_PACER_ENABLED`, `_MAX_RPM`, `_MAX_QUEUE_DEPTH`, `_MAX_QUEUE_WAIT_MS`) | Historical global fallback; pacer is 100% provider-level | `config/providers.json -> pacer` |
| `COOLDOWN_*` (`COOLDOWN_RATE_LIMIT_TTL_SEC`, `_SERVER_ERROR_TTL_SEC`, `_AUTH_ERROR_TTL_SEC`) | Historical global fallback; quarantine TTLs are 100% provider-level | `config/providers.json -> quarantine` |
| `*_BASE_URL` (`OPENROUTER_BASE_URL`, `NVIDIA_BASE_URL`, etc.) | Violates 12-factor; static topology | `config/providers.json -> base_url` |
| `*_MIN_DELAY_MS` (`OPENROUTER_MIN_DELAY_MS`, etc.) | Application pacer policy | `config/providers.json -> pacer.min_delay_ms` |
| `*_ENABLE_RETRIES` (`ZEN_ENABLE_RETRIES`, `GCP_ENABLE_RETRIES`) | Provider retry policy | `config/providers.json -> retry.enabled` |
| `*_ENABLE_QUARANTINE` | Key management policy | `config/providers.json -> quarantine.enabled` |
| `*_ENABLE_PACER` | Ingress conveyor policy | `config/providers.json -> pacer.enabled` |
| `*_ENABLE_CIRCUIT_BREAKER` | Resilience policy | `config/providers.json -> circuit_breaker.enabled` |
| `LITEROUTER_HTTP_REFERER`, `LITEROUTER_USER_AGENT`, `LITEROUTER_X_TITLE` | Provider HTTP headers | `config/providers.json -> headers` |
| `OPENROUTER_MODEL`, `NVIDIA_MODEL`, `GOOGLE_MODEL` | Dead unreferenced code | Removed completely |
| `REDIS_*` | Dead legacy code (Valkey replaced by in-memory pool) | Removed completely |

#### C. Why `.env.local` Remains the Sole Key Vault:
1. **Zero Git Leak Risk**: `config/providers.json` is checked into Git; `.env.local` is gitignored. Secrets are never exposed in commits or PRs.
2. **Permission Boundary**: `.env.local` remains write-protected (`protect.sh`, owned by root, read-only 644 for runtime processes). Agents can safely tune `providers.json` without risk of deleting or corrupting credentials.
3. **Container Portability**: In Kubernetes or Docker, `process.env` seamlessly ingests secrets from Vault or SecretMaps without needing to rewrite JSON files.

---

## 4. In-Memory Store Architecture (`src/config/providers.ts`)

To eliminate runtime filesystem reads and provide instant configuration lookups:

```typescript
// src/config/providers.ts
import { ProvidersConfigSchema, type ProviderConfigEntry } from "./schema";

let providersByCode = new Map<string, ProviderConfigEntry>();
let providersByName = new Map<string, ProviderConfigEntry>();

export function initProviderRegistry(rawConfig?: unknown): void {
  const parsed = ProvidersConfigSchema.parse(rawConfig ?? loadRawProvidersJson());
  const byCode = new Map<string, ProviderConfigEntry>();
  const byName = new Map<string, ProviderConfigEntry>();

  for (const [key, entry] of Object.entries(parsed)) {
    byCode.set(entry.code.toLowerCase(), entry);
    byName.set(key.toLowerCase(), entry);
  }

  providersByCode = byCode;
  providersByName = byName;
}

export function getProviderConfig(codeOrName: string): ProviderConfigEntry {
  const norm = codeOrName.toLowerCase();
  const entry = providersByCode.get(norm) ?? providersByName.get(norm);
  if (!entry) {
    throw new Error(`[ProviderRegistry] Unknown provider code or name: "${codeOrName}"`);
  }
  return entry;
}

export function getProviderDisplayName(codeOrName: string): string {
  const norm = codeOrName.toLowerCase();
  const entry = providersByCode.get(norm) ?? providersByName.get(norm);
  return entry ? entry.name : codeOrName.toUpperCase();
}

export function resolveUpstreamEndpoint(providerCode: string, endpointKey: string): string {
  const prov = getProviderConfig(providerCode);
  const path = prov.endpoints[endpointKey as keyof typeof prov.endpoints];
  if (!path) {
    throw new Error(`[ProviderRegistry] Endpoint "${endpointKey}" not defined for provider "${prov.name}"`);
  }
  return `${prov.base_url}${path}`;
}

export function isRegisteredProvider(code: string): boolean {
  return providersByCode.has(code.toLowerCase());
}

export function getAllRegisteredProviders(): readonly ProviderConfigEntry[] {
  return Array.from(providersByCode.values());
}
```

### 4.1 Zero-Code Provider Extensibility Contract
With `src/config/providers.ts` driving runtime behavior:
- **Onboarding any standard OpenAI-compatible provider requires ZERO script edits**:
  1. Add provider block to `config/providers.json` (specifying `code`, `name`, `base_url`, `endpoints`, `retry`, `pacer`, `env_key`).
  2. Add the corresponding key pool in `.env.local` (e.g. `COHERE_API_KEYS=...`).
  3. The Directive Parser (`isValidProvider`), Key Pool loader (`loadKeyPools`), Network Pacer, and `RequestTelemetry` automatically register the new provider dynamically from JSON at boot.
- **Cleaning up / deprecating a provider requires ZERO script edits**:
  1. Delete or comment out the provider block in `config/providers.json`.
  2. The gateway will instantly reject old directives, release memory pools, and cease routing without any orphan code in `src/`.

---

## 5. Standardized Telemetry Contract (`RequestTelemetry`)

### 5.1 The Telemetry Session Class
Rather than exposing 16 standalone functions, `RequestTelemetry` encapsulates the entire request lifecycle. Handlers never calculate durations, compute speed, or touch string formatters.

```typescript
// src/telemetry/session.ts
import { getProviderDisplayName } from "../config/providers";
import { formatTimestamp, EMOJI, formatTokenNumber } from "../ui/logger";

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
    this.providerCode = init.targetProvider || "unknown";
    this.currentKeyIndex = init.keyIndex;
    this.totalKeys = init.totalKeys;
    this.emitInbound();
  }

  /** Logs inbound request header banner */
  private emitInbound(): void {
    // Standard inbound logging using dynamic provider display name
  }

  /** 1. Key Rotation: called when rotating to next key attempt */
  public rotateKey(info: { fromIndex: number; toIndex: number; totalKeys: number; attempt: number; maxAttempts: number }): void {
    this.currentKeyIndex = info.toIndex;
    this.totalKeys = info.totalKeys;
    const provName = getProviderDisplayName(this.providerCode);
    console.log(`${EMOJI.rotate} ${formatTimestamp()} [ROTATE ${this.reqId}] Advancing to ${provName} [Key #${info.toIndex + 1}/${info.totalKeys}] -> Retrying (Attempt ${info.attempt}/${info.maxAttempts})`);
  }

  /** 2. Rate Limit / Quota Encountered */
  public recordLimit(info: { status: number; retryAfterSec?: number; totalKeys?: number; rawMessage?: string }): void {
    const provName = getProviderDisplayName(this.providerCode);
    const keyIdx = (this.currentKeyIndex ?? 0) + 1;
    console.warn(`${EMOJI.limit} ${formatTimestamp()} [LIMIT ${this.reqId}] ${provName} [Key #${keyIdx}/${info.totalKeys ?? "?"}] returned HTTP ${info.status}`);
    if (info.retryAfterSec) {
      console.warn(`${EMOJI.limit} ${formatTimestamp()} [LIMIT ${this.reqId}] Quarantined Key #${keyIdx} for ${info.retryAfterSec}s`);
    }
  }

  /** 3. TTFT: called on the very first SSE chunk or byte received */
  public markTtft(protocol?: string): void {
    if (this.firstTokenTime !== undefined) return;
    this.firstTokenTime = performance.now();
    const ttftMs = Math.round(this.firstTokenTime - this.startTime);
    const protoStr = protocol ? ` [Upstream: ${protocol}]` : "";
    console.log(`${EMOJI.ttft} ${formatTimestamp()} [TTFT ${this.reqId}] TTFT = ${ttftMs}ms | Stream established${protoStr}`);
  }

  /** 4. Usage: called when tokens are extracted from response */
  public recordUsage(record: UsageRecord): void {
    const now = performance.now();
    const durationMs = Math.round(now - this.startTime);
    const provName = getProviderDisplayName(this.providerCode);
    const keyIdx = (this.currentKeyIndex ?? 0) + 1;
    
    let speedStr = "";
    if (durationMs > 0 && record.completionTokens > 0) {
      const sec = durationMs / 1000;
      const speed = (record.completionTokens / sec).toFixed(1);
      speedStr = ` | Speed=${speed} tok/s`;
    }

    const reasoningStr = record.reasoningTokens && record.reasoningTokens > 0
      ? ` | Reasoning=${formatTokenNumber(record.reasoningTokens)}`
      : "";
    const total = record.totalTokens ?? (record.promptTokens + record.completionTokens);

    console.log(`${EMOJI.usage} ${formatTimestamp()} [USAGE ${this.reqId}] ${provName} (Key #${keyIdx}/${this.totalKeys ?? "?"})`);
    console.log(`${EMOJI.tokens} ${formatTimestamp()} [USAGE ${this.reqId}] Tokens: Prompt=${formatTokenNumber(record.promptTokens)}${reasoningStr} | Completion=${formatTokenNumber(record.completionTokens)} | Total=${formatTokenNumber(total)}${speedStr}`);

    if (record.finishReason) {
      if (record.finishReason === "length") {
        console.warn(`${EMOJI.finishTrunc} ${formatTimestamp()} [FINISH ${this.reqId}] Upstream token truncation (finish_reason=length)`);
      } else {
        console.log(`${EMOJI.finish} ${formatTimestamp()} [FINISH ${this.reqId}] Stream finished: finish_reason=${record.finishReason}`);
      }
    }
  }

  /** 5. Served: final completion log */
  public served(status: number, attempt = 1, maxAttempts = 1): void {
    const durationMs = Math.round(performance.now() - this.startTime);
    const icon = status >= 400 ? EMOJI.servedErr : EMOJI.servedOk;
    const attemptStr = maxAttempts > 1 ? ` (attempt ${attempt}/${maxAttempts})` : "";
    console.log(`${icon} ${formatTimestamp()} [SERVED ${this.reqId}] HTTP ${status} in ${durationMs}ms${attemptStr}`);
  }

  /** 6. Error */
  public error(message: string, err?: unknown): void {
    const errDetail = err instanceof Error ? ` - ${err.message}` : "";
    console.error(`${EMOJI.error} ${formatTimestamp()} [ERROR ${this.reqId}] ${message}${errDetail}`);
  }
}
```

### 5.2 Full Request/Response Leg Tracing Subsystem (SQLite & In-Memory Ring Buffer)

To enable comprehensive troubleshooting by LLMs and engineers without flooding the console with massive JSON bodies, LiteRouter records the full bidirectional lifecycle of every request.

#### A. The 4 Correlated Legs Captured Per Request:
1. **Client Inbound**: Exact method, path, headers (sanitized), and request JSON body (messages, system prompt, tools).
2. **Upstream Outbound**: Target vendor URL, model name, active key index, headers (sanitized), and transformed JSON body sent to vendor.
3. **Upstream Inbound**: Vendor HTTP status code, response headers (sanitized), and response body (or assembled streamed completion text).
4. **Client Outbound**: HTTP status, headers (sanitized), and response payload returned to the downstream editor/client.

#### B. Mandatory Secret Redaction Pipeline (Zero API Key Leakage):
Before any request leg is stored in the RAM Ring Buffer or persisted to SQLite, it **MUST pass through `sanitizeTracePayload()`**:
- **Header Masking**:
  - `authorization: Bearer <masked>` -> replaced with `Bearer [REDACTED_CLIENT_TOKEN]` or `Bearer [KEY_#N_or]`
  - `x-api-key`, `api-key`, `x-goog-api-key` -> replaced with `[REDACTED_KEY]`
  - Standard headers (`user-agent`, `content-type`, `accept`, etc.) preserved intact for debugging.
- **Body Pattern Masking**:
  - Automatically matches and masks known key signatures:
    - OpenRouter keys: `sk-or-v1-[a-f0-9]{64}` -> `sk-or-v1-***REDACTED***`
    - NVIDIA keys: `nvapi-[A-Za-z0-9_-]{64}` -> `nvapi-***REDACTED***`
    - Google keys: `AIzaSy[A-Za-z0-9_-]{33}` -> `AIzaSy***REDACTED***`
    - LiteRouter tokens: `sk-lr-[A-Za-z0-9_-]+` -> `sk-lr-***REDACTED***`
- **Zero Raw Key Storage**: Neither RAM nor `logs/traces.db` ever contains plain-text API secrets.

#### C. Storage Architecture: Bounded RAM Ring Buffer + Lazy SQLite Flush
- **Bounded RAM Ring Buffer (`Map<string, SanitizedTrace>`)**:
  - **Count Ceiling**: Exactly 100 most recent traces.
  - **Memory Ceiling**: Strict **32MB total RAM cap**.
  - **Oversized Payload Protection**: If an individual leg body exceeds **64KB** (e.g. 200k-token repository prompts), the RAM ring buffer stores the first 64KB appended with:
    `... [TRUNCATED: original payload size ${totalBytes} bytes. Full token counts recorded in metrics.]`
    This guarantees that even 10 consecutive 200k-token agent calls cannot trigger a Node/Bun heap exhaustion or Linux OOM kill.
  - Diagnostic reads (`bun run scripts/trace.ts <reqId>` or `GET /v1/traces/:reqId`) hit the RAM ring buffer first for **0ms instant CLI inspection**.
- **Generous Lazy SQLite Writer (`bun:sqlite`)**:
  - Leverages host RAM to minimize SSD wear and disk write amplification by >95%.
  - Flushes to `logs/traces.db` (WAL mode, `PRAGMA synchronous = NORMAL`) when:
    - **Interval Trigger**: Every **30 seconds** (idle periods trigger 0 disk writes).
    - **Pressure Trigger**: Queue reaches **100 traces** OR **16MB** buffered.
    - **Process Exit Trigger**: Synchronous drain on `beforeExit`, `SIGINT`, and `SIGTERM`.
- **Automated 30-Day Retention**:
  - `DELETE FROM request_traces WHERE created_at < unixepoch('now', '-30 days');` executes on boot and every 24 hours.

#### D. Database Schema (`logs/traces.db`):
```sql
CREATE TABLE IF NOT EXISTS request_traces (
  req_id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,          -- Unix timestamp (ms)
  provider TEXT NOT NULL,               -- 'or', 'nv', 'zn', 'gg', 'gc'
  model TEXT NOT NULL,
  status INTEGER NOT NULL,              -- HTTP status code
  duration_ms INTEGER NOT NULL,
  ttft_ms INTEGER,
  tokens_prompt INTEGER,
  tokens_completion INTEGER,
  client_inbound TEXT NOT NULL,         -- Sanitized JSON: { headers, body }
  upstream_outbound TEXT NOT NULL,      -- Sanitized JSON: { url, headers, body, key_index }
  upstream_inbound TEXT NOT NULL,       -- Sanitized JSON: { status, headers, body }
  client_outbound TEXT NOT NULL         -- Sanitized JSON: { status, headers, body }
);

CREATE INDEX IF NOT EXISTS idx_traces_created_at ON request_traces(created_at);
CREATE INDEX IF NOT EXISTS idx_traces_status ON request_traces(status);
```

#### E. Diagnostic CLI Tool (`scripts/trace.ts`):
```bash
# Query recent request trace (reads RAM ring buffer or SQLite)
bun run scripts/trace.ts <req_id>

# Filter recent errors
bun run scripts/trace.ts --errors -n 5
```

---

## 6. Concrete Handler Comparison: Before & After

To demonstrate functional parsimony and zero-slop execution, here is the exact transformation:

### BEFORE (Monolithic & Tangled - 1,200 lines per handler):
```typescript
// Handlers were doing EVERYTHING:
// 1. Manual logInbound with 10 fields
// 2. Ingress pacer queueing: await acquireProviderPacer(directive.provider, clientSignal);
// 3. Key selection & waiting: await waitAndSelectKey(directive.provider, startTime, maxWaitMs, clientSignal);
// 4. Manual retry loop: for (let attempt = 0; attempt < maxAttempts; attempt++)
// 5. Instant 0ms retries: logRotate(...) -> continue
// 6. Quarantine reporting: globalKeyPool.reportFailure(...)
// 7. Manual stopwatch timing: Date.now() - startTime
// 8. Stream chunk inspection, token parsing, and 10+ scattered log* calls
```

### AFTER (Pure Functional Separation):

#### 1. Inbound Route Handler (`src/handlers/openai_compat.ts`):
```typescript
export async function handleOpenAIChatCompletions(req: Request): Promise<Response> {
  const reqId = generateRequestId();
  const directive = validateDirective(extractDirectiveToken(req));
  const rawBody = (await req.json()) as OpenAIRequestPayload;

  // Pure Transformation (Zero network, zero timers, zero pacer)
  const transformed = transformOpenAIPayload(rawBody, directive);

  // Dispatch to the Central Execution Engine
  return executeDispatchPipeline({
    reqId,
    method: req.method,
    path: "/v1/chat/completions",
    directive,
    rawInboundBody: rawBody,
    outboundPayload: transformed,
    clientSignal: req.signal,
    clientHeaders: req.headers,
  });
}
```

#### 2. Concrete Streaming Transformer Interface Contract:
To prevent architectural drift and guarantee bidirectional compatibility between `src/engine/dispatch.ts` and the route handlers, every handler implements the standardized `PayloadTransformerContract`:

```typescript
// src/handlers/types.ts
import type { ParsedDirective } from "../directive/types";
import type { RequestTelemetry } from "../telemetry/session";

export interface OutboundWirePayload {
  readonly endpointKey: string; // "ch" (chat), "ms" (messages), "rs" (responses), etc.
  readonly method: "POST" | "GET";
  readonly headers: Record<string, string>;
  readonly body: Record<string, unknown> | string;
  readonly isStreaming: boolean;
}

export interface PayloadTransformerContract<TClientIn = unknown, TClientOut = unknown> {
  /** 1. Pure Inbound Transformation: Converts downstream client JSON into target wire JSON */
  transformClientToWire(
    inboundBody: TClientIn,
    directive: ParsedDirective,
    headers: Headers
  ): OutboundWirePayload;

  /** 2. Non-Streaming Response Translation: Translates upstream vendor JSON into downstream client JSON */
  transformWireToClient(
    upstreamJson: unknown,
    directive: ParsedDirective
  ): TClientOut;

  /** 3. Streaming Response Translation: Returns a TransformStream translating raw upstream SSE chunks into client SSE */
  createWireToClientStream(
    directive: ParsedDirective,
    telemetry: RequestTelemetry,
    clientSignal: AbortSignal
  ): TransformStream<Uint8Array, Uint8Array>;
}
```

#### 3. Unified Dispatch Engine (`src/engine/dispatch.ts`):
Contains the **one and only execution loop** in the entire codebase:
- **Pacer Conveyor Acquisition & Deterministic SLA Load Shedding**:
  - Outbound dispatches are paced FIFO between `min_delay_ms` and `max_delay_ms`.
  - Prior to enqueuing, the engine computes: `estimatedWaitMs = queueLength * prov.pacer.min_delay_ms`.
  - If `estimatedWaitMs > prov.pacer.max_conveyor_queue_sla_ms` (e.g. 45s), LiteRouter sheds load immediately:
    ```json
    HTTP 503 Service Unavailable
    {
      "error": {
        "code": "provider_conveyor_saturated",
        "message": "Conveyor queue depth SLA exceeded. Downstream agent should backoff or switch models."
      }
    }
    ```
- **Decoupled Prompt Resilience (`request_retry`) & Progressive Key Backoff (`key_cooldown`)**:
  - **Inbound Prompt Resilience (`request_retry`)**: When an upstream error or 429 occurs, the prompt never sleeps 10s. It takes a fast 150ms-300ms relay breath and immediately tries the next healthy key in the pool (up to `request_retry.max_attempts`, default: 3).
  - **Key-Level Progressive Backoff (`key_cooldown`)**: When Key #1 hits an RPM 429, Key #1 is benched in the background:
    $$\text{Dwell} = (\text{initial\_cooldown\_ms} \times \text{backoff\_factor}^{\text{streak}}) \pm \text{jitter}$$
    (e.g. 10s $\rightarrow$ 15s $\rightarrow$ 22.5s with $\pm 20\%$ jitter). If upstream sends a `Retry-After` header, it takes precedence. A single subsequent `HTTP 200` resets Key #1's failure streak to 0.
  - **Daily Quota Conservation (`conserve_rules`)**: Hard daily account exhaustion (matching normalized substrings like `"free-models-per-day"`) locks the key until `midnight_utc` or `midnight_pacific`.
  - **Key Pool Exhaustion**: If all registered keys for a provider are in cooldown or conserved state, the engine immediately fails fast with `HTTP 429` back to the downstream client (OpenCode / Pydantic AI) without thrashing upstream.
- **First Content Chunk Gate (Anti-Ghosting Protection)**:
  - On upstream `HTTP 200`, the engine does **not** commit the response downstream until the first actual content/delta token is decoded (`readFirstContentChunkWithTimeout`).
  - If upstream returns `HTTP 200` but drops the socket or emits 0 content tokens, the engine throws `NoResponseError`.
  - **Zero Bytes Sent Rule**: Because the downstream client has not received HTTP headers or bytes, the failed attempt is caught, the key is rotated, and the request is safely retried through the conveyor.
- **Deterministic HTTP Retry Classification**:
  - **`FAIL_FAST`** (0ms relay to client, all 4 legs recorded): `400, 404, 413, 414, 422, 451, 501, 505`.
  - **`KEY_ROTATION`** (rotate key, re-queue on conveyor): `401, 403, 429`.
  - **`TRANSIENT_RETRY`** (re-queue on conveyor with jitter, key remains healthy): `500, 502, 503, 504, 520-526`.
- **Mid-Stream Cutoff Rule**: Once the first byte/chunk has been committed and piped to the downstream editor/client, the stream is committed. Any subsequent upstream error cleanly terminates the SSE stream (`[DONE]`) without secondary re-execution to prevent corrupting editor buffers.
- **Upstream HTTP/2 Multiplexed Fetch & Mandatory Client Attribution**:
  - Uses origin-level persistent HTTP/2 sessions (`h2_pool.ts`) with automatic HTTP/1.1 fallback.
  - **Mandatory Client Attribution Headers (NEVER DROP)**: The outbound request sent to the provider **MUST** merge the declarative `headers` configured in `config/providers.json`. For OpenRouter and Zen, this strictly includes:
    ```http
    HTTP-Referer: https://opencode.ai
    X-Title: OpenCode
    User-Agent: OpenCode/1.18.29
    ```
    LiteRouter informs upstream providers that traffic originates from OpenCode. Dropping, sanitizing, or omitting these headers when firing upstream requests is strictly prohibited.
- **Telemetry & 4-Leg Audit**: Sanitizes headers and bodies, emits terminal progress, pushes to RAM ring buffer, and schedules lazy SQLite persistence.

---

## 7. Phased Implementation & Validation Protocol

To protect production stability and avoid breaking running gateways, execution is strictly phased:

```
┌─────────────────────────────────────────────────────────────┐
│ PHASE 0: Baseline Backup & Versioning Pre-flight            │
│ • Create backup branch: git branch v4.0 (from current main) │
│ • Bump package.json version: 4.0.0 -> 4.1.0 (on main)       │
│ Gate: git branch shows v4.0, working on main                │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ PHASE 1: Configuration Foundation (Zero Handlers Touched)   │
│ • Extend src/config/schema.ts (Zod provider schemas)        │
│ • Update config/providers.json (add retry, pacer, limits)   │
│ • Implement src/config/providers.ts (In-memory store)       │
│ • Wire boot load & POST /reset in src/index.ts              │
│ Gate: bun test && bun run scripts/doctor.ts                 │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ PHASE 2: Telemetry & Tracing Engine (Zero Handlers Touched) │
│ • Implement src/telemetry/session.ts (RequestTelemetry)     │
│ • Implement RAM Ring Buffer & lazy bun:sqlite flusher       │
│ • Consolidate src/ui/logger.ts -> src/telemetry/logger.ts   │
│ • Add CLI inspection script: scripts/trace.ts               │
│ Gate: bun test tests/unit/telemetry_session.test.ts         │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ PHASE 3: Unified Gateway Dispatch Engine (Single Execution) │
│ • Implement src/engine/dispatch.ts                          │
│ • Centralize pacer queue acquisition from provider config   │
│ • Centralize key selection, bounded retry jitter, quarantine│
│ • Centralize upstream fetch (HTTP/2 / HTTP/1.1)             │
│ Gate: bun test tests/unit/dispatch_engine.test.ts           │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ PHASE 4: Handler Decoupling (Pure Transformers, 1 by 1)     │
│ • 4A: src/handlers/openai_compat.ts -> Gate: bun test       │
│ • 4B: src/handlers/anthropic_compat.ts -> Gate: bun test    │
│ • 4C: src/handlers/google_native.ts -> Gate: bun test       │
│ • 4D: src/handlers/gcp_compat.ts -> Gate: bun test          │
│ • 4E: src/handlers/openai_original.ts -> Gate: bun test     │
└──────────────────────────────┬──────────────────────────────┘
                               │
┌──────────────────────────────▼──────────────────────────────┐
│ PHASE 5: Environmental Cleanup & Dead Code Eradication      │
│ • Eradicate CooldownManager (src/network/cooldown.ts) and all│
│   quarantine TTL/circuit breaker complexity completely      │
│ • Eradicate maxQueueDepth, maxQueueWaitMs, and queue timeout│
│   code from pacer.ts, env.ts, handlers/*, and index.ts      │
│ • Purge dead knobs from .env & .env.example                 │
│ • Eradicate src/ui/ folder completely                       │
│ Gate: Full Suite (bun test && uv run pytest tests/integrat.)│
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Definition of Done & Quality Gates

A pull request or branch is considered complete only when:
1. **Zero New Dependencies**: Accomplished with native Bun and TypeScript.
2. **Deterministic Jitter**: `calculateRetryDelay` verified by unit tests across boundaries `[min_delay_ms, max_delay_ms]`.
3. **Zero Hardcoded Provider Maps**: `PROVIDER_NAMES` in `logger.ts` is deleted; all provider identity flows through `config/providers.json`.
4. **All Handlers Covered**: No raw `console.log` calls or duplicate duration math remain in any of the 5 handler files.
5. **No Regressions**: `bun run typecheck` passes with zero errors, and `bun test` passes with 100% exit code 0.
6. **Zero API Key Leakage**: `.env.local` and runtime secret keys are completely untouched.
7. **Mandatory Client Attribution Preserved**: `HTTP-Referer: https://opencode.ai`, `X-Title: OpenCode`, and `User-Agent: OpenCode/1.18.29` verified present on upstream outbound dispatches to OpenRouter and Zen via unit and integration tests; never dropped or omitted.

---

## 9. Key Resolved Architectural Decisions

All key architectural decisions for LiteRouter v4.1 have been aligned, strengthened, and locked in Beads persistent memory:

1. **Log Level Filtering (`LOG_LEVEL`)**:
   - `LOG_LEVEL=info` (default) suppresses fast pacer queue ticks (`dwellMs <= 50ms`) and raw H2 socket pooling traces, reserving them exclusively for `LOG_LEVEL=debug`.
2. **Terminal Formatting, 4-Leg Tracing & Secret Masking**:
   - Terminal retains clean emoji UI.
   - All 4 correlated request/response legs are stored in-memory in a Bounded RAM Ring Buffer (last 100 traces, 32MB cap, 64KB per-leg truncation guard) for 0ms instant inspection via `bun run scripts/trace.ts <req_id>`.
   - Automated secret redaction scrubs vendor API keys and client authorization tokens before writing to RAM or `logs/traces.db`.
   - Lazy SQLite flushing (`logs/traces.db`) using native `bun:sqlite` with generous RAM buffering (30s interval or 100 traces / 16MB cap) for 30-day retention.
3. **Pure Stateless Transformers & Unified Dispatch Engine**:
   - Handlers contain zero timers, zero pacer calls, zero sleep delays, and zero retry loops. Handlers strictly implement `PayloadTransformerContract`.
   - All execution mechanics live exclusively in `src/engine/dispatch.ts`.
4. **Strict Provider-Level Conveyor Belt & Deterministic SLA Load Shedding**:
   - Strictly FIFO at the provider level. Outbound dispatches spaced between `min_delay_ms` and `max_delay_ms`.
   - Load shedding backstop: requests where estimated conveyor wait (`queueLength * min_delay_ms`) exceeds `max_conveyor_queue_sla_ms` (45s) fail fast with HTTP 503 instead of creating unbounded queue buildup.
   - Boot fails fast with exit code 1 if `min_delay_ms` or `max_delay_ms` are missing or invalid in `config/providers.json`.
5. **Deterministic HTTP Retry Taxonomy & Mid-Stream Boundary**:
   - `FAIL_FAST` (0ms relay to client, all 4 legs recorded): `400, 404, 413, 414, 422, 451, 501, 505`.
   - `KEY_ROTATION` (rotate key, re-queue on conveyor): `401, 403, 429`.
   - `TRANSIENT_RETRY` (re-queue on conveyor with jitter, key remains healthy): `500, 502, 503, 504, 520-526`.
   - Ghost response interception: `readFirstContentChunkWithTimeout` catches empty HTTP 200 responses before bytes reach the client, enabling safe key rotation.
   - Mid-stream rule: once the first byte has reached the editor, never retry; cleanly terminate the stream with `[DONE]`.
6. **Decoupled Prompt Resilience (`request_retry`) vs Key Backoff (`key_cooldown`)**:
   - `request_retry`: Prompt resilience across keys with fast 150-300ms relay jitter (max 3 attempts).
   - `key_cooldown`: Physical key penalty box on 429s (10s base $\times 1.5^{\text{streak}}$ with $\pm 20\%$ jitter, max 60s, success streak reset, respecting upstream `Retry-After`).
   - `conserve_rules`: Hard daily quota exhaustion locks key until midnight UTC/Pacific. Zero hardcoded error strings in code.
7. **Version Strategy**:
   - `main` is backed up to branch `v4.0` prior to editing.
   - Redesign is delivered as `v4.1.0` directly on `main`.

---

## 10. Production Deployment, Health Verification & Rollback Runbook

This section serves as the standalone operational runbook for executing, validating, and managing LiteRouter v4.1 in production.

### 10.1 Pre-Flight Deployment Gate Checklist
Before any code cutover to production:
- [ ] **Git Backup Executed**: Verify `git branch` contains `v4.0` pointing to pre-migration `main` commit.
- [ ] **Secret Vault Protection**: Verify `.env.local` permissions are `644` and root-owned via `bash scripts/protect.sh`. Confirm `.env.local` contains valid API key lines matching all `env_key` fields in `config/providers.json`.
- [ ] **Static Typecheck**: `bun run typecheck` (`tsc --noEmit`) passes with 0 errors.
- [ ] **Unit Test Suite**: `bun test` passes with 100% exit code 0.
- [ ] **Integration Test Suite**: `uv run pytest tests/integration/` passes against the gateway.
- [ ] **Python Hygiene**: `uv run ruff check .` passes with 0 errors.

### 10.2 Deployment & Hot-Reload Operational Boundaries
- **Hot Configuration Reload (`POST /reset`)**:
  - Hot reloads `config/providers.json` in-memory provider registry and active key pools.
  - Command: `curl -sk -X POST https://localhost:7766/reset`
  - Scope: Safely updates headers, retry counts, pacer rates, and conserve rules without restarting the process or dropping active HTTP/2 connections.
  - *Boundary Limitation*: Cannot rebind ports, host IP, or reload TLS certificates.
- **Full Gateway Restart (Process Cutover)**:
  - Required when changing `package.json`, updating core binaries, or rebinding ports.
  - Command: `bash scripts/restart.sh` (or `bash scripts/stop.sh && bash scripts/start.sh`).
  - Automatically verifies tmux daemon session `literouter` is alive on port `7766`.

### 10.3 Post-Deployment Verification Matrix
Immediately following deployment, run the following verification sequence:
1. **Liveness & Engine Health Probe**:
   ```bash
   curl -sk https://localhost:7766/health
   # Expected: HTTP 200 {"status":"ok","uptime":...,"providers":5,"h2_pool":...}
   ```
2. **Provider Key Pool Doctor**:
   ```bash
   bun run scripts/doctor.ts
   # Expected: All configured providers report valid keys and passing status
   ```
3. **End-to-End Chat Completion Smoke Test**:
   ```bash
   curl -sk -X POST https://localhost:7766/v1/chat/completions \
     -H "Authorization: Bearer lr-zn-oa-ch-no" \
     -H "Content-Type: application/json" \
     -d '{"model":"big-pickle","messages":[{"role":"user","content":"ping"}]}'
   # Expected: HTTP 200 with valid OpenAI chat completion envelope
   ```
4. **4-Leg Telemetry & Secret Masking Verification**:
   ```bash
   # Inspect the most recent request trace to verify zero key leakage
   bun run scripts/trace.ts --errors -n 1 || bun run scripts/trace.ts $(tail -1 logs/recent_req.id)
   # Verify: Headers display 'Bearer [REDACTED...]' and zero plain-text secrets appear in output
   ```

### 10.4 Downstream Agent Compatibility Verification
LiteRouter v4.1 must be tested and verified against all 3 primary downstream agentic orchestrators:
- **OpenCode 2 (OpenCode TUI / CLI)**:
  - Directive: `lr-zn-oa-ch-no` or `lr-or-oa-ch-no`
  - Verifies: Thinking block stripping (`delta.reasoning_content`) and XML tool call passthrough.
- **Claude Code CLI**:
  - Directive: `lr-or-cl-ms-no` or `lr-an-cl-ms-no`
  - Verifies: Native Anthropic Messages protocol (`/v1/messages`), streaming input tokens, and tool usage deltas.
- **Pydantic AI (Python SDK v2.0+)**:
  - Directive: `lr-nv-oa-ch-no`
  - Verifies: Strict Pydantic model validation, structured JSON outputs, and HTTP/2 connection reuse.
  - Run probe: `bun run scripts/probe_model.ts deepseek-ai/deepseek-r1`

### 10.5 30-Second Emergency Rollback Protocol
If catastrophic failures, memory leaks, or unrecoverable gateway stalls occur in production:

```bash
# 1. Stop the running v4.1 gateway daemon immediately
bash scripts/stop.sh

# 2. Hard revert git repository to the v4.0 safety backup branch
git reset --hard v4.0

# 3. Clean runtime dependencies and verify lockfile
bun install --frozen-lockfile

# 4. Restart the proven v4.0 gateway daemon
bash scripts/start.sh

# 5. Verify health probe returns HTTP 200
curl -sk https://localhost:7766/health

# 6. Verify traffic restoration with doctor probe
bun run scripts/doctor.ts
```
*Target Rollback Execution Time: < 30 seconds.*
