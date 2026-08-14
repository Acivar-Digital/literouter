# LiteRouter Autonomous AI Installation & Setup Playbook

> 🤖 **FOR USER**: Copy and paste the single line below into your AI coding assistant (Cursor, OpenCode, Claude Code, Windsurf, Copilot, or ChatGPT):
> 
> ```text
> Please read https://raw.githubusercontent.com/Acivar-Digital/literouter/main/INSTALL.md and autonomously set up, configure, and launch LiteRouter on my machine.
> ```

---

## 📋 Instructions for the AI Agent / LLM

You are acting as the autonomous DevOps engineer and setup agent for **LiteRouter**. LiteRouter is a high-performance, self-hosted open-source AI API Gateway & LLM proxy router built with Bun & TypeScript.

Follow the step-by-step decision matrix below to inspect the host environment, resolve prerequisites, collect provider keys safely, verify health, and launch the daemon.

---

### Step 1: Host Inspection & Prerequisite Resolution

Execute the following commands in the terminal:

```bash
# 1. Detect OS & Platform
uname -a

# 2. Check Bun installation (Required >= 1.1)
bun --version || echo "BUN_NOT_FOUND"

# 3. Check Redis / Valkey availability (Default port 6379)
nc -z -w 3 localhost 6379 2>/dev/null && echo "REDIS_RUNNING" || echo "REDIS_NOT_FOUND"
```

#### Resolving Missing Prerequisites:
- **If Bun is missing**: Offer to install it automatically:
  ```bash
  curl -fsSL https://bun.sh/install | bash
  ```
- **If Redis / Valkey is not running**: Select the best available option for the host:
  - **Option A (Docker - Recommended & Zero-Config)**:
    ```bash
    docker run -d --name valkey -p 6379:6379 valkey/valkey:alpine
    ```
  - **Option B (macOS Homebrew)**:
    ```bash
    brew install redis && brew services start redis
    ```
  - **Option C (Linux Debian/Ubuntu)**:
    ```bash
    sudo apt update && sudo apt install -y valkey-server && sudo systemctl start valkey-server
    ```

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

Check if `.env` exists:
- If `.env` does not exist, initialize from `.env.example`:
  ```bash
  cp .env.example .env
  ```

#### Prompting the User for Configuration:
Ask the user which LLM provider keys they possess:
1. **LITEROUTER_AUTH_KEY**: Ask user for a secret bearer token (or auto-generate a random secure token for them, e.g. `lr-secret-$(openssl rand -hex 8)`).
2. **Provider API Keys**:
   - **Google AI Studio**: Key(s) for `GOOGLE_API_KEYS`.
   - **OpenRouter**: Key(s) for `OPENROUTER_API_KEYS`.
   - **Nvidia NIM**: Key(s) for `NVIDIA_API_KEYS`.
   - **Anthropic**: Key(s) for `ANTHROPIC_API_KEYS`.
   - **Custom Providers** (DeepSeek, Groq, Together, Ollama): Configure `{PROVIDER}_BASE_URL` + `{PROVIDER}_API_KEYS`.

#### Security Rules for AI Agents:
- **NEVER** print, echo, or log real API keys to stdout/terminal logs.
- Write configured keys cleanly into `.env`.

---

### Step 4: Diagnostic Pre-Flight Check (`doctor.ts`)

Run LiteRouter's diagnostic doctor tool to probe keys and verify Redis:

```bash
bun run scripts/doctor.ts
```

What to verify:
- Confirm Redis connection reports OK.
- Confirm active provider keys report `PASS` or `RATE_LIMITED`.
- Revoked/invalid keys reporting `FAIL` will be automatically excluded from rotation.

---

### Step 5: Service Launch & Tmux Management

Launch LiteRouter as a background daemon:

```bash
./scripts/start.sh
```

*(LiteRouter runs inside a background `tmux` session named `literouter` with PID tracking, surviving terminal closures).*

---

### Step 6: Live Health Probe

Verify server health response:

```bash
curl -s http://localhost:7766/health
```

Expected output:
```json
{ "status": "ok", "providers": { ... } }
```

---

### Step 7: Client Application Setup

Output the exact integration snippet for the user's AI client:

#### A. OpenCode (`opencode.json`)
> ⚠️ **CRITICAL SDK REQUIREMENT**: OpenCode MUST use `@ai-sdk/openai-compatible` (NOT `@ai-sdk/openai`) to prevent SSE stream corruption and ACP tool-calling errors:

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

#### B. Standard OpenAI Client (Python / Node / SillyTavern / Curl)
```bash
curl -X POST http://localhost:7766/v1/chat/completions \
  -H "Authorization: Bearer <YOUR_LITEROUTER_AUTH_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "google/gemini-2.5-flash",
    "messages": [{"role": "user", "content": "Hello LiteRouter!"}]
  }'
```

---

### Step 8: Complete & Hand Off

Inform the user that **LiteRouter is running on http://localhost:7766**. Provide management commands:
- **View Live Logs**: `tmux attach -t literouter` *(Press Ctrl+B then D to detach)*
- **Stop Gateway**: `./scripts/stop.sh`
- **Restart Gateway**: `./scripts/restart.sh`
