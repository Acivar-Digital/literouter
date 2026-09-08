# Standalone Engineering Specification: Google Native Flash Fusion Fallback (`gemini-flash`)

> **Target Audience**: Engineers & Contributors implementing this feature.
> **Status**: APPROVED & LOCKED — Revised after Senior Staff Audit.
> **Gateway Port**: `7766` (Single-process Bun/TypeScript runtime; NO sidecars or external ports).
> **Revision Date**: 2026-09-09
> **Bead**: `literouter-rg8k`

---

## 1. Executive Summary & Objective

This document provides a **complete, standalone engineering specification** to implement a resilient **Google Native RPC** fusion model named **`gemini-flash`** on LiteRouter.

When client applications (such as `@ai-sdk/google`, Claude Code, OpenCode, or direct SDKs) send native Gemini REST requests targeting `/v1beta/models/gemini-flash:*`, LiteRouter will dynamically route them through a 4-tier descending cascade of Gemini models:

```
Tier 1: gemini-3.8-flash → Tier 2: gemini-3.7-flash → Tier 3: gemini-3.6-flash → Tier 4: gemini-3.5-flash ↻
```

The implementation uses an **in-memory dual-rotation ring buffer**:
1. **Outer Model Ring**: Tracks the currently active model tier. When a tier fails, the pointer advances to the next model and **stays there** for subsequent requests. If Tier 4 fails, it wraps back to Tier 1.
2. **Inner Key Ring**: Rotates through available Google API keys in the `globalKeyPool` for the active model.

---

## 2. Protocol & Wire Invariants

| Attribute | Specification |
|---|---|
| **Protocol / Endpoints** | Native Google REST RPC:<br>• `POST /v1beta/models/gemini-flash:generateContent`<br>• `POST /v1beta/models/gemini-flash:streamGenerateContent?alt=sse` |
| **Directive Key** | Standard Google Native directive: `lr-gg-gg-gc-no`<br>Supplied via header `x-goog-api-key: lr-gg-gg-gc-no`, `Authorization: Bearer lr-gg-gg-gc-no`, or query `?key=lr-gg-gg-gc-no`. |
| **Trigger Rule** | **Strictly `gemini-flash`** (with optional `google/` prefix stripped by existing `extractModelFromPath`). If a client calls any other model (e.g. `gemini-2.5-flash`), LiteRouter bypasses fusion and acts as a transparent dumb forwarder. |
| **Zero Payload Transformation** | Client payload (`{"contents": [{"parts": [...]}]}`) is forwarded verbatim as raw binary bytes. No parsing into OpenAI `messages` or Anthropic payloads. |
| **Upstream Target** | `https://generativelanguage.googleapis.com` (over persistent HTTP/2 connection pool). Overridable via `GOOGLE_NATIVE_BASE_URL` env or `MOCK_GG_PORT` for testing. |
| **Downstream Delivery** | Native Gemini JSON or SSE chunk frames (`data: {"candidates": [...]}`). |

---

## 3. Dual-Rotation & Failover Architecture

```
                                  INBOUND REQUEST
                   POST /v1beta/models/gemini-flash:generateContent
                                         │
                                         ▼
                             ┌─────────────────────┐
                             │ extractModelFromPath │
                             │  strips "google/"   │
                             │  result: "gemini-flash"
                             └─────────┬───────────┘
                                       │
                             ┌─────────▼───────────┐
                             │ isNativeFusionModel? │
                             └─────────┬───────────┘
                                   /           \
                           (Yes)  /             \ (No)
                                 ▼               ▼
                     [Native Fusion Router]  [Dumb Forwarder — existing code path]
                                 │
                                 ▼
                   ┌──────────────────────────────┐
                   │ Snapshot startTier from       │
                   │ currentFlashTierIndex         │
                   │ (local pin for this request)  │
                   └────────────┬─────────────────┘
                                │
                   ┌────────────▼────────────────────────────────┐
                   │          OUTER TIER LOOP                    │
                   │  for cycleStep = 0..3 (max 1 full cycle)   │
                   │  tierIdx = (startTier + cycleStep) % 4     │
                   │                                             │
                   │  ┌──────────────────────────────────────┐  │
                   │  │ buildTierUpstreamUrl(tierModel)       │  │
                   │  │ Replace model segment in pathname     │  │
                   │  └────────────┬─────────────────────────┘  │
                   │               │                             │
                   │  ┌────────────▼─────────────────────────┐  │
                   │  │      INNER KEY LOOP                  │  │
                   │  │  for attempt = 1..totalActiveKeys    │  │
                   │  │  Key selected by globalKeyPool       │  │
                   │  │  .selectNextKey("gg")                │  │
                   │  │                                      │  │
                   │  │  Upstream Probe → Status?             │  │
                   │  │  ├─ 200 OK                           │  │
                   │  │  │   → SUCCESS: pipe downstream      │  │
                   │  │  │     inject x-literouter-model      │  │
                   │  │  │     inject x-literouter-tier       │  │
                   │  │  │     RETURN immediately             │  │
                   │  │  │                                    │  │
                   │  │  ├─ 404 (Model not deployed)          │  │
                   │  │  │   → FAST-ADVANCE: break inner loop│  │
                   │  │  │     DO NOT burn remaining keys     │  │
                   │  │  │     advance tier pointer           │  │
                   │  │  │     continue outer loop            │  │
                   │  │  │                                    │  │
                   │  │  ├─ 400/401/403 (Client error)        │  │
                   │  │  │   → Pass through to client as-is   │  │
                   │  │  │     DO NOT cascade (client's fault) │  │
                   │  │  │     RETURN immediately             │  │
                   │  │  │                                    │  │
                   │  │  └─ 429 / 5xx / Network Drop          │  │
                   │  │     → reportFailure("gg", index, st) │  │
                   │  │       continue inner loop (next key)  │  │
                   │  │       if all keys exhausted:          │  │
                   │  │         advance tier pointer           │  │
                   │  │         continue outer loop           │  │
                   │  └──────────────────────────────────────┘  │
                   └────────────────────────────────────────────┘
                                │
                                ▼ (all 4 tiers failed)
                     HTTP 503 "All Google native fusion tiers exhausted"
```

