# LiteRouter Operational Playbook & Setup Workflows (v3.1 / v3.2)

This document details executable operational workflows for running LiteRouter proxy services, updating upstream API key pools, registering models, managing fusion presets, executing health checks, and validating test suites.

---

## 1. Gateway Lifecycle Workflows

### Starting the Gateway (Background Daemon)
To start LiteRouter in a detached `tmux` session with TLS and health-check verification:
```bash
bash scripts/start.sh
```
- Spawns background session `literouter`.
- Writes process PID to `.literouter.pid`.
- Polls `https://localhost:7766/health` until active (`200 OK`).

### Checking Gateway Status
```bash
bash scripts/status.sh
```
Outputs process PID, port, TLS state, uptime, and tmux status.

### Restarting the Gateway
```bash
bash scripts/restart.sh
```

### Stopping the Gateway
```bash
bash scripts/stop.sh
```

---

## 2. Managing Upstream API Keys

LiteRouter manages four upstream key pools stored exclusively in `.env.local`:

```env
OPENROUTER_API_KEYS=sk-or-v1-key1...,sk-or-v1-key2...
NVIDIA_API_KEYS=nvapi-key1...,nvapi-key2...
ZEN_API_KEYS=sk-zen-key1...,sk-zen-key2...
GOOGLE_API_KEYS=AIzaSyKey1...,AIzaSyKey2...
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
   curl -sk -X POST https://localhost:7766/reset
   # Or full restart:
   bash scripts/restart.sh
   ```
5. Audit key pools:
   ```bash
   bun run scripts/doctor.ts
   ```

---

## 3. Registering New Models & Providers

### Step 1: Upstream Provider Configuration (`config/providers.json`)
Verify or add the provider code and endpoint mappings in `config/providers.json`:
```json
{
  "code": "nv",
  "base_url": "https://integrate.api.nvidia.com",
  "auth_header": "Bearer",
  "endpoints": {
    "ch": "/v1/chat/completions",
    "em": "/v1/embeddings",
    "md": "/v1/models"
  }
}
```

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

### Step 3: OpenCode v2 Client Configuration (`~/.config/opencode2/opencode.json`)
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
bun x tsc --noEmit && uv run ruff check .

# 2. Complete Unit and Integration Test Suite
bun test

# 3. Live Model Verification via OpenCode v2 CLI
bash scripts/test_opencode2_models.sh

# 4. Diagnostic Key Pool Health Probe
bun run scripts/doctor.ts
```
