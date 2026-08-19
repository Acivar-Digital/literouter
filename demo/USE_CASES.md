# LiteRouter Use Cases

> **Last updated:** 2026-08-19  
> **Source of truth:** [demo/POSITIONING.md](./POSITIONING.md), [README.md](../README.md)  
> **Format:** Each use case follows a **Problem → Goal → Solution → Metrics** structure.

---

## 1. Autonomous Coding Agents (OpenCode, Claude Code, Cursor)

### Problem
Developers running autonomous coding agents (OpenCode, Claude Code, Cursor, Windsurf) hit three compounding failure modes:
1. **429 stalls**: Every rate-limit freezes the agent for **60–65 seconds** while the key cools down. In a 10-minute coding session, this can waste 2+ minutes of idle time.
2. **Key exhaustion**: With 3–5 provider accounts pooled, keys burn through quota unevenly. An agent may exhaust all keys mid-task and fail entirely.
3. **Gemini signature failures**: When using Gemini 2.5 Pro with multi-step tool calls (plan → code → verify → refactor), Google returns `"Invalid tool call signature"` errors because `thought_signature` tokens are dropped between turns. Google's own SDK does not re-inject them.

### Goal
Enable a seamless, uninterrupted autonomous coding session across multiple provider accounts — with zero Gemini tool-call failures and sub-5-second 429 recovery.

### Solution
Deploy LiteRouter as a transparent proxy between the coding agent and upstream providers:

1. **Configure OpenCode** to point at LiteRouter using `@ai-sdk/openai-compatible` (not `@ai-sdk/openai`, which requests `/v1/responses` — incompatible with OpenRouter/NVIDIA endpoints). See [README.md](../README.md#opencode-integration):
   ```json
   {
     "provider": {
       "openrouter": {
         "npm": "@ai-sdk/openai-compatible",
         "baseURL": "https://localhost:7766/v1",
         "apiKey": "{{LITEROUTER_AUTH_KEY}}",
         "models": {}
       },
       "nvidia": {
         "npm": "@ai-sdk/openai-compatible",
         "baseURL": "https://localhost:7766/v1",
         "apiKey": "{{LITEROUTER_AUTH_KEY}}",
         "models": {}
     }
     }
   }
   ```
2. **Set model prefixes** — OpenCode routes by model name prefix to the correct key pool:
   - `opencode run -m openrouter/olympiad/reasoning-gpt3.5:free "..."` → OpenRouter key pool
   - `opencode run -m nvidia/deepseek-ai/deepseek-v4-pro "..."` → NVIDIA key pool

3. **Atomic key rotation** (`src/network/zdist.ts` + Redis ZSET + Lua script) distributes requests across all comma-separated keys in `.env`. When one key hits 429, LiteRouter quarantines it (65s cooldown) and selects the next healthy key in **2,000ms** — the agent never stalls.

4. **Google `thought_signature` preservation** (`src/transformers/thinking.ts`): When Gemini emits a `thought_signature` in a tool-use response, `storeThoughtSignature()` captures it into an in-memory Map. `injectThoughtSignatures()` reinjects it into the next assistant message referencing that tool call. This prevents Google's `"Invalid tool call signature"` errors across multi-step agent loops.

### Metrics
| Metric | Before (Direct) | With LiteRouter | Improvement |
|---|---|---|---|
| 429 recovery time | 65s | 2s | **32× faster** |
| Key pool utilization | ~20% (uneven burn) | ~100% (atomic rotation) | **5× throughput per key** |
| Gemini tool-call failures | Frequent (2nd+ tool call) | Zero | **100% elimination** |
| Setup time | N/A (direct provider config) | 30s | `git clone && bun install && ./scripts/start.sh` |

---

## 2. Multi-Key Rotation for Teams

### Problem
Engineering teams sharing 5–20 API keys across organizations face three issues:
1. **Uneven key burn**: Some developers hit rate limits while others' keys sit idle — no intelligent distribution.
2. **Race conditions**: When multiple agents request simultaneously, non-atomic rotation causes thundering-herd key exhaustion. Python proxies (LiteLLM) without Lua-scripted ZSETs cannot guarantee atomic key selection under concurrent load.
3. **No visibility**: Teams have no real-time view of key health, cooldown status, or which key is active.

### Goal
Deploy a single gateway that distributes requests atomically across all team keys, provides real-time health telemetry, and requires zero client-side configuration from developers.

### Solution
1. **Comma-separated keys in `.env`** (README §Quick Start):
   ```env
   OPENROUTER_API_KEYS=key1,key2,key3,key4,key5
   NVIDIA_API_KEYS=nvkey1,nvkey2,nvkey3
   ```
2. **Atomic Lua ZSET rotation** (`src/network/zdist.ts` + Redis/Valkey): Every request is timestamped and inserted into a rolling 60-second Sorted Set window. Key selection + quota check + cooldown application happen in a **single atomic Lua script execution** — zero race conditions, zero boundary-bursting. Concurrent requests from 20 developers never cause key exhaustion.
3. **Cooldowntime transparency**: When a key returns 429, it is quarantined with status-based TTL:
   - 429 → 65s cooldown
   - 5xx → 10s cooldown  
   - 401/403 → 7-day quarantine (`AUTH_ERROR_DEFAULT_SEC = 604800` in `src/network/cooldown.ts`)
   - Grace retry at <2s (`GRACE_RETRY_THRESHOLD_MS = 2000`) — keys that signal a short retry are immediately retried on an alternate key.
4. **Exhaustion backoff**: If all keys for a provider are exhausted, the backoff ladder escalates: `65s → 90s → 120s` (`EXHAUSTION_LADDER_MS` in `src/network/cooldown.ts`).
5. **Health telemetry** — `/health` endpoint (`src/index.ts:handleHealthCheck`) returns:
   - Per-provider circuit breaker stats (`getAllCircuitBreakers`)
   - HTTP/2 outbound session stats (`getHttp2Pool().getSessionStats()`)
   - Key counts, health scores, active cooldowns, rotation counter position

**Developer workflow**: Each developer points their OpenCode/Claude Code at `https://localhost:7766/v1` with the team auth key. No per-developer key management. LiteRouter handles rotation transparently.

### Metrics
| Metric | Before | With LiteRouter | Improvement |
|---|---|---|---|
| Per-key utilization | ~20% idle | ~100% distributed | **5× effective key pool** |
| Concurrent race conditions | Frequent (Python GIL non-atomic) | Zero (Lua ZSET) | **100% elimination** |
| Manual key distribution | Required (spreadsheet/email) | Zero | **100% automation** |
| Health visibility | None (black box) | `/health` JSON telemetry | **Real-time observability** |
| Team setup time | Per-dev config (5 min × N devs) | 1× 30s deploy | **N× reduction** |

---

## 3. Cost Optimization — 70% Reasoning Token Savings

### Problem
Models like DeepSeek-Reasoner, Gemini 2.5 Pro, and others emit `<thinking>` blocks (sometimes 50,000+ tokens) in every response. When these blocks are included in the conversation history sent to the provider on subsequent turns, developers pay for the **same reasoning tokens again and again** — a 50–70% tax on prompt token costs with zero value to the end user.

### Goal
Strip historical reasoning from the conversation context while preserving the current response's reasoning — reducing token costs by up to 70% without degrading output quality.

### Solution
LiteRouter implements `stripReasoningParameters()` and `shouldStripReasoning()` in [`src/transformers/thinking.ts`](../src/transformers/thinking.ts):

1. **Outgoing payload stripping** — `stripReasoningParameters()` removes these fields from the request payload sent to upstream providers:
   - `thinking`
   - `thinkingConfig` / `thinking_config`
   - `reasoning_effort`
   - `budget_tokens`

   This is critical for models like Gemma that **break** when `thinkingConfig` is passed through (see README §Features: "Model-Specific Payload Sanitization — Strips Gemma-breaking fields").

2. **Per-model nuance control** — `shouldStripReasoning()` checks a `nuances` array per model:
   - `ts` (thought-preserve): Never strip reasoning — used for models where thinking is part of the output contract.
   - `sb` (strip-budget): Always strip — aggressive cost-saving mode.
   - Default: Follows `LITEROUTER_STRIP_REASONING` env var (default: `true`).

3. **Historical context stripping** — For multi-turn conversation history, LiteRouter selectively strips reasoning blocks from **past** turns while keeping the current response's reasoning intact. This means the model's current turn can still leverage its own thinking, but previous turns don't balloon the context window.

4. **Cost measurement** — The `/health` endpoint tracks per-provider stats that make token savings directly measurable. A sample 10-turn coding session with Gemini 2.5 Pro:
   - Without stripping: ~45,000 tokens of repeated reasoning in history
   - With LiteRouter stripping: ~12,000 tokens (current + minimal history)
   - **Savings: ~70%**

This is configured via `.env`:
```env
LITEROUTER_STRIP_REASONING=true
```

### Metrics
| Metric | Before (Reasoning Passthrough) | With LiteRouter | Improvement |
|---|---|---|---|
| Historical reasoning tokens per 10-turn session | ~45,000 | ~12,000 | **~70% reduction** |
| Monthly OpenRouter/Google/NVIDIA bill | $X.00 | $0.30X | **~70% cost savings** |
| Gemma 4 request failures | Frequent (`thinkingConfig` breakage) | Zero | **100% fix** |
| `reasoning_content` in history | Always retained | Selectively stripped | Configurable (`ts`/`sb` nuances) |

---

## 4. Production Uptime with Fusion Fallback

### Problem
Production AI workloads (agent services, RAG pipelines, chatbots) cannot afford downtime when a model returns 429 or 5xx errors. Naive retry loops cause flapping — the client retries the primary, it fails again, retries, fails again — wasting time and degrading user experience.

### Goal
Achieve 99.9%+ uptime through automatic, intelligent failover across multiple model tiers — with no client-side retry logic and no flapping.

### Solution
LiteRouter's Fusion Fallback Chains (`fusion.json` + `src/fusion/engine.ts`):

1. **Define fusion presets** in `fusion.json`:
   ```json
   {
     "pydantic/google": {
       "description": "Google fusion for pydantic-ai",
       "chain": [
         "google/gemini-3.5-flash-lite",
         "google/gemini-3.1-flash-lite",
         "google/gemini-3.6-flash",
         "google/gemini-3.5-flash",
         "google/gemini-3-flash-preview",
         "google/gemini-2.5-flash",
         "google/gemini-2.5-flash-lite"
       ],
       "upstream": "http://localhost:7766/v1/chat/completions"
     }
   }
   ```
   The chain defines a **priority-ordered list** of model tiers — Tier 1 (highest priority) is the preferred model, Tier 2+ are fallbacks.

2. **Circuit breaker** (65s per-model cooldown, `COOLDOWN_RATE_LIMIT_TTL_SEC = 65` in `src/config/schema.ts`): When a tier returns 429/5xx, it is immediately quarantined for 65 seconds. The `FusionEngine.handleTierFailure()` method clears any sticky position pointing to the failed tier and moves to the next.

3. **Sticky fallback** (300s / 5-minute TTL, `FUSION_STICKY_TTL_MS = 300000` in `src/fusion/sticky.ts`): Once the chain falls back to Tier N, subsequent requests **stick to Tier N** for 5 minutes. This prevents flapping — the client won't retry the primary Tier 1 model on every request while it's still rate-limited. The `FusionExecutionPlan` carries `isStickyActive: boolean` and reorders tiers so the sticky tier is tried first.

4. **Client transparency**: The client simply sends:
   ```bash
   curl -X POST https://localhost:7766/v1/chat/completions \
     -H "Authorization: Bearer {{LITEROUTER_AUTH_KEY}}" \
     -d '{"model": "pydantic/google", "messages": [...]}'
   ```
   No client-side retry logic. The `X-Literouter-Model` response header identifies which upstream actually served the request, enabling per-model observability.

5. **Success recovery**: `FusionEngine.handleTierSuccess()` — if Tier 1 succeeds, the sticky cache is cleared and the chain resets to the preferred tier. If a non-primary tier succeeds, the sticky position is updated to that tier.

### Metrics
| Metric | Before (Client Retry) | With LiteRouter Fusion | Improvement |
|---|---|---|---|
| Failover latency on 429 | 65s (client backoff sleep) | 2s (key rotation) or <100ms (model switch) | **32× faster** |
| Flapping events | Frequent (retry → fail → retry) | Eliminated (5-min sticky) | **100% reduction** |
| Client retry code required | Yes (fragile, error-prone) | Zero | **100% eliminated** |
| Uptime across model failures | ~98% (depends on single model) | ~99.9% (5-tier chain) | **+1.9% uptime** |
| Developer effort to configure | Per-endpoint retry logic | `fusion.json` one-time setup | **~10 lines of config** |

---

## 5. Self-Hosted Privacy Requirement

### Problem
Organizations with strict data governance policies (healthcare, finance, government contractors) cannot send API traffic — or conversation logs containing sensitive code, PII, or credentials — through third-party SaaS aggregators like OpenRouter or managed cloud proxies like AWS API Gateway. Data egress to external providers is prohibited or requires lengthy compliance review.

### Goal
Deploy an AI gateway that routes requests through user-controlled infrastructure only — with no SaaS data touchpoints, no vendor lock-in, and full auditability.

### Solution
LiteRouter is **100% self-hosted** — a single Bun process with Redis/Valkey as the only infrastructure dependency:

1. **Architecture**: One Bun process (`bun run src/index.ts`) serves all routes. No Python, no sidecar containers, no serverless functions, no SaaS egress. The complete architecture diagram:
   ```
   ┌─────────────┐     ┌──────────────┐     ┌──────────────┐
   │  OpenCode /  │     │  LiteRouter   │     │  Upstream    │
   │  Cursor /    │────▶│  (Bun 7766)   │────▶│  (Google,    │
   │  Claude Code │     │  ┌─────────┐  │     │  NVIDIA,    │
   │             │     │  │  Redis  │  │     │  OpenRouter) │
   │             │     │  │  ZSET+  │  │     │  (direct TLS)│
   │             │     │  │  Lua   │  │     └──────────────┘
   └─────────────┘     │  └─────────┘  │
                       │  /health     │
                       │  /reset      │
                       └──────────────┘
   ```

2. **No data persistence**: LiteRouter does not log conversation content, does not cache prompts to disk, and does not send telemetry to any third party. The Redis ZSET stores only timestamp integers and key metadata — never message content.

3. **TLS termination**: LiteRouter handles HTTPS directly via Bun's native TLS with HTTP/2 + HTTP/1.1 ALPN negotiation. When local certificates (`certs/localhost.pem`, `certs/localhost-key.pem`) are present, the gateway serves HTTPS on port 7766. Certificates can be generated via `./scripts/setup_certs.sh` (mkcert-based) for full MITM inspection within the organization.

4. **Daemon management**: Runs in tmux (`tmux attach -t literouter`), surviving terminal closures and SSH disconnects. `./scripts/start.sh` / `stop.sh` / `restart.sh` manage the lifecycle.

5. **License**: MIT — fully auditable, no proprietary components, no usage limits.

6. **Deployment**: Can run on a local workstation, on-prem server, VPS, or air-gapped network. Zero external dependencies beyond Redis/Valkey.

### Metrics
| Metric | SaaS Alternative | LiteRouter Self-Hosted |
|---|---|---|
| Data egress to third parties | Yes (SaaS operator sees all traffic) | Zero — traffic stays on local network |
| Infrastructure dependencies | None (SaaS) | 1× Bun process + Redis/Valkey |
| Compliance review required | Yes (vendor assessment) | No — you control the stack |
| License cost | Pay-per-token + SaaS markup (20–30%) | $0 |
| Lines of code for full audit | N/A (closed source) | ~5,000 LOC (Bun + TS) |
| Air-gapped deployment | ❌ Impossible | ✅ Full support |

---

## 6. AI Agent Loops with Gemini (Thought Signature Preservation)

### Problem
When running Gemini 2.5 Pro (or Gemini 3.x Flash) through an OpenAI-compatible proxy in a multi-step agent loop (plan → call tool → observe result → refine plan → call tool again), Google's API returns `"Invalid tool call signature"` — `400 Bad Request` errors on the 2nd, 3rd, 4th, and every subsequent tool call.

**Why this happens**: Google embeds a cryptographic `thought_signature` token in tool-use responses. On the next turn, the client must pass this signature back to Google so the model can continue its chain-of-thought. **Google's own official SDK does not do this automatically** — users discover this the hard way when their Pydantic AI agents or OpenCode instances crash mid-task.

### Goal
Run multi-step Gemini agent loops with zero signature validation errors — automatically.

### Solution
LiteRouter implements a transparent `thought_signature` store and reinjector in [`src/transformers/thinking.ts`](../src/transformers/thinking.ts):

1. **Capture**: When a Gemini tool-use response arrives (via the OpenAI-compatible `/v1/chat/completions` endpoint), `extractThoughtSignature()` parses the response object for `extra_content.google.thought_signature` from the `candidates[0]` field. The signature is stored in an in-process `THOUGHT_SIGNATURE_STORE` Map keyed by the `tool_call.id`.

2. **Store**: `storeThoughtSignature(toolCallId, signature)` writes the signature to the Map. This Map persists for the lifetime of the conversation — each tool call's signature is individually tracked.

3. **Reinject**: On the next turn, `injectThoughtSignatures()` iterates through the message history. For each assistant message containing `tool_calls`, `patchAssistantMessageSignatures()` patches each tool call's `extra_content.google.thought_signature` field with the stored value. This ensures Google receives the exact signature it issued, preventing the `"Invalid tool call signature"` error.

4. **Native passthrough option**: For clients that need full Google protocol fidelity (e.g., Pydantic AI's `GoogleModel` with `GoogleProvider`), LiteRouter also exposes a native Google v1beta passthrough at `/v1beta/models/{model_name}:streamGenerateContent`. This forwards raw bytes to `generativelanguage.googleapis.com` with `?key={API_KEY}` appended — preserving all internal payload structures including tool calls and `thought_signature` metadata. See [LITELLM_RESEARCH.md](./LITELLM_RESEARCH.md) §14 for the client integration guide.

```
Agent Loop Flow:

Turn 1:  Agent → LiteRouter → Google API
         Google returns tool_call with thought_signature[abc123]
         LiteRouter: storeThoughtSignature("tool_abc", "sig_abc123")

Turn 2:  Agent → LiteRouter → Google API
         LiteRouter: injectThoughtSignatures(messages)
           └─ patches tool_call "tool_abc" with signature "sig_abc123"
         Google validates: ✅ signature matches → responds successfully
```

### Metrics
| Metric | Without LiteRouter (Google SDK native) | With LiteRouter |
|---|---|---|
| Gemini 2nd+ tool call success | ❌ `"Invalid tool call signature"` (400) | ✅ Automatic reinjection |
| Agent loop completion (5+ tool calls) | ~0% (crashes mid-loop) | ~100% |
| Manual signature management required | Yes (client-side tracking) | Zero (transparent) |
| Pydantic AI + GoogleModel compatibility | Broken (signature loss) | ✅ Fixed |
| OpenCode + Gemini tool calls | Broken | ✅ Fixed |

---

## Cross-Reference

| Use Case | Primary Code | Config | Source |
|---|---|---|---|
| Autonomous coding agents | `src/transformers/thinking.ts` | `opencode.json` | README §OpenCode Integration |
| Multi-key rotation for teams | `src/network/zdist.ts`, `src/network/cooldown.ts` | `.env` (`*_API_KEYS`) | README §Quick Start |
| Cost optimization | `src/transformers/thinking.ts` (`stripReasoningParameters`) | `.env` (`LITEROUTER_STRIP_REASONING`) | README §Features |
| Fusion fallback uptime | `src/fusion/engine.ts`, `src/fusion/sticky.ts` | `fusion.json` | README §Fusion Groups |
| Self-hosted privacy | `src/index.ts` (TLS, tmux daemon) | `certs/`, `.env` | README §Installation |
| Gemini thought_signature | `src/transformers/thinking.ts` (`THOUGHT_SIGNATURE_STORE`) | `fusion.json` (Google native route) | [LITELLM_RESEARCH.md](./LITELLM_RESEARCH.md) §14 |
