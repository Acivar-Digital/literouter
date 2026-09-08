# LiteRouter Architecture & Technical Reference

> **Definitive Architectural Reference Manual**
> Fixed Location: `/home/yapilwsl/arthityap/literouter/.opencode2/skills/literouter/architecture.md`
> Canonical Skill Root: `/home/yapilwsl/arthityap/literouter/.opencode2/skills/literouter/SKILL.md`

---

## 1. Executive System Architecture

LiteRouter is an enterprise-grade, high-density AI API Gateway and multiplexing reverse proxy built on the Bun runtime. It mediates client requests across diverse LLM providers, translating incompatible wire protocols, enforcing atomic rate limits, and dynamically rotating upstream credentials with sub-millisecond overhead.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Downstream Client Sessions                          │
│        (OpenCode2, Claude Code, Python SDK / Pydantic AI, cURL)             │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Port 7766 (TLS / Cleartext)
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. INGRESS & TRANSPORT ENGINE (`src/index.ts`)                              │
│    • Dual ALPN: HTTP/2 (`h2`) for binary multiplexing (Python/httpx)        │
│                 HTTP/1.1 over TLS for Node.js clients (OpenCode, Claude)    │
│    • Ingress Pacer Gate (`src/network/pacer.ts`): Unified FIFO queue        │
│    • Endpoint Match & Directive Validator (`src/directive/`)                │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2. ROUTING & PROTOCOL COMPATIBILITY LAYERS (`src/handlers/`)                 │
│    • OpenAI Compat: `/v1/chat/completions` (`handleOpenAICompat`)            │
│    • Anthropic Compat: `/v1/messages`, `/messages` (`handleAnthropicCompat`) │
│    • Responses Native: `/v1/responses` (`handleOpenAiOriginal`)              │
│    • Google Native: `/v1beta/models/*` (`handleGoogleNative`)                │
│    • GCP Vertex Compat: `/v1beta/openai/*` (`handleGcpCompat`)               │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3. BIDIRECTIONAL PAYLOAD & STREAM TRANSFORMERS (`src/transformers/`)         │
│    • XML Tool Calling & Trapped Thinking Extraction (`dots.ts`)             │
│    • OpenCode Reasoning Stream Filter & Context Bloat Shield (`opencode_...`)│
│    • Bidirectional Responses ↔ Chat Completions Translation (`responses.ts`) │
│    • Gemma Payload Sanitization (`cleanGemmaPayload`: strips thinkingConfig) │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4. RESILIENCE, POOLING & TELEMETRY (`src/network/`, `src/ui/`)               │
│    • Valkey Port 6379: Atomic Lua 60s Rolling Window RPM/TPM Rate Limiter   │
│    • KeyPool & CooldownManager: In-flight 2s 429 rotation, 7d auth quarantine│
│    • Provider Circuit Breakers (60s auto-canary half-open leases)           │
│    • Outbound Staggered HTTP/2 Origin Pool (`h2_pool.ts`, maxAge 180s ±15s)  │
│    • TTFT Sentry Guard (5s first-byte ghosting abort & zero-penalty rotate) │
│    • Synchronous High-Speed Terminal Telemetry (`logger.ts`)                │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ Upstream Providers: OpenRouter, NVIDIA, Google, Zen, Anthropic, GCP         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Core Architecture Pillars:
- **Port `7766` Runtime**: Booted via `bun run src/index.ts` or `bash scripts/start.sh` (daemonized inside tmux session `literouter`).
- **Dual ALPN Engine**: Powered by `node:http2` `createSecureServer` with `allowHTTP1: true`. Transparently negotiates pure HTTP/2 (`h2`) for binary multiplexed clients (Python `httpx[http2]`, Pydantic AI) and HTTP/1.1 over TLS for Node.js runtimes (OpenCode 2, Claude Code) without handshake rejection or protocol negotiation errors. Falls back to cleartext HTTP if certificates (`certs/localhost.pem`, `certs/localhost-key.pem`) are absent.
- **Valkey Backend (`port 6379`)**: Mandatory production requirement. ZERO in-memory fallback for rate limiting. Enforces strict sliding 60-second request-per-minute (RPM) and token-per-minute (TPM) windows using atomic Redis/Valkey Lua scripts on Sorted Sets (ZSETs). Boundary-bursting is mathematically eliminated.
- **Resilience Guarantees**:
  - **2-Second 429 Key Rotation**: When upstream returns HTTP 429, the failing key enters cooldown, and the request is immediately retried on Key #2 after a minimal 2,000ms delay.
  - **Anti-Stall Guarantee**: LiteRouter NEVER forces clients to hang in 60s+ backoff sleeps when keys are throttled; it rotates keys in-flight or cascades down the Fusion Fallback chain.
  - **First-Byte Ghosting Protection (`TTFT Guard`)**: Driven by `LITEROUTER_NO_RESPONSE_TIMEOUT=5` (5s). If an upstream connection opens but sends 0 content bytes within 5s, the request is aborted without penalizing the key and cleanly rotated.
  - **Gemma ThinkingConfig Sanitization**: Upstream Gemma engines crash if unexpected thinking arguments appear. LiteRouter recursively strips `thinkingConfig` and `thinking_config` from all payloads targeting Gemma models across both Google Native and OpenAI-compat routes.

