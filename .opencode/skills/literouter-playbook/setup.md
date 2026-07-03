# Setup & Operations

## Quick Facts

| Question | How to answer |
|----------|---------------|
| How many OpenRouter API keys? | Count entries in `OPENROUTER_API_KEYS` in `.env` (comma-separated) |
| What's the default OpenRouter model? | Read `OPENROUTER_MODEL` in `.env` |
| How many OpenRouter models in OpenCode? | Count models with `openrouter/` prefix in `~/.config/opencode/opencode.json` under `provider.literouter.models` |
| Which models route to OpenRouter? | Models whose first segment (before `/`) is `openrouter` in `~/.config/opencode/opencode.json` |
| What's the min rotate delay? | `OPENROUTER_MIN_DELAY_MS` in `.env` |
# (freetier references removed)

> **Source of truth for provider config is `.env`. Source of truth for model visibility is `opencode.json`. Never hardcode these answers — read the files.**

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

**The first segment of the model ID (before `/`) IS the provider name.** No keyword overrides, no catch-all — configure the prefix correctly or it fails.

| Model ID in OpenCode | First segment → Provider | Stripped → sent upstream |
|---|---|---|
| `openrouter/owl-alpha` | `openrouter` → OpenRouter | `owl-alpha` |
| `openrouter/openai/gpt-oss-120b:free` | `openrouter` → OpenRouter | `openai/gpt-oss-120b:free` |
| `openrouter/cohere/north-mini-code:free` | `openrouter` → OpenRouter | `cohere/north-mini-code:free` |
| `nvidia/meta/llama-3.1-8b-instruct` | `nvidia` → Nvidia | `meta/llama-3.1-8b-instruct` |
| `nvidia/deepseek-ai/deepseek-v4-flash` | `nvidia` → Nvidia | `deepseek-ai/deepseek-v4-flash` |

The routing code in `src/main.py:_get_routing()`:
```python
if raw_model and "/" in raw_model:
    provider_name = raw_model.split("/", 1)[0]
```
Whatever comes before the first `/` must match a configured provider name. Available providers are discovered from `{NAME}_BASE_URL` env vars in `.env`.

| Model ID in OpenCode | First segment → Provider | Stripped → sent upstream |
|---|---|---|
| `openrouter/openai/gpt-oss-120b:free` | `openrouter` → OpenRouter | `openai/gpt-oss-120b:free` |
| `openrouter/cohere/north-mini-code:free` | `openrouter` → OpenRouter | `cohere/north-mini-code:free` |
| `nvidia/meta/llama-3.1-8b-instruct` | `nvidia` → Nvidia | `meta/llama-3.1-8b-instruct` |
| `nvidia/deepseek-ai/deepseek-v4-flash` | `nvidia` → Nvidia | `deepseek-ai/deepseek-v4-flash` |
# (freetier references removed)

## Freetier Provider (Google Gemini Free-Tier)

# (freetier references removed)

### Special Handling

**1. Auth is automatic** — LiteRouter detects `generativelanguage.googleapis.com` in the base URL (`is_gemini_provider()`) and automatically:
- Injects the API key as `?key=` query parameter (not Bearer header)
- Converts OpenAI request payloads to Gemini format via `src/gemini.py`

**2. thinkingConfig passthrough** — `src/gemini.py` reads `thinkingConfig` from the request body (both `camelCase` and `snake_case`) and injects it into Gemini's `generationConfig`. This suppresses raw thinking tokens in responses. Always set this in pydantic-ai `extra_body`:
```python
extra_body={"thinkingConfig": {"thinkingLevel": "minimal", "includeThoughts": False}}
```

**3. Fake-streaming** — Gemini's `streamGenerateContent` returns a raw JSON array, not OpenAI SSE. To avoid parsing issues, LiteRouter always calls `:generateContent` (buffered) and emits the result as a single fake SSE chunk + `data: [DONE]`. Response is instant once Gemini replies.

**4. Rate limit math:**
- Google free-tier: **15 RPM per key**
- 3 keys × 15 RPM = **45 RPM capacity**
- LiteRouter 2s delay → 30 req/min → **10 RPM per key** (well under limit)

### .env configuration

```bash
# -- FREETIER (Google Gemini free-tier API) --
FREETIER_BASE_URL=https://generativelanguage.googleapis.com/v1beta
FREETIER_MODEL=gemma-4-26b-a4b-it
FREETIER_API_KEYS=key1,key2,key3
FREETIER_MIN_DELAY_MS=2000
```

> ⚠️ **Key format matters** — Only `AIzaSy...` format API keys work reliably. OAuth-style `AQ.Ab8RN...` keys can return intermittent HTTP 500s on specific models. Validate with `uv run python -m src.doctor` after adding keys.

### Verify

```bash
# Direct Gemini test (bypass LiteRouter)
curl -s "https://generativelanguage.googleapis.com/v1beta/models/gemma-4-26b-a4b-it:generateContent?key=YOUR_KEY" \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"role":"user","parts":[{"text":"say ok"}]}],"generationConfig":{"maxOutputTokens":10,"thinkingConfig":{"thinkingLevel":"minimal","includeThoughts":false}}}'

# Through LiteRouter
curl -s http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer sk-lr-8f2a9e3b1c4d7e5f" \
  -H "Content-Type: application/json" \
# (freetier references removed)
```

---

## Google REST Native Pass-Through Routing

