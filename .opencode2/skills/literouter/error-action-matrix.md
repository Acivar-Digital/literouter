# LiteRouter Error → Action Matrix

Status/error → classify fn → cooldown TTL → retry/quarantine → signal string.
All symbols grounded in `src/` reads. Line numbers are source of truth.

## 1. Status → action matrix

| # | Signal | Classify fn | Cooldown TTL | Retry / quarantine | Signal / reason string |
|---|--------|-------------|--------------|--------------------|------------------------|
| 1 | 429 standard rate limit (+`Retry-After`) | `classifyUpstreamError` (`src/network/classifier.ts:86`) → `parseResetDelay` (`src/network/cooldown.ts:90`) | `parseResetDelay` header/body value clamped 5s–2h (`src/network/cooldown.ts:19-20`); fallback `COOLDOWN_RATE_LIMIT_TTL_SEC` (default 65s, `src/config/env.ts:18`); grace ≤2000ms retried fast (`src/network/cooldown.ts:21`); TTL forced 0 when provider quarantine disabled or `COOLDOWN_RATE_LIMIT_TTL_SEC=0` (`src/network/classifier.ts:149-152`) | `action: retry_rotate`, `isRetryable: true` → `KeyPool.reportFailure` (`src/network/pool.ts:147`) → `CooldownManager.quarantineKey` (`src/network/cooldown.ts:182`); pool emits `available:<provider>` on expiry (`src/network/pool.ts:106-120`) | reason `Rate limit reached (429)` (`src/network/classifier.ts:157`) |
| 2 | 429 quota/credit exhaustion (`insufficient_quota`, `credit_limit`, `out of balance`) | `classifyUpstreamError` (`src/network/classifier.ts:86`) → `isQuotaExhausted429` (`src/network/classifier.ts:32-38`) | 7 days (`604800s`, `SEVEN_DAYS_SEC`, `src/network/classifier.ts:23,142`); 0 when provider quarantine disabled | `action: retry_rotate`, `isRetryable: true`; long quarantine, rotate to next key | reason `Quota or credit exhaustion (429)` (`src/network/classifier.ts:143`) |
| 3 | 401 / 403 tier 1 (1st consecutive auth failure) | `classifyUpstreamError` (`src/network/classifier.ts:162-174`) / `KeyPool.computeTieredAuthTtl` (`src/network/pool.ts:135-145`) | 300s | `action: retry_rotate`, `isRetryable: true` → `reportFailure` applies tiered TTL when `customTtlSec` undefined (`src/network/pool.ts:165-167`) | reason `auth_failure_key_quarantined` (`src/network/classifier.ts:171`) |
| 4 | 401 / 403 tier 2 (2nd consecutive) | same as row 3 | 1800s (`src/network/classifier.ts:165`, `src/network/pool.ts:141-143`) | same as row 3 | same reason string |
| 5 | 401 / 403 tier 3+ (3rd consecutive and beyond) | same as row 3 | 86400s (1 day) (`src/network/classifier.ts:166`, `src/network/pool.ts:144`); note `STATUS_TTL_MAP` default for 401/403 is 7 days (`src/network/cooldown.ts:111-112`) — tiered path overrides when no custom TTL | same as row 3; success clears counter via `reportSuccess` (`src/network/pool.ts:122-133`) | same reason string |
| 6 | 5xx (500/502/503/504+) | `classifyUpstreamError` (`src/network/classifier.ts:187-194`); `computeStatusTtlSec` (`src/network/cooldown.ts:121-130`) via `STATUS_TTL_MAP` (`src/network/cooldown.ts:109-119`) | 10s (`SERVER_ERROR_DEFAULT_SEC`, `src/network/cooldown.ts:16`) | `action: retry_rotate`, `isRetryable: true`; provider breaker counts critical 5xx toward threshold 5 → OPEN 30s → HALF_OPEN max 2 probes, 2 successes to close (`src/engine/circuit_breaker.ts:5-12,132-158`); mid-stream path reports status 500 with classified TTL (`src/handlers/openai_compat.ts:532-535`) | reason `Transient upstream server error (<status>)` (`src/network/classifier.ts:192`) |
| 6a | 503 half-open probe-cap (dispatch engine, before pacer/fetch) | `breaker.getState() === "HALF_OPEN" && !breaker.canProbe()` (`src/engine/dispatch.ts:337`, probes `src/engine/circuit_breaker.ts:101-113`) | n/a (no quarantine TTL; no stream acquired) | short-circuit 503 `breaker_open`, no `Retry-After` — distinct from row 6b OPEN reject and row 15 pacer overflow | code `breaker_open` (`src/engine/dispatch.ts:344,353`) |
| 6b | 503 breaker OPEN reject (dispatch engine, before pacer/fetch) | `breaker.isOpen()` (`src/engine/dispatch.ts:321`) → `breaker.rejectResponse` (`src/engine/circuit_breaker.ts:160-181`) | open window remainder | short-circuit 503 `circuit_breaker_open` with `Retry-After` | code `circuit_breaker_open` (`src/engine/dispatch.ts:328`, `src/engine/circuit_breaker.ts:168`) |
| 7 | `NoResponseError` (network transport failure, empty body, status-0 timeout) | `fetchWithTtftGuard` throws `NoResponseError` (`src/network/fetcher.ts:588,604,609`); handler maps via status-0 branch of `classifyUpstreamError` (`src/network/classifier.ts:102-117`) or `classifyTransportError` (`src/network/classifier.ts:52-84`) | 2s (`ttft_timeout_exceeded` / `transport_reset_cooldown`); handler passes explicit TTL 2 for `NoResponseError` (`src/handlers/openai_compat.ts:710-713`) | `retry_rotate`, rotate key, `reportFailure(provider, idx, 0, undefined, err.message, now, 2)` | `Network transport failure: <msg>` / `Upstream response has no body stream` / `Upstream emitted 0 bytes before closing` (`src/network/fetcher.ts:588,609,274`) |
| 8 | ECONNRESET / socket reset / GOAWAY / H2 connect timeout | `classifyTransportError` (`src/network/classifier.ts:52-84`); H2 layer: `purgeSession` (`src/network/h2_pool.ts:53-60`), GOAWAY → `startDraining` (`src/network/h2_pool.ts:302-305`), connect timeout reject (`src/network/h2_pool.ts:291-295`); H2 failure falls back to HTTP/1.1 fetch inside `fetchWithTtftGuard` (`src/network/fetcher.ts:571-590`) | 2s (`transport_reset_cooldown`, `src/network/classifier.ts:78-83`); 0s for stream-cancel match (`src/network/classifier.ts:56-63`) | `retry_rotate`, `isRetryable: true`; unhealthy sessions purged, draining sessions kept for in-flight releases (`src/network/h2_pool.ts:206-226`) | `HTTP/2 connection timeout to origin <origin>` (`src/network/h2_pool.ts:294`); runtime purge debug `[H2 Pool] Runtime socket error for <poolKey>, purging session` (`src/network/h2_pool.ts:273`); frame-error purge (`src/network/h2_pool.ts:278`) |
| 9 | Ghost 200 (HTTP 200, zero content tokens) | `readFirstContentChunkWithTimeout` (`src/network/fetcher.ts:257-291`) → `hasContentToken` (`src/network/fetcher.ts:86-97`) | n/a (throws before quarantine decision; surfaces as `NoResponseError` → row 7 TTL 2s) | throws `NoResponseError` → caller retries/rotates per row 7 | `HTTP 200 returned ghost response with 0 content tokens` (`src/network/fetcher.ts:278`) |
| 10 | TTFT guard (no first content chunk in time) | `fetchWithTtftGuard` (`src/network/fetcher.ts:547-625`) → `readFirstContentChunkWithTimeout` (`src/network/fetcher.ts:257`) via `readFirstChunkWithTimeout` (`src/network/fetcher.ts:222-238`); limit `resolveTtftTimeout` (`src/network/fetcher.ts:205-208`); status-0/TTFT branch of `classifyUpstreamError` (`src/network/classifier.ts:103-109`) | 2s (`ttft_timeout_exceeded`, `src/network/classifier.ts:70-76,104-109`); timeout budget `TTFT_TIMEOUT_MS=120000` (`src/network/fetcher.ts:61`), env `LITEROUTER_TTFT_TIMEOUT_MS` / `LITEROUTER_NO_RESPONSE_TIMEOUT_MS` (`src/config/env.ts:13-14`) | `retry_rotate`, `isRetryable: true`; handler re-issues `fetchWithTtftGuard` on next key (`src/handlers/openai_compat.ts:585`) | `TTFT exceeded <ms>ms` (`src/network/fetcher.ts:229`) |
| 11 | Stream idle guard (mid-stream stall, no chunk in time) | `readWithChunkTimeout` (`src/network/fetcher.ts:796-815`) inside `createResilientStream.pull` (`src/network/fetcher.ts:992-996,1144`); errors funnel to `handleStreamFailure` (`src/network/fetcher.ts:911-934`) | n/a (stream-level; key already selected; no new quarantine TTL — retry uses `nextAttemptProvider`/`retryProvider`) | `StreamCallbacks.nextAttemptProvider ?? retryProvider` invoked with reason; on success `applyNextAttempt` swaps reader (`src/network/fetcher.ts:841-865`); else `emitStreamError` (`src/network/fetcher.ts:817-839`); budget `STREAM_IDLE_TIMEOUT_MS=120000` (`src/network/fetcher.ts:62`), env `LITEROUTER_STREAM_IDLE_TIMEOUT_MS` (`src/config/env.ts:15`); outer cap `MAX_HTTP_TIMEOUT_MS=300000` (`src/network/fetcher.ts:63`), env `LITEROUTER_HTTP_TIMEOUT_MS` (`src/config/env.ts:16`) | `Stream idle timeout exceeded <ms>ms` via `StreamStallError` (`src/network/fetcher.ts:54-59,803-805`) |
| 12 | Mid-stream interceptor (in-band error chunk / premature EOF / dropped stream) | `isInBandErrorChunk` (`src/network/fetcher.ts:670-748`) via `handleInBandErrorIfPresent` (`src/network/fetcher.ts:882-909`); `handlePrematureEof` (`src/network/fetcher.ts:867-880`); drop path in `handleEof` (`src/network/fetcher.ts:1059-1086`); downstream frame via `formatMidstreamErrorFrame` (`src/network/fetcher.ts:210-220`) + `emitStreamError` (`src/network/fetcher.ts:817-839`) | n/a (same stream-level retry as row 11) | `nextAttemptProvider ?? retryProvider` retried with `hasEmittedTokens` flag; premature-EOF with `[DONE]` seen → `null` (clean close, no retry, `src/network/fetcher.ts:872-874`); tokens emitted + no provider → error frame + close; no tokens + no provider → raw stream error | `Upstream terminated stream prematurely with 0 tokens and no [DONE] marker` (`src/network/fetcher.ts:879`); `Upstream stream dropped mid-generation` (`src/network/fetcher.ts:1063,1078-1080`); `Upstream emitted finish_reason: network_error chunk` (`src/network/fetcher.ts:690`); `Server error mid-response` (`src/network/fetcher.ts:680-681`) |
| 13 | Retryable 400 (`no available provider`, `temporarily unavailable`) | `classifyUpstreamError` → `isRetryable400` (`src/network/classifier.ts:25-30,120-128`) | 0s | `retry_rotate`, `isRetryable: true` | `Upstream provider temporary failure (retryable 400)` (`src/network/classifier.ts:124`) |
| 14 | Non-retryable 400 / 404 / other 4xx | `classifyUpstreamError` (`src/network/classifier.ts:129-135,177-204`) | 0s | `fail_fast`, `isRetryable: false` — surfaced to client, no rotation | `Client request error (non-retryable 400)` / `Resource or model not found (404)` / `Client error (<status>)` (`src/network/classifier.ts:132,182,201`) |
| 15 | Pacer queue overflow (local backpressure, not upstream) | `RequestPacer.acquire` (`src/network/pacer.ts:108-133`) | client-facing `retryAfterSec` (estimated, ≥1s) | throws `PacerQueueOverflowError` (`src/network/pacer.ts:3-10`) — client should honor `Retry-After`; per-provider pipe via `getPacerForProvider` (`src/network/pacer.ts:251-272`) | `LiteRouter rate limit capacity (<depth>) saturated.` (`src/network/pacer.ts:130`) |