---

## 2. Current Key Pools Architecture & Setup

### 2.1 Secret Management Split: `.env.local` vs `.env`
- **`.env.local` (Git-Ignored Secrets)**:
  - Contains live upstream API keys across all provider pools.
  - Write-protected via `protect.sh` (owned by `root`, mode `644`).
  - **MANDATE**: Agents and automated tools must NEVER modify, sanitize, or replace values in `.env.local` or `.env`. Replacing real keys with `<REDACTED>` or placeholder tokens triggers gateway boot failures.
- **`.env` (Tracked Configuration)**:
  - Contains operational knobs, timeouts, and boolean toggles (port, stream idle timeouts, quarantine/retry flags).

### 2.2 The 5 Active Core Key Pools
LiteRouter parses comma-separated keys from environment variables via `src/config/keys.ts`:

| Provider | Code | Environment Variable | Key Pool Characteristic & Upstream Target |
|---|---|---|---|
| **OpenRouter** | `or` | `OPENROUTER_API_KEYS` | Multimodal & open-weights aggregator (`https://openrouter.ai`) |
| **NVIDIA NIM** | `nv` | `NVIDIA_API_KEYS` | Enterprise microservices & open models (`https://integrate.api.nvidia.com`) |
| **Google AI Studio** | `gg` | `GOOGLE_API_KEYS` | Gemini & Gemma native models (`https://generativelanguage.googleapis.com`) |
| **Zen** | `zn` | `ZEN_API_KEYS` | OpenCode Zen free-tier gateway (`https://opencode.ai/zen`) |
| **Google Cloud (GCP)** | `gc` | `GCP_KEYS` (or `GCP_API_KEYS`) | GCP Vertex AI Gemma inference endpoints |

*Secondary/Configured Providers:* `OPENAI_API_KEYS` (`oa`), `ANTHROPIC_API_KEYS` (`an`), `GROQ_API_KEYS` (`gq`), `CEREBRAS_API_KEYS` (`cb`), `DEEPSEEK_API_KEYS` (`ds`), `MISTRAL_API_KEYS` (`ms`), `TOGETHER_API_KEYS` (`tg`).

### 2.3 Boot Validation (`staticValidateKeys`)
During startup, `loadKeyPools` in `src/config/keys.ts` and `initializeKeyPools` in `src/handlers/openai_compat.ts` inspect and filter keys:
1. **Placeholder Rejection**: Discards keys matching `changeme`, `todo`, `your_key_here`, `undefined`, `null`, `xxxx`.
2. **Angle Bracket Rejection**: Discards sanitization artifacts containing `<` or `>`.
3. **Length Verification**: Discards invalid strings shorter than 4 characters (production tokens must exceed minimum entropy).
4. **Mock Key Resilience**: If a pool is empty during unit tests, mock stubs (`sk-stub-<provider>-mock-key-1`, `sk-stub-<provider>-mock-key-2`) are seeded to ensure tests execute without crashing.

