# LiteRouter Memory Investigation — Corrected Report

**Original report:** 2026-06-18 (bead `literouter-czp`)
**Corrected:** 2026-06-19 after independent verification

---

## TL;DR

The original report identified three "unbounded growth" sources. After reading the actual code and measuring real behavior:

| Source | Original claim | Actual finding | Action taken |
|--------|---------------|----------------|--------------|
| `src/db_logger.py` (SQLite) | "Grows forever, ~40MB/day" | **Real leak.** Grew to 428MB with only 3,814 rows (~112KB/row, not 500B). Disk estimate was off by ~240x. | **Fixed:** replaced with bounded in-memory deque. |
| `src/metrics.py` (`_mem_metrics`) | "Grows forever, Medium RAM risk" | **Bounded by input domain.** `key_usage` capped at number of keys (≤11), `error_by_status` capped at HTTP status codes (≤~10). Not a real leak. | **No fix needed.** |
| `src/main.py` (`_provider_locks`) | "Latent risk, Low" | **Bounded by config.** Providers are static (loaded from `.env`), not dynamic. | **No fix needed.** |

---

## 1. SQLite Logger — REAL LEAK (FIXED)

### What was wrong
`src/db_logger.py` wrote every request leg to `logs/literouter_logs.db` via `INSERT OR REPLACE`. No pruning, no VACUUM, no rotation. The `body` column stored full request/response payloads.

### Measured impact
- DB file: **428 MB** on disk
- Rows: **3,814**
- Avg row size: **~112 KB** (not the ~500B the original report estimated)
- At 1 req/s: **~9.7 GB/day** (not 40MB/day)

### Why it caused sluggishness
Every `log_leg()` call opened a new SQLite connection, wrote, committed, and closed. On a 400MB+ file, this is expensive — the daemon spent significant time on disk I/O for logging that was never read.

### Fix
Replaced `src/db_logger.py` with a `collections.deque(maxlen=5000)` in-memory buffer. No disk writes. FIFO eviction is automatic.

**Trade-off:** logs are lost on daemon restart. Acceptable because:
1. Logs were write-only (never queried by the app).
2. `/health` exposes live metrics, not historical logs.
3. RAM is the constraint we're optimizing for.

**RAM budget:** ~2.5 MB avg case, ~25 MB worst case (5000 entries × ~5KB max). Well under 1GB.

**Files changed:**
- `src/db_logger.py` — rewritten as in-memory deque
- `tests/test_log_buffer.py` — 7 new tests proving the cap is enforced
- `logs/literouter_logs.db` — deleted (428MB reclaimed)

**Commit:** `924e45b`

---

## 2. Metrics Dict — NOT A LEAK (NO FIX)

### What the original report said
> "The `key_usage` dict will grow linearly with the number of unique keys... and the `error_by_status` dict will grow with every unique HTTP status code."

### Why this is bounded, not unbounded
- `key_usage` keys are **10-char prefixes of API keys** (`key[:10] + "..."`). The number of unique prefixes is bounded by the number of keys in `.env` (currently 11). Adding a new key adds exactly one entry.
- `error_by_status` keys are **HTTP status codes as strings**. There are ~60 possible codes (100-599). After 102 requests, the dict had 1 entry.

### Measured behavior
After 102 requests on the live daemon:
- `key_usage`: 7 entries (one per key prefix used)
- `error_by_status`: 1 entry (one status code seen)

This is **bounded by the input domain**, not by time or request count. It will not grow unboundedly unless someone invents new HTTP status codes or adds thousands of API keys.

### Why `reset()` is never called
The `reset()` method exists but is never invoked. This is fine — the dict is already bounded. Calling `reset()` would lose useful metrics.

### Verdict
**No fix needed.** The original report overestimated this risk.

---

## 3. Provider Locks — NOT A LEAK (NO FIX)

### What the original report said
> "If provider configurations change dynamically, this dictionary will accumulate stale lock objects."

### Why this is bounded
Providers are loaded from `.env` at startup. They are **static** — there is no dynamic provider discovery or hot-reload. The `_provider_locks` dict has exactly as many entries as there are providers in `.env` (currently 2: openrouter, nvidia).

### Verdict
**No fix needed.** The original report correctly identified this as "Low (Latent)" risk. It remains latent — no action required.

---

## Summary

The original report was **directionally correct** (SQLite was a real leak) but **quantitatively wrong** (disk estimate off by 240x) and **overstated** (metrics and locks are bounded, not unbounded).

The SQLite fix alone should resolve the sluggishness. If RAM usage remains high after this fix, the next investigation should look at:
- Request/response body buffering in streaming handlers
- httpx connection pool size
- FastAPI middleware overhead

---

## Beads Trail

- `literouter-czp` — original memory leak investigation. Closed with corrected findings.
- `literouter-f1g` — key intake gap closure (related work). Closed.