Quarantine-disabled note: `isProviderQuarantineEnabled` (`src/network/pool.ts:18-29`)
returns per-provider flags (`GCP_ENABLE_QUARANTINE`, `ZEN_ENABLE_QUARANTINE`,
`OPENROUTER_ENABLE_QUARANTINE`, `src/config/env.ts:19,41,45`); when disabled,
`reportFailure` returns `quarantine_disabled` with no TTL (`src/network/pool.ts:156-162`)
and `getStatus` reports all keys active (`src/network/pool.ts:258-260`).

## 2. Retry / quarantine call chain (wiring)

1. Handler issues guarded fetch: `fetchWithTtftGuard` (`src/handlers/openai_compat.ts:312`,
   defined `src/network/fetcher.ts:547`).
2. Non-2xx response → `classifyUpstreamError({ provider, status, headers, bodyText,
   consecutiveAuthFailures })` (`src/handlers/openai_compat.ts:326`,
   defined `src/network/classifier.ts:86`).
3. Disposition applied: `globalKeyPool.reportFailure(provider, idx, status, headers, body,
   now, disposition.quarantineTtlSec)` (`src/handlers/openai_compat.ts:335`,
   defined `src/network/pool.ts:147`) → `CooldownManager.quarantineKey` /
   `quarantineKeyWithTtl` (`src/network/cooldown.ts:182,206`).