### 2.4 Cooldown, Quarantine & Circuit Breaker Rules
Error classification is managed in `src/network/classifier.ts` and tracked in `CooldownManager` (`src/network/cooldown.ts`):

- **Rate Limit (HTTP 429)**:
  - If headers include `Retry-After`, quarantine key for exact duration.
  - Standard 429 without header: default quarantine is controlled by `COOLDOWN_RATE_LIMIT_TTL_SEC` (default 30s/65s).
  - Quota / Credit Exhaustion (`isQuotaExhausted429`): 7 days (`SEVEN_DAYS_SEC = 604800s`).
- **Auth Errors (HTTP 401 & 403)**:
  - Tiered quarantine scaling based on consecutive failures:
    - 1st failure: `300s` (5 minutes)
    - 2nd failure: `1800s` (30 minutes)
    - 3rd+ failure: `86400s` (24 hours) / 7 days for invalid tokens.
- **Server Errors (HTTP 5xx)**:
  - 10-second quarantine (`quarantineTtlSec: 10`). Retries in-flight up to 3 times across alternative keys in the pool.
- **Deterministic Client Errors (HTTP 400 Context Length Overflow, 404)**:
  - Immediate `fail_fast` with 0s quarantine. Does NOT burn remaining keys or rotate.
- **Transport Resets & Aborts**:
  - `ECONNRESET`, `RemoteProtocolError`, HTTP/2 stream cancellation: `quarantineTtlSec: 2` or `0`, retrying immediately on a fresh key.

### 2.5 Operational Resilience Toggles (`.env`)
LiteRouter allows fine-grained runtime control over retries, quarantines, pacers, and circuit breakers:

```ini
# GCP Vertex Controls
GCP_ENABLE_RETRIES=true            # In-flight key rotation on 429/5xx (false = single-flight passthrough)
GCP_ENABLE_QUARANTINE=true         # Key cooldown tracking (false = dumb forwarder, no lockout)
GCP_ENABLE_CIRCUIT_BREAKER=false   # Decouples GCP from global breaker (avoids false 24-key pool lockouts)
GCP_ENABLE_PACER=true              # Enforces 30 RPM (2000ms delay) conveyor belt pacing

# Zen Controls
ZEN_ENABLE_RETRIES=true            # In-flight key rotation across Zen keys
ZEN_ENABLE_QUARANTINE=false        # Bypass quarantine lockout during peak free-tier spikes
ZEN_ENABLE_CIRCUIT_BREAKER=false   # Decouples Zen from global circuit breaker
ZEN_ENABLE_PACER=true              # Zen conveyor belt pacer (500ms delay)

# OpenRouter Controls
OPENROUTER_ENABLE_QUARANTINE=true  # Set to false to bypass quarantine on OpenRouter free keys
COOLDOWN_RATE_LIMIT_TTL_SEC=30     # Default 429 quarantine penalty in seconds (0 to disable)
```

---

## 3. Endpoints & Handlers Master Routing Matrix

All inbound traffic arriving at `https://localhost:7766` is evaluated in `src/index.ts` (`handleAppRequest` / `dispatchRoute`):

