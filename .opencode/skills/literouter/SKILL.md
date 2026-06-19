---
name: literouter
description: Use when managing the local LiteRouter API key rotator proxy, starting/stopping the backend service, configuring path routing, testing key rotation, or resolving endpoint format compatibility with OpenCode TUI.
---

# LiteRouter Skill

This skill provides workflow guidance for managing, testing, and debugging the `literouter` local proxy service.

## Core Architecture

LiteRouter acts as a local proxy between client applications (like OpenCode TUI) and upstream LLM providers (like OpenRouter, Nvidia). It performs:
- Load balancing and rotation across a pool of API keys.
- Input body translation (e.g. mapping OpenAI or Responses API payloads to Anthropic Messages formats).
- Graceful degradation to in-memory mode when the Redis distributed state server is unavailable.

## Configuration & Run Commands

- **Start LiteRouter**:
  ```bash
  nohup uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 > logs/literouter.log 2>&1 & echo $! > .literouter.pid
  ```
- **Stop LiteRouter**:
  ```bash
  bash scripts/stop.sh
  ```
- **Check Status**:
  ```bash
  bash scripts/status.sh
  ```
- **View Logs**:
  ```bash
  tail -f logs/literouter.log
  ```

## Mandatory Testing Guidelines
Whenever you are writing, modifying, or testing the LiteRouter proxy service, you MUST read and execute the guidelines in `tests/right-way-test.md` to perform live end-to-end streaming checks against the actual running daemon. DO NOT rely solely on mocked test suites.

## Endpoint Overrides
- **Chat completions**: `/v1/chat/completions` (OpenAI format)
- **Responses API**: `/v1/responses` (OpenCode format; translated to messages format internally)
- **Models**: `/v1/models` (returns model database from each provider)
- **Health**: `/health` (system metadata, provider/key stats, model presets)

## How Model Routing Works

LiteRouter uses a **provider routing table** to decide which upstream API handles each request. The model string in the request determines the provider:

| Model prefix    | Provider   | Upstream base URL              |
|-----------------|------------|---------------------------------|
| `nvidia/`       | `nvidia`   | `https://integrate.api.nvidia.com/v1` |
| `openrouter/`   | `openrouter` | `https://openrouter.ai/api/v1` |
| `nemo` (any)    | `openrouter` | `https://openrouter.ai/api/v1` |

Example: `"model": "openrouter/minimaxai/minimax-m3"` → provider = `openrouter` → forwarded to OpenRouter's `/chat/completions`.

## Adding a New Provider API

To add a new upstream provider (or additional keys for an existing one):

1. **Edit `.env`** in the repo root. Add or append to the provider's env vars:
   ```bash
   # Add more keys to existing Nvidia pool (comma-separated)
   NVIDIA_API_KEYS=nvkey1,nvkey2,nvkey3

   # Or define a entirely new provider
   NEWPROVIDER_BASE_URL=https://api.example.com/v1
   NEWPROVIDER_API_KEYS=key1,key2
   NEWPROVIDER_MIN_DELAY_MS=3000
   ```
2. The provider prefix for model strings is derived from the env var name: `NEWPROVIDER_BASE_URL` → provider name `newprovider`.
3. **Restart LiteRouter** so it picks up the new `.env` values.
4. **Verify** with `curl http://localhost:7766/health` — check `config.providers` for the new key count.

## Adding New Models

Models are registered in **two places**:

### 1. LiteRouter side (`.env` — optional defaults)

Set default parameters for a provider. These are injected into every request unless the client overrides them:

```bash
OPENROUTER_MODEL=openrouter/minimaxai/minimax-m3
OPENROUTER_TEMPERATURE=1.00
OPENROUTER_TOP_P=0.95
```

You can also set per-model defaults using the provider's `model_params`. The key used is always the provider name (derived from the model prefix).

### 2. OpenCode side (`~/.config/opencode.json` — required for UI visibility)

Add the model under the `literouter` provider so it appears in the OpenCode model picker:

```json
{
  "provider": {
    "literouter": {
      "models": {
        "openrouter/minimaxai/minimax-m3": {
          "name": "MiniMax M3 (OpenRouter)",
          "limit": { "context": 131072, "output": 8192 }
        },
        "openrouter/moonshotai/kimi-k2.6": {
          "name": "Kimi K2.6 (OpenRouter)",
          "limit": { "context": 262144, "output": 16384 }
        },
        "openrouter/stepfun-ai/step-3.7-flash": {
          "name": "Step 3.7 Flash (OpenRouter)",
          "limit": { "context": 131072, "output": 16384 }
        },
        "nvidia/openai/gpt-oss-120b": {
          "name": "GPT-OSS-120B (Nvidia, reasoning)"
        }
      }
    }
  }
}
```

**Key rules:**
- Model IDs **must include the provider prefix** (`openrouter/`, `nvidia/`, etc.) so LiteRouter can route them.
- `limit.context` = max context window tokens for that model.
- `limit.output` = max output tokens. Client requests exceeding this are clamped.

### 3. Verify

