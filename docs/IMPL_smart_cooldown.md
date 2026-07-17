# IMPL: Smart Cooldown — Reason-Aware Backoff

**Status**: 📋 **Design ready — implementation deferred** (user wants further discussion)
**Captured**: 2026-07-17
**Source**: Cross-repo study of 3 rotation repos — `Antigravity-Manager` (Rust+Tauri), `AntigravityManager` (TS+Electron), `CLIProxyAPI` (Go). All three are Google/Gemini-AI-Studio OAuth focused; OAuth/fingerprinting/egress-IP logic is N/A to LiteRouter's multi-provider OpenAI-compat + Google-native pool.
**Bead**: `literouter-w69`

---

## Honest starting point (what LiteRouter ALREADY does)
`reportError` (`src/index.ts:467`) already applies **reason-specific TTL**:
- `429` / `rate_limit` → 65s (`rate_limited`)
- `timeout` / `503` / `504` → 10s (`timed_out`)
- `401` / `403` / `auth` / `permission_denied` → 604800s / 1 week (`quarantined`)
- default → 30s

And **4xx client errors already skip cooldown** — the `400` path returns `errBody` to the client without `reportError` (`src/index.ts:733-737`). So the "request-scoped errors skip cooldown" idea from CLIProxyAPI is **already covered**. Do NOT re-litigate it.

The genuine gaps are narrower than the raw repo comparison suggested. They are:

## Genuine gaps + proposed changes

### G1. Parse upstream `Retry-After` / `quotaResetDelay` (HIGHEST VALUE)
- **Gap**: `reportError` uses fixed constants. All three repos parse the `Retry-After` header and (Google) `quotaResetDelay` / `retryDelay` from the error body to set a *precise* cooldown.
- **Change**: in the `>=400` catch block (`src/index.ts:740-756`), extract `Retry-After` (seconds) and Google `quotaResetDelay` from `errText`; pass an optional `ttlOverride` into `reportError` so the Redis `EX` (`:493`) uses the upstream-stated reset instead of the default. Clamp to sane bounds (e.g. 5s–7200s) to avoid a `Retry-After: 86400` nuking a key for a day.
- **Anchor**: `:740` (where `errText` is read), `reportError :467`.

### G2. Reason-aware outer backoff
- **Gap**: `BACKOFF_MS = [65000, 90000, 120000]` (`:707`, mirrored `:873`) is applied uniformly when *all keys exhausted*, regardless of whether the exhaustion was quota (429) or transient (5xx).
- **Change**: select the ladder by dominant failure class — quota exhaustion → longer waits; transient 5xx → shorter. Keep the existing 3-step shape but branch on the last error type.
- **Anchor**: `:707`, `:807-809` (backoff application).

### G3. Grace retry on sub-2s reset (cheap, real win)
- **Gap**: on any failure we advance to the next key. Repos re-hit the *same* key after a 1.5–2s buffer when the upstream says "retry in ≤2s" — avoids pointless key churn.
- **Change**: if `Retry-After`/derived delay ≤ ~2s, retry the **same** `activeKey` once after a short `setTimeout` buffer before rotating. Must stay distinct from the client-abort 499 no-op (already handled at `:790-796`).
- **Anchor**: `:740` catch block; `:797` "All keys" handling.

### G4. Align 5xx TTL
- **Gap**: `500`/`502` fall through to the `default` 30s TTL, while `503`/`504` get 10s. A transient 500/502 shouldn't cool 3× longer than a 503.
- **Change**: fold `500`/`502` into the transient-5xx bucket (10s). One-line addition to the `reportError` classifier (`:483`).

### G5. Burst-coalescing (mostly already free)
- Redis `set ... EX` (`:493`) **overwrites** the TTL on concurrent failures, so the ladder already coalesces to a single window. Optional: make the outer ladder advance *once per open cooldown window* rather than per request. Low priority — likely already adequate.

## Non-Goals (explicitly out of scope)
- No disk/JSON/`.cds` persistence (Redis already supersedes).
- No egress-IP rotation, OAuth/fingerprinting, vendor credit logic (provider-specific, N/A).
- No parity/shadow rollout machinery, TUI, or plugin scheduler framework (over-engineered).

## Implementation sketch
1. Add `parseResetDelay(errText, headers): number | null` helper (reads `Retry-After`, Google `quotaResetDelay`/`retryDelay`); clamp 5–7200s.
2. `reportError(provider, key, errorType, modelName, ttlOverride?)` — use `ttlOverride` when provided.
3. At `:740` catch: compute `reset = parseResetDelay(...)`; pass to `reportError`; if `reset <= 2000` do grace-retry-same-key once.
4. At `:707`/`:873`: branch `BACKOFF_MS` by failure class.
5. At `:483`: add `500`/`502` to transient-5xx bucket.

## Verification
- `bun build src/index.ts --target=bun` → exit 0.
- `bun test` → all pass.
- Manual: force a 429 with `Retry-After: 120` → confirm key cooled ~120s (not 65s). Force 500 → confirm 10s (not 30s). Force `Retry-After: 1` → confirm same-key grace retry before rotation. Client-abort still → 499 no-op.

## Open discussion items (user requested)
- Clamp bounds for `Retry-After` (max 7200s? reject absurd values?).
- Should quota exhaustion use a longer ladder than 65/90/120?
- G3 grace-retry: retry same key once, or until delay budget exhausted?
