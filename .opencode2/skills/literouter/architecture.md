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
| `g1` | Google v1 | Provider endpoint map key only (completion-code slot, **not** a nuance; see `directive-grammar.md` §4) |
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

> Only these four presets exist in `config/fusion.json` (`quad`, `pydn`, `fast`, `deep`). There is no `smart`, `code`, or `cheap` preset — never emit `lr-fse-smart`, `lr-fse-code`, or `lr-fse-cheap`.

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

---

## 9. Gateway Resilience — Full Depth (32 Mechanisms)

> Absorbed verbatim-in-substance from SKILL.md `## Gateway Resilience` (which S5 collapses to a summary table). This section is the canonical resilience depth inside `architecture.md`.
> Ownership boundaries (no contradictions): directive grammar → `directive-grammar.md`; error→TTL→retry wiring → `error-action-matrix.md`; fusion chains/presets → `fusion.md`; Zen identity/session gating → `zen-provider.md`; Google native forwarder → `google-native.md`; OpenRouter harness handling → `openrouter-handling-spec.md`; telemetry line contract → `logger.md`.
> Grounded code corrections applied on absorb: fusion presets are `quad`/`pydn`/`fast`/`deep` only (`config/fusion.json`); `gb` appears nowhere in `src/` and must never be used; `g1` is a completion-code slot, never a nuance.