| Inbound Method | Inbound Path | Source Handler File | Handler Function | Purpose & Protocol |
|---|---|---|---|---|
| `POST` | `/v1/chat/completions` | `src/handlers/openai_compat.ts` | `handleOpenAICompat` | Standard OpenAI Chat Completions endpoint. Rotates keys across `or`, `nv`, `zn`, `gg`. Translates XML tools, filters OpenCode reasoning. |
| `POST` | `/v1/messages`<br>`/messages`<br>`/api/v1/messages` | `src/handlers/anthropic_compat.ts` | `handleAnthropicCompat` | Anthropic Messages API. Translates Claude requests to upstream Anthropic format or cross-wires to OpenAI formats. |
| `POST` | `/v1/messages/count_tokens`<br>`/messages/count_tokens` | `src/handlers/anthropic_compat.ts` | `handleAnthropicCountTokens` | Anthropic token counting compatibility endpoint. |
| `POST` | `/v1/responses` | `src/handlers/openai_original.ts` | `handleOpenAiOriginal` | OpenAI Original Responses API native passthrough (`oo` wire). Direct streaming to Zen or OpenRouter Responses endpoints. |
| `GET` | `/v1/models`<br>`/v1beta/models` | `src/handlers/discovery.ts` | `handleModelsDiscovery` | Models discovery. Aggregates and returns models from `config/models.json` and `config/fusion.json`. |
| `POST` | `/v1beta/openai/*` | `src/handlers/google_native.ts` / `src/handlers/gcp_compat.ts` | `handleGoogleOpenAIBeta` / `handleGcpCompat` | Google AI Studio OpenAI-compat beta route or GCP Vertex Gemma route. |
| `POST` | `/v1beta/models/*:generateContent`<br>`:streamGenerateContent` | `src/handlers/google_native.ts` | `handleGoogleNative` | Google Native Dumb Forwarder. Direct Gemini REST byte-stream forwarder for `@ai-sdk/google`. Powers `gemini-flash` fusion. |
| `POST` | `/v1beta/interactions/*`<br>`/v1beta/files/*` | `src/handlers/google_native.ts` | `handleGoogleInteractionsPassthrough` | Antigravity agent interactions and file upload passthrough to Google APIs. |
| `POST` | `/admin/pool/reset` | `src/index.ts` | `handleAdminPoolReset` | Authenticated administrative reset of key cooldowns and pool state. |
| `GET` | `/health`<br>`/hello`<br>`/api/hello` | `src/index.ts` | `handleHealthCheck` | System health check. Returns uptime, circuit breaker stats, and active H2 outbound pool counts. |
| `POST` | `/reset` | `src/index.ts` | `handleHardReset` | Hard gateway state reload. Flushes cooldowns, pools, breakers, and providers registry cache. |

### Endpoint Mismatch Guard (`validateEndpointMatch`):
LiteRouter strictly guards against misconfigured client drivers:
- Requesting `/v1/chat/completions` with a Responses API directive (`-rs-`) returns `HTTP 400`: `Endpoint mismatch: Directive specifies Responses API (-rs-). Use /v1/responses.`
- Requesting `/v1/responses` with a Chat Completions directive (`-ch-`) returns `HTTP 400`: `Endpoint mismatch: Directive specifies Chat Completions (-ch-). Use /v1/chat/completions.`

---

## 4. Compatibility Layers & Protocol Translation

### 4.1 OpenAI Chat Completions Compat Layer (`src/handlers/openai_compat.ts`)
- The primary gateway workhorse. Accepts standard OpenAI `{ model, messages, tools, stream }` JSON payloads.
- Resolves upstream provider configurations from `config/providers.json`.
- Dispatches requests via `fetchWithTtftGuard` over the persistent HTTP/2 connection pool.
- Handles in-flight retry loops (up to 3 attempts) across pooled keys.

### 4.2 Anthropic Messages Compat Layer (`src/handlers/anthropic_compat.ts`)
- Exposes native Anthropic Messages API (`/v1/messages`) for clients like Claude Code.
- Strips hop-by-hop framing headers (`Content-Length`, `anthropic-version`, `anthropic-beta`, `x-api-key`) before upstream forward.
- Supports cross-wire translation (`ao` payload code): allows Anthropic clients to consume OpenAI-compat models transparently.

### 4.3 OpenAI Responses Native Passthrough (`src/handlers/openai_original.ts`)
- Implements the `oo` wire protocol for native OpenAI Responses API requests arriving at `POST /v1/responses`.
- Directly forwards the raw JSON payload with zero schema alteration.
- Performs upstream key rotation and pacer conveyor queuing.
- Telemetry: Emits `[Inbound]` and `🟢 [TTFT]` with upstream protocol tagging (`[Upstream: HTTP/2]`).

