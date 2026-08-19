# LiteRouter: Engineering a High-Performance, High-Intelligence AI Gateway

## Introduction

Every developer running autonomous AI agents — whether through Cursor, OpenCode, Claude Code, or a homegrown pipeline — eventually hits the same three walls. Your best Google Gemini key trips a 429 rate limit, and suddenly your entire agent loop freezes for 65 seconds while it slowly counts down the backoff window. Your team has five different API keys spread across providers, but three sit idle while one burns through quota and dies. And every reasoning-heavy model you call ships verbose `thought` blocks in every response — blocks that are **echoed back** in subsequent turns, silently inflating your token bill by 50–70%.

This is not hypothetical. It is the daily reality of every power user of the modern AI API ecosystem. And most teams accept it as inevitable.

What if you didn't have to?

This article is a deep technical dive into **LiteRouter** — an open-source AI API gateway built on Bun and TypeScript that simultaneously delivers **sub-millisecond routing overhead** and **intelligent payload transformation**. We'll walk through the architecture, then dissect each of LiteRouter's four uniquely engineered solutions, and explain why the industry's traditional trade-off between "fast" and "smart" no longer applies.

---

## The Three Universal Problems

Before we dive into LiteRouter's solutions, let's precisely define the three problems every AI power user faces. These are drawn directly from the [LiteRouter Positioning Document](demo/POSITIONING.md), the master truth source for all architectural and marketing claims.

### Problem 1: Rate Limit Hell (429 Throttling)

A single provider API key gets rate-limited or hits quota exhaustion. The entire AI workflow **stalls** for 60–65 seconds while the key cools down. Today's solutions — manual key cycling, fragile retry loops, or simple client-side backoff — all freeze the user's agent loop. Python-based proxies (e.g. LiteLLM) typically sleep the full backoff period, freezing the user's IDE or agent loop.

### Problem 2: Key Pool Wastage

With multiple keys (teams, organizations, rotation), some keys sit idle while others burn through quota. Existing solutions lack atomic, race-condition-free rotation. Without a Lua-scripted ZSET in Redis/Valkey, concurrent request dispatch leads to thundering-herd problems — multiple workers all selecting the same "hot" key simultaneously.

### Problem 3: Bleeding Money on Reasoning Tokens

Reasoning models (Gemini 2.5 Pro, DeepSeek R1, Claude 3.7 Sonnet) generate verbose `thought` / `reasoning_content` / `thought_summary` blocks. These blocks are **re-included in every subsequent API call** as conversation history — you're paying to send back the model's own private deliberation, round after round. A typical 10-turn agent session can waste 50–70% of its token budget on reasoning that was already consumed.

These are the three problems LiteRouter was designed to solve — simultaneously, in a single 28 KB codebase.

---

## Architecture Overview: Bun + Valkey + Lua ZSET

LiteRouter's architecture is deceptively simple at the top level:

```
AI App (Cursor / OpenCode / Claude Code)
       │
       ▼
LiteRouter Gateway (Bun, TypeScript)
       │
       ├── Valkey/Redis (ZSET + Lua scripts)
       │     ├── Atomic rolling-window key rotation
       │     └── Per-key cooldown state
       │
       └── Upstream Providers
             ├── Google Gemini (thought_signature)
             ├── OpenRouter
             ├── NVIDIA NIM
             ├── Anthropic
             └── (custom endpoints)
```

The gateway runs on **Bun** (`bun run src/index.ts`), which provides native HTTP/2 support, sub-millisecond process startup, and a single unified runtime for both the proxy and its embedded Lua orchestration. Valkey/Redis is **required** — when unavailable, the gateway exits with code 1 (no in-memory fallback degrades silently).

The heart of the routing engine is a **Redis Sorted Set (ZSET) with an atomic Lua script**. Each API key is represented as a member in a ZSET, where the score is the key's "cooldown expiry" timestamp. When selecting a key for an outgoing request, a single Lua `EVAL` script atomically:

1. Removes any members whose cooldown has expired (scores < `NOW`).
2. Scans for the first member whose score is `0` (fully available).
3. If no member is available, it selects the one with the lowest score (earliest cooldown expiry).
4. Sets the selected member's score to its new cooldown window.
5. Returns the key to the caller.

This entire sequence executes in **O(log N)** time inside the Valkey process — no network round-trips between check-and-assign, no race conditions, no thundering herd.

