# AGENTS.md

Mandatory operational guidance for AI agents working in this repository.

## ⛔ ABSOLUTE MANDATE: NEVER TOUCH API KEYS OR `.env.local`
- **NEVER** edit, sanitize, replace, or overwrite API keys or `.env.local` / `.env` files. Automated sanitization against `.env*` is forbidden.
- **NEVER** hardcode keys into code, tests, docs, or commits. Use `/tmp` or gitignored `scratch/` for ad-hoc scripts.
- Replacing keys with `<REDACTED>` destroys gateway boot (`staticValidateKeys` drops all keys).
- `.env.local` is write-protected via `protect.sh` (owned by root, `644`). Do not bypass.
- **Safe Testing Recipe**: (1) Unit tests: use mock stubs (`sk-test-stub-...`, `nvapi-key1`). (2) Integration: call local proxy at `http://literouter.lan:7766/v1/chat/completions` with client auth (`Bearer sk-lr-your-auth-key`). (3) Diagnostic scripts: dynamically read `Bun.env.NVIDIA_API_KEYS` / `os.environ.get("NVIDIA_API_KEYS")`.

---

## Technical Knowledge Base & Fixed Core Paths
- **MANDATORY REPO INSPECTION (WSL & VPS)**: When asked any question about LiteRouter behavior, routes, errors, providers, or config—especially when running on the VPS (`vps466a`)—you **MUST** read the repository source files on disk before answering or diagnosing. Never guess from memory or stale docs.
- **Repository Roots**:
  - **WSL2 (Dev / Golden Truth)**: `/home/yapilwsl/arthityap/literouter`
  - **VPS (`vps466a` Production)**: `/home/vps466a/services/literouter`
- **LiteRouter Skill**: `.opencode/skills/literouter/SKILL.md` (WSL: `/home/yapilwsl/arthityap/literouter/.opencode/skills/literouter/SKILL.md` | VPS: `/home/vps466a/services/literouter/.opencode/skills/literouter/SKILL.md`)
- **Model Eval Skill**: `.opencode/skills/literouter-eval/SKILL.md` (WSL: `/home/yapilwsl/arthityap/literouter/.opencode/skills/literouter-eval/SKILL.md` | VPS: `/home/vps466a/services/literouter/.opencode/skills/literouter-eval/SKILL.md`)
- **Key Docs**: `CHANGELOG.md`, `docs/architecture.md`, `docs/streaming-fix.md` (streaming spec), `docs/longrunning-mode.md`
- **Active Engine (`v4.1` default, `src/config/env.ts`) & Main Handlers**: `src/index.ts` (`dispatchRoute` -> `dispatchV4`), `src/handlers/v4/router.ts`, `src/engine/dispatch.ts`, `src/handlers/google_interactions.ts`, `src/network/fetcher.ts`, `src/network/pacer.ts` (legacy compat handlers in `src/handlers/openai_compat.ts` and `src/handlers/anthropic_compat.ts` are inactive unless `LITEROUTER_ENGINE=legacy`)
- **Lazy-Load Guides**: Antigravity IDE: `.opencode/skills/literouter/agy-ide-setup.md` | TUI Math: `.opencode/skills/literouter/tui-latex-math-rendering.md` | Test Hygiene: `.opencode/skills/literouter/test-hygiene-playbook.md`
- **Rate Limiting (Zdist Retired)**: Client-side sliding-window tracking is retired (see `docs/GRAVEYARD/ZDIST.md`). Active stack: deterministic **RequestPacer** (`src/network/pacer.ts`) + reactive **CooldownManager** (`src/network/cooldown.ts` 429 quarantine with `Retry-After`).
- **OpenCode Config Format**: v1 (`.opencode/opencode.json`, key: `"plugin"` [strings]) vs v2 (`.opencode/opencode.json`, key: `"plugins"` [strings or `{ package, options }`]).

---

