---
name: literouter-playbook
description: LiteRouter API Gateway master operational guide for Bun/TypeScript proxy on port 7766 with declarative API key directives and zero fallback.
---

# Skill: literouter-playbook

# LiteRouter API Gateway (Master Playbook v3.1 / v3.2)

LiteRouter is a high-performance, in-memory AI API Gateway and reverse proxy built from the ground up in Bun and TypeScript. It listens on port `7766` with dual HTTP/1.1 and HTTP/2 (h2 ALPN) TLS support, routing client requests to multiple upstream AI providers via **declarative API key directives** with zero external database dependencies (zero Valkey/Redis) and zero guessing.

---

## ⚡ Quick Operational Commands

| Action | Command | Description |
|---|---|---|
| **Start Gateway** | `bash scripts/start.sh` | Starts gateway in background tmux session `literouter` with health polling |
| **Check Status** | `bash scripts/status.sh` | Checks PID, active tmux session, and queries `https://localhost:7766/health` |
| **Stop Gateway** | `bash scripts/stop.sh` | Gracefully shuts down gateway process and tmux session |
| **Restart Gateway** | `bash scripts/restart.sh` | Performs clean stop followed by startup |
| **Foreground Run** | `bun run src/index.ts` | Runs gateway directly in foreground terminal for debugging |
| **Health Probe** | `curl -sk https://localhost:7766/health` | Probes gateway health endpoint (`200 OK`) |
| **Hard Key Reset** | `curl -sk -X POST https://localhost:7766/reset` | Clears all in-memory cooldowns and reloads key pools |
| **Unit Test Suite** | `bun test` | Runs all 129+ unit and integration tests |
| **OpenCode2 Model Tests** | `bash scripts/test_opencode2_models.sh` | Tests active models end-to-end via `opencode2 run -m` |
| **Diagnostics Doctor** | `bun run scripts/doctor.ts` | Audits key pools, config files, and TLS certificates |
| **Typecheck & Lint** | `bun x tsc --noEmit && uv run ruff check .` | TypeScript and Python verification |

---

## ⛔ CRITICAL MANDATE & SECURITY RULES

### 1. Zero Key Redaction Policy
- **NEVER** edit, sanitize, replace, or overwrite API keys in `.env.local` or `.env`.
- **NEVER** substitute real keys with `<REDACTED>`, `changeme`, or placeholder strings. Replacing keys causes `staticValidateKeys` to discard key pools on boot, breaking gateway routing.
- **NEVER** hardcode real API keys into code, unit tests, scratch scripts, docs, or commit messages.
- `.env.local` is write-protected via `protect.sh` (owned by `root`, read-only `644` for runtime processes).

### 2. Environment Architecture
- **`.env.local` (Git-Ignored Secrets Only):** Holds live upstream API key pools (`OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS`, `ZEN_API_KEYS`, `GOOGLE_API_KEYS`).
- **`.env` (Tracked in Git):** Holds operational parameters (port, timeouts, TTFT guards, reasoning defaults).

---

## 🔑 Declarative API Key Directive Architecture

LiteRouter eliminates model prefixing (e.g. `nvidia/meta/...` or `openrouter/...`) in favor of **declarative API keys**. Upstream model IDs are passed verbatim as requested by the vendor (e.g., `meta/llama-3.1-8b-instruct`, `anthropic/claude-3.7-sonnet`, `gemini-2.5-pro`).

### 1. Direct Directive Format (5-Token Standard)

All direct directive keys follow the strict 5-part lowercase format:
```
lr-<provider>-<payload>-<completions>-<nuances>
```

| Token Segment | Valid Codes | Description |
|---|---|---|
| **Prefix** | `lr` | LiteRouter declarative directive prefix |
| **Provider** | `or`, `nv`, `gg`, `zn`, `oa`, `an`, `gq`, `cb`, `ds`, `ms`, `tg` | Target upstream: `or` (OpenRouter), `nv` (NVIDIA), `gg` (Google), `zn` (Zen), `oa` (OpenAI), `an` (Anthropic), `gq` (Groq), `cb` (Cerebras), `ds` (DeepSeek), `ms` (Mistral), `tg` (Together) |
| **Payload Wire** | `oa`, `cl`, `gg`, `rs` | Downstream-to-upstream wire translation format: `oa` (OpenAI), `cl` (Claude/Anthropic), `gg` (Google), `rs` (Responses) |
| **Completion** | `ch`, `ms`, `ob`, `gc`, `im`, `em`, `au`, `md` | Target endpoint type: `ch` (Chat `/v1/chat/completions`), `ms` (Messages `/v1/messages`), `ob` (OpenAI Beta `/v1beta/openai/*`), `gc` (GenerateContent `/v1beta/models/*:generateContent`), `em` (Embeddings), `md` (Models discovery) |
| **Nuances** | `no`, `dp`, `ts`, `sb`, `gm`, `g3`, `tc` | Modifiers (compound with `+`, e.g. `dp+ts`):<br>• `no`: No-op standard behavior<br>• `dp`: Dots prompt XML tool calling & dot message padding<br>• `ts`: Thought signatures / preserve thinking content<br>• `sb`: Strip reasoning blocks from historical context<br>• `gm`: Gemma turn-merging and parameter scrubbing<br>• `g3`: Google 3 thinking parameter sanitizer<br>• `tc`: Tool choice normalizer |

