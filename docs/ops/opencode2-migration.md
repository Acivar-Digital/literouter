# OpenCode v2 Side-by-Side Installation & Migration Guide

This document records the exact architecture, installation procedure, root-cause troubleshooting analysis, and maintenance steps for running **OpenCode v1** and **OpenCode v2** concurrently in complete physical isolation.

---

## 1. Executive Summary & Architecture

| Dimension | OpenCode v1 (Stable) | OpenCode v2 (Preview) |
|---|---|---|
| **Binary Path** | `/home/linuxbrew/.linuxbrew/bin/opencode` | `~/.local/bin/opencode2` (isolated wrapper) |
| **CLI Version** | `1.18.15` (Bun runtime) | `0.0.0-next-17403` (Node ESM runtime) |
| **Global Config Dir** | `~/.config/opencode/` | `~/.config/opencode2/` |
| **XDG Config Root** | `~/.config` | `~/.config/opencode2_xdg` (`-> ~/.config/opencode2`) |
| **XDG Data Root** | `~/.local/share/opencode` | `~/.local/share/opencode2` |
| **XDG State Root** | `~/.local/state/opencode` | `~/.local/state/opencode2` |
| **XDG Cache Root** | `~/.cache/opencode` | `~/.cache/opencode2` |
| **Repo Config** | `./opencode.json` & `./.opencode/` | `./opencode2.json` & `./.opencode2/` |
| **Beads Plugin** | `opencode-beads` | `opencode-beads@0.7.0` |
| **Local Gateway** | LiteRouter (`http://localhost:7766/v1`) | LiteRouter (`http://localhost:7766/v1`) |

---

## 2. Root Cause Analysis of Early Failures & Troubleshooting

### Issue A: `Error: Provider request failed with HTTP 401 (No payment method / grok-4.6)`
- **Symptom:** Running `opencode2 run "hello"` or opening interactive TUI failed immediately with HTTP 401 against OpenCode Cloud billing.
- **Root Cause:** In OpenCode v1, the model was retained from previous TUI state even if top-level `"model"` was omitted. In OpenCode v2, if `"model"` is not explicitly defined in `config.json`, it falls back to OpenCode Cloud `grok-4.6`.
- **Fix:** Explicitly set `"model": "literouter/openrouter/poolside/laguna-xs-2.1:free"` (or your preferred default model) at the root of `~/.config/opencode2/config.json`.

### Issue B: `Failed to send prompt / Unexpected server error. Check server logs for details.` in OpenCode v1
- **Symptom:** OpenCode v1 active TUI session crashed or refused to send prompts.
- **Root Cause:** When `opencode2` ran without environment isolation, its background daemon (`opencode2 serve --service`) created `~/.config/opencode/service.json` inside the **v1** configuration directory. OpenCode v1 read that token and attempted to communicate with the v2 service socket. When the v2 daemon stopped, v1 lost RPC connection.
- **Fix:**
  1. Deleted `~/.config/opencode/service.json`.
  2. Created an isolated launcher wrapper script (`~/.local/bin/opencode2`) setting separate `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, and `XDG_CACHE_HOME` variables.

### Issue C: `Error: Model unavailable: openrouter/poolside/laguna-xs-2.1:free`
- **Symptom:** Passing unprefixed model IDs failed model resolution in v2.
- **Root Cause:** In v2's OpenAI-compatible provider adapter, models configured under the `literouter` block must be referenced with the provider key: `literouter/openrouter/poolside/laguna-xs-2.1:free`.
- **Fix:** Updated `config.json` default model and sub-agent references to include the `literouter/` prefix.

---

## 3. Step-by-Step Installation & Configuration Guide

### Step 1: Backup Existing OpenCode v1 Configuration
```bash
cp -r ~/.config/opencode/ ~/.config/opencode_v1_backup_$(date +%Y%m%d_%H%M%S)
```

### Step 2: Install OpenCode v2 CLI Package
```bash
npm install -g @opencode-ai/cli@next
```
*(The package installs the underlying binary into the active Node/NVM bin directory).*

### Step 3: Create Dedicated XDG Directories & Launcher Wrapper
Create dedicated directory roots so v1 and v2 never share state, sockets, or cache:
```bash
mkdir -p ~/.config/opencode2 ~/.config/opencode2_xdg ~/.local/share/opencode2 ~/.local/state/opencode2 ~/.cache/opencode2
ln -sfn /home/yapilwsl/.config/opencode2 /home/yapilwsl/.config/opencode2_xdg/opencode
```

Create executable launcher `~/.local/bin/opencode2`:
```bash
cat << 'EOF' > ~/.local/bin/opencode2
#!/usr/bin/env bash
export XDG_CONFIG_HOME="${HOME}/.config/opencode2_xdg"
export XDG_DATA_HOME="${HOME}/.local/share/opencode2"
export XDG_STATE_HOME="${HOME}/.local/state/opencode2"
export XDG_CACHE_HOME="${HOME}/.cache/opencode2"
exec /home/yapilwsl/.nvm/versions/node/v20.20.2/lib/node_modules/@opencode-ai/cli/bin/opencode2.exe "$@"
EOF

