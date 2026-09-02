---
name: literouter-playbook
description: LiteRouter API Gateway operational guide for Bun/TypeScript proxy on port 7766. Use when the user asks about LiteRouter, gateway ops, directive keys, provider/model config, routing, fusion presets, Claude Code integration, OpenCode2 integration, Antigravity proxy, setup, or troubleshooting the literouter gateway.
---

# Skill: literouter-playbook

> **Lazy-load skill.** This SKILL.md is the entry point only. When the user's request matches the skill description, load this file first. For deep dives into specific topics, read the referenced markdown files in this directory.

## Quick Reference

| Action | Command |
|---|---|
| Start gateway | `bash scripts/start.sh` |
| Check status | `bash scripts/status.sh` |
| Stop gateway | `bash scripts/stop.sh` |
| Restart gateway | `bash scripts/restart.sh` |
| Health probe | `curl -sk https://localhost:7766/health` |
| Hard key reset | `curl -sk -X POST https://localhost:7766/reset` |
| Unit tests | `bun test` |
| Diagnostics | `bun run scripts/doctor.ts` (JSON schema + live upstream key probes for Google, NVIDIA, OpenRouter, Zen) |
| OpenCode2 Auto-Patch | `bash scripts/opencode2_autopatch.sh` (fast <5ms self-heal & binary verification) |
| Typecheck & lint | `bun x tsc --noEmit && uv run ruff check .` |

## ⛔ Critical: Zero Key Redaction

**NEVER** edit, sanitize, replace, or overwrite API keys in `.env.local` or `.env`. Never substitute real keys with `<REDACTED>`, `changeme`, or placeholders — this causes `staticValidateKeys` to discard key pools on boot, breaking gateway routing. `.env.local` is write-protected via `protect.sh` (owned by root, mode `644`).

## Environment Architecture

- **`.env.local`** (git-ignored secrets): live upstream API key pools (`OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS`, `ZEN_API_KEYS`, `GOOGLE_API_KEYS`)
- **`.env`** (tracked): operational parameters (port, timeouts, TTFT guards, reasoning defaults, GCP retry toggle `GCP_ENABLE_RETRIES`)

## Directive Key Format

All direct directive keys follow the strict 5-part lowercase format:
```
lr-<provider>-<payload>-<completions>-<nuances>
```

| Segment | Codes |
|---|---|
| Provider | `or` (OpenRouter), `nv` (NVIDIA), `gg` (Google), `zn` (Zen), `oa` (OpenAI), `an` (Anthropic), `gq` (Groq), `cb` (Cerebras), `ds` (DeepSeek), `ms` (Mistral), `tg` (Together) |
| Payload (wire) | `oa` (OpenAI), `cl` (Claude/Anthropic), `ao` (Anthropic->OpenAI cross-wire), `gg` (Google), `rs` (Responses) |
| Completion (endpoint) | `ch` (Chat `/v1/chat/completions`), `ms` (Messages `/v1/messages`), `ob` (OpenAI Beta), `gc` (GenerateContent), `em` (Embeddings), `md` (Models discovery) |
| Nuances | `no`, `dp`, `ts`, `sb`, `gm`, `g3`, `tc` (compound with `+`, e.g. `dp+ts`) |

- `ts` (Thinking Support): Explicitly preserves reasoning chunks for OpenCode clients (overrides automatic reasoning stripping).
- `sb` (Strip Budget / Reasoning): Explicitly forces reasoning stream stripping regardless of client.

### Claude Code Routing Rules:
- **Native Claude models on OpenRouter/Anthropic**: Use `lr-or-cl-ms-no` (payload: `cl`, endpoint: `ms`).
- **OpenAI-compat / open-weights models on OpenRouter (e.g. `dots-studio/dots-3-note-preview:free`, DeepSeek, Qwen)**: Use `lr-or-ao-ch-no` (payload: `ao`, endpoint: `ch`). This triggers full bidirectional tool calling and SSE streaming translation into OpenAI Chat Completions without triggering OpenRouter's broken `/api/v1/messages` translator.

Fusion presets: `lr-fse-<preset>` (e.g. `lr-fse-fast`, `lr-fse-smart`, `lr-fse-code`, `lr-fse-cheap`).

## Topic Map — Read These Files for Details

| Topic | File | When to read it |
|---|---|---|
| **Claude Code integration** | `claude-code.md` | User asks about Claude Code, Anthropic Messages API, `ANTHROPIC_BASE_URL`, or routing Claude Code through LiteRouter |
| **OpenCode2 integration** | `opencode2-playbook.md` | User asks about OpenCode2, V2 plugins, `~/.config/opencode2/`, or V1/V2 isolation |
| **OpenCode2 reasoning scrubber** | `opencode2-reasoning-scrubber.md` | User asks about outbound reasoning history scrubbing, token bloat prevention, `<think>` collapsing, or live streaming observability |
| **Antigravity proxy** | `antigravity.md` | User asks about remote Antigravity services (`agy-gemini`, `agy-claude`), ZeroTier nodes, or Google Native RPC |
| **Setup & configuration** | `setup.md` | User asks about installing, configuring, env vars, providers.json, models.json, fusion.json, or TLS certs |
| **Setup checklist** | `setup_checklist.md` | Pre-flight verification of gateway health, key pools, and config integrity |
| **Troubleshooting** | `troubleshoot.md` | User reports an error, gateway behaving unexpectedly, or needs diagnostic procedures |
| **Antigravity IDE setup** | `agy-ide-setup.md` | User asks about installing/configuring/maintaining Google Antigravity IDE in WSL2 |
| **Tenacity & Pacing Testing** | `tenacity-test.md` | User asks about client resilience, Tenacity retry strategies, Retry-After headers, key rotation math, or probe scripts |
| **HTTP/2 Lifecycle & Stream Isolation** | `http2-lifecycle-stream-isolation.md` | User asks about `nodeReq`/`nodeRes` lifecycle, client abort propagation, stream isolation, H2 connection pooling, anti-pinning aging, or 0s quarantine transport resets |
| **OpenRouter Rate Limits, Reasoning & Tool Calling** | `openrouter-handling-spec.md` | User asks about OpenRouter rate limits (429), credit limits (402), mid-stream in-band errors (`finish_reason: "error"`), keepalives, or reasoning/tool-call retention policies |