### Common Directive Examples

| Directive API Key | Target Wire & Protocol | Use Case |
|---|---|---|
| `lr-or-oa-ch-no` | OpenRouter OpenAI Chat Completions | Standard chat models on OpenRouter |
| `lr-or-cl-ms-dp` | OpenRouter Anthropic Messages API | Dots models with native Anthropic passthrough |
| `lr-nv-oa-ch-no` | NVIDIA NIM Chat Completions | NVIDIA inference microservices |
| `lr-zn-oa-ch-no` | Zen OpenAI Chat Completions | OpenCode Zen free models |
| `lr-gg-oa-ob-gm` | Google OpenAI-compat Beta + Gemma Nuance | Gemma & Gemini models with system-turn merging |
| `lr-gg-gg-gc-gm` | Google Native RPC (`:generateContent`) | Native Gemini RPC integration |

### 2. Fusion Directive Format (3-Token Preset)

For resilient multi-provider tiered routing, LiteRouter supports fusion presets defined in `config/fusion.json`:
```
lr-fse-<preset>
```
Examples: `lr-fse-fast`, `lr-fse-smart`, `lr-fse-code`, `lr-fse-cheap`.

---

## 🏛 Modular Architecture (`src/`)

```
src/
├── config/
│   ├── env.ts              # Operational environment loader & fallback defaults
│   ├── keys.ts             # Static key pool validation & key masking
│   └── schema.ts           # Zod schemas for providers.json, fusion.json, models.json
├── directive/
│   ├── parser.ts           # 5-token & fusion directive parser (lr-xx-xx-xx-xx / lr-fse-xxxx)
│   └── validator.ts        # Request header & query parameter auth extractor
├── fusion/
│   ├── engine.ts           # Tiered failover & model resolution engine
│   └── sticky.ts           # In-memory sticky fallback session tracking
├── handlers/
│   ├── openai_compat.ts    # OpenAI chat completions handler, key pool selection & retry loop
│   ├── anthropic_compat.ts # Anthropic Messages protocol handler, streaming SSE translation & tool adapter
│   ├── google_native.ts    # Google Native RPC (:generateContent) & OpenAI Beta handler
│   └── discovery.ts        # Dynamic model discovery endpoint (/v1/models)
├── network/
│   ├── pool.ts             # In-memory KeyPool rotation & active key manager
│   ├── cooldown.ts         # In-memory CooldownManager (sliding window TTLs)
│   ├── fetcher.ts          # TTFT guard (5s), idle stream guard (30s), keepalive timer (15s)
│   └── zdist.ts            # Zipfian / weighted distribution selector
├── transformers/
│   ├── payload.ts          # Upstream payload sanitizer (strips prompt_cache_key, cleans LaTeX, merges Gemma)
│   ├── thinking.ts         # Reasoning extraction, thinking budget scrubber & thinking_delta emitter
│   ├── dots.ts             # Dots XML tool-calling polyfill (<invoke name="..."> to tool_calls)
│   └── nuances.ts          # Nuance modifiers (dp, ts, sb, gm, g3, tc) & dot prompt injection
├── ui/
│   ├── banner.ts           # ANSI terminal startup banner
│   ├── logger.ts           # Structured emoji event logger (INBOUND, SERVED, LIMIT, ERROR, GHOST)
│   └── telemetry.ts        # In-memory request counters and latency trackers
├── index.ts                # Server entrypoint with dual TLS/cleartext HTTP routing on port 7766
└── lib.ts                  # Barrel re-export file for public gateway modules
```

---

## 🛡 Gateway Resilience & Ghost-Response Guards

1. **TTFT Guard (`TTFT_TIMEOUT_MS = 5000ms`):**
   Holds downstream HTTP headers until the upstream provider emits at least one verifiable content token (`content`, `thought`, `reasoning_content`, `parts`, or `tool_calls`). If upstream accepts TCP but stalls with 0 tokens for 5s, `fetchWithTtftGuard` aborts and immediately rotates to Key #2 with **zero cooldown penalty**.
2. **Stream Idle Guard (`STREAM_IDLE_TIMEOUT_MS = 30000ms`):**
   Monitors active streams for mid-stream stalls. If no chunk arrives within 30s, aborts and triggers automatic retry.
3. **SSE Keepalive Comments (`KEEPALIVE_INTERVAL_MS = 15000ms`):**
   Injects periodic comment frames (`:\n\n`) into downstream SSE streams to keep client connections active during slow thinking phases.
4. **Buffer Concatenation (`collectFullBody`):**
   Ensures non-streaming JSON responses are fully collected before delivering downstream, eliminating chunk truncation errors.
5. **Client Cache Parameter Sanitizer:**
   Automatically scrubs non-standard cache headers (`prompt_cache_key`, `prompt_cache_retrieval`, `prompt_cache_reset`) before upstream forwarding to avoid vendor HTTP 400 validation rejections.
