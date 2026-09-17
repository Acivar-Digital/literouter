# BYOK Decision Memo — 37 Google Gemini Keys in OpenRouter vs Local Direct Calls

**Date:** 2026-09-18 (UTC)
**Ticket:** literouter-mhat (Slice E BYOK decision)
**Question:** Is storing 37 Google Gemini keys in OpenRouter BYOK a good decision vs local direct calls hitting rate limits?
**Verdict: YES — with 2 guardrails** (keep local pacer + cooldown as fallback path; monitor key0 hot-spot + OpenRouter availability + Privacy Mode setting).

---

## 1. Evidence (BigQuery live probes, 2026-09-18)

Auth: `GOOGLE_APPLICATION_CREDENTIALS` env var only. Dry-run first, then live with small LIMITs.

| Probe (canonical PLAN.md §9) | Dry-run bytes | Live rows | Result |
|---|---|---|---|
| provider_perf_7d (§9.4, LIMIT 20) | 660 | 1 group | Google AI Studio / `google/gemini-3.5-flash-lite`: avg 1826ms, **p50 1496ms, p95 4003ms, n=52** |
| error_sample_1h (§9.3, LIMIT 20) | 474739 | **0** | **0 errors in last 1h** |
| cost_by_model_30d (§9.1, LIMIT 20) | 570 | 2 groups | `openai/gpt-4-turbo`: $0.02 (1 req, 150 toks); `google/gemini-3.5-flash-lite`: **$0.00 (52 reqs, 999,249 toks)** |

Supporting sample: `data/reports/REPORT_20260917_165055.md` — 10 traces / 2 sessions, **10/10 ok (100% success, 0 errors)**, total cost $0.02, finish_reasons tool_calls=8 / stop=2, 0 context overflows.

**$0 cost proof:** 52 Gemini requests consuming ~1M tokens at $0.00 total on the 30d cost probe = BYOK zero-cost isolation working (`is_byok` path, `total_cost == 0`). Only non-BYOK spend is a single $0.02 gpt-4-turbo call.

**BYOK key posture (per skill §7 + `scripts/check_openrouter_byok.ts` audit contract):** 37 Google AI Studio keys registered with `is_byok_only=true` / `is_required=true` (never falls back to shared credits), bound to the workspace BYOK completion key hash. Live streaming probe returns HTTP 200 with `is_byok: true`, $0 cost. (No credential bodies inspected or pasted; trace_ids omitted.)

---

## 2. Gateway local behavior (what we keep as fallback)

**RequestPacer** (`src/network/pacer.ts`) — deterministic client-side pacing:
- `RequestPacer(config: PacerConfig)` with `minIntervalMs` (or `maxRpm` → `ceil(60000/maxRpm)`, floor 10ms; default 200ms), optional `maxDelayMs` jitter, `maxQueueDepth` (default 500), `maxQueueWaitMs` (default 15000), `maxConcurrency`.
- `acquire(signal?) → { queueDwellMs, release }`: immediate bypass when queue empty + interval elapsed + concurrency free; else FIFO `FastFifoQueue` with `PacerQueueOverflowError(retryAfterSec)` on saturation and abort support.
- Per-provider singleton via `getPacerForProvider(provider, ...)` — all keys for a provider share one pipe. `getStats()` exposes in-flight / queue depth / EMA dwell.

**CooldownManager** (`src/network/cooldown.ts`) — reactive 429 quarantine:
- `quarantineKey(keyId, status, headers?, errorBody?, now?, customTtlSec?)`: honors `Retry-After` header / `quotaResetDelay` / `retry_after` body regex via `parseResetDelay` (≤2s treated as grace retry, else clamped ≥5s); status TTL map (429 → configured default, 5xx → 10s, 401/403/400/404 → 0).
- `isQuarantined / getRemainingMs / getMinQuarantineTtlMs / clearCooldown / clearAll`; `quarantineKeyWithTtl` for explicit TTLs (e.g. `midnight_utc` conserve rules).

**Contrast with OpenRouter waterfall:** per BYOK skill §1, OpenRouter sorts keys by `sort_order` (0..36 for 37 keys) and cascades Key 0 → Key 1 on 429/quota/error within ~600ms (task estimate ~200–300ms per hop). Local direct calls would need the pacer + cooldown above to replicate per-key rotation manually — doable (it exists), but single-process and capped by per-key RPM, whereas OpenRouter fans out across 37 keys server-side with zero client quota bookkeeping.