4. Next attempt: `fetchWithTtftGuard` on next selected key
   (`src/handlers/openai_compat.ts:585`); stream failures route through
   `classifyTransportError` + status-500 `reportFailure`
   (`src/handlers/openai_compat.ts:532-535`).
5. Stream resilience: `createResilientStream(firstChunk, rawReader, callbacks)`
   (`src/handlers/openai_compat.ts:510`, defined `src/network/fetcher.ts:992`)
   with keep-alive `: keep-alive` frames every `KEEPALIVE_INTERVAL_MS`
   (`src/network/fetcher.ts:107-110,182-195`; default 15000, `src/network/fetcher.ts:64`,
   env `src/config/env.ts:24`).
6. Exhaustion backoff ladder for full-pool stalls: `getExhaustionBackoffMs`
   65s → 90s → 120s (`src/network/cooldown.ts:23,132-136`); queue-depth guard
   `getDynamicMaxQueueDepth` / `shouldLoadShed` (`src/network/pool.ts:279-296`).
7. Dispatch-engine TTFT guard: `fetchWithTtftGuard` links the client signal
   into a per-attempt `AbortController` (`src/engine/dispatch.ts:160-191`);
   TTFT expiry aborts the fetch and rejects `NoResponseError`, retried while
   `attempt < maxAttempts`, else 504 `ttft_timeout`
   (`src/engine/dispatch.ts:462-473,614-630`). Client-abort (`clientSignal.aborted`)
   rethrows quiet with no breaker write (`src/engine/dispatch.ts:610-612`);
   mid-stream abort discrimination is pinned by `tests/unit/engine/dispatch_abort.test.ts`
   (quiet close: zero breaker failures, no `[DONE]`, no telemetry 500).

