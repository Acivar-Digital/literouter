# LiteRouter Diagnostic Kit: `doctor.ts` & `doctor_zn.ts`

> **Canonical Location:** `.opencode2/skills/literouter/doctor.md`
> **Reference Scripts:** `scripts/doctor.ts`, `scripts/doctor_zn.ts`

This document is the sole source of truth for `doctor.ts` and `doctor_zn.ts` diagnostics, upstream key health verification, probing mechanics, error classifications, and known upstream provider behaviors.

---

## 1. Overview & Operational Role

`scripts/doctor.ts` is an out-of-band diagnostic probe script. It sequentially validates:
1. **JSON Configuration Schema**: Validates `config/providers.json`, `config/fusion.json`, and `config/models.json` against LiteRouter Zod schemas (`scripts/doctor.ts:378-384`; all three required, advisory-only — never gates boot).
2. **TLS Certificates**: Checks existence and validity of mkcert root CA and server certificates in `certs/`.
3. **Provider Key Pools**: Performs live sequential HTTP probes against all configured upstream providers (`Google`, `NVIDIA NIM`, `OpenRouter`, `Zen`, `GCP Vertex`).

### Critical Operating Principle
> **`doctor.ts` is strictly informational.**
> It reports key health (PASS / WARN / FAIL) for operator visibility. It does **NOT** gate gateway boot (`src/index.ts` loads and rotates keys dynamically using `staticValidateKeys`). An upstream warning or rate-limit in `doctor.ts` does not block LiteRouter from starting.

---

## 2. CLI Usage & Targeted Probing

Run all diagnostics:
```bash
bun run scripts/doctor.ts
```

Run targeted provider probes (pass provider code or label as argument):
```bash
# Probe only Zen keys
bun run scripts/doctor.ts zn
bun run scripts/doctor.ts zen

# Probe only Google Gemini keys
bun run scripts/doctor.ts gg
bun run scripts/doctor.ts google

# Probe only NVIDIA NIM keys
bun run scripts/doctor.ts nv
bun run scripts/doctor.ts nvidia

# Probe only OpenRouter keys
bun run scripts/doctor.ts or
bun run scripts/doctor.ts openrouter

# Probe only GCP Vertex (Gemma) keys
bun run scripts/doctor.ts gc
bun run scripts/doctor.ts gcp
```

---

## 3. Provider Probing Specifications

Every probe uses sequential pacing (default **1000ms delay** between successive keys in a pool) to prevent thundering-herd rate-limit spikes (HTTP 429) against upstream accounts.

| Provider | Code | Probe Target URL | Model Target | Injected Headers & Requirements |
|---|---|---|---|---|
| **Google AI Studio** | `gg` | `generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=<key>` (key in query string, no auth header) | `gemma-4-31b-it` | `{contents:[{parts:[{text:"ping"}]}], generationConfig:{maxOutputTokens:10}}` |
| **NVIDIA NIM** | `nv` | `integrate.api.nvidia.com/v1/chat/completions` | `nvidia/nemotron-3-super-120b-a12b` | `Authorization: Bearer <key>` |
| **OpenRouter** | `or` | `openrouter.ai/api/v1/chat/completions` | `openrouter/free:nitro` | `HTTP-Referer`, `Referer`, `X-Title`, `User-Agent: OpenCode/1.18.29` (Bypasses 403 agentic harness gate) |
| **Zen** | `zn` | `opencode.ai/zen/v1/chat/completions` | `big-pickle` | Fresh random `ses_...` session ID per key + OpenCode identity headers via `doctor_zn.ts` |
| **GCP Vertex** | `gc` | `generativelanguage.googleapis.com/v1beta/openai/chat/completions` | `gemma-4-31b-it` | `Authorization: Bearer <key>`, `x-goog-api-key: <key>` |

---

## 4. Status Classifications & Thresholds

Each key probe produces one of four statuses:

| Status | Color | HTTP Code | Meaning | Operator Action |
|---|---|---|---|---|
| **`PASS`** | 🟢 | `200` | Key is valid, authenticated, and capable of inference. | None. Key is healthy. |
| **`WARN`** | 🟡 | `429`, `400`, Network Error | Key is valid, but currently throttled, experiencing upstream provider issues, or network timed out. | Check rate limits, quota reset time, or upstream status. Key remains in pool. |
| **`FAIL`** | 🔴 | `401`, `403` | Key is rejected as unauthorized, expired, or forbidden. | Key is invalid. Replace key in `.env.local`. |
| **`SKIP`** | ⏭️ | - | Provider filtered out via CLI argument or has 0 keys configured. | None. |

---

## 5. Zen Probing Architecture (`scripts/doctor_zn.ts`)

OpenCode Zen (`opencode.ai/zen/v1`) enforces strict identity and session-gating on free-tier models (e.g. `big-pickle`, `muse-spark-1.3-contributor-free`).