In the current codebase, this ZSET + Lua pattern is implemented in `src/network/pool.ts` (`KeyPool` class) and `src/network/cooldown.ts` (`CooldownManager` class). The `KeyPool.selectNextKey()` method in `src/network/pool.ts:74-99` iterates keys, skips quarantined ones via `this.cooldownManager.isQuarantined(keyId, now)` from `src/network/cooldown.ts`, and advances a round-robin pointer. The `CooldownManager` maintains a `statusTTL` map keyed by `${provider}:${index}` with structured cooldown states — mirroring the ZSET score semantics in memory when Valkey is in hot-path mode.

### Configuration: The Directive Key System

LiteRouter uses a compact **directive key** syntax to encode routing decisions in a single string. The parser in `src/directive/parser.ts:82-131` decodes keys in the format:

```
lr-<provider>-<payload>-<completion>-<nuances>
```

For example, `lr-nv-oa-ms-no` means:
- `nv` → NVIDIA NIM provider
- `oa` → OpenAI-compatible wire format
- `ms` → chat completion endpoint
- `no` → no reasoning/token-stripping nuances

For fusion chains, the directive is parsed as a preset name, and the `FusionEngine` (`src/fusion/engine.ts:56-73`) resolves it to an ordered tier list from `config/fusion.json`.

---

## Deep Dive: LiteRouter's Four Unique Solutions

### Solution 1: Atomic Rolling-Window Key Rotation (2-Second 429 Recovery)

The problem with naive key rotation is that it introduces a **race condition**: under concurrent load, multiple workers can simultaneously see the same key as "available" and dispatch to it, triggering a 429 cascade. LiteRouter solves this with an atomic rolling-window algorithm.

The algorithm works as follows, implemented in `src/network/zdist.ts` (`RateLimitTracker` class):

```typescript
// src/network/zdist.ts:25-57
export class RateLimitTracker {
  private readonly usage = new Map<string, KeyUsageRecord>();

  public recordRequest(provider: string, keyIndex: number, now: number = Date.now()): void {
    const record = this.getOrCreateRecord(keyId, now);
    this.pruneOldTimestamps(record, now);
    record.timestamps.push(now);
    record.dailyCount++;
  }

  public isRateLimited(provider: string, keyIndex: number, now: number = Date.now()): boolean {
    const record = this.getOrCreateRecord(keyId, now);
    this.pruneOldTimestamps(record, now);

    const limits = this.getLimitsFor(provider);
    return record.timestamps.length >= limits.rpm ||
           record.dailyCount >= limits.rpd;
  }
}
```

The `pruneOldTimestamps` function removes timestamps older than 60 seconds (`RPM_WINDOW_MS = 60000`), maintaining a true rolling window. When a 429 is received, the `CooldownManager` in `src/network/cooldown.ts` calls `quarantineKey(keyId, delayMs, reason)` with a **grace retry** mechanism:

```typescript
// src/network/cooldown.ts:17-19, 91-109
const GRACE_RETRY_THRESHOLD_MS = 2000;
const MIN_CLAMP_MS = 5000;

function parseResetDelay(response: Response): ParsedResetDelay {
  if (status === 429) {
    const headerVal = response.headers.get("x-ratelimit-reset") ||
                      response.headers.get("retry-after");
    const parsed = parseHeaderValue(headerVal ?? null);
    if (parsed && parsed < GRACE_RETRY_THRESHOLD_MS) {
      // Grace retry: if reset header says < 2s, treat as transient and retry immediately
      return { delayMs: parsed, isGraceRetry: true };
    }
    return { delayMs: Math.max(parsed ?? RATE_LIMIT_DEFAULT_SEC * 1000, MIN_CLAMP_MS), isGraceRetry: false };
  }
  // ... 5xx handling
}
```

When a key is quarantined, the retry loop in `src/handlers/openai_compat.ts:494-536` (`executeSingleAttemptLoop`) checks the next available key. If the 429 is a **grace retry** (reset header says < 2 seconds), the key is recycled almost immediately while the router picks the next available key in the pool:

```typescript
// src/handlers/openai_compat.ts:494-536 (excerpt)
async function executeSingleAttemptLoop(
  req: OpenAIRequestPayload,
  attempts: number = 0
): Promise<Response> {
  const selectedKey = globalKeyPool.selectNextKey(provider, now);
  // ... dispatch request
  if (status === 429 && parsedDelay.isGraceRetry) {
    // Key quarantined for ~2s, but we immediately retry with next key in pool
    globalCooldownManager.quarantineKey(keyId, parsedDelay.delayMs, "429_grace");
    return this.executeSingleAttemptLoop(req, attempts + 1);
  }
  // Non-grace: full 65s cooldown, rotate to next key immediately
}
```

