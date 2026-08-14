---
name: opencode2-playbook
description: OpenCode 2 master operational and migration playbook for side-by-side installation, XDG environment isolation, and native V2 plugin architecture.
---

# Skill: opencode2-playbook

# OpenCode 2 (V2) Master Operational & Installation Playbook

## Quick Start & Commands
- **Launch Interactive TUI (Isolated V2):** `opencode2`
- **Run Headless Non-Interactive Task:** `opencode2 run "your prompt here"`
- **Start Background Daemon Manually:** `opencode2 serve --service`
- **Inspect OpenCode 2 Version:** `opencode2 --version` (Outputs: `0.0.0-next-17430` or newer)
- **Inspect Active Log Stream:** `tail -f ~/.local/share/opencode2/opencode/log/opencode.log`
- **Check Side-by-Side Isolation:**
  ```bash
  which opencode   # /home/linuxbrew/.linuxbrew/bin/opencode (V1 Stable)
  which opencode2  # ~/.local/bin/opencode2 (V2 Next Isolated Wrapper)
  ```

---

## ⛔ CRITICAL ARCHITECTURAL MANDATES & ENVIRONMENT ISOLATION

### 1. Physical Environment Isolation (V1 vs V2)
OpenCode V1 and OpenCode V2 must **never** share state, sockets, or configuration directories. If un-isolated, V2 will overwrite V1's `~/.config/opencode/service.json` and crash active V1 sessions.

| Dimension | OpenCode V1 (Stable) | OpenCode V2 (Beta / Preview) |
|---|---|---|
| **Binary Command** | `opencode` | `opencode2` |
| **CLI Runtime** | Bun standalone binary | Node 20+ ESM executable |
| **Global Config Root** | `~/.config/opencode/` | `~/.config/opencode2/` (via `XDG_CONFIG_HOME`) |
| **XDG Config Root** | `~/.config` | `~/.config/opencode2_xdg` (`-> ~/.config/opencode2`) |
| **XDG Data Root** | `~/.local/share/opencode` | `~/.local/share/opencode2` |
| **XDG State Root** | `~/.local/state/opencode` | `~/.local/state/opencode2` |
| **XDG Cache Root** | `~/.cache/opencode` | `~/.cache/opencode2` |
| **Repo Config** | `./opencode.json` & `./.opencode/` | `./opencode2.json` & `./.opencode2/` |
| **Plugin Package** | `@opencode-ai/plugin@1.x` | `@opencode-ai/plugin@next` (`0.0.0-next-*`) |

---

## 2. Complete Step-by-Step Installation & Setup Recipe

Follow these exact steps to set up OpenCode 2 on any Linux / WSL system without disrupting OpenCode V1:

### Step 1: Install Global CLI Package
```bash
npm install -g @opencode-ai/cli@next
```

### Step 2: Create Dedicated XDG Directories & Isolation Symlink
```bash
mkdir -p ~/.config/opencode2 ~/.config/opencode2_xdg ~/.local/share/opencode2 ~/.local/state/opencode2 ~/.cache/opencode2
ln -sfn /home/yapilwsl/.config/opencode2 /home/yapilwsl/.config/opencode2_xdg/opencode
```

### Step 3: Create Self-Healing Launcher Wrapper (`~/.local/bin/opencode2`)
On WSL/Linux, background auto-updates may restore Windows `.exe` formats or reset paths. This wrapper guarantees environment isolation and fixes binary permissions automatically:

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

Ensure `~/.local/bin` is in `$PATH` ahead of any fallback paths.

### Step 4: Configure Global OpenCode 2 Settings (`~/.config/opencode2/config.json`)
Create `~/.config/opencode2/config.json` (and symlink `~/.config/opencode2/opencode.json -> config.json`):

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
  "plugins": [],
  "provider": {
    "literouter": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "LiteRouter",
      "options": {
        "baseURL": "http://localhost:7766/v1",
        "apiKey": "sk-lr-8f2a9e3b1c4d7e5f",
        "chunkTimeout": 120000
      },
      "models": {}
    }
  }
}
```

Link config:
```bash
ln -sfn ~/.config/opencode2/config.json ~/.config/opencode2/opencode.json
```

### Step 5: Install Plugin SDK Dependencies
```bash
npm install --prefix ~/.config/opencode2 @opencode-ai/plugin@next
```

---

## 3. OpenCode 2 Native Plugin Architecture

### Core Rule: V1 Plugins Are Completely Incompatible with V2
- **V1 Shape:** `export const plugin: Plugin = async () => ({ tool: { ... } })`
- **V2 Shape:** `export default Plugin.define({ id: string, setup: async (ctx) => { ... } })`

### A. Registering Custom Tools in V2 (`clean_python`, `clean_ts`)
Use `ctx.tool.transform` with `{ codemode: false }` so the LLM can call the tool directly:

```typescript
import { Plugin } from "@opencode-ai/plugin";