### 4.4 Zen Responses Bidirectional Translation (`lr-zn-oa-rs-no`)
- **Wire Code**: `oa`, Endpoint: `rs`.
- Target: Allows standard OpenAI Chat Completions clients (`POST /v1/chat/completions`) to communicate with Zen models that only expose the Responses API (e.g. `muse-spark-1.3-contributor-free`).
- **Translation Pipeline (`src/transformers/responses.ts`)**:
  - Inbound: Converts `messages[]` array into Responses API `input[]` format.
  - Reasoning Scrubbing: Scrubs encrypted reasoning blobs from delta chunks to avoid client crashes.
  - Usage Mapping: Maps upstream reasoning token counts to `usage.completion_tokens_details.reasoning_tokens`.
  - Outbound Stream: Converts SSE events (`response.output_text.delta`, `response.completed`) into standard `chat.completion.chunk` frames.

### 4.5 Google Native Dumb Forwarder (`src/handlers/google_native.ts`)
- **Directive**: `lr-gg-gg-gc-no` (payload `gg`, endpoint `gc`).
- Exposes direct `/v1beta/models/*:generateContent` and `:streamGenerateContent?alt=sse` routes for the `@ai-sdk/google` package.
- Features transparent byte-stream passthrough.
- Rotates `GOOGLE_API_KEYS` on 429/5xx, injecting active keys into the `x-goog-api-key` header.
- Strips conflicting compression and framing headers (`content-encoding`, `transfer-encoding`).
- Powers Native Google Fusion Chains (`gemini-flash`, `gemini-flash-lite`).

### 4.6 XML Tool Calling & Trapped Thinking Extraction (`src/transformers/dots.ts`)
Chinese and open-weight reasoning models (Dots, DeepSeek-R1, Qwen, Ling, Minimax) frequently output tool calls formatted as raw XML embedded inside reasoning or plain text. LiteRouter intercepts and polyfills these in real time:
- **Streaming Thinking Deltas**: Incrementally streams `<think>` blocks as `reasoning_content` deltas rather than buffering the entire turn.
- **Trapped Tool Extraction**: Extracts tool calls from XML tags across dialects:
  - GLM / Ling: `<arg_key>` / `<arg_value>`
  - Qwen: `<function=...><parameter=...>`
  - DeepSeek: `<invoke name="...">`
- **Tool History Turn Compaction**: Compresses consecutive `role: "tool"` blocks into a single consolidated turn, preventing EOS breaks on strict upstream chat templates.

### 4.7 OpenCode Reasoning Stream Filter & Context Bloat Shield
- **The Problem**: OpenCode accumulates streaming reasoning chunks (`delta.reasoning_content`) into its internal SQLite conversation store and re-injects them into subsequent request turns, causing context bloat from 40k to 300k+ tokens.
- **The Solution (`src/transformers/opencode_adapter.ts`)**:
  - When LiteRouter detects an OpenCode client (`User-Agent: opencode*`, `x-opencode`, `x-client-name`), it automatically strips reasoning deltas from the live downstream stream while preserving `content`, `role`, and `tool_calls`.
  - Injects synthetic 5-second empty delta heartbeats (`data: {"choices":[{"index":0,"delta":{}}]}`) during extended thinking pauses to prevent client socket timeout disconnects.
  - Sanitizes `delta.content: null` into empty objects to comply with strict client Zod schemas.
  - **Override**: Pass `ts` nuance (e.g. `lr-nv-oa-ch-ts`) to force-preserve thinking deltas in OpenCode, or `sb` nuance to force-strip thinking for all clients.

---

## 5. Definitive Directive Key Reference

LiteRouter uses declarative directive keys passed as Bearer tokens in the `Authorization` header, `x-api-key` header, or URL query parameters (`?key=...`).