chmod +x ~/.local/bin/opencode2
```

Ensure `~/.local/bin` precedes `/home/linuxbrew/.linuxbrew/bin` in `$PATH`. Verify with:
```bash
which opencode   # Should output: /home/linuxbrew/.linuxbrew/bin/opencode
which opencode2  # Should output: /home/yapilwsl/.local/bin/opencode2
```

### Step 4: Migrate Global Assets and Configure `config.json`
Copy commands, agents, skills, and plugins from v1:
```bash
cp -r ~/.config/opencode/command ~/.config/opencode2/
cp -r ~/.config/opencode/skills ~/.config/opencode2/
cp -r ~/.config/opencode/agents ~/.config/opencode2/
cp -r ~/.config/opencode/plugins ~/.config/opencode2/
cp ~/.config/opencode/package.json ~/.config/opencode2/
```

Write `~/.config/opencode2/config.json` with 100% provider parity and default model:
```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "literouter/openrouter/poolside/laguna-xs-2.1:free",
  "small_model": "literouter/openrouter/poolside/laguna-xs-2.1:free",
  "tool_output": {
    "max_lines": 2000,
    "max_bytes": 4096
  },
  "compaction": {
    "auto": true,
    "tail_turns": 10
  },
  "lsp": true,
  "plugin": [
    "opencode-beads@0.7.0"
  ],
  "provider": {
    "literouter": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LiteRouter",
      "options": {
        "baseURL": "http://localhost:7766/v1",
        "apiKey": "sk-lr-8f2a9e3b1c4d7e5f",
        "chunkTimeout": 120000
      },
      "models": { ... }
    }
  }
}
```

Create compatibility symlink:
```bash
ln -sfn /home/yapilwsl/.config/opencode2/config.json /home/yapilwsl/.config/opencode2/opencode.json
```

Install plugin dependencies:
```bash
npm install --prefix ~/.config/opencode2
```

---

## 4. Repository-Level Isolation (`opencode2.json` & `.opencode2/`)

To allow project-specific plugins (like `clean_python.ts`, `clean_ts.ts`, `remind-workflow.ts`) to run in both v1 and v2 simultaneously:

1. **Scaffold `.opencode2/` in repo**:
   ```bash
   mkdir -p .opencode2/plugins .opencode2/skills
   cp -r .opencode/plugins/* .opencode2/plugins/
   cp .opencode/package.json .opencode2/package.json
   npm install --prefix .opencode2
   ```

2. **Create `opencode2.json` at repo root**:
   ```json
   {
     "$schema": "https://opencode.ai/config.json",
     "plugins": [
       "./.opencode2/plugins/remind-workflow.ts",
       "./.opencode2/plugins/clean_python.ts",
       "./.opencode2/plugins/clean_ts.ts"
     ]
   }
   ```

3. **Update `.gitignore`**:
   ```gitignore
   # Opencode internal
   .opencode/
   !.opencode/skills/
   .opencode2/
   !.opencode2/skills/
   ```

---

## 5. Verification Commands & Health Checks

### Check Binary Isolation
```bash
opencode --version   # 1.18.15
opencode2 --version  # opencode2 v0.0.0-next-17403
```

### Inspect Resolved Configuration
```bash
opencode2 debug config
```

### Test OpenCode v2 Prompting via LiteRouter
```bash
opencode2 run --model "literouter/openrouter/poolside/laguna-s-2.1:free" "say literouter-rocks"
```

### Test OpenCode v1 Prompting (Concurrent Health Check)
```bash
opencode run --model "openrouter/poolside/laguna-xs-2.1:free" "say opencode-v1-alive"
```

### Manage OpenCode v2 Background Service
```bash
opencode2 service status   # View daemon endpoint
opencode2 service stop     # Gracefully stop daemon
opencode2 service restart  # Restart daemon
```
