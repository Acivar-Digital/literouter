# Advisor MVP

## Blockers (two)
1. **Flaky web auth**: OAuth flows break silently on redirect mismatches, token refresh races, and `invalid_grant`. Fix: deterministic capture server (`advisor/auth/capture.ts`) with pre-gen URL, local callback (`http://localhost:8765/callback`), session storage outside repo (`~/.advisor_tools/`), refresh loop with `disable_on_invalid_grant`, zero secret persistence in git.
2. **Fragile HTML -> agent translation**: Raw DOM scraping leaks noise / ads / scripts; agents misread unfiltered HTML. Fix: `advisor/fetch/views.sh` uses `stealthy-fetch --ai-targeted -s selectors` with a Python wrapper (`views.py`) that outputs clean temp files, then cleans up. No hardcoded selectors embedded in binary blobs.

## How we differ (not same-shit)
- **vs 9router (LiteRouter gateway)**: 9router routes LLM traffic (directive keys, key rotation, H2 pool). Advisor does NOT route model traffic; it captures OAuth tokens and cleans HTML for agent consumption. Separate layer, separate port, no provider config shadowing.
- **vs Antigravity-Manager (Docker container)**: That container serves REST proxy + account rotation. Advisor has no Docker dependency; it runs as a Bun server (`capture.ts`) and shell/python scripts locally. No OAuth account rotation; only session persistence outside repo.
- **No secret replication**: Sessions live in `~/.advisor_tools/` (not `.env.local`, not `.env`, not repo). `.gitignore` already excludes `.env*`. No `<REDACTED>` substitution.
- **No Zdist / sliding-window relic**: Not a rate-limiter. Not a circuit-breaker. Just auth capture + clean fetch.

## Scaffold targets
- `advisor/auth/capture.ts` — Bun server (pre-gen URL, local callback, save `~/.advisor_tools/`, refresh loop, disable on `invalid_grant`).
- `advisor/fetch/views.sh` + `advisor/fetch/views.py` — `stealthy-fetch --ai-targeted -s selectors`, temp + cleanup.
- `advisor/MVP_CHECKLIST.md` — login URL placeholder, what we collect, no real tokens.

## Hygiene
- `bun run typecheck` for `capture.ts`. `ruff check .` for `views.py`. `bun run test` noted for future test hygiene.
