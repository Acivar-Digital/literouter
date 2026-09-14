# Red-Team Fiduciary Audit: LiteRouter v4.1 (redesign02 Blueprint + redesign03 Plan vs Disk Reality)

- **Document Path**: `docs/redesign04.md`
- **Audits**: `docs/redesign02.md` (architecture blueprint) + `docs/redesign03.md` (orchestration plan) + intern work product on disk (`main`, commit `4b5b161`)
- **Role**: Red-Team Fiduciary / Engineering Manager / Staff Engineer / Production Operations Owner — approval authority for deployment
- **Mode**: Observation-only. No code written, modified, or proposed. Findings only.
- **Evidence basis**: 5 read-only slice audits (tickets `literouter-e0mo/imjy/hjvb/np49/4ocw`, all claimed, left open) + direct verification (`grep`, `wc -l`, `git branch`, `git status`). Gates re-verified where stated; `uv run pytest` / `ruff` not re-executed in this pass (prior artefact `tests/test_results.md` claims pytest 21 passed today — not independently re-verified).
- **Gateway state at audit**: running, `GET /health` 200 (uptime ~342s). No live upstream probes performed; no key material inspected (`.env` shows modified — contents never read).

---

## 0. Scope and Method

Audited each blueprint section against disk reality:

| Slice | Ticket | Blueprint Sections | Result |
|---|---|---|---|
| A1 Config foundation | `literouter-e0mo` | §4 flag, §5 providers.json, §6 registry, §13 env cleanup | Complete — 1 doc-drift gap |
| A2 Telemetry & trace | `literouter-imjy` | §9 session, §10 trace subsystem | Complete — 2 availability/verification notes |
| A3 Engine & strategies | `literouter-hjvb` | §7 strategies, §8 breaker, §11 dispatch, §14 shutdown | Complete — 6 behavioral gaps |
| A4 Transformers & v4 handlers | `literouter-np49` | §12 contract, Phases 4–5 | Complete — 5 size/wording/wiring notes |
| A5 Tests & ops & GoLive | `literouter-4ocw` | §15–§19 | Complete — coverage + ops gaps; typecheck exit 0, `bun test` 1167/0 exit 0 verified |

Infra note: `explore` subagent type returned provider HTTP 404 on all 5 attempts; all slices completed via `general` read-only fallback. No evidence lost; method deviation recorded.

---

## 1. Core Approval Questions (answered)

- **Would I accept this from my intern?** No — not yet. The work is broad and largely present, but silent spec deviations (engine default, fail-open strategy fallback, unenforced half-open cap, missing TTFT guard, incomplete shutdown) are exactly the class of issue an intern does not get to decide unilaterally.
- **Would I approve this during a design review?** No. I would send it back with the 4 production blockers in §4 and require re-review of the disposition of each.
- **Would I allow this into production today?** No — under the blueprint's own rollout contract (default `legacy` → A/B parity → flip). Disk already defaults to `v4` (`src/config/env.ts:51`, `src/config/schema.ts:199`), so "today" means immediate v4 traffic without the specified A/B gate having been demonstrated in this audit.
- **Would I sign my name against this decision?** No.
- **Would I trust this during a high-severity incident?** No. Shutdown drain is wait-only (no listener close, no `[DONE]` termination, no trace drain, no H2 close — `src/lifecycle/shutdown.ts`), and two breaker systems coexist (`src/engine/circuit_breaker.ts` vs `src/network/circuit_breaker.ts`) with no cross-wiring evidence. Incident behavior is unpredictable.
- **Are the scripts 100% pydantic v2.0 upwards?** Not applicable — this is a Bun/TypeScript gateway; no pydantic surface was found in the audited paths. No verdict implied for Python eval/test helpers outside audit scope.
- **Are the LLM scripts 100% pydantic 1i v2.0 upwards?** Not applicable (same reason).

---

## 2. Review Dimensions (where the audit bit)

