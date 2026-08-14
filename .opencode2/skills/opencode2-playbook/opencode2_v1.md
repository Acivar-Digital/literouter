# OpenCode 2 Plugin Architecture & Custom Plugin Migration Record

## 1. Overview & Status

OpenCode 2 introduces a breaking architectural overhaul to the plugin engine. Legacy OpenCode V1 plugins cannot run directly in OpenCode 2 due to incompatible export contracts, hook APIs, and runtime schemas.

As of this migration, all customized workspace and global tooling plugins have been upgraded to the native OpenCode V2 API (`@opencode-ai/plugin@next`).

---

## 2. Core Architectural Differences (V1 vs V2)

| Dimension | OpenCode V1 | OpenCode V2 |
|---|---|---|
| **Package Dependency** | `@opencode-ai/plugin@1.x` | `@opencode-ai/plugin@next` (`0.0.0-next-*`) |
| **Plugin Module Export** | `{ id: string, server: Plugin }` | `export default Plugin.define({ id: string, setup: async (ctx) => ... })` |
| **Config Schema Key** | `"plugin": [ ... ]` | `"plugins": [ ... ]` |
| **Tool Registration** | Returned via `{ tool: { tool_name: toolInstance } }` | Registered via `await ctx.tool.transform((tools) => { tools.add({ name, description, input, execute, options: { codemode: false } }) })` |
| **Workflow / System Injection** | `"experimental.chat.system.transform"` hook | `await ctx.session.hook("context", (event) => { event.system.push(...) })` |
| **Auto-Discovery Paths** | `.opencode/plugins/`, `~/.config/opencode/plugins/` | `.opencode2/plugins/`, `~/.config/opencode2/plugins/` (isolated via XDG) |

---

## 3. Migrated Custom Plugins

### A. `clean_python.ts` (Global & Project)
- **Locations:** `~/.config/opencode2/plugins/clean_python.ts`, `.opencode2/plugins/clean_python.ts`
- **ID:** `clean-python`
- **Exposed Tool:** `clean_python` (direct tool calling with `{ codemode: false }`)
- **Behavior:** Enforces strict quality constraints (`clean_py`, Ruff, MyPy strict, Radon CC < 6, AST anti-slop) before atomically writing `.py` files to disk.

### B. `clean_ts.ts` (Global & Project)
- **Locations:** `~/.config/opencode2/plugins/clean_ts.ts`, `.opencode2/plugins/clean_ts.ts`
- **ID:** `clean-ts`
- **Exposed Tool:** `clean_ts` (direct tool calling with `{ codemode: false }`)
- **Behavior:** Enforces TypeScript strict quality constraints (`clean_ts` CLI, tsc strict, ESLint rules, AST policy, CC < 6) before atomically writing `.ts`/`.tsx` files to disk.

### C. `remind-workflow.ts` (Project)
- **Location:** `.opencode2/plugins/remind-workflow.ts`
- **ID:** `remind-workflow`
- **Hook:** `ctx.session.hook("context", ...)`
- **Behavior:** Dynamically executes `bd prime` on every turn and injects project workflow constraints + live beads task status directly into `event.system`.

---

## 4. Incompatible V1 npm Packages

- **`opencode-beads@0.7.0`:** Authoring against V1 caused schema error `Missing key at ["default"]`. Removed from `~/.config/opencode2/config.json`. Beads tracking is handled natively via `bd` CLI and `remind-workflow.ts`.
- **`antigravity-quota`:** Moved to `~/.config/opencode2/legacy_plugins/antigravity-quota` until ported to V2.
