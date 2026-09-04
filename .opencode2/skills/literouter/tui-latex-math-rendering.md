# OpenCode 2 TUI LaTeX & Math Rendering Guide

This guide documents the rendering behavior, root causes of LaTeX/math artifacts in terminal user interfaces (TUI), upstream OpenCode tracking, auto-patcher resilience, and recommended engineering practices for clear mathematical output across OpenCode 2 CLI, Antigravity IDE, and external chat clients.

---

## 1. Executive Overview: Rendering Environments

Mathematical notation ($...$, $$...$$, `\mathbf{...}`, `\frac{...}{...}`) renders radically differently across AI coding assistants and user interfaces:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              INTERFACE RENDERING PROFILES                              │
├─────────────────────────┬──────────────────────────────────┬───────────────────────────┤
│ Environment             │ Engine / Renderer                │ Math Output Capability    │
├─────────────────────────┼──────────────────────────────────┼───────────────────────────┤
│ OpenCode 2 TUI (CLI)    │ Terminal Character Grid (ANSI)   │ Raw LaTeX strings unless  │
│                         │ (No DOM / No CSS / No Web KaTeX) │ normalized to Unicode     │
├─────────────────────────┼──────────────────────────────────┼───────────────────────────┤
│ Antigravity IDE (WSL2)  │ Chromium / VSCode Webview        │ Full KaTeX / MathJax      │
│                         │ (DOM + Math Web Fonts + CSS)     │ Graphical Equations       │
├─────────────────────────┼──────────────────────────────────┼───────────────────────────┤
│ Telegram / Chat Bots    │ HTML / Markdown parse_mode       │ Monospace code blocks or  │
│                         │ (Unicode / utf-8 text stream)    │ Unicode characters        │
└─────────────────────────┴──────────────────────────────────┴───────────────────────────┘
```

1. **OpenCode 2 TUI (CLI)**: Runs directly in a virtual terminal (xterm-256color, Kitty, Alacritty, Windows Terminal). Terminals operate on fixed-width character grids and ANSI escape sequences. Because there is no browser DOM or CSS engine, raw LaTeX commands (`\mathbf{}`, `\times`, `\frac{}`) cannot be drawn as vector/KaTeX formulas without explicit text-to-Unicode conversion.
2. **Antigravity IDE / Desktop Webview**: Runs inside Electron/Chromium with KaTeX or MathJax injected into the webview DOM. Delimiters (`$` and `$$`) are parsed into formatted HTML/CSS spans with mathematical glyphs.
3. **Telegram / Bot Integrations**: Does not support native LaTeX. Mathematical expressions must either be formatted as Unicode symbols (`λ`, `≈`, `×`, `Σ`) or wrapped in monospace code blocks.

---

## 2. Root Cause of Raw Math Artifacts in TUI

When LLMs emit standard LaTeX formatting into the OpenCode 2 TUI, developers encounter two distinct visual failure modes:

### A. Raw Unrendered Syntax
When models produce formulas like:
```text
$$\mathbf{L} = \lambda \times \mathbf{W}$$
```
The TUI prints raw backslashes and braces, cluttering the terminal output and making equations difficult to read quickly.

### B. ASCII Table Token Fracturing & Line-Wrapping Artifacts
When LaTeX expressions are placed inside markdown tables or tight terminal columns, the CLI's terminal word-wrap engine breaks words across delimiter boundaries:
```text
| Metric | Value |
|--------|-------|
| Speed  | $\mathbf{1,350 \text{ |
|        | RPM}}$                |
```
This fracturing causes:
- Broken LaTeX syntax tokens (opening `$\mathbf{` split from closing `}$`).
- Unmatched delimiter errors in downstream parsers.
- Terminal block glyph overflow artifacts (e.g. `▄`, `█`, `░`) when control characters or box-drawing borders intersect wrapped spans.

---

## 3. Upstream OpenCode GitHub Tracking

The OpenCode community and core maintainers have addressed math and LaTeX rendering across several issues and PRs:

| Reference | Type | Title / Focus |
|---|---|---|
| **Issue #15892 / #30712** | Bug | Dollar signs (`$`) in plain text incorrectly triggering broken LaTeX parsing/rendering in TUI. |
| **PR #30715** | Fix | Guard against unescaped currency and standalone dollar signs in markdown text parser. |
| **Issue #11655 / #34407** | Feature | Feature request for native LaTeX math rendering / Unicode fallback in CLI/TUI. |
| **PR #38995** | Core Fix | `fix(tui): render LaTeX math as Unicode in the CLI` — introduces terminal math normalization converting common LaTeX symbols to Unicode glyphs. |
| **Issue #39311 / #15053 / #24426** | Bug / Enhancement | Markdown math normalization, inline KaTeX delimiter support, and multiline equation block handling. |

---

## 4. OpenCode2 Auto-Patcher & Self-Healing Resilience

Upstream npm updates (`npm update -g @opencode-ai/cli` or background daemon auto-updates) can overwrite local runtime patches or break CLI binary links.

### How Self-Healing Works:
1. **Launch Wrapper**: The entrypoint wrapper at `~/.local/bin/opencode2` executes `scripts/opencode2_autopatch.sh` **on every single launch** before handing execution over to the Node binary.
2. **Sub-5ms Verification**:
   - Locates active `@opencode-ai/cli` in Node/NVM paths.
   - Detects and replaces dummy placeholder binaries (e.g. unbuilt postinstall stubs).
   - Validates execution permissions (`chmod +x`).
   - Verifies tool message format normalization (`role: "tool"` content array to string conversion).
   - Ensures network error resilience (prevents silent subagent exits on stream interruption).
   - Maintains automatic `.bak` safety backups before touching files.

```
~/.local/bin/opencode2 (invocation)
      │
      ├──> scripts/opencode2_autopatch.sh (<5ms check)
      │      ├── Verify binary integrity & permissions
      │      ├── Apply runtime hotfixes & backups (.bak)
      │      └── Validate Node module state
      │
      └──> node @opencode-ai/cli/bin/opencode.js (clean execution)