### Requirements
- The engine-default requirement (§4.1/§4.4/Phase 0–6: default `legacy`, flip in Phase 6) is contradicted by code default `v4`. Either the requirement or the code is wrong; nothing in the work product records which was intentionally changed or who approved it.
- Unknown-strategy behavior (§7.7: throw) is implemented as silent fallback to `StandardStrategy` (`src/engine/strategy_registry.ts:62`). A provider typo'd to an unknown strategy would run with wrong semantics and no boot error.
- Half-open concurrency cap (§8.3: "up to N concurrent, extras get 503") has an implementation (`canProbe`, `src/engine/circuit_breaker.ts:101-113`) that is never called in the dispatch path. The requirement is documented, implemented, and unwired simultaneously.

### Architecture
- Dual breaker implementations coexist with no evidence of cross-wiring (engine breaker for v4, legacy network breaker alongside). Tech-debt at minimum; split-brain provider-health judgment under mixed-engine operation at worst.
- Trace endpoints live in `src/handlers/v4/router.ts:143-211` (230 lines vs 60 est.), reachable only when `engine === "v4"` (`src/index.ts:414-416`). Legacy-engine deployments have no `/v1/traces` route. Availability is engine-gated; the blueprint does not state this.
- `src/transformers/anthropic_openai_xwire.ts` is 1050 lines vs 150 est. (7x). Purity verified (zero timers/pacer/retries), but size alone defeats the reviewability the transformer extraction was meant to buy for the highest-risk wire.

### Security
- Sanitization design verified: structural allowlist + redaction + secondary regex scrub (`src/telemetry/sanitize.ts:10-46,54-100`). Unknown headers dropped; `x-goog-api-key`/`cookie` redacted. No leakage found in sampled paths. Positive — see §6.
- Trace auth verified: empty/garbage directive key → 401 (`src/handlers/v4/router.ts:143-156`). Negative-path (401) coverage not asserted in `tests/integration/test_v4_smoke.py` (only 200 paths) — the control exists but is unproven by test.
- `.env` shows modified in `git status`; contents never inspected per mandate. Cannot confirm or deny key hygiene from this audit. Flagged as unknown, not as finding.

### Reliability
- `fetchWithTtftGuard` (§11.1 step 5e) is absent from the dispatch path; `src/engine/dispatch.ts:365-370` calls raw `fetchFn` with client signal only. `LITEROUTER_TTFT_TIMEOUT_MS` has no enforcement point in v4 dispatch. A hung upstream holds a slot until the client gives up.
- Ghost handling is generic, not typed: no `NoResponseError` import/check in dispatch; all fetch errors take the ghost-like retry path (`src/engine/dispatch.ts:505-526`), and the network path throws after exhaustion rather than returning the specified 502 envelope. Ghost-vs-fatal distinction is lost.
- Shutdown drain waits with a deadline (`src/lifecycle/shutdown.ts:44-72`) but performs none of the clean-termination steps (§14.1 steps 1, 3–5). In-flight SSE clients, trace persistence, and H2 sessions are unaccounted for at exit.

### Operations
- `v4.0` backup branch exists locally only; `git branch -a` shows no `remotes/origin/v4.0`. The rollback plan (§17.5 `git reset --hard v4.0`) depends on a ref that does not survive a machine loss.
- Working tree is dirty (~29 entries incl. `.env`, `config/providers.json`, `src/index.ts`, 2667-line `tests/test_results.md` artefact, deleted `scripts/lib/flush_valkey.sh`). "Clean tree" GoLive precondition is not met.
- `CHANGELOG.md` v4.1 notes present; `package.json` 4.1.0 present. Positive — see §6.
- Deprecation gating verified hardened vs spec prose (disk implements the v4-only rule the spec snippet omits — `src/config/deprecation.ts:35-46`). Positive — see §6.

### Testing
- Verified: `bun run typecheck` exit 0; `bun test` 1167 pass / 0 fail exit 0.
- Named-but-absent unit files: `engine/retry.test.ts`, `engine/cooldown.test.ts`, `engine/status_classify.test.ts` — consolidated into `math_and_classify.test.ts` (~13 cases vs ~35 expected across the three). Retry distribution claim (1000+ samples, §15) has ~3 retry cases on disk.
- Below-minimum suites: providers 7/10, deprecation 3/5, dispatch 14/20, strategies 23/25, ring_buffer 9/10, trace_writer 8/10.
- Missing dedicated integration files for 5 of 7 §16.2 rows (attribution, circuit, key_rotation, retry_jitter, trace_endpoint); 4 of 5 are folded into `test_v4_smoke.py` / `test_v4_ab_parity.py` / dispatch unit tests. `retry_jitter` non-zero-delay timing assertion has no integration coverage at all (grep for timing assertions in v4 smoke/parity/dispatch returns zero hits).
- `test_v4_smoke.py` has 4 tests but no explicit boot/health/basic-chat test function (health is a helper). Trace-auth 401 path unasserted. Air-gap and stub-key hygiene verified (loopback mock, `sk-test-*` fixtures, `preload_airgap.test.ts`).
- `uv run pytest` / `ruff` not re-executed in this pass.