### Taxonomy: `breaker_open` vs `circuit_breaker_open` vs pacer overflow

- `breaker_open`: half-open probe cap (`src/engine/dispatch.ts:337-363`), 503, no `Retry-After`.
- `circuit_breaker_open`: OPEN reject (`src/engine/dispatch.ts:320-335` +
  `src/engine/circuit_breaker.ts:160-181`), 503 with `Retry-After`.
- Pacer overflow: local backpressure `PacerQueueOverflowError`
  (`src/network/pacer.ts:3-10,108-133`) → 429 `rate_limit_exceeded` with
  `Retry-After` (edge mapping `src/index.ts:288-304`). There is no
  `conveyor_saturated` signal string — saturated capacity surfaces as the
  pacer message `LiteRouter rate limit capacity (<depth>) saturated.`

## 3. Full repo file index

### `src/handlers/*` — protocol entry points

| File | Purpose | Key symbol |
|------|---------|------------|
| `src/handlers/openai_compat.ts:959` | OpenAI-compat gateway handler: retry loop, key rotation, fusion flow | `handleOpenAICompat` (`src/handlers/openai_compat.ts:959`); `globalKeyPool` (`src/handlers/openai_compat.ts:184`); `executeDirectRequest` (`src/handlers/openai_compat.ts:857`); `executeFusionFlow` (`src/handlers/openai_compat.ts:921`) |
| `src/handlers/openai_original.ts:975` | OpenAI Original (`/v1 Responses`) wire handler, SSE streaming assembly | `handleOpenAiOriginal` (`src/handlers/openai_original.ts:975`); `createStreamingResponse` (`src/handlers/openai_original.ts:477`) |
| `src/handlers/anthropic_compat.ts:1410` | Anthropic Messages ↔ OpenAI translation + Anthropic SSE transformer | `handleAnthropicCompat` (`src/handlers/anthropic_compat.ts:1410`); `translateAnthropicToOpenAI` (`src/handlers/anthropic_compat.ts:379`); `createAnthropicStreamTransformer` (`src/handlers/anthropic_compat.ts:760`) |
| `src/handlers/gcp_compat.ts:614` | GCP/Vertex compat handler (Gemma model normalization, GCP auth) | `handleGcpCompat` (`src/handlers/gcp_compat.ts:614`); `normalizeGcpModel` (`src/handlers/gcp_compat.ts:54`); `buildGcpAuthHeaders` (`src/handlers/gcp_compat.ts:69`) |
| `src/handlers/google_native.ts:781` | Gemini native chains (flash / flash-lite tier fallback) | `handleGoogleNative` (`src/handlers/google_native.ts:781`); `DEFAULT_FLASH_CHAIN` (`src/handlers/google_native.ts:36`); `resolveNativeChain` (`src/handlers/google_native.ts:79`) |
| `src/handlers/discovery.ts:113` | `/v1/models` discovery aggregation across providers | `handleModelsDiscovery` (`src/handlers/discovery.ts:113`) |