1. **Inbound Dual ALPN Protocol Support (`https://localhost:7766`)**: Powered by Bun v1.4.0+, LiteRouter natively negotiates **HTTP/2 (`h2`)** for binary multiplexed streaming clients (Pydantic AI / Python `httpx` with `http2=True`, `curl --http2`) and **HTTP/1.1 over TLS** for Node.js clients (OpenCode2, Claude Code) on the exact same port without SSL handshake or ALPN protocol rejection alerts.
2. **In-Flight Error Classification & Key Rotation (`classifyUpstreamError`)**: Automatically classifies upstream HTTP errors. Retries in-flight up to 3 times across active keys for transient 400 provider errors (0s cooldown), rate limits (dynamic cooldown), exhausted quotas (7d cooldown), 401/403 bad keys (7d cooldown), and 5xx server errors (10s cooldown). Full status→TTL→retry wiring lives in `error-action-matrix.md`.
3. **Network & Transport Layer Resilience**: Wraps pre-stream socket failures, TCP resets (TCP RST / `ECONNRESET`), HTTP/2 GOAWAY (`RemoteProtocolError`), and network connection timeouts (`ConnectTimeout` / `ConnectError`) into `NoResponseError`, retrying across pooled keys in-flight (up to 3 attempts) before failing.
4. **Deterministic Fail-Fast**: Immediately aborts retries without burning other keys on deterministic client errors (HTTP 400 context length exceeded, schema/validation errors, safety filters, HTTP 404).
5. **TTFT Guard** (5s): aborts upstream if no verifiable content token arrives, rotates to next key with zero cooldown penalty.
6. **Stream Idle Guard** (120s / 2 mins) & **Max HTTP Timeout** (300s / 5 mins): protects against mid-stream stalls while giving deep-reasoning and large-context models (e.g. `stealth/ox-alpha` on 40k+ context) sufficient thinking leeway without premature socket severance.
7. **SSE Keepalive** (2s/15s): injects comment frames (`: keep-alive\n\n`) to keep client connections active during thinking and long processing pauses.
8. **Ghost Response Guard**: rejects HTTP 200 responses with 0 content tokens.
9. **Client Cache Sanitizer**: strips `prompt_cache_key`/`prompt_cache_retrieval`/`prompt_cache_reset` before upstream dispatch.
10. **Mid-Stream Error Interceptor & Long-Running Auto-Resend**: Detects mid-stream in-band 5xx error chunks (`Server error mid-response. The response above may be incomplete.`), socket resets, and premature EOFs, isolates the failing key (10s/60s), and automatically resends across available keys into the open downstream client stream. Prioritizes long-running harness survival over terminal token purity.
11. **Outbound HTTP/2 Staggered Connection Pool & Anti-Pinning Aging (`src/network/h2_pool.ts`)**: Coalesces concurrent outbound requests into persistent HTTP/2 sessions with single-flight mutexes, least-loaded stream balancing across `sessionsPerOrigin` (1 code default, `src/network/h2_pool.ts:36`; singleton passes no config — recommended override 4; code-default-1 means e.g. 7 Zen keys share 1 socket, not 7 sockets), and **staggered connection aging (`maxSessionAgeMs = 180s` with $\pm 15\text{s}$ jitter)**. Mitigates the Layer 4 (L4) / HTTP/2 connection pinning trap where single long-lived sockets get hashed to a single upstream load-balancer blade, exhausting local rate-limit token buckets and triggering recurrent `429 Too Many Requests`. When a session reaches its TTL, it enters `isDraining = true` — new requests take fresh TCP sockets with new ephemeral ports and full buckets, while in-flight LLM/SSE streams complete uninterrupted to EOF before graceful `session.close()` is called (`startDraining` re-arms `drainTimer` while `activeStreams > 0`; `session.destroy()` only at 0 streams or fatal `error`/`frameError`/timeout). Includes emergency overflow synchronization and in-pool `GOAWAY` handling. Falls back to HTTP/1.1 keep-alive on failure.
12. **Token-Bucket Rate Pacer & Ingress Conveyor Belt (`src/network/pacer.ts`)**: Enforces mandatory `minIntervalMs` (2000ms for Google `gg` AND GCP `gc`, 500ms for others) with an $O(1)$ `FastFifoQueue`, bounded queue dwell (240s for `gc` via `GCP_PACER_MAX_QUEUE_WAIT_MS`, 300s for others via `LITEROUTER_PACER_MAX_QUEUE_WAIT_MS`), and unified conveyor pacing for both inbound and mid-stream retries. Ingress conveyor is enforced at the **gateway edge** (`src/index.ts` `handleAppRequest`/`dispatchRoute` → `acquireIngressPacer` → `getPacerForProvider(provider).acquire(req.signal)` for `or`/`nv`/`zn`/`gg`; `gc` remains handler-paced to avoid `2000ms × 2` double pacing, with `WeakSet<Request>` deduplication removing duplicate handler ingress for `openai_compat.ts`/`anthropic_compat.ts`). Mid-stream retries are paced inside handlers (`openai_compat.ts`/`gcp_compat.ts`/`anthropic_compat.ts` `acquireProviderPacer`/`acquireGcpPacer` before each `fetchWithTtftGuard` retry). `PACER` telemetry `🐢 [PACER]` (`src/ui/logger.ts` `logPacer`: `dwell`/`depth`/`avg`/`interval`) is visible in `tmux` alongside `TTFT`.
13. **Provider Circuit Breaker (`src/network/circuit_breaker.ts`)**: 3-state protection (`CLOSED`, `OPEN`, `HALF_OPEN`) with 60s auto-expiring single-flight canary leases.
14. **OpenCode Reasoning Stream Filter & Context Bloat Shield (Option 1B)**: OpenCode 2 beta accumulates streaming `delta.reasoning` / `delta.reasoning_content` chunks into SQLite and re-injects them into subsequent request turns, bloating context from ~40K to 300K+ tokens. LiteRouter detects OpenCode (`User-Agent: opencode*`, `x-opencode` header, `x-client-name`) and strips reasoning deltas in flight while preserving `content`, `role`, `tool_calls`, `finish_reason`, and token usage stats. Includes automatic upstream defect healing: sanitizes unescaped raw control characters (escaping `\r` `0x0D` to prevent `JSON.parse` crashes in Vercel AI SDK), deletes `delta.content: null` to conform with strict Zod schemas, and emits stateful 5-second throttled synthetic empty delta heartbeats (`data: {"choices":[{"index":0,"delta":{}}]}`) during deep thinking periods to prevent downstream client 55s inactivity disconnects. Non-OpenCode clients retain full raw reasoning streams. Overridden via `ts` nuance (to keep thinking in OpenCode) or `sb` (to force-strip for any client).
15. **OpenCode2 Auto-Patcher & Self-Healing Hook (`scripts/opencode2_autopatch.sh`)**: Standalone, idempotent, sub-5ms verifier ensuring `@opencode-ai/cli` in Node/NVM paths has intact permissions, valid binary symlinks, automatic `.bak` backups, tool message format normalization (converting `role: "tool"` content arrays to strings), and anti-silent network error guards. Integrated directly into `~/.local/bin/opencode2`.
16. **Two-Leg Streaming Architecture (`docs/Fix_Streaming_01.md`)**:
    - **Incoming Leg**: Zero artificial client socket cutoffs; ingress traffic sequenced via **gateway-edge conveyor belt** (`src/index.ts` `handleAppRequest`/`dispatchRoute` `acquireIngressPacer` for `or`/`nv`/`zn`/`gg`; `gc` handler-paced) plus handler mid-stream pacer for retries — unified `minIntervalMs` (2000ms `gc`/`gg`, 500ms others) with bounded dwell (240s `gc`, 300s others).
    - **Outgoing Leg**: Resilient replay on upstream socket drops; key pool rotation without aborting downstream client sessions; mid-stream retries re-acquire the conveyor (`acquireGcpPacer`/`acquireProviderPacer`) before each `fetchWithTtftGuard`.
