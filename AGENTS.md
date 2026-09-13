# AGENTS.md

Mandatory operational guidance for AI agents working in this repository.

## ⛔ ABSOLUTE MANDATE: NEVER TOUCH API KEYS OR `.env.local`
- **NEVER** edit, sanitize, replace, or overwrite API keys or `.env.local` / `.env` files. Automated sanitization against `.env*` is forbidden.
- **NEVER** hardcode keys into code, tests, docs, or commits. Use `/tmp` or gitignored `scratch/` for ad-hoc scripts.
- Replacing keys with `<REDACTED>` destroys gateway boot (`staticValidateKeys` drops all keys).
- `.env.local` is write-protected via `protect.sh` (owned by root, `644`). Do not bypass.
- **Safe Testing Recipe**: (1) Unit tests: use mock stubs (`sk-test-stub-...`, `nvapi-key1`). (2) Integration: call local proxy at `http://localhost:7766/v1/chat/completions` with client auth (`Bearer sk-lr-your-auth-key`). (3) Diagnostic scripts: dynamically read `Bun.env.NVIDIA_API_KEYS` / `os.environ.get("NVIDIA_API_KEYS")`.

---

## Technical Knowledge Base & Fixed Core Paths
- **LiteRouter Skill (Absolute)**: `/home/yapilwsl/arthityap/literouter/.opencode2/skills/literouter/SKILL.md` (dir: `.opencode2/skills/literouter/`)
- **Key Docs**: `CHANGELOG.md`, `docs/ARCHITECTURE.md`, `docs/Fix_Streaming_01.md` (streaming spec), `docs/Longrunning_Mode.md`
- **Main Handlers**: `src/handlers/openai_compat.ts`, `src/network/fetcher.ts`, `src/network/pacer.ts`
- **Lazy-Load Guides**: Antigravity IDE: `.opencode2/skills/literouter/agy-ide-setup.md` | TUI Math: `.opencode2/skills/literouter/tui-latex-math-rendering.md` | Test Hygiene: `.opencode2/skills/literouter/test-hygiene-playbook.md`
- **Rate Limiting (Zdist Retired)**: Client-side sliding-window tracking is retired (see `docs/GRAVEYARD/ZDIST.md`). Active stack: deterministic **RequestPacer** (`src/network/pacer.ts`) + reactive **CooldownManager** (`src/network/cooldown.ts` 429 quarantine with `Retry-After`).
- **OpenCode Config Format**: v1 (`.opencode/opencode.json`, key: `"plugin"` [strings]) vs v2 (`.opencode2/opencode.json`, key: `"plugins"` [strings or `{ package, options }`]).

---

## Session Start & Skill Protocol
1. **Initialize Beads**: Run `bd prime` (or `bd ready`) immediately on session start.
2. **Load Skill (MANDATORY)**: Run `skill load "literouter"` at conversation start. Fallback: load immediately if touching gateway routing, keys, streaming, models, or errors.
3. **Ticket (Definition of Done)**: Create issue if not already tracked: `bd create "..." -t task -p 2 -d "..." --acceptance="1. Deterministic verification passes\n2. Output artifact exists"` (`validation.on-create: error` is enforced; omitting `--acceptance` fails).
4. **Claim**: Run `bd update <id> --claim`.
5. **Resume Protocol**: If context is lost or session restarts, run `bd list --status in_progress --json` to find your claimed task and continue. Never ask the user "what should I work on?" if tasks are in progress. [Rationale: Persistent brain in beads].

---

## Mandatory Pre-Response Ritual

Output this block before executing code or commands. No exceptions.

```markdown
### REQUEST INTAKE
I understand you want: [one sentence restatement in your own words]

### CRITICAL ASSUMPTIONS
- [ ] Assumption 1
- [ ] Assumption 2

### RISKS AND UNKNOWNS
- Risk 1
- Unknown 1

### PLAN
| Step | Action | Verify By |
|------|--------|-----------|
| 1    | ...    | ...       |
| 2    | ...    | ...       |

### APPROVAL?
- [ ] YES - Major change (>50 lines / new deps) -> HALTING. Reply APPROVED / MODIFY / CANCEL.
- [ ] NO  - Proceeding autonomously. Stating: "Self-approving - YOLO active."
```
- **Modes**: Antigravity (involved) waits for human `APPROVED`. Opencode (YOLO) self-approves if flagged NO ("Self-approving - YOLO active").
- [Rationale: Surface intent and front-load ambiguity resolution before touching code].
- **Fast Path (Trivial Tasks)**: Output the ritual with `APPROVAL?: [x] NO (YOLO)`. To track in beads without validation errors: (1) `bd create "..." -t task -p 4 --acceptance="1. Verified"`, (2) Implement immediately, (3) `bd close <id> --reason "Completed"`.

---

## Change Management & Approval Gates

- **Workflow Pipeline**: `Request -> Ritual -> Claim Bead -> Implement -> Quality Gates (Typecheck + Test) -> Close Bead -> Push`
- **Provider/Model Changes Sequence**: (1) Checkpoint: `uv run python admin/code_hygiene/agent_guardrail.py checkpoint <path>`, (2) Skill: `skill load "literouter"`, (3) Doctor: `bun run scripts/doctor.ts`, (4) Suite: `bun test && uv run pytest tests/integration/`, (5) Validate: `uv run python admin/code_hygiene/agent_guardrail.py validate <path>`. Categories: Provider Add/Remove (`src/index.ts`), Model Add/Remove (`fusion.json`).
- **Approval Gate (>50 lines, new deps, schema changes)**:
  1. Write plan: `bd update <id> --design "..."` | 2. Chat: `APPROVAL REQUIRED: [decision]` | 3. Flag: `bd human <id>` | 4. **STOP**.
  5. **Swapping**: Interactive chat = HALT and wait for user response; Headless/batch execution = run `bd ready` and claim next task while waiting. [Rationale: Respect user focus in chat; prevent stalling in batch].

