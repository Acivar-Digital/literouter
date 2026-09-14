# Fetcher Redesign — Per-Provider Transport + Rotation Policy

**Status:** Discussion only — no production code changes (2026-09-07)
**Mode:** `/discuss-mode` — design-first, read-only probes
**Related beads:**
- `literouter-hh0b` (open, feature): per-provider fetcher config, de-monolith `fetcher.ts`, rotation in provider settings
- `literouter-0ibs` (open, task): Zen H2 fallback per-request revisit (dumb-forwarder compat path always H1)
- `literouter-z78r` (closed, fixed): Zen quarantine bypass leak — 429 still quarantined despite `ZEN_ENABLE_QUARANTINE=false`

> No secrets in this doc. No implementation. File:line citations only.

---

## 1. Findings (verified probes)

### 1.1 `src/network/fetcher.ts` is transport + stream only (1153 lines)

- **Size:** `src/network/fetcher.ts` = 1153 lines (`wc -l` verified).
- **Imports:** only `getEnv` from `../config/env` + `getHttp2Pool` from `./h2_pool` — no provider policy, no pool/quarantine imports.
- **Exports (transport/stream primitives):**
  - `fetchWithTtftGuard` (`src/network/fetcher.ts:547`)
  - `executeH2Fetch` (`src/network/fetcher.ts:407`)
  - `createResilientStream` (`src/network/fetcher.ts:949`)
  - `handleStreamFailure` (`src/network/fetcher.ts:868`), `handlePrematureEof` (`src/network/fetcher.ts:824`)
  - `readFirstChunkWithTimeout` (`:222`), `readFirstContentChunkWithTimeout` (`:257`), `readWithChunkTimeout` (`:753`)
  - `extractUsageFromChunk` (`:293`), `extractFinishReasonFromChunk` (`:348`)
  - `NoResponseError` (`:47`), `StreamStallError` (`:54`)
  - Timeouts: `TTFT_TIMEOUT_MS=120000` (`:61`), `STREAM_IDLE_TIMEOUT_MS=120000` (`:62`), `MAX_HTTP_TIMEOUT_MS=300000` (`:63`)
- **H2/H1 branch (`src/network/fetcher.ts:565-599`):**
  ```ts
  const useH2 = getEnv().LITEROUTER_H2_OUTBOUND && options.url.startsWith("https://") && !isFetchMocked();
  if (useH2) {
    try { response = await executeH2Fetch(options, signal); protocol = "HTTP/2"; }
    catch (h2Err) { /* fallback to fetch → HTTP/1.1, else throw NoResponseError */ }
  } else {
    try { response = await fetch(...); protocol = "HTTP/1.1"; }
    catch (err) { throw new NoResponseError(...); }
  }
  ```
  Single global flag `LITEROUTER_H2_OUTBOUND` (`src/config/env.ts:27`). No per-provider H2 switch. This is the root cause behind `literouter-0ibs` (Zen edge accepts H2 per ALPN probe, but compat path falls back to H1 per-request; `oo` path uses plain `fetch` always).

### 1.2 Rotation / retry policy is duplicated 4x in handlers (not in fetcher)

Fetcher owns **no** rotation. All `classify → quarantine → rotate → retry` lives in compat handlers:

| Handler | `reportFailure` call sites | `classify*` call sites (probe memory) |
|---|---|---|
| `src/handlers/openai_compat.ts` | 5 (`:314`, `:514`, `:565`, `:578`, `:691`) | ~18 |
| `src/handlers/anthropic_compat.ts` | 5 (`:1029`, `:1212`, `:1256`, `:1269`, `:1395`) | ~14 |
| `src/handlers/gcp_compat.ts` | 5 (`:191`, `:315`, `:359`, `:370`, `:444`) | ~10 |
| `src/handlers/openai_original.ts` + `google_native.ts` | ~3+1 (`openai_original.ts:809,846,859`; `google_native.ts:266`) | ~15 (combined compat + original) |

