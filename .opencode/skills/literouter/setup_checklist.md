# LiteRouter Operational Playbook & Setup Workflows (v4.0)

This document details executable operational workflows for running LiteRouter proxy services, updating upstream API key pools, registering models, managing fusion presets, executing health checks, and validating test suites.

---

## 1. Gateway Lifecycle Workflows

### Starting the Gateway (Background Daemon)
To start LiteRouter in a detached `tmux` session with TLS and health-check verification:
```bash
bash scripts/gateway/start.sh
```
- Spawns background session `literouter`.
- Writes process PID to `.literouter.pid`.
- Polls `https://localhost:7766/health` until active (`200 OK`).

### Checking Gateway Status
```bash
bash scripts/gateway/status.sh
```
Outputs process PID, port, TLS state, uptime, and tmux status.

### Restarting the Gateway
```bash
bash scripts/gateway/restart.sh
```

### Stopping the Gateway
```bash
bash scripts/gateway/stop.sh
```

---

## 2. Managing Upstream API Keys

LiteRouter manages five upstream key pools stored exclusively in `.env.local`:

```env
OPENROUTER_API_KEYS=sk-or-v1-key1...,sk-or-v1-key2...
NVIDIA_API_KEYS=nvapi-key1...,nvapi-key2...
ZEN_API_KEYS=sk-zen-key1...,sk-zen-key2...
GOOGLE_API_KEYS=AIzaSyKey1...,AIzaSyKey2...
GCP_KEYS=gcp-key1...,gcp-key2...
```

### Workflow: Adding / Rotating Keys
1. Unlock `.env.local` if protected:
   ```bash
   ./protect.sh unlock
   ```
2. Append or update the comma-separated key lists in `.env.local`.
3. Lock `.env.local`:
   ```bash
   ./protect.sh lock
   ```
4. Perform hard reset or restart gateway:
   ```bash
   curl -sk -X POST https://localhost:7766/reset -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"
   # Or full restart:
   bash scripts/gateway/restart.sh
   ```
5. Audit key pools, validate JSON schemas, and probe live upstream keys:
   ```bash
   bun run scripts/diagnose/doctor.ts
   ```
   - Validates presence and JSON syntax of `config/providers.json`, `config/fusion.json`, and `config/models.json`.
   - Pings `/health` on the host/port from `config/location.json` (WARN-only when down).
   - Sequentially probes (with 1s pacing) live upstream key health across Google AI Studio (`gemini-3.5-flash-lite`), NVIDIA NIM (`nvidia/nemotron-3-super-120b-a12b`), OpenRouter (`openrouter/free:nitro`), Zen (`big-pickle` with a fresh `ses_` session), and GCP (`gemma-4-31b-it`), injecting the mkcert root CA via `NODE_EXTRA_CA_CERTS`.

---

## 3. Registering New Models & Providers

### Step 1: Upstream Provider Configuration (`config/providers.json`)
Verify or add the provider code and endpoint mappings in `config/providers.json`:
```json
{
  "code": "nv",
  "name": "NVIDIA NIM",
  "env_key": "NVIDIA_API_KEYS",
  "strategy": "standard",
  "base_url": "https://integrate.api.nvidia.com",
  "auth_header": "Bearer",
  "endpoints": {
    "ch": "/v1/chat/completions",
    "em": "/v1/embeddings",
    "md": "/v1/models"
  },
  "request_retry": { "enabled": true, "max_attempts": 3, "delay": { "min_ms": 150, "max_ms": 300 } },
  "pacer": { "enabled": true, "min_delay_ms": 200, "max_delay_ms": 500, "max_queue_depth": 500, "max_queue_wait_ms": 15000 }
}
```
`env_key`, `request_retry`, and `pacer` are **required** by `ProviderConfigEntrySchema`
(`src/config/schema.ts:115-129`); a provider entry missing any of them fails boot.
`strategy` is optional and defaults to `"standard"`; valid values are
`standard | native_cascade | gcp_guarded | anthropic_direct | zen`.

### Step 2: Model Registration (`config/models.json`)
Register model identifiers and capabilities in `config/models.json`:
```json
{
  "id": "meta/llama-3.1-70b-instruct",
  "provider": "nvidia",
  "category": "instruct",
  "supports_thinking": false,
  "supports_tools": true,
  "context_window": 131072
}
```

### Step 3: OpenCode v2 Client Configuration (`~/.config/opencode/opencode.json`)
Add the model under the corresponding declarative provider block (e.g. `lr-nv` with directive `lr-nv-oa-ch-no`):
```json
"meta/llama-3.1-70b-instruct": {
  "name": "Llama 3.1 70B Instruct",
  "limit": {
    "context": 131072,
    "output": 16384
  }
}
```

---

## 4. Verification & Testing Pipeline

Run the complete validation pipeline after any modification:

```bash
# 1. Typecheck and Python linting
bun run typecheck && uv run ruff check .

# 2. Complete Unit and Integration Test Suite
bun run test        # accelerated domain-partitioned runner (scripts/test/test_runner.ts)

# 3. Live Model Verification via OpenCode v2 CLI
bash scripts/test/test_opencode_models.sh

# 4. Diagnostic Key Pool Health Probe (Local validation + live upstream auth probe for Google, NVIDIA, OpenRouter, Zen, GCP)
bun run scripts/diagnose/doctor.ts

# 5. Zen wire adaptation test (live, 3 vectors)
bun run test:zen    # == bun run scripts/test/test_zen_fixes.ts
```