### Fresh Session Generation (`generateZenSessionId`)
Zen requires a valid session token formatted as `ses_` followed by 26 base-62 characters. `doctor_zn.ts` mints an isolated crypto-random session per key:
```typescript
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function generateZenSessionId(): string {
  const bytes = new Uint8Array(26);
  crypto.getRandomValues(bytes);
  let tail = "";
  for (const b of bytes) {
    tail += BASE62[b % 62];
  }
  return `ses_${tail}`;
}
```

### Required Header Fan-Out (`buildZenSessionHeaders`)
Probing without full session fan-out headers results in immediate `HTTP 400 MissingSessionID: OpenCode's free tier can only be used in OpenCode`:
- `User-Agent`: `OpenCode/1.18.29` (or `LITEROUTER_USER_AGENT`)
- `HTTP-Referer`: `https://opencode.ai`
- `Referer`: `https://opencode.ai`
- `X-Title`: `OpenCode`
- `session-id`: `ses_<random>`
- `x-session-id`: `ses_<random>`
- `x-opencode-session`: `ses_<random>`
- `x-opencode-session-id`: `ses_<random>`
- `opencode-session-id`: `ses_<random>`
- `opencode-session`: `ses_<random>`
- `x-client-version`: `1.18.29`
- `x-client-name`: `opencode`

---

## 6. Known Upstream Provider Behaviors & Edge Cases

### 1. Zen `prompt_cache_key` Upstream Rejection (HTTP 400)
- **Symptom:**
  ```
  🟡 WARN | Key: sk-... | HTTP 400: {"error":{"type":"server_error","message":"Error from provider (Console): Upstream request failed: [unrecognized_request_argument] Unrecognized request argument supplied: prompt_cache_key"}}
  ```
- **Root Cause:**
  Neither `doctor.ts` nor LiteRouter sends `prompt_cache_key`. The payload sent by `doctor_zn.ts` is strictly `{ model: "big-pickle", messages: [...], max_tokens: 10 }`.
  OpenCode Zen acts as an upstream proxy. When Zen routes requests for `big-pickle` to its underlying provider backend ("Console"), Zen's internal middleware injects `prompt_cache_key` for session caching. If that specific upstream shard or model replica does not support `prompt_cache_key`, the upstream provider rejects it with `[unrecognized_request_argument]`. Zen catches this and returns it with `type: "server_error"`.
- **Why Some Keys Pass and Others Fail:**
  Zen routes user keys across multiple upstream backend accounts/shards. Keys hitting backends with prompt caching support pass (200 OK); keys assigned to strict validation shards fail with HTTP 400.
- **Handling:**
  Treated as a `WARN` in `doctor.ts`. The key is valid and not revoked.

### 2. Zen `MissingSessionID` / `FreeUsageLimitError`
- **Symptom:** HTTP 400 `MissingSessionID` or HTTP 429 `FreeUsageLimitError: Rate limit exceeded`.
- **Root Cause:** Occurs if request headers do not match OpenCode's client identity contract or if session IDs are omitted.
- **Handling:** Ensure `buildZenSessionHeaders` is used by all Zen probes.

### 3. OpenRouter 403 `Gate Free Endpoints by Agentic Harness`
- **Symptom:** HTTP 403 Forbidden on `:free` models (e.g. `nvidia/nemotron-3-nano-30b-a3b:free`).
- **Root Cause:** OpenRouter restricts free-tier endpoints to recognized coding agents.
- **Handling:** `probeOpenrouterKey` in `doctor.ts` injects `User-Agent: OpenCode/1.18.29`, `HTTP-Referer: https://opencode.ai`, and `X-Title: OpenCode`.

### 4. NVIDIA NIM 410 Gone / Model Sunsetting
- **Symptom:** HTTP 410 Gone or HTTP 404 Model Not Found.
- **Root Cause:** NVIDIA NIM aggressively deprecates models on fixed EOL dates without backwards compatibility redirects.
- **Handling:** Update the probe model in `scripts/doctor.ts` to the currently active NIM flagship (e.g. `meta/llama-3.1-8b-instruct` or `nvidia/nemotron-3-super-120b-a12b`).

---

## 7. Guidelines for Modifying `doctor.ts`

When updating `doctor.ts` or `doctor_zn.ts`:
1. **Never Hardcode Real Keys:** Always read keys dynamically from `Bun.env` or `process.env`.
2. **Pacing Invariant:** Always use `probePoolSequential` with $\ge 1000\text{ms}$ delay between keys.
3. **Masking:** Never print full keys to stdout; always wrap keys with `maskKey(key)` (e.g. `sk-a...1234`).
4. **Isolated Handlers:** Keep provider-specific complex session builders (like Zen's session fan-out) in dedicated companion files (e.g. `scripts/doctor_zn.ts`).
5. **No Gateway Boot Gating:** Probes must never block gateway startup or crash silently.