Canonical sequence (same shape in all handlers, provider-gated):

1. **classify** — `classifyUpstreamError({ provider, status, headers, bodyText })`
  - e.g. `src/handlers/openai_compat.ts:305`, `src/handlers/anthropic_compat.ts:1021`, `src/handlers/gcp_compat.ts:183`, `src/handlers/openai_original.ts:852`
  - transport variant: `classifyTransportError(reason)` — e.g. `openai_compat.ts:511`, `anthropic_compat.ts:1210`, `gcp_compat.ts:313`
2. **quarantine** — `globalKeyPool.reportFailure(provider, index, status, headers, bodyText, Date.now(), classification.quarantineTtlSec)`
  - e.g. `src/handlers/openai_compat.ts:314`, `src/handlers/anthropic_compat.ts:1029`, `src/handlers/gcp_compat.ts:315`
  - Zen-gated after `z78r`: `zenQuarantineEnabled = !isZen || env.ZEN_ENABLE_QUARANTINE` (`openai_compat.ts:313`), `zenQ` equivalent in `anthropic_compat.ts:1027`
3. **rotate** — `selectKey` / `nextSelected` + `nextAttemptProvider` callback
  - e.g. `openai_compat.ts:565`, `anthropic_compat.ts:1256`, `gcp_compat.ts:359`
4. **retry** — re-issue `fetchWithTtftGuard` / resilient stream with next key
  - failure-typed retry: `reportFailure(..., 500)` on retry-transport failure — e.g. `openai_compat.ts:578`, `anthropic_compat.ts:1269`, `gcp_compat.ts:370`

Single `retry_policy` helper does not exist yet — ~13 duplicated call sites across compat handlers per `hh0b` ticket description.

### 1.3 `config/providers.json` has zero transport keys today

Entries carry only identity + routing + limits:

- `code`, `base_url`, `auth_header`, `endpoints` (`ch`/`ms`/`em`/`md`, plus `ob`/`gc` on Google), `limits` (`rpm`/`rpd`/`tpm` per model + `default`)
- `headers` only on `openrouter` (`HTTP-Referer`, `X-Title`, `User-Agent`) and `zn` equivalents — declarative attribution only, no policy

All resilience policy is **global env + hardcoded `provider===` branches**:

- Global infra: `LITEROUTER_H2_OUTBOUND` (`env.ts:27`), `LITEROUTER_PACER_ENABLED` (`:28`), `LITEROUTER_CIRCUIT_BREAKER` (`:29`)
- Per-provider env (flat, not nested): `ZEN_ENABLE_RETRIES/QUARANTINE/CIRCUIT_BREAKER` (`env.ts:43-45`), `GCP_ENABLE_RETRIES/QUARANTINE/CIRCUIT_BREAKER` (`:39-41`), `*_MIN_DELAY_MS` (`OPENROUTER/NVIDIA/ZEN/GOOGLE/GCP_MIN_DELAY_MS`, `:33-37`)
- Hardcoded branches: `provider === "gg"` (`openai_compat.ts:148`), `directive.provider === "zn"` (`:249`, `:613`, `:688`, `:731`), `provider === "or"` (`:265`, `:844`)

Handler resolution today: `resolveUpstreamEndpoint` + `buildAuthHeaders` + `provider===` conditionals — no per-provider policy object is threaded through.

---

## 2. Solution A (recommended long-term): wrapper fetcher + per-provider fetchers

Keep shared primitives in place; move **policy** out of handlers into provider modules.

