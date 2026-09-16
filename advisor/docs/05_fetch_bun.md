# 05 Fetch bun

Documentation for `advisor/fetch/copilot_view.ts`, a Bun-native extraction script that fetches web pages into clean markdown or raw HTML via Scrapling or headless Chrome fallback.

## a. Inputs & Dependencies

- **Source File**: `advisor/fetch/copilot_view.ts`
- **CLI Arguments & Flags** (`advisor/fetch/copilot_view.ts:21-49`):
  - `<url>`: Positional target URL (required, fails with code 1 if missing; `advisor/fetch/copilot_view.ts:37-39,42-46`).
  - `--selector`, `-s`: Target CSS selector (defaults to `"article,main"`; `advisor/fetch/copilot_view.ts:12,23,31-32`).
  - `--diet`: Enables diet mode (`diet = true`) for noise stripping or AI-targeted extraction (default: `false`; `advisor/fetch/copilot_view.ts:13,24,33-34`).
  - `--keep-all`: Explicitly sets `diet = false` to retain raw markup (default: `true`, raw; `advisor/fetch/copilot_view.ts:14,35-36`).
  - `--help`, `-h`: Prints usage and options (`advisor/fetch/copilot_view.ts:5-19,28-30`).
- **Raw-Default Constraint**:
  - Raw mode is the default state (`diet = false`); content is kept unstripped unless `--diet` is explicitly provided (`advisor/fetch/copilot_view.ts:14,24,96-103`).
- **Profile Directory Requirement**:
  - Resolves `ADVISOR_PROFILE` env var or defaults to `$HOME/.advisor_tools/profile` (`advisor/fetch/copilot_view.ts:70`).
  - Halts execution with exit code 1 if the directory does not exist (`advisor/fetch/copilot_view.ts:71-74`).
- **Binary Dependencies**:
  - `bun` runtime (`advisor/fetch/copilot_view.ts:1`).
  - Optional `scrapling` CLI in `PATH` (`advisor/fetch/copilot_view.ts:80`).
  - Headless Chrome/Chromium binary discovery via `findChrome()` if Scrapling is absent (`advisor/fetch/copilot_view.ts:51-66,89`).

## b. Transformation

- **Temporary Workspace Allocation**:
  - Creates unique temporary directory `fs.mkdtempSync("/tmp/advisor-XXXXXX")` containing `content.md` and `content.html` (`advisor/fetch/copilot_view.ts:76-78`).
- **Scrapling vs Headless Fallback Execution Flow**:
  - **Scrapling Path** (`Bun.which("scrapling")` present, `fallback = false`; `advisor/fetch/copilot_view.ts:80-87`):
    - Runs `scrapling extract stealthy-fetch <url> <mdPath> [-s <selector>]` via `Bun.spawnSync` (`advisor/fetch/copilot_view.ts:84,86-87`).
    - Appends `--ai-targeted` only when `diet` is true (`advisor/fetch/copilot_view.ts:85`).
  - **Headless Chrome Fallback** (`scrapling` absent, `fallback = true`; `advisor/fetch/copilot_view.ts:88-105`):
    - Resolves candidate browser executable (`advisor/fetch/copilot_view.ts:51-66,89`).
    - Executes headless browser: `[chromeBin, "--headless", "--dump-dom", "--user-data-dir=${profile}", "--no-sandbox", "--disable-gpu", url]` (`advisor/fetch/copilot_view.ts:90-93`).
    - Writes raw DOM stdout to `content.html` (`advisor/fetch/copilot_view.ts:94-95`).
    - Transforms markup to markdown/text for `content.md`:
      - If `diet === true`: strips `<script>`, `<style>`, and HTML tags, collapsing whitespace (`advisor/fetch/copilot_view.ts:96-102`).
      - If `diet === false` (raw default): preserves full raw HTML string (`advisor/fetch/copilot_view.ts:103`).
    - Writes transformed string to `content.md` (`advisor/fetch/copilot_view.ts:104`).

## c. Outputs & Dependencies

- **File Artifacts**:
  - Markdown / text output: `mdPath` (`/tmp/advisor-*/content.md`; `advisor/fetch/copilot_view.ts:77,104`).
  - Raw HTML output (fallback mode): `htmlPath` (`/tmp/advisor-*/content.html`; `advisor/fetch/copilot_view.ts:78,95`).
- **Standard Output Schema**:
  - Prints a single JSON object to stdout (`advisor/fetch/copilot_view.ts:18,108`):
    - `mdPath` (string): Absolute filesystem path to generated content file (`advisor/fetch/copilot_view.ts:77,108`).
    - `size` (number): Byte size of `mdPath` on disk (`advisor/fetch/copilot_view.ts:107-108`).
    - `profile` (string): Path to browser user-data-dir profile directory used (`advisor/fetch/copilot_view.ts:70,108`).
    - `fallback` (boolean): `true` if headless Chrome fallback was used, `false` if Scrapling handled extraction (`advisor/fetch/copilot_view.ts:81,108`).
    - `diet` (boolean): Whether diet extraction was active (`advisor/fetch/copilot_view.ts:48,108`).
- **Downstream Consumers**:
  - Consumed by CLI wrappers, MCP review tools, or downstream agents parsing structured JSON from stdout to locate extracted content.
