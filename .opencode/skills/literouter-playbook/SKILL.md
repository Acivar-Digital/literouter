---
name: literouter-playbook
description: LiteRouter API Gateway master operational guide for Bun/TypeScript proxy on port 7766.
---

# Skill: literouter-playbook

# LiteRouter API Gateway (Master Playbook)

## Quick Start & Commands
- **Run Gateway (Foreground):** `bun run src/index.ts`
- **Start Gateway (Tmux/Background):** `bash scripts/start.sh`
- **Restart Gateway (Flush Valkey + Start):** `bash scripts/restart.sh`
- **Unit Test Suite (TypeScript):** `bun test`
- **Integration Test Suite (Python/Pytest):** `uv run pytest tests/integration/`
- **Code Complexity Analysis:** `bun run complexity`
- **Health Check Probe:** `curl -H "Authorization: Bearer <KEY>" localhost:7766/health`
- **Doctor Diagnostic Script:** `bun run scripts/doctor.ts` (FYI key static validation, non-blocking)

---

## 8-File Modular Architecture & Responsibilities

LiteRouter is structured into 8 modular TypeScript source files located in `src/`:

```
src/
├── config/
│   └── env.ts            # Environment, model/provider limits, static key validation & helper utils
├── network/
│   └── fetcher.ts        # First-byte timeout fetcher & NoResponseError definition
├── transformers/
│   ├── thinking.ts       # Reasoning effort & thinking configuration translation
│   └── payload.ts        # Payload cleaning, thought signature injection, latex normalization & streaming SSE
├── handlers/
│   ├── openai_compat.ts  # OpenAI-compatible API execution & first-byte retry loop
│   └── google_native.ts  # Google Native API execution & Google Interactions handler
├── lib.ts                # Barrel re-export file exporting config, network, thinking & payload modules
└── index.ts              # Server entry point (Bun port 7766), Redis/Valkey router, Fusion state & routes
```

### File Responsibilities Matrix

| File | Responsibilities |
| :--- | :--- |
| **`src/config/env.ts`** | Centralizes configuration and environment variables (`LITEROUTER_PORT`, `LITEROUTER_AUTH_KEY`, `LITEROUTER_COLLAPSE_REASONING`, `LITEROUTER_ROTATE_DELAY_MS`, `LITEROUTER_MAX_ATTEMPTS`, `LITEROUTER_HTTP_TIMEOUT_MS`, `LITEROUTER_NO_RESPONSE_TIMEOUT_MS`, `LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS`, `LITEROUTER_STREAM_IDLE_TIMEOUT_MS`, `MIN_ROTATE_DELAY_MS=2000`). Defines provider/model limits (`MODEL_LIMITS` now empty `{}`, `PROVIDER_LIMITS`, `DEFAULT_LIMITS`), static key validation (`staticValidateKeys`), provider delay calculations (`getProviderDelayMs`), reset delay parsers (`parseResetDelay`), token usage extraction (`parseUsageFromJson`), API URL mappings (`PROVIDER_API_URLS`), emoji constants (`EMOJI`), and logging utilities (`logWarn`). |
| **`src/network/fetcher.ts`** | Exposes `fetchWithFirstByteTimeout` and `NoResponseError`. Monitors upstream requests to detect silent backends and stalled streams. Holds HTTP 200 OK headers from downstream while inspecting initial SSE chunks for actual content tokens (`delta.content`, `delta.reasoning_content`, `delta.thought`, `delta.tool_calls`, or Gemini `parts[].text`). If an upstream sends 0 content tokens (or metadata-only chunks `{"role":"assistant","content":""}`) within `LITEROUTER_NO_RESPONSE_TIMEOUT_MS` (5s), throws `NoResponseError`, aborting the fetch before headers reach downstream so handlers can immediately resend to Key #2. After the first byte arrives, continues monitoring the stream for idle timeouts (`LITEROUTER_STREAM_IDLE_TIMEOUT_MS`, default 30s). If no chunk arrives within the idle window, throws `NoResponseError` — same retry path as 0-token ghosting (immediate key rotation, 0ms delay, no cooldown). |
| **`src/transformers/thinking.ts`** | Translates provider-specific reasoning/thinking options into standard OpenAI-style `reasoning_effort` fields (`extractThinkingLevel`, `applyReasoningEffort`, `translateGoogleThinking`). |
| **`src/transformers/payload.ts`** | Manages thought signatures (`injectThoughtSignature`, `extractThoughtSignature`), token estimation (`estimateTokens`), Gemma unsupported field stripping (`cleanGemmaPayload`), LaTeX formatting (`cleanLatexSymbols`), message merging (`mergeConsecutiveMessages`), non-streaming reasoning transformations (`transformNonStreaming`), and streaming SSE stream transformations (`createStreamTransformer`). Exports `StreamMeta` interface. The `createStreamTransformer` function transforms upstream SSE chunks for OpenAI-compatible providers, handling thought signature injection, reasoning normalization, LaTeX cleaning, and usage extraction. A keep-alive timer injects SSE comment lines (`:\n\n`) every 15 seconds to prevent downstream SSE clients from idling out during slow upstream streams. |
| **`src/handlers/openai_compat.ts`** | Implements `executeOpenAICompat`, `processOpenAIError`, and `processOpenAISuccess`. Manages key rotation loops for OpenAI-compatible providers (OpenRouter, NVIDIA, Zen, Google OpenAI-compat), error handling, 502 grace retries, and first-byte ghosting retry handling (no cooldown penalty on ghosted keys). |
| **`src/handlers/google_native.ts`** | Implements `executeGoogleNative` (for Google `:generateContent` / `:streamGenerateContent` native endpoints) and `executeGoogleInteractions` (for Google agent API `antigravity-preview-05-2026`). Manages query parameter signing, error handling, first-byte ghosting retry via `fetchWithFirstByteTimeout`, and SSE keep-alive comment injection. |
| **`src/lib.ts`** | **Barrel re-export file**. Exports all public types, constants, and utilities from `config/env`, `network/fetcher`, `transformers/thinking`, and `transformers/payload` for clean modular imports across handlers and 100% backward compatibility with `tests/unit/core/`. |
| **`src/index.ts`** | Application entry point running `serve` on port 7766. Contains trace logging (`recordTrace`), emoji logging (`logState`, `logWarn`, `logError`), static key verification, model/fusion registry loading (`models.json`, `fusion.json`), Valkey/Redis `ModelFirstRouter` (ZSET rolling quota Lua script, `reportError` cooldowns, usage recording), Fusion state (in-memory circuit breaker and sticky position), auth checking (`verifyAuthKey`), and HTTP route dispatchers. |

