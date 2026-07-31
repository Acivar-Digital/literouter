# LiteRouter Operational Playbook & Setup Workflows

This document details executable, step-by-step operational workflows for managing LiteRouter proxy configurations, provider API keys, model registries, fusion fallback groups, service restarts, testing pipelines, and documentation.

---

## 1. Agent Prerequisites & Mandatory Guardrail Protocol

Before executing any file modifications or operational workflows:

- [ ] **Agent Guardrail Checkpoint**: Run pre-edit checkpointing prior to modifying files:
  ```bash
  uv run python admin/code_hygiene/agent_guardrail.py checkpoint <filepath>
  ```
- [ ] **Beads Task Tracking**: Ensure work is claimed in beads:
  ```bash
  ./bd ready
  ./bd create "Task summary" -t task -p 2
  ./bd update <id> --claim
  ```
- [ ] **Post-Edit Validation**: Run post-edit validation and automatic escape artifact sanitization after completing file edits:
  ```bash
  uv run python admin/code_hygiene/agent_guardrail.py validate <filepath>
  ```
- [ ] **Beads Task Closure**: Close the bead upon successful verification:
  ```bash
  ./bd close <id> --reason "Completed"
  ```

---

## 2. Workflow: Configuring Provider API Keys in `.env`

LiteRouter manages API keys for four core upstream providers (`google`, `nvidia`, `zen`, `openrouter`).

### 2.1 Supported Environment Variables

| Provider | API Key Variable | Default Upstream Base URL (`PROVIDER_API_URLS`) | Base URL Override Variable | Delay Override Variable |
|----------|------------------|------------------------------------------------|----------------------------|-------------------------|
| Google | `GOOGLE_API_KEYS` | `https://generativelanguage.googleapis.com/v1beta/openai` | `GOOGLE_BASE_URL` | `GOOGLE_MIN_DELAY_MS` |
| NVIDIA | `NVIDIA_API_KEYS` | `https://integrate.api.nvidia.com/v1` | `NVIDIA_BASE_URL` | `NVIDIA_MIN_DELAY_MS` |
| Zen | `ZEN_API_KEYS` | `https://opencode.ai/zen/v1` | `ZEN_BASE_URL` | `ZEN_MIN_DELAY_MS` |
| OpenRouter | `OPENROUTER_API_KEYS` | `https://openrouter.ai/api/v1` | `OPENROUTER_BASE_URL` | `OPENROUTER_MIN_DELAY_MS` |

### 2.2 Key Format Rules & Gate 1 Static Validation

- **Format**: Comma-separated string **without quotes or spaces** around commas:
  ```env
  GOOGLE_API_KEYS=AIzaSyA1...,AIzaSyB2...,AIzaSyC3...
  NVIDIA_API_KEYS=nvapi-key1...,nvapi-key2...
  ZEN_API_KEYS=sk-zen-key1...,sk-zen-key2...
  OPENROUTER_API_KEYS=sk-or-key1...,sk-or-key2...
  ```
- **Gate 1 Static Validation Rules** (enforced in `src/config/env.ts` via `staticValidateKeys`):
  - Discards keys shorter than 30 characters (`tooShort`).
  - Discards keys containing angle brackets `<` or `>`.
  - Discards placeholder values (`changeme`, `placeholder`, `your_key`, `todo`, `xxxx`).
- **Delay Controls**: Key rotation delays default to `LITEROUTER_ROTATE_DELAY_MS` (10,000 ms), with a hard safety floor of `MIN_ROTATE_DELAY_MS` (2,000 ms).

### 2.3 Step-by-Step Configuration Steps

- [ ] 1. Checkpoint `.env` if editing directly:
  ```bash
  uv run python admin/code_hygiene/agent_guardrail.py checkpoint .env
  ```
- [ ] 2. Update or append API key lists in `.env`.
- [ ] 3. Validate `.env` format:
  ```bash
  grep -E "^(GOOGLE|NVIDIA|ZEN|OPENROUTER)_API_KEYS=" .env
  ```
- [ ] 4. Validate file with guardrail tool:
  ```bash
  uv run python admin/code_hygiene/agent_guardrail.py validate .env
  ```