- **Shared (stay in `src/network/fetcher.ts` + `h2_pool.ts`):** `fetchWithTtftGuard`, `executeH2Fetch`, `createResilientStream`, timeouts, header sanitization, `NoResponseError`/`StreamStallError`.
- **New interface (`src/network/provider_fetcher.ts`, proposed):** `fetchWithPolicy` — accepts provider code + policy + `buildAttempt` callback, owns classify → quarantine → rotate → retry loop.
- **New per-provider modules (`src/network/providers/*.ts`, proposed):** e.g. `zen.ts`, `gcp.ts`, `openrouter.ts`, `google.ts` — each owns H2 on/off, retry/rotation, quarantine TTL, breaker, pacer knobs for that provider.
- **Handlers go thin:** `openai_compat.ts`, `anthropic_compat.ts`, `gcp_compat.ts`, `openai_original.ts` pass a `buildAttempt` closure (URL/headers/body per key attempt) into `fetchWithPolicy`; no direct `reportFailure`/`classify*` calls.
- **Pool stays shared state:** `globalKeyPool` remains the single key/quarantine store; provider fetchers call into it — no per-provider pool fork.

Why recommended: eliminates 4x duplication at the seam where it actually lives (handlers), preserves H2 pool sharing, gives Zen (`0ibs` H2 question) and GCP/OR their own transport switches without new global env flags.

---

## 3. Solution B (minimal first step): transport block + single `getRetryDecision` helper

Without any per-provider file split:

1. Add a `transport` block to `config/providers.json` (schema-only, see §4) — H2 on/off, timeouts per provider.
2. Add a single `getRetryDecision` (or `retry_policy`) helper in `src/network/` that wraps `classifyUpstreamError` + `classifyTransportError` + quarantine-TTL gating + `isRetryable` check, replacing ~13 handler call sites one-for-one.
3. Leave H2 branch and pool untouched; handlers still call `fetchWithTtftGuard` directly.

Why minimal: smallest diff that kills duplication; defers module split until policy shape is proven. Can land before Solution A with no handler-loop rewrite.

---

## 4. Config decision: single `providers.json` for policy

- **Single `providers.json` for policy (agreed direction):** per-provider `transport` block + `defaults` fallback. Env keeps **secrets + infra + optional overrides only**.
  ```jsonc
  // proposed shape (not yet implemented)
  {
    "defaults": { "transport": { "h2": true, "retries": 2, "quarantine": true } },
    "providers": {
      "zen": { "transport": { "h2": false, "retries": 0, "quarantine": false } }
    }
  }
  ```
- **Env keeps:** API keys, `PORT`/`HOST`, Valkey/pool infra, plus optional `LR_<CODE>__<FIELD>` overrides for UAT/containers (e.g. `LR_ZN__H2=false`).
- **Migration:** JSON-first, env-fallback + warn — if legacy `ZEN_ENABLE_*` / `GCP_ENABLE_*` / `LITEROUTER_H2_OUTBOUND` is set, honor it once and log a deprecation warning pointing at the JSON field.
- **Zod schema-first:** `providers.json` must be validated by a Zod schema before any helper reads it. Precedent: `headers` drift (OR/ZN-only ad-hoc headers) is what happens without schema enforcement.

---

## 5. Open questions

1. **Override precedence:** JSON vs `LR_<CODE>__<FIELD>` vs legacy `ZEN/GCP_ENABLE_*` — exact order when all three are set?
2. **Hot-reload:** does policy reload require restart, or live via `POST /reset` / file-watch?
3. **Migration style:** compatibility shim (env-fallback + warn, §4) vs flag-day cutover (delete legacy flags at once)?
4. **`oo` path:** does `openai_original.ts` (`oo`/Responses) get `h2:false` by default, or is it wired into the shared H2 pool per `0ibs` revisit?

---

## 6. Next steps on `/discuss-mode-exit`

1. Zod schema for `transport` block + `defaults` (validates current `providers.json` unchanged).
2. Single `getRetryDecision` helper + one handler call-site conversion (Zen-first, follows `z78r` gates).
3. Then per-provider split (Solution A), Zen provider module first (unblocks `0ibs` H2 decision with per-origin counters).

---

*Generated discussion doc — factual synthesis of read-only probes. No code changed. No keys touched.*
