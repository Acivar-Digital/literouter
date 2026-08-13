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

## ⛔ CRITICAL MANDATE & ENVIRONMENT WORKFLOW RULES

### 1. Environment File Architecture
* **`.env` (Tracked in Git):** Holds all default operational configurations, server host/port, HTTP timeouts, retry delays, reasoning flags, Redis connection info, circuit breaker/cooldown TTLs, and vendor model defaults & inheritances (`MINIMAXAI_*`, `DEEPSEEK_V4_*`, etc.).
* **`.env.local` (Git-Ignored Secrets Only):** Holds **ONLY secret API keys** (`LITEROUTER_AUTH_KEY`, `OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS`, `ZEN_API_KEYS`, `GOOGLE_API_KEYS`).

### 2. Mandatory Restrictions & Anti-Redaction Policy
> **NEVER EVER REDACT OR PLACEHOLDER LIVE API KEYS IN RUNTIME CONFIG.**
> - **DO NOT** replace real keys with `<REDACTED>`, `changeme`, or placeholder strings in `.env.local`. Replacing real keys causes `staticValidateKeys` to discard all keys on boot and breaks gateway routing.
> - **DO NOT** hardcode real API keys into code, unit tests, scratch scripts, docs, or commit messages.
> - **DO NOT** run automated sanitization or guardrail scripts against `.env.local` or `.env` during automated lint/hygiene sweeps.
> - Use `./protect.sh lock` to make `.env.local` owned by `root:root` (read-only for processes, unwritable by agents). Run `./protect.sh unlock` when you need to edit keys.

---

## 🟢 POSITIVE STEERING: How to Test & Probe Safely (Without Hardcoding Keys)

When developing, testing, or diagnosing LiteRouter or upstream providers, ALWAYS follow these 4 safe patterns:

### Pattern 1: Unit Tests (Use Mock Stubs)
In unit tests (e.g. `tests/unit/core/*.test.ts`), test logic using explicit mock stubs.
```typescript
// ✅ Safe: Mock stubs for unit tests
const mockKey = "sk-test-stub-0001-padded-to-look-like-real";
const mockNvidiaKey = "nvapi-key1";
const validated = staticValidateKeys("NVIDIA", "nvapi-key1,nvapi-key2");
```

### Pattern 2: Integration Probing (Query Local Gateway on Port 7766)
Do not query upstream providers directly in test scripts. Let LiteRouter handle the secret rotation:
```bash
# ✅ Safe: Call local gateway using client auth
curl -s http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-your-auth-key" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nvidia/openai/gpt-oss-120b",
    "messages": [{"role": "user", "content": "hello"}]
  }'
```

### Pattern 3: Dynamic Key Resolution in Diagnostic Scripts
When writing health checks (like `scripts/doctor.ts`), read keys from runtime environment:
```typescript
// ✅ TypeScript: Read from Bun.env or process.env
const keys = (Bun.env.NVIDIA_API_KEYS || "").split(",").map(k => k.trim()).filter(Boolean);
for (const key of keys) {
  await probeKey(key);
}
```
```python
# ✅ Python: Read from environment or load via dotenv
import os
from dotenv import load_dotenv

load_dotenv(".env.local")
nvidia_keys = [k.strip() for k in os.getenv("NVIDIA_API_KEYS", "").split(",") if k.strip()]
```

### Pattern 4: Scratch Scripts Location
If you need temporary one-off exploration scripts:
- Save them in `/tmp/` (e.g., `/tmp/test_nvidia.py`), which is completely outside the git repository.
- Or save in `scratch/` (strictly gitignored).
- Never hardcode the key string — always read from environment or `.env.local`.

---



### 3. User-Requested Configuration & Key Migration Workflow
When explicitly instructed by the user to modify environment settings or migrate keys:

1. **Checkpoints First:** Always create pre-edit checkpoints:
   ```bash
   uv run python admin/code_hygiene/agent_guardrail.py checkpoint .env
   uv run python admin/code_hygiene/agent_guardrail.py checkpoint .env.local
   ```
2. **Beads Memory & Tracking:** Record checkpoint paths in `bd remember` and create/claim a `bd` issue:
   ```bash
   bd remember --key env_checkpoint "Pre-edit backup: .checkpoints/.env_...bak"
   bd create "Update env config" -t task -p 2 && bd update <id> --claim
   ```