- [ ] 5. Restart gateway to load new keys:
  ```bash
  bash scripts/restart.sh
  ```
- [ ] 6. Run diagnostic doctor script to verify key pool health:
  ```bash
  bun run scripts/doctor.ts
  ```

---

## 3. Workflow: Adding a New Model to `models.json`

All models served by LiteRouter must be registered in `models.json`.

### 3.1 JSON Schema Specification (`models.json`)

Each entry in `models.json` must be a JSON object adhering to the following schema:

```json
{
  "system_id": "provider/model-name",
  "provider": "google|nvidia|openrouter|zen",
  "upstream_id": "upstream-model-identifier",
  "context": 1048576,
  "max_output": 65535
}
```

#### Field Definitions
- `system_id` (string, required): Unique identifier used in request bodies and client configs (e.g., `"google/gemini-3.6-flash"`, `"nvidia/meta/llama-3.1-70b-instruct"`).
- `provider` (string, required): Must be one of `"google"`, `"nvidia"`, `"openrouter"`, or `"zen"`.
- `upstream_id` (string, required): Raw model name expected by the provider's upstream API endpoint (e.g., `"gemini-3.6-flash"`).
- `context` (integer, required): Context window size in tokens (e.g., `1048576`).
- `max_output` (integer, required): Maximum completion output token limit (e.g., `65535`).

### 3.2 Step-by-Step Model Addition

- [ ] 1. Checkpoint `models.json`:
  ```bash
  uv run python admin/code_hygiene/agent_guardrail.py checkpoint models.json
  ```
- [ ] 2. Edit `models.json` and append the new model entry inside the top-level array.
- [ ] 3. For non-Google models, fetch canonical token limits from OpenRouter using `scripts/gather_model_details.py`:
  ```bash
  uv run python scripts/gather_model_details.py
  ```
- [ ] 4. Validate JSON syntax and file guardrails:
  ```bash
  bun run -e "JSON.parse(await Bun.file('models.json').text())" && uv run python admin/code_hygiene/agent_guardrail.py validate models.json
  ```
- [ ] 5. Sync OpenCode CLI configuration (`~/.config/opencode/opencode.json`) per Section 4.
- [ ] 6. Restart gateway:
  ```bash
  bash scripts/restart.sh
  ```
- [ ] 7. Verify model responsiveness via curl:
  ```bash
  curl -s http://localhost:7766/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${LITEROUTER_AUTH_KEY:-sk-lr-8f2a9e3b1c4d7e5f}" \
    -d '{"model": "provider/model-name", "messages": [{"role": "user", "content": "hi"}]}'
  ```

---

## 4. Syncing Models with OpenCode CLI Configuration (`~/.config/opencode/opencode.json`)

To expose gateway models and fusion fallback groups to OpenCode CLI sessions, client configurations must be synced.

### 4.1 Configuration Structure

OpenCode reads model definitions from `~/.config/opencode/opencode.json` under `provider.literouter.models`:

```json
{
  "provider": {
    "literouter": {
      "options": {
        "baseURL": "http://localhost:7766/v1",
        "apiKey": "sk-lr-8f2a9e3b1c4d7e5f"
      },
      "models": {
        "google/gemini-3.6-flash": {
          "name": "google/gemini-3.6-flash",
          "limit": {
            "context": 1048576,
            "output": 65535
          }
        },
        "pydantic/google": {
          "name": "pydantic/google",
          "limit": {
            "context": 1048576,
            "output": 65535
          }
        }
      }
    }
  }
}
```

### 4.2 CLI Naming Convention

When invoking OpenCode CLI with LiteRouter models or fusion chains, prefix the model name with `literouter/`:

- Standard Model CLI Call:
  ```bash
  opencode -m literouter/google/gemini-3.6-flash --prompt "Write a hello world script"
  ```
- Fusion Group CLI Call:
  ```bash
  opencode -m literouter/pydantic/google --prompt "Run integration test"
  ```

### 4.3 Step-by-Step Sync Workflow

- [ ] 1. Read existing `~/.config/opencode/opencode.json`.
- [ ] 2. Checkpoint `~/.config/opencode/opencode.json`:
  ```bash
  uv run python admin/code_hygiene/agent_guardrail.py checkpoint ~/.config/opencode/opencode.json
  ```
