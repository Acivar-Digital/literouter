---
name: literouter
description: LiteRouter API Gateway operational guide for Bun/TypeScript proxy on port 7766. Use when the user asks about LiteRouter, gateway ops, directive keys, provider/model config, routing, fusion presets, native chains (gemini-flash, gemini-flash-lite), Zen provider, doctor diagnostics, Claude Code integration, OpenCode2 integration, Antigravity proxy, setup, or troubleshooting the literouter gateway.
---

# Skill: literouter

> **CANONICAL LOCATION (DO NOT SEARCH DISK):**
> - Root Skill File: `/home/yapilwsl/arthityap/literouter/.opencode2/skills/literouter/SKILL.md`
> - Skill Directory: `/home/yapilwsl/arthityap/literouter/.opencode2/skills/literouter/`
>
> **Lazy-load skill.** This SKILL.md is the entry point only. When the user's request matches the skill description, load this file first. For deep dives into specific topics, read the referenced markdown files in this directory.

### Lazy-Load Protocol (mandatory)
1. Read this SKILL.md entry point only — do NOT pre-read topic files.
2. Match the task to ONE row in §14 Topic Map and load ONLY that file.
3. Pane-rubbish / `getcwd` / quiet-boot tasks → load `tmux-hygiene.md` only.
4. Never load all skill files; never grep the whole skill dir for a targeted question.

## §0. Tmux Pane Hygiene (clear rubbish)

> 📖 **Full runbook**: [`tmux-hygiene.md`](tmux-hygiene.md) — load it for any pane-cleanup task.

- Wipe scrollback without disturbing serving: `tmux clear-history -t literouter` (VPS: prefix `export PATH="/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:$PATH"` over ssh).
- `start.sh` already boots quiet (`new-session -c`, `--noprofile --norc`, post-boot `clear-history`); always boot via `bash scripts/restart.sh`, never manual double-`cd`.
- Recurring VPS `shell-init/getcwd` = Aug-16 tmux server holding deleted `literouter-old` cwd — needs a maintenance-window server restart (kills all sessions).

## §1. Quick Reference

| Action | Command |
|---|---|
| Start gateway | `bash scripts/start.sh` |
| Check status | `bash scripts/status.sh` |
| Stop gateway | `bash scripts/stop.sh` |
| Restart gateway | `bash scripts/restart.sh` |
| Health probe (public) | `curl -s http://10.32.34.243:7766/health` (or configured host in `config/location.json`) |
| Hard key reset (auth-gated) | `curl -s -X POST http://10.32.34.243:7766/reset -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"` |
| Unit tests (all) | `bun run test` (or `bun test:lr`) (accelerated domain-partitioned test runner: runs 7 domains in parallel subprocesses, completely silent on success, outputs only isolated failures) |
| Targeted domain test slice | `bun run test <domain>` (or `bun test:lr <domain>`) (e.g. `bun run test handlers`, `bun run test network`, `bun run test stream`, `bun run test engine`, `bun run test telemetry`, `bun run test core`, `bun run test eval`) |
| Raw unbuffered test runner | `bun run test:raw` (verbose escape hatch) |
| OpenCode2 test tool | `test_literouter` native tool for zero-bloat programmatic test invocation |
| Benchmark eval grader tests | `bun run test:eval` (`bun run scripts/test_runner.ts eval`, 182 tests) |
| Anti-bloat failure runner | `bun run test:failures` (`bun test --only-failures`) |
| Zen wire adaptation test | `bun run test:zen` (live 3-vector test against intranet gateway `http://192.168.50.10:7766`) |
| Diagnostics | `bun run scripts/doctor.ts` (JSON schema + live upstream key probes for Google, NVIDIA, OpenRouter, Zen, GCP) |
| Master Model Evaluation Gauntlet | `bun run eval/eval.ts <model_name>` (orchestrates speed, code & web, outputs markdown report card; reasoning-transcript appendix default-ON via `ts`-nuance key, opt-out `--no-reasoning-transcript`) |
| Coding & Agentic Benchmark | `bun run eval/code.ts <model_name>` (5-stage wire, pydantic, loop, str_replace & injection audit; dual Chat/Responses) |
| Web Frontend Evaluation | `bun run eval/web.ts <model_name>` (5-stage DOM structure, responsive, React state, hygiene & a11y audit) |
| Model probe & onboarding | `bun run scripts/probe_model.ts <model_name>` (validates OpenCode 2, Claude Code CLI & Pydantic AI) |
| Model speed & throughput | `bun run eval/speed.ts` (measures TTFT, duration, tokens/sec; alias: `scripts/bench_speed.ts`) |
| OpenCode2 Auto-Patch | `bash scripts/opencode2_autopatch.sh` (fast <5ms self-heal & binary verification) |
| Sync LiteRouter to VPS | `bash scripts/sync_literouter_to_vps.sh` (strictly unidirectional mirror of LiteRouter code, .env, and .env.local from WSL golden truth to VPS) |
| Typecheck & lint | `bun run typecheck` && `uv run ruff check .` |

> **Accelerated Test Runner & Subcommands (`bun run test` / `bun test:lr`)**:
> - `bun run test` (or `bun test:lr`): Accelerated domain-partitioned test runner (runs 7 domains in parallel subprocesses, completely silent on success, outputs only isolated failures). Note: NEVER run naked `bun test` as Bun treats `test` as a built-in keyword bypassing `scripts/test_runner.ts`.
> - `bun run test <domain>` (or `bun test:lr <domain>`): Fast targeted slice (e.g. `bun run test handlers`, `bun run test network`, `bun run test stream`, `bun run test engine`, `bun run test telemetry`, `bun run test core`, `bun run test eval`)
> - `bun run test:raw`: Raw unbuffered Bun test runner (verbose escape hatch)
> - OpenCode2 tool: `test_literouter` native tool for zero-bloat programmatic test invocation.