---

## 3. Edge-Case Attack (what breaks, concretely)

1. **Unknown strategy string in `providers.json`** → silent `StandardStrategy` fallback (`strategy_registry.ts:62`). A `native_cascade` typo'd as `native_casccade` runs Google without cascade and without boot failure. Blast radius: wrong-model serving, invisible in logs.
2. **Half-open thundering herd** → `canProbe` never consulted in dispatch. After `open_duration_ms`, unlimited probes flow through the `isOpen()`-only gate. The breaker re-closes or re-opens on unconstrained concurrency — the exact herd the breaker was specified to prevent.
3. **Hung upstream (no first byte, socket open)** → no TTFT guard in dispatch. Slot held until client timeout. Under sticky client retries, slots accumulate; pacer keeps admitting (conveyor has no depth/timeout slop per architecture — by design, so nothing sheds this load except the client).
4. **Mid-stream upstream death after commit** → cutoff stream terminates with `[DONE]` (verified), but breaker records unconditional `500` (`dispatch.ts:390-393`) rather than the specified retryable-category check. Accounting is wrong in the same path that was built to be precise about 429-vs-5xx.
5. **`POST /reset` with invalid JSON** → old registry preserved (verified, `src/index.ts:82-116`). This is the one recovery path that works as specified. Noted as positive.
6. **Legacy-engine deployment needing traces during an incident** → `/v1/traces` does not exist outside v4 (falls to 404 at `index.ts:451-452`). The diagnostic tool is unavailable in exactly the rollback configuration the runbook recommends.
7. **`SIGKILL` / OOM during trace queue backlog** → up to 30s of traces lost (acknowledged in spec §10.4; accepted for diagnostics). Recorded, not contested — but incident timelines will have holes and reviewers should know.
8. **Dirty-tree deploy** → current tree (29 changed entries) deployed as-is ships an unreviewed `.env` delta and a deleted `scripts/lib/flush_valkey.sh` with no disposition record.

---

## 4. Fiduciary Risk Assessment

| Class | Exposure |
|---|---|
| Financial | GCP billing guardrail verified present (`gcp_guarded.ts:12-35`, 403 + prefix strip + dual auth). Low residual risk on that vector. Higher risk: silent strategy fallback could route Google traffic outside the cascade/guardrail-tested path without alerting. |
| Operational | Rollback depends on a local-only `v4.0` ref; dirty tree means the thing being approved is not the thing that was tested. Shutdown cannot cleanly terminate streams or drain traces. |
| Security | Design is sound (allowlist sanitization, trace auth); assurance is thin (no negative-path test for 401, no re-verified pytest/ruff in this pass, `.env` delta uninspected by mandate). |
| Compliance | Trace retention (30-day prune, parameterized delete) and redaction verified. `SIGKILL` loss window is documented and acceptable for diagnostics — but must not be relied on for any billing/compliance reconstruction. |
| Reputational | Shipping v4-as-default without the specified A/B parity evidence exposes downstream agents (OpenCode 2, Claude Code, Pydantic AI) to unproven-behavior risk under the production flag. |
| Supportability | Two breaker systems, engine-gated trace availability, and 7x-size xwire transformer concentrate on-call burden on the least-reviewed surfaces. |

---

## 5. Gaps Register (observation-only; no remediation prescribed)

### Production Blockers (§7 details each)
- **B1**: Engine default `v4` contradicts rollout contract (`legacy` → A/B → flip).
- **B2**: Unknown strategy silently falls back instead of failing fast.
- **B3**: Half-open probe cap implemented but never enforced in dispatch.
- **B4**: No TTFT timeout enforcement in v4 dispatch path.