17. **Universal XML Tool Calling, Trapped Thinking Extraction & Turn Compaction (`src/transformers/dots.ts`)**:
    - **Live Incremental Thinking Streaming**: Incrementally streams `<think>` blocks as real-time `reasoning_content` deltas chunk-by-chunk rather than buffering entire thinking blocks, preventing UI freezes during long-horizon reasoning.
    - **Pre-Thinking Tool Extraction**: Searches and extracts tool calls across GLM (`<arg_key>`/`<arg_value>`), Qwen (`<function=...><parameter=...>`), DeepSeek (`<invoke name="...">`), and JSON-in-XML *before* stripping `<think>` tags. Prevents models (Ling, Qwen, DeepSeek-R1, Kimi) from prematurely stopping when tools are output inside thinking blocks.
    - **Consecutive Tool Results Compaction**: Automatically compacts consecutive `role: "tool"` responses into a single clean `role: "user"` message turn in `serializeDotsToolHistory`, preventing chat template breaks and empty EOS emissions on Chinese models.
    - **Tag Sanitization**: Lookahead stream buffering (`flushNonTagContent`) and static regex scrubbing eliminate leaked `<arg_key>`, `<arg_value>`, `<tool_call>`, and `<invoke>` tags across live deltas and outbound history.
    - **Gold Test Verification (`tests/unit/gold_xml_bidirectional_translation.test.ts`)**: Permanent canonical bidirectional test suite verifying 1-to-1 conversion between Chinese XML tool dialects (Ling-3.0 `<arg_key>/<arg_value>`, Qwen `<function=...>`, DeepSeek `<invoke name="...">`, trapped thinking breakout) and standard OpenAI JSON tool calls, plus outbound JSON schema & history compaction.