3. **Preserve Secret Keys:** Keep live secret keys verbatim in `.env.local`. Place all non-secret parameters in `.env`.
4. **Daemon Restart:** Environment variables are loaded at gateway boot. Always restart the server:
   ```bash
   bash scripts/restart.sh
   ```
5. **Validation Gate:** Confirm health before closing the task:
   ```bash
   bun run scripts/doctor.ts && bun test && uv run pytest tests/integration/
   ```

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
| **`src/config/env.ts`** | Centralizes configuration and environment variables (`LITEROUTER_PORT`, `LITEROUTER_AUTH_KEY`, `LITEROUTER_COLLAPSE_REASONING`, `LITEROUTER_STRIP_REASONING`, `LITEROUTER_ROTATE_DELAY_MS`, `LITEROUTER_MAX_ATTEMPTS`, `LITEROUTER_HTTP_TIMEOUT_MS`, `LITEROUTER_NO_RESPONSE_TIMEOUT_MS`, `LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS`, `LITEROUTER_STREAM_IDLE_TIMEOUT_MS`, `MIN_ROTATE_DELAY_MS=2000`). Defines provider/model limits (`MODEL_LIMITS` now empty `{}`, `PROVIDER_LIMITS`, `DEFAULT_LIMITS`), static key validation (`staticValidateKeys`), provider delay calculations (`getProviderDelayMs`), reset delay parsers (`parseResetDelay`), token usage extraction (`parseUsageFromJson`), API URL mappings (`PROVIDER_API_URLS`), emoji constants (`EMOJI`), and logging utilities (`logWarn`). |
| **`src/network/fetcher.ts`** | Exposes `fetchWithFirstByteTimeout` and `NoResponseError`. Monitors upstream requests to detect silent backends and stalled streams. Holds HTTP 200 OK headers from downstream while inspecting initial SSE chunks for actual content tokens (`delta.content`, `delta.reasoning_content`, `delta.thought`, `delta.tool_calls`, or Gemini `parts[].text`). If an upstream sends 0 content tokens (or metadata-only chunks `{"role":"assistant","content":""}`) within `LITEROUTER_NO_RESPONSE_TIMEOUT_MS` (5s), throws `NoResponseError`, aborting the fetch before headers reach downstream so handlers can immediately resend to Key #2. After the first byte arrives, continues monitoring the stream for idle timeouts (`LITEROUTER_STREAM_IDLE_TIMEOUT_MS`, default 30s). If no chunk arrives within the idle window, throws `NoResponseError` — same retry path as 0-token ghosting (immediate key rotation, 0ms delay, no cooldown). |
| **`src/transformers/thinking.ts`** | Translates provider-specific reasoning/thinking options into standard OpenAI-style `reasoning_effort` fields (`extractThinkingLevel`, `applyReasoningEffort`, `translateGoogleThinking`). |
| **`src/transformers/payload.ts`** | Manages thought signatures (`injectThoughtSignature`, `extractThoughtSignature`), token estimation (`estimateTokens`), Gemma unsupported field stripping (`cleanGemmaPayload`), LaTeX formatting (`cleanLatexSymbols`), message merging (`mergeConsecutiveMessages`), historical message reasoning sanitization (`sanitizeHistoricalMessages`), non-streaming reasoning transformations (`transformNonStreaming`), and streaming SSE stream transformations (`createStreamTransformer`). Exports `StreamMeta` interface. The `sanitizeHistoricalMessages` function strips past `reasoning_content`, `reasoningContent`, `thought`, and `thought_summary` from historical assistant messages and normalizes `content: null` to `""` to prevent context bloat and 400 Bad Request errors across providers. The `createStreamTransformer` function transforms upstream SSE chunks for OpenAI-compatible providers, handling thought signature injection, reasoning normalization, LaTeX cleaning, and usage extraction. A keep-alive timer injects SSE comment lines (`:\n\n`) every 15 seconds to prevent downstream SSE clients from idling out during slow upstream streams. |
| **`src/handlers/openai_compat.ts`** | Implements `executeOpenAICompat`, `processOpenAIError`, and `processOpenAISuccess`. Manages key rotation loops for OpenAI-compatible providers (OpenRouter, NVIDIA, Zen, Google OpenAI-compat), error handling, immediate key rotation on HTTP 502 (30s key cooldown in Valkey + 2s inter-key delay), and first-byte ghosting retry handling (no cooldown penalty on ghosted keys). |
| **`src/handlers/google_native.ts`** | Implements `executeGoogleNative` (for Google `:generateContent` / `:streamGenerateContent` native endpoints) and `executeGoogleInteractions` (for Google agent API, model configurable via `GOOGLE_INTERACTIONS_MODEL`). Manages query parameter signing, error handling, first-byte ghosting retry via `fetchWithFirstByteTimeout`, and SSE keep-alive comment injection. |
| **`src/lib.ts`** | **Barrel re-export file**. Exports all public types, constants, and utilities from `config/env`, `network/fetcher`, `transformers/thinking`, and `transformers/payload` for clean modular imports across handlers and 100% backward compatibility with `tests/unit/core/`. |
| **`src/index.ts`** | Application entry point running `serve` on port 7766. Contains trace logging (`recordTrace`), emoji logging (`logState`, `logWarn`, `logError`), static key verification, model/fusion registry loading (`models.json`, `fusion.json`), Valkey/Redis `ModelFirstRouter` (ZSET rolling quota Lua script, `reportError` cooldowns, usage recording), Fusion state (in-memory circuit breaker and sticky position), auth checking (`verifyAuthKey`), and HTTP route dispatchers. |