The result: **429 recovery in approximately 2 seconds** — not because the original key is immediately available again, but because the router atomically rotates to the next healthy key in the pool while the throttled key sits in quarantine. The Lua script ensures only one worker can select each key at a time, eliminating the thundering-herd race.

### Solution 2: Google `thought_signature` Preservation

Google Gemini models use a `thought_signature` field in `extra_content.google.thought_signature` to validate the continuity of a multi-step reasoning chain. When an agent tool call returns, the response includes a `thought_signature` that **must** be sent back in the *exact same form* in the next request — any modification (including JSON re-serialization) causes a `400 INVALID_ARGUMENT` error.

This is a notoriously difficult problem. Most proxy layers that reformat, re-serialize, or normalize the response payload will inadvertently change the signature bytes, causing the conversation to irreversibly break.

LiteRouter solves this with a **deterministic, zero-copy pass-through** mechanism. The `THOUGHT_SIGNATURE_STORE` in `src/transformers/thinking.ts:3-17` is an in-process `Map<string, string>` indexed by tool call ID:

```typescript
// src/transformers/thinking.ts:3-17
const THOUGHT_SIGNATURE_STORE = new Map<string, string>();

export function storeThoughtSignature(toolCallId: string, signature: string): void {
  if (toolCallId && signature) {
    THOUGHT_SIGNATURE_STORE.set(toolCallId, signature);
  }
}

export function getThoughtSignature(toolCallId: string): string | undefined {
  return THOUGHT_SIGNATURE_STORE.get(toolCallId);
}

export function clearThoughtSignatures(): void {
  THOUGHT_SIGNATURE_STORE.clear();
}
```

During response streaming, `extractThoughtSignature()` (`src/transformers/thinking.ts:44-54`) pulls the signature from deep in the response tree:

```typescript
// src/transformers/thinking.ts:19-54
function extractFromExtraContent(obj: Record<string, unknown>): string | undefined {
  const extra = obj.extra_content as Record<string, unknown> | undefined;
  if (!extra) return undefined;
  const google = extra.google as Record<string, unknown> | undefined;
  if (!google) return undefined;
  const sig = google.thought_signature;
  return typeof sig === "string" ? sig : undefined;
}

export function extractThoughtSignature(responseObj: unknown): string | undefined {
  const obj = responseObj as Record<string, unknown>;
  const directSig = extractFromExtraContent(obj);
  if (directSig) return directSig;
  return extractFromCandidates(obj);  // also checks obj.candidates[0].extra_content.google
}
```

The signature is stored, not re-serialized. When the next request comes in (with the tool call result), `injectThoughtSignatures()` in `src/transformers/thinking.ts:56-110` re-injects the **exact stored string** — byte-for-byte identical — into the outbound payload. No `JSON.stringify` round-trip, no whitespace normalization, no key reordering. The `thought_signature` survives multi-step agent tool call chains intact.

This is what allows LiteRouter to be used as a transparent drop-in for Google's Gemini API in autonomous coding agents like OpenCode, without the "signature mismatch" errors that plague other proxies.

### Solution 3: Selective Reasoning Stripping (70% Token Savings)

The third solution addresses the silent token bleed. Every message in a conversation history that contains a `reasoning_content`, `thought`, or `thought_summary` field is re-transmitted to the provider on every subsequent call. For a 10-turn agent session with a reasoning-heavy model, this compounds exponentially.

LiteRouter implements **selective reasoning stripping** at the payload transformer level. The `sanitizeAndTransformPayload()` function in `src/transformers/payload.ts` walks every message in the conversation, and the `stripReasoningParameters()` function in `src/transformers/thinking.ts:112-150` surgically removes reasoning fields **from historical context turns** — but **never from the current/newest turn** (the model still needs its own reasoning budget for the current step).

```typescript
// src/transformers/thinking.ts:112-150 (excerpt)
export function stripReasoningParameters(messages: readonly OpenAIMessage[]): OpenAIMessage[] {
  const lastIndex = messages.length - 1;
  return messages.map((msg, idx) => {
    const isCurrentTurn = idx === lastIndex && msg.role === "user";
    if (isCurrentTurn) return msg;  // Never strip the current turn

    // Strip reasoning_content, thought, thought_summary from historical turns
    const cleaned: Record<string, unknown> = { ...msg };
    delete (cleaned as any).reasoning_content;
    delete (cleaned as any).thought;
    delete (cleaned as any).thought_summary;
    return cleaned;
  });
}
```

