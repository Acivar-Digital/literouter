# LiteRouter v4.0 Autonomous AI Installation & Setup Playbook

> 🤖 **FOR USER**: Copy and paste the single line below into your AI coding assistant (Cursor, OpenCode, Claude Code, Windsurf, Copilot, or ChatGPT):
> 
> ```text
> Please read https://raw.githubusercontent.com/Acivar-Digital/literouter/main/INSTALL.md and autonomously set up, configure, and launch LiteRouter on my machine.
> ```

---

## 📋 Instructions for the AI Agent / LLM

You are acting as the autonomous DevOps engineer and setup agent for **LiteRouter v4.0**. LiteRouter is a high-performance, self-hosted open-source AI API Gateway & LLM proxy router built with Bun & TypeScript.

> ⚡ **Zero-Dependency Architecture**: LiteRouter v4.0 is **100% self-contained in Bun**. It does NOT require Docker, Redis, Valkey, PostgreSQL, or Python sidecars. Key rotation, token bucket pacing, and event-driven cooldowns operate purely in-memory.

Follow the step-by-step instructions below to inspect the host environment, resolve prerequisites, collect provider keys safely, verify health, and launch the daemon.

---

### Step 1: Host Inspection & Prerequisite Resolution

Execute the following commands in the terminal:

```bash
# 1. Detect OS & Platform
uname -a

# 2. Check Bun installation (Required >= 1.2)
bun --version || echo "BUN_NOT_FOUND"
```

#### Resolving Missing Prerequisites:
- **If Bun is missing**: Install it automatically:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
  *(Reload your shell environment or export `PATH="$HOME/.bun/bin:$PATH"`)*
- **External Databases**: **None required!** LiteRouter manages all rate limiting and key states natively in memory.

---

### Step 2: Clone & Dependency Installation

If not already inside the `literouter` repository directory:

```bash
git clone https://github.com/Acivar-Digital/literouter.git
cd literouter
bun install
```

---

### Step 3: API Key Collection & Environment Setup

Initialize `.env.local` from `.env.example`:

```bash
cp .env.example .env.local
```

#### Configuring Keys in `.env.local`:
Configure the gateway auth key and your desired upstream provider keys:

1. **LITEROUTER_PORT**: Default is `7766`.
2. **LITEROUTER_AUTH_KEY**: Client authorization token (e.g. `sk-lr-secret-$(openssl rand -hex 8)`).
3. **Provider API Key Pools** (comma-separated for automatic round-robin rotation):
   - **OpenRouter**: `OPENROUTER_API_KEYS=sk-or-key1,sk-or-key2`
   - **NVIDIA NIM**: `NVIDIA_API_KEYS=nvapi-key1,nvapi-key2`
   - **Google AI Studio**: `GOOGLE_API_KEYS=AIzaSyKey1,AIzaSyKey2`
   - **Zen**: `ZEN_API_KEYS=zen-key1`
   - **Anthropic**: `ANTHROPIC_API_KEYS=sk-ant-key1`

#### Security Rules for AI Agents:
- **NEVER** print, echo, or log real API keys to stdout or terminal transcripts.
- Write configured keys cleanly into `.env.local` (or `.env`).
- Never replace real keys with placeholder values like `<REDACTED>`.

---

### Step 4: Diagnostic Pre-Flight Check (`scripts/doctor.ts`)

Run LiteRouter's diagnostic doctor tool to probe your configured keys directly against upstream providers:

```bash
bun run scripts/doctor.ts
```

What to verify:
- Confirm active provider keys report `PASS` or `RATE_LIMITED`.
- Any invalid or revoked keys reporting `FAIL` will be automatically excluded on startup.

---

### Step 5: Service Launch & Daemon Management

Launch LiteRouter as a background daemon:

```bash
bash scripts/start.sh
```

*(LiteRouter launches inside a detached background `tmux` session named `literouter` with PID tracking, surviving terminal closures).*

---

### Step 6: Live Health Probe

Verify server health and key pool status:

```bash
curl -s http://localhost:7766/health
```

Expected output:
```json
{
  "status": "healthy",
  "version": "4.0.0",
  "circuit_breakers": { "open_circuits": 0 },
  "key_pools": { ... }
}
```

---

### Step 7: Client Application Setup

LiteRouter supports **Directive Keys** (`lr-<provider>-<wire>-<endpoint>-<nuance>`), allowing the client token to route requests dynamically.

#### A. OpenCode 2 (`~/.config/opencode2/opencode.json`)
OpenCode uses `@ai-sdk/openai-compatible` pointing to LiteRouter's `/v1` endpoint:

```json
{
  "provider": {
    "literouter": {
      "npm": "@ai-sdk/openai-compatible",
      "baseURL": "http://localhost:7766/v1",
      "apiKey": "lr-or-oa-ch-no",
      "models": {}
    }
  }
}
```

#### B. Claude Code CLI
Claude Code routes directly through the Anthropic Messages endpoint:

```bash
export ANTHROPIC_BASE_URL="http://localhost:7766"
export ANTHROPIC_API_KEY="lr-or-cl-ms-no"
claude
```

#### C. Standard OpenAI SDK / Curl
```bash
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer lr-nv-oa-ch-no" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "nvidia/llama-3.1-nemotron-70b-instruct",
    "messages": [{"role": "user", "content": "Hello LiteRouter!"}]
  }'
```

---

### Step 8: Complete & Hand Off

Inform the user that **LiteRouter is actively serving on http://localhost:7766**. Provide management commands:
- **View Live Logs**: `tmux attach -t literouter` *(Press `Ctrl+B` then `D` to detach)*
- **Gateway Status**: `bash scripts/status.sh`
- **Restart Gateway**: `bash scripts/restart.sh`
- **Stop Gateway**: `bash scripts/stop.sh`
- **Model Evaluation Gauntlet**: `bun run eval/eval.ts <model_name>`
