# Swap Environment Settings Plan

## Goal
Move all LiteRouter configuration settings and model defaults from `.env.local` to `.env`, keeping **only API keys** in `.env.local`. This allows developers and LLMs to tune operational config in `.env` safely while secret API keys remain locked away in `.env.local`.

---

## ⛔ Safety & Security Mandate Notice
> **IMPORTANT FOR AI AGENTS & DEVELOPERS:**
> Per `AGENTS.md` and repository guidelines, **LLM agents are strictly forbidden from writing to or modifying `.env.local` or `.env` directly.**
>
> 1. All modifications to `.env` and `.env.local` must be performed **manually by a human developer** (or under explicit human supervision after running `./protect.sh unlock`).
> 2. After making changes, `.env.local` must be re-locked using `./protect.sh lock`.

---

## Current State

### `.env` (Tracked in Git)
Contains default operational configuration. Currently contains base server configs, default provider URLs, and beads/dolt paths.

### `.env.local` (Git-Ignored)
Contains a mix of:
- Gateway auth key & provider API keys (OpenRouter, NVIDIA, Zen, Google)
- Server & network config (host, port, timeouts, retry delays)
- Redis / Valkey connection settings
- Provider public base URLs & minimum delay thresholds
- Model configuration (model names, hyperparameters, vendor inheritances)
- Fusion circuit breaker & cooldown settings
- Google interactions model & Google native base URL

---

## What Moves from `.env.local` to `.env`

All non-API-key settings will move to `.env`. Settings already present in `.env` will be updated with `.env.local` overrides where applicable.

### 1. Server, Network & Timeout Settings
| Setting | Recommended Value | Notes |
|---|---|---|
| `LITEROUTER_HOST` | `0.0.0.0` | Bind address |
| `LITEROUTER_PORT` | `7766` | Gateway listening port |
| `LITEROUTER_ROTATE_DELAY_MS` | `5000` | Universal key rotation delay floor (ms) |
| `LITEROUTER_KEY_ROTATE_DELAY_MS` | `5000` | Legacy rotation delay override |
| `LITEROUTER_MAX_ATTEMPTS` | `3` | Failover loop attempt limit |
| `LITEROUTER_HTTP_TIMEOUT` | `800` | Upstream HTTP request timeout (sec) |
| `LITEROUTER_NO_RESPONSE_TIMEOUT` | `500` | First-byte ghosting timeout (sec) |
| `LITEROUTER_NO_RESPONSE_RETRY_DELAY` | `500` | Ghosting retry backoff (ms) |
| `LITEROUTER_STREAM_IDLE_TIMEOUT` | `30` | Stream idle timeout (sec) |
| `LITEROUTER_STRIP_REASONING` | `true` | Strip `<think>` tags from output |
| `LITEROUTER_COLLAPSE_REASONING` | `false` | Collapse thinking block format |

### 2. Redis / Valkey Database Config
| Setting | Recommended Value | Notes |
|---|---|---|
| `REDIS_HOST` | `127.0.0.1` | Redis host |
| `REDIS_PORT` | `6379` | Redis port |
| `REDIS_DB` | `0` | Redis DB index |
| `REDIS_PASSWORD` | `` | Redis auth password (blank if none) |

### 3. Fusion Sidecar & Routing Templates
| Setting | Recommended Value | Notes |
|---|---|---|
| `FUSION_UPSTREAM_URL` | `http://localhost:7767/v1/chat/completions` | OpenAI-compat upstream |
| `FUSION_UPSTREAM_URL_NATIVE` | `http://localhost:7767/v1beta` | Google native upstream |
| `LITEROUTER_TEMPLATE` | `openai` | Active routing template |
| `LITEROUTER_PROVIDER` | `openrouter` | Default fallback provider |

### 4. Provider Public Base URLs & Delay Thresholds
| Setting | Recommended Value | Notes |
|---|---|---|
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | Public API endpoint |
| `OPENROUTER_MIN_DELAY_MS` | `3000` | Per-key rate delay floor |
| `NVIDIA_BASE_URL` | `https://integrate.api.nvidia.com/v1` | Public API endpoint |
| `NVIDIA_MIN_DELAY_MS` | `30000` | Per-key rate delay floor (30s) |
| `ZEN_BASE_URL` | `https://opencode.ai/zen/v1` | Public API endpoint |
| `ZEN_MIN_DELAY_MS` | `3000` | Per-key rate delay floor |
| `GOOGLE_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta` | OpenAI-compat endpoint |
| `GOOGLE_NATIVE_BASE_URL` | `https://generativelanguage.googleapis.com` | Native Google REST endpoint |
| `GOOGLE_MIN_DELAY_MS` | `2000` | Per-key rate delay floor |
| `GOOGLE_KEY_AS_QUERY_PARAM` | `true` | Append key to URL query param |

