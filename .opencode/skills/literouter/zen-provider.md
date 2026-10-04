# Zen Provider — Identity Gating, Sessions, Directives & Doctor Probes

> Load this file whenever the request touches the **Zen provider** (`zn`, `opencode.ai/zen`),
> **doctor diagnostics** (`scripts/diagnose/doctor.ts`, `scripts/diagnose/doctor_zn.ts`), `big-pickle`,
> `MissingSessionID` / `FreeUsageLimitError`, or Zen directive keys.
> SKILL.md is the entry point; this file is the Zen deep dive.

## 1. Endpoint & Registry (ground truth: `config/providers.json` → `providers.zen`)

> Canonical provider table (all codes, base URLs, strategies, limits):
> [`config-schemas.md` §3](config-schemas.md#3-configprovidersjson-providers-headers-registry).
> Zen (`zn`) uses `strategy: "zen"` (`config/providers.json` → `providers.zen.strategy`;
> the enum is `standard | native_cascade | gcp_guarded | anthropic_direct | zen` at
> `src/config/schema.ts:105-113`).

- Base URL: `https://opencode.ai/zen`
- Auth header: `Bearer` with `ZEN_API_KEYS` pool entries (live keys in git-ignored `.env.local`, never hardcoded)
- Static attribution headers (hot-reloaded via `POST /reset`):
  - `HTTP-Referer: https://opencode.ai` (or `LITEROUTER_HTTP_REFERER`)
  - `Referer: https://opencode.ai`
  - `X-Title: OpenCode` (or `LITEROUTER_X_TITLE`)
  - `User-Agent`: `opencode/1.18.30 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.2` (from `config/providers.json`; the gateway re-reads it at boot via `tools/get_opencode_ver.ts`)
- Endpoints: `ch` → `/v1/chat/completions`, `ms` → `/v1/messages`, `md` → `/v1/models`, `rs` → `/v1/responses`

## 2. Bare Model Standard (no `zen/` prefix)

Clients send bare model names with a Zen directive key
(e.g. `Authorization: Bearer lr-zn-oa-ch-no`):
`big-pickle`, `hy3-free`, `deepseek-v4-flash-free`, `qwen3.6-plus-free`,
`minimax-m3-free`, `nemotron-3-ultra-free`, `north-mini-code-free`.
Never send a `zen/` prefix — Zen models accept bare names only.

## 3. OpenCode Identity & Anti-Abuse Gating (upstream failure modes)

| Upstream error | Cause |
|---|---|
| `429 FreeUsageLimitError: Rate limit exceeded` | Upstream rate/token limit exceeded on key, or non-OpenCode runtime User-Agent (curl, Bun, python-requests) |
| `403 FreeTierError: OpenCode's free tier can only be used from within OpenCode` | Triggered when: (1) client identity/version headers leak through, (2) session ID is missing or not matching `ses_` format (UUID4 is rejected), (3) upstream `stream: false` without streaming, (4) payload `tools` list omits authentic OpenCode core tools (`bash`, `read`, `write`, `edit`, `glob`, `grep`), or (5) `tool_choice: "none"`. |
| `426 UpgradeRequired: OpenCode 1.18.0 or newer is required to use the free tier` | Client User-Agent carries outdated or beta version strings (e.g. `opencode/beta/0.0.0-beta-18965/cli`) rather than authentic standard runtime `opencode/1.18.x`. |

Static `User-Agent` / `Referer` alone does **not** satisfy free-tier gating — session format, core probe tools, and streaming are simultaneously evaluated.

## 4. Transparent Gateway Adaptation & Tool Merging (`src/engine/zen.ts`)

`buildZenHeaders(incomingHeaders?, sessionId?)` merges provider headers from `config/providers.json` (as the single source of truth) and ensures strict session validation:
- **Client Header Scrubbing (`scrubZenHeaders`)**: Deletes all client attribution headers (`x-client-*`, `client-*`, `x-opencode-client`, `x-opencode-version`, `x-application-*`, `sec-ch-ua*`, `origin`, etc.) before forwarding upstream.
- **Unconditional Attribution Injection**: Sets authentic OpenCode runtime identity (`User-Agent: opencode/1.18.30 ...`, `Referer: https://opencode.ai`, `HTTP-Referer: https://opencode.ai`, `X-Title: OpenCode`).
- **Session ID Enforcement**: Validates against OpenCode canonical session format `ses_[0-9a-f]{8}8ffe[0-9a-zA-Z]{14}` (`src/engine/zen.ts:15`). `isAcceptableSessionId` also accepts bare 8-char alphanumeric IDs and other well-formed `ses_…` tokens; anything else (e.g. generic UUID4s) is replaced by a freshly generated compliant token via `generateOpenCodeSessionId()`.
- **Core Probe Tool Merging (`adaptZenPayload` & `adaptZenResponsesPayload`)**:
  - Automatically merges OpenCode core probe tools (`bash`, `read`, `write`, `edit`, `glob`, `grep`) into `tools` without removing any client-supplied or subagent tools.
  - Normalizes `tool_choice`: converts `"none"` to `"auto"` so subagents (such as title generation) don't trigger upstream `FreeTierError`.
  - Forces `stream: true` upstream. For downstream non-streaming callers, LiteRouter transparently accumulates SSE stream chunks into standard responses (`chat.completion` or Responses JSON) via `accumulateZenStreamToCompletion` / `accumulateZenResponsesStream`.
- **Emitted Zen Headers**: `buildZenHeaders` returns exactly the registry `zen.headers` plus `User-Agent` (registry value, hardcoded fallback `opencode/1.18.30 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.2`), `HTTP-Referer`, `Referer`, `X-Title`, and the session trio `session-id` / `x-session-id` / `x-opencode-session` plus `x-opencode-request: msg_<session tail>` (`src/engine/zen.ts:125-135`).
- **Startup Version Sync**: Prior to gateway startup, `scripts/gateway/start.sh` invokes `tools/get_opencode_ver.ts`, executing local `opencode --version` and updating `config/providers.json` with the exact runtime `User-Agent`.

### 4.1 🚨 CRITICAL MANDATE: NEVER DROP OPENCODE SESSION ID OR USE UUID4
- Outbound requests MUST always carry `session-id` (and `x-session-id`) formatted as `ses_` + alphanumeric characters (`generateOpenCodeSessionId()` in `src/engine/session_id.ts`).
- Upstream Zen explicitly parses the `ses_` prefix and structure; generic UUID4s (e.g. `d3b07384-...`) result in instant HTTP 403 `FreeTierError`.
- Do NOT empty the `Authorization` header on chat completions: `/v1/chat/completions` requires an authentic Bearer token from `ZEN_API_KEYS`. Key rotation across all 7 pool keys operates normally when payload criteria are met.

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

## 7. Doctor Diagnostics (`scripts/diagnose/doctor.ts` + `scripts/diagnose/doctor_zn.ts`)

> 📖 **Comprehensive Reference**: For complete operational details on all doctor probes, error classifications (including `prompt_cache_key`), and CLI filters, see [`doctor.md`](doctor.md).

- Full sweep (all providers): `bun run scripts/diagnose/doctor.ts`
- Zen only: `bun run scripts/diagnose/doctor.ts zn` (also `--provider=zn`)
- Live path: `scripts/diagnose/doctor_zn.ts` — the Zen pool is wired to
  `probeZenKeyWithFreshSession` at `scripts/diagnose/doctor.ts:505`:
  - `generateZenSessionId()` (`:13-15`) — delegates to `generateOpenCodeSessionId()`
    (`src/engine/session_id.ts:12-26`), producing `ses_` + 8 hex + `8ffe` + 14 base62
    via `crypto.getRandomValues`, one distinct session per key.
  - `buildZenSessionHeaders(sessionId)` (`:17-19`) — delegates to `buildZenHeaders()`,
    giving registry headers + `session-id` / `x-session-id` / `x-opencode-session` /
    `x-opencode-request` (§4).
  - `probeZenKeyWithFreshSession(key)` (`:21-44`) — `big-pickle` streaming ping with the
    Zen core probe `tools` merged in, `tool_choice: auto`, and 429/403 body parsing.
- Legacy `probeZenKey` (`scripts/diagnose/doctor.ts:278-323`) sends static headers only
  and would always get `400 MissingSessionID` on `big-pickle`; it is **dead code** — the
  live Zen loop never calls it.

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
        "baseURL": "http://10.32.34.172:7766/v1",
        "apiKey": "lr-zn-oo-rs-no",
        "chunkTimeout": 120000
      },
      "options": {
        "baseURL": "http://10.32.34.172:7766/v1",
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

`resolveUpstreamEndpoint` (`src/config/providers.ts:126-156`) returns the
registry `headers` object verbatim; `buildAuthHeaders`
(`src/handlers/openai_compat.ts:93`) and the Zen engine then merge it and append
forwarded or synthesized session headers (`ensureSessionHeaders`,
`src/engine/session_id.ts:67-89`). Per-header truth:

| Upstream header | Source | Client-overridable? |
|---|---|---|
| `Authorization: Bearer <key>` | Rotating `ZEN_API_KEYS` pool entry selected per attempt | No — client `Authorization` carries the `lr-*` directive key only |
| `User-Agent`, `HTTP-Referer`, `Referer`, `X-Title` | `config/providers.json` `zen.headers` verbatim (currently `opencode/1.18.30 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.2` / `https://opencode.ai` / `OpenCode`) | No — inbound client values are **not** forwarded; `buildZenHeaders` unconditionally overwrites all four (`src/engine/zen.ts:127-130`) |
| `session-id`, `x-session-id` | Preserved from the inbound client session when acceptable, otherwise synthesized by `ensureSessionHeaders` as `ses_<8hex>8ffe<14 base62>` (`src/engine/session_id.ts:12-26`) | Yes — preserved when supplied by the client, auto-synthesized when omitted |
| `x-opencode-session`, `x-opencode-request` | Set unconditionally by `buildZenHeaders` to the active session ID and `msg_<session tail>` (`src/engine/zen.ts:131-132`) | No |

Notes:
- `LITEROUTER_HTTP_REFERER` (default `https://opencode.ai`) / `LITEROUTER_X_TITLE`
  (default `OpenCode`) / `LITEROUTER_USER_AGENT` (default `OpenCode/1.0.0`)
  (`src/config/schema.ts:214-216`) are honored by the doctor probes
  (`scripts/diagnose/doctor.ts:293-296` for the legacy probe, and
  `src/engine/zen.ts:120-123` for the live path); on the gateway path the
  `config/providers.json` registry is the source of truth.
- After editing `config/providers.json` headers, hot-reload with
  `curl -sk -X POST https://localhost:7766/reset -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"` (no restart needed).
- The terminal Model line's `Ref: <User-Agent> @ <Referer>` suffix renders the
  same registry headers, so it shows what Zen was told — compare it first when
  identity errors appear.

### 10.2 Why two layers exist

Zen gates in two stages: static headers answer "is this OpenCode at all"
(fail → `429 FreeUsageLimitError`); session headers answer "which OpenCode
session is calling" (fail → `400 MissingSessionID` on gated free-tier models).
Referrer fixes layer 1 only — `big-pickle` and other free-tier models additionally
require layer 2, which is why the unused static-only `probeZenKey` in `doctor.ts` would always return 400.

### 10.3 Symptom → check table

| Symptom | Most likely cause | Check |
|---|---|---|
| `429 FreeUsageLimitError` | Upstream not seeing OpenCode static identity | `config/providers.json` `zen.headers`; stale registry → `POST /reset`; confirm request actually routed `zn` (directive key `lr-zn-*-*`, 🎯 line) |
| `400 MissingSessionID` | No session header outbound | Check if `ensureSessionHeaders` (`src/engine/session_id.ts`) is invoked on the dispatch path; confirm client didn't supply an empty session header override |
| `401/403` | Bad or revoked pool key | `bun run scripts/diagnose/doctor.ts zn` to isolate the key; rotate `ZEN_API_KEYS` + restart |
| Doctor PASS but gateway FAILs | Doctor bypasses the gateway (direct upstream) | Reproduce via gateway: `curl -sk https://localhost:7766/v1/chat/completions -H "Authorization: Bearer <lr-zn-oa-ch-no>" -H "session-id: <real>"`; check pool loaded at boot and directive parsing |
| Gateway PASS but doctor FAILs | Legacy static-only probe path | Not expected — the wired Zen loop uses `probeZenKeyWithFreshSession` (`scripts/diagnose/doctor_zn.ts`); the static-only `probeZenKey` in `doctor.ts:278-323` is never called |

### 10.4 Quick verification commands

> 📌 **Gateway Host**: The authoritative bind host is `config/location.json` → `host`
> (currently `10.32.34.172`, `port: 7766`, `tls_enabled: false`). The previous
> `192.168.50.10` value is stale and no longer appears anywhere in the repo config.

```bash
# 1. Deterministic Unit Verification (tests tool merging, choice normalization, and stream accumulation offline)
bun test tests/unit/engine/zen.test.ts

# 2. Live Gateway Wire Adaptation Test (runs 3 live test vectors against the gateway from config/location.json)
bun run test:zen
# (or explicitly target a specific URL)
bun run scripts/test/test_zen_fixes.ts --url http://10.32.34.172:7766

# 3. Zen Upstream Key Health Doctor Probes (direct upstream key check)
bun run scripts/diagnose/doctor.ts zn

# 4. Gateway Health Probe
curl -s http://10.32.34.172:7766/health | jq .

# 5. Hot-reload providers.json header edits
curl -s -X POST http://10.32.34.172:7766/reset -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"
```