### `src/network/*` — transport, classification, cooldown, pooling

| File | Purpose | Key symbol |
|------|---------|------------|
| `src/network/classifier.ts:86` | Upstream/transport error → retry/quarantine disposition | `classifyUpstreamError` (`src/network/classifier.ts:86`); `classifyTransportError` (`src/network/classifier.ts:52`) |
| `src/network/cooldown.ts:138` | Retry-After parsing, per-status TTL map, key cooldown store | `parseResetDelay` (`src/network/cooldown.ts:90`); `computeStatusTtlSec` (`src/network/cooldown.ts:121`); `CooldownManager` (`src/network/cooldown.ts:138`) |
| `src/network/pool.ts:31` | Round-robin key pools, tiered auth TTL, availability timers | `KeyPool` (`src/network/pool.ts:31`); `reportFailure` (`src/network/pool.ts:147`); `isProviderQuarantineEnabled` (`src/network/pool.ts:18`) |
| `src/network/circuit_breaker.ts:9` | Per-provider circuit breaker (5 failures → OPEN 60s → canary) | `ProviderCircuitBreaker` (`src/network/circuit_breaker.ts:9`); `getCircuitBreakerForProvider` (`src/network/circuit_breaker.ts:111`) |
| `src/network/fetcher.ts:547` | TTFT-guarded fetch, ghost-200 detection, resilient SSE streams | `fetchWithTtftGuard` (`src/network/fetcher.ts:547`); `NoResponseError` (`src/network/fetcher.ts:47`); `createResilientStream` (`src/network/fetcher.ts:992`) |
| `src/network/pacer.ts:82` | Per-provider request pacing queue with overflow backpressure | `RequestPacer` (`src/network/pacer.ts:82`); `getPacerForProvider` (`src/network/pacer.ts:251`); `PacerQueueOverflowError` (`src/network/pacer.ts:3`) |
| `src/network/h2_pool.ts:25` | HTTP/2 session pool: single-flight connect, GOAWAY drain, purge — transport deep-dive: `h2-transport.md` (§1–§7: ALPN, lifecycle, flow, knobs, `/health`, GOAWAY) | `Http2SessionPool` (`src/network/h2_pool.ts:25`); `getHttp2Pool` (`src/network/h2_pool.ts:351`); `attachStreamGuard` (`src/network/h2_pool.ts:125`) |
| `src/network/zdist.ts:25` | Client-side rate-limit tracker (request counting / limit checks) | `RateLimitTracker` (`src/network/zdist.ts:25`) |

### `src/transformers/*` — payload and stream transforms

| File | Purpose | Key symbol |
|------|---------|------------|
| `src/transformers/dots.ts:260` | Dots XML tool-call parse/serialize + streaming Dots→OpenAI SSE transform | `parseDotsXml` (`src/transformers/dots.ts:260`); `createDotsStreamTransformer` (`src/transformers/dots.ts:912`); `TagSanitizerStreamBuffer` (`src/transformers/dots.ts:26`) |
| `src/transformers/payload.ts:322` | Request sanitize/transform entry: latex, nuances, dots/ling, scrub | `sanitizeAndTransformPayload` (`src/transformers/payload.ts:322`); `cleanOpenAIBody` (`src/transformers/payload.ts:375`); `mergeConsecutiveMessages` (`src/transformers/payload.ts:216`) |
| `src/transformers/responses.ts:204` | Responses-API ↔ OpenAI chat SSE/JSON conversion | `transformOpenAiToResponses` (`src/transformers/responses.ts:73`); `createResponsesStreamTransformer` (`src/transformers/responses.ts:204`) |
| `src/transformers/thinking.ts:227` | Thought-signature store/inject + reasoning-param strip, think streaming | `processThinkingDelta` (`src/transformers/thinking.ts:227`); `injectThoughtSignatures` (`src/transformers/thinking.ts:78`); `shouldStripReasoning` (`src/transformers/thinking.ts:96`) |
| `src/transformers/nuances.ts:188` | Nuance-code modifiers (dot-prompt, g3 cleanup, tool-choice) | `applyNuanceModifiers` (`src/transformers/nuances.ts:188`); `applyDotPrompt` (`src/transformers/nuances.ts:109`) |
| `src/transformers/ling.ts:95` | Ling XML request/response + streaming transformer | `transformLingRequest` (`src/transformers/ling.ts:95`); `createLingStreamTransformer` (`src/transformers/ling.ts:466`); `parseLingXml` (`src/transformers/ling.ts:217`) |
| `src/transformers/context_pruner.ts:229` | Token estimation + context-overflow payload pruning | `pruneOpenAIPayload` (`src/transformers/context_pruner.ts:307`); `pruneAnthropicPayload` (`src/transformers/context_pruner.ts:229`); `isContextLengthError` (`src/transformers/context_pruner.ts:118`) |
| `src/transformers/opencode_adapter.ts:25` | OpenCode client detection + reasoning-key scrubbing, delta sanitize | `isOpenCodeClient` (`src/transformers/opencode_adapter.ts:25`); `scrubReasoningFromMessages` (re-exported `src/transformers/payload.ts:18`); `sanitizeDelta` (`src/transformers/opencode_adapter.ts:65`) |

