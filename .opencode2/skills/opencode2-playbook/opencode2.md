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

### Issue D: `Error: ENOEXEC: unknown error, posix_spawn ... opencode2.exe`
- **Symptom:** OpenCode v2 failed during startup with `ENOEXEC` when attempting to spawn the background daemon.
- **Root Cause:** On WSL, the kernel routes `.exe` extensions through `binfmt_misc/WSLInterop`. Because the binary is a native Linux ELF binary, the `.exe` extension caused `posix_spawn` format validation conflicts.
- **Fix:** Renamed binary from `opencode2.exe` to `opencode2`, updated `@opencode-ai/cli/package.json` `"bin"` entry to `./bin/opencode2`, and pointed `~/.local/bin/opencode2` to the non-`.exe` executable.

### Issue E: `No such file or directory` After Exiting (Background Auto-Update Regression)
- **Symptom:** `opencode2` worked once, but after exiting and relaunching, failed with `/home/.../.local/bin/opencode2: line 6: .../bin/opencode2: No such file or directory`.
- **Root Cause:** OpenCode v2 has a background auto-update mechanism that polls the npm registry (`@opencode-ai/cli@next`) on shutdown/startup. When an update is detected, npm re-runs `postinstall.mjs`, which re-creates `bin/opencode2.exe` (as published upstream) and removes the renamed `bin/opencode2`.
- **Fix:** Implemented a **Self-Healing Launcher** in `~/.local/bin/opencode2` that automatically inspects, renames, and makes executable any newly downloaded `opencode2.exe` on every single command execution.

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

NVM_CLI_BIN="${HOME}/.nvm/versions/node/v20.20.2/lib/node_modules/@opencode-ai/cli/bin"
if [ -f "${NVM_CLI_BIN}/opencode2.exe" ]; then
  mv -f "${NVM_CLI_BIN}/opencode2.exe" "${NVM_CLI_BIN}/opencode2" 2>/dev/null || true
  chmod +x "${NVM_CLI_BIN}/opencode2" 2>/dev/null || true
fi

exec "${NVM_CLI_BIN}/opencode2" "$@"
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

---

## 6. Fast-Track Runbook: Troubleshooting `ENOEXEC: posix_spawn` Daemon Errors

> **Purpose for AI Agents & Engineers**: If `opencode2` crashes on startup with `Failed to start server` and `ENOEXEC: unknown error, posix_spawn '.../opencode2.exe'`, execute the 1-minute automated fix below immediately without re-investigating.

### 1. The Exact Symptom
```text
Starting background server...
ERROR (#1): Error: Failed to start server
  at service.ensure (src/services/server-connection.ts)
  [cause]: Error: ENOEXEC: unknown error, posix_spawn '/home/.../@opencode-ai/cli/bin/opencode2.exe'
      at spawn (node:child_process)
```

### 2. Diagnosis (Why It Happened)
1. **WSL Interop Trap**: In Windows Subsystem for Linux (WSL), the kernel registers `binfmt_misc/WSLInterop` to intercept any file ending in `.exe` and route it through `/init` (Windows PE executable loader).
2. **Binary Mismatch**: The compiled package binary is an **ELF 64-bit Linux executable**, NOT a Windows executable (`file bin/opencode2.exe` confirms `ELF 64-bit LSB executable`).
3. **Subprocess Spawn Failure**: During TUI or interactive startup, OpenCode v2 calls `posix_spawn(process.execPath, ['serve', ...])`. Because `process.execPath` ends in `.exe`, WSL's interop layer attempts to parse ELF headers as DOS/PE format, throwing `ENOEXEC` (*Exec format error*).

### 3. Immediate One-Liner Fix (Permanent Self-Healing Wrapper)
```bash
# 1. Stop any background service
opencode2 service stop 2>/dev/null || true

# 2. Locate active Node NVM path and rename binary if .exe exists
NVM_BIN_DIR="$(dirname $(which node))"
NVM_MODULES_DIR="$(cd "$NVM_BIN_DIR/../lib/node_modules/@opencode-ai/cli" && pwd)"

if [ -f "$NVM_MODULES_DIR/bin/opencode2.exe" ]; then
  mv "$NVM_MODULES_DIR/bin/opencode2.exe" "$NVM_MODULES_DIR/bin/opencode2"
  chmod +x "$NVM_MODULES_DIR/bin/opencode2"
fi

# 3. Patch package.json bin entry from .exe to clean Linux binary
sed -i 's/"\.\/bin\/opencode2\.exe"/"\.\/bin\/opencode2"/g' "$NVM_MODULES_DIR/package.json"

# 4. Update symlink in NVM bin directory
ln -sfn ../lib/node_modules/@opencode-ai/cli/bin/opencode2 "$NVM_BIN_DIR/opencode2"

# 5. Create Self-Healing ~/.local/bin/opencode2 wrapper
# (Automatically detects and fixes .exe if OpenCode v2 auto-updates in background)
cat << 'EOF' > ~/.local/bin/opencode2
#!/usr/bin/env bash
export XDG_CONFIG_HOME="${HOME}/.config/opencode2_xdg"
export XDG_DATA_HOME="${HOME}/.local/share/opencode2"
export XDG_STATE_HOME="${HOME}/.local/state/opencode2"
export XDG_CACHE_HOME="${HOME}/.cache/opencode2"

NVM_CLI_BIN="${HOME}/.nvm/versions/node/v20.20.2/lib/node_modules/@opencode-ai/cli/bin"
if [ -f "${NVM_CLI_BIN}/opencode2.exe" ]; then
  mv -f "${NVM_CLI_BIN}/opencode2.exe" "${NVM_CLI_BIN}/opencode2" 2>/dev/null || true
  chmod +x "${NVM_CLI_BIN}/opencode2" 2>/dev/null || true
fi

exec "${NVM_CLI_BIN}/opencode2" "$@"
EOF
chmod +x ~/.local/bin/opencode2
```

### 4. Verification Check
```bash
# Verify version
opencode2 --version

# Verify LLM Chat via LiteRouter
opencode2 run --model "literouter/openrouter/poolside/laguna-xs-2.1:free" "say test-ok"

# Verify Tool Calling
opencode2 run --model "literouter/openrouter/poolside/laguna-s-2.1:free" "Use a bash or glob tool to list /tmp/opencode"
```

### 5. Architectural Deep Dive: Why the Self-Healing Wrapper is Required

#### The Auto-Update Regression Cycle
```text
User executes opencode2
       │
       ▼
OpenCode v2 runs session & checks npm in background
       │
       ▼
New version detected (@opencode-ai/cli@next) -> npm runs postinstall.mjs
       │
       ▼
postinstall.mjs writes bin/opencode2.exe (per upstream package manifest)
       │
       ▼
Next invocation without self-healing wrapper -> ENOEXEC: posix_spawn failure!
```

#### How Self-Healing Prevents Future Failures
The launcher script `~/.local/bin/opencode2` acts as an active runtime guard:
1. **Pre-Execution Inspection**: Before launching the binary, the wrapper checks if `${NVM_CLI_BIN}/opencode2.exe` exists.
2. **Atomic In-Place Rename**: If an auto-update dropped a new `.exe` binary, the wrapper immediately renames it to `opencode2` and sets `chmod +x`.
3. **Execution Guarantee**: It always executes `bin/opencode2` (clean ELF binary). This guarantees that OpenCode v2's internal `posix_spawn(process.execPath, ...)` spawns the background server without triggering WSLInterop PE format validation errors.
4. **Zero Maintenance**: No human or LLM intervention is needed when OpenCode v2 publishes new nightly builds.