export default Plugin.define({
  id: "clean-python",
  setup: async (ctx) => {
    await ctx.tool.transform((tools) => {
      tools.add({
        name: "clean_python",
        description: "Deterministically verifies Python code against strict quality constraints before saving.",
        input: {
          type: "object",
          properties: {
            file_path: { type: "string", description: "Relative target path inside the workspace." },
            pydantic_architecture_plan: { type: "string", description: "Architecture safety plan." },
            code_payload: { type: "string", description: "Complete source code." }
          },
          required: ["file_path", "pydantic_architecture_plan", "code_payload"],
          additionalProperties: false
        },
        options: { codemode: false }, // Critical: false makes tool directly callable by model
        execute: async (args) => {
          // Perform validation & atomic file writing
          return { content: `SUCCESS: Saved to ${args.file_path}` };
        }
      });
    });
  }
});
```

### B. Registering Dynamic System Prompt / Workflow Hooks (`remind-workflow`)
Use `ctx.session.hook("context", ...)` to inject real-time context (e.g. `bd prime`) before every turn:

```typescript
import { Plugin } from "@opencode-ai/plugin";
import { execSync } from "node:child_process";

export default Plugin.define({
  id: "remind-workflow",
  setup: async (ctx) => {
    await ctx.session.hook("context", async (event) => {
      try {
        const primeOutput = execSync("bd prime", { encoding: "utf-8", timeout: 5000 });
        if (Array.isArray(event.system)) {
          event.system.push({
            type: "text",
            text: `# MANDATORY RULES\n${primeOutput}`
          } as any);
        }
      } catch (err) {
        console.error("[Plugin] remind-workflow context hook error:", err);
      }
    });
  }
});
```

---

## 4. Repository-Level Setup (`opencode2.json` & `.opencode2/`)

To support project-specific plugins in any repo:

1. Create repository folders:
   ```bash
   mkdir -p .opencode2/plugins .opencode2/skills
   ```
2. Install `@opencode-ai/plugin@next` in `.opencode2`:
   ```bash
   npm install --prefix .opencode2 @opencode-ai/plugin@next
   ```
3. Place your V2 plugins in `.opencode2/plugins/`:
   - `.opencode2/plugins/clean_python.ts`
   - `.opencode2/plugins/clean_ts.ts`
   - `.opencode2/plugins/remind-workflow.ts`
4. Create `opencode2.json` at project root:
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
5. Ensure `.gitignore` protects internal state:
   ```gitignore
   .opencode2/
   !.opencode2/skills/
   ```

---

## 5. Troubleshooting & Root Cause Analysis

| Error / Symptom | Root Cause | Solution |
|---|---|---|
| `SchemaError: Missing key at ["default"]["setup"]` | Plugin uses legacy V1 export format (`server: Plugin`) | Upgrade plugin to `Plugin.define({ id, setup: async (ctx) => ... })` from `@opencode-ai/plugin@next`. |
| `SchemaError: Missing key at ["default"]` | Outdated V1 npm package in `"plugins"` array (e.g. `npm:opencode-beads@0.7.0`) | Remove V1 package from `config.json`; use native `bd` CLI and `remind-workflow.ts`. |
| `Error: Model unavailable: <model>` | Unprefixed model ID in `config.json` | Prefix model references with provider ID: `literouter/<vendor>/<model_name>`. |
| `ENOEXEC: posix_spawn ... opencode2.exe` | WSL kernel format issue with `.exe` extension on native Linux binaries | Rename binary to `opencode2` and chmod `+x` via `~/.local/bin/opencode2` wrapper. |
| V1 session crashes with `Unexpected server error` | V2 wrote socket to `~/.config/opencode/service.json` | Fix `XDG_CONFIG_HOME` and `XDG_STATE_HOME` in launcher wrapper. |
