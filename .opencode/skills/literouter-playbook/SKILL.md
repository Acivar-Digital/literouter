---
name: literouter-playbook
description: LiteRouter API Gateway operational guide for Bun/TypeScript proxy on port 7766.
---

# Skill: literouter-playbook

# LiteRouter API Gateway (High-Density)

## Quick Start & Health
- **Primary Gateway:** Bun (Port 7766)
- **Health Check:** `curl -H "Authorization: Bearer <KEY>" localhost:7766/health`
- **Lifecycle:** `bash scripts/start.sh` (start), `bash scripts/restart.sh` (flush+start), `bash scripts/stop.sh` (clean)
- **Health Probe:** `bun run scripts/doctor.ts` (FYI-only key validation, does NOT gate boot)
- **Logs:** Gateway stdout streams to tmux session `literouter`. For persistent logs, run `bun run src/index.ts 2>&1 | tee -a logs/gateway.log`. Per-request traces are in `logs/traces/` (auto-cleared at boot).

## Architecture Matrix
| Component | Port | Primary Responsibility |
| :--- | :--- | :--- |
| **Bun Gateway** | 7766 | Core Proxy, Fusion logic, Reasoning, Payload cleanup |
| **Valkey** | 6379 | State (Key rotation, Quota buckets, Cooldown ZSETs) |

> **Single Process:** Post-Bun consolidation there is ONE process only — Bun on 7766. The legacy TS proxy (7767) and `fusion.py` sidecar (7768) are GONE. `fusion.json` upstreams point at `localhost:7766`. Both OpenCode native `/v1beta` and pydantic-ai OpenAI-compat `/v1` hit 7766 directly. Source: `src/index.ts`.

## Routing Behaviors
Three request surfaces on 7766, all resolving a model → provider → upstream:

| Incoming path | Handler | Upstream target | Typical client |
| :--- | :--- | :--- | :--- |
| `/v1/chat/completions` (non-Google model) | `executeOpenAICompat` | Provider OpenAI-compat `/chat/completions` (OpenRouter/NVIDIA/Zen) | pydantic-ai, generic OpenAI clients |
| `/v1/chat/completions` (Google model) | `executeOpenAICompat` | **Google OpenAI-compat** `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | Google via OpenAI protocol |
| `/v1beta/models/{model}:{action}` (native) | `executeGoogleNative` | **Google native** `https://generativelanguage.googleapis.com/v1beta/models/{model}:{action}` | OpenCode native `generateContent`/`streamGenerateContent` |

- **Google-via-`/v1` is translated**: the gateway rewrites the OpenAI-format request and forwards to Google's OpenAI-compat endpoint (`/v1beta/openai/...`), NOT the native `generateContent`. Only the `/v1beta/models/...` path hits Google native. (The legacy `/v1beta/openai/chat/completions` gateway alias was removed — `/v1/chat/completions` is the sole OpenAI-compat entry point.)
- **Fusion groups** (`pydantic/google`, `pydantic/nvidia`) arrive on `/v1` and are intercepted by `executeFusion` *before* the OpenAI-compat handler; the group's `upstream` (OpenAI-compat only) decides protocol. `pydantic/google` chains 7 Gemini Flash models starting with `google/gemini-3.5-flash-lite` and `google/gemini-3.1-flash-lite` as top workhorses (Gemma models removed). The native `/v1beta` group `local/google` was removed — see `docs/GRAVEYARD/FUSION_LOCAL_GOOGLE.md`.
- **Payload normalization**: `translateGoogleThinking` runs for Google on the OpenAI-compat path; the native path uses Gemini `contents` format.


## Logic & Fallback Strategy
| Scenario | Logic | Outcome |
| :--- | :--- | :--- |
| **Fusion Chain** | Try N keys (`LITEROUTER_MAX_ATTEMPTS`, def 3), then advance. | **429 / 5xx / 502 / timeout** → Fallback model |
| **Direct Route (quota)** | Per-key consecutive 429/quota errors. | Retry backoff: **65s → 90s → 120s**; grace-retry same key if upstream `reset ≤ 2s` |
| **Cooldown (by error type)** | `reportError` picks TTL; Google floors ANY error at 65s. | 429→65s, timeout/5xx→10s, 401/403→1wk, default→30s; **Google ANY error → 65s** |
| **Circuit Breaker** | Cooldown window active. | Model/key skipped until cooldown clears. |
| **Sticky Fallback** | 300s window. | Requests start at fallback position. |
| **Rotate Floor** | Gap between key attempts on sequential errors (e.g., 429/500). | Controlled by `LITEROUTER_ROTATE_DELAY_MS` (def 10s) or `{PROV}_MIN_DELAY_MS`. Hard minimum floor of **2s** (`MIN_ROTATE_DELAY_MS=2000`); longer if upstream `Retry-After`/`quotaResetDelay` exceeds it |
| **Max Attempts Reached** | When a request fails `LITEROUTER_MAX_ATTEMPTS` times without exhausting all available keys. | Request fails instantly with HTTP 429 ("Max attempts exhausted"), aborting the outer round backoff to prevent infinite downstream spam. |
| **502 Transient Retry** | Upstream returns HTTP 502 (proxy/load-balancer hiccup — the model never saw the request). | Retry **same key** once after 1.5s, **no cooldown**. Rotating keys is pointless — they all hit the same edge. If the retry also 502s, falls through to normal error handling. Added in v3.3.3. |
| **Silent Upstream (no-response ghost)** | Upstream sends ZERO bytes/headers within `LITEROUTER_NO_RESPONSE_TIMEOUT` (def 5s). No status, no signal, no backoff. | Non-Google OpenAI-compat only (`executeOpenAICompat`). Abort, wait `LITEROUTER_NO_RESPONSE_RETRY_DELAY` (def 5s), rotate to next key. **NO cooldown** (provider gave no backoff signal). If all keys ghost → falls through to 300s timeout → 502. Covers NVIDIA first-shot blackhole. Google-native intentionally excluded. |