> **Auth scope**: `GET /health` is public (auth-free) for liveness probes. `/reset` is **auth-gated** behind `LITEROUTER_AUTH_KEY` or valid directive token (matches `POST /admin/pool/reset`; returns `401 Unauthorized` without valid Bearer auth) — see [scripts-ops.md §2](scripts-ops.md#2-get-health-liveness-probe-no-auth-any-method) and [§3](scripts-ops.md#3-post-reset-hard-reset-no-auth-any-method-hot-reload-scope).

### Downstream Serving & ZeroTier Topology (`config/location.json`)
- **Authoritative Configuration**: `config/location.json` is the sole downstream authority:
  ```json
  {
    "host": "10.32.34.243",
    "port": 7766,
    "tls_enabled": false
  }
  ```
- **Interface Bindings**:
  - **VPS (`vps466a`)**: `10.32.34.243:7766` (`ztdhgfvars` ZeroTier interface).
  - **WSL (Local)**: `10.32.34.172:7766` (`ztdhgfvars` ZeroTier interface).
  - Never bind to `0.0.0.0` or expose raw unauthenticated ports.
- **Client Routing**: Clients (OpenCode, Claude Code, Scribe in VPS tmux) configure `baseURL` pointing to `http://10.32.34.243:7766/v1` (or WSL `http://10.32.34.172:7766/v1`).
- **Transport**: Downstream is plain HTTP/1.1 over secure ZeroTier overlay; Upstream connections to providers remain HTTP/2 over TLS managed via `Http2Pool`.

## §2. Active Key Pools (summary)

> 📖 **Full registry**: [`config-schemas.md` §3](config-schemas.md#3-configprovidersjson-providers-headers-registry) (providers, headers, endpoints, limits, strategies — §3.1 is the single source of truth for name → code → base_url → strategy).

| Provider | Code | Environment Variable | Upstream Target | Strategy |
|---|---|---|---|---|
| **OpenRouter** | `or` | `OPENROUTER_API_KEYS` | `https://openrouter.ai` | `standard` |
| **NVIDIA NIM** | `nv` | `NVIDIA_API_KEYS` | `https://integrate.api.nvidia.com` | `standard` |
| **Google AI Studio** | `gg` | `GOOGLE_API_KEYS` | `https://generativelanguage.googleapis.com` | `native_cascade` |
| **Zen** | `zn` | `ZEN_API_KEYS` | `https://opencode.ai/zen` | `standard` |
| **Google Cloud (GCP)** | `gc` | `GCP_KEYS` / `GCP_API_KEYS` | `https://generativelanguage.googleapis.com` | `gcp_guarded` |

*Validation*: Discards tokens `< 4` chars or matching `changeme`, `todo`, `undefined`, `null`. Non-destructive mock keys injected during unit tests.

### Provider Operational Knobs & Governance (`config/providers.json`)
- **Handler Ground Truth & Sole Source of Truth**: All handlers (`openai_compat`, `openai_original`, `anthropic_compat`, `google_native`, `gcp_compat`) look up their provider settings directly from `config/providers.json`, with zero shadow defaults or hardcoded magic constants.
- **Purged Dead Ballast**:
  - `limits` (`rpm`, `rpd`, `tpm`) has been completely purged from provider schemas and `config/providers.json` (removing the retired Zdist relic).
  - **No circuit breaker**: Fully excised in v4. No circuit breaker concept exists in schema, network layer, engine, or any handler.
  - `key_cooldown` is `.optional()` in Zod schema (`ProviderConfigEntrySchema`) but carries zero runtime behavior in v4. Fine-grained knobs (`initial_cooldown_ms`, `backoff_factor`, `max_consecutive_failures`) and `max_delay_ms` are purged.
- **Single FIFO Conveyor Pipe**: Every provider has its own dedicated conveyor pipe (`RequestPacer`) with `max_queue_depth: 500`. All inbound requests and retries share the same conveyor belt, spaced strictly by `min_delay_ms`. Downstream client cancellation cleanly dequeues requests via `AbortSignal` without memory leaks.
- **Fatal Auth Fail-Fast (401/403)**: On HTTP 401 (Unauthorized) or 403 (Forbidden), LiteRouter rejects outright and returns the error directly to the downstream client (`opencode2`, Claude Code, etc.) with ZERO retries and zero 24-hour quarantine.
- **Conservation-Only Benching**: The only mechanism that benches a key is explicit `conserve_rules` in `config/providers.json` (e.g. OpenRouter daily quota exhaustion until midnight UTC). Generic 429 errors do not trigger 65s lockouts.
- **Strict Boot-Time Validation & Fail-Loud Failure**: Missing or invalid operational blocks in `config/providers.json` are rejected on boot by `validateProviderConfigsFailLoud()` (`src/config/providers.ts` / `src/index.ts`) with `[FATAL] [ProviderRegistry] Provider configuration validation failed loudly refusing to start` and `process.exit(1)`.
- **Purge of Deprecated Provider Env Vars**: All 17 legacy provider-specific operational env vars (`GCP_*`, `ZEN_*`, `OPENROUTER_*`) have been purged from `src/config/env.ts` and `src/config/schema.ts` and cannot shadow `config/providers.json`. Operational parameters must be edited directly in `config/providers.json` and hot-reloaded via `POST /reset`.

## §3. Core Inbound Endpoints & Handlers

| Inbound Method & Path | Handler Source File | Handler Function | Directives / Notes |
|---|---|---|---|
| `POST /v1/chat/completions` | `src/handlers/openai_compat.ts` | `handleOpenAICompat` | `lr-*-oa-ch-*`, `lr-*-ao-ch-*`. Full streaming & key rotation. |
| `POST /v1/messages`<br>`POST /messages` | `src/handlers/anthropic_compat.ts` | `handleAnthropicCompat` | `lr-*-cl-ms-*`. Native Claude Code integration. |
| `POST /v1/responses` | `src/handlers/openai_original.ts` | `handleOpenAiOriginal` | `lr-*-oo-rs-*`. Native OpenAI Responses API passthrough. |
| `POST /v1beta/models/*:generateContent`<br>`POST /v1beta/models/*:streamGenerateContent` | `src/handlers/google_native.ts`<br>(v4: `src/handlers/v4/google_native.ts`) | `handleGoogleNative`<br>(v4: `handleV4GoogleNative`) | `lr-gg-gg-gc-no`. Direct Gemini REST for Google AI Studio v1beta (`/v1beta/models/*`). In v4, extracts model from path, preserves `:streamGenerateContent` action and query parameters (e.g. `?alt=sse`), streaming SSE (`text/event-stream`). |
| `POST /v1/models/*:generateContent`<br>`POST /v1/models/*:streamGenerateContent` | `src/handlers/google_native.ts`<br>(v4: `src/handlers/v4/google_native.ts`) | `handleGoogleNative`<br>(v4: `handleV4GoogleNative`) | `lr-gg-gg-g1-no`. Direct Gemini REST for Google AI Studio v1 (`/v1/models/*`). In v4, extracts model from path, preserves `:streamGenerateContent` action and query parameters (e.g. `?alt=sse`), streaming SSE (`text/event-stream`). |
| `POST /v1beta/openai/*` | `src/handlers/gcp_compat.ts` / `google_native.ts` | `handleGcpCompat` / `handleGoogleOpenAIBeta` | `lr-gc-oa-ch-no`. GCP Vertex AI OpenAI-compatible route. |
| `GET /v1/models`, `/v1beta/models` | `src/handlers/discovery.ts` | `handleModelsDiscovery` | Advertises models from `models.json` (legacy, advertisement-only) & `fusion.json`; serving is dynamic passthrough, never registry-gated. |
| `GET /health`, `/hello` | `src/index.ts` | `handleHealthCheck` | Auth-free liveness probe (uptime, H2 pool stats). No circuit breaker stats (v4 excised). |
| `POST /reset` | `src/index.ts` | `handleHardReset` | Auth-free hard reset; hot-reloads `config/providers.json` headers — **cannot rebind port** (restart for port/host/cert changes). |

## §4. Directive Key Grammar (summary)

> 📖 **Full matrix**: [`directive-grammar.md`](directive-grammar.md) — shapes ([§1](directive-grammar.md#1-key-shapes)), providers ([§2](directive-grammar.md#2-provider-codes-13)), wires ([§3](directive-grammar.md#3-payload-wire-codes-6)), endpoints ([§4](directive-grammar.md#4-completion-endpoint-codes-10)), nuances ([§5](directive-grammar.md#5-nuance-codes-8-compoundable-with-)), top-10 ([§6](directive-grammar.md#6-top-10-keys-expanded-handler-why)), fusion presets ([§7](directive-grammar.md#7-fusion-presets-lr-fse-)), 400 rules ([§8](directive-grammar.md#8-endpoint-mismatch-400-rules)), dispatch order ([§9](directive-grammar.md#9-dispatch-order-cheat-sheet)), validity checks ([§10](directive-grammar.md#10-quick-validity-checks)), engine gate ([§11](directive-grammar.md#11-engine-selection-v4-only-routes)).

Format: `lr-<provider>-<payload>-<completion>-<nuance>`
- **Providers**: `or`, `nv`, `gg`, `zn`, `gc`, `oa`, `an`, `gq`, `cb`, `ds`, `ms`, `tg` (+ `tp` tests-only loopback double — never use outside unit tests).
- **Payload (wire)**: `oa` (OpenAI, scrubs reasoning), `oo` (Responses native, preserves), `cl` (Anthropic), `ao` (Anthropic→OpenAI cross-wire), `gg` (Google), `rs` (Responses translated).
- **Completion (endpoint)**: `ch`, `ms`, `rs`, `gc`, `g1`, `ob`, `em`, `md` (+ map-only codes `im`, `au` — `g1` is a **completion-code slot for Google v1, not a nuance**).
  - Difference between Google endpoints:
    - `gc`: Google AI Studio v1beta endpoint (`/v1beta/models/{model}:generateContent` / `:streamGenerateContent`).
    - `g1`: Google AI Studio v1 endpoint (`/v1/models/{model}:generateContent` / `:streamGenerateContent`).
  - Query parameters like `?alt=sse` are preserved end-to-end and streamed back over SSE (`text/event-stream`).
- **Nuances**: `no`, `dp`, `ts`, `sb`, `gm`, `g3`, `tc`, `lg` (compound with `+`, e.g. `dp+ts`). `lg` is **parser-only** (accepted by `src/directive/parser.ts:93`, absent from `NuanceCodeSchema` `src/config/schema.ts:34-42` — config-file validation rejects what the gateway parser accepts).
- ⛔ **`gb` appears nowhere in `src/` and must never be used.** Any key containing it fails parsing.
- **Engine gate**: default engine is `legacy` (`src/config/env.ts:51`, `src/config/schema.ts:199`). `v4` runs only via `LITEROUTER_ENGINE=v4` or an `x-literouter-engine: legacy|v4` header when `LITEROUTER_ENGINE_OVERRIDE` is true (`src/config/env.ts:126-140`); the branch is `src/index.ts:414-417`. `/v1/traces` is v4-only — a `404` there means the gateway is running legacy, not that tracing is broken ([directive-grammar.md §11](directive-grammar.md#11-engine-selection-v4-only-routes)).

| Top 10 Key | Target Client / Workflow | Model Example | Wire & Behavior |
|---|---|---|---|
| `lr-zn-oa-ch-no` | OpenCode 2 (Zen Free) | `big-pickle`, `hy3-free` | OpenAI Chat Completions ➔ Zen with OpenCode headers & key rotation |
| `lr-zn-oo-rs-no` | OpenCode 2 (Zen Responses) | `muse-spark-1.3-contributor-free` | Native Responses API passthrough via `@ai-sdk/openai` (`POST /v1/responses`) |
| `lr-or-oa-ch-no` | OpenCode 2 (OpenRouter) | `liquid/lfm-2.5-2.6b:free` | Standard OpenAI Chat with agentic harness headers |
| `lr-nv-oa-ch-ts` | OpenCode 2 (NVIDIA NIM) | `nvidia/nemotron-3-super-120b-a12b` | NIM Chat with thinking chunks preserved (`ts`) |
| `lr-or-cl-ms-no` | Claude Code (via OpenRouter) | `anthropic/claude-3.7-sonnet` | Anthropic Messages API passthrough to OpenRouter |
| `lr-an-cl-ms-no` | Claude Code (Direct Anthropic) | `claude-3-7-sonnet-20250219` | Direct Anthropic Messages API with key rotation |
| `lr-gg-gg-gc-no` | Google Native v1beta (`@ai-sdk/google`) | `gemini-flash`, `gemini-flash-lite` | Direct Google REST forwarder for `/v1beta/models/*` + Native Google Fusion cascades |
| `lr-gg-gg-g1-no` | Google Native v1 (`@ai-sdk/google`) | `gemini-2.5-flash`, `gemini-2.5-pro` | Direct Google REST forwarder for `/v1/models/*`, preserves query params (`?alt=sse`) & streams via SSE |
| `lr-nv-oa-ch-no` | Pydantic AI / Python SDK | `deepseek-ai/deepseek-r1` | High-throughput HTTP/2 binary multiplexed chat completions |
| `lr-gc-oa-ch-no` | GCP Vertex AI (Gemma) | `gemma-4-31b-it` | Vertex AI Chat Completions with 30 RPM pacer & zero-cost guardrail |
| `lr-or-ao-ch-dp` | Dots / Open-Weights XML Tools | `dots-studio/dots-3-note-preview:free` | Anthropic-to-OpenAI cross-wire with XML tool & thinking extraction |

Fusion presets: `lr-fse-<preset>` where preset is ONLY one of `quad` / `pydn` / `fast` / `deep` (verified on disk in `config/fusion.json`). `smart` / `code` / `cheap` do not exist — see [directive-grammar.md §7](directive-grammar.md#7-fusion-presets-lr-fse-) and [config-schemas.md §1](config-schemas.md#1-configfusionjson).

## §5. Wire & Compatibility Rules (summary)

- **OpenCode Reasoning Filter**: strips `delta.reasoning_content` for OpenCode clients by default (SQLite bloat shield 40k ➔ 300k). `ts` keeps thinking, `sb` force-strips for all clients.
- **Zen Bare Model Rule**: Zen models NEVER accept `zen/` prefix — always bare names (`big-pickle`, `hy3-free`).
- **Responses vs Chat Endpoint Match**: `-rs-` directive to `/v1/chat/completions` or `-ch-` to `/v1/responses` → immediate `HTTP 400` ([directive-grammar.md §8](directive-grammar.md#8-endpoint-mismatch-400-rules)).
- **Agentic Attribution**: loaded from `config/providers.json`; hot-reloaded via `POST /reset` ([config-schemas.md §3.2](config-schemas.md#32-headers-registry-static-per-provider-headers)).
- **Native Google Fusion Chains**: `gemini-flash` cascades `3.8 ➔ 3.7 ➔ 3.6 ➔ 3.5`; `gemini-flash-lite` cascades `3.5 ➔ 3.1` ([config-schemas.md §1.2](config-schemas.md#12-native_chains-google-native-cascades), [§1.3](config-schemas.md#13-nativetierindices-sticky-position-for-native-cascades)).
- **Payload rule**: `oa` scrubs / `oo` preserves — keyed off payload segment, not provider ([error-action-matrix.md §2](error-action-matrix.md#2-retry-quarantine-call-chain-wiring)).
- **Engine-conditional fusion**: under the `v4` engine the native cascade is decided by `classifyFailure` (`src/engine/strategies/native_cascade.ts:82-102`) — `404` → `advance_target`, `429`/`5xx` → `retry_same_target`, anything else → `fail_fast` ([fusion.md §1.5b](fusion.md#15b-v4-engine-mapping-nativecascadestrategy)); engine selection is [directive-grammar.md §11](directive-grammar.md#11-engine-selection-v4-only-routes).
- **Google Native (gg) v4 Path Model Extraction, Stream Action Preservation & Query Passthrough**: In Engine v4 (`src/handlers/v4/google_native.ts`, `src/engine/strategies/native_cascade.ts`), `normalizeGoogleNativeModel`, `extractModelFromPath`, and `buildGoogleNativeUpstreamUrl` are removed — dead v3 code. Model name is raw passthrough from request body. `resolveUpstreamEndpoint("gg", endpointKey, model)` drives upstream URL construction. Inbound requests to `/v1beta/models/*` (`gc`) or `/v1/models/*` (`g1`) automatically extract the model identifier from the URL pathname (`/\/(?:v1beta|v1)\/models\/([^:]+)/`) when missing from the body. When the request targets `:streamGenerateContent`, `NativeCascadeStrategy.buildGoogleUrl` preserves the action. Query parameters (`?alt=sse`) are preserved; streamed responses return over SSE (`text/event-stream`).
- **In-Flight Retry-After Backoff (Engine v4)**: When upstream responds with 429 or retryable 5xx with a `Retry-After` header, Engine v4 (`src/engine/dispatch.ts:591-595`) clamps the in-flight pause to `Math.min(retryAfterSec * 1000, 15000)` (up to 15s) before attempting key rotation, avoiding rate-limit hammering without risking client connection timeouts.
- **Elimination of Key #0 in Telemetry**: All key telemetry across `src/telemetry/session.ts` and `src/ui/logger.ts` enforces 1-based indexing (`Key #1` through `Key #N`). During rotation or retries before a target key index is resolved (`toIndex: -1`), telemetry never evaluates `-1 + 1 = 0` or prints `[Key #0]`, cleanly falling back to pool counts (`Pool: Provider (N keys)`) or omitting key index.
- **Fusion Model Telemetry (`formatModelDisplay`)**: When requests route through fusion presets or native cascade chains, terminal telemetry dynamically renders target resolution via `formatModelDisplay(model, resolvedModel?, tier?)` (`src/ui/logger.ts`). Standard requests format as `🤖 [req_id] Model: <model>`, while cascade chains format as `🤖 [req_id] Model: <requested> ➔ <resolved> (Tier <n>)`. State is tracked in `SessionData.resolvedModel` and `SessionData.tier` (`src/telemetry/session.ts`) and populated upon initial target selection and cascade progression hops in `src/engine/dispatch.ts` (`telemetry.setResolvedTarget(model, tier)` and `telemetry.emitResolvedModel()`; see `logger.md §3`).
- **Zero-Hardcoding Configuration & Handler Ground Truth (`config/providers.json`)**: `config/providers.json` is the sole source of truth for all provider operational parameters. All handlers (`openai_compat.ts`, `anthropic_compat.ts`, `openai_original.ts`, `google_native.ts`, `gcp_compat.ts`) look up provider settings directly from `config/providers.json` with zero shadow defaults or hardcoded magic constants. All operational blocks (`provConfig.request_retry`, `provConfig.pacer`, optional `provConfig.key_cooldown` — `.optional()` in Zod, zero runtime behavior) are declared by `ProviderConfigEntrySchema`. No `circuit_breaker` field exists. All retry attempts, bounded jitter delays, and conveyor pacers across all handlers are driven dynamically, eradicating hardcoded whitelists (`['or', 'nv', 'zn', 'gg']`), switch statements, magic numbers (`Math.min(3, ...)`), and hardcoded `isZen` checks. Concurrency and single-flight execution are managed natively via `provConfig.pacer.max_concurrency` (e.g. `zn` configured with `max_concurrency: 1`) rather than isolated handler loops or hardcoded flags. Dead ballast (`limits` rpm/rpd/tpm, fine-grained cooldown knobs, and `max_delay_ms`) has been completely purged.
- **🚨 CRITICAL MANDATE: NEVER DROP OPENCODE SESSION ID INJECTION**:
  - Outbound requests MUST always carry `session-id` (and `x-session-id`) formatted as `ses_` + 26 alphanumeric characters (`generateOpenCodeSessionId()` in `src/engine/session_id.ts`).
  - If an inbound client request provides a session ID (`session-id`, `x-session-id`, `x-opencode-session-id`), it MUST be preserved.
  - If missing (e.g. Pydantic evals, curl, test suites, non-OpenCode runtimes), `ensureSessionHeaders` MUST synthesize and inject a valid `ses_...` token.
  - Do NOT replace with generic UUIDs (`crypto.randomUUID()`) or drop this helper in future engine refactors.

---

## §6. ⛔ Critical: Zero Key Redaction

**NEVER** edit, sanitize, replace, or overwrite API keys in `.env.local` or `.env`. Never substitute real keys with `<REDACTED>`, `changeme`, or placeholders — this causes `staticValidateKeys` to discard key pools on boot, breaking gateway routing. `.env.local` is write-protected via `protect.sh` (owned by root, mode `644`).

## §7. Environment Architecture (summary)

> 📖 **Full schemas**: [`config-schemas.md` §5](config-schemas.md#5-zod-validators-srcconfigschemats) (Zod validators), [`error-action-matrix.md` §4](error-action-matrix.md#4-env-knob-quick-reference) (env knob reference).

- **`.env.local`** (git-ignored secrets): live upstream API key pools (`OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS`, `ZEN_API_KEYS`, `GOOGLE_API_KEYS`, `GCP_KEYS` / `GCP_API_KEYS`).
- **`.env`** (tracked): operational parameters (port, timeouts, TTFT guards, reasoning defaults, `LITEROUTER_ENGINE` + `LITEROUTER_ENGINE_OVERRIDE`).
- **Purge of Deprecated Provider Env Vars**: All 17 legacy provider-specific operational env vars (`GCP_*`, `ZEN_*`, `OPENROUTER_*`) have been purged from `src/config/env.ts` and `src/config/schema.ts` and cannot shadow `config/providers.json`. Operational settings (`pacer`, `request_retry`, optional `key_cooldown`) reside solely in `config/providers.json`. No `circuit_breaker` config exists.
- **`LITEROUTER_ENGINE` (default `"legacy"`) + `LITEROUTER_ENGINE_OVERRIDE` (default `"false"`)**: `resolveEngine(req)` (`src/config/env.ts:130-140`) returns the env default unless override is enabled **and** a request carries `x-literouter-engine: legacy|v4` — any other value falls back to the env default ([config-schemas.md §7](config-schemas.md#7-literouter_engine-legacy-default-per-request-override-gate)).
- ⚠️ `FUSION_UPSTREAM_URL` / `FUSION_UPSTREAM_URL_NATIVE` are **legacy Python fusion-sidecar env vars** (`docs/swap_env.md`, `docs/Longrunning_Mode.md`) — there is **no `FUSION_UPSTREAM_URL` constant in `src/`**. The TS gateway resolves upstreams from `config/providers.json` via `resolveUpstreamEndpoint()` — throws `[resolveUpstreamEndpoint] Unknown endpoint key "..." for provider "..."` on unknown endpoint key — no silent fallback ([config-schemas.md §4](config-schemas.md#4-fusion_upstream_url-what-it-is-and-is-not)).

## §8. Cooldown & Quarantine Knobs (summary)

> 📖 **Edit → reload workflow**: [`config-schemas.md` §6](config-schemas.md#6-edit-post-reset-hot-reload-workflow). **Retry/quarantine wiring**: [`error-action-matrix.md` §2](error-action-matrix.md#2-retry-quarantine-call-chain-wiring). **Operational governance**: [`config-schemas.md` §3.6](config-schemas.md#36-operational-governance--zero-hardcoding-request_retry-key_cooldown-pacer-circuit_breaker).

| Parameter | Location / Source of Truth | Purpose |
|---|---|---|
| **Rate Limit / Benching (429)** | `config/providers.json` -> `conserve_rules` | Conservation-only benching: only explicit `conserve_rules` bench a key (e.g. OpenRouter daily quota exhaustion until midnight UTC). Generic 429 errors do NOT trigger 65s lockouts. |
| **Auth Errors (401/403)** | Fatal Auth Fail-Fast (`src/network/pool.ts`) | Fatal auth fail-fast: rejected outright to downstream client (`opencode2`, Claude Code) with ZERO retries and zero 24-hour quarantine. |
| **Server Error Cooldown (5xx)** | `config/providers.json` -> `key_cooldown.cooldown_sec` | Quarantine on 500/502/503/504 (default 10s). |
| **No circuit breaker** | Fully excised in v4 — removed from schema/network/engine | No breaker exists; no 503 tripping mechanism |
| **Provider Operational Knobs** | `config/providers.json` (`pacer`, `request_retry`) + optional `key_cooldown` (`.optional()` in Zod, zero runtime behavior) | Sole source of truth across all 13 providers. Handlers look up settings directly with zero shadow defaults. All 17 legacy provider env vars purged. |
| **Strict Boot Validation** | `src/config/providers.ts` / `src/index.ts` | `validateProviderConfigsFailLoud()` aborts on missing/invalid blocks with `process.exit(1)`. |

### Rate Limits, Conveyor Belt Architecture & In-Flight Concurrency
- **Purged Dead Ballast**:
  - `limits` (`rpm`, `rpd`, `tpm`) has been completely purged from provider schemas and `config/providers.json` (removing the retired Zdist relic). Upstream LLM rate limits are dynamic leaky buckets with clock drift, rendering local preemptive tracking counterproductive.
  - **No circuit breaker**: Fully excised in v4. No circuit breaker concept exists in schema, network layer, engine, or any handler.
  - Fine-grained `key_cooldown` knobs (`initial_cooldown_ms`, `backoff_factor`, `max_consecutive_failures`) and `max_delay_ms` are purged.
- **Single FIFO Conveyor Pipe (`src/network/pacer.ts`)**:
  - **Dedicated Conveyor Pipe per Provider**: Every provider has its own dedicated conveyor pipe (`RequestPacer`) with `max_queue_depth: 500`. Cross-provider contention is strictly isolated (e.g. Zen requests never block OpenRouter or Google requests).
  - **Strict Spacing by `min_delay_ms`**: All inbound requests and retries share the same conveyor belt. `scheduleDrain()` computes a **per-dispatch random interval** between `min_delay_ms` and `max_delay_ms` (`PacerConfig.maxDelayMs` wired from `providers.json` via `getPacerForProvider()`) on every drain call — not a fixed minimum.
  - **Clean Client Dequeuing via `AbortSignal`**: Downstream client cancellation cleanly dequeues waiting requests via `AbortSignal` without memory leaks.
  - **NO Isolated Mini-Retries & Deadlock Prevention**: Retries do not sit in disconnected sleep loops that bypass queue ordering. Every retry attempt: (1) releases pacer lease, (2) sleeps `request_retry.delay` jitter, (3) re-acquires the pacer before next dispatch. No retry bypasses the pacer queue. When an attempt encounters a retryable failure (e.g. 429 or 5xx), it **immediately releases its concurrency lease** (`pacerLease.release()`) before the retry backoff sleeps, preventing conveyor head-of-line deadlock.
  - **Active In-Flight Stream Lease Tracking (`maxConcurrency`)**: Requests hold their concurrency lease until the response stream terminates (EOF `done: true`, reader error, or client `cancel()`), enforcing real concurrency bounds directly at the conveyor (e.g. Zen `max_concurrency: 1`). For non-streaming requests, the lease releases upon upstream completion.
  - **Elimination of Edge Double-Pacing**: Edge gateway pacing (`acquireIngressPacer` in `src/index.ts`) was completely removed. Requests flow directly into handler-level conveyor belts, eliminating redundant edge pauses and latency penalties.
- **Fatal Auth Fail-Fast (401/403)**:
  - On HTTP 401 (Unauthorized) or 403 (Forbidden), LiteRouter rejects outright and returns the error directly to the downstream client (`opencode2`, Claude Code, etc.) with ZERO retries and zero 24-hour quarantine.
- **Conservation-Only Benching**:
  - The only mechanism that benches a key is explicit `conserve_rules` in `config/providers.json` (e.g. OpenRouter daily quota exhaustion until midnight UTC). Generic 429 errors do NOT trigger 65s lockouts.
- **Handler Ground Truth**:
  - All handlers (`openai_compat`, `openai_original`, `anthropic_compat`, `google_native`, `gcp_compat`) query `config/providers.json` directly for provider capabilities and settings, with zero shadow defaults, hardcoded whitelists, or magic constants.

After editing `.env`: `bash scripts/restart.sh`. After editing `config/providers.json`: `POST /reset` hot-reloads without restart ([scripts-ops.md §3.2](scripts-ops.md#32-hot-reload-scope-configprovidersjson-headers-included)).

## §9. Gateway Resilience (summary table)

> 📖 Each row links to the file carrying the full mechanism. Error semantics: [`error-action-matrix.md` §1](error-action-matrix.md#1-status-action-matrix) + [§2](error-action-matrix.md#2-retry-quarantine-call-chain-wiring). File index: [§3](error-action-matrix.md#3-full-repo-file-index).

| # | Mechanism | One-line summary | Full detail |
|---|---|---|---|
| 1 | Inbound Dual ALPN (`https://localhost:7766`) | HTTP/2 for binary-multiplexed clients + HTTP/1.1-TLS for Node clients, same port | `architecture.md` |
| 2 | Error classification & key rotation (`classifyUpstreamError`) | Fatal auth fail-fast on 401/403 (zero retry, zero quarantine, immediate client rejection); conservation-only benching via explicit `conserve_rules` (no 65s generic 429 lockouts); in-flight retry driven by `providers.json` | [error-action-matrix.md §1](error-action-matrix.md#1-status-action-matrix) |
| 3 | Network/transport resilience (`NoResponseError`) | Pre-stream socket/TCP-RST/GOAWAY/timeout wrapped, retried ≤3 | [error-action-matrix.md §2](error-action-matrix.md#2-retry-quarantine-call-chain-wiring) |
| 4 | Deterministic fail-fast | 400 context/schema/safety + 404 abort without burning keys | [error-action-matrix.md §1](error-action-matrix.md#1-status-action-matrix) |
| 5-8 | TTFT guard (5s) / Idle guard (120s) / HTTP timeout (300s) / SSE keepalive (2s/15s) / Ghost guard / Cache sanitizer | Stall protection + keepalive frames + 0-token 200 rejection + `prompt_cache_*` strip | [error-action-matrix.md §4](error-action-matrix.md#4-env-knob-quick-reference) |
| 10 | Mid-stream error interceptor + auto-resend | In-band 5xx/socket-reset/EOF → isolate key, resend into open downstream stream | `architecture.md` |
| 11 | H2 staggered pool + anti-pinning aging (`h2_pool.ts`) | Persistent H2 sessions, least-loaded balancing, 180s±15s drain aging, GOAWAY handling | `http2-lifecycle-stream-isolation.md` |
| 12 | Provider-isolated FIFO conveyor belt & active concurrency pacer (`pacer.ts`) | Dedicated conveyor pipe per provider (`max_queue_depth: 500`), spaced strictly by `min_delay_ms`, shared by initial calls and retries, `AbortSignal` clean dequeue without memory leaks | [error-action-matrix.md §4](error-action-matrix.md#4-env-knob-quick-reference) |
| 13 | No circuit breaker (v4 excised) | Fully removed; no breaker mechanism in schema/network/engine | [error-action-matrix.md §2](error-action-matrix.md#2-retry-quarantine-call-chain-wiring) |
| 14 | OpenCode reasoning filter + bloat shield | Strips reasoning deltas for `opencode*` clients; control-char healing; `content: null` delete; throttled empty-delta heartbeats | `opencode2-reasoning-scrubber.md` |
| 15 | OpenCode2 auto-patcher (`opencode2_autopatch.sh`) | Sub-5ms idempotent CLI self-heal, integrated into `~/.local/bin/opencode2` | [scripts-ops.md §1.5](scripts-ops.md#15-scriptsopencode2_autopatchsh-opencode2-cli-self-heal-idempotent) |
| 16 | Two-leg streaming (`docs/Fix_Streaming_01.md`) | Zero-cutoff ingress conveyor + resilient replay on upstream drops | `opencode2-streaming-troubleshooting.md` |
| 17 | XML tool calling + trapped thinking (`dots.ts`) | Live `<think>` streaming, pre-thinking tool extraction (GLM/Qwen/DeepSeek/JSON-in-XML), tool-history compaction | `architecture.md` |
| 18 | Tool-reasoning retention + outbound scrubbing | Scrub conversational turns; **preserve reasoning on tool-call turns** (else upstream 500) | `opencode2-reasoning-scrubber.md` |
| 19-21 | GCP operational knobs (`config/providers.json`) | Governed via `gc` operational blocks (`pacer`, `request_retry`, optional `key_cooldown`); legacy env toggles purged | [config-schemas.md §3.6](config-schemas.md#36-operational-governance--zero-hardcoding-request_retry-key_cooldown-pacer-circuit_breaker) |
| 22 | OpenRouter harness headers | `HTTP-Referer`/`X-Title`/`User-Agent` from `providers.json`, hot-reloaded via `/reset` | `openrouter-handling-spec.md` |
| 23 | Zen identity gating + bare models | OpenCode identity headers + client session forwarding (`MissingSessionID` fix); never `zen/` prefix | `zen-provider.md` |
| 24 | NVIDIA NIM EOL catalog | Strict `410 Gone` sunsets; flagship `nemotron-3-super-120b-a12b`; `ts` nuance for `reasoning_content`-only streams | [error-action-matrix.md §1](error-action-matrix.md#1-status-action-matrix) |
| 25-26 | Responses translation + `oo` native handler | `lr-*-oa-rs-*` bidirectional translation; `lr-*-oo-rs-*` verbatim passthrough (`openai_original.ts`) | `payload.md` |
| 27 | Client `chunkTimeout: 30000` | Matches `LITEROUTER_STREAM_IDLE_TIMEOUT=30` | `opencode2-streaming-troubleshooting.md` |
| 28-30 | Zen operational knobs (`config/providers.json`) | Governed via `zn` operational blocks (`strategy: standard`, `max_concurrency: 1`, `pacer`, `request_retry`); legacy env toggles and hardcoded `isZen` checks purged | [config-schemas.md §3.6](config-schemas.md#36-operational-governance--zero-hardcoding-request_retry-key_cooldown-pacer-circuit_breaker) |
| 31 | v4 boundary: pure handlers + transport reassembly | Handlers orchestrate; `fetcher.ts` owns H2/TTFT/reassembly; `[Upstream: HTTP/2]` tagging | `http2-lifecycle-stream-isolation.md` |
| 32 | Payload wire matrix (`oa` scrubs / `oo` preserves) | Keyed off payload segment; `ts` keeps / `sb` forces | `payload.md` |

## §10. Connection Diagnostics (summary)

> 📖 **Full ops**: [`scripts-ops.md`](scripts-ops.md) — lifecycle ([§1](scripts-ops.md#1-gateway-lifecycle-scripts-scripts)), health ([§2](scripts-ops.md#2-get-health-liveness-probe-no-auth-any-method)), reset ([§3](scripts-ops.md#3-post-reset-hard-reset-no-auth-any-method-hot-reload-scope)), diagnostics ([§4](scripts-ops.md#4-diagnostics-scriptsdoctorts-scriptsdoctor_znts)), Zen probing ([§5](scripts-ops.md#5-zen-probing-scriptsdoctor_znts-session-contract)), runbooks ([§6](scripts-ops.md#6-operator-runbooks-copy-paste)).

```bash
curl -sk https://localhost:7766/health | jq .
ss -tan '( sport = :7766 or dport = :7766 )'
```

TTFT lines tag upstream wire explicitly: `🟢 [TTFT req_id] TTFT = 320ms | Stream established [Upstream: HTTP/2]`. Telemetry contract (icons, `Ref` lookup, USAGE emitters): `logger.md`.

## §11. Directive & Routing Index

Canonical grammar companion — read it before guessing any key:

| Need | Pointer |
|---|---|
| Key shapes (`lr-*` strict 5-part form) | [directive-grammar.md §1](directive-grammar.md#1-key-shapes) |
| Provider codes (13, incl. `tp` tests-only) | [directive-grammar.md §2](directive-grammar.md#2-provider-codes-13) |
| Payload/wire codes (6, `oa` scrubs / `oo` preserves) | [directive-grammar.md §3](directive-grammar.md#3-payload-wire-codes-6) |
| Completion/endpoint codes (10, `g1` slot not nuance) | [directive-grammar.md §4](directive-grammar.md#4-completion-endpoint-codes-10) |
| Nuance codes (8, `+` compound; `lg` parser-only; `gb` must-never-use) | [directive-grammar.md §5](directive-grammar.md#5-nuance-codes-8-compoundable-with-) |
| Top-10 keys with handler `file:line` + why | [directive-grammar.md §6](directive-grammar.md#6-top-10-keys-expanded-handler-why) |
| Fusion presets `lr-fse-*` (`quad/pydn/fast/deep` only) | [directive-grammar.md §7](directive-grammar.md#7-fusion-presets-lr-fse-) |
| Endpoint-mismatch 400 rules | [directive-grammar.md §8](directive-grammar.md#8-endpoint-mismatch-400-rules) |
| Dispatch order cheat-sheet | [directive-grammar.md §9](directive-grammar.md#9-dispatch-order-cheat-sheet) |
| Quick validity checks | [directive-grammar.md §10](directive-grammar.md#10-quick-validity-checks) |
| Engine selection & v4-only routes (`legacy` default, override gate, `/v1/traces`) | [directive-grammar.md §11](directive-grammar.md#11-engine-selection-v4-only-routes) |

## §12. Config & Schemas Index

Canonical config companion — every `config/` file and its validator:

| Need | Pointer |
|---|---|
| `fusion.json` overview (presets + native chains) | [config-schemas.md §1](config-schemas.md#1-configfusionjson) |
| Presets (OpenAI-compat sticky fallback) | [config-schemas.md §1.1](config-schemas.md#11-presets-openai-compat-sticky-fallback) |
| `native_chains` (Google cascades) | [config-schemas.md §1.2](config-schemas.md#12-native_chains-google-native-cascades) |
| `nativeTierIndices` sticky positions | [config-schemas.md §1.3](config-schemas.md#13-nativetierindices-sticky-position-for-native-cascades) |
| Validation gap (no `fusion.schema.json` on disk; `native_chains` fail-open) | [config-schemas.md §1.4](config-schemas.md#14-validation-gap-verified-on-disk) |
| `models.json` catalog | [config-schemas.md §2](config-schemas.md#2-configmodelsjson-legacy-advertisement-only-catalog-not-a-serving-gate) |
| `providers.json` registry (providers + headers + endpoints + strategies + ground truth) | [config-schemas.md §3](config-schemas.md#3-configprovidersjson-providers-headers-registry) |
| Providers on disk (name → code → base_url → strategy) | [config-schemas.md §3.1](config-schemas.md#31-providers-on-disk-name-code-base_url-strategy) |
| Headers registry (static per-provider headers) | [config-schemas.md §3.2](config-schemas.md#32-headers-registry-static-per-provider-headers) |
| Endpoints (completion-code → path) | [config-schemas.md §3.3](config-schemas.md#33-endpoints-completion-code-path) |
| Limits (`rpm` / `rpd` / `tpm`) — **PURGED** | Dead ballast purged from schemas & `providers.json` (Zdist relic eradicated) |
| Conservation rules (`conserve_rules`) | Sole benching mechanism for daily quota exhaustion (e.g. OpenRouter midnight UTC) |
| `strategy` registry (fail-fast throw on unknown) | [config-schemas.md §3.5](config-schemas.md#35-strategy-registry-fail-fast-on-unknown-strategy) |
| Provider operational knobs (`request_retry`, `pacer`, optional `key_cooldown`) & boot validation (`validateProviderConfigsFailLoud()`); `circuit_breaker` and `limits` fully removed | [config-schemas.md §3.6](config-schemas.md#36-operational-governance--zero-hardcoding-request_retry-key_cooldown-pacer-circuit_breaker) |
| `FUSION_UPSTREAM_URL` legacy-Python note (not a TS constant) | [config-schemas.md §4](config-schemas.md#4-fusion_upstream_url-what-it-is-and-is-not) |
| Zod validators (`src/config/schema.ts`) | [config-schemas.md §5](config-schemas.md#5-zod-validators-srcconfigschemats) |
| Edit → `POST /reset` hot-reload workflow | [config-schemas.md §6](config-schemas.md#6-edit-post-reset-hot-reload-workflow) |
| `LITEROUTER_ENGINE` legacy default + per-request override gate | [config-schemas.md §7](config-schemas.md#7-literouter_engine-legacy-default-per-request-override-gate) |

> ⚠️ `config/fusion.json` declares `"$schema": "./fusion.schema.json"`, but **no such file exists in the repo** — the pointer is informational only. Do not link or reference it as a file.

## §13. Scripts, Ops & Error-Action Index

| Need | Pointer |
|---|---|
| Gateway lifecycle scripts (`start`/`status`/`stop`/`restart`/`autopatch`) | [scripts-ops.md §1](scripts-ops.md#1-gateway-lifecycle-scripts-scripts) |
| `start.sh` (idempotent) | [scripts-ops.md §1.1](scripts-ops.md#11-scriptsstartsh-start-idempotent) |
| `status.sh` (exit-coded) | [scripts-ops.md §1.2](scripts-ops.md#12-scriptsstatussh-status-exit-coded) |
| `stop.sh` (SIGINT → SIGTERM → SIGKILL) | [scripts-ops.md §1.3](scripts-ops.md#13-scriptsstopsh-stop-sigint-sigterm-sigkill) |
| `restart.sh` (stop → start) | [scripts-ops.md §1.4](scripts-ops.md#14-scriptsrestartsh-restart-stop-start) |
| `opencode2_autopatch.sh` (CLI self-heal) | [scripts-ops.md §1.5](scripts-ops.md#15-scriptsopencode2_autopatchsh-opencode2-cli-self-heal-idempotent) |
| `GET /health` liveness probe (no auth) | [scripts-ops.md §2](scripts-ops.md#2-get-health-liveness-probe-no-auth-any-method) |
| `POST /reset` hard reset (no auth) + hot-reload scope | [scripts-ops.md §3](scripts-ops.md#3-post-reset-hard-reset-no-auth-any-method-hot-reload-scope) |
| Reset exact semantics (`SYSTEM_MAP`) | [scripts-ops.md §3.1](scripts-ops.md#31-exact-semantics-srcindexts61-79-system_map) |
| Hot-reload scope (`providers.json` headers included; port rebind needs restart) | [scripts-ops.md §3.2](scripts-ops.md#32-hot-reload-scope-configprovidersjson-headers-included) |
| Auth-gated `POST /admin/pool/reset` | [scripts-ops.md §3.3](scripts-ops.md#33-auth-gated-variant-post-adminpoolreset) |
| Diagnostics (`doctor.ts` + `doctor_zn.ts`) | [scripts-ops.md §4](scripts-ops.md#4-diagnostics-scriptsdoctorts-scriptsdoctor_znts) |
| Zen session probing contract | [scripts-ops.md §5](scripts-ops.md#5-zen-probing-scriptsdoctor_znts-session-contract) |
| Operator runbooks (copy-paste) | [scripts-ops.md §6](scripts-ops.md#6-operator-runbooks-copy-paste) |
| Status → action matrix (429/4xx/5xx/transport) | [error-action-matrix.md §1](error-action-matrix.md#1-status-action-matrix) |
| Retry / quarantine call chain (wiring) | [error-action-matrix.md §2](error-action-matrix.md#2-retry-quarantine-call-chain-wiring) |
| Full repo file index (`handlers`/`network`/`transformers`/`config`/`fusion`/`directive`) | [error-action-matrix.md §3](error-action-matrix.md#3-full-repo-file-index) |
| Env knob quick reference | [error-action-matrix.md §4](error-action-matrix.md#4-env-knob-quick-reference) |
| Model capability probe (`probe_model.ts`) | [scripts-ops.md §4.3](scripts-ops.md#43-universal-model-capability-probe-scriptsprobe_modelts) |

## §13.5. Model Onboarding & Readiness Probing Protocol (`scripts/probe_model.ts`)

When asked to **"onboard <model> and test"** or **"verify if <model> is ready for OpenCode 2 / Claude Code / Pydantic"**:

### 1. Mandatory Execution Command
```bash
bun run scripts/probe_model.ts <model_name> [--directive <directive_key>] [--url <gateway_url>]
```
*(Default directive: `lr-or-oa-ch-no`, default URL: `https://localhost:7766/v1/chat/completions`)*

### 2. Rigorous Multi-Tier Audit Scope
1. **OpenCode 2 Agentic Tool-Calling**:
   - **4-Tool Realistic Palette**: Tests tool discrimination among `read_file`, `write_file`, `execute_command`, and `grep_search`. Verifies model does not confuse argument signatures or hallucinate wrong tool invocations.
   - **Streaming SSE Chunk Evaluation**: Measures TTFT and duration; checks for zero XML tag leakage (`<tool_call>`, `<invoke>`); verifies stream finishes on `finish_reason: "tool_calls"`.
   - **Turn 2 (Observation Ingestion)**: Feeds executed tool output (`role: "tool"`); verifies upstream accepts the multi-turn exchange and synthesizes results.
   - **Turn 3 (Error Injection & Fault Tolerance)**: Injects an explicit tool execution error (e.g., `EACCES: permission denied`); verifies the model acknowledges the failure and recovers gracefully instead of hanging or looping.
2. **Claude Code CLI & Anthropic Messages API (`/v1/messages`)**:
   - Tests `/v1/messages` compatibility with Anthropic directive key `lr-or-cl-ms-no`.
   - Validates native Anthropic `tool_use` JSON block generation (`name`, `input.file_path`).
   - Asserts zero leaked XML tags (`<dots_function_call>`, `<invoke>`) in response content blocks.
   - Verifies multi-turn tool observations via `role: "user"` with `type: "tool_result"` blocks.
3. **Pydantic AI V2 Complex Schema Validation**:
   - **Test A (Native Structured Outputs `output_type=Model`)**:
     - Sends `response_format: {"type": "json_object"}` containing nested models (`metadata`), string enums (`system_status`), strictly typed integers (`cluster_nodes`, `code`), and arrays of sub-objects (`alerts`).
     - Performs strict programmatic validation against the schema.
   - **Test B (Prompted Fallback with Downstream Fence Stripping `_strip_json_fences`)**:
     - Tests whether complex schemas can be extracted via prompt instructions without native `response_format` (for providers like Novita that reject `json_object` with HTTP 400).
     - Validates markdown fence stripping and deep schema compliance.

### 3. Agent Decision Matrix for Onboarding
- **If OpenCode 2 Tool-Calling Passes (Score ≥ 80)**:
  - Model is certified for OpenCode 2 autonomous loops (`lr-or-oa-ch-no`).
- **If Claude Code CLI Passes**:
  - Model is certified for Anthropic Claude Code CLI (`lr-or-cl-ms-no` over `/v1/messages`).
- **If Pydantic Native Passes (HTTP 200 + 100% Schema Valid)**:
  - Model is certified for native Pydantic AI `Agent(output_type=Model)` without workarounds.
- **If Pydantic Native Fails (HTTP 400 or schema invalid)**:
  - Check Prompted Schema Conformance:
    - If Prompted passes: Instruct client to prompt for text and use downstream fence stripping (`_strip_json_fences`) in Python rather than passing `output_type=Model`.
    - If Prompted fails: Mark model as REJECTED for structured data workloads.

## §14. Topic Map — Read These Files for Details

| Topic | File | When to read it |
|---|---|---|
| **Directive grammar (full `lr-*` matrix, validity, dispatch, engine gate)** | `directive-grammar.md` (§11) | User asks about any directive key, provider/payload/completion/nuance code, `gb`/`g1`/`tp`/`lg`, fusion preset names, 400 mismatch errors, engine selection, or `/v1/traces` 404s |
| **Config schemas (`fusion.json`, `models.json`, `providers.json`, Zod)** | `config-schemas.md` (§12) | User asks about config files, headers registry, endpoints, limits, provider strategies, engine env, `FUSION_UPSTREAM_URL`, or edit→reset workflow |
| **Scripts & ops (lifecycle, `/health`, `/reset`, doctor, runbooks)** | `scripts-ops.md` (§13) | User asks about `start/stop/restart`, health, reset scope, `doctor.ts`/`doctor_zn.ts`, Zen probing, or operator runbooks |
| **Tmux pane hygiene (clear rubbish, `getcwd`, quiet boot)** | `tmux-hygiene.md` (§0) | User asks about tmux rubbish, `shell-init`/`getcwd`/`chdir` noise, typed-command echo, blank pane fill, `clear-history`, or quiet `start.sh` boot |
| **Error → action matrix (status, wiring, file index, env knobs)** — **S5 grilled decisions (ky12)** | `error-action-matrix.md` (§13) | User asks about 429/5xx/401/403/408 handling, retry/quarantine wiring, typed `error_type` parser (3 skins), `providers.json` `request_retry`, zero-quarantine 403, condensed terminal format |
| **LiteRouter master architecture, in-memory engine, keys, endpoints & directives** | `architecture.md` | Complete system design, in-memory vs Redis/Valkey ("We choose not to") rationale, routing matrix, compatibility layers, resilience mechanics |
| **Zen provider (identity gating, sessions, directives, toggles, Responses API, Muse reasoning)** | `zen-provider.md` | User asks about Zen, `zn`, `big-pickle`, `muse-spark-1.3-contributor-free`, OpenAI Responses API (`/v1/responses`), `reasoningEffort` options, session-id forwarding, Zen directive keys, or Zen retry/quarantine toggles |
| **Fusion setup, Native Google Fusion chains (`gemini-flash`, `gemini-flash-lite`) & virtual presets (`quad`, `pydn`, `fast`, `deep`)** | `fusion.md` | User asks about Fusion multi-tier routing, native cascades, `nativeTierIndices`, sticky fallback caching, `config/fusion.json`, `FusionEngine`, v4 `classifyFailure` mapping, or execution plans |
| **Doctor diagnostics & health probes (`doctor.ts`, `doctor_zn.ts`)** | `doctor.md` | User asks about key health probes, upstream diagnostics, status codes, or provider probe errors |
| **Claude Code integration** | `claude-code.md` | User asks about Claude Code, Anthropic Messages API, `ANTHROPIC_BASE_URL`, or routing Claude Code through LiteRouter |
| **OpenCode2 integration** | `opencode2-playbook.md` | User asks about OpenCode2, V2 plugins, `~/.config/opencode2/`, or V1/V2 isolation |
| **OpenCode2 streaming troubleshooting** | `opencode2-streaming-troubleshooting.md` | User asks about deep-reasoning streaming hangs, Zod `content: null` breakdown, `network_error` crashes, or streaming diagnostics |
| **OpenCode2 reasoning scrubber** | `opencode2-reasoning-scrubber.md` | User asks about outbound reasoning scrubbing, token bloat, `<think>` collapsing, or live streaming observability |
| **Payload wire & scrubbing matrix (`oa` vs `oo`)** | `payload.md` | User asks about `oa` vs `oo` wire, reasoning scrub vs passthrough, `rs` routing, or which Zen key preserves CoT replay |
| **Antigravity proxy** | `antigravity.md` | User asks about remote Antigravity services (`agy-gemini`, `agy-claude`), ZeroTier nodes, or Google Native RPC |
| **Google Native Forwarder (H2 pooling, Free Tier rotation, `@ai-sdk/google`)** | `google-native.md` | User asks about Google Native, `lr-gg-gg-gc-no`, `lr-gg-gg-g1-no`, Google v1 / v1beta endpoints, `@ai-sdk/google`, `/v1beta/models/*`, `/v1/models/*`, or H2 pooling to `generativelanguage.googleapis.com` |
| **Setup & configuration** | `setup.md` | User asks about installing, configuring, env vars, providers.json, config/models.json, fusion.json, or TLS certs |
| **Setup checklist** | `setup_checklist.md` | Pre-flight verification of gateway health, key pools, and config integrity |
| **Troubleshooting** | `troubleshoot.md` | User reports an error, gateway behaving unexpectedly, or needs diagnostic procedures |
| **Tenacity & pacing testing** | `tenacity-test.md` | User asks about client resilience, Tenacity retry strategies, Retry-After headers, key rotation math, or probe scripts |
| **HTTP/2 lifecycle & stream isolation** | `http2-lifecycle-stream-isolation.md` | User asks about `nodeReq`/`nodeRes` lifecycle, client abort propagation, stream isolation, H2 pooling, anti-pinning aging, or transport resets |
| **H2 transport (inbound ALPN + outbound pool, knobs, `/health` stats)** | `h2-transport.md` (§1–§7) | User asks about ALPN negotiation, `h2_pool.ts` lifecycle, pacer→H2 flow, per-key isolation, H2 tuning knobs, GOAWAY/drain, or why gRPC/H3/WS are out of scope |
| **OpenRouter rate limits, reasoning & tool calling** | `openrouter-handling-spec.md` | User asks about OpenRouter 429s, credit limits (402), mid-stream in-band errors, keepalives, or reasoning/tool-call retention |
| **Terminal telemetry & logger contract** | `logger.md` | User reports missing/misaligned terminal lines, timestamp issues, fusion model telemetry (`formatModelDisplay`), or needs telemetry in `src/ui/logger.ts` |
| **TUI LaTeX & math rendering** | `tui-latex-math-rendering.md` (§16) | User asks about raw LaTeX math, broken math in ASCII tables, TUI vs Webview rendering, or OpenCode2 math formatting |
| **Antigravity IDE setup (LiteRouter wiring)** | `agy-ide-setup.md` (§16) | User asks about connecting Antigravity IDE to LiteRouter or verifying IDE→gateway connectivity |
| **Test suite hygiene, air-gap & test parking** | `test-hygiene-playbook.md` (§16) | User asks about writing tests, test hygiene, airgap, mock responses, simulation banners, bun test, or pytest |
| **GC & memory bounds (no explicit GC, restart policy)** | `gc-memory.md` (§16) | User asks about garbage collection, memory leaks, bounded state, or periodic restarts |

## §15. Grounded Corrections (verified vs disk — must-read before editing keys/config)

1. **`gb` must never be used.** It appears nowhere in `src/`; any key containing it fails parsing ([directive-grammar.md §5](directive-grammar.md#5-nuance-codes-8-compoundable-with-)).
2. **`g1` is a completion-code slot, not a nuance** ([directive-grammar.md §4](directive-grammar.md#4-completion-endpoint-codes-10)). Never place it in the nuance segment. Maps to Google v1 API (`lr-gg-gg-g1-no` -> `/v1/models/{model}:generateContent` / `:streamGenerateContent?alt=sse`).
3. **`tp` is a tests-only loopback double** (`http://127.0.0.1:8999`) — never use outside unit tests ([directive-grammar.md §2](directive-grammar.md#2-provider-codes-13)).
4. **`lg` parser/schema discrepancy**: accepted by the gateway parser (`src/directive/parser.ts:93`) but absent from `NuanceCodeSchema` (`src/config/schema.ts:34-42`) — config-file validation rejects what the parser accepts ([directive-grammar.md §5](directive-grammar.md#5-nuance-codes-8-compoundable-with-)).
5. **Fusion presets are ONLY `quad` / `pydn` / `fast` / `deep`** (verified keys of `config/fusion.json`). `smart` / `code` / `cheap` do not exist ([directive-grammar.md §7](directive-grammar.md#7-fusion-presets-lr-fse-)).
6. **No `fusion.schema.json` on disk.** The `$schema` pointer inside `config/fusion.json` is informational only; never link it as a file ([config-schemas.md §1.4](config-schemas.md#14-validation-gap-verified-on-disk)).
7. **`FUSION_UPSTREAM_URL` is a legacy Python sidecar env var, not a TS constant** (zero hits in `src/`) — see [config-schemas.md §4](config-schemas.md#4-fusion_upstream_url-what-it-is-and-is-not).
8. **`POST /reset` is auth-gated and hot-reloads caches but cannot rebind ports** — requires `Bearer <LITEROUTER_AUTH_KEY>` or valid directive token. `GET /health` is public. Port/host/TLS changes are governed by `config/location.json` and require `bash scripts/restart.sh` to rebind the socket ([scripts-ops.md §3](scripts-ops.md#3-post-reset-hard-reset-no-auth-any-method-hot-reload-scope)).
9. **Pure In-Memory Architecture (Zero Redis/Valkey Dependency)**: LiteRouter deliberately chooses NOT to use Redis, Valkey, or `Bun.redis` for core state. Single-threaded non-preemptive event-loop atomicity, `RequestPacer` FIFO burst smoothing, <0.05ms RAM lookups, and zero external failure domains eliminate external daemon baggage for single-instance gateways (see `architecture.md` §1 & `docs/ARCHITECTURE.md` §2.4).
10. **`config/providers.json` is the sole source of truth for provider operational knobs across all 13 providers.** Required: `pacer`, `request_retry`. Optional (zero runtime behavior in v4): `key_cooldown` (`.optional()` in Zod schema, carries no runtime behavior). `circuit_breaker` and `limits` are fully removed. Missing or invalid required blocks abort gateway startup (`validateProviderConfigsFailLoud()`). All 17 legacy provider-specific operational env vars (`GCP_*`, `ZEN_*`, `OPENROUTER_*`) have been purged.
11. **Purged Dead Ballast**: `limits` (`rpm`, `rpd`, `tpm`) has been completely purged from provider schemas and `config/providers.json` (removing the retired Zdist relic). Fine-grained `key_cooldown` knobs (`initial_cooldown_ms`, `backoff_factor`, `max_consecutive_failures`) and `max_delay_ms` are purged.
12. **No circuit breaker in v4**: Fully excised. No `circuit_breaker` config, no 503 tripping mechanism, no safe pass-through — the concept has been removed from schema, network layer, engine, and all handlers.
13. **Single Dedicated FIFO Conveyor Pipe**: Every provider has its own dedicated conveyor pipe (`RequestPacer`) with `max_queue_depth: 500`. All inbound requests and retries share the same conveyor belt, spaced strictly by `min_delay_ms`. Downstream client cancellation cleanly dequeues waiting requests via `AbortSignal` without memory leaks.
14. **Fatal Auth Fail-Fast (401/403)**: On HTTP 401 (Unauthorized) or 403 (Forbidden), LiteRouter rejects outright and returns the error directly to the downstream client (`opencode2`, Claude Code, etc.) with ZERO retries and zero 24-hour quarantine.
15. **Conservation-Only Benching & Handler Ground Truth**: The only mechanism that benches a key is explicit `conserve_rules` in `config/providers.json` (e.g. OpenRouter daily quota exhaustion until midnight UTC). Generic 429 errors do not trigger 65s lockouts. All handlers (`openai_compat`, `openai_original`, `anthropic_compat`, `google_native`, `gcp_compat`) query `config/providers.json` directly with zero shadow defaults or hardcoded magic constants.

## §16.5. Bun v1.4.2 Runtime & Optimization Guidelines

> **Target Version**: Bun v1.4.2+ (upgraded from v1.4.0). All runtime claims below are verified capabilities of the v1.4.2 JSC/Bun runtime, not aspirational features.

### Native HTTP/2 in `Bun.serve`
- **ALPN-negotiated HTTP/2 + HTTP/1.1 on the same port**. Bun v1.4.2 resolves the TLS ALPN negotiation conflict (`TLS alert: no application protocol`) via native `Bun.serve({ tls: true })` with dual ALPN (`h2` / `http/1.1`).
- **Replaces legacy polyfills**: Eliminates manual `node:http2` / `createSecureServer` polyfills previously required in TLS mode. No manual chunk buffering — `Bun.serve` streams natively over negotiated protocols.
- **Architectural impact**: `h2_pool.ts` can rely on persistent multiplexed H2 upstream sessions (`https://generativelanguage.googleapis.com`) without maintaining separate TLS sockets per protocol version. Inbound dual-ALPN (port 7766) is native, not simulated.

### JIT Idle Memory Reclamation
- **Automatic flushing of JIT-compiled bytecode** during idle periods drops long-running daemon RSS by ~35–40%. This complements the bounded in-memory state (trace ring, pacer queue, H2 session rotation).
- **Proactive `Bun.gc(true)`**: Call on explicit cache resets (`POST /reset` clears cooldowns, H2 pools, trace buffers) or during large flush events. Currently zero explicit GC in `scripts/start.sh` (see `gc-memory.md`); with v1.4.2, `Bun.gc(true)` is safe to inject on `/reset` handlers or periodic flush cycles without blocking the event loop.
- **Memory contract unchanged**: No external Redis/Valkey dependency; bounded state remains the primary leak-defense. JIT reclamation is a secondary, not primary, bound.

### Streaming `Bun.write` (Direct-to-Disk)
- **Native direct-to-disk streaming** from `Response`, `Request`, or `ReadableStream` objects without RAM double-buffering. Replaces manual `stream.pipe(fs.createWriteStream(...))` patterns where applied.
- **Gateway usage context**: For diagnostic logs, trace dumps (`src/telemetry/trace_writer.ts`), or response caching to disk, `Bun.write(path, stream)` avoids allocating an intermediate `Buffer` array that would double memory for large streaming payloads.

### Hardened Array GC & Concurrency

> **S5 Error Taxonomy Note (literouter-ky12)** — Grilled decisions recorded in `CHANGELOG.md` (Unreleased S5) and `error-action-matrix.md`: (1) 401/403 fail-fast canonical (zero retry, zero quarantine, aligned legacy+v4); (2) 403 zero-quarantine (`key_cooldown.enabled: false`, no `CooldownManager.quarantineKey`); (3) 408 retry_rotate driven by `providers.json` `request_retry` schedule (no hardcoded `Retry-After: 5`); (4) full typed `error_type` parser supporting 3 skins (`standard`, `legacy`, `v4`) with `error_type` winning over raw `status`, conservation-first (`conserve_rules` overrides generic 429); (5) condensed terminal format (`error_type=<type> status=<code> action=<action>`) with full telemetry trace (`session-id`, `key_index`, `provider_code`, `request_retry_ref`). Docs-only; no `.env*` or `src/` edits.
- **Fixed concurrent GC array mutations** (`shift` / `splice`) that previously caused race-related array corruption during high-throughput token bucket pacing.
- **Fixed `AsyncLocalStorage` leaks** that destabilized in-flight request queues and session tracking across concurrent H2 multiplexed streams.
- **Architectural impact**: `RequestPacer` (`max_queue_depth: 500`, strict `min_delay_ms` spacing), in-flight retry queues, and `h2_pool.ts` session rotation are now safe under concurrent GC cycles. No additional synchronization locks are required in v4 — rely on single-threaded non-preemptive event-loop atomicity plus v1.4.2 GC hardening.

### Faster Core `require()` (Lazy-Loaded Native Modules)
- **Lazy-loaded `node:fs`**, `node:http`, etc. via faster `require()` internals. Reduces cold-start overhead for module imports in `src/handlers/`, `src/network/`, `src/engine/`.
- **Architectural impact**: Gateway boot time (`scripts/start.sh`) and `/reset` hot-reload latency benefit from faster module resolution; no code changes needed.

### Native `crypto.argon2` & WebSocket Control
- **Native `crypto.argon2`**: Available in Bun v1.4.2 runtime for any future key-derivation or token-hashing requirements (e.g., session ID derivation, auth token rotation). No dependency on `node:crypto` polyfill needed.
- **WebSocket `.pause()` / `.resume()`**: Native WebSocket stream control methods. If future gateway extensions add WebSocket endpoints (e.g., real-time trace streaming, agentic bi-directional channels), `.pause()` / `.resume()` provide backpressure control without manual `ReadableStream` wrappers.
- **Current scope**: LiteRouter v4 does not expose WebSocket endpoints; these are documented as available primitives for future extensions.

### Verification References
- Runtime: `package.json` → `engines.bun` (target `>=1.4.2`).
- ALPN / TLS: `.env` (`LITEROUTER_TLS_ENABLED`, `LITEROUTER_HTTP2`), `src/index.ts` (dual-ALPN server init), `h2-transport.md`.
- GC / memory: `gc-memory.md` (bounded state, `POST /reset` scope), `CHANGELOG.md` (v1.4.0 upgrade notes).
- Streaming / disk: `docs/streaming-fix.md`, `src/network/fetcher.ts`.
- Array / concurrency: `src/network/pacer.ts`, `src/network/h2_pool.ts`, `src/network/cooldown.ts`.

## §16. Appendix — Lazy Pointers (load only on topic match)

- **TUI LaTeX & math rendering**: [tui-latex-math-rendering.md](tui-latex-math-rendering.md) — overview ([§1](tui-latex-math-rendering.md#1-executive-overview-rendering-environments)), raw-math root cause ([§2](tui-latex-math-rendering.md#2-root-cause-of-raw-math-artifacts-in-tui)), upstream tracking ([§3](tui-latex-math-rendering.md#3-upstream-opencode-github-tracking)), mitigations ([§5](tui-latex-math-rendering.md#5-recommended-engineering-practices-mitigations)).
- **Antigravity IDE setup (LiteRouter wiring only)**: [agy-ide-setup.md](agy-ide-setup.md) — architecture ([§1](agy-ide-setup.md#1-antigravity-ide-architecture)), connecting to LiteRouter ([§2](agy-ide-setup.md#2-connecting-antigravity-ide-to-literouter)), verifying connectivity ([§3](agy-ide-setup.md#3-verifying-connectivity)).
- **Test suite hygiene & test parking (Zero-LLM hermetic testing)**: [test-hygiene-playbook.md](test-hygiene-playbook.md) — architecture & air-gap ([§2](test-hygiene-playbook.md#2-architecture-the-air-gap-barrier)), parking taxonomy ([§3](test-hygiene-playbook.md#3-parking-taxonomy-where-new-tests-belong)), simulation banners ([§4](test-hygiene-playbook.md#4-test-simulation-transparency-banner-rule)), anti-context-bloat ([§5](test-hygiene-playbook.md#5-anti-context-bloat--silent-truncation-prevention)), teardown symmetry ([§6](test-hygiene-playbook.md#6-state-teardown--anti-flake-symmetry)), pytest live gate ([§7](test-hygiene-playbook.md#7-pytest-integration-gate-live)).
- **GC & memory bounds (no explicit GC, restart policy)**: [gc-memory.md](gc-memory.md) — bounded state ([§1](gc-memory.md#1-bounded-state-where-gc-lives)), manual reset ([§2](gc-memory.md#2-manual-reset-in-process-gc)), restart policy ([§3](gc-memory.md#3-periodic-restart-no)).
- **Canonical IDE skill (cross-skill)**: `../agy-ide-playbook/SKILL.md` — IDE install/upgrade/config is owned there ([Quick Start & Commands](../agy-ide-playbook/SKILL.md#quick-start-commands), [User-Space Mandate](../agy-ide-playbook/SKILL.md#-critical-architecture-mandate-user-space-first-no-sudo), [Installation & Upgrade Protocol](../agy-ide-playbook/SKILL.md#installation-upgrade-protocol-step-by-step)). LiteRouter-side proxy wiring stays in `agy-ide-setup.md`; do not duplicate IDE procedures here.

## §27. Canonical Session Identity Preservation & Upstream Invariant

- **Mandatory Invariant**: All inbound handlers (`openai_compat.ts`, `openai_original.ts`, `anthropic_compat.ts`) and outbound dispatchers MUST use `ensureSessionHeaders` from `src/engine/session_id.ts`.
- **Normalization Contract**: All 6 client session headers (`session-id`, `x-session-id`, `x-opencode-session`, `x-opencode-session-id`, `opencode-session-id`, `opencode-session`) MUST always normalize into upstream `session-id`.
- **Upstream Gateway Dependency**: Upstream gateways (like Zen `opencode.ai/zen/v1`) track usage and free-tier access strictly via `session-id`. If stripped or overwritten, requests show as `[EMPTY]` on provider dashboards or fail with `MissingSessionID`.
- **Refactoring Guardrail**: Future LLM code modifications MUST NEVER strip, ad-hoc loop, or drop `ensureSessionHeaders` when refactoring handlers or building upstream headers.