---

## Endpoints & Handlers

LiteRouter exposes 4 main HTTP endpoints on port 7766:

| Endpoint Path | Handler Function | Target Upstream | Target Clients |
| :--- | :--- | :--- | :--- |
| **`/v1/chat/completions`** | `executeOpenAICompat`<br>*(or `executeFusion` if in `fusion.json`)* | OpenAI-compatible endpoints (`/chat/completions`) for NVIDIA, OpenRouter, Zen, or Google OpenAI-compat (`/v1beta/openai/chat/completions`). | pydantic-ai, OpenAI SDKs, LiteLLM, OpenCode |
| **`/v1beta/interactions`**<br>*(or `/v1/interactions`)* | `executeGoogleInteractions` | Google Interactions API (`https://generativelanguage.googleapis.com/v1beta/interactions`) for `antigravity-preview-05-2026`. | Google Agent clients, Antigravity runners |
| **`/v1beta/models/*`**<br>*(e.g., `/v1beta/models/{model}:{action}`)* | `executeGoogleNative`<br>*(or `executeFusion` if in `fusion.json`)* | Google Native API (`https://generativelanguage.googleapis.com/v1beta/models/{upstream_model}:{action}`). | OpenCode native Gemini integration |
| **`/health`** | Inline handler | Returns `{"status": "ok"}` (200 OK). | Load balancers, health checks, monitoring |

---

## First-Byte & Idle Timeout Ghosting Retry Logic

When an upstream provider accepts a connection but stalls silently or sends metadata-only chunks with zero content tokens:

1. **Header Holding & Content Token Inspection (`src/network/fetcher.ts`):**
   `fetchWithFirstByteTimeout` sets a timer for `LITEROUTER_NO_RESPONSE_TIMEOUT_MS` (configured via `LITEROUTER_NO_RESPONSE_TIMEOUT`, default `5` seconds). It holds HTTP 200 OK headers from being flushed to downstream while inspecting incoming body chunks for actual content tokens (`delta.content`, `delta.reasoning_content`, `delta.thought`, `delta.tool_calls`, or Gemini `parts[].text`).
   If 0 content tokens arrive within 5s (or if upstream sends metadata-only chunks like `{"role":"assistant","content":""}`), `fetchWithFirstByteTimeout` aborts the upstream fetch **before** headers reach downstream and throws `NoResponseError("upstream sent 0 content tokens")`.

2. **Idle Timeout Monitoring (`src/network/fetcher.ts`):**
   After the first content token arrives, `fetchWithFirstByteTimeout` continues monitoring the upstream stream for idle timeouts (`LITEROUTER_STREAM_IDLE_TIMEOUT_MS`, default `30` seconds). If no chunk arrives within the idle window, `fetchWithFirstByteTimeout` aborts the upstream fetch and throws `NoResponseError("upstream sent 0 content tokens within timeout")`.

3. **Immediate Key Rotation without Cooldown (`src/handlers/openai_compat.ts` & `src/handlers/google_native.ts`):**
   When `e instanceof NoResponseError` is caught (whether from 0-token ghosting or idle timeout):
   - A warning log is emitted (`EMOJI.amber`) with disambiguated key suffix logging (`key=...${activeKey.slice(-6)}`).
   - The request immediately retries on Key #2 with **0ms delay** (`continue`).
   - Key #1 remains **unlocked in Valkey (no cooldown imposed)** because the upstream timed out/ghosted transiently rather than returning an explicit rate limit or auth error payload.

