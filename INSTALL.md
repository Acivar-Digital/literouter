# LiteRouter Autonomous Installation Guide (for AI Agents & LLMs)

> **FOR USER**: Copy and paste the prompt below into your AI coding assistant (Cursor, OpenCode, Claude Code, Windsurf, Copilot, or ChatGPT):
> 
> ```text
> Please read https://raw.githubusercontent.com/Acivar-Digital/literouter/main/INSTALL.md and autonomously set up, configure, and launch LiteRouter on my machine.
> ```

---

## 🤖 Instructions for the AI Agent / LLM

You are acting as an autonomous installation agent for **LiteRouter**. Follow the steps below sequentially to inspect the environment, install dependencies, guide key entry, write configuration, verify health, and launch the gateway service.

---

### Step 1: Detect Operating System & Prerequisites

Execute the following checks in terminal:

```bash
# 1. Check OS & Architecture
uname -a

# 2. Check Bun installation (Required >= 1.1)
bun --version || echo "BUN_NOT_INSTALLED"

# 3. Check Redis / Valkey server availability (Required on port 6379 or custom port)
nc -z -w 3 localhost 6379 2>/dev/null && echo "REDIS_RUNNING" || echo "REDIS_NOT_FOUND"
```

#### If Prerequisites are Missing:
- **If Bun is missing**: Offer to install it automatically:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
- **If Redis is missing**: Offer options based on OS:
  - **Docker**: `docker run -d --name valkey -p 6379:6379 valkey/valkey:alpine` (Recommended)
  - **macOS (Brew)**: `brew install redis && brew services start redis`
  - **Linux (Ubuntu/Debian)**: `sudo apt update && sudo apt install -y valkey-server && sudo systemctl start valkey-server`

---

### Step 2: Clone & Install Dependencies

If you are not already inside the `literouter` directory:

```bash
git clone https://github.com/Acivar-Digital/literouter.git
cd literouter
bun install
```

---

### Step 3: Interactive API Key & Environment Setup

Check if `.env` exists:
- If `.env` exists, ask the user if they want to retain existing keys or reconfigure.
- If `.env` does not exist, copy `.env.example` to `.env`:
  ```bash
  cp .env.example .env
  ```

#### Prompt the User for Configuration:
Ask the user which LLM provider keys they possess:
1. **LITEROUTER_AUTH_KEY**: Ask user for a secret password to protect their LiteRouter gateway (or generate a random secure string for them, e.g., `lr-secret-$(openssl rand -hex 8)`).
2. **Providers & API Keys**:
   - **OpenRouter**: Ask user for key(s) (comma-separated if multiple). Set `OPENROUTER_API_KEYS`.
   - **Google AI Studio**: Ask user for key(s). Set `GOOGLE_API_KEYS`.
   - **Nvidia Nim**: Ask user for key(s). Set `NVIDIA_API_KEYS`.
   - **Anthropic**: Ask user for key(s). Set `ANTHROPIC_API_KEYS`.
3. **Redis Credentials**:
   - Confirm host (default: `localhost`), port (default: `6379`), and password (default: empty).

#### Update `.env` File:
Write the configured variables cleanly to `.env`. Ensure sensitive keys are NEVER logged to terminal output.

---

### Step 4: Verification & Diagnostic Check (`doctor.ts`)

Run the built-in diagnostic doctor tool to probe all API keys and verify Redis connectivity:

```bash
bun run scripts/doctor.ts
```

What the LLM / User should verify:
- If `doctor.ts` reports Redis connection failure, ensure Redis is started (`docker run -d -p 6379:6379 valkey/valkey:alpine` or `brew services start redis`).
- Verify keys report `PASS` or `RATE_LIMITED` (429 rate-limited keys are automatically placed on cooldown).
- Invalid/revoked keys reporting `FAIL` will be cleanly ignored during rotation.

---

### Step 5: Start LiteRouter Service & Tmux Management

Launch the gateway daemon:

```bash
./scripts/start.sh
```

*(Note: `start.sh` daemonizes LiteRouter inside a background `tmux` session named `literouter` and records its PID so the gateway runs reliably without taking over your active terminal window).*

---

### Step 6: Perform Live Health Probe

Verify the running server responds:

```bash
curl -s http://localhost:7766/health
```

Expected JSON response:
```json
{ "status": "ok", "providers": { ... } }
```

---

### Step 7: Adding New Custom Providers (Zero Code Modifications)

To add new LLM providers (e.g. DeepSeek, Groq, Together, Cerebras, Ollama), simply append their URL and API key(s) to `.env`:

```env
# ── Custom Provider Example: DeepSeek ──
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
DEEPSEEK_API_KEYS=sk-ds-key1,sk-ds-key2

# ── Custom Provider Example: Groq ──
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_API_KEYS=gsk_key1,gsk_key2
```

Then restart LiteRouter: `./scripts/restart.sh`

---

### Step 8: Configure Client AI Applications (OpenCode / SillyTavern / Cursor)

Output clean setup snippets for the user:

#### OpenCode Configuration (`opencode.json`):
```json
{
  "provider": {
    "literouter": {
      "npm": "@ai-sdk/openai-compatible",
      "baseURL": "http://localhost:7766/v1",
      "apiKey": "<YOUR_LITEROUTER_AUTH_KEY>",
      "models": {}
    }
  }
}
```

#### Standard OpenAI Client (Python / Node / Curl):
```bash
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_LITEROUTER_AUTH_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openrouter/auto",
    "messages": [{"role": "user", "content": "Hello LiteRouter!"}]
  }'
```

---

### Step 8: Complete & Report

Inform the user that **LiteRouter is live on http://localhost:7766**. Provide commands for service management:
- View live logs: `tmux attach -t literouter`
- Stop service: `./scripts/stop.sh`
- Restart service: `./scripts/restart.sh`
