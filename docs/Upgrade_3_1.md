# LiteRouter Version 3.1 Architecture: Ground-Up Specification

## Evolution Context

- **Version 1 (Legacy Python/Uvicorn)**: Initial prototype in Python.
- **Version 2 (Bun Model-Prefixed Router)**: Ported to Bun/TypeScript using model-name prefixing (`openrouter/anthropic/claude-3.7-sonnet`). Broken by rigid IDEs/tools (Claude Code, Cursor) that validate model names strictly.
- **Version 3.1 (Bun API-Key Declarative Router)**: Rebuilt from the ground up. Model names are passed **exactly as the upstream vendor expects**. The **API Key** acts as the definitive routing filter and execution directive.

---

# PART 1: FILTERING LOGIC

## 1.1 Core Tenet: Strict Upstream Model Names

LiteRouter v3.1 strictly forbids model-name prefixes or guessing:
- **OpenRouter**: Exact slug `org/modelname` (e.g., `anthropic/claude-3.7-sonnet`, `deepseek/deepseek-r1`).
- **Google Gemini**: Exact model name `gemini-2.5-pro`, `gemini-2.0-flash`.
- **Anthropic Claude (Direct)**: Canonical model name `claude-3-7-sonnet-20250219`.
- **OpenAI (Direct)**: Canonical model name `gpt-4o`, `o3-mini`.

Downstream tools configure the exact model ID; the incoming API key dictates all routing and transformation behavior.

---

## 1.2 Ingestion & Token Extraction Waterfall

LiteRouter extracts the directive token from any downstream client via a zero-overhead extraction waterfall:

1. **`Authorization` Header**: `Authorization: Bearer <key>`
2. **`x-api-key` Header**: `x-api-key: <key>` (Anthropic Claude Code format)
3. **URL Query Parameter `key`**: `http://localhost:7766/v1/chat/completions?key=<key>` (Google Gemini format)
4. **URL Query Parameter `api_key`**: `?api_key=<key>`
5. **URL Query Parameter `token`**: `?token=<key>`

All tokens are sanitized via `.trim().toLowerCase()` prior to schema validation.

---

## 1.3 Direct Routing Key Schema: 2-Letter Code Format

Direct routing keys use 4 two-letter codes:

```text
lr-<provider>-<payload>-<completions>-<nuances>
```

```
┌───────┬────────────┬───────────┬───────────────┬─────────────┐
│  lr-  │  Provider  │  Payload  │  Completions  │   Nuances   │
│ (pre) │  (2 chars) │ (2 chars) │   (2 chars)   │  (2+ chars) │
└───────┴────────────┴───────────┴───────────────┴─────────────┘
```

### Master 2-Letter Code Registry

#### 1. Provider (`xx`)
- `or` : OpenRouter
- `nv` : NVIDIA NIM
- `gg` : Google Gemini (Direct)
- `oa` : OpenAI (Direct)
- `an` : Anthropic (Direct)
- `gq` : Groq
- `cb` : Cerebras
- `ds` : DeepSeek (Direct)
- `ms` : Mistral AI
- `tg` : Together AI
- `zn` : Zen Provider

#### 2. Payload Wire Format (`xx`)
- `oa` : OpenAI Chat Completions wire format (`/v1/chat/completions`)
- `cl` : Anthropic Claude Messages wire format (`/v1/messages`)
- `gg` : Google Gemini REST/RPC wire format (`/v1beta/models/...:generateContent`)
- `rs` : OpenAI Responses API wire format (`/v1/responses`)

#### 3. Completions / Target Pipeline (`xx`)
- `ch` : Standard Chat Completions (`/v1/chat/completions`)
- `ms` : Anthropic Messages (`/v1/messages` or `/api/v1/messages`)
- `ob` : OpenAI Beta endpoint (Google `/v1beta/openai/chat/completions`)
- `gc` : Native Generate Content (Google `/v1beta/models/...:generateContent`)
- `im` : Image Generation (`/v1/images/generations`)
- `em` : Embeddings (`/v1/embeddings`)
- `au` : Audio Transcriptions & TTS (`/v1/audio/...`)
- `md` : Models Discovery (`/v1/models`)

#### 4. Nuances & Modifiers (`xx` or `xx+xx`)
- `no` : None (clean standard passthrough)
- `dp` : Dot-Prompt (injects minimal non-empty content when system prompt is empty)
- `ts` : Thought Signature (extracts reasoning tags and stitches Anthropic `thinking_delta` blocks)
- `gm` : Gemma Alternation (merges consecutive same-role turns)
- `g3` : Google 3 Family OpenAI wrapper nuance (cleans Gemini reasoning fields in OpenAI payloads)
- `sb` : Strip Budget (removes unsupported thinking/reasoning parameters)
- `tc` : Tool Choice Adapter (harmonizes `auto`/`any`/`tool` schema differences)

### Multi-Nuance Composition
Segment 4 supports compound nuances using the `+` delimiter:
- Example: `lr-nv-oa-ch-dp+ts` (NVIDIA, OpenAI payload, Chat endpoint, with **both** Dot-Prompt and Thought-Signature).

---

## 1.4 Fusion Engine Key Schema: `lr-fse-<preset>`