---

## Master Commands & Quality Gates

| Gate / Action | Command | Verification Threshold | Environment |
|---|---|---|---|
| Static Typecheck | `bun run typecheck` | Zero errors (`tsc --noEmit`), exit code 0 | Local |
| TS AST Quality | `node node_modules/clean_ts/dist/cli.js validate <file>` | `valid: true`, AST anti-slop pass, complexity < 6 | Local |
| Python Lint | `uv run ruff check .` | Zero errors output | Local |
| Fast Gateway Tests | `bun run test:gateway` | All pass (938 fast unit tests in `tests/unit`, no eval noise) | Local |
| Failure-Only Test | `bun run test:failures` | `bun test --only-failures` (outputs only failing tests) | Local |
| Eval Grader Tests | `bun run test:eval` | All pass (182 benchmark eval grader tests in `tests/eval`) | Local |
| Full Gateway Suite | `bun test` | All pass, exit code 0 (pipe to `/tmp/test.log` if needed) | Local |
| Integration Smoke | `uv run pytest tests/integration/` | All pass against running gateway, exit code 0 | Local |
| Full Pre-Cutover | `bun run typecheck && bun test && uv run pytest tests/integration/` | Output appended to `tests/test_results.md` with timestamp | Local |
| UAT Smoke Gate | `uv run pytest tests/integration/ --env=uat` | All pass against live UAT URL from `.env.uat` (not localhost) | **UAT** |
| Gateway Daemons | Foreground: `bun run src/index.ts` | Daemon (tmux): `bash scripts/start.sh` | Health: `bun run scripts/doctor.ts` | Local |

### Anti-Simulation Gate (Real Execution Mandate)
- **Zero Simulation**: Never imagine or paraphrase test runs. Every gate artifact must be self-witnessing from actual execution.
- **Verification Sequence**: `echo "Run: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" | tee -a tests/test_results.md && bun test >> tests/test_results.md 2>&1 && tail -30 tests/test_results.md && ls -lh tests/test_results.md` (paste verbatim). Missing disk timestamps fail cutover automatically. [Rationale: Enforce real terminal execution; reject simulated outputs].
- **Anti-Context-Bloat**: Never run blanket `bun test` in chat. Use `bun run test:gateway` or `bun run test:failures` during active edits.

---

## Engineering Discipline

1. **Fail Loudly & Surface Errors**: Never swallow exceptions or mask errors. Code failures are signals. Silent failure requires explicit business comments (`# REQUIREMENT: Fail silently because [...]`).
2. **Deterministic Minimalism (YAGNI)**: Implement strictly what is requested. Zero speculation, no unrequested configurability or premature abstractions.
3. **Surgical Isolation**: Atomic edits only on relevant AST nodes. No drive-by refactoring or style imposition. Clean up your own dead code/imports.
4. **Verification-Led Proof (TDD)**: Map requests to verifiable tests/logs. Never loop on retries without updating root-cause analysis.
5. **Runtime Protocols**: **Bun-First**: Gateway runtime, benchmarks, typecheck, and unit tests MUST use `bun`. **Python/UV**: Pytest smoke tests, linters, and hygiene scripts MUST use `uv run python` / `uv sync`. Never use naked `python` or `pip`.
6. **Decisive Multi-Tool Dispatch**: Dispatch independent tool calls in parallel. Delegate large file reading to `explore` subagents to avoid context bloat.

---

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:custom-dense -->
## Beads Issue Tracking & Mandatory Auto-Push

Use `bd` for ALL task tracking. Markdown TODOs and external trackers are forbidden.

### Core CLI Workflow
```bash
bd ready --json                                               # Find unblocked work
bd create "Title" -t task -p 2 -d "..." --acceptance="..."    # Create task (--acceptance mandatory)
bd update <id> --claim --json                                 # Claim task atomically
bd close <id> --reason "Completed" --json                     # Complete task
bd dolt push                                                  # Push Dolt database state to remote
```

### Quality & Validation Enforcement
- Strict creation enforcement active (`validation.on-create: error`). Required sections: `task`/`feature`: `--acceptance="..."`; `bug`: steps to reproduce in `-d` and `--acceptance`; `chore`: zero extra fields.
- Emergency bailout if trapped in retry loop: `bd config set validation.on-create warn` (reset with `error`).

### Session Completion (Mandatory Auto-Push Protocol)
Work is **NOT complete** until `git push` succeeds. Never stop before pushing.
1. **File remaining work**: Create beads for follow-up work with `--acceptance="..."`.
2. **Run quality gates**: `bun run typecheck && bun test:gateway && uv run pytest tests/integration/`.
3. **Close finished issues**: `bd close <id> --reason "Completed"`.
4. **PUSH TO REMOTE (MANDATORY)**:
   ```bash
   git pull --rebase && bd dolt push && git push
   ```
5. **Handoff**: Report changed files, validation evidence, issue status, and confirm successful push.
<!-- END BEADS INTEGRATION -->