## Session Start & Skill Protocol
1. **Read the Repo First**: On both WSL (`/home/yapilwsl/arthityap/literouter`) and VPS (`/home/vps466a/services/literouter`), always inspect the live repo files (`src/`, `config/`, `fusion.json`, `.opencode/skills/literouter/`) before answering questions or diagnosing issues.
2. **Initialize Beads**: Run `bd prime` (or `bd ready`) immediately on session start.
3. **Load Skill (MANDATORY)**: Run `skill load "literouter"` (or read `.opencode/skills/literouter/SKILL.md` directly) at conversation start. Fallback: load immediately if touching gateway routing, keys, streaming, models, or errors.
4. **Ticket (Definition of Done)**: Create issue if not already tracked: `bd create "..." -t task -p 2 -d "..." --acceptance="1. Deterministic verification passes\n2. Output artifact exists"` (`validation.on-create: error` is enforced; omitting `--acceptance` fails).
5. **Claim**: Run `bd update <id> --claim`.
6. **Resume Protocol**: If context is lost or session restarts, run `bd list --status in_progress --json` to find your claimed task and continue. Never ask the user "what should I work on?" if tasks are in progress. [Rationale: Persistent brain in beads].

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
- **Provider/Model Changes Sequence**: (1) Checkpoint: `uv run python admin/code_hygiene/agent_guardrail.py checkpoint <path>`, (2) Skill: `skill load "literouter"`, (3) Doctor: `bun run scripts/diagnose/doctor.ts`, (4) Suite: `bun run test && uv run pytest tests/integration/`, (5) Validate: `uv run python admin/code_hygiene/agent_guardrail.py validate <path>`. Categories: Provider Add/Remove (`src/index.ts`), Model Add/Remove (`fusion.json`).
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
| Unit Test Suite | `bun run test` (or `bun test:lr`) | Accelerated domain-partitioned runner (runs 7 domains in parallel subprocesses, silent on success, outputs only isolated failures), exit code 0 | Local |
| Targeted Domain Test | `bun run test <domain>` (or `bun test:lr <domain>`) | Rapid iteration on slice (e.g. `bun run test handlers`, `bun run test network`, `bun run test stream`, `bun run test engine`, `bun run test telemetry`, `bun run test core`, `bun run test eval`) | Local |
| Sync OpenCode Nodes | `uv run python scripts/sync/sync_opencode_nodes.py` | Syncs OpenCode 2 settings from WSL2 (source of truth) to Mac Mini & VPS | Cluster |
| Sync LiteRouter to VPS | `bash scripts/sync/sync_literouter_to_vps.sh` | One-way sync of LiteRouter code, .env, and .env.local from WSL (golden truth) to VPS | Cluster |
| Failure-Only Test | `bun run test:failures` | `bun test --only-failures` (outputs only failing tests) | Local |
| Eval Grader Tests | `bun run test:eval` | All pass (182 benchmark eval grader tests in `tests/eval`) | Local |
| Raw Unbuffered Tests | `bun run test:raw` | Verbose fallback for debugging | Local |
| OpenCode2 Test Tool | `test_literouter` native tool | Zero-bloat programmatic test invocation | Local |
| Integration Smoke | `uv run pytest tests/integration/` | All pass against running gateway, exit code 0 | Local |
| Full Pre-Cutover | `bun run typecheck && bun run test && uv run pytest tests/integration/` | Output appended to `tests/test_results.md` with timestamp | Local |
| UAT Smoke Gate | `uv run pytest tests/integration/ --env=uat` | All pass against live UAT URL from `.env.uat` (not localhost) | **UAT** |
| Gateway Daemons | Foreground: `bun run src/index.ts` | Daemon (tmux): `bash scripts/gateway/start.sh` | Health: `bun run scripts/diagnose/doctor.ts` | Local |