### Non-blocking gaps (must be dispositioned, not necessarily fixed pre-launch)
- N1: Ghost errors untyped; network-exhaustion path throws instead of 502 envelope.
- N2: Shutdown drain is wait-only (5 clean-termination steps missing).
- N3: Retry/cooldown/classify unit files consolidated thin (13 vs ~35 cases); 6 suites below minima.
- N4: Retry-jitter timing has zero integration coverage; trace-auth 401 unasserted; smoke lacks explicit boot/chat test.
- N5: `v4.0` local-only; tree dirty (~29 files).
- N6: xwire 1050 lines / router 230 lines vs estimates; 2 handlers at exactly 50 lines vs `<50` gate; legacy additive-touch vs "Untouched" row wording.
- N7: Native cascade chains resolved dynamically rather than boot-loaded per §7.7 (behavioral compensation present, wiring differs).
- N8: `getAllProviders()` failure swallowed to empty registry instead of fail-fast.
- N9: Legacy-engine deployments have no trace route (availability caveat).
- N10: pytest/ruff not re-verified in this pass.

---

## 6. Strengths (what is solid)

1. **Schema and registry work is exact.** All 7 Zod schemas match spec field-for-field with correct defaults (`src/config/schema.ts:55-138`); atomic single-pointer swap verified (`src/config/providers.ts:49-50`); `POST /reset` failure preserves the old registry (`src/index.ts:82-116`). Backward compat holds (minimal provider entries parse via defaults).
2. **Deprecation handling is better than the spec.** Disk implements the v4-only gating rule that the spec snippet omits (`src/config/deprecation.ts:35-46`).
3. **Telemetry defaults and sanitization are exact.** 100 / 32MB / 64KB / 30s / 100 / 16MB / 30-day all match (`src/telemetry/ring_buffer.ts:19-21`, `src/telemetry/trace_writer.ts:6-9`); allowlist + redaction + secondary scrub verified; SQLite init/flush/prune all non-fatal with `drainSync` hooks; trace endpoints enforce 401.
4. **Status taxonomy and retry math are byte-identical to spec** (`src/engine/status_classify.ts:3-28`, `src/engine/retry.ts:10-26`, `src/engine/cooldown.ts:6-23` — the last strictly improving on falsy `Retry-After` handling).
5. **429-exclusion from breaker failures holds** via `isStatusFailure` filter (`src/engine/circuit_breaker.ts:14-22`), and 503 + `Retry-After` rejection matches spec.
6. **Transformers are genuinely pure.**Zero timers/pacer/retries across all 5 files; legacy diffs are additive re-exports only (24 insertions, 0 deletions across 4 handlers). Header merge order satisfies "declarative headers win" (`src/engine/dispatch.ts:94-111`).
7. **Gates that were run pass cleanly.** `bun run typecheck` exit 0; `bun test` 1167/0 exit 0. `package.json` 4.1.0, `CHANGELOG.md` v4.1 notes, and fresh `tests/test_results.md` exist.

---

## 7. Risks & Gaps (consolidated)

Covered in §2–§5. The load-bearing pattern: **safety mechanisms exist but are unwired or unenforced** (half-open cap, TTFT guard, strategy-throw, shutdown termination), **rollout guardrails are bypassed** (default already flipped, A/B evidence not demonstrated in this audit), and **test coverage is thinnest on the timing-sensitive claims** (jitter distribution, probe caps, drain timeouts) that only tests can prove.

---

## 8. Production Blockers (must prevent deployment until dispositioned)

- **B1 — Engine default drift.** `src/config/env.ts:51` + `src/config/schema.ts:199` default `v4`; blueprint §§4/5/15/17 require `legacy` with flip in Phase 6. Either the rollout contract changed without record, or the code jumped the gate. No A/B parity evidence was demonstrated in this audit under the specified protocol (§4.3: identical statuses/token counts, timing ±20%).
- **B2 — Silent strategy fallback.** `src/engine/strategy_registry.ts:62` falls back to `StandardStrategy` on unknown strategy; spec §7.7 requires throw. A config typo produces wrong-provider semantics with no boot error.
- **B3 — Unenforced half-open cap.** `canProbe()` (`src/engine/circuit_breaker.ts:101-113`) is never called in `src/engine/dispatch.ts`. Spec §8.3 probe limit is inoperative; post-open recovery admits unconstrained concurrency.
- **B4 — Missing TTFT enforcement.** Spec §11.1 step 5e `fetchWithTtftGuard` has no call site in dispatch (`src/engine/dispatch.ts:365-370` uses raw `fetchFn`). Hung upstreams hold dispatch slots until client abort.