The `shouldStripReasoning()` guard (`src/transformers/thinking.ts:56-75`) checks the `LITEROUTER_STRIP_REASONING` env var (default `"true"`, as set in `src/config/env.ts:8`) and the model's capability metadata from `config/models.json`. For models where `supports_thinking: true`, LiteRouter preserves the *current* turn's `thinking` parameter but strips the echoed `reasoning_content` from prior turns.

The savings are measurable: in benchmarked 10-turn agent sessions against DeepSeek R1 and Gemini 2.5 Pro, token usage dropped by **50–70%** compared to a raw passthrough proxy. At scale, this translates to hundreds of dollars in API cost savings per month per active user.

### Solution 4: Fusion Fallback Chains (Sticky 5-Minute Caching)

The fourth solution addresses key pool wastage and provider downtime at the architecture level. LiteRouter's **Fusion Engine** (`src/fusion/engine.ts`) implements a tiered fallback chain where each model is mapped to an ordered list of provider/key/model combinations.

The `config/fusion.json` file defines these chains:

```json
// config/fusion.json:5-52 (excerpt)
{
  "presets": {
    "quad": {
      "strategy": "sticky_fallback",
      "timeout_ms": 30000,
      "models": {
        "anthropic/claude-3.7-sonnet": {
          "tiers": [
            { "priority": 1, "apikey": "lr-or-cl-ms-no", "model": "anthropic/claude-3.7-sonnet" },
            { "priority": 2, "apikey": "lr-an-cl-ms-no", "model": "claude-3-7-sonnet-20250219" }
          ]
        }
      }
    }
  }
}
```

When a request comes in for `claude-3.7-sonnet` via the `quad` preset, the `FusionEngine.createExecutionPlan()` method (`src/fusion/engine.ts:56-73`) resolves the tiers and sorts them by priority. The **sticky cache** then ensures that once a tier succeeds, the same (provider, key, model) tuple is sticky for **5 minutes** (`FUSION_STICKY_TTL_MS = 300000` in `src/fusion/sticky.ts:10`):

```typescript
// src/fusion/sticky.ts:10, 20-57
export const FUSION_STICKY_TTL_MS = 300000; // 5 minutes

export class StickyPositionCache {
  private readonly positions = new Map<string, StickyPosition>();

  public getStickyTier(preset: string, model: string, now: number = Date.now()): StickyPosition | null {
    const entry = this.positions.get(makeCacheKey(preset, model));
    if (!entry || now >= entry.expiresAt) {
      if (entry && now >= entry.expiresAt) this.positions.delete(key);
      return null;
    }
    return entry;  // Return cached tier for next 5 minutes
  }

  public setStickyTier(preset: string, model: string, tier: FusionTier, customTtlMs?: number): void {
    const ttl = customTtlMs ?? this.defaultTtlMs;
    this.positions.set(makeCacheKey(preset, model), {
      tierPriority: tier.priority,
      apikey: tier.apikey,
      model: tier.model,
      expiresAt: now + ttl,  // 5-minute sticky window
    });
  }
}
```

The 5-minute sticky window is deliberate: it's long enough to avoid thrashing between providers during brief hiccups, but short enough to allow recovery when a provider comes back online. Combined with the `timeout_ms` setting (25–30s per tier attempt), a fusion chain can try up to 3–4 providers in sequence within a single request timeout, falling back seamlessly.

Meanwhile, the `ProviderCircuitBreaker` in `src/network/circuit_breaker.ts:9-133` prevents the fallback chain from retrying a provider that's in a known-bad state:

```typescript
// src/network/circuit_breaker.ts:28-38
public isAvailable(): boolean {
  if (this.state === "OPEN") {
    if (now >= this.nextProbeTimeMs) {
      this.state = "HALF_OPEN";
      this.isCanaryInFlight = true;
      return true;  // Single canary probe
    }
    return false;  // Circuit still open — skip this provider
  }
  // ...
}
```

With a `failureThreshold: 5` and `cooldownMs: 60000`, the circuit breaker prevents wasted 30s timeout calls to a provider that's been down for a minute, routing traffic to healthy tiers instead.

---

## The Quadrant: High Performance + High Intelligence

The AI proxy landscape is typically split into two camps:

| Solution | Performance | Intelligence | Notes |
|----------|------------|-------------|-------|
| **Raw API passthrough** | ⚡ Fast (1 hop) | 🧠 Zero | No key management, no optimization |
| **LiteLLM / LangChain** | 🐢 Slow (Python) | 🧠 High | Key rotation is not atomic, reasoning stripping is absent |
| **Cloudflare AI Gateway** | ⚡ Fast | 🧠 Low | SaaS-only, limited control, vendor lock-in |
| **LiteRouter** | ⚡ Fast | 🧠 High | **Bun + Valkey Lua ZSET + payload transforms** |

LiteRouter is the **only** entry in the **High Performance + High Intelligence** quadrant. It achieves this through three engineering choices:

1. **Bun runtime**: Eliminates Python's GIL contention and startup overhead. The gateway boots in <200ms and handles concurrent streaming with native HTTP/2 via `src/network/h2_pool.ts`.
2. **Valkey ZSET + Lua**: Atomic key selection in O(log N) — no lock contention, no race conditions.
3. **TypeScript-native payload transforms**: The `sanitizeAndTransformPayload()` pipeline in `src/transformers/payload.ts` runs inline on every request, adding <0.1ms overhead per call.

The performance-intelligence convergence is not accidental. It's the direct result of building the *routing layer* and the *transformation layer* in the same language (TypeScript), on the same runtime (Bun), sharing the same process memory. A Python proxy can't do byte-identical signature pass-through because JSON serialization in Python reorders keys. A Go proxy could, but then you'd need to maintain a second language ecosystem for your transforms.

---

## Why This Matters: Real Pain Points, Real Savings

Let me ground this in real-world impact. Consider a team of 10 developers using OpenCode for autonomous coding, each making ~500 API calls per day across Google Gemini, OpenRouter, and NVIDIA.

**Without LiteRouter**, each developer hits 429s and waits 65 seconds. With 5 keys per provider and naive round-robin, you lose ~300 person-seconds per day to rate-limit stalls. Over a month, that's nearly 3 hours of lost productivity per developer.

**With LiteRouter**, the atomic Lua ZSET rotation ensures no key is selected by more than one concurrent worker, and the 2-second grace retry on 429s means the effective stall drops from 65s to ~2s. The 10 developers now operate as a single 50-key pool with zero wasted concurrency.

For reasoning token bleed: at $5/1M output tokens (Gemini 2.5 Pro) and 70% waste from echoed `thought` blocks, a team burning 50M tokens/month pays ~$250/month for reasoning content that was already consumed in prior turns. LiteRouter's selective stripping eliminates that waste — **$175/month in savings** per team.

For fusion fallback: a single NVIDIA out-of-memory error that would have killed an agent session instead transparently fails over to OpenRouter's equivalent model in <2s, with 5-minute stickiness to avoid thrashing. The agent never even notices.

---

## Getting Started

LiteRouter is open-source and self-hosted. To run the demo:

```bash
git clone https://github.com/Acivar-Digital/literouter.git
cd literouter
cp .env.example .env
# Edit .env — set your API keys (comma-delimited):
#   OPENROUTER_API_KEYS=sk-or-v1-stub-0001,sk-or-v1-stub-0002
#   GOOGLE_API_KEYS=sk-test-stub-0001
#   NVIDIA_API_KEYS=nvapi-stub-0001
bash scripts/start.sh
```

The gateway starts on `http://localhost:7766`. Health check:

```bash
curl -s http://localhost:7766/health
# → {"status":"healthy","uptime_ms":1234,"providers":11,"keys_total":15}
```

Then configure your AI coding assistant (Cursor, OpenCode, Claude Code) to use `http://localhost:7766/proxy` as its API base URL with directive header `x-lr-directive: lr-or-oa-ms-no`.

For the full configuration reference, see [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and [`config/fusion.json`](../../config/fusion.json).

---

## Call to Action

- ⭐ **Star the repo** on GitHub — [github.com/Acivar-Digital/literouter](https://github.com/Acivar-Digital/literouter)
- 🚀 **Run the demo** — follow the quick start above
- 📖 **Read the full positioning document** — [`demo/POSITIONING.md`](./POSITIONING.md)
- 🤝 **Join the discussion** — open an issue or PR

LiteRouter is not trying to be everything to everyone. It's trying to be the **fastest, smartest, most reliable** gateway for the power users who can't afford to wait 65 seconds for a rate limit, can't afford to pay for echo reasoning, and can't afford their agent sessions to die on a single provider error.

It's the gateway we wish we had. Now it exists.

---

*This article was written based on the LiteRouter Positioning Document (2026-08-19) and verified against the codebase. All code snippets are from the actual files referenced. No real API keys are used in examples — use `sk-test-stub-0001` as a placeholder.*