### 3.1 Outer Model Tier Ring ("Stay There" Semantics)

LiteRouter maintains an **in-memory module-level index**:
```typescript
let currentFlashTierIndex = 0;  // points to gemini-3.8-flash
```

**Advancement rules:**
- When a tier fails (all keys exhausted on 429/5xx, or immediate 404), `currentFlashTierIndex` is atomically set to `(currentFlashTierIndex + 1) % totalTiers`.
- **Subsequent requests start directly at `currentFlashTierIndex`**. They do NOT re-probe 3.8 until the pointer wraps around after failures across 3.7 → 3.6 → 3.5.

**Full Cycle Boundary:** Within any single request, LiteRouter will cascade through at most 4 tiers (1 full cycle). If all 4 tiers fail across all keys, the request halts with HTTP 503 Service Unavailable.

### 3.2 Concurrency Safety: Local Tier Pinning

> **CRITICAL**: The intern's original draft mutated `currentFlashTierIndex` and re-read it in consecutive loop iterations. Under concurrent requests, this causes tier-skipping and non-deterministic routing.

**Mandatory Pattern — Pin-and-Advance:**
```
On entry:
  const startTier = currentFlashTierIndex;   // snapshot (local pin)

Loop:
  for (let cycleStep = 0; cycleStep < totalTiers; cycleStep++) {
    const tierIdx = (startTier + cycleStep) % totalTiers;
    // ... attempt tier tierIdx ...
    // On failure:
    currentFlashTierIndex = (startTier + cycleStep + 1) % totalTiers;  // atomic advance
  }
```

**Why this matters:**
- Request A and Request B arrive concurrently. Both snapshot `startTier = 0`.
- Request A fails Tier 0, advances global pointer to 1. Request B also fails Tier 0, advances global pointer to 1.
- Both requests proceed to `cycleStep = 1`, computing `tierIdx = (0 + 1) % 4 = 1`. Both correctly try Tier 1.
- Without local pinning, Request B would read the global pointer (already mutated by Request A mid-loop) and unpredictably skip tiers.

**The global pointer (`currentFlashTierIndex`) exists solely to tell the NEXT request where to start.** Within a single request, the loop index is derived from `startTier + cycleStep`, never from re-reading the global pointer mid-loop.

### 3.3 Error Classification & Key Burn Rules