1. Restart LiteRouter after any `.env` changes.
2. Open the OpenCode model picker — the new model names should appear.
3. Send a test request and check `logs/literouter.log` for the routing line: `[openrouter] Using rotated key: ...`.

## Adding a New API Key to an Existing Provider

Simply append to the comma-separated `*_API_KEYS` var in `.env`:

```bash
# Before: 6 keys
NVIDIA_API_KEYS=nvapi-key1,nvapi-key2,...,nvapi-key6

# After: 7 keys
NVIDIA_API_KEYS=nvapi-key1,nvapi-key2,...,nvapi-key6,nvapi-NEWNIMKEY1234567890
```

No code changes needed. The health endpoint (`/health`) shows the updated key count under `config.providers.nvidia.keys`.

## Start Process

For a detailed breakdown of what happens when `start.sh` runs — including stale PID cleanup, doctor pre-flight validation, daemon launch, and post-boot health checks — see:

**[`docs/start-process.md`](../../docs/start-process.md)**

---

## State Management

All runtime state lives in **in-memory dicts** (`src/router.py`). There is no database, no disk writes, and no external dependency for state.

### In-Memory State (3 dicts)

| Dict | Contents | Entry Size |
|------|----------|------------|
| `_mem_counters` | Provider → round-robin counter (int) | ~64 bytes |
| `_mem_cooldowns` | Provider → {sha → expiry_timestamp} | ~100 bytes/entry |
| `_mem_quarantine` | Provider → set of banned sha | ~50 bytes/entry |

Data grows **O(number of keys)**, not O(requests). Even with 100 keys across 5 providers, total state is a few KB.

### TTL & Cleanup

| Data Type | Lifetime | Cleanup |
|-----------|----------|---------|
| Cooldown | 1 hour max (`MAX_COOLDOWN_SEC = 3600`) | Lazy — filtered at read time, no background cleanup |
| Quarantine | Permanent | Lost on restart |
| Counter | Never resets | Monotonically increasing int per provider |

### Redis/Valkey: Optional

Redis (or Valkey) is **not required** for single-instance deployments. It provides:

- Atomic counter across restarts (vs. reset to 0)
- Quarantine persistence across restarts (vs. lost on restart)
- Auto-expiry of cooldown entries via TTL (vs. lazy cleanup only)

**You do not need Valkey** unless you run multiple LiteRouter instances sharing the same key pool, or you want quarantines to survive restarts.

### The "Restart Button"

A manual restart (`bash scripts/stop.sh && bash scripts/start.sh`) effectively resets all in-memory state:
- All cooldowns cleared instantly
- All quarantined keys come back (doctor re-quarantines truly dead keys within seconds)
- Counter resets to 0

If LiteRouter feels sluggish from cooldown buildup, a restart is the fastest fix.

---

## Rate Limiting

LiteRouter implements **provider-level** rate limiting only.

### How It Works (`src/rate_limiter.py`)

- A per-provider timestamp tracks the last call time
- If `now - last_call >= min_delay_ms` → allow immediately
- If not → return `wait_ms`; the request sleeps **outside the provider lock**

### Configuration

| Setting | Default | Override |
|---------|---------|----------|
| `min_delay_ms` | 2000ms (2s) | `{PREFIX}_MIN_DELAY_MS` in `.env` |

### Fallback

| Backend | Mechanism |
|---------|-----------|
| Redis | Atomic Lua script (`EVALSHA`) |
| In-memory | Plain `dict[str, float]` |

### Scope

- ✅ Provider-level (one rate limit per provider)
- ❌ Per-key (all keys in a provider share the same limit)
- ❌ Per-client (no client identification)

---

## Scoring & Key Selection

There is **no scoring system** in LiteRouter. Keys are not ranked or weighted.

### Key Rotation

- Pure **round-robin** via atomic counter (`INCR` in Redis, plain `int` in memory)
- Counter selects starting index; if that key is quarantined/on cooldown, the next alive key is used
- All keys are equal — no priority, no weights

### Penalties (Not Scoring)

| Event | Penalty | Duration |
|-------|---------|----------|
| 429 (rate limited) | Exponential cooldown | 60s → 120s → ... → 3600s max |
| 403 (key limit hit) | Exponential cooldown | 600s → 1200s → ... → 3600s max |
| 401 (revoked) | Permanent quarantine | Forever (until restart or manual un-quarantine) |

### Metrics

Metrics (`src/metrics.py`) are **observational only** — counters for requests, errors, latency, key usage. They are not used for routing decisions.

---

## Example: Full Request Flow

Client sends:
```json
{
  "model": "openrouter/minimaxai/minimax-m3",
  "messages": [{"role": "user", "content": "Hello"}],
  "max_tokens": 8192,
  "temperature": 1.0,
  "top_p": 0.95
}
```

LiteRouter:
1. `_get_routing("openrouter/minimaxai/minimax-m3")` → provider = `openrouter`
2. Picks next API key from the OpenRouter key pool (round-robin)
3. Strips prefix: `model` → `minimaxai/minimax-m3`
4. Forwards to `https://openrouter.ai/api/v1/chat/completions`
5. Streams response back to client
