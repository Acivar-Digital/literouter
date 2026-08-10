# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

## ⛔ ABSOLUTE MANDATE: NEVER TOUCH API KEYS OR `.env.local`
- **NEVER** modify, edit, sanitize, replace, or overwrite API keys or `.env.local` / `.env` files under any circumstances.
- **NEVER** run automated sanitization or guardrail scripts against `.env.local` or `.env`.
- Replacing real API keys with `<REDACTED>` or placeholder values destroys gateway operation by causing `staticValidateKeys` to discard all provider keys on boot.

---

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:6cd5cc61 -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md for details and anti-patterns.

## Agent Context Profiles

The managed Beads block is task-tracking guidance, not permission to override repository, user, or orchestrator instructions.

- **Conservative (default)**: Use `bd` for task tracking. Do not run git commits, git pushes, or Dolt remote sync unless explicitly asked. At handoff, report changed files, validation, and suggested next commands.
- **Minimal**: Keep tool instruction files as pointers to `bd prime`; use the same conservative git policy unless active instructions say otherwise.
- **Team-maintainer**: Only when the repository explicitly opts in, agents may close beads, run quality gates, commit, and push as part of session close. A current "do not commit" or "do not push" instruction still wins.

## Session Completion

This protocol applies when ending a Beads implementation workflow. It is subordinate to explicit user, repository, and orchestrator instructions.

1. **File issues for remaining work** - Create beads for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **Handle git/sync by active profile**:
   ```bash
   # Conservative/minimal/default: report status and proposed commands; wait for approval.
   git status

   # Team-maintainer opt-in only, unless current instructions forbid it:
   git pull --rebase
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->


## Build & Test

_Add your build and test commands here_

```bash
# Example:
# npm install
# npm test
```

## Architecture Overview

_Add a brief overview of your project architecture_

## Conventions & Patterns

### Grounding & Anti-Hallucination: Never Guess Signatures or Field Names

LLMs frequently hallucinate function signatures, options objects, and data structures by copying patterns from external libraries (e.g., assuming `logWarn` takes a Winston/Pino logger metadata object). **You must strictly ground every call in the codebase's actual definitions.**

#### 🟢 POSITIVES (Always Do This):
1. **Inspect Before Calling:** Always read the definition site of a function or interface (`read` or `grep`) before invoking it.
2. **Mirror Existing Call Sites:** Check 2-3 existing call sites in the repository to observe established conventions.
3. **Verify Parameter Types:** In TypeScript, check parameter lists (e.g., `logWarn(emoji: string, msg: string)` requires an emoji string and a string message, not `{ error: ... }`).
4. **Clean Lifecycle Hooks:** When using asynchronous timers or intervals (`setInterval`), always implement explicit teardown (`cancel()` on `TransformStream`, `stopKeepAlive()` on error).

#### 🔴 NEGATIVES (Never Do This):
1. **DO NOT assume external conventions:** Never assume an internal helper behaves like an npm package or external framework (e.g., passing `{ error }` objects to `logWarn`).
2. **DO NOT invent fields or options:** Never add speculative fields to API payloads, headers, or config objects without verifying against upstream docs or internal schemas.
3. **DO NOT leave ungrounded catch blocks:** When adding logging to catch blocks, verify the logger function signature rather than guessing.
4. **DO NOT introduce un-cleared background intervals:** Never start a timer or background task without guaranteeing cancellation on error or reader disconnect.

| Scenario | 🔴 Anti-Pattern (Hallucinated) | 🟢 Grounded Pattern (Verified) |
|---|---|---|
| Logging warning in TS | `logWarn("error", { err })` *(causes `[object Object]`)* | `logWarn(EMOJI.warn, \`Error details: \${err}\`)` |
| Internal helper invocation | Assuming parameter order/types from intuition | `read` declaration in `src/config/env.ts` first |
| SSE keepalive timers | Starting `setInterval` with no `cancel()` hook | Implementing `cancel() { stopTimer(); }` on stream |