LiteRouter supports forwarding native Google API payloads directly to Google's Generative Language API without translation. This allows client SDKs like `@ai-sdk/google` (which send native Gemini JSON structures instead of OpenAI structures) to communicate with LiteRouter directly, benefiting from round-robin key rotation and cooldown management.

### Supported Endpoints
LiteRouter intercepts and forwards requests matching:
- `/v1beta/models/{model}:{action}`
- `/v1/model/{model}:{action}`
- `/v1/google/model/{model}:{action}`

These endpoints support both buffered (`:generateContent`) and streaming (`:streamGenerateContent?alt=sse`) payloads.

### Path & Model Resolution
1. **Action Decoupling**: LiteRouter supports both literal `:` and percent-encoded `%3A` action delimiters (e.g. `gemma-4-31b-it%3AstreamGenerateContent`).
# (freetier references removed)
3. **Model Prefix Stripping**: Any incoming model prefix like `model/` or `models/` (e.g., `google/model/gemma-4-31b-it`) is stripped before the request is forwarded to Google (so it becomes `gemma-4-31b-it`), ensuring Google's API path resolves the model correctly.

### OpenCode Configuration Example
In your `opencode.json` config, use `@ai-sdk/google` and configure the custom `baseURL` pointing to LiteRouter's `/v1` endpoint:
```json
    "googlelocal": {
      "npm": "@ai-sdk/google",
      "name": "Google Local",
      "options": {
        "baseURL": "http://localhost:7766/v1",
        "apiKey": "sk-lr-8f2a9e3b1c4d7e5f"
      },
      "models": {
        "google/model/gemma-4-31b-it": {
          "name": "Gemma 4 31b",
          "limit": { "context": 256000, "output": 8192 }
        },
        "google/model/gemini-3.1-flash-lite": {
          "name": "Gemini 3.1 Flash Lite",
          "limit": { "context": 1048576, "output": 8192 }
        }
      }
    }
```

---

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

## Adding & Removing Models

### Model Naming Convention

The model ID in OpenCode determines everything:

```
openrouter/openai/gpt-oss-120b:free
^^^^^^^^^^^ ^^^^^^^^^^^^^^^^^^^^
provider     upstream model ID (sent to provider API)
prefix
```

- **Provider prefix**: matches a configured provider name from `.env` (`openrouter`, `nvidia`, etc.)
- **Upstream model ID**: the remainder after stripping the prefix, sent to the provider's API as-is
- If the model is served by OpenRouter but has a different slug (e.g. `openai/gpt-oss-120b:free`), nest it: `openrouter/openai/gpt-oss-120b:free`

### Adding a Model

Three places to touch:

#### 1. OpenCode config (`~/.config/opencode/opencode.json`)

Add under `provider.literouter.models`:

```json
"openrouter/nvidia/nemotron-3-nano-30b-a3b:free": {
  "name": "Nemotron 3 Nano 30B A3B (OpenRouter)",
  "limit": { "context": 256000, "output": 65536 }
}
```

**Key rules:**
- Model key **must start with the provider prefix** (`openrouter/`, `nvidia/`, etc.)
- `limit.context` — max context window tokens. Clamp to the model's actual limit.
- `limit.output` — max output tokens. Clamp to the model's actual limit. Requests exceeding this get clamped.

#### 2. Model metadata file (`models/{provider}_{slug}.json`)

Fetch metadata from the provider API for reference. This is informational only — not read by LiteRouter at runtime.

**For OpenRouter models** (rich metadata available):
```bash
curl -s "https://openrouter.ai/api/v1/model/MODEL_ID" \
  -H "Authorization: Bearer $KEY" | python3 -c "
import sys, json
data = json.load(sys.stdin)
slug = 'MODEL_ID'.replace('/', '_').replace(':', '_')
with open('models/openrouter_${slug}.json', 'w') as f:
    json.dump(data['data'], f, indent=2)
"
```

**For Nvidia models** (minimal — only id/owned_by):
```bash
curl -s "https://integrate.api.nvidia.com/v1/models/MODEL_ID" \
  -H "Authorization: Bearer $KEY" > "models/nvidia_${slug}.json"
```

#### 3. LiteRouter `.env` (optional defaults)

Set provider-level defaults injected into every request unless the client overrides:

```bash
OPENROUTER_MODEL=openrouter/owl-alpha
OPENROUTER_TEMPERATURE=0.0
```

### Removing a Model

1. Delete the entry from `provider.literouter.models` in `~/.config/opencode/opencode.json`
2. Delete the metadata file from `models/` (optional, keeps things tidy)
3. No code or `.env` changes needed unless the model was set as default (`OPENROUTER_MODEL`, etc.)

### Verify

1. Run `opencode models` — the new model should appear under `literouter/`
2. Send a test request and check `logs/literouter.log` for the routing line: `[openrouter] Using rotated key: ...`

## Google API Daily Quota Reset

The hard daily clock for Google AI Studio / Gemini API requests per day (RPD) resets globally at **Midnight Pacific Time** ($00:00$ PT / $08:00$ UTC).

In Singapore Time (SGT), this daily clock translates exactly to:

* **3:00 PM SGT** (during Pacific Standard Time / standard winter months)
* **4:00 PM SGT** (during Pacific Daylight Time / summer daylight savings shifts)

If you hit your hard daily cap at 2:55 PM, you only have to wait 5 minutes until 3:00 PM for your entire daily allowance to replenish. 

---

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
