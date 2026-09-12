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

## §1. Quick Reference

| Action | Command |
|---|---|
| Start gateway | `bash scripts/start.sh` |
| Check status | `bash scripts/status.sh` |
| Stop gateway | `bash scripts/stop.sh` |
| Restart gateway | `bash scripts/restart.sh` |
| Health probe (auth-free) | `curl -sk https://localhost:7766/health` |
| Hard key reset (auth-free) | `curl -sk -X POST https://localhost:7766/reset` |
| Unit tests (all) | `bun test` |
| Fast gateway unit tests | `bun run test:gateway` (`tests/unit`, 938 tests, no eval noise) |
| Benchmark eval grader tests | `bun run test:eval` (`tests/eval`, 182 tests) |
| Legacy dual-path fallback tests | `bun run test:legacy` (`tests/unit/legacy`, 179 tests) |
| Anti-bloat failure runner | `bun run test:failures` (`bun test --only-failures`) |
| Diagnostics | `bun run scripts/doctor.ts` (JSON schema + live upstream key probes for Google, NVIDIA, OpenRouter, Zen, GCP) |
| Master Model Evaluation Gauntlet | `bun run eval/eval.ts <model_name>` (orchestrates speed, code & web, outputs markdown report card; reasoning-transcript appendix default-ON via `ts`-nuance key, opt-out `--no-reasoning-transcript`) |
| Coding & Agentic Benchmark | `bun run eval/code.ts <model_name>` (5-stage wire, pydantic, loop, str_replace & injection audit; dual Chat/Responses) |
| Web Frontend Evaluation | `bun run eval/web.ts <model_name>` (5-stage DOM structure, responsive, React state, hygiene & a11y audit) |
| Model probe & onboarding | `bun run scripts/probe_model.ts <model_name>` (validates OpenCode 2, Claude Code CLI & Pydantic AI) |
| Model speed & throughput | `bun run eval/speed.ts` (measures TTFT, duration, tokens/sec; alias: `scripts/bench_speed.ts`) |
| OpenCode2 Auto-Patch | `bash scripts/opencode2_autopatch.sh` (fast <5ms self-heal & binary verification) |
| Typecheck & lint | `bun run typecheck` && `uv run ruff check .` |