- [ ] 3. Add or remove model/fusion group entries under `provider.literouter.models` matching `models.json` and `fusion.json`.
- [ ] 4. Validate JSON formatting in `~/.config/opencode/opencode.json`:
  ```bash
  bun run -e "JSON.parse(await Bun.file(process.env.HOME + '/.config/opencode/opencode.json').text())"
  ```
- [ ] 5. Test CLI invocation:
  ```bash
  opencode -m literouter/<system_id> --prompt "ping" --no-color
  ```

---

## 5. Managing Fusion Fallback Groups in `fusion.json`

Fusion groups define ordered fallback chains that automatically fail over to secondary models when an upstream backend returns `429` (rate limit) or `5xx` (server error).

### 5.1 Schema Structure (`fusion.json`)

```json
{
  "fusion-group-id": {
    "description": "Human-readable description of fallback chain",
    "chain": [
      "google/gemini-3.5-flash-lite",
      "google/gemini-3.1-flash-lite",
      "google/gemini-3.6-flash",
      "google/gemini-3.5-flash"
    ],
    "upstream": "http://localhost:7766/v1/chat/completions"
  }
}
```

#### Operational Rules
- **Dependency Requirement**: Every model ID listed in `chain` **MUST** exist as a valid `system_id` in `models.json`. Fusion groups reference registered models; they do not define standalone backends.
- **In-Process Fallback Runtime**: Fusion logic executes in-process in `src/index.ts` via `executeFusion`.
- **Circuit Breaker Behavior**: A failing upstream model opens its circuit breaker for 65 seconds (`CIRCUIT_TTL = 65000`), skipping it on subsequent calls.
- **Sticky Fallback Behavior**: When a fallback backend succeeds, the chain pins execution to that backend for 300 seconds (`STICKY_TTL = 300000`) before probing primary models again.

### 5.2 Step-by-Step Fusion Management

- [ ] 1. Checkpoint `fusion.json`:
  ```bash
  uv run python admin/code_hygiene/agent_guardrail.py checkpoint fusion.json
  ```
- [ ] 2. Edit `fusion.json` to add, update, or remove fusion groups.
- [ ] 3. Verify all models in `chain` exist in `models.json`:
  ```bash
  bun run -e "
    const models = new Set(JSON.parse(await Bun.file('models.json').text()).map(m => m.system_id));
    const fusion = JSON.parse(await Bun.file('fusion.json').text());
    for (const [gid, g] of Object.entries(fusion)) {
      for (const m of g.chain) {
        if (!models.has(m)) console.error(\`Missing model '\${m}' in models.json for group '\${gid}'\`);
      }
    }
  "
  ```
- [ ] 4. Validate file guardrails:
  ```bash
  uv run python admin/code_hygiene/agent_guardrail.py validate fusion.json
  ```
- [ ] 5. Sync `~/.config/opencode/opencode.json` per Section 4.
- [ ] 6. Restart gateway:
  ```bash
  bash scripts/restart.sh
  ```
- [ ] 7. Verify fusion fallback execution:
  ```bash
  curl -i -s http://localhost:7766/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${LITEROUTER_AUTH_KEY:-sk-lr-8f2a9e3b1c4d7e5f}" \
    -d '{"model": "fusion-group-id", "messages": [{"role": "user", "content": "test fusion"}]}' \
    | grep -i "x-literouter-model"
  ```

---

## 6. Gateway Operations & Service Management (`bash scripts/restart.sh`)

LiteRouter runs as a single Bun process inside a dedicated `tmux` session named `literouter`.

### 6.1 Gateway Architecture & Startup Sequence

```
                     +--------------------------------+
                     |      bash scripts/restart.sh   |
                     +---------------+----------------+
                                     |
                                     v
                     +---------------+----------------+
                     |       bash scripts/stop.sh     |
                     +---------------+----------------+
                                     |
                                     v
                     +---------------+----------------+
                     |      bash scripts/start.sh     |
                     +---------------+----------------+
                                     |
          +--------------------------+--------------------------+
          |                                                     |
          v                                                     v
+-------------------------------+             +-------------------------------+
|  scripts/lib/flush_valkey.sh  |             |  tmux session: "literouter"   |
|  (Flushes rate-limits/keys)   |             |  bun run src/index.ts         |
+-------------------------------+             +-------------------------------+
```