| Upstream Status | Classification | Inner Key Loop | Outer Tier Loop | Key Pool Action |
|---|---|---|---|---|
| **200 OK** | Success | BREAK + RETURN | BREAK + RETURN | `reportSuccess("gg", index)` |
| **400, 401, 403** | Client error | BREAK + RETURN | BREAK + RETURN | No action (client's fault) |
| **404 Not Found** | Model unreleased | BREAK immediately (burn 0 additional keys) | CONTINUE to next tier | No action (not a key issue) |
| **429 Too Many Requests** | Key quota exhaustion | CONTINUE to next key | CONTINUE if all keys fail | `reportFailure("gg", index, 429)` |
| **500, 502, 503** | Server error | CONTINUE to next key | CONTINUE if all keys fail | `reportFailure("gg", index, status)` |
| **Network drop / timeout** | Transport failure | CONTINUE to next key | CONTINUE if all keys fail | `reportFailure("gg", index, 0)` |
| **Pool exhausted** | No active keys left | BREAK | CONTINUE to next tier | N/A (already exhausted) |

**Key insight: On HTTP 404, the remaining keys will return identical 404s.** This is a model-level fault, not a key-level fault. Do NOT burn 6+ keys for 6 identical 404 round trips.

### 3.4 Streaming & Mid-Stream Drop Boundary

LiteRouter uses `fetchWithTtftGuard` which returns:
```typescript
{ response: Response, ttftMs: number, firstChunk: Uint8Array, rawReader: ReadableStreamDefaultReader, protocol: string }
```

The TTFT guard inspects the HTTP status and waits for the first upstream byte **before** committing downstream headers.

- **Pre-Stream Cascade (BEFORE HTTP 200 headers sent downstream):** If a failure (404, 429, 5xx, TTFT timeout, or network drop) occurs before `fetchWithTtftGuard` resolves with a 200-class status, LiteRouter cascades in-flight to the next tier seamlessly. The client experiences zero disruption.
- **Mid-Stream Fault Isolation (AFTER HTTP 200 headers and SSE chunks are flowing):** Once HTTP 200 headers and initial SSE frames have been transmitted to the client, if Google disconnects or drops the socket mid-response:
  - Do **NOT** attempt to cascade to a new tier mid-response.
  - Terminate the stream cleanly. Restarting a new tier mid-stream would emit conflicting JSON/SSE frames from token 0 and crash client-side parsers (e.g. `@ai-sdk/google` would throw a JSON parse error).

**Why this is safe:** The transition point between "cascade-able" and "committed" is the moment `handleNativeResponse` begins piping upstream bytes into the downstream `Response` body. Before that point, no bytes have left LiteRouter. After that point, the client is committed to this stream.

---

## 4. Configuration: Boot-Time Caching with Hot Reload

> **CRITICAL**: The intern's original draft called `readFileSync` + `JSON.parse` on every inbound request. In a single-threaded Bun runtime handling hundreds of RPS, this blocks the event loop and creates I/O latency spikes.

### 4.1 Cached Config Pattern (Mandatory)

The native chain configuration MUST be cached in a module-level variable at boot and only reloaded on explicit `POST /reset` (which calls `resetAllState()`).

**Boot-time loading:**
```typescript
// Module-level cached state
let cachedNativeChains: Readonly<Record<string, readonly string[]>> = {};

const DEFAULT_NATIVE_FLASH_CHAIN: readonly string[] = Object.freeze([
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
]);

/**
 * Load native_chains from config/fusion.json into the module-level cache.
 * Called once at boot and again on POST /reset via resetAllState().
 * Uses synchronous I/O intentionally — this runs at boot, NOT on the request path.
 */
export function loadAndCacheNativeChains(): void {
  try {
    const configPath = resolve(process.cwd(), "config", "fusion.json");
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
      if (parsed.native_chains && typeof parsed.native_chains === "object") {
        cachedNativeChains = parsed.native_chains;
        return;
      }
    }
  } catch {
    // Fall through to empty cache — getNativeChain() returns the hardcoded fallback
  }
  cachedNativeChains = {};
}

/**
 * Returns the chain for the given virtual model name.
 * Hot path — reads from memory only, zero I/O.
 */
function getNativeChain(chainName: string): readonly string[] {
  const chain = cachedNativeChains[chainName];
  if (Array.isArray(chain) && chain.length > 0) {
    return chain;
  }
  // Hardcoded fallback guarantees the chain is never empty
  if (chainName === "gemini-flash") {
    return DEFAULT_NATIVE_FLASH_CHAIN;
  }
  return [];
}
```

### 4.2 Integration with `resetAllState()`

In `src/index.ts`, add `loadAndCacheNativeChains()` to the reset sequence so that `POST /reset` reloads the chain from disk:

```typescript
export function resetAllState(): void {
  globalCooldownManager.clearAll();
  globalKeyPool.reset();
  initializeKeyPools();
  clearCircuitBreakerRegistry();
  clearPacerRegistry();
  resetHttp2Pool();
  resetProvidersRegistryCache();
  loadAndCacheNativeChains();       // ← ADD THIS
  resetNativeFlashTierIndex();      // ← ADD THIS (reset tier pointer on hard reset)
}
```

Also call `loadAndCacheNativeChains()` once during server boot (near `initializeKeyPools()`).

### 4.3 `config/fusion.json` Schema Addition

Add a declarative `"native_chains"` section at the root of `config/fusion.json`:
```json
{
  "$schema": "./fusion.schema.json",
  "version": "3.1",
  "presets": { "...existing presets..." },
  "native_chains": {
    "gemini-flash": [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.6-flash",
      "gemini-3.5-flash"
    ]
  }
}
```

This allows adding future native chains (e.g. `"gemini-flash-lite"`) by editing JSON without changing code.

### 4.4 Files NOT to Touch

- **`models.json` (root)**: Legacy artifact from the old Python gateway. The TypeScript Google Native forwarder does **not** read this file. **Leave untouched.**
- **`fusion.json` (root)**: Legacy artifact. The TypeScript gateway loads `config/fusion.json`. **Leave untouched.**

---

## 5. Header Contracts & Observability

### 5.1 Upstream Headers (LiteRouter → Google)

When LiteRouter dispatches calls to `generativelanguage.googleapis.com`, it must identify itself as an OpenCode agentic harness (matching OpenRouter and Zen provider behavior from `config/providers.json`).

**Modification to existing `prepareUpstreamHeaders` function** (currently at `src/handlers/google_native.ts` lines 93-103):

Add these lines after the existing `upstreamHeaders.set("accept-encoding", "identity")`:
```typescript
// Inject OpenCode agentic harness attribution (matches providers.json OpenRouter/Zen headers)
upstreamHeaders.set("user-agent", process.env.LITEROUTER_USER_AGENT || "OpenCode/1.18.29");
upstreamHeaders.set("http-referer", process.env.LITEROUTER_HTTP_REFERER || "https://opencode.ai");
upstreamHeaders.set("referer", process.env.LITEROUTER_HTTP_REFERER || "https://opencode.ai");
upstreamHeaders.set("x-title", process.env.LITEROUTER_X_TITLE || "OpenCode");
```

**Existing headers preserved:**
- `x-goog-api-key`: Upstream rotated key from `globalKeyPool.selectNextKey("gg")`
- `accept-encoding: identity` (no upstream compression)
- All client headers except those in `STRIPPED_UPSTREAM_HEADERS` (`authorization`, `x-goog-api-key`, `host`, `content-length`)

### 5.2 Downstream Response Headers (LiteRouter → Client)

LiteRouter attaches diagnostic labels to the HTTP response headers on fusion-served responses:
- `x-literouter-model`: The concrete upstream model that served the turn (e.g. `gemini-3.7-flash`).
- `x-literouter-tier`: The 1-indexed tier number that served the turn (e.g. `2`).

These headers do NOT alter the response body. They are metadata only, visible via `curl -v` or network inspector tools.

**Implementation note:** These headers must be injected by cloning the upstream response headers and appending before constructing the downstream `Response` object:
```typescript
const resHeaders = new Headers(outcome.response.headers);
// Strip headers that Bun should recompute for the downstream response
for (const h of STRIPPED_DOWNSTREAM_HEADERS) resHeaders.delete(h);
resHeaders.set("x-literouter-model", tierModel);
resHeaders.set("x-literouter-tier", String(tierIdx + 1));
```

Where `STRIPPED_DOWNSTREAM_HEADERS` is the existing set: `content-encoding`, `content-length`, `transfer-encoding`.

### 5.3 Terminal Telemetry (`tmux`)

When a tier advances, log a visible notification using LiteRouter's existing logger contract (`logWarn(emoji: string, message: string)`):

```text
🔗 [FUSION req_abc123] Tier 1 (gemini-3.8-flash) → 404. Cascading to Tier 2 (gemini-3.7-flash)
🔗 [FUSION req_abc123] Tier 2 (gemini-3.7-flash) → 429 (all 6 keys exhausted). Cascading to Tier 3 (gemini-3.6-flash)
🔗 [FUSION req_abc123] Tier 3 (gemini-3.6-flash) → 200 OK. Served by Tier 3.
```

**Use `EMOJI.fusion` (= `"🔗"`)**, not `"🔀"`.

When a full cycle exhausts all tiers:
```text
🔴 [FUSION req_abc123] All 4 tiers exhausted. Returning 503.
```

Use `EMOJI.exhausted` (= `"🔴"`) for the terminal failure log.

---

## 6. URL Rewriting: Model Segment Replacement

### 6.1 How `extractModelFromPath` Works (Existing Code — Do Not Modify)

Located at `src/handlers/google_native.ts` lines 66-70:
```typescript
function extractModelFromPath(pathname: string): string {
  const match = pathname.match(/\/v1beta\/models\/([^:]+)/);
  const raw = match?.[1] ?? "gemini-2.5-flash";
  return raw.startsWith("google/") ? raw.slice(7) : raw;
}
```

**This already strips the `google/` prefix.** So regardless of whether the client sends:
- `/v1beta/models/gemini-flash:generateContent` → returns `"gemini-flash"`
- `/v1beta/models/google/gemini-flash:generateContent` → returns `"gemini-flash"`

### 6.2 How `buildGoogleNativeUpstreamUrl` Works (Existing Code — Do Not Modify)

Located at `src/handlers/google_native.ts` lines 84-91:
```typescript
function buildGoogleNativeUpstreamUrl(url: URL): URL {
  const base = getGoogleNativeBaseUrl();
  const upstreamUrl = new URL(`${base}${url.pathname}${url.search}`);
  if (upstreamUrl.searchParams.has("key")) {
    upstreamUrl.searchParams.delete("key");  // ← client directive stripped from query
  }
  return upstreamUrl;
}
```

**This already strips the `?key=` query parameter**, which eliminates the risk of conflicting key sources (query param vs. `x-goog-api-key` header).

### 6.3 New Function: `buildTierUpstreamUrl` (Create This)

Because `extractModelFromPath` strips `google/` but the raw `url.pathname` may still contain it, the URL rewriter must operate on the **raw pathname**, not the normalized model name.

```typescript
/**
 * Replace the model segment in an upstream URL pathname to target a specific tier.
 *
 * Handles both:
 *   /v1beta/models/gemini-flash:generateContent
 *   /v1beta/models/google/gemini-flash:streamGenerateContent
 *
 * The regex captures everything between /v1beta/models/ and the first colon,
 * replacing it with the tier model name.
 */
function buildTierUpstreamUrl(baseUpstreamUrl: URL, tierModel: string): URL {
  const cloned = new URL(baseUpstreamUrl.toString());
  cloned.pathname = cloned.pathname.replace(
    /\/v1beta\/models\/[^:]+/,
    `/v1beta/models/${tierModel}`
  );
  return cloned;
}
```

**Why regex instead of string replacement:** The original draft used `cloned.pathname.replace(\`/v1beta/models/${requestedModel}:\`, ...)`. This fails when the raw pathname contains `google/gemini-flash` but `requestedModel` is `gemini-flash` (after prefix stripping). The regex `/\/v1beta\/models\/[^:]+/` captures the entire model segment regardless of prefix, making it robust against all client URL variants.

---

## 7. Implementation Blueprint

### File: `src/handlers/google_native.ts`

#### Step 0: Pre-Edit Hygiene Checkpoint
```bash
uv run python admin/code_hygiene/agent_guardrail.py checkpoint src/handlers/google_native.ts
```

#### Step 1: Add Imports (if not already present)
Verify these exist; add only if missing:
```typescript
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
```

#### Step 2: Add Module-Level State & Configuration Functions

Place these near the top of the file, after the existing constants (`MAX_NATIVE_ATTEMPTS`, `STRIPPED_UPSTREAM_HEADERS`, etc.):

```typescript
// ─── Native Fusion: gemini-flash chain state ───────────────────────
const DEFAULT_NATIVE_FLASH_CHAIN: readonly string[] = Object.freeze([
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
]);

/** Cached native chains — loaded at boot, reloaded on POST /reset. */
let cachedNativeChains: Readonly<Record<string, readonly string[]>> = {};

/** Persistent tier pointer — survives across requests, reset on POST /reset. */
let currentFlashTierIndex = 0;

export function resetNativeFlashTierIndex(): void {
  currentFlashTierIndex = 0;
}

export function getCurrentFlashTierIndex(): number {
  return currentFlashTierIndex;
}

/**
 * Load native_chains from config/fusion.json into the module-level cache.
 * Called at boot and on POST /reset. Uses sync I/O (boot-time only, not hot path).
 */
export function loadAndCacheNativeChains(): void {
  try {
    const configPath = resolve(process.cwd(), "config", "fusion.json");
    if (existsSync(configPath)) {
      const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
      if (parsed.native_chains && typeof parsed.native_chains === "object") {
        cachedNativeChains = parsed.native_chains;
        logInfo(EMOJI.boot, `Loaded native_chains: ${Object.keys(parsed.native_chains).join(", ")}`);
        return;
      }
    }
  } catch {
    logWarn(EMOJI.error, "Failed to load native_chains from config/fusion.json — using hardcoded fallback");
  }
  cachedNativeChains = {};
}

/** Hot-path chain lookup — reads from memory only, zero I/O. */
function getNativeChain(chainName: string): readonly string[] {
  const chain = cachedNativeChains[chainName];
  if (Array.isArray(chain) && chain.length > 0) {
    return chain;
  }
  if (chainName === "gemini-flash") {
    return DEFAULT_NATIVE_FLASH_CHAIN;
  }
  return [];
}

/** Strict trigger: only "gemini-flash" activates fusion. */
function isNativeFusionModel(model: string): boolean {
  return model === "gemini-flash";
}
```

**Note on `isNativeFusionModel`:** Because `extractModelFromPath` already normalizes the model (lowercased via URL parsing, `google/` prefix stripped), the function only needs to check `model === "gemini-flash"`. No `.toLowerCase().trim()` needed — the input is already normalized.

#### Step 3: Add `buildTierUpstreamUrl`

Place near the existing `buildGoogleNativeUpstreamUrl`:

```typescript
function buildTierUpstreamUrl(baseUpstreamUrl: URL, tierModel: string): URL {
  const cloned = new URL(baseUpstreamUrl.toString());
  cloned.pathname = cloned.pathname.replace(
    /\/v1beta\/models\/[^:]+/,
    `/v1beta/models/${tierModel}`
  );
  return cloned;
}
```

#### Step 4: Modify `prepareUpstreamHeaders`

Add OpenCode identity headers to the existing function (after the `accept-encoding` line):

```typescript
upstreamHeaders.set("user-agent", process.env.LITEROUTER_USER_AGENT || "OpenCode/1.18.29");
upstreamHeaders.set("http-referer", process.env.LITEROUTER_HTTP_REFERER || "https://opencode.ai");
upstreamHeaders.set("referer", process.env.LITEROUTER_HTTP_REFERER || "https://opencode.ai");
upstreamHeaders.set("x-title", process.env.LITEROUTER_X_TITLE || "OpenCode");
```

#### Step 5: Refactor `handleGoogleNative` for Fusion Dispatch

The existing `handleGoogleNative` function handles single-model dumb forwarding. The fusion path branches early based on `isNativeFusionModel(requestedModel)`.

**Architectural split:**
- If NOT a fusion model → call existing forwarding logic unchanged (extract into a helper if needed for readability).
- If IS a fusion model → execute the dual-rotation cascade.

```typescript
export async function handleGoogleNative(
  req: Request,
  rawKey: string,
  reqId: string
): Promise<Response> {
  const authError = validateGoogleDirective(rawKey);
  if (authError) {
    return authError;
  }

  const url = new URL(req.url);
  const baseUpstreamUrl = buildGoogleNativeUpstreamUrl(url);
  const requestedModel = extractModelFromPath(url.pathname);
  const bodyBuffer = await req.arrayBuffer();

  // ── Non-fusion path: transparent dumb forwarder (existing behavior) ──
  if (!isNativeFusionModel(requestedModel)) {
    return executeSingleModelForward(/* existing args */);
  }

  // ── Fusion path: gemini-flash dual-rotation cascade ──
  const chain = getNativeChain("gemini-flash");          // memory read, zero I/O
  const totalTiers = chain.length;
  if (totalTiers === 0) {
    return Response.json(
      { error: { message: "No native chain configured for gemini-flash", type: "configuration_error" } },
      { status: 500 }
    );
  }

  const startTier = currentFlashTierIndex;               // ← LOCAL PIN (concurrency-safe snapshot)
  let lastResponse: Response | undefined;

  for (let cycleStep = 0; cycleStep < totalTiers; cycleStep++) {
    const tierIdx = (startTier + cycleStep) % totalTiers; // ← derived from local pin, NOT global
    const tierModel = chain[tierIdx];
    const tierUpstreamUrl = buildTierUpstreamUrl(baseUpstreamUrl, tierModel);

    const context: NativeForwardContext = {
      req,
      rawKey,
      reqId,
      url,
      upstreamUrl: tierUpstreamUrl,
      model: tierModel,
      bodyBuffer,
    };

    let tierExhausted = false;
    let totalActiveKeys = Math.max(1, globalKeyPool.getPoolSize("gg"));

    for (let attempt = 1; attempt <= totalActiveKeys; attempt++) {
      const outcome = await attemptNativeForward(context, attempt);

      if (!outcome.retry) {
        const status = outcome.response.status;

        // ── 404: Model unreleased → fast-advance, zero key burn ──
        if (status === 404) {
          logWarn(
            EMOJI.fusion,
            `[FUSION ${reqId}] Tier ${tierIdx + 1} (${tierModel}) → 404. Cascading to Tier ${((tierIdx + 1) % totalTiers) + 1} (${chain[(tierIdx + 1) % totalTiers]})`
          );
          lastResponse = outcome.response;
          tierExhausted = true;
          break;  // exit inner key loop immediately
        }

        // ── Success or non-retryable client error → deliver downstream ──
        if (status < 429 && status !== 404) {
          const resHeaders = new Headers(outcome.response.headers);
          for (const h of STRIPPED_DOWNSTREAM_HEADERS) resHeaders.delete(h);
          resHeaders.set("x-literouter-model", tierModel);
          resHeaders.set("x-literouter-tier", String(tierIdx + 1));

          // Advance global pointer to this tier (it worked — stay here for future requests)
          currentFlashTierIndex = tierIdx;

          logInfo(
            EMOJI.fusion,
            `[FUSION ${reqId}] Tier ${tierIdx + 1} (${tierModel}) → ${status} OK. Served by Tier ${tierIdx + 1}.`
          );

          return new Response(outcome.response.body, {
            status: outcome.response.status,
            statusText: outcome.response.statusText,
            headers: resHeaders,
          });
        }

        // ── 429 / 5xx → retryable, rotate to next key ──
        lastResponse = outcome.response;
      } else {
        // outcome.retry === true → network/timeout error, rotate to next key
        lastResponse = outcome.response;
      }
    }

    // All keys on this tier failed (429/5xx/network) or 404 fast-advance
    if (!tierExhausted) {
      logWarn(
        EMOJI.fusion,
        `[FUSION ${reqId}] Tier ${tierIdx + 1} (${tierModel}) → all ${totalActiveKeys} keys exhausted. Cascading to Tier ${((tierIdx + 1) % totalTiers) + 1} (${chain[(tierIdx + 1) % totalTiers]})`
      );
    }

    // Advance global pointer for NEXT request (and for next iteration's global state)
    currentFlashTierIndex = (startTier + cycleStep + 1) % totalTiers;
  }

  // Full cycle exhausted — all 4 tiers failed
  logWarn(EMOJI.exhausted, `[FUSION ${reqId}] All ${totalTiers} tiers exhausted. Returning 503.`);

  return (
    lastResponse ??
    Response.json(
      { error: { message: "All Google native fusion tiers exhausted", type: "service_unavailable" } },
      { status: 503 }
    )
  );
}
```

#### Step 6: Wire Boot + Reset Hooks in `src/index.ts`

1. Import the new functions:
```typescript
import { loadAndCacheNativeChains, resetNativeFlashTierIndex } from "./handlers/google_native";
```

2. Call `loadAndCacheNativeChains()` at boot (near the existing `initializeKeyPools()` call).

3. Add both to `resetAllState()`:
```typescript
export function resetAllState(): void {
  globalCooldownManager.clearAll();
  globalKeyPool.reset();
  initializeKeyPools();
  clearCircuitBreakerRegistry();
  clearPacerRegistry();
  resetHttp2Pool();
  resetProvidersRegistryCache();
  loadAndCacheNativeChains();       // ← reload chain config from disk
  resetNativeFlashTierIndex();      // ← reset tier pointer to 0
}
```

#### Step 7: Post-Edit Hygiene Validation
```bash
uv run python admin/code_hygiene/agent_guardrail.py validate src/handlers/google_native.ts
```

---

## 8. Existing Code Interactions & Side Effects

### 8.1 `globalKeyPool` Behavior with Fusion

The `globalKeyPool` operates at the **provider level** (`"gg"`), not at the model level. All tiers in the gemini-flash chain share the same `"gg"` key pool.

**Consequence:** When `reportFailure("gg", keyIndex, 429)` quarantines Key 3 during Tier 1 (`gemini-3.8-flash`), Key 3 remains quarantined when Tier 2 (`gemini-3.7-flash`) tries to rotate keys. This is **correct behavior** — if Google rate-limited Key 3, it is rate-limited across all models on that key.

`selectNextKey("gg")` automatically skips quarantined keys. If all keys are quarantined, it returns `null`, and `attemptNativeForward` returns a pool-exhausted response, triggering tier advancement.

### 8.2 Pacer Interaction

The gateway applies **two layers of pacing** for `"gg"` requests:
1. **Edge ingress pacer** in `src/index.ts` via `acquireIngressPacer` (applies to `"gg"` provider).
2. **Handler-level native pacer** inside `attemptNativeForward` via `acquireNativePacer`.

For the fusion cascade, `attemptNativeForward` is called multiple times (once per key attempt, across multiple tiers). Each call acquires the native pacer independently. This pacing is cumulative — each key attempt waits its turn, which naturally throttles upstream request rate during cascade scenarios.

**No changes needed to pacer logic.** The existing pacing architecture correctly governs fusion key rotation without modification.

### 8.3 `MAX_NATIVE_ATTEMPTS` Constant

The existing constant `MAX_NATIVE_ATTEMPTS = 3` constrains the number of key attempts in the dumb forwarder path. In the fusion path, the inner key loop iterates up to `globalKeyPool.getPoolSize("gg")` instead, because the user requirement is: "the retries ARE the key rotations."

**The fusion path does NOT use `MAX_NATIVE_ATTEMPTS`.** It uses the actual key pool size as the inner loop bound. This is a deliberate divergence from the dumb forwarder path.

### 8.4 `reportSuccess` on Non-Retryable Status

The existing codebase calls `reportSuccess("gg", index)` on any non-retryable response (even 404). In the fusion path, a 404 triggers fast-advance without calling `reportSuccess` — the key itself is healthy; the model simply doesn't exist. This prevents false positive "key is healthy" signals that reset cooldown state prematurely.

---

## 9. Verification & Testing Suite

### 9.1 Unit Tests (`tests/unit/google_native_fusion.test.ts`)

Create a dedicated test suite. The tests mock `globalThis.fetch` to simulate upstream responses.

**Critical test cases to cover:**

| # | Test Case | Assert |
|---|---|---|
| 1 | Tier 1 returns 404 | Fast-advances to Tier 2. Only 1 fetch against Tier 1 (zero key burn). `x-literouter-model` = `gemini-3.7-flash`, `x-literouter-tier` = `2`. |
| 2 | Subsequent request after 404 advance | Starts directly at Tier 2 (pointer persists). |
| 3 | All keys return 429 on Tier 1 | Rotates through ALL keys on Tier 1 before advancing to Tier 2. `attemptedKeys.length >= mockKeys.length`. |
| 4 | All 4 tiers fail (global outage) | Returns HTTP 503. Total fetch calls = sum of key pool sizes across 4 tiers (for 429) or 4 calls (for 404). |
| 5 | Tier 1 = 404, Tier 2 = 200 | Response is 200 with `x-literouter-model: gemini-3.7-flash`. |
| 6 | Non-fusion model (`gemini-2.5-flash`) | Bypasses fusion entirely, behaves as dumb forwarder. |
| 7 | Client error (400/401/403) on Tier 1 | Returns client error as-is, does NOT cascade. |
| 8 | `POST /reset` resets tier pointer | After advancing to Tier 3, `resetNativeFlashTierIndex()` resets to Tier 0. |
| 9 | `google/gemini-flash` prefix variant | `extractModelFromPath` strips prefix; fusion triggers correctly. |
| 10 | Concurrent requests (two in-flight) | Both pin `startTier` independently; neither skips tiers. |

**Test setup pattern** (matching existing `tests/unit/google_native_dumb_forwarder.test.ts`):
```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { resetAllState } from "../../src/lib";
import {
  handleGoogleNative,
  resetNativeFlashTierIndex,
  getCurrentFlashTierIndex,
  loadAndCacheNativeChains,
} from "../../src/handlers/google_native";

describe("Google Native gemini-flash Fusion", () => {
  const originalFetch = globalThis.fetch;
  const originalEnvGoogle = process.env.GOOGLE_API_KEYS;
  const mockKeys = ["AIzaSyMockKey1-test-stub", "AIzaSyMockKey2-test-stub"];

  beforeEach(() => {
    process.env.GOOGLE_API_KEYS = mockKeys.join(",");
    resetAllState();
    resetNativeFlashTierIndex();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalEnvGoogle !== undefined) {
      process.env.GOOGLE_API_KEYS = originalEnvGoogle;
    } else {
      delete process.env.GOOGLE_API_KEYS;
    }
    resetAllState();
    resetNativeFlashTierIndex();
  });

  // ... test cases here ...
});
```

### 9.2 Running Verification Commands
```bash
# 1. Typecheck
bun run typecheck

# 2. Run fusion unit tests
bun test tests/unit/google_native_fusion.test.ts

# 3. Run ALL unit tests (ensure no regressions)
bun test

# 4. Code hygiene
node node_modules/clean_ts/dist/cli.js validate src/handlers/google_native.ts

# 5. Python integration smoke tests (against running gateway)
uv run pytest tests/integration/
```

### 9.3 Live Gateway Smoke Tests

After implementing the code changes and deploying the updated LiteRouter:

```bash
# Restart LiteRouter daemon
bash scripts/restart.sh

# Non-streaming probe (expect cascade from 3.8→3.7 if 3.8 not yet deployed)
curl -sk -X POST "https://localhost:7766/v1beta/models/gemini-flash:generateContent?key=lr-gg-gg-gc-no" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"ping"}]}]}' -v 2>&1 | grep -i "x-literouter"

# Expected output:
# < x-literouter-model: gemini-3.7-flash
# < x-literouter-tier: 2

# Streaming probe
curl -sk -N -X POST "https://localhost:7766/v1beta/models/gemini-flash:streamGenerateContent?alt=sse&key=lr-gg-gg-gc-no" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"Count to 3."}]}]}'

# Expected output:
# Valid SSE stream starting with data: {"candidates": [...]}

# Non-fusion model (dumb forwarder — should NOT trigger fusion)
curl -sk -X POST "https://localhost:7766/v1beta/models/gemini-2.5-flash:generateContent?key=lr-gg-gg-gc-no" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"ping"}]}]}' -v 2>&1 | grep -i "x-literouter"

# Expected output: NO x-literouter-model or x-literouter-tier headers
```

---

## 10. Future Extensibility: `gemini-flash-lite`

The `native_chains` schema in `config/fusion.json` is designed for multiple chains. To add `gemini-flash-lite` in the future:

1. **Config only** — add to `config/fusion.json`:
```json
{
  "native_chains": {
    "gemini-flash": ["gemini-3.8-flash", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-3.5-flash"],
    "gemini-flash-lite": ["gemini-3.8-flash-lite", "gemini-3.7-flash-lite", "gemini-3.6-flash-lite", "gemini-3.5-flash-lite"]
  }
}
```

2. **One-line code change** — extend `isNativeFusionModel`:
```typescript
function isNativeFusionModel(model: string): boolean {
  return model === "gemini-flash" || model === "gemini-flash-lite";
}
```

3. **Add a second tier pointer** — `currentFlashLiteTierIndex` (or generalize into a `Map<string, number>` keyed by chain name).

The current design deliberately keeps it simple for `gemini-flash` as the prototype. The generalized `Map` approach can be refactored when the second chain is added.

---

## 11. Handoff & Acceptance Checklist

- [ ] `config/fusion.json` updated with `"native_chains": { "gemini-flash": [...] }`.
- [ ] `models.json` (root) left completely untouched.
- [ ] `src/handlers/google_native.ts` implements:
  - [ ] `loadAndCacheNativeChains()` — boot-time cached config (zero I/O on hot path).
  - [ ] `resetNativeFlashTierIndex()` and `getCurrentFlashTierIndex()` exported for tests.
  - [ ] `isNativeFusionModel()` — strict trigger on `"gemini-flash"` only.
  - [ ] `getNativeChain()` — memory-only chain lookup with hardcoded fallback.
  - [ ] `buildTierUpstreamUrl()` — regex-based URL rewrite (handles `google/` prefix safely).
  - [ ] Fusion dispatch loop with **local tier pinning** (`const startTier = currentFlashTierIndex`).
  - [ ] Fast-advance on 404 (0 keys burned).
  - [ ] Round-robin key rotation on 429/5xx before tier advancement.
  - [ ] Maximum 1 full cycle safeguard per request (4 tiers max).
  - [ ] Pre-stream failover only; clean stream termination on mid-stream drops.
  - [ ] Injects `x-literouter-model` and `x-literouter-tier` downstream headers.
  - [ ] Injects OpenCode identity headers upstream to Google.
- [ ] `src/index.ts` modified:
  - [ ] `loadAndCacheNativeChains()` called at boot.
  - [ ] `loadAndCacheNativeChains()` and `resetNativeFlashTierIndex()` added to `resetAllState()`.
- [ ] All verification gates pass:
  - [ ] `bun run typecheck` — zero errors.
  - [ ] `bun test` — all tests pass (including new fusion tests).
  - [ ] `node node_modules/clean_ts/dist/cli.js validate src/handlers/google_native.ts` — valid.
  - [ ] Live `curl` tests return 200 OK with `x-literouter-model` header.
- [ ] Task closed in beads (`bd close literouter-rg8k`).