## Operational Rules
- **Truth:** `models.json` is the source-of-truth registry.
- **Cleaning (OpenAI-compat only):** Strip `presence_penalty`, `frequency_penalty`, `logit_bias`, `user`, `seed`, `logprobs`, `top_logprobs` from Gemma 4 payloads (prevents Google 400/500). LaTeX normalization on all routes. NOTE: `thinkingConfig` is NOT currently stripped (known gap, see bead `literouter-lsq`) — do not assume thinking params are sanitized.
- **Thought Signature (Google tool calls):** Google's OpenAI-compat endpoint requires `thought_signature` in `tool_calls[0].extra_content.google.thought_signature` for function calling. Proxy extracts it from Google's response stream (or non-streaming body) and re-injects it on the next request via in-memory store keyed by tool_call ID. Both `/v1beta/` (native) and `/v1/` (OpenAI-compat) routes support tool calls with Google models — no client-side changes needed.
- **Rotation:** Atomic Lua-based rolling 60s windows (Redis).
- **Identity:** Header `X-Literouter-Model` confirms upstream source.
- **Log Timestamps:** Every gateway log line is prefixed `[MM-DD-HH:SS:MS]` (no year) so gaps between request/serve/TTFT are eyeball-visible for debugging logic errors.
- **Observability (v3.3.0):** Streaming responses emit `[TTFT]` (time-to-first-token, ms) and `[USAGE]` (prompt/completion/total tokens) lines. Usage is captured from OpenAI `usage` and Google `usageMetadata`, and accumulated in Valkey `usage:{provider}:{model}` (HINCRBY, 30d TTL). `stream_options.include_usage: true` is auto-injected for OpenAI-compat.
- **Client Disconnect (v3.2.0):** Client abort (Stop/close) = **NO-OP**. Detected via `signal?.aborted` (true only on CLIENT abort, NOT our server timeout). On client abort we do NOT call `router.reportError` and do NOT cooldown the key — upstream fetch uses `AbortSignal.any([req.signal, LITEROUTER_HTTP_TIMEOUT_MS])`. Returns **499 Client Closed** silently. A server-side timeout still counts as a real failure and cools the key. See CHANGELOG `[3.2.0]`.
- **Silent Upstream / No-Response Ghost (v3.3.2):** When the upstream sends **nothing** — no status, no headers, no body, no backoff signal — within `LITEROUTER_NO_RESPONSE_TIMEOUT` (def 5s), it is a `NoResponseError`, NOT a generic timeout. We do NOT cooldown the key (the provider never told us to back off); we wait `LITEROUTER_NO_RESPONSE_RETRY_DELAY` (def 5s) and rotate to the next key. Non-Google OpenAI-compat only (`executeOpenAICompat`). If every key ghosts, the loop falls through to the 300s total timeout → 502. Google-native intentionally excluded. See CHANGELOG `[3.3.2]`.
- **Antigravity Agent vs Standard Models:** `antigravity-preview-05-2026` is an Agent execution engine (sandboxed Linux environment with terminal & tools), NOT a standard text-completion model. Standard text endpoints (`:generateContent` / `/v1/chat/completions`) fail with HTTP 400. Programmatic usage requires Google's Interactions API (`/v1beta/interactions` with `"agent": "antigravity-preview-05-2026"` and `"environment": "remote"`). Standard completion tasks must use `gemini-3.5-flash` or `gemini-3.6-flash`.
- **Cost Tracking:** NOT implemented. LiteRouter tracks RPM/TPM quota only — no $ cost. Math parked in `docs/KIV_cost_tracking.md` for future. Do not add `@relayplane/*` deps; any future cost work uses our Redis.
- **Vendor Hardening Reviews:** `docs/VENDOR_ANALYSIS.md` (adopt/follow matrix) + `docs/GRAVEYARD/VENDOR_IDEAS_DEFERRED.md` (rejected ideas: bifrost=Go/not portable, portkey OSS delegates to SaaS, relayplane→KIV, agentgateway validates #1).
- **Logging Locations:**
  - **Primary:** tmux session `literouter` — attach via `tmux attach -t literouter`
  - **Persisted traces:** `logs/traces/` — per-request JSON (auto-cleared at boot)
  - **Persistent stdout:** NOT enabled by default. Run manually or modify start.sh:
    ```bash
    bun run src/index.ts 2>&1 | tee -a logs/gateway.log
    ```

## Deep Dive References
- **Limits:** Google=15 RPM/model; NVIDIA=40 RPM/prov; OpenRouter=20 RPM/prov. Rolling 60s windows.
- **Env Vars:**
  - `{PROV}_MIN_DELAY_MS`: Override key rotation delay (hard-floored at 2s).
  - `LITEROUTER_MAX_ATTEMPTS`: (Default: 5, set to match key pool size) Keys tried per upstream in failover loop.
  - `LITEROUTER_NO_RESPONSE_TIMEOUT`: (Default: 5) Seconds to wait for the upstream's FIRST response byte before treating it as a silent ghost and rotating keys (non-Google OpenAI-compat only).
  - `LITEROUTER_NO_RESPONSE_RETRY_DELAY`: (Default: 5000) ms to wait after a silent ghost before rotating to the next key.
- **Procedures:**
  - Add Model/Provider: Follow `setup_checklist.md` (Steps 5-8).
  - Sync CLI: Update `~/.config/opencode/opencode.json` after `models.json` changes.
  - Troubleshooting: Check `troubleshoot.md` for error codes and debug logs.