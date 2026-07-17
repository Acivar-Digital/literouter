# 🪦 Rotation-Repo Ideas — Not Applicable to LiteRouter

**Status**: 🪦 **Canned (provider-specific / over-engineered / already-covered)**
**Captured**: 2026-07-17
**Source**: Study of 3 rotation repos in `arthityap/github/` — `Antigravity-Manager` (Rust+Tauri), `AntigravityManager` (TS+Electron), `CLIProxyAPI` (Go). All three target **Google AI Studio / Gemini OAuth account leases**, not multi-provider OpenAI-compat pools.
**Why this file exists**: A user asked what was worth adopting from these repos' rotation logic. The portable improvements are captured in `docs/IMPL_smart_cooldown.md`. Everything below is **N/A** to LiteRouter and is recorded so it is NOT re-litigated.

---

## Rejected / not-applicable patterns

### 1. Disk / JSON / `.cds` file persistence
- **Repo evidence**: Antigravity-Manager per-account JSON on disk (`token_manager.rs:938`); CLIProxyAPI `.cds` files (`cooldown_state.go:46`).
- **Why canned**: LiteRouter uses **Redis** for cooldown ZSETs + quota buckets (`src/index.ts:375`, `:493`). File persistence is strictly worse (no shared state across gateway instances, write-per-quota-change churn). Already superseded.

### 2. Egress-IP rotation (`proxy_pool`)
- **Repo evidence**: Antigravity-Manager `proxy_pool.rs` rotates egress IPs (not API keys).
- **Why canned**: Different concern entirely (network egress anonymity). LiteRouter is a key-rotation proxy, not an IP-rotation proxy. Out of scope.

### 3. Google OAuth / fingerprinting / vendor credit logic
- **Repo evidence**: All three manage Google OAuth refresh-token → access-token leases, fingerprinting, Antigravity/Codex/Claude credit accounting (CLIProxyAPI `antigravity_executor.go`).
- **Why canned**: LiteRouter pools raw API keys for `google`/`nvidia`/`openrouter`/`zen` via `API_KEYS` env + Redis. OAuth-account-lease machinery is irrelevant and would be vendor lock-in.

### 4. Parity / shadow / no-go rollout machinery
- **Repo evidence**: AntigravityManager `selection-policy.ts:66-368` "parity"/shadow/mismatch no-go scheduling (A/B safe-rollout).
- **Why canned**: Over-engineered rollout tooling for a transparent proxy with a static `models.json` registry. No equivalent need.

### 5. TUI / plugin scheduler framework
- **Repo evidence**: CLIProxyAPI bubbletea TUI, `pluginhost` scheduler plugin framework, per-provider executor sprawl.
- **Why canned**: Noise for LiteRouter's single-process Bun design. No plugin host, no TUI.

---

## What was actually portable (see `docs/IMPL_smart_cooldown.md`)
- Parse upstream `Retry-After` / `quotaResetDelay` → precise cooldown (G1).
- Reason-aware outer backoff (G2), grace-retry on sub-2s reset (G3), align 5xx TTL (G4).
- Note: reason-specific TTL + 4xx-skip-cooldown are **already implemented** in `reportError` (`src/index.ts:467`) — NOT gaps.

**Do not re-litigate the N/A list.** LiteRouter's Redis-backed, reason-aware, transparent design already covers the substance; the rest is provider-specific cruft.