### 5.1 Directive Token Grammar
All direct directive keys follow a strict 5-part lowercase format:
```
lr-<provider>-<payload>-<completion>-<nuance>
```

#### Provider Codes (`<provider>`):
| Code | Provider Name | Description |
|---|---|---|
| `or` | OpenRouter | Multimodal & open-weights aggregator |
| `nv` | NVIDIA NIM | High-throughput enterprise microservices |
| `gg` | Google AI Studio | Gemini & Gemma models via Generative Language API |
| `zn` | Zen | OpenCode free-tier gateway (`opencode.ai/zen`) |
| `gc` | GCP Vertex | Google Cloud Platform Vertex AI endpoints |
| `oa` | OpenAI | Direct OpenAI endpoints (`api.openai.com`) |
| `an` | Anthropic | Direct Anthropic endpoints (`api.anthropic.com`) |
| `gq` | Groq | Ultra-low latency LPU inference |
| `cb` | Cerebras | High-speed wafer-scale inference |
| `ds` | DeepSeek | Official DeepSeek platform |
| `ms` | Mistral AI | Official Mistral platform |
| `tg` | Together AI | Open-weights hosting |
| `tp` | Test Provider | Local testing stub endpoint |

#### Payload / Wire Codes (`<payload>`):
| Code | Wire Protocol | Description |
|---|---|---|
| `oa` | OpenAI | Standard OpenAI Chat Completions payload format |
| `oo` | OpenAI Original | Native OpenAI Responses API payload format (zero modification) |
| `cl` | Claude | Anthropic Messages payload format |
| `ao` | Anthropic-to-OpenAI | Translates Anthropic messages into OpenAI completions upstream |
| `gg` | Google | Google Generative Language REST payload |
| `rs` | Responses | OpenAI Responses API format |

#### Completion / Endpoint Codes (`<completion>`):
| Code | Endpoint | Path Target |
|---|---|---|
| `ch` | Chat | `/v1/chat/completions` or `/api/v1/chat/completions` |
| `ms` | Messages | `/v1/messages` or `/api/v1/messages` |
| `rs` | Responses | `/v1/responses` |
| `ob` | OpenAI Beta | `/v1beta/openai/chat/completions` (Google AI Studio) |
| `gc` | GenerateContent | `/v1beta/models/{model}:generateContent` (Google Native) |
| `em` | Embeddings | `/v1/embeddings` |
| `md` | Models Discovery | `/v1/models` |
| `im` | Images | `/v1/images/generations` |
| `au` | Audio | `/v1/audio/transcriptions` |

#### Nuance Codes (`<nuance>`):
Nuance tokens can be compounded using `+` (e.g. `dp+ts`, `ts+tc`).

| Code | Nuance | Behavioral Effect |
|---|---|---|
| `no` | None | Default passthrough behavior |
| `dp` | Dots Polyfill | Activates XML tool calling and thinking breakout transformers |
| `ts` | Thinking Support | Explicitly preserves reasoning deltas for OpenCode (bypasses scrubber) |
| `sb` | Strip Budget / Reasoning | Force-strips all reasoning deltas for any client |
| `gm` | Gemma Merge | Merges consecutive user/assistant turns and strips thinkingConfig |
| `g3` | Gemma 3 Compat | Specialized sanitization for Gemma 3 models |
| `tc` | Tool Compaction | Compacts multiple consecutive tool turns into single user turns |
| `lg` | Ling Dialect | Maps Ling XML tool syntax (`<arg_key>`/`<arg_value>`) 1:1 to JSON |

---

### 5.2 Fusion Preset Directives
Format: `lr-fse-<preset>`

Fusion presets route dynamically across multi-tier fallback chains defined in `config/fusion.json`:

| Fusion Directive | Strategy | Timeout | Primary Targets & Fallback Chain |
|---|---|---|---|
| `lr-fse-quad` | `sticky_fallback` | 30s | Claude 3.7 Sonnet (OR → Anthropic) / DeepSeek-R1 (NV → OR) / Gemini 2.5 Pro (Google → OR) |
| `lr-fse-pydn` | `sticky_fallback` | 25s | DeepSeek-Reasoner (DeepSeek → NV R1) / Claude 3.7 Sonnet (Anthropic → OR) |
| `lr-fse-fast` | `sticky_fallback` | 15s | Gemini 3.1 Flash Lite (Google → OR) / Llama 3.3 70B (Groq → Cerebras) |
| `lr-fse-deep` | `sticky_fallback` | 45s | DeepSeek-R1 (NVIDIA NIM → DeepSeek Direct → OpenRouter) |
| `lr-fse-smart` | `sticky_fallback` | 30s | High-reasoning cascade across smart models |
| `lr-fse-code` | `sticky_fallback` | 25s | Coding-optimized cascade across Claude, Qwen, and DeepSeek |
| `lr-fse-cheap` | `sticky_fallback` | 15s | Ultra-low cost / free tier cascade |

---

### 5.3 Canonical Directive Keys for Common Clients

| Client / Workflow | Recommended Directive Key | Target Model | Protocol / Wire Path |
|---|---|---|---|
| **OpenCode 2 (Zen Free)** | `lr-zn-oa-ch-no` | `big-pickle`, `hy3-free` | Chat Completions (`/v1/chat/completions`) with Zen key rotation & OpenCode headers |
| **OpenCode 2 (Zen Responses)** | `lr-zn-oo-rs-no` | `muse-spark-1.3-contributor-free` | Native Responses API (`/v1/responses`) using `@ai-sdk/openai` |
| **OpenCode 2 (OpenRouter)** | `lr-or-oa-ch-no` | `liquid/lfm-2.5-2.6b:free` | Standard OpenAI Chat with OpenCode attribution headers |
| **OpenCode 2 (NVIDIA NIM)** | `lr-nv-oa-ch-ts` | `nvidia/nemotron-3-super-120b-a12b` | Chat completions with Thinking Support (`ts`) enabled |
| **Claude Code** | `lr-or-cl-ms-no` | `anthropic/claude-3.7-sonnet` | Anthropic Messages API (`/v1/messages`) via OpenRouter |
| **Claude Code (Direct)** | `lr-an-cl-ms-no` | `claude-3-7-sonnet-20250219` | Direct Anthropic Messages API with key rotation |
| **Google Native (`@ai-sdk/google`)** | `lr-gg-gg-gc-no` | `gemini-flash`, `gemini-3.5-flash-lite` | Direct Google REST byte-stream with H2 pooling & key rotation |
| **Pydantic AI (Python SDK)** | `lr-nv-oa-ch-no` | `deepseek-ai/deepseek-r1` | High-throughput HTTP/2 multiplexed chat completions |
| **GCP Vertex AI (Gemma)** | `lr-gc-oa-ch-no` | `gemma-4-31b-it` | GCP Vertex AI with 30 RPM conveyor pacer & zero-cost guardrail |
| **Dots XML Polyfill** | `lr-or-ao-ch-dp` | `dots-studio/dots-3-note-preview:free` | Anthropic-to-OpenAI cross-wire with XML tool breakout |

---

## 6. Provider Registry & Agentic Attribution (`config/providers.json`)