### `src/config/*` — env, keys, schemas

| File | Purpose | Key symbol |
|------|---------|------------|
| `src/config/env.ts:102` | Env defaults + normalization (timeouts, TTLs, pacer/H2 flags) | `getEnv` (`src/config/env.ts:102`); `resetEnvCache` (`src/config/env.ts:110`) |
| `src/config/keys.ts:64` | Key-pool loading, masking, per-provider env-var mapping | `loadKeyPools` (`src/config/keys.ts:64`); `maskKey` (`src/config/keys.ts:51`); `parseKeyList` (`src/config/keys.ts:36`) |
| `src/config/directive.ts:32` | Directive config types re-export surface | type re-exports (`src/config/directive.ts:32`) |
| `src/config/schema.ts:3` | Zod schemas for provider/payload/completion/nuance codes | `ProviderCodeSchema` (`src/config/schema.ts:3`); `NuanceCodeSchema` (`src/config/schema.ts:34`) |

### `src/fusion/*` — multi-provider fusion execution

| File | Purpose | Key symbol |
|------|---------|------------|
| `src/fusion/engine.ts:11` | Fusion execution planner/executor across provider chain | `FusionEngine` (`src/fusion/engine.ts:11`); `FusionExecutionPlan` (`src/fusion/engine.ts:4`) |
| `src/fusion/sticky.ts:16` | Sticky-position cache (5-min TTL) for fusion fallback affinity | `StickyPositionCache` (`src/fusion/sticky.ts:16`); `FUSION_STICKY_TTL_MS` (`src/fusion/sticky.ts:10`) |

### `src/directive/*` — directive-key parsing and validation

| File | Purpose | Key symbol |
|------|---------|------------|
| `src/directive/parser.ts:192` | `lr-` directive key parser (provider, wire, nuances, fusion/direct) | `parseDirective` (`src/directive/parser.ts:192`); `parseNuanceTokens` (`src/directive/parser.ts:96`); `ProviderCode` (`src/directive/parser.ts:1`) |
| `src/directive/validator.ts:75` | Directive token extraction + validation, 401 responses | `validateDirective` (`src/directive/validator.ts:75`); `extractDirectiveToken` (`src/directive/validator.ts:54`); `DIRECTIVE_ERROR_CODE` (`src/directive/validator.ts:3`) |

## 4. Env knob quick reference

`LITEROUTER_TTFT_TIMEOUT_MS` / `LITEROUTER_NO_RESPONSE_TIMEOUT_MS`
(`src/config/env.ts:13-14`), `LITEROUTER_STREAM_IDLE_TIMEOUT_MS`
(`src/config/env.ts:15`), `LITEROUTER_HTTP_TIMEOUT_MS` (`src/config/env.ts:16`),
`COOLDOWN_RATE_LIMIT_TTL_SEC` (`src/config/env.ts:18`),
`COOLDOWN_SERVER_ERROR_TTL_SEC` (`src/config/env.ts:20`),
`COOLDOWN_AUTH_ERROR_TTL_SEC` (`src/config/env.ts:21`),
`KEEPALIVE_INTERVAL_MS` (`src/config/env.ts:24`),
`LITEROUTER_H2_OUTBOUND` (`src/config/env.ts:28`),
pacer + per-provider delay flags (`src/config/env.ts:29-48`).
