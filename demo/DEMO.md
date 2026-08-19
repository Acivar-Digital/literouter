# LiteRouter Demo Walkthrough

> **🧭 MASTER TRUTH SOURCE:** `demo/POSITIONING.md` — all claims in this demo are verified against the positioning document.

This guide walks you through running the LiteRouter upsell demo, which showcases the three core problems every AI power user faces and how LiteRouter solves them.

---

## Prerequisites

| Tool | Version | Required? |
|------|---------|-----------|
| Bun | 1.2+ | ✅ YES |
| LiteRouter gateway | v3.1+ | ❌ Optional (demo runs in simulation if gateway is down) |
| Valkey/Redis | any | ❌ Optional (in-memory fallback available) |

---

## Quick Start

```bash
# Option A: Just run the demo (simulation mode if gateway is down)
bun run demo/demo_upsell.ts

# Option B: Start the gateway first, then run for live probes
bash scripts/start.sh
bun run demo/demo_upsell.ts
```

The demo automatically detects whether the LiteRouter gateway is running on `http://localhost:7766`. If it is, the demo makes real API calls through the gateway. If not, it runs in **simulation mode** with clearly-labeled `SIMULATION` output.

---

## What the Demo Shows

### Scenario 1: 429 Rate-Limit Failover

**The Problem (Before LiteRouter):**
When a provider API key gets rate-limited (HTTP 429), most proxies make the client sleep for the full backoff window — **65 seconds**. Your entire AI agent loop (Cursor, OpenCode, Claude Code) freezes. No tools, no output, no progress.

**The LiteRouter Solution:**
LiteRouter detects the 429 and immediately selects the next healthy key from the pool using an atomic Lua ZSET script (`src/network/zdist.ts` + `src/network/cooldown.ts`). The `LITEROUTER_ROTATE_DELAY_MS=2000` config means failover completes in **~2 seconds**. The client never stalls.

**Expected Output:**
```
Scenario 1: 429 Rate-Limit Failover
  ⚠️ Traditional Proxy: 65 seconds of dead time per 429
  ✅ LiteRouter: <2 second failover with atomic key rotation
  ℹ️ Source: src/network/cooldown.ts (quarantine) + src/network/zdist.ts (Lua ZSET)
```

### Scenario 2: Reasoning Token Stripping (70% Cost Savings)

**The Problem (Before LiteRouter):**
Google Gemini, DeepSeek, and other reasoning models emit `<thinking>` blocks on every response. These blocks are echoed back in subsequent conversation turns, silently inflating your token bill by **50–70%** — for output nobody ever reads.

**The LiteRouter Solution:**
With `LITEROUTER_STRIP_REASONING=true`, LiteRouter's `stripReasoningParameters` transformer (`src/transformers/thinking.ts`) strips historical `<thinking>` blocks before forwarding to the upstream provider. The `thought_signature` is preserved across multi-step agent tool calls to prevent Gemini signature validation errors.

**Expected Output:**
```
Scenario 2: Reasoning Token Stripping
  ⚠️ Without LiteRouter: 3,000 thinking tokens + 1,000 answer tokens × 30K turns = $1,200
  ✅ With LiteRouter: 70% reduction → ~$360/month
  ℹ️ Source: src/transformers/thinking.ts (stripReasoningParameters)
```

### Scenario 3: Atomic Multi-Key Rotation

**The Problem (Before LiteRouter):**
Python-based proxies (e.g., LiteLLM) do simple round-robin across API keys. Under concurrent load, race conditions cause the "thundering herd" problem — multiple requests pick the same key before the index advances, burning it out while others sit idle.

**The LiteRouter Solution:**
LiteRouter uses a single `EVAL` round-trip that atomically chains `ZRANGEBYSCORE` + `ZCARD` + `HGET` + `ZADD` + `HSET` + `ZREM` in Redis/Valkey. No race window exists between read and write. Every key is fully utilized with zero boundary bursts. In-memory fallback is available when Valkey is absent.

**Expected Output:**
```
Scenario 3: Atomic Multi-Key Rotation
  ⚠️ Python proxies: race conditions → thundering herd → key burnout
  ✅ LiteRouter: single EVAL round-trip, atomic ZRANGEBYSCORE + ZADD + ZREM
  ℹ️ Source: src/network/zdist.ts (Lua script), src/network/cooldown.ts (rolling window)
```

---

## Live Gateway Probe

If the gateway is running, the demo also performs:

1. **Health check** — `GET /health` confirms the gateway is up
2. **Chat completions test** — `POST /v1/chat/completions` with a test prompt
3. **Response inspection** — checks served model header (`X-Literouter-Model`)

**Authentication:** The demo uses `Authorization: Bearer sk-lr-your-auth-key` (from `.env.example`). This is the gateway's client auth key, not a provider API key. LiteRouter rotates the real provider keys internally.

**Test models:** The demo probes `openrouter/meta-llama/llama-4-maverick:free` as a safe, widely-available free-tier model. Fusion groups (`pydantic/google`, `pydantic/nvidia`, `pydantic/flash`) are also available — see `fusion.json` for the full chain.

---

## No Gateway Running?

If you see:

```
⚠️ LiteRouter gateway not detected — running in demonstration mode
⚠️ All outputs below are SIMULATED. Start the gateway for live probes:
```

This means the demo couldn't reach `http://localhost:7766/health`. To fix:

```bash
bash scripts/start.sh
# Wait for: 🟢 LiteRouter Gateway Active
# Then re-run:
bun run demo/demo_upsell.ts
```

The simulation mode still illustrates all three scenarios clearly — every simulated output is prefixed with `[SIMULATION]` so there's no ambiguity.

---

## Source Files Referenced

| Feature | Source File(s) | Environment Variable |
|---------|----------------|---------------------|
| Key rotation | `src/network/zdist.ts` | `OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS` |
| Cooldown/quarantine | `src/network/cooldown.ts` | `LITEROUTER_ROTATE_DELAY_MS` |
| Reasoning stripping | `src/transformers/thinking.ts` | `LITEROUTER_STRIP_REASONING` |
| Fusion fallback | `src/fusion/engine.ts`, `src/fusion/sticky.ts` | `fusion.json` |
| Ghost detection | `src/network/ghost_detection.ts` | `LITEROUTER_IDLE_TIMEOUT` |

---

## Cost Comparison Summary

| Metric | Without LiteRouter | With LiteRouter |
|--------|-------------------|-----------------|
| 429 recovery time | 65 seconds | ~2 seconds |
| Reasoning token waste | 50–70% of bill | ~0% (stripped) |
| Key race conditions | Thundering herd | Atomic (zero races) |
| Resource footprint | Python + Redis | Single Bun process |

> **All key placeholders:** No real API keys are used in this demo. The auth key `sk-lr-your-auth-key` and stub key `sk-test-stub-0001-padded-to-look-like-real` are examples only. LiteRouter reads real provider keys from `.env.local` at startup.