### 5. Circuit Breakers, Cooldowns & Keep-Alives
| Setting | Recommended Value | Notes |
|---|---|---|
| `FUSION_CIRCUIT_TTL_MS` | `65000` | Circuit breaker open duration (ms) |
| `FUSION_STICKY_TTL_MS` | `300000` | Sticky fallback TTL (ms) |
| `COOLDOWN_DEFAULT_TTL_SEC` | `30` | Generic error cooldown (sec) |
| `COOLDOWN_RATE_LIMIT_TTL_SEC` | `65` | Rate limit (429) cooldown (sec) |
| `COOLDOWN_TIMEOUT_TTL_SEC` | `10` | Timeout / 5xx cooldown (sec) |
| `COOLDOWN_AUTH_TTL_SEC` | `604800` | Auth failure (401/403) cooldown (1 wk) |
| `COOLDOWN_TTL_MIN_SEC` | `5` | Retry-After lower bound clamp |
| `COOLDOWN_TTL_MAX_SEC` | `7200` | Retry-After upper bound clamp |
| `GRACE_RETRY_DELAY_MS` | `1500` | Same-key soft reset retry delay |
| `STREAM_STALL_MAX_RESENDS` | `3` | Max stream stall re-request attempts |
| `KEEPALIVE_INTERVAL_MS` | `2000` | SSE keepalive ping interval (ms) |

### 6. Model Definitions, Hyperparameters & Vendor Inheritances
| Setting | Recommended Value | Notes |
|---|---|---|
| `GOOGLE_INTERACTIONS_MODEL` | `antigravity-preview-05-2026` | Interactions endpoint model |
| `OPENROUTER_MODEL` | `nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | Default OpenRouter model |
| `NVIDIA_MODEL` | `openai/gpt-oss-120b` | Default NVIDIA model |
| `ZEN_MODEL` | `deepseek-v4-flash-free` | Default Zen model |
| `GOOGLE_MODEL` | `gemma-4-26b-a4b-it` | Default Google Gemini model |
| `MINIMAXAI_INHERITS` | `NVIDIA` | Vendor inheritance target |
| `MINIMAXAI_MODEL` | `minimaxai/minimax-m3` | Model identifier |
| `MINIMAXAI_TEMPERATURE` | `1.00` | Model temperature |
| `MINIMAXAI_MAX_TOKENS` | `8192` | Max token limit |
| `MINIMAXAI_TOP_P` | `0.95` | Top-p sampling |
| `MOONSHOTAI_*` | (See `.env.local` lines 85–89) | Kimi k2.6 model config |
| `STEPFUNAI_*` | (See `.env.local` lines 91–95) | Step 3.7 Flash model config |
| `MISTRAL_*` | (See `.env.local` lines 97–102) | Mistral Medium model config |
| `ZAI_*` | (See `.env.local` lines 104–108) | GLM 5.1 model config |
| `DEEPSEEK_V4_PRO_*` | (See `.env.local` lines 110–115) | DeepSeek V4 Pro config |
| `DEEPSEEK_V4_FLASH_*` | (See `.env.local` lines 117–123) | DeepSeek V4 Flash config |

---

## What Stays in `.env.local` (Secrets & API Keys Only)

After migration, `.env.local` should contain **ONLY** secret API keys and gateway authentication tokens:

```env
# Gateway Client Auth Key
LITEROUTER_AUTH_KEY=sk-lr-8f2a9e3b1c4d7e5f

# Secret Upstream API Keys (Comma-separated)
OPENROUTER_API_KEYS=sk-or-v1-...
NVIDIA_API_KEYS=nvapi-...
ZEN_API_KEYS=sk-...
GOOGLE_API_KEYS=AQ.Ab8RN6...,AIzaSy...

# Optional commented-out secrets
# ANTHROPIC_API_KEYS=sk-ant-...
```

---

## Execution Steps (Human Process)

> ⚠️ **Note:** To prevent breaking runtime behavior, steps 1 and 2 must be executed atomically together.

1. **Unlock `.env.local` (Human Developer):**
   ```bash
   ./protect.sh unlock
   ```

2. **Update `.env`:**
   Add all non-secret settings from the tables above to `.env` (replacing or adding defaults).

3. **Clean `.env.local`:**
   Remove all non-secret settings from `.env.local`, leaving **only** `LITEROUTER_AUTH_KEY` and `{PROVIDER}_API_KEYS`.

4. **Re-Lock `.env.local`:**
   ```bash
   ./protect.sh lock
   ```

5. **Restart Gateway Services (Mandatory):**
   Environment variables are loaded on gateway boot. Processes must be restarted to apply changes:
   ```bash
   bash scripts/restart.sh
   ```

6. **Verify System Health:**
   ```bash
   # 1. Run static key validator & health check
   bun run scripts/doctor.ts

   # 2. Probe endpoint health
   curl -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" http://localhost:7766/health

   # 3. Run integration smoke suite
   uv run pytest tests/integration/
   ```