1. `bash scripts/restart.sh` calls `scripts/stop.sh` to terminate active `tmux` sessions and Bun processes.
2. `scripts/start.sh` sources `scripts/lib/flush_valkey.sh` and executes `flush_valkey`, clearing all Valkey/Redis rate-limit keys, rolling counters, and 403 quarantine ZSETs.
3. Launches `bun run src/index.ts` listening on port `7766` (or `$LITEROUTER_PORT`).

### 6.2 Service Commands

| Action | Command | Description |
|--------|---------|-------------|
| **Restart Gateway** | `bash scripts/restart.sh` | Stops service, flushes Valkey/Redis state, starts gateway process. |
| **Start Gateway** | `bash scripts/start.sh` | Launches Bun server in `tmux` session `literouter`. |
| **Stop Gateway** | `bash scripts/stop.sh` | Kills Bun process and clears `tmux` session. |
| **Doctor Check** | `bun run scripts/doctor.ts` | Runs system connectivity and API key validation probes. |
| **Health Check** | `curl -s http://localhost:7766/health` | Returns `{"status":"ok"}` when healthy. |

- [ ] **Execution Step**: Execute restart and verify health output:
  ```bash
  bash scripts/restart.sh && bun run scripts/doctor.ts
  ```

---

## 7. Testing & Verification Pipeline

All changes must pass TypeScript unit tests, integration smoke tests against the live gateway, complexity analysis, and code hygiene linters.

### 7.1 Test Commands Reference

```bash
# 1. TypeScript Unit Tests (Proxy logic, payload transformers, thinking extractors)
bun test

# 2. Integration / Smoke Tests (Executed against live gateway on http://localhost:7766)
uv run pytest tests/integration/

# 3. Codebase Complexity Analysis (Runs scripts/complexity.ts)
bun run complexity

# 4. Python Test Hygiene & Linting
uv run ruff check .
```

### 7.2 Manual Endpoint Verification

#### A. OpenAI-Compatible Endpoint (`/v1/chat/completions`)
```bash
curl -s http://localhost:7766/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${LITEROUTER_AUTH_KEY:-sk-lr-8f2a9e3b1c4d7e5f}" \
  -d '{
    "model": "google/gemini-3.6-flash",
    "messages": [{"role": "user", "content": "Hello LiteRouter"}]
  }'
```

#### B. Google Native Endpoint (`/v1beta/models/...`)
```bash
curl -s "http://localhost:7766/v1beta/models/gemini-3.6-flash:generateContent?key=${LITEROUTER_AUTH_KEY:-sk-lr-8f2a9e3b1c4d7e5f}" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [{"parts": [{"text": "Hello Google Native"}]}]
  }'
```

### 7.3 Step-by-Step Test Verification Checklist

- [ ] 1. Run unit test suite:
  ```bash
  bun test
  ```
- [ ] 2. Run complexity analysis:
  ```bash
  bun run complexity
  ```
- [ ] 3. Verify Python test linting:
  ```bash
  uv run ruff check .
  ```
- [ ] 4. Run full integration suite against running gateway:
  ```bash
  uv run pytest tests/integration/
  ```

---

## 8. Mandatory Documentation & Changelog Requirements (`CHANGELOG.md`)

Every addition, removal, or modification of models, providers, API key configurations, fusion groups, or proxy behavior **MUST** be documented in `CHANGELOG.md`.

### 8.1 Documentation Standards

- Log changes under the current release header (or unreleased section) at the top of `CHANGELOG.md`.
- Categorize changes into:
  - `### Added` — New models, providers, fusion chains, features.
  - `### Changed` — Updates to model parameters, key rotation logic, fusion fallbacks.
  - `### Fixed` — Bug fixes, error handling improvements.
  - `### Removed` — Deprecated models, removed providers.
- Include explicit model identifiers (`system_id`), context limits, and impacted files.

### 8.2 Step-by-Step Changelog Update Workflow