### Anti-Simulation Gate (Real Execution Mandate)
- **Zero Simulation**: Never imagine or paraphrase test runs. Every gate artifact must be self-witnessing from actual execution.
- **Verification Sequence**: `echo "Run: $(date -u +"%Y-%m-%dT%H:%M:%SZ")" | tee -a tests/test_results.md && bun run test >> tests/test_results.md 2>&1 && tail -30 tests/test_results.md && ls -lh tests/test_results.md` (paste verbatim). Missing disk timestamps fail cutover automatically. [Rationale: Enforce real terminal execution; reject simulated outputs].
- **Anti-Context-Bloat**: Use `bun run test` (or `bun test:lr`). NEVER run naked `bun test` as Bun treats `test` as a built-in keyword that bypasses scripts/test/test_runner.ts and dumps unbuffered output. For even faster targeted iteration during active edits, use `bun run test <domain>` (e.g. `bun run test handlers` or `bun test:lr handlers`), `bun run test:failures`, or the `test_literouter` native tool.

---

## 🛡️ LiteRouter Model Evaluation Gauntlet

> *"All models are wrong, but some are useful."* — **George E. P. Box**  
> *"So use our eval, we will tell you what is wrong."* — **Francis Yap**

> **Pragmatic, Zero-Overhead Evaluation Harness for Real-World AI Agents & Web Generation**

LiteRouter's evaluation suite provides empirical, fail-fast verification of LLM capabilities across agentic coding, protocol resilience, streaming speed, and frontend website generation.

> ℹ️ **Scope & The "Lite" Irony:**  
> This evaluation gauntlet is merely a targeted subset of LiteRouter's broader mission. LiteRouter operates as an industrial-grade multi-provider gateway, intelligent pacer, protocol scrubber, key rotator, circuit breaker, and sticky fallback orchestrator. Given the depth of its proxy architecture and autonomous agent routing, the name **"Lite"Router** is becoming delightfully ironic.

Unlike synthetic or heavyweight benchmarks (e.g. SWE-bench, HumanEval) that require multi-gigabyte Docker sandboxes, headless Chromium browsers, or hours of runtime, LiteRouter's gauntlet runs **100% natively in Bun in <60 seconds**.

### Architecture & The Three Pillars

```
eval/
├── eval.ts              # 🎯 Master Orchestrator (coordinates suites, outputs reports)
├── speed.ts             # ⚡ Speed & Latency Benchmark (TTFT, throughput, slot headroom)
├── code.ts              # 💻 5-Stage Agentic & Coding Harness (Chat + Responses API)
├── web.ts               # 🌐 5-Stage Web Vision-Language Harness (AST & DOM audit)
├── stages/              # Coding stages (Wire, Pydantic, Loop, str_replace, Security)
├── stages_rs/           # OpenAI Responses API (/v1/responses) stage variants
├── stages_web/          # Web generation stages (Structure, Responsive, State, Hygiene, A11y)
└── reports/             # Generated Markdown model report cards
```

#### The Three Pillars

| Suite | Entry Point | Target Capabilities | Runtime |
|---|---|---|:---:|
| **⚡ Speed** | `eval/speed.ts` | Time to First Token (TTFT), tokens/sec throughput, concurrency slots | ~10–20s |
| **💻 Code & Agentic** | `eval/code.ts` | 12k context hydration, Pydantic schemas, 3-turn state loop, surgical `str_replace`, prompt injection | ~40–90s |
| **🌐 Web Frontend** | `eval/web.ts` | Semantic landmarks, responsive Tailwind grid collapse, React state hooks, code hygiene, WCAG a11y | ~60–120s |

### Quickstart for Developers & Agents

#### 1. Run the Full Gauntlet (Master Runner)
Run all 3 suites and generate an executive Markdown report card in `eval/reports/`:
```bash
bun run eval/eval.ts <model_name>
```

**Examples:**
```bash
# Evaluate Thinking Machines Inkling on OpenRouter
bun run eval/eval.ts thinkingmachines/inkling:free

# Evaluate Muse Spark on Zen Responses API
bun run eval/eval.ts muse-spark-1.3-contributor-free --wire rs

# Run with reasoning disabled for faster throughput
bun run eval/eval.ts thinkingmachines/inkling:free --reasoning none
```

#### 2. Targeted Suite Runs
```bash
# Run only speed and web benchmarks
bun run eval/eval.ts <model_name> --suites speed,web

# Run isolated speed benchmark
bun run eval/speed.ts <model_name>

# Run isolated coding stage 4 (surgical patching)
bun run eval/code.ts <model_name> --stage 4

# Run isolated web stage 2 (mobile responsiveness)
bun run eval/web.ts <model_name> --stage 2
```