```

To run a manual self-heal check at any time:
```bash
bash scripts/opencode2_autopatch.sh -v
```

---

## 5. Recommended Engineering Practices & Mitigations

### 1. System Prompt Rule (Preferred for Terminal Output)
Instruct LLMs to emit native UTF-8 Unicode characters and plain text arithmetic rather than LaTeX notation when communicating in terminal sessions or generating documentation tables.

| Math Target | Anti-Pattern (LaTeX) | Best Practice (Unicode / Plain Text) |
|---|---|---|
| Multiplication | `$A \times B$` | `A × B` |
| Approximation | `$\approx 3.14$` | `≈ 3.14` |
| Subscripts / Variables | `$\lambda_{max} \le \alpha$` | `λ_max ≤ α` |
| Formulas | `$$\mathbf{L} = \frac{\lambda}{W}$$` | `L = λ / W` |
| Table cells | `$\mathbf{1,350\text{ RPM}}$` | `1,350 RPM` |

### 2. Local OpenCode2 Plugin Option (Regex Math Normalization)
For automated client-side scrubbing, a V2 plugin hook can normalize math expressions in streaming deltas or message context inside `.opencode2/plugins/`:

```typescript
// Example snippet for LaTeX to Unicode translation in a plugin hook
function latexToUnicode(text: string): string {
  if (!text) return "";
  return text
    .replace(/\\times/g, "×")
    .replace(/\\approx/g, "≈")
    .replace(/\\le(q)?/g, "≤")
    .replace(/\\ge(q)?/g, "≥")
    .replace(/\\lambda/g, "λ")
    .replace(/\\alpha/g, "α")
    .replace(/\\beta/g, "β")
    .replace(/\\mathbf\{([^}]+)\}/g, "$1")
    .replace(/\\text\{([^}]+)\}/g, "$1")
    .replace(/\$([^$]+)\$/g, "$1");
}
```

### 3. Upstream CLI Update & Re-Patch
When upstream releases PR #38995 or updated TUI formatting releases:
```bash
# Update global CLI to latest
npm install -g @opencode-ai/cli@next

# Re-run LiteRouter auto-patcher to guarantee custom guards remain intact
bash scripts/opencode2_autopatch.sh -v
```