LiteRouter declaratively configures upstream provider URLs and identity headers in `config/providers.json`. These headers are injected dynamically by `resolveUpstreamEndpoint` and `buildAuthHeaders`:

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
    }
  },
  "zen": {
    "code": "zn",
    "base_url": "https://opencode.ai/zen",
    "auth_header": "Bearer",
    "headers": {
      "HTTP-Referer": "https://opencode.ai",
      "Referer": "https://opencode.ai",
      "X-Title": "OpenCode",
      "User-Agent": "OpenCode/1.18.29"
    }
  }
}
```

### Agentic Harness Whitelisting & Session Forwarding:
1. **OpenRouter Gated Endpoints**: OpenRouter returns `HTTP 403 "Gate Free Endpoints by Agentic Harness"` on free-tier models if agentic headers are missing. LiteRouter automatically attaches `User-Agent: OpenCode/1.18.29`, `HTTP-Referer`, and `X-Title` to satisfy upstream security checks.
2. **Zen Provider OpenCode Identity Gating**:
   - Upstream Zen (`opencode.ai/zen/v1`) returns `HTTP 429 FreeUsageLimitError: Rate limit exceeded` when invoked with generic runtime agents (curl, python-requests, Bun).
   - Zen Responses API returns `HTTP 400 MissingSessionID: OpenCode's free tier can only be used in OpenCode` if client session identity is absent.
   - **Forwarding Pipeline**: `buildAuthHeaders` automatically forwards inbound client session identity headers (`session-id`, `x-session-id`, `x-opencode-session`, `x-opencode-session-id`, `opencode-session-id`, `x-client-version`, `x-client-name`) directly upstream.

---

## 7. Model Catalog & Native Fallback Chains

### 7.1 Native Google Fusion Chains (`config/fusion.json`)
Native chains run transparently through `src/handlers/google_native.ts` without requiring virtual preset keys. Clients simply request the model trigger name:

1. **`gemini-flash` Chain**:
   - Descending cascade: `gemini-3.8-flash` ➔ `gemini-3.7-flash` ➔ `gemini-3.6-flash` ➔ `gemini-3.5-flash`
   - Trigger Model: `gemini-flash`
   - Directive: `lr-gg-gg-gc-no` (or any `lr-gg-*` directive)
2. **`gemini-flash-lite` Chain**:
   - Descending cascade: `gemini-3.5-flash-lite` ➔ `gemini-3.1-flash-lite`
   - Trigger Model: `gemini-flash-lite`
   - Directive: `lr-gg-gg-gc-no`

#### Independent Tier Tracking Mechanics:
- **Dual Rotation**:
  - Outer Tier Index: Tracks active model tier in `nativeTierIndices` map independently per chain.
  - Inner Key Pool: Rotates active keys within the current model tier.
- **Error Cascading Rules**:
  - `HTTP 404 Model Not Found`: Fast-advances immediately to the next model tier on the first key attempt without burning remaining keys in the pool.
  - `HTTP 429 Rate Limit` / `5xx Server Error`: Rotates through all available keys in `GOOGLE_API_KEYS`. If all keys fail, advances to the next tier in the cascade.
  - Entire cascade cycle is capped at 1 full iteration before surfacing failure to the client.
- **Downstream Telemetry Headers**: Responses include `x-literouter-model` (actual model executed) and `x-literouter-tier` (active tier index).

### 7.2 Zen Bare Model Naming Standard
- **The Rule**: Zen models NEVER accept or use a `zen/` prefix.
- Upstream Zen strictly expects bare model names.
- Valid Examples: `big-pickle`, `hy3-free`, `deepseek-v4-flash-free`, `qwen3.6-plus-free`, `minimax-m3-free`, `nemotron-3-ultra-free`, `north-mini-code-free`, `muse-spark-1.3-contributor-free`.
- Supplying `zen/big-pickle` causes an upstream `HTTP 404 Model Not Found`.

---

## 8. Diagnostic & Verification Playbook

### Gateway Management:
```bash
# Check daemon status
bash scripts/status.sh

# Restart gateway daemon
bash scripts/restart.sh

# Live health probe (returns uptime, circuit breaker states, and H2 pool stats)
curl -sk https://localhost:7766/health | jq .

# Perform hard key pool & state reset
curl -sk -X POST https://localhost:7766/reset | jq .
```

### Comprehensive Diagnostic Probes:
```bash
# Run doctor diagnostics across all key pools
bun run scripts/doctor.ts

# Run Zen-specific identity and session probes
bun run scripts/doctor_zn.ts
```

### Test Suite Execution:
```bash
# Static TypeScript typecheck
bun run typecheck

# Unit test suite
bun test

# Live integration smoke tests
uv run pytest tests/integration/
```