4. **Exhaustion Guard:**
   If all `maxAttempts` keys ghost without sending content tokens or go idle, the gateway logs exhaustion (`EMOJI.exhausted`) and exits the loop, preventing infinite hangs or unbounded retries.

---

## Stream Inter-Chunk Idle Timeout (Moved to Fetcher)

The inter-chunk idle timeout is now handled at the `fetchWithFirstByteTimeout` level in `src/network/fetcher.ts`, not at the transformer level. When an upstream stream stalls mid-generation (no chunk received within `LITEROUTER_STREAM_IDLE_TIMEOUT_MS`, default `30` seconds), the fetcher throws `NoResponseError`, triggering the same immediate key rotation and resend logic as 0-token ghost streams.

The stream transformers (`createStreamTransformer` for OpenAI-compatible providers, inline transform for Google Native) no longer handle idle timeouts. They focus solely on SSE parsing, thought signature injection, reasoning normalization, LaTeX cleaning, and usage extraction.

Both stream transformers still inject SSE comment lines (`:\n\n`) every 15 seconds via keep-alive timers to prevent downstream SSE clients from triggering their own idle timeouts during slow upstream responses where tokens arrive infrequently.

---

## 429 Rotation & 2s Minimum Rotation Delay Logic

1. **Rotation Delay Floor (`MIN_ROTATE_DELAY_MS = 2000`):**
   Key rotation delay between attempts is controlled by `getProviderDelayMs(provider)`. It resolves the environment variable `${PROVIDER}_MIN_DELAY_MS` or `LITEROUTER_ROTATE_DELAY_MS` (default 10s), but enforces a **hard minimum floor of 2000ms (2s)** (`MIN_ROTATE_DELAY_MS`).
2. **Immediate Exhaustion Output (No 65s Stalls):**
   When upstream returns 429 rate limit or quota errors, `router.reportError` places the active key on a 65s cooldown in Valkey/Redis.
   If all available keys in the pool are in cooldown or quota-exhausted, `router.getAvailableKey` throws:
   `All keys for {provider} are in cooldown or have exhausted quota for model {modelName}.`
   The handler catches this error and **immediately returns HTTP 429** to the downstream client without stalling or waiting out long 65s cooldown windows.

---

## Redis Key Cooldown TTLs (`ModelFirstRouter.reportError`)

Cooldown states are stored in Valkey/Redis under `cooldown:{provider}:{keyHash}:{modelName}`:

| Error Type / Status | Default TTL | Cooldown State | Notes & Overrides |
| :--- | :--- | :--- | :--- |
| **`429` / `rate_limit`** | **65s** | `rate_limited` | Reset delays parsed via `parseResetDelay` from `Retry-After` headers or body regex (`quotaResetDelay`) can override TTL (clamped 5s–7200s). |
| **Google & Nvidia Provider Errors** | **Min 65s** | `rate_limited` | Any error on `google` or `nvidia` providers is floored at a **minimum TTL of 65s** (`ttl = Math.max(ttl, 65)`). |
| **Timeouts / `500`, `502`, `503`, `504`** | **10s** | `timed_out` | Short cooldown for transient upstream server or proxy errors. |
| **Auth / Permission (`401`, `403`, `auth`, `permission_denied`)** | **7 days** (604,800s) | `quarantined` | Long-term quarantine for revoked or invalid keys. |
| **General / Default Errors** | **30s** | `error_{errorType}` | Fallback cooldown duration for unclassified errors. |

---

## Fusion Sticky Fallback Mechanism

Fusion groups defined in `fusion.json` (e.g. `pydantic/google`, `pydantic/nvidia`) execute resilient multi-model fallback chains:

1. **Circuit Breaker (`CIRCUIT_TTL = 65000` ms / 65s):**
   When an upstream model in a fusion chain returns HTTP 429 or >= 500 status, `openCircuit(upstreamId)` marks the backend circuit as open for 65 seconds (`CIRCUIT_TTL`). Subsequent fusion requests skip open-circuit backends.
2. **Sticky Position (`STICKY_TTL = 300000` ms / 300s / 5min):**
   When a primary backend fails and a fallback upstream succeeds, `setSticky(groupId, upstreamId)` records the fallback position for 5 minutes (`STICKY_TTL`).
   Subsequent requests for that fusion group begin directly at the sticky fallback position, avoiding unnecessary attempts against the failing primary.
   When the primary model recovers and succeeds, `clearSticky(groupId)` resets the group to start at the primary backend.

---

## Command Reference Summary

```bash
# Start gateway directly in foreground
bun run src/index.ts

# Start gateway in background (tmux session: literouter)
bash scripts/start.sh

# Restart gateway (flushes Valkey/Redis state + restarts daemon)
bash scripts/restart.sh

# Run TypeScript unit tests
bun test

# Run Python integration smoke tests against live gateway
uv run pytest tests/integration/

# Run code complexity report
bun run complexity
```