---

## 3. Tradeoff table

| Dimension | OpenRouter BYOK (37 keys) | Local direct calls |
|---|---|---|
| **Cost** | **$0 inference** (BYOK, `is_byok_only` blocks shared credits; proof: 52 reqs / ~1M toks = $0.00) | $0 inference too (same Google keys), but each key's free-tier RPM cap binds |
| **Latency** | Extra hop via OpenRouter router + waterfall cascade on 429 (~200–600ms per failover step); observed p50 1496ms / p95 4003ms n=52 | Lower best-case (direct socket, no extra hop); but 429s surface directly to caller and retries add equivalent or worse tail |
| **Reliability** | **37-key automatic failover**; 0 errors/1h observed; single workspace endpoint | Single-key RPM cap per process unless local rotation across all 37 keys is built and operated; pacer+cooldown exist but are client-local |
| **Ops** | No client quota management; key add/rotate/disable via Management API (`POST/PATCH/DELETE /api/v1/byok`) without code deploys | Must operate pacing config per provider, monitor per-key 429s, rotate keys in config/secret store |
| **Observability** | Unified OTEL-compatible spans + **BigQuery broadcast** (this memo's probes exist because of it); per-model/per-provider p50/p95, cost-by-model in one SQL dialect | Fragmented provider logs (Google AI Studio formats only); no cross-provider trace lineage (`trace_id`/`session_id`) without custom plumbing |
| **Privacy** | Prompts/completions transit OpenRouter; **Privacy Mode** strips `input`/`output` (telemetry still flows). Must keep Privacy Mode setting verified | Prompts stay Google-only; no third party in the inference path |
| **Lock-in / concentration** | Dependency on OpenRouter availability; `sort_order` hot-spot on key0 (all traffic starts there; keys 1..36 are cold standby until 429s) | No intermediary dependency; but lock-in shifts to self-operated rotation correctness |

---

## 4. Verdict: YES, keep 37 keys in OpenRouter BYOK — with 2 guardrails

**Guardrail 1 — Keep local pacer + cooldown as the fallback path.** Do not delete or bypass `RequestPacer` / `CooldownManager`. If OpenRouter is unreachable or BYOK waterfall degrades, the gateway must still pace direct Google calls and quarantine 429'd keys via `Retry-After`. No `src/` changes in this memo (docs-only slice).

**Guardrail 2 — Monitor three things:** (a) **key0 hot-spot** — `sort_order=0` absorbs all baseline traffic; watch its 429 rate and consider periodic rotation of which key holds slot 0; (b) **OpenRouter availability** — alert on non-BYOK fallback or shared-credit spend (`total_cost > 0` on Gemini models = BYOK bypass signal); (c) **Privacy Mode setting** — confirm prompt/completion exclusion stays enabled on the broadcast destination.

**Why YES:** $0 proven at ~1M-token scale, 10/10 ok sample + 0 errors/1h + n=52 provider sample with acceptable p50/p95, 37-key server-side failover with zero client quota code, and unified BQ observability that local calls cannot match without custom infrastructure. The costs (extra hop latency, OpenRouter dependency, key0 concentration, prompt transit) are real but bounded and covered by the two guardrails.

---

## 5. Sources

- `data/PLAN.md` §§1A (reliability), 1C (BYOK vs shared-credit economics), §9 (canonical queries), §11 (Privacy Mode).
- `.opencode2/skills/openrouter-byok/SKILL.md` §7 (`scripts/check_openrouter_byok.ts` audit + live probe contract); §1 (waterfall `sort_order` semantics).
- `src/network/pacer.ts` (`RequestPacer.acquire/release`, `getPacerForProvider`, `PacerConfig`) and `src/network/cooldown.ts` (`CooldownManager.quarantineKey`, `parseResetDelay`, `computeStatusTtlSec`) — signatures only.
- `data/docs/Google_BigQuery.md` (query patterns, JSON columns, Privacy Mode).
- `data/reports/REPORT_20260917_165055.md` (10/10 ok sample, $0.02 total).
- Live BQ probes 2026-09-18 (dry-run bytes + row counts recorded in §1).

*Hygiene: no API keys, credential bodies, or full trace_ids in this memo. No `.env` files read.*
