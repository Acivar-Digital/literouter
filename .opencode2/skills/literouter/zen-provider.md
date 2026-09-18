# Zen Provider — Identity Gating, Sessions, Directives & Doctor Probes

> Load this file whenever the request touches the **Zen provider** (`zn`, `opencode.ai/zen`),
> **doctor diagnostics** (`scripts/doctor.ts`, `scripts/doctor_zn.ts`), `big-pickle`,
> `MissingSessionID` / `FreeUsageLimitError`, or Zen directive keys.
> SKILL.md is the entry point; this file is the Zen deep dive.

## 1. Endpoint & Registry (ground truth: `config/providers.json:247-261`)

> Canonical provider table (all codes, base URLs, strategies, limits):
> [`config-schemas.md` §3](config-schemas.md#3-configprovidersjson-providers-headers-registry).
> Zen (`zn`) uses `strategy: "zen_single_flight"` (`config/providers.json:338`).

- Base URL: `https://opencode.ai/zen`
- Auth header: `Bearer` with `ZEN_API_KEYS` pool entries (live keys in git-ignored `.env.local`, never hardcoded)
- Static attribution headers (hot-reloaded via `POST /reset`):
  - `HTTP-Referer: https://opencode.ai` (or `LITEROUTER_HTTP_REFERER`)
  - `Referer: https://opencode.ai`
  - `X-Title: OpenCode` (or `LITEROUTER_X_TITLE`)
  - `User-Agent: OpenCode/1.18.29` (or `LITEROUTER_USER_AGENT`)
- Endpoints: `ch` → `/v1/chat/completions`, `md` → `/v1/models`, `rs` → `/v1/responses`

## 2. Bare Model Standard (no `zen/` prefix)

Clients send bare model names with a Zen directive key
(e.g. `Authorization: Bearer lr-zn-oa-ch-no`):
`big-pickle`, `hy3-free`, `deepseek-v4-flash-free`, `qwen3.6-plus-free`,
`minimax-m3-free`, `nemotron-3-ultra-free`, `north-mini-code-free`.
Never send a `zen/` prefix — Zen models accept bare names only.

## 3. OpenCode Identity Gating (two failure modes)

| Upstream error | Cause |
|---|---|
| `429 FreeUsageLimitError: Rate limit exceeded` | Non-OpenCode runtime User-Agent (curl, Bun, python-requests) |
| `400 MissingSessionID: OpenCode's free tier can only be used in OpenCode` | Static headers present but client session identity stripped (hits free-tier gated models like `big-pickle`, `muse-spark-1.3-contributor-free`) |

Static `User-Agent` / `Referer` alone does **not** satisfy free-tier gating.

## 4. Client Session Forwarding & Transparent Gateway Adaptation (`src/engine/zen.ts`)

`buildZenHeaders(incomingHeaders?, sessionId?)` merges provider headers from `config/providers.json` (as the single source of truth) and ensures strict session validation:
- Validates against OpenCode format: `/^ses_[0-9a-f]{8}8ffe[0-9a-zA-Z]{14}$/`. If invalid or missing, immediately generates a valid session ID via `generateOpenCodeSessionId()`.
- Automatically injects: `x-opencode-session`, `session-id`, `x-session-id`, and `x-opencode-request: msg_<tail>`.
- **Option B Transparent Adaptation**:
  - `adaptZenPayload(body)` automatically injects OpenCode standard core probe tools (`bash`, `read`, `write`, `edit`, `glob`, `grep`) when `body.tools` is missing or empty.
  - Forces `stream: true` upstream. If the downstream caller requested `stream: false`, LiteRouter transparently accumulates SSE stream chunks into a standard OpenAI-compliant `chat.completion` response via `accumulateZenStreamToCompletion()`.
- **Startup Version Sync**: Prior to gateway startup, `scripts/gateway/start.sh` invokes `tools/get_opencode_ver.ts`, executing local `opencode --version` and updating `config/providers.json` with the exact runtime `User-Agent`.
(e.g. `ses_fcd71dd78ffeuRd5wpUekhfwIp`).

### 4.1 🚨 CRITICAL MANDATE: NEVER DROP OPENCODE SESSION ID INJECTION
- Outbound requests MUST always carry `session-id` (and `x-session-id`) formatted as `ses_` + 26 alphanumeric characters (`generateOpenCodeSessionId()` in `src/engine/session_id.ts`).
- If an inbound client request provides a session ID (`session-id`, `x-session-id`, `x-opencode-session-id`), it MUST be preserved.
- If missing (e.g. Pydantic evals, curl, test suites, non-OpenCode runtimes), `ensureSessionHeaders` MUST synthesize and inject a valid `ses_...` token.
- Do NOT replace with generic UUIDs (`crypto.randomUUID()`) or drop this helper in future engine refactors.

## 5. Zen Directive Keys

| Directive | Wire | Meaning |
|---|---|---|
| `lr-zn-oa-ch-no` | OpenAI → chat | Standard chat completions on bare Zen models |
| `lr-zn-oa-rs-no` | OpenAI → Responses | Bidirectional translation: `messages[]` → Responses `input`, encrypted reasoning stripped from content deltas, reasoning tokens mapped to `usage.completion_tokens_details.reasoning_tokens`, Responses SSE events re-emitted as `chat.completion.chunk` (`src/transformers/responses.ts`) |
| `lr-zn-oo-rs-no` | Native Responses passthrough | `POST /v1/responses` forwarded untouched to `opencode.ai/zen/v1/responses` with key rotation (`src/handlers/openai_original.ts`) |

## 6. Resilience Toggles (`.env`, defaults in `src/config/schema.ts` / `src/config/env.ts`)

| Toggle | Effect when `false` |
|---|---|
| `ZEN_ENABLE_RETRIES` | Single-flight passthrough: upstream 4xx/5xx returned on attempt 1, `502` synthesized on transport drops |
| `ZEN_ENABLE_QUARANTINE` | Bypass all `zn` key quarantine/cooldown; keys stay round-robin eligible |
| `ZEN_ENABLE_CIRCUIT_BREAKER` | Upstream 503 spikes passed downstream without tripping a pool-wide breaker |
| `ZEN_ENABLE_PACER` | Disables Zen ingress pacing (default `true`; pacing runs once per attempt loop) |

`ZEN_ENABLE_RETRIES=false` + `ZEN_ENABLE_QUARANTINE=false` = transparent dumb forwarder.

## 7. Doctor Diagnostics (`scripts/doctor.ts` + `scripts/doctor_zn.ts`)

> 📖 **Comprehensive Reference**: For complete operational details on all doctor probes, error classifications (including `prompt_cache_key`), and CLI filters, see [`doctor.md`](doctor.md).

- Full sweep (all providers): `bun run scripts/doctor.ts`
- Zen only: `bun run scripts/doctor.ts --provider=zn`
- Legacy `probeZenKey` (`doctor.ts:263-308`) sends static headers only → always
  gets `400 MissingSessionID` on `big-pickle`; kept as fallback reference.
- Live path: `scripts/doctor_zn.ts` (isolated helper, wired into the Zen loop):
  - `generateZenSessionId()` — fresh `ses_` + 26 random base62 per probe via
    `crypto.getRandomValues` (one distinct session per key, mimics N clients)
  - `buildZenSessionHeaders(sessionId)` — §1 static headers + §4 session fan-out
    + `x-client-name: opencode` / `x-client-version` matching the User-Agent
  - `probeZenKeyWithFreshSession(key)` — `big-pickle` ping with 429 body parsing
- Verified 2026-09-08: 7/7 Zen keys `200 OK (Healthy)` (previously 7× `400`).

## 8. Policy & Automation Note

LiteRouter standardizes OpenCode session ID minting (`src/engine/session_id.ts`).
Inbound client session IDs (from OpenCode CLI / Antigravity IDE) are strictly preserved.
When missing (e.g. automated Pydantic evals, curl, unit tests), the gateway automatically
synthesizes a valid canonical `ses_...` token so requests do not fail with `400 MissingSessionID`.
Per §4.1, engine dispatch MUST NEVER drop this helper.

---

## 9. OpenAI Responses API & Muse Reasoning Configuration (`muse-spark-1.3-contributor-free`)

Zen provides native access to reasoning models via the **OpenAI Responses API (`POST /v1/responses`)**, with **`muse-spark-1.3-contributor-free`** (and `muse-spark-1.2-contributor-free`) serving as the flagship coding and orchestrator model.

### 9.1 Protocol & Directive Key
- **Endpoint**: `POST /v1/responses` (OpenAI Responses standard wire)
- **Directive Key**: **`lr-zn-oo-rs-no`**
  - Provider: `zn` (Zen)
  - Payload Wire: `oo` (OpenAI Original / Responses wire, unscrubbed CoT)
  - Completion Slot: `rs` (Responses endpoint)
  - Nuance: `no` (Standard passthrough)
- **Client SDK**: Connects via `@ai-sdk/openai` (`aisdk:@ai-sdk/openai`), NOT `@ai-sdk/openai-compatible`.

### 9.2 Upstream Reasoning Effort Specification
Under the Responses API wire, Zen expects reasoning configuration inside a nested `reasoning` block:
```json
{
  "model": "muse-spark-1.3-contributor-free",
  "input": "Write a recursive Fibonacci function",
  "reasoning": {
    "effort": "xhigh"
  }
}
```

Live testing against upstream Zen verifies the following effort options:

| Effort Setting | Upstream Status | CoT Tokens | Behavior & Guidance |
|---|---|---|---|
| **`minimal`** | `200 OK` | ~130 | Fast, concise reasoning trace. Supported by Zen directly. |
| **`low`** | `200 OK` | ~488 | Reduced thinking budget for quick agent turns. |
| **`medium`** | `200 OK` | ~582 | Balanced reasoning depth. |
| **`high`** | `200 OK` | ~457 | **Default** level when no reasoning effort is explicitly specified. |
| **`xhigh`** | `200 OK` | ~667+ | **Maximum working thinking depth**. Optimal for complex coding/orchestration. |
| **`max`** | `400 Bad Request` | 0 | ⛔ **DO NOT USE**. Upstream console rejects: `The request contains invalid parameters`. |
| **`none`** | `400 Bad Request` | 0 | ⛔ **DO NOT USE**. Muse is reasoning-only: `reasoning_effort 'none' is not supported`. |

### 9.3 OpenCode 2 Declarative Configuration (`config.json` / `opencode.json`)

To register Zen Muse in OpenCode 2, configure `lr-zn-rs` under `providers`:

```json
{
  "providers": {
    "lr-zn-rs": {
      "package": "aisdk:@ai-sdk/openai",
      "npm": "@ai-sdk/openai",
      "name": "LiteRouter Zen Responses",
      "settings": {
        "baseURL": "https://localhost:7766/v1",
        "apiKey": "lr-zn-oo-rs-no",
        "chunkTimeout": 120000
      },
      "options": {
        "baseURL": "https://localhost:7766/v1",
        "apiKey": "lr-zn-oo-rs-no",
        "chunkTimeout": 120000
      },
      "models": {
        "muse-spark-1.3-contributor-free": {
          "name": "Muse Spark 1.3 Free (LR)",
          "limit": {
            "context": 1048576,
            "output": 943718
          },
          "options": {
            "reasoning": true,
            "reasoningEffort": "xhigh"
          }
        }
      }
    }
  },
  "model": "lr-zn-rs/muse-spark-1.3-contributor-free"
}
```

### 9.4 Operational Guardrails
1. **Always Set `chunkTimeout: 120000`**: Muse generates hundreds of reasoning tokens before emitting its first content delta. Standard 30s timeouts will prematurely abort requests.
2. **Never Pass Top-Level `reasoning_effort`**: In native Responses API payloads, `reasoning_effort` at the root will be rejected by Zen with `unknown parameter reasoning_effort`. It must be nested under `reasoning: { effort: "..." }`.
3. **Dual Model Availability**:
   - `muse-spark-1.3-contributor-free` & `muse-spark-1.2-contributor-free`: Free-tier accessible with valid contributor keys.
   - `muse-spark-1.3` & `muse-spark-1.2`: Requires paid credits (`HTTP 401` on free tier).

## 10. Referrer & Session-ID Mechanics (troubleshooting reference)

### 10.1 Where each upstream header originates

`resolveUpstreamEndpoint` (`src/handlers/openai_compat.ts:106-131`) returns the
registry `headers` object verbatim; `buildAuthHeaders` (`:133-181`) and the unified
dispatch engine (`src/engine/dispatch.ts`) then merge it via `Object.assign` and append
forwarded or synthesized session headers (`ensureSessionHeaders`). Per-header truth:

| Upstream header | Source | Client-overridable? |
|---|---|---|
| `Authorization: Bearer <key>` | Rotating `ZEN_API_KEYS` pool entry selected per attempt | No — client `Authorization` carries the `lr-*` directive key only |
| `User-Agent`, `HTTP-Referer`, `Referer`, `X-Title` | `config/providers.json` `zen.headers` verbatim (currently `OpenCode/1.18.29` / `https://opencode.ai` / `OpenCode`) | No — inbound client values are **not** forwarded; upstream always sees registry identity |
| `session-id`, `x-session-id`, `x-opencode-session`, `x-opencode-session-id`, `opencode-session-id`, `opencode-session`, `x-client-version`, `x-client-name` | Verbatim from inbound client request if present; if missing, synthesized via `ensureSessionHeaders` (`ses_` + 26 base62 chars via `src/engine/session_id.ts`) | Yes — preserved when provided by client, auto-synthesized when omitted |

Notes:
- `LITEROUTER_HTTP_REFERER` / `LITEROUTER_X_TITLE` / `LITEROUTER_USER_AGENT`
  (defaults in `src/config/schema.ts:143-145`) are honored by the doctor probes
  (`scripts/doctor.ts`, `scripts/doctor_zn.ts` fall back to registry-matching
  values); on the gateway path the registry is the source of truth.
- After editing `config/providers.json` headers, hot-reload with
  `curl -sk -X POST https://localhost:7766/reset` (no restart needed).
- The terminal Model line's `Ref: <User-Agent> @ <Referer>` suffix renders the
  same registry headers, so it shows what Zen was told — compare it first when
  identity errors appear.

### 10.2 Why two layers exist

Zen gates in two stages: static headers answer "is this OpenCode at all"
(fail → `429 FreeUsageLimitError`); session headers answer "which OpenCode
session is calling" (fail → `400 MissingSessionID` on gated free-tier models).
Referrer fixes layer 1 only — `big-pickle` and other free-tier models additionally
require layer 2, which is why the legacy static-only probe always returned 400.

### 10.3 Symptom → check table

| Symptom | Most likely cause | Check |
|---|---|---|
| `429 FreeUsageLimitError` | Upstream not seeing OpenCode static identity | `config/providers.json` `zen.headers`; stale registry → `POST /reset`; confirm request actually routed `zn` (directive key `lr-zn-*-*`, 🎯 line) |
| `400 MissingSessionID` | No session header outbound | Check if `ensureSessionHeaders` (`src/engine/session_id.ts`) is invoked on the dispatch path; confirm client didn't supply an empty session header override |
| `401/403` | Bad or revoked pool key | `bun run scripts/doctor.ts --provider=zn` to isolate the key; rotate `ZEN_API_KEYS` + restart |
| Doctor PASS but gateway FAILs | Doctor bypasses the gateway (direct upstream) | Reproduce via gateway: `curl -sk https://localhost:7766/v1/chat/completions -H "Authorization: Bearer <lr-zn-oa-ch-no>" -H "session-id: <real>"`; check pool loaded at boot and directive parsing |
| Gateway PASS but doctor FAILs | Legacy static-only probe path | Expected for `probeZenKey`; the wired Zen loop uses `doctor_zn.ts` fresh sessions |

### 9.4 Quick verification commands

```bash
bun run scripts/doctor.ts --provider=zn   # Zen key health (direct upstream, fresh session per key)
bun run scripts/doctor.ts                 # full sweep: Google, NVIDIA, OpenRouter, Zen, GCP
curl -sk https://localhost:7766/health | jq .
curl -sk -X POST https://localhost:7766/reset   # hot-reload providers.json header edits
```
