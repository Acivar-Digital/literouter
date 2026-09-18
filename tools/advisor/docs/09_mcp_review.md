# 09 MCP review

Documentation for the Copilot Review Model Context Protocol (MCP) server implementation in `advisor/mcp/copilot_review.ts`.

## a. Inputs, Transport & Security Boundaries

- **Transport**: JSON-RPC 2.0 over standard I/O (`process.stdin` and `process.stdout`) using `readline` (`advisor/mcp/copilot_review.ts:79-82`). CLI mode `--list` is supported for manual inspection (`advisor/mcp/copilot_review.ts:73-77`).
- **Protocol Handlers**:
  - `initialize` (`advisor/mcp/copilot_review.ts:88-97`): Protocol version `2024-11-05`, tools capability, server `copilot-review` v1.0.0.
  - `tools/list` (`advisor/mcp/copilot_review.ts:98-99`): Exposes registered tool declarations.
  - `tools/call` (`advisor/mcp/copilot_review.ts:100-112`): Dispatches execution with error handling (code `-32603`).
- **Security & Path Allowlist**:
  - Strict directory boundary enforcement in `reviewScript`: file paths are normalized and must reside inside `advisor/` (`advisor/mcp/copilot_review.ts:25-28`). Any path outside triggers `Access denied: path must be inside advisor/`.
- **External Dependencies**:
  - `getView` relies on `../fetch/copilot_view.ts` (executed via `bun`) and optional `../fetch/parse_view.py` (executed via `python3`) (`advisor/mcp/copilot_review.ts:10-19`).

## b. Transformation, Tool Logic & Prompt Bundles

The server executes three core functions and transforms arguments into structured execution outputs or prompt bundles:

1. **`getView(url, selector?)`** (`advisor/mcp/copilot_review.ts:9-22`):
   - Invokes fetch script to retrieve URL and optional selector into a markdown file (`/tmp/copilot_view_<timestamp>.md`).
   - Runs `parse_view.py` if present and calculates character count.
2. **`reviewScript(filePath, viewContext?)`** (`advisor/mcp/copilot_review.ts:24-37`):
   - Validates allowlist and file existence (`advisor/mcp/copilot_review.ts:26-30`).
   - Generates a **`PromptBundle`** (`advisor/mcp/copilot_review.ts:7,33-36`):
     - `system`: `"critical senior QA, fail loud file:line"` (`advisor/mcp/copilot_review.ts:34`).
     - `user`: Formats target script source code against `<view>` context (`advisor/mcp/copilot_review.ts:35`).
3. **`critiquePlan(planText)`** (`advisor/mcp/copilot_review.ts:39-41`):
   - Generates a **`PromptBundle`** (`advisor/mcp/copilot_review.ts:7,39-41`):
     - `system`: `"red-team plan critique"` (`advisor/mcp/copilot_review.ts:40`).
     - `user`: Truncates input plan to 2000 characters (`advisor/mcp/copilot_review.ts:40`).

## c. Outputs & Tool Schemas (`TOOLS`)

Exported tool registry `TOOLS` (`advisor/mcp/copilot_review.ts:43-71`) defines JSON-RPC tool schemas:

- **`getView`** (`advisor/mcp/copilot_review.ts:44-52`):
  - Inputs: `url` (string, required), `selector` (string, optional).
  - Emits: `ViewResult` (`{ mdPath: string, chars: number }`) (`advisor/mcp/copilot_review.ts:6,21`).
- **`reviewScript`** (`advisor/mcp/copilot_review.ts:53-61`):
  - Inputs: `path` (string inside `advisor/`, required), `view` (string context, optional).
  - Emits: `PromptBundle` (`{ system: string, user: string }`) (`advisor/mcp/copilot_review.ts:7,33-36`).
- **`critiquePlan`** (`advisor/mcp/copilot_review.ts:62-70`):
  - Inputs: `planText` (string, required).
  - Emits: `PromptBundle` (`{ system: string, user: string }`) (`advisor/mcp/copilot_review.ts:7,40`).
- **JSON-RPC Response Wrapping**:
  - Successful tool calls wrap stringified results in `{ content: [{ type: "text", text: ... }] }` (`advisor/mcp/copilot_review.ts:109`).