---

## Endpoints & Handlers

LiteRouter exposes 5 main HTTP endpoints on port 7766:

| Endpoint Path | Handler Function | Target Upstream | Target Clients |
| :--- | :--- | :--- | :--- |
| **`/v1/chat/completions`** | `executeOpenAICompat`<br>*(or `executeFusion` if in `fusion.json`)* | OpenAI-compatible endpoints (`/chat/completions`) for NVIDIA, OpenRouter, Zen, or Google OpenAI-compat (`/v1beta/openai/chat/completions`). | pydantic-ai, OpenAI SDKs, LiteLLM, OpenCode |
| **`/v1/models`**<br>*(or `/models`)* | Inline handler | Aggregates all registered models from `models.json` and virtual fallback groups from `fusion.json`. Returns standard OpenAI `{ "object": "list", "data": [...] }`. | OpenCode, Cursor, LibreChat, SillyTavern auto-discovery |
| **`/v1beta/interactions`**<br>*(or `/v1/interactions`)* | `executeGoogleInteractions` | Google Interactions API (`https://generativelanguage.googleapis.com/v1beta/interactions`) for `antigravity-preview-05-2026`. | Google Agent clients, Antigravity runners |
| **`/v1beta/models/*`**<br>*(e.g., `/v1beta/models/{model}:{action}`)* | `executeGoogleNative`<br>*(or `executeFusion` if in `fusion.json`)* | Google Native API (`{GOOGLE_NATIVE_BASE_URL}/v1beta/models/{upstream_model}:{action}`). | OpenCode native Gemini integration |
| **`/health`** | Inline handler | Returns `{"status": "ok"}` (200 OK). | Load balancers, health checks, monitoring |

---

## 🏛️ Architecture Governance: Pass-Through, KIV, and Graveyard

* **Transparent Pass-Through**: LiteRouter acts as a high-throughput proxy for standard `/v1/*` routes with healthy rotated credentials and zero serialization overhead.
* **Deferred Features & PR Policy**: Tracked in `KIV.md` (e.g., native Anthropic Messages API with user AI builder prompts).
* **Architecture Graveyard**: Formally rejected anti-patterns (DB ORMs, Web GUIs, serverless edge rewrites) are documented in `GRAVEYARD.md` to prevent feature bloat and maintain sub-millisecond Bun+Valkey latency.

---

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

Both stream transformers still inject SSE comment lines (`:\n\n`) every `KEEPALIVE_INTERVAL_MS` (2s default) via keep-alive timers to prevent downstream SSE clients from triggering their own idle timeouts during slow upstream responses where tokens arrive infrequently.

---

## 429 Rotation & 2s Minimum Rotation Delay Logic

1. **Rotation Delay Floor (`MIN_ROTATE_DELAY_MS = 2000`):**
   Key rotation delay between attempts is controlled by `getProviderDelayMs(provider)`. It resolves the environment variable `${PROVIDER}_MIN_DELAY_MS` or `LITEROUTER_ROTATE_DELAY_MS` (default 10s), but enforces a **hard minimum floor of 2000ms (2s)** (`MIN_ROTATE_DELAY_MS`).