- [ ] 1. Checkpoint `CHANGELOG.md`:
  ```bash
  uv run python admin/code_hygiene/agent_guardrail.py checkpoint CHANGELOG.md
  ```
- [ ] 2. Add entry under current version header following standard format:
  ```markdown
  ## [3.3.7] — YYYY-MM-DD

  ### Added
  - **Model `provider/model-id`** — Added `provider/model-id` to `models.json` (`context: 1048576`, `max_output: 65535`). Synced to `~/.config/opencode/opencode.json`.
  ```
- [ ] 3. Validate guardrails on `CHANGELOG.md`:
  ```bash
  uv run python admin/code_hygiene/agent_guardrail.py validate CHANGELOG.md
  ```

---

## 9. 8-File Modular Architecture Overview

LiteRouter is structured into 8 modular TypeScript source files located in `src/`:

```
src/
├── config/
│   └── env.ts            # Environment, model/provider limits, static key validation & helper utils
├── network/
│   └── fetcher.ts        # First-byte timeout fetcher & NoResponseError definition
├── transformers/
│   ├── thinking.ts       # Reasoning effort & thinking configuration translation
│   └── payload.ts        # Payload cleaning, thought signature injection, latex normalization & streaming SSE
├── handlers/
│   ├── openai_compat.ts  # OpenAI-compatible API execution & first-byte retry loop
│   └── google_native.ts  # Google Native API execution & Google Interactions handler
├── lib.ts                # Barrel re-export file exporting config, network, thinking & payload modules
└── index.ts              # Server entry point (Bun port 7766), Redis/Valkey router, Fusion state & routes
```

### File Responsibilities Matrix

| File | Responsibilities |
| :--- | :--- |
| **`src/config/env.ts`** | Centralizes configuration and environment variables (`LITEROUTER_PORT`, `LITEROUTER_AUTH_KEY`, `LITEROUTER_COLLAPSE_REASONING`, `LITEROUTER_ROTATE_DELAY_MS`, `LITEROUTER_MAX_ATTEMPTS`, `LITEROUTER_HTTP_TIMEOUT_MS`, `LITEROUTER_NO_RESPONSE_TIMEOUT_MS`, `LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS`, `MIN_ROTATE_DELAY_MS=2000`). Defines provider/model limits, static key validation (`staticValidateKeys`), provider delay calculations (`getProviderDelayMs`), reset delay parsers (`parseResetDelay`), token usage extraction (`parseUsageFromJson`), and API URL mappings (`PROVIDER_API_URLS`). |
| **`src/network/fetcher.ts`** | Exposes `fetchWithFirstByteTimeout` and `NoResponseError`. Monitors upstream requests to detect silent backends that accept TCP connections but send 0 response bytes within `LITEROUTER_NO_RESPONSE_TIMEOUT_MS`. |
| **`src/transformers/thinking.ts`** | Translates provider-specific reasoning/thinking options into standard OpenAI-style `reasoning_effort` fields (`extractThinkingLevel`, `applyReasoningEffort`, `translateGoogleThinking`). |
| **`src/transformers/payload.ts`** | Manages thought signatures (`injectThoughtSignature`, `extractThoughtSignature`), token estimation (`estimateTokens`), Gemma unsupported field stripping (`cleanGemmaPayload`), LaTeX formatting (`cleanLatexSymbols`), message merging (`mergeConsecutiveMessages`), non-streaming reasoning transformations (`transformNonStreaming`), and streaming SSE stream transformations (`createStreamTransformer`). |
| **`src/handlers/openai_compat.ts`** | Implements `executeOpenAICompat`, `processOpenAIError`, and `processOpenAISuccess`. Manages key rotation loops for OpenAI-compatible providers (OpenRouter, NVIDIA, Zen, Google OpenAI-compat), error handling, 502 grace retries, and first-byte ghosting retry handling. |
| **`src/handlers/google_native.ts`** | Implements `executeGoogleNative` (for Google `:generateContent` / `:streamGenerateContent` native endpoints) and `executeGoogleInteractions` (for Google agent API `antigravity-preview-05-2026`). Manages query parameter signing, error handling, and streaming output. |
| **`src/lib.ts`** | **Barrel re-export file**. Exports all public types, constants, and utilities from `config/env`, `network/fetcher`, `transformers/thinking`, and `transformers/payload` for clean modular imports across handlers. Serves as a re-export barrel specifically for test compatibility, allowing test files to import from `src/lib.ts` instead of deep-importing individual modules. |
| **`src/index.ts`** | Application entry point running `serve` on port 7766. Contains trace logging (`recordTrace`), emoji logging (`logState`, `logWarn`, `logError`), static key verification, model/fusion registry loading (`models.json`, `fusion.json`), Valkey/Redis `ModelFirstRouter` (ZSET rolling quota Lua script, `reportError` cooldowns, usage recording), Fusion state (in-memory circuit breaker and sticky position), auth checking (`verifyAuthKey`), and HTTP route dispatchers. |