18. **Selective Tool Reasoning Retention & Outbound Scrubbing (`opencode2-reasoning-scrubber.md`, `.opencode2/plugins/collapse-reasoning.ts`)**: Inbound live thinking streams are fully passed through for real-time terminal observability. Outbound request histories are scrubbed of reasoning for purely conversational assistant turns to eliminate token bloat, **BUT reasoning MUST be strictly preserved on assistant turns containing tool calls** to ensure upstream providers (Minimax, DeepSeek, Qwen, GLM) do not reject payloads with `HTTP 500 "Provider returned error"`.
19. **GCP Single-Flight & In-Flight Retry Toggle (`GCP_ENABLE_RETRIES`)**: Configurable resilience parameter (default: `true`, supports boolean coercion `true`/`false`/`1`/`0`/`yes`/`no`). When set to `true`, enables full in-flight key rotation and retry resilience for Google Cloud Vertex (`gc`) on 429 rate limits, 5xx server errors, and transport failures. When set to `false`, activates single-flight pass-through mode: passes upstream 4xx/5xx responses (e.g. 429 Too Many Requests, 400 Context Length Overflow, 500/503 errors) directly downstream on attempt 1 while preserving key health and quarantine tracking in `globalKeyPool` for subsequent requests, synthesizing HTTP 502 Bad Gateway on transport drops (`NoResponseError`), and closing SSE streams cleanly on mid-stream drops.
20. **GCP Key Quarantine Toggle & Dumb-Forwarder Mode (`GCP_ENABLE_QUARANTINE`)**: Configurable cooldown/quarantine parameter (default: `true`, supports boolean coercion `true`/`false`/`1`/`0`/`yes`/`no`). When set to `false`, bypasses all key quarantine, cooldown state tracking, and 503 load-shedding mechanisms for GCP keys (`gc`) across all error status codes (429, 5xx, 401, 403, transport drops). Keys remain immediately available for round-robin selection. When combined with `GCP_ENABLE_RETRIES=false`, turns LiteRouter into a pure transparent dumb forwarder for GCP keys.
21. **GCP Circuit Breaker & Pacer Isolation (`GCP_ENABLE_CIRCUIT_BREAKER`, `GCP_ENABLE_PACER`)**: Decouples Google Cloud Vertex (`gc`) from global gateway circuit breakers. When `GCP_ENABLE_CIRCUIT_BREAKER=false`, upstream 503 capacity spikes are passed directly downstream without tripping an internal circuit breaker that blocks all 24 keys, eliminating false "Quarantined Key" log lines. Pacing via `GCP_ENABLE_PACER` runs exactly once in the attempt loop before key selection, eliminating duplicate conveyor delays.
22. **OpenRouter Agentic Harness Whitelist Headers**: Automatically injects approved agentic harness headers (`HTTP-Referer`, `X-Title`, `User-Agent` defaulting to `OpenCode/1.18.29`, env-configurable) when calling OpenRouter, preventing HTTP 403 `Gate Free Endpoints by Agentic Harness` errors on `:free` models. Provider attribution headers (`User-Agent`, `HTTP-Referer`, `Referer`, `X-Title`) are declaratively configured directly in `config/providers.json` under each provider's `"headers"` object, loaded dynamically by `resolveUpstreamEndpoint` and `buildAuthHeaders`, and hot-reloaded via `POST /reset` (`resetProvidersRegistryCache()`). Details in `openrouter-handling-spec.md`.
23. **Zen Provider OpenCode Identity Gating & Bare Model Standard**:
    - **Bare Model Naming**: Zen models NEVER use a `zen/` prefix. Clients supply bare model names (e.g. `big-pickle`, `hy3-free`, `deepseek-v4-flash-free`, `qwen3.6-plus-free`, `minimax-m3-free`, `nemotron-3-ultra-free`, `north-mini-code-free`) together with a Zen directive key (e.g. `Authorization: Bearer lr-zn-oa-ch-no`).
    - **OpenCode Identity Headers**: OpenCode's Zen gateway (`opencode.ai/zen/v1`) strictly gates API access behind OpenCode identity headers, returning synthetic `HTTP 429 FreeUsageLimitError: Rate limit exceeded` when called with standard runtime User-Agents (curl, Bun, python-requests), and `HTTP 400 MissingSessionID: OpenCode's free tier can only be used in OpenCode` on free-tier Responses models (e.g. `muse-spark-1.3-contributor-free` via `lr-zn-oo-rs-no`) when client session identity is stripped. Provider attribution headers (`User-Agent`, `HTTP-Referer`, `Referer`, `X-Title`) are declaratively configured directly in `config/providers.json` under each provider's `"headers"` object, loaded dynamically by `resolveUpstreamEndpoint` and `buildAuthHeaders`, and hot-reloaded via `POST /reset` (`resetProvidersRegistryCache()`). Handlers (`buildAuthHeaders` in `openai_compat.ts`, `anthropic_compat.ts`) and diagnostic probes (`probeZenKey` in `scripts/doctor.ts`) inject:
      - `User-Agent: OpenCode/1.18.29` (or `LITEROUTER_USER_AGENT`)
      - `HTTP-Referer: https://opencode.ai` (or `LITEROUTER_HTTP_REFERER`)
      - `Referer: https://opencode.ai` (or `LITEROUTER_HTTP_REFERER`)
      - `X-Title: OpenCode` (or `LITEROUTER_X_TITLE`)
    - **Client Session Forwarding (MissingSessionID fix, 2026-09-07)**: `buildAuthHeaders(..., incomingHeaders?)` forwards client session/client identity headers upstream (`session-id`, `x-session-id`, `x-opencode-session`, `x-opencode-session-id`, `opencode-session-id`, `opencode-session`, `x-client-version`, `x-client-name`) on all direct paths (`openai_compat.ts` initial + retry, `openai_original.ts` passthrough, `anthropic_compat.ts` direct loop from `req.headers`). Static `User-Agent` alone does NOT satisfy Zen free-tier gating. Full detail in `zen-provider.md`.
24. **NVIDIA NIM EOL Catalog & Reasoning Treatment**: NVIDIA NIM is an infrastructure host and does not use agentic harness headers, but aggressively sunsets models with strict `HTTP 410 Gone` deprecations (e.g. `meta/llama-3.1-8b-instruct` EOL on 2026-08-26; active flagship is `nvidia/nemotron-3-super-120b-a12b`). Flagship reasoning models emit exclusively `reasoning_content` deltas during initial stream chunks (`content` null), requiring thinking preservation (`ts` nuance, client `reasoning_content` extraction) and keepalive frames to prevent false client-side ghosting timeouts.
25. **Zen Responses API Translation (`lr-zn-oa-rs-no`)**: Provides bidirectional translation between OpenAI wire format (`POST /v1/chat/completions`) and Zen's `/v1/responses` endpoint (`src/transformers/responses.ts`). Converts standard `messages` array to Responses `input`, sanitizes encrypted reasoning items, maps reasoning tokens to standard usage objects, converts Responses SSE events (`response.output_text.delta`, `response.completed`) into standard `chat.completion.chunk` events, and prevents false premature stream EOF stalls in `src/network/fetcher.ts`.
26. **OpenAI Original Wire Protocol & Native Responses API Handler (`lr-zn-oo-rs-no`, `lr-or-oo-rs-no`)**: Native passthrough handler (`src/handlers/openai_original.ts`) for `POST /v1/responses` using the `oo` wire protocol. Directly handles native Responses API payloads with multi-key round-robin rotation, quarantine, circuit breaking, pacer ingress, and SSE streaming passthrough across Zen and OpenRouter key pools without altering Responses API schemas. Enforces strict fail-fast validation against wire/endpoint mismatches. Emits inbound + TTFT telemetry (`logInbound`/`logTtft` via `handleOpenAiOriginal`) on par with `/v1/chat/completions`.
27. **OpenCode 2 Client Chunk Timeout Alignment (`chunkTimeout: 30000`)**: Standard 30s (`chunkTimeout: 30000`) alignment across all OpenCode 2 provider blocks (`~/.config/opencode2/config.json`) matching `LITEROUTER_STREAM_IDLE_TIMEOUT=30`, eliminating premature client-side stream timeouts during extended model reasoning pauses while keeping LiteRouter's keepalive and pacer loops in sync.
28. **Zen Single-Flight & In-Flight Retry Toggle (`ZEN_ENABLE_RETRIES`, mirrors item 19)**: Configurable resilience parameter (default: `true`, supports boolean coercion `true`/`false`/`1`/`0`/`yes`/`no`; schema default in `src/config/schema.ts`, fallback in `src/config/env.ts`). When set to `true`, enables full in-flight key rotation and retry resilience for Zen (`zn`) on 429 rate limits, 5xx server errors, and transport failures. When set to `false`, activates single-flight pass-through mode: passes upstream 4xx/5xx responses directly downstream on attempt 1 while preserving key health and quarantine tracking in `globalKeyPool` for subsequent requests, synthesizing HTTP 502 Bad Gateway on transport drops (`NoResponseError`), and closing SSE streams cleanly on mid-stream drops. NOTE: tracked `.env` currently sets `ZEN_ENABLE_RETRIES=false` (dumb-forwarder mode); unset/code default is `true`.
29. **Zen Key Quarantine Toggle & Dumb-Forwarder Mode (`ZEN_ENABLE_QUARANTINE`, mirrors item 20)**: Configurable cooldown/quarantine parameter (default: `true`, supports boolean coercion `true`/`false`/`1`/`0`/`yes`/`no`). When set to `false`, bypasses all key quarantine, cooldown state tracking, and 503 load-shedding mechanisms for Zen keys (`zn`) across all error status codes (429, 5xx, 401, 403, transport drops). Keys remain immediately available for round-robin selection. When combined with `ZEN_ENABLE_RETRIES=false`, turns LiteRouter into a pure transparent dumb forwarder for Zen keys. NOTE: tracked `.env` currently sets `ZEN_ENABLE_QUARANTINE=false` (dumb-forwarder mode); unset/code default is `true`.
30. **Zen Circuit Breaker & Pacer Isolation (`ZEN_ENABLE_CIRCUIT_BREAKER`, `ZEN_ENABLE_PACER`, mirrors item 21)**: Decouples Zen (`zn`) from global gateway circuit breakers. Defaults mirror GCP semantics: `ZEN_ENABLE_CIRCUIT_BREAKER=false` (pass upstream 503 capacity spikes directly downstream without tripping an internal breaker that blocks the whole Zen pool), `ZEN_ENABLE_PACER=true` (pacing runs exactly once in the attempt loop before key selection, eliminating duplicate conveyor delays). NOTE: tracked `.env` currently sets `ZEN_ENABLE_CIRCUIT_BREAKER=false` / `ZEN_ENABLE_PACER=true`; these match the code defaults.
31. **LiteRouter v4 Architectural Boundary: Pure Handlers & Transport Stream Reassembly**: Decouples route handlers (which strictly orchestrate routing, key rotation, and downstream SSE emission) from transport wire mechanics (HTTP/2 multiplexing, TTFT sentry, and stream byte reassembly). The OpenAI Original Responses API handler (`/v1/responses`, `oo` wire protocol) delegates upstream fetch execution to `fetchWithTtftGuard` and `reassembleResponse` in `src/network/fetcher.ts`, enabling true HTTP/2 wire negotiation over the persistent connection pool (`src/network/h2_pool.ts`) for Zen and OpenRouter. Terminal telemetry explicitly disambiguates inbound client protocol (`x-http-version` on `[Inbound]`) from true negotiated upstream wire protocol (`[Upstream: HTTP/2]` on `🟢 [TTFT]`).
32. **Payload Wire & Scrubbing Matrix — `oa` scrubs, `oo` preserves (`payload.md`)**: Scrubbing is keyed off the payload (wire) segment, not provider or endpoint. `oa` wire (`src/handlers/openai_compat.ts:872` → `src/transformers/payload.ts:290` `scrubReasoningFromMessages`, unconditional) strips reasoning history before `src/transformers/responses.ts:73` converts `messages[]` → Responses `input`; downstream only forwards `response.output_text.delta` (`responses.ts:304`), reasoning survives only as `reasoning_tokens` usage. `oo` wire (`src/index.ts:337` `dispatchResponsesRoute` → `src/handlers/openai_original.ts:975`) forwards `bodyText` verbatim with byte-passthrough streaming (`:454`), preserving encrypted reasoning items and `previous_response_id` for CoT replay. Overrides: `ts` keeps / `sb` forces (`thinking.ts:96`, `opencode_adapter.ts:25`); history scrub ignores `LITEROUTER_STRIP_REASONING`/`LITEROUTER_ENABLE_SCRUBBING` defaults (`schema.ts:127`). `-rs-` keys must use `POST /v1/responses` (`index.ts:285` `validateEndpointMatch`).