> Auth scope: `GET /health` and `POST /reset` perform **no auth check and no method check** — see [scripts-ops.md §2](scripts-ops.md#2-get-health-liveness-probe-no-auth-any-method) and [§3](scripts-ops.md#3-post-reset-hard-reset-no-auth-any-method-hot-reload-scope). The authenticated variant is `POST /admin/pool/reset` ([§3.3](scripts-ops.md#33-auth-gated-variant-post-adminpoolreset)).

## §2. Active Key Pools (summary)

> 📖 **Full registry**: [`config-schemas.md` §3](config-schemas.md#3-configprovidersjson-providers-headers-registry) (providers, headers, endpoints, limits, strategies — §3.1 is the single source of truth for name → code → base_url → strategy).

| Provider | Code | Environment Variable | Upstream Target | Strategy |
|---|---|---|---|---|
| **OpenRouter** | `or` | `OPENROUTER_API_KEYS` | `https://openrouter.ai` | `standard` |
| **NVIDIA NIM** | `nv` | `NVIDIA_API_KEYS` | `https://integrate.api.nvidia.com` | `standard` |
| **Google AI Studio** | `gg` | `GOOGLE_API_KEYS` | `https://generativelanguage.googleapis.com` | `native_cascade` |
| **Zen** | `zn` | `ZEN_API_KEYS` | `https://opencode.ai/zen` | `zen_single_flight` |
| **Google Cloud (GCP)** | `gc` | `GCP_KEYS` / `GCP_API_KEYS` | `https://generativelanguage.googleapis.com` | `gcp_guarded` |

*Validation*: Discards tokens `< 4` chars or matching `changeme`, `todo`, `undefined`, `null`. Non-destructive mock keys injected during unit tests.

## §3. Core Inbound Endpoints & Handlers

| Inbound Method & Path | Handler Source File | Handler Function | Directives / Notes |
|---|---|---|---|
| `POST /v1/chat/completions` | `src/handlers/openai_compat.ts` | `handleOpenAICompat` | `lr-*-oa-ch-*`, `lr-*-ao-ch-*`. Full streaming & key rotation. |
| `POST /v1/messages`<br>`POST /messages` | `src/handlers/anthropic_compat.ts` | `handleAnthropicCompat` | `lr-*-cl-ms-*`. Native Claude Code integration. |
| `POST /v1/responses` | `src/handlers/openai_original.ts` | `handleOpenAiOriginal` | `lr-*-oo-rs-*`. Native OpenAI Responses API passthrough. |
| `POST /v1beta/models/*:generateContent`<br>`POST /v1beta/models/*:streamGenerateContent` | `src/handlers/google_native.ts`<br>(v4: `src/handlers/v4/google_native.ts`) | `handleGoogleNative`<br>(v4: `handleV4GoogleNative`) | `lr-gg-gg-gc-no`. Direct Gemini REST for `@ai-sdk/google`. In v4, extracts model from path and preserves `:streamGenerateContent` action. |
| `POST /v1beta/openai/*` | `src/handlers/gcp_compat.ts` / `google_native.ts` | `handleGcpCompat` / `handleGoogleOpenAIBeta` | `lr-gc-oa-ch-no`. GCP Vertex AI OpenAI-compatible route. |
| `GET /v1/models`, `/v1beta/models` | `src/handlers/discovery.ts` | `handleModelsDiscovery` | Advertises models from `models.json` (legacy, advertisement-only) & `fusion.json`; serving is dynamic passthrough, never registry-gated. |
| `GET /health`, `/hello` | `src/index.ts` | `handleHealthCheck` | Auth-free liveness probe (uptime, circuit breakers, H2 pool stats). |
| `POST /reset` | `src/index.ts` | `handleHardReset` | Auth-free hard reset; hot-reloads `config/providers.json` headers — **cannot rebind port** (restart for port/host/cert changes). |

## §4. Directive Key Grammar (summary)

> 📖 **Full matrix**: [`directive-grammar.md`](directive-grammar.md) — shapes ([§1](directive-grammar.md#1-key-shapes)), providers ([§2](directive-grammar.md#2-provider-codes-13)), wires ([§3](directive-grammar.md#3-payload-wire-codes-6)), endpoints ([§4](directive-grammar.md#4-completion-endpoint-codes-10)), nuances ([§5](directive-grammar.md#5-nuance-codes-8-compoundable-with-)), top-10 ([§6](directive-grammar.md#6-top-10-keys-expanded-handler-why)), fusion presets ([§7](directive-grammar.md#7-fusion-presets-lr-fse-)), 400 rules ([§8](directive-grammar.md#8-endpoint-mismatch-400-rules)), dispatch order ([§9](directive-grammar.md#9-dispatch-order-cheat-sheet)), validity checks ([§10](directive-grammar.md#10-quick-validity-checks)), engine gate ([§11](directive-grammar.md#11-engine-selection-v4-only-routes)).

Format: `lr-<provider>-<payload>-<completion>-<nuance>`
- **Providers**: `or`, `nv`, `gg`, `zn`, `gc`, `oa`, `an`, `gq`, `cb`, `ds`, `ms`, `tg` (+ `tp` tests-only loopback double — never use outside unit tests).
- **Payload (wire)**: `oa` (OpenAI, scrubs reasoning), `oo` (Responses native, preserves), `cl` (Anthropic), `ao` (Anthropic→OpenAI cross-wire), `gg` (Google), `rs` (Responses translated).
- **Completion (endpoint)**: `ch`, `ms`, `rs`, `gc`, `ob`, `em`, `md` (+ map-only codes `g1`, `im`, `au` — `g1` is a **completion-code slot, not a nuance**).
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
| `lr-gg-gg-gc-no` | Google Native (`@ai-sdk/google`) | `gemini-flash`, `gemini-flash-lite` | Direct Google REST forwarder + Native Google Fusion cascades |
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
- **Google Native (gg) v4 Path Model Extraction & Action Preservation**: In Engine v4 (`src/handlers/v4/google_native.ts`, `src/engine/strategies/native_cascade.ts`), inbound requests to `/v1beta/models/*` or `/v1/models/*` automatically extract the model identifier from the URL pathname (`/\/(?:v1beta|v1)\/models\/([^:]+)/`) when missing from the body. Furthermore, if the request targets `:streamGenerateContent`, `NativeCascadeStrategy.buildGoogleUrl` preserves the `:streamGenerateContent` RPC action instead of falling back to `:generateContent`.
- **In-Flight Retry-After Backoff (Engine v4)**: When upstream responds with 429 or retryable 5xx with a `Retry-After` header, Engine v4 (`src/engine/dispatch.ts:591-595`) clamps the in-flight pause to `Math.min(retryAfterSec * 1000, 15000)` (up to 15s) before attempting key rotation, avoiding rate-limit hammering without risking client connection timeouts.
- **Elimination of Key #0 in Telemetry**: All key telemetry across `src/telemetry/session.ts` and `src/ui/logger.ts` enforces 1-based indexing (`Key #1` through `Key #N`). During rotation or retries before a target key index is resolved (`toIndex: -1`), telemetry never evaluates `-1 + 1 = 0` or prints `[Key #0]`, cleanly falling back to pool counts (`Pool: Provider (N keys)`) or omitting key index.
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
- **`.env`** (tracked): operational parameters (port, timeouts, TTFT guards, reasoning defaults, GCP/Zen/OpenRouter retry/quarantine/breaker/pacer toggles, `COOLDOWN_RATE_LIMIT_TTL_SEC`, `LITEROUTER_ENGINE` + `LITEROUTER_ENGINE_OVERRIDE`).
- **`LITEROUTER_ENGINE` (default `"legacy"`) + `LITEROUTER_ENGINE_OVERRIDE` (default `"false"`)**: `resolveEngine(req)` (`src/config/env.ts:130-140`) returns the env default unless override is enabled **and** a request carries `x-literouter-engine: legacy|v4` — any other value falls back to the env default ([config-schemas.md §7](config-schemas.md#7-literouter_engine-legacy-default-per-request-override-gate)).
- ⚠️ `FUSION_UPSTREAM_URL` / `FUSION_UPSTREAM_URL_NATIVE` are **legacy Python fusion-sidecar env vars** (`docs/swap_env.md`, `docs/Longrunning_Mode.md`) — there is **no `FUSION_UPSTREAM_URL` constant in `src/`**. The TS gateway resolves upstreams from `config/providers.json` via `resolveUpstreamEndpoint()` — see [config-schemas.md §4](config-schemas.md#4-fusion_upstream_url-what-it-is-and-is-not).

## §8. Cooldown & Quarantine Knobs (summary)

> 📖 **Edit → reload workflow**: [`config-schemas.md` §6](config-schemas.md#6-edit-post-reset-hot-reload-workflow). **Retry/quarantine wiring**: [`error-action-matrix.md` §2](error-action-matrix.md#2-retry-quarantine-call-chain-wiring).

| Parameter | Location in `.env` | Purpose |
|---|---|---|
| **Rate Limit Cooldown (TTL)** | `COOLDOWN_RATE_LIMIT_TTL_SEC=<sec>` | 429 quarantine duration without `Retry-After`. `0` disables. Consumer: `src/network/cooldown.ts`. |
| **Server Error Cooldown (5xx)** | `COOLDOWN_SERVER_ERROR_TTL_SEC=<sec>` | Quarantine on 500/502/503/504 (default 10s). |
| **Auth Error Cooldown (401/403)** | `COOLDOWN_AUTH_ERROR_TTL_SEC=<sec>` | Tiered 300s/1800s/86400s (`src/network/classifier.ts`). |
| **OpenRouter Quarantine** | `OPENROUTER_ENABLE_QUARANTINE=<true\|false>` | `false` bypasses all quarantine for `or` keys (`src/network/pool.ts`). |
| **Zen Quarantine / Retries / Breaker / Pacer** | `ZEN_ENABLE_QUARANTINE`, `ZEN_ENABLE_RETRIES`, `ZEN_ENABLE_CIRCUIT_BREAKER`, `ZEN_ENABLE_PACER` | Dumb-forwarder mode when retries+quarantine are `false`. |
| **GCP Quarantine / Retries / Breaker / Pacer** | `GCP_ENABLE_QUARANTINE`, `GCP_ENABLE_RETRIES`, `GCP_ENABLE_CIRCUIT_BREAKER`, `GCP_ENABLE_PACER` | Same semantics for `gc` keys. |

### Rate Limits & Pacing (Zdist Retirement)
- **Zdist Retired**: Preemptive client-side RPM/RPD tracking (`RateLimitTracker` / `zdist.ts`) was formally retired in v4.1 (see `docs/GRAVEYARD/ZDIST.md`). Upstream LLM rate limits are dynamic leaky buckets with clock drift, rendering local preemptive rotation counterproductive.
- **Active Architecture**: Replaced by **Pacer Conveyor** (`RequestPacer` in `src/network/pacer.ts` spacing ingress requests by `min_delay_ms`) to prevent burst limits, paired with **CooldownManager** (`src/network/cooldown.ts` reactive 429 quarantine with `Retry-After` header extraction and fallback TTL).

After editing `.env`: `bash scripts/restart.sh`. After editing `config/providers.json`: `POST /reset` hot-reloads without restart ([scripts-ops.md §3.2](scripts-ops.md#32-hot-reload-scope-configprovidersjson-headers-included)).

## §9. Gateway Resilience (summary table)

> 📖 Each row links to the file carrying the full mechanism. Error semantics: [`error-action-matrix.md` §1](error-action-matrix.md#1-status-action-matrix) + [§2](error-action-matrix.md#2-retry-quarantine-call-chain-wiring). File index: [§3](error-action-matrix.md#3-full-repo-file-index).

| # | Mechanism | One-line summary | Full detail |
|---|---|---|---|
| 1 | Inbound Dual ALPN (`https://localhost:7766`) | HTTP/2 for binary-multiplexed clients + HTTP/1.1-TLS for Node clients, same port | `architecture.md` |
| 2 | Error classification & key rotation (`classifyUpstreamError`) | In-flight retry ≤3 across keys; 429 dynamic / 5xx 10s / 401-403 tiered / fail-fast 400-404 | [error-action-matrix.md §1](error-action-matrix.md#1-status-action-matrix) |
| 3 | Network/transport resilience (`NoResponseError`) | Pre-stream socket/TCP-RST/GOAWAY/timeout wrapped, retried ≤3 | [error-action-matrix.md §2](error-action-matrix.md#2-retry-quarantine-call-chain-wiring) |
| 4 | Deterministic fail-fast | 400 context/schema/safety + 404 abort without burning keys | [error-action-matrix.md §1](error-action-matrix.md#1-status-action-matrix) |
| 5-8 | TTFT guard (5s) / Idle guard (120s) / HTTP timeout (300s) / SSE keepalive (2s/15s) / Ghost guard / Cache sanitizer | Stall protection + keepalive frames + 0-token 200 rejection + `prompt_cache_*` strip | [error-action-matrix.md §4](error-action-matrix.md#4-env-knob-quick-reference) |
| 10 | Mid-stream error interceptor + auto-resend | In-band 5xx/socket-reset/EOF → isolate key, resend into open downstream stream | `architecture.md` |
| 11 | H2 staggered pool + anti-pinning aging (`h2_pool.ts`) | Persistent H2 sessions, least-loaded balancing, 180s±15s drain aging, GOAWAY handling | `http2-lifecycle-stream-isolation.md` |
| 12 | Token-bucket pacer / ingress conveyor (`pacer.ts`) | `minIntervalMs` 2000ms `gg`/`gc`, 500ms others; gateway-edge ingress + handler mid-stream pacing | [error-action-matrix.md §4](error-action-matrix.md#4-env-knob-quick-reference) |
| 13 | Provider circuit breaker (3-state: 5-in-60s → OPEN 30s → HALF_OPEN 2 probes) | `CLOSED`/`OPEN`/`HALF_OPEN` per provider; 503 `breaker_open` (probe-cap, no `Retry-After`) vs `circuit_breaker_open` (OPEN reject, with `Retry-After`) | [error-action-matrix.md §2](error-action-matrix.md#2-retry-quarantine-call-chain-wiring) + [taxonomy](error-action-matrix.md#taxonomy-breaker_open-vs-circuit_breaker_open-vs-pacer-overflow) |
| 14 | OpenCode reasoning filter + bloat shield | Strips reasoning deltas for `opencode*` clients; control-char healing; `content: null` delete; throttled empty-delta heartbeats | `opencode2-reasoning-scrubber.md` |
| 15 | OpenCode2 auto-patcher (`opencode2_autopatch.sh`) | Sub-5ms idempotent CLI self-heal, integrated into `~/.local/bin/opencode2` | [scripts-ops.md §1.5](scripts-ops.md#15-scriptsopencode2_autopatchsh-opencode2-cli-self-heal-idempotent) |
| 16 | Two-leg streaming (`docs/Fix_Streaming_01.md`) | Zero-cutoff ingress conveyor + resilient replay on upstream drops | `opencode2-streaming-troubleshooting.md` |
| 17 | XML tool calling + trapped thinking (`dots.ts`) | Live `<think>` streaming, pre-thinking tool extraction (GLM/Qwen/DeepSeek/JSON-in-XML), tool-history compaction | `architecture.md` |
| 18 | Tool-reasoning retention + outbound scrubbing | Scrub conversational turns; **preserve reasoning on tool-call turns** (else upstream 500) | `opencode2-reasoning-scrubber.md` |
| 19-21 | GCP toggles (`GCP_ENABLE_RETRIES/QUARANTINE/CIRCUIT_BREAKER/PACER`) | `false`+`false` = transparent dumb forwarder for `gc` | [config-schemas.md §5](config-schemas.md#5-zod-validators-srcconfigschemats) |
| 22 | OpenRouter harness headers | `HTTP-Referer`/`X-Title`/`User-Agent` from `providers.json`, hot-reloaded via `/reset` | `openrouter-handling-spec.md` |
| 23 | Zen identity gating + bare models | OpenCode identity headers + client session forwarding (`MissingSessionID` fix); never `zen/` prefix | `zen-provider.md` |
| 24 | NVIDIA NIM EOL catalog | Strict `410 Gone` sunsets; flagship `nemotron-3-super-120b-a12b`; `ts` nuance for `reasoning_content`-only streams | [error-action-matrix.md §1](error-action-matrix.md#1-status-action-matrix) |
| 25-26 | Responses translation + `oo` native handler | `lr-*-oa-rs-*` bidirectional translation; `lr-*-oo-rs-*` verbatim passthrough (`openai_original.ts`) | `payload.md` |
| 27 | Client `chunkTimeout: 30000` | Matches `LITEROUTER_STREAM_IDLE_TIMEOUT=30` | `opencode2-streaming-troubleshooting.md` |
| 28-30 | Zen toggles (mirror 19-21) | Same dumb-forwarder semantics for `zn` | [config-schemas.md §5](config-schemas.md#5-zod-validators-srcconfigschemats) |
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
| `providers.json` registry (providers + headers + endpoints + limits + strategies) | [config-schemas.md §3](config-schemas.md#3-configprovidersjson-providers-headers-registry) |
| Providers on disk (name → code → base_url → strategy) | [config-schemas.md §3.1](config-schemas.md#31-providers-on-disk-name-code-base_url-strategy) |
| Headers registry (static per-provider headers) | [config-schemas.md §3.2](config-schemas.md#32-headers-registry-static-per-provider-headers) |
| Endpoints (completion-code → path) | [config-schemas.md §3.3](config-schemas.md#33-endpoints-completion-code-path) |
| Limits (`rpm` / `rpd` / `tpm`) | [config-schemas.md §3.4](config-schemas.md#34-limits-rpm-rpd-tpm) |
| `strategy` registry (fail-fast throw on unknown) | [config-schemas.md §3.5](config-schemas.md#35-strategy-registry-fail-fast-on-unknown-strategy) |
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
| **Error → action matrix (status, wiring, file index, env knobs)** | `error-action-matrix.md` (§13) | User asks about 429/5xx handling, retry/quarantine wiring, cooldown env knobs, or where a file lives in `src/` |
| **LiteRouter master architecture, in-memory engine, keys, endpoints & directives** | `architecture.md` | Complete system design, in-memory vs Redis/Valkey ("We choose not to") rationale, routing matrix, compatibility layers, resilience mechanics |
| **Zen provider (identity gating, sessions, directives, toggles)** | `zen-provider.md` | User asks about Zen, `zn`, `big-pickle`, `MissingSessionID`, `FreeUsageLimitError`, session-id forwarding, Zen directive keys, or Zen retry/quarantine toggles |
| **Fusion setup, Native Google Fusion chains (`gemini-flash`, `gemini-flash-lite`) & virtual presets (`quad`, `pydn`, `fast`, `deep`)** | `fusion.md` | User asks about Fusion multi-tier routing, native cascades, `nativeTierIndices`, sticky fallback caching, `config/fusion.json`, `FusionEngine`, v4 `classifyFailure` mapping, or execution plans |
| **Doctor diagnostics & health probes (`doctor.ts`, `doctor_zn.ts`)** | `doctor.md` | User asks about key health probes, upstream diagnostics, status codes, or provider probe errors |
| **Claude Code integration** | `claude-code.md` | User asks about Claude Code, Anthropic Messages API, `ANTHROPIC_BASE_URL`, or routing Claude Code through LiteRouter |
| **OpenCode2 integration** | `opencode2-playbook.md` | User asks about OpenCode2, V2 plugins, `~/.config/opencode2/`, or V1/V2 isolation |
| **OpenCode2 streaming troubleshooting** | `opencode2-streaming-troubleshooting.md` | User asks about deep-reasoning streaming hangs, Zod `content: null` breakdown, `network_error` crashes, or streaming diagnostics |
| **OpenCode2 reasoning scrubber** | `opencode2-reasoning-scrubber.md` | User asks about outbound reasoning scrubbing, token bloat, `<think>` collapsing, or live streaming observability |
| **Payload wire & scrubbing matrix (`oa` vs `oo`)** | `payload.md` | User asks about `oa` vs `oo` wire, reasoning scrub vs passthrough, `rs` routing, or which Zen key preserves CoT replay |
| **Antigravity proxy** | `antigravity.md` | User asks about remote Antigravity services (`agy-gemini`, `agy-claude`), ZeroTier nodes, or Google Native RPC |
| **Google Native Forwarder (H2 pooling, Free Tier rotation, `@ai-sdk/google`)** | `google-native.md` | User asks about Google Native, `lr-gg-gg-gc-no`, `@ai-sdk/google`, `/v1beta/models/*`, or H2 pooling to `generativelanguage.googleapis.com` |
| **Setup & configuration** | `setup.md` | User asks about installing, configuring, env vars, providers.json, config/models.json, fusion.json, or TLS certs |
| **Setup checklist** | `setup_checklist.md` | Pre-flight verification of gateway health, key pools, and config integrity |
| **Troubleshooting** | `troubleshoot.md` | User reports an error, gateway behaving unexpectedly, or needs diagnostic procedures |
| **Tenacity & pacing testing** | `tenacity-test.md` | User asks about client resilience, Tenacity retry strategies, Retry-After headers, key rotation math, or probe scripts |
| **HTTP/2 lifecycle & stream isolation** | `http2-lifecycle-stream-isolation.md` | User asks about `nodeReq`/`nodeRes` lifecycle, client abort propagation, stream isolation, H2 pooling, anti-pinning aging, or transport resets |
| **H2 transport (inbound ALPN + outbound pool, knobs, `/health` stats)** | `h2-transport.md` (§1–§7) | User asks about ALPN negotiation, `h2_pool.ts` lifecycle, pacer→H2 flow, per-key isolation, H2 tuning knobs, GOAWAY/drain, or why gRPC/H3/WS are out of scope |
| **OpenRouter rate limits, reasoning & tool calling** | `openrouter-handling-spec.md` | User asks about OpenRouter 429s, credit limits (402), mid-stream in-band errors, keepalives, or reasoning/tool-call retention |
| **Terminal telemetry & logger contract** | `logger.md` | User reports missing/misaligned terminal lines, timestamp issues, or needs telemetry in `src/ui/logger.ts` |
| **TUI LaTeX & math rendering** | `tui-latex-math-rendering.md` (§16) | User asks about raw LaTeX math, broken math in ASCII tables, TUI vs Webview rendering, or OpenCode2 math formatting |
| **Antigravity IDE setup (LiteRouter wiring)** | `agy-ide-setup.md` (§16) | User asks about connecting Antigravity IDE to LiteRouter or verifying IDE→gateway connectivity |
| **Test suite hygiene, air-gap & test parking** | `test-hygiene-playbook.md` (§16) | User asks about writing tests, test hygiene, airgap, mock responses, simulation banners, bun test, or pytest |

## §15. Grounded Corrections (verified vs disk — must-read before editing keys/config)

1. **`gb` must never be used.** It appears nowhere in `src/`; any key containing it fails parsing ([directive-grammar.md §5](directive-grammar.md#5-nuance-codes-8-compoundable-with-)).
2. **`g1` is a completion-code slot, not a nuance** ([directive-grammar.md §4](directive-grammar.md#4-completion-endpoint-codes-10)). Never place it in the nuance segment.
3. **`tp` is a tests-only loopback double** (`http://127.0.0.1:8999`) — never use outside unit tests ([directive-grammar.md §2](directive-grammar.md#2-provider-codes-13)).
4. **`lg` parser/schema discrepancy**: accepted by the gateway parser (`src/directive/parser.ts:93`) but absent from `NuanceCodeSchema` (`src/config/schema.ts:34-42`) — config-file validation rejects what the parser accepts ([directive-grammar.md §5](directive-grammar.md#5-nuance-codes-8-compoundable-with-)).
5. **Fusion presets are ONLY `quad` / `pydn` / `fast` / `deep`** (verified keys of `config/fusion.json`). `smart` / `code` / `cheap` do not exist ([directive-grammar.md §7](directive-grammar.md#7-fusion-presets-lr-fse-)).
6. **No `fusion.schema.json` on disk.** The `$schema` pointer inside `config/fusion.json` is informational only; never link it as a file ([config-schemas.md §1.4](config-schemas.md#14-validation-gap-verified-on-disk)).
7. **`FUSION_UPSTREAM_URL` is a legacy Python sidecar env var, not a TS constant** (zero hits in `src/`) — see [config-schemas.md §4](config-schemas.md#4-fusion_upstream_url-what-it-is-and-is-not).
8. **`POST /reset` hot-reloads `config/providers.json` headers but cannot rebind port** — port/host/cert changes need `bash scripts/restart.sh`. `GET /health` + `POST /reset` are **auth-free** ([scripts-ops.md §3](scripts-ops.md#3-post-reset-hard-reset-no-auth-any-method-hot-reload-scope), [§3.2](scripts-ops.md#32-hot-reload-scope-configprovidersjson-headers-included)).
9. **Pure In-Memory Architecture (Zero Redis/Valkey Dependency)**: LiteRouter deliberately chooses NOT to use Redis, Valkey, or `Bun.redis` for core state. Single-threaded non-preemptive event-loop atomicity, `RequestPacer` FIFO burst smoothing, <0.05ms RAM lookups, and zero external failure domains eliminate external daemon baggage for single-instance gateways (see `architecture.md` §1 & `docs/ARCHITECTURE.md` §2.4).

## §16. Appendix — Lazy Pointers (load only on topic match)

- **TUI LaTeX & math rendering**: [tui-latex-math-rendering.md](tui-latex-math-rendering.md) — overview ([§1](tui-latex-math-rendering.md#1-executive-overview-rendering-environments)), raw-math root cause ([§2](tui-latex-math-rendering.md#2-root-cause-of-raw-math-artifacts-in-tui)), upstream tracking ([§3](tui-latex-math-rendering.md#3-upstream-opencode-github-tracking)), mitigations ([§5](tui-latex-math-rendering.md#5-recommended-engineering-practices-mitigations)).
- **Antigravity IDE setup (LiteRouter wiring only)**: [agy-ide-setup.md](agy-ide-setup.md) — architecture ([§1](agy-ide-setup.md#1-antigravity-ide-architecture)), connecting to LiteRouter ([§2](agy-ide-setup.md#2-connecting-antigravity-ide-to-literouter)), verifying connectivity ([§3](agy-ide-setup.md#3-verifying-connectivity)).
- **Test suite hygiene & test parking (Zero-LLM hermetic testing)**: [test-hygiene-playbook.md](test-hygiene-playbook.md) — architecture & air-gap ([§2](test-hygiene-playbook.md#2-architecture-the-air-gap-barrier)), parking taxonomy ([§3](test-hygiene-playbook.md#3-parking-taxonomy-where-new-tests-belong)), simulation banners ([§4](test-hygiene-playbook.md#4-test-simulation-transparency-banner-rule)), anti-context-bloat ([§5](test-hygiene-playbook.md#5-anti-context-bloat--silent-truncation-prevention)), teardown symmetry ([§6](test-hygiene-playbook.md#6-state-teardown--anti-flake-symmetry)), pytest live gate ([§7](test-hygiene-playbook.md#7-pytest-integration-gate-live)).
- **Canonical IDE skill (cross-skill)**: `../agy-ide-playbook/SKILL.md` — IDE install/upgrade/config is owned there ([Quick Start & Commands](../agy-ide-playbook/SKILL.md#quick-start-commands), [User-Space Mandate](../agy-ide-playbook/SKILL.md#-critical-architecture-mandate-user-space-first-no-sudo), [Installation & Upgrade Protocol](../agy-ide-playbook/SKILL.md#installation-upgrade-protocol-step-by-step)). LiteRouter-side proxy wiring stays in `agy-ide-setup.md`; do not duplicate IDE procedures here.