---

## 10. First-Byte Ghosting & 429 Zero-Stall Rotation

### 10.1 First-Byte Ghosting Retry Logic

When an upstream provider accepts a TCP connection but stalls silently without returning HTTP headers or bytes (known as a "ghost" connection):

1. **Timeout Detection (`src/network/fetcher.ts`):**
   `fetchWithFirstByteTimeout` sets a timer for `LITEROUTER_NO_RESPONSE_TIMEOUT_MS` (configured via `LITEROUTER_NO_RESPONSE_TIMEOUT`, default `5` seconds). If 0 bytes are received before the timer fires, the request aborts and throws `NoResponseError`.

2. **Non-Google Key Rotation without Cooldown (`src/handlers/openai_compat.ts`):**
   In `executeOpenAICompat`, when `e instanceof NoResponseError` is caught:
   - A warning log is emitted (`EMOJI.amber`).
   - The gateway delays for `LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS` (configured via `LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS` or `LITEROUTER_NO_RESPONSE_RETRY_DELAY`, default `1000` ms / 1 second).
   - The key is rotated to the next available key **WITHOUT calling `router.reportError`**. No cooldown is imposed on the key because the provider did not return a rate limit or error payload.

3. **Exhaustion Guard:**
   If all `maxAttempts` keys ghost without sending data, the gateway logs exhaustion (`EMOJI.exhausted`) and stops the loop, preventing infinite hangs or unbounded retries.

### 10.2 429 Rotation with 2s Minimum Delay & Immediate Exhaustion

1. **Rotation Delay Floor (`MIN_ROTATE_DELAY_MS = 2000`):**
   Key rotation delay between attempts is controlled by `getProviderDelayMs(provider)`. It resolves the environment variable `${PROVIDER}_MIN_DELAY_MS` or `LITEROUTER_ROTATE_DELAY_MS` (default 10s), but enforces a **hard minimum floor of 2000ms (2s)** (`MIN_ROTATE_DELAY_MS`).

2. **Immediate Exhaustion Output (No 65s Stalls):**
   When upstream returns 429 rate limit or quota errors, `router.reportError` places the active key on a 65s cooldown in Valkey/Redis.
   If all available keys in the pool are in cooldown or quota-exhausted, `router.getAvailableKey` throws:
   `All keys for {provider} are in cooldown or have exhausted quota for model {modelName}.`
   The handler catches this error and **immediately returns HTTP 429** to the downstream client without stalling or waiting out long 65s cooldown windows.

### 10.3 Ghosting vs 429 Rotation Comparison

| Behavior | Ghosting (NoResponseError) | 429 Rate Limit |
|----------|---------------------------|----------------|
| **Detection** | 0 bytes received within `LITEROUTER_NO_RESPONSE_TIMEOUT_MS` (default 5s) | Upstream returns HTTP 429 status |
| **Retry Delay** | `LITEROUTER_NO_RESPONSE_RETRY_DELAY_MS` (default 1000ms / 1s) | `getProviderDelayMs(provider)` (min 2000ms / 2s) |
| **Cooldown on Key** | **None** — key is NOT placed on cooldown | **65s** — key is placed on `rate_limited` cooldown in Redis |
| **Exhaustion Behavior** | Logs exhaustion and breaks loop after `maxAttempts` ghosts | Throws "All keys exhausted" → handler returns HTTP 429 immediately to client |
| **Reason** | Provider accepted connection but sent no data; key is not at fault | Provider explicitly rate-limiting; key must cool down |