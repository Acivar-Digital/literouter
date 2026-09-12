# 🪦 ZDIST (Preemptive Client-Side RPM/RPD Rate Limit Tracker)

* **Status**: 🪦 **Canned & Retired (2026-09-12)**
* **Related Ticket**: `literouter-ayj4`
* **Original Files**: `src/network/zdist.ts`, `tests/unit/zdist.test.ts`
* **Original Spec**: `docs/Upgrade_3_2.md` (§6 Rate Limit Distribution & Quota Accounting)

---

## What It Was
In LiteRouter v3 development, an LLM recommended building a preemptive client-side rate limit tracker ("Zdist") using sliding-window RPM (Requests Per Minute, 60s window) and RPD (Requests Per Day, UTC midnight reset). The plan proposed tracking every key's usage locally and proactively rotating to the next key when a key reached 95% of its configured ceiling, attempting to avoid upstream HTTP 429 errors altogether. Early marketing copy even proposed a Redis/Valkey Lua sorted-set (`ZSET`) backend for distributed key rotation.

## Why It Was Discarded
1. **Upstream Limits Are Leaky Buckets & Token-Based (TPM), Not Simple RPM**:
   Vendor rate limits (Google Gemini, OpenRouter, NVIDIA, Anthropic) do not function on naive request counters. A single large context prompt (e.g. 100K tokens) can trip a 429 on request #1, while small pings might allow twice the nominal RPM. Furthermore, client-side sliding windows drift constantly from vendor-side sliding windows.
2. **Preemptive Abandonment Causes False Starvation**:
   Attempting to guess vendor limits locally causes LiteRouter to prematurely abandon perfectly usable keys, artificially reducing pool capacity.
3. **Solved Better by RequestPacer + Reactive CooldownManager**:
   - **`RequestPacer` (`src/network/pacer.ts`)**: Enforces $O(1)$ token-bucket conveyor pacing (`min_delay_ms`) to prevent burst traffic from triggering rate limits in the first place.
   - **`CooldownManager` (`src/network/cooldown.ts`)**: Reacts to actual upstream 429s by parsing `Retry-After` headers, placing only the tripped key into quarantine, and rotating to the next healthy key in <5ms.
4. **Valkey / Redis Lua ZSET Was Over-Engineering**:
   Running an external Valkey daemon and paying inter-process/network roundtrip latency on every API call just to count local key usage violates LiteRouter's core design principles: single-process, in-memory, ultra-low-latency, zero external infrastructure dependencies.
5. **Orphaned Dead Code**:
   `src/network/zdist.ts` was authored and tested, but never wired into `KeyPool` or `dispatch.ts`. Round-robin with reactive cooldown already handled all production traffic seamlessly.

## Disposition
- `src/network/zdist.ts` permanently deleted.
- `tests/unit/zdist.test.ts` permanently deleted.
- Export removed from `src/lib.ts`.
- Preemptive counting replaced officially by **RequestPacer + Reactive CooldownManager**.