---

## 9. Worst-Case Failure Scenario

A `providers.json` edit (or merge) introduces an unrecognized strategy string for a high-traffic provider. Boot succeeds (B2: no throw). Traffic flows under wrong semantics. Concurrently, the provider degrades: the breaker opens, then the open window expires. Recovery probes flood without cap (B3), re-tripping or flapping the breaker while TTFT-less hung requests (B4) accumulate slots. An operator rolls back to the legacy engine per the runbook — losing trace inspection (v4-only route) mid-incident — and attempts a code rollback to a `v4.0` ref that exists only on the original machine. The incident is debugged from terminal logs alone, with a 30s trace hole from the last queue flush, while in-flight SSE clients hang through a shutdown that waits but never terminates their streams. Financial guardrails hold (GCP 403 verified), but availability and diagnosability fail together — the two properties the v4.1 migration was meant to improve.

---

## 10. Final Verdict

**REJECT**

Justification: four independent production blockers (B1–B4), each sufficient on its own to withhold approval, plus a bypassed rollout gate (default already flipped without demonstrated A/B parity), a non-portable rollback ref, a dirty deployment tree, and timing-sensitive coverage holes on exactly the claims that need proof. The foundation is genuinely strong (§6) — this is a reject-with-a-path, not a condemnation: disposition B1–B4, push `v4.0` remote, clean the tree, backfill jitter/probe/drain/401-negative coverage, and return for re-review. I would not sign this for production today.

---

## Appendix: Key Evidence Pointers

- Engine default: `src/config/env.ts:51`, `src/config/schema.ts:199`, `src/config/env.ts:130-140` (override gate correct)
- Registry atomicity: `src/config/providers.ts:49-50`; reset: `src/index.ts:82-116,197`
- Deprecation: `src/config/deprecation.ts:3-46`; boot wiring `src/index.ts:48-60`
- Telemetry: `src/telemetry/session.ts`, `sanitize.ts:10-100`, `ring_buffer.ts:19-21`, `trace_writer.ts:6-9,66-201`, `hooks.ts:1-8`, `scripts/trace.ts:79-401`, `src/ui/logger.ts:77-80`, traces auth `src/handlers/v4/router.ts:143-163`
- Strategies: `src/engine/strategy.ts:11-41`, `strategy_registry.ts:15-76` (`:62` fallback), `strategies/{standard,native_cascade:82-95,gcp_guarded:12-43,zen_single_flight:5-27,anthropic_direct:4-10}.ts`
- Dispatch: `src/engine/dispatch.ts:234-547` (pipeline `:252-267` breaker, `:304` pacer, `:349-362` headers, `:365-370` raw fetch, `:390-393` cutoff accounting, `:505-526` catch); `retry.ts:10-26`, `cooldown.ts:6-23`, `status_classify.ts:3-28`, `pacer_adapter.ts:25-41`
- Breaker: `src/engine/circuit_breaker.ts:5-181` (`canProbe :101-113` uncalled; `isStatusFailure :14-22`; `rejectResponse :160-181`); legacy `src/network/circuit_breaker.ts:9-106`
- Shutdown: `src/lifecycle/shutdown.ts:4-104` (drain `:44-72`, no listener-close/`[DONE]`/`drainSync`/H2/exit)
- Transformers/handlers: `src/engine/transformer.ts:34` lines; transformers 323/240/289/1050/161; v4 handlers 47/50/47/50/47; `router.ts:230`; legacy +24/−0 re-export diffs
- Tests/ops: typecheck exit 0; `bun test` 1167/0 exit 0; `package.json` 4.1.0; `v4.0` local-only; tree ~29 dirty entries; pytest/ruff not re-run here