### Architectural Role Classification

Based on empirical test scores, `eval/eval.ts` automatically classifies models into specific agent roles:

| Role | Required Qualifications | Typical Use Case |
|---|---|---|
| 🧠 **Orchestrator** | High Pydantic schema score, durable multi-turn state loop, precise surgical patch fidelity (`str_replace`) | Task decomposition, ticket generation, PR review, architecture design |
| 💻 **General Coder** | High surgical patch fidelity, zero package hallucinations, clean AST syntax | Implementing code changes, fixing bugs, refactoring modules |
| ⚡ **Explorer** | Fast TTFT (<2s), high streaming throughput (>100 tok/s), large context window | Codebase navigation, symbol search, log ingestion, read-only research |

### Adding a New Stage
Each stage implements a standardized interface (`StageResult`):
1. **Agentic / Coding Stage**: Add `eval/stages/stage6_<name>.ts` exporting `runStage6(ctx: StageContext): Promise<StageResult>`.
2. **Web Generation Stage**: Add `eval/stages_web/stage6_<name>.ts` exporting `runStage6(ctx: StageContext): Promise<StageResult>`.
3. Register the new stage in `eval/code.ts` or `eval/web.ts`.
4. Run `bun test && bun run typecheck` to verify.

---

## Engineering Discipline

1. **Fail Loudly & Surface Errors**: Never swallow exceptions or mask errors. Code failures are signals. Silent failure requires explicit business comments (`# REQUIREMENT: Fail silently because [...]`).
2. **Deterministic Minimalism (YAGNI)**: Implement strictly what is requested. Zero speculation, no unrequested configurability or premature abstractions.
3. **Surgical Isolation**: Atomic edits only on relevant AST nodes. No drive-by refactoring or style imposition. Clean up your own dead code/imports.
4. **Verification-Led Proof (TDD)**: Map requests to verifiable tests/logs. Never loop on retries without updating root-cause analysis.
5. **Runtime Protocols**: **Bun-First**: Gateway runtime, benchmarks, typecheck, and unit tests MUST use `bun`. **Python/UV**: Pytest smoke tests, linters, and hygiene scripts MUST use `uv run python` / `uv sync`. Never use naked `python` or `pip`.
6. **Decisive Multi-Tool Dispatch**: Dispatch independent tool calls in parallel. Delegate large file reading to `explore` subagents to avoid context bloat.

---

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:46cd31e7 -->
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

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.

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
   bd dolt push
   git push
   git status
   ```
5. **Hand off** - Summarize changes, validation, issue status, and any blocked sync/commit/push step

**Critical rules:**
- Explicit user or orchestrator instructions override this Beads block.
- Do not commit or push without clear authority from the active profile or the current user request.
- If a required sync or push is blocked, stop and report the exact command and error.
<!-- END BEADS INTEGRATION -->

<!-- BEGIN BEADS CODEX SETUP: generated by bd setup codex -->
## Beads Issue Tracker

Use Beads (`bd`) for durable task tracking in repositories that include it. Use the `beads` skill at `.agents/skills/beads/SKILL.md` (project install) or `~/.agents/skills/beads/SKILL.md` (global install) for Beads workflow guidance, then use the `bd` CLI for issue operations.

### Quick Reference

```bash
bd ready                # Find available work
bd show <id>            # View issue details
bd update <id> --claim  # Claim work
bd close <id>           # Complete work
bd prime                # Refresh Beads context
```

### Rules

- Use `bd` for all task tracking; do not create markdown TODO lists.
- Run `bd prime` when Beads context is missing or stale. Codex 0.129.0+ can load Beads context automatically through native hooks; use `/hooks` to inspect or toggle them.
- Keep persistent project memory in Beads via `bd remember`; do not create ad hoc memory files.

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See https://github.com/gastownhall/beads/blob/main/docs/core-concepts/sync-concepts.md for details and anti-patterns.
<!-- END BEADS CODEX SETUP -->