```text
lr-fse-<preset>
```
- `lr`: Gateway prefix
- `fse`: Fusion Sticky Engine
- `<preset>`: Preset slug corresponding to a configuration in `fusion.json` (e.g. `pydn`, `quad`, `fast`, `deep`).

---

## 1.5 `fusion.json` Schema (Tiered API Keys as Second Level)

```json
{
  "$schema": "./fusion.schema.json",
  "version": "3.1",
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
        },
        "deepseek/deepseek-r1": {
          "tiers": [
            { "priority": 1, "apikey": "lr-nv-oa-ch-ts", "model": "deepseek-ai/deepseek-r1" },
            { "priority": 2, "apikey": "lr-or-oa-ch-ts", "model": "deepseek/deepseek-r1" }
          ]
        },
        "gemini-2.5-pro": {
          "tiers": [
            { "priority": 1, "apikey": "lr-gg-oa-ob-dp", "model": "gemini-2.5-pro" },
            { "priority": 2, "apikey": "lr-or-oa-ch-no", "model": "google/gemini-2.5-pro" }
          ]
        }
      }
    }
  }
}
```

---

## 1.7 Configuration Storage Architecture: `.env` vs `.env.local` vs `JSON`

To maximize usability and operational safety:

| File | Purpose | Protection / Access | Format | Examples |
|---|---|---|---|---|
| **`.env.local`** | Upstream Vendor API Keys | `sudo` protected (root owned, mode 644 via `protect.sh`). Never edited by agents. | Key-Value | `OPENROUTER_API_KEYS=sk-or-v1-key1,sk-or-v1-key2`<br>`NVIDIA_API_KEYS=nvapi-key1`<br>`GOOGLE_API_KEYS=AIzaSy...`<br>`ZEN_API_KEYS=zen-key1` |
| **`.env`** | Runtime Operational Settings & Knobs | User-editable directly without needing an LLM. | Key-Value | `LITEROUTER_PORT=7766`<br>`LITEROUTER_NO_RESPONSE_TIMEOUT_MS=5000`<br>`LITEROUTER_STREAM_IDLE_TIMEOUT_MS=30000`<br>`COOLDOWN_RATE_LIMIT_TTL_SEC=65` |
| **`providers.json`** | Explicit Provider Registry & Completion Paths | Structured schema for completion path mapping and rate limits. | JSON | Upstream Base URLs, Full completion paths per code (`ch`, `ms`, `ob`, `gc`), RPM/RPD limits. |
| **`fusion.json`** | Multi-Tier Fusion Preset Chains | Structured fallback tree. | JSON | Presets (`quad`, `pydn`, `fast`) and model-to-apikey fallback tiers. |


---

# PART 2: ENGINE LOGIC

*(Detailed technical specifications for Adapters, SSE Streaming, Abort Propagation, Caching, and Key Pool Rotation.)*

1. **Protocol Conversion Engine**:
   - Anthropic `/v1/messages` $\leftrightarrow$ OpenAI `/v1/chat/completions` bidirectional translation.
   - Streaming SSE Event Translator (`choices[0].delta` $\leftrightarrow$ `content_block_delta`).
2. **Thinking & Reasoning Normalization**:
   - Intercepts `<think>` tags and `reasoning_content` fields from OpenAI/NVIDIA streams and converts them to native Anthropic `type: "thinking_delta"` blocks.
3. **Prompt Cache Optimization**:
   - Preserves `cache_control: { type: "ephemeral" }` and `anthropic-beta` headers on Anthropic/OpenRouter routes.
   - Strips unsupported cache headers when converting to OpenAI/NVIDIA routes to avoid 400 Bad Request errors.
4. **Client Disconnect & Abort Signal Propagation**:
   - Subscribes to `req.signal.onabort` to immediately terminate upstream `fetch()` requests on `Ctrl+C` or client disconnect, preventing token burn.
5. **SSE Heartbeat & TTFT Timeout Protection**:
   - Emits comment heartbeats (`: keep-alive\n\n`) every 5 seconds during prolonged reasoning phases before the first token arrives.
6. **Key Pool Rotation & Smart Cooldown**:
   - Rotates keys from `.env.local` pools (`OPENROUTER_API_KEYS`, `NVIDIA_API_KEYS`, etc.).
   - Automatically quarantines keys receiving 429 rate limits to Valkey / memory with exponential cooldown.
7. **Model Discovery (`/v1/models` & `/v1beta/models`)**:
   - Returns filtered model catalog matching the key's target provider or fusion preset.

---

# PART 3: TERMINAL UI

*(Detailed console output, live metrics, and real-time streaming telemetry.)*

1. **Live Request Banner**:
   - Inbound endpoint, client user-agent (e.g. `Claude-Code/1.0`, `Cursor/0.45`), extracted key directive.
2. **Routing Telemetry**:
   - Target upstream host, rotated key index (e.g. `NVIDIA [Key #2/5]`), active nuances (`[dp, ts]`).
3. **Real-time Performance Metrics**:
   - Time to First Token (TTFT in ms), streaming generation speed (tokens/sec), total tokens consumed, reasoning token count.
4. **Error & Cooldown Visualizer**:
   - Immediate visual alert on 429/5xx status with failover tier indication.