2. **Immediate Exhaustion Output (No 65s Stalls):**
   When upstream returns 429 rate limit or quota errors, `router.reportError` places the active key on a 65s cooldown in Valkey/Redis (configurable via `COOLDOWN_RATE_LIMIT_TTL_SEC`).
   If all available keys in the pool are in cooldown or quota-exhausted, `router.getAvailableKey` throws:
   `All keys for {provider} are in cooldown or have exhausted quota for model {modelName}.`
   The handler catches this error and **immediately returns HTTP 429** to the downstream client without stalling or waiting out long 65s cooldown windows.

---

## Redis Key Cooldown TTLs (`ModelFirstRouter.reportError`)

Cooldown states are stored in Valkey/Redis under `cooldown:{provider}:{keyHash}:{modelName}`:

| Error Type / Status | Default TTL | Cooldown State | Notes & Overrides |
| :--- | :--- | :--- | :--- |
| **`429` / `rate_limit`** | **65s** (`COOLDOWN_RATE_LIMIT_TTL_SEC`) | `rate_limited` | Reset delays parsed via `parseResetDelay` from `Retry-After` headers or body regex (`quotaResetDelay`) can override TTL (clamped to `COOLDOWN_TTL_MIN_SEC`–`COOLDOWN_TTL_MAX_SEC`). |
| **Google & Nvidia Provider Errors** | **Min 65s** | `rate_limited` | Any error on `google` or `nvidia` providers is floored at a **minimum TTL of 65s** (`ttl = Math.max(ttl, 65)`). |
| **Timeouts / `500`, `502`, `503`, `504`** | **10s** (`COOLDOWN_TIMEOUT_TTL_SEC`) | `timed_out` | Short cooldown for transient upstream server or proxy errors. |
| **Auth / Permission (`401`, `403`, `auth`, `permission_denied`)** | **7 days** (`COOLDOWN_AUTH_TTL_SEC`, default 604800s) | `quarantined` | Long-term quarantine for revoked or invalid keys. |
| **General / Default Errors** | **30s** (`COOLDOWN_DEFAULT_TTL_SEC`) | `error_{errorType}` | Fallback cooldown duration for unclassified errors. |

---

## Fusion Sticky Fallback Mechanism

Fusion groups defined in `fusion.json` (e.g. `pydantic/google`, `pydantic/nvidia`) execute resilient multi-model fallback chains:

1. **Circuit Breaker (`FUSION_CIRCUIT_TTL_MS = 65000` ms / 65s):**
   When an upstream model in a fusion chain returns HTTP 429 or >= 500 status, `openCircuit(upstreamId)` marks the backend circuit as open for 65 seconds (`CIRCUIT_TTL`). Subsequent fusion requests skip open-circuit backends.
2. **Sticky Position (`FUSION_STICKY_TTL_MS = 300000` ms / 300s / 5min):**
   When a primary backend fails and a fallback upstream succeeds, `setSticky(groupId, upstreamId)` records the fallback position for 5 minutes (`FUSION_STICKY_TTL_SEC`).
   Subsequent requests for that fusion group begin directly at the sticky fallback position, avoiding unnecessary attempts against the failing primary.
   When the primary model recovers and succeeds, `clearSticky(groupId)` resets the group to start at the primary backend.

---

## Historical Reasoning Sanitization & Context Bloat Prevention

During multi-turn agent interactions, models that output chain-of-thought or reasoning tokens (such as `reasoning_content`, `thought`, or `thought_summary`) can rapidly accumulate context bloat and drive up token costs when conversation histories are sent back in subsequent requests.

1. **Automatic Reasoning Stripping (`src/transformers/payload.ts`):**
   `sanitizeHistoricalMessages` inspects incoming message arrays in `src/handlers/openai_compat.ts` and removes volatile thought fields (`reasoning_content`, `reasoningContent`, `thought`, `thought_summary`) from prior `role: "assistant"` turns before token estimation and upstream dispatch.
2. **Universal Assistant Content Normalization:**
   Any assistant turn where `content` is `null` or `undefined` (including tool-calling turns) is automatically normalized to `content: ""` (empty string). This eliminates `400 Bad Request` schema rejections from strict upstream providers (Anthropic, DeepSeek, OpenRouter) that enforce non-null string content schemas.
3. **Configuration Toggle (`LITEROUTER_STRIP_REASONING`):**
   Reasoning sanitization is enabled by default (`true`) in `src/config/env.ts`. It can be disabled by setting `LITEROUTER_STRIP_REASONING=false` (or `0`, `no`, `off`).

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