## Gateway Resilience

1. **Inbound Dual ALPN Protocol Support (`https://localhost:7766`)**: Powered by Bun v1.4.0+, LiteRouter natively negotiates **HTTP/2 (`h2`)** for binary multiplexed streaming clients (Pydantic AI / Python `httpx` with `http2=True`, `curl --http2`) and **HTTP/1.1 over TLS** for Node.js clients (OpenCode2, Claude Code) on the exact same port without SSL handshake or ALPN protocol rejection alerts.
2. **In-Flight Error Classification & Key Rotation (`classifyUpstreamError`)**: Automatically classifies upstream HTTP errors. Retries in-flight up to 3 times across active keys for transient 400 provider errors (0s cooldown), rate limits (dynamic cooldown), exhausted quotas (7d cooldown), 401/403 bad keys (7d cooldown), and 5xx server errors (10s cooldown).
3. **Network & Transport Layer Resilience**: Wraps pre-stream socket failures, TCP resets (TCP RST / `ECONNRESET`), HTTP/2 GOAWAY (`RemoteProtocolError`), and network connection timeouts (`ConnectTimeout` / `ConnectError`) into `NoResponseError`, retrying across pooled keys in-flight (up to 3 attempts) before failing.
4. **Deterministic Fail-Fast**: Immediately aborts retries without burning other keys on deterministic client errors (HTTP 400 context length exceeded, schema/validation errors, safety filters, HTTP 404).
5. **TTFT Guard** (5s): aborts upstream if no verifiable content token arrives, rotates to next key with zero cooldown penalty.
6. **Stream Idle Guard** (120s / 2 mins) & **Max HTTP Timeout** (300s / 5 mins): protects against mid-stream stalls while giving deep-reasoning and large-context models (e.g. `stealth/ox-alpha` on 40k+ context) sufficient thinking leeway without premature socket severance.
7. **SSE Keepalive** (2s/15s): injects comment frames (`: keep-alive\n\n`) to keep client connections active during thinking and long processing pauses.
8. **Ghost Response Guard**: rejects HTTP 200 responses with 0 content tokens.
9. **Client Cache Sanitizer**: strips `prompt_cache_key`/`prompt_cache_retrieval`/`prompt_cache_reset` before upstream dispatch.
10. **Mid-Stream Error Interceptor & Long-Running Auto-Resend**: Detects mid-stream in-band 5xx error chunks (`Server error mid-response. The response above may be incomplete.`), socket resets, and premature EOFs, isolates the failing key (10s/60s), and automatically resends across available keys into the open downstream client stream. Prioritizes long-running harness survival over terminal token purity.
11. **Outbound HTTP/2 Staggered Connection Pool & Anti-Pinning Aging (`src/network/h2_pool.ts`)**: Coalesces concurrent outbound requests into persistent HTTP/2 sessions with single-flight mutexes, least-loaded stream balancing across `sessionsPerOrigin` (4) parallel sockets, and **staggered connection aging (`maxSessionAgeMs = 180s` with $\pm 15\text{s}$ jitter)**. Mitigates the Layer 4 (L4) / HTTP/2 connection pinning trap where single long-lived sockets get hashed to a single upstream load-balancer blade, exhausting local rate-limit token buckets and triggering recurrent `429 Too Many Requests`. When a session reaches its TTL, it enters `isDraining = true`—new requests take fresh TCP sockets with new ephemeral ports and full buckets, while in-flight LLM/SSE streams complete uninterrupted to EOF before `session.close()` is called. Includes emergency overflow synchronization and in-pool `GOAWAY` handling. Falls back to HTTP/1.1 keep-alive on failure.
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

## Connection Diagnostics & Protocol Inspection

- **Inspect Health & Active H2 Pools**:
  ```bash
  curl -sk https://localhost:7766/health | jq .
  ```
- **Real-Time Terminal Protocol Tagging**:
  The TTFT line in live stdout explicitly logs the upstream protocol:
  `🟢 [TTFT req_id] TTFT = 320ms | Stream established [Upstream: HTTP/2]`
- **Inspect OS Sockets**:
  ```bash
  # Downstream client connections (port 7766)
  ss -tan '( sport = :7766 or dport = :7766 )'
  # Upstream persistent TLS/H2 sockets (port 443)
  ss -tanp | grep -E "7766|bun"
  ```
