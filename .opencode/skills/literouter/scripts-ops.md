# LiteRouter Scripts & Ops: Lifecycle, Health, Reset, Diagnostics

> **Canonical Location:** `.opencode/skills/literouter/scripts-ops.md`
> **Reference Sources:** `scripts/gateway/start.sh`, `scripts/gateway/status.sh`, `scripts/gateway/stop.sh`,
> `scripts/gateway/restart.sh`, `scripts/hooks/opencode_autopatch.sh`, `scripts/diagnose/doctor.ts`,
> `scripts/diagnose/doctor_zn.ts`, `src/index.ts` (`handleHealthCheck`, `handleHardReset`,
> `handleAdminPoolReset`, `SYSTEM_MAP`), `src/handlers/openai_compat.ts`
> (`resetProvidersRegistryCache`), `src/config/providers.ts` (`resolveUpstreamEndpoint`).
> Companion doc: `.opencode/skills/literouter/doctor.md` (deep dive on probes).

Every command below is copy-paste runnable against the host in
`config/location.json` (currently `10.32.34.172:7766`, `tls_enabled: false` → plain
`http://`). `-k` is included on the `https://localhost:7766` examples because the
gateway may serve a local mkcert self-signed cert; drop `-k` and use `http://`
when `tls_enabled` is `false`.

---

## 1. Gateway Lifecycle Scripts (`scripts/gateway/`)

> ✅ **Symlink Resolution (Fixed)**: All gateway scripts (`start.sh`, `stop.sh`, `restart.sh`,
> `status.sh`, `setup_certs.sh`) now use a canonical POSIX symlink resolution loop that traverses
> `BASH_SOURCE[0]` to the real script file before computing `SCRIPT_DIR` and `DEFAULT_ROOT`.
> Both direct calls (`scripts/gateway/start.sh`) and symlink calls (`scripts/start.sh`, `scripts/restart.sh`,
> `scripts/stop.sh`, `scripts/status.sh`, or `./start.sh` from `scripts/`) resolve the repo root
> cleanly and reliably without jumping to parent directories.

All lifecycle scripts `cd` to the repo root, source `.env` then `.env.local`
(if present), and resolve the bind target **exclusively** from
`config/location.json` (`scripts/gateway/start.sh:8-30`):

- `HOST=$(jq -r '.host' config/location.json)`, `PORT=$(jq -r '.port' config/location.json)`
- `TLS_ENABLED=$(jq -r '.tls_enabled' config/location.json)`; `PROTOCOL="http"`, upgraded to
  `"https"` only when `tls_enabled` is `true`. There is no `certs/localhost.pem` probe here.
- A missing or malformed `config/location.json` is **fatal** (exit 1).
- Tmux session name is always `literouter`; PID file is always `.literouter.pid`.

### 1.1 `scripts/gateway/start.sh` — start (idempotent)

```bash
bash scripts/gateway/start.sh
```

> 📖 Pane-rubbish guide: [`tmux-hygiene.md`](tmux-hygiene.md) — clear `getcwd`/echo noise, quiet-boot design.

What it does, in order (verified against source):

1. If `tmux has-session -t literouter` succeeds, prints "already running" and
   exits `0` (does **not** start a second instance).
2. `mkdir -p logs`; prunes `logs/gateway.log` via `scripts/gateway/prune-logs.sh`.
3. Quiet launch (no `send-keys`, no typed-command echo): `tmux new-session -d -s literouter -c "$ROOT_DIR"` with a single initial command running `bash --noprofile --norc -c 'cd / && cd "$ROOT_DIR" && printf "\033[2J\033[H" && ... exec bun run src/index.ts 2>&1 | tee -a logs/gateway.log'`. Bind authority stays `config/location.json`.
4. Polls `GET ${PROTOCOL}://${HOST}:${PORT}/health` up to 15 times at 0.5 s
   intervals, succeeding when the body contains `"status":"healthy"`.
5. On success runs `tmux clear-history -t literouter` to wipe any early `shell-init/getcwd` lines from scrollback, records `pgrep -f "bun run src/index.ts"` output into `.literouter.pid`.
6. On success prints the endpoint banner; on timeout dumps the last 20 tmux
   pane lines, runs `scripts/gateway/stop.sh`, and exits `1`.

```bash
tmux attach -t literouter   # tail live gateway logs
```

### 1.2 `scripts/gateway/status.sh` — status (exit-coded)

```bash
bash scripts/gateway/status.sh
echo $?   # 0 = RUNNING, 1 = NOT running
```

What it does (verified against source):

1. Reads PID from `.literouter.pid`; checks `tmux has-session -t literouter`.
2. Probes `curl -sk -m 2 ${PROTOCOL}://localhost:${PORT}/health`.
3. Prints `🟢 LiteRouter is RUNNING` when the tmux session exists **or** the
   recorded PID is alive (`kill -0`); otherwise prints `🔴 NOT running`,
   deletes a stale `.literouter.pid`, and exits `1`.
4. Health line reads `OK (<body>)` when the body contains
   `"status":"healthy"`, else `⚠️ Unresponsive or Non-200`.

### 1.3 `scripts/gateway/stop.sh` — stop (SIGINT → SIGTERM → SIGKILL)

```bash
bash scripts/gateway/stop.sh
```

What it does, in order (verified against source):

1. `tmux send-keys -t literouter C-c`, wait 1 s, then `tmux kill-session`
   if still present.
2. `kill <PID from .literouter.pid>`, wait 1 s, then `kill -9 <PID>` if
   still alive; removes `.literouter.pid`.
3. Best-effort `lsof -ti ":${PORT}" | xargs -r kill -9` to release orphans.

### 1.4 `scripts/gateway/restart.sh` — restart (stop → start)

```bash
bash scripts/gateway/restart.sh

Source is exactly `stop → sleep 1 → start`. Required when `.env` /
`.env.local` port/host values change — `POST /reset` cannot rebind the
listener (see §3.3).

### 1.5 `scripts/hooks/opencode_autopatch.sh` — OpenCode2 CLI self-heal (idempotent)

```bash
bash scripts/hooks/opencode_autopatch.sh
bash scripts/hooks/opencode_autopatch.sh --verbose   # or -v
```

What it does (verified against source):

1. Resolves `@opencode-ai/cli` via `$OPENCODE_CLI_DIR`, then the active
   `node` prefix (`<prefix>/lib/node_modules/@opencode-ai/cli`), then NVM
   (`${NVM_DIR:-$HOME/.nvm}/versions/node/v*/lib/node_modules/@opencode-ai/cli`).
   Exits `0` silently when no installation is found (skip, not failure).
2. Dummy-binary detection: missing file, `postinstall script was not run`
   marker, or size `< 1024` bytes. Recovers from `bin/opencode.exe` or the
   platform package (`node_modules/@opencode-ai/cli-*/bin/opencode`).
3. Fast path (`< 5 ms`): exits `0` when `.autopatch_verified` stamp is newer
   than both the binary and this script.
4. One-time `.bak` backup of `bin/opencode` before any mutation.
5. Three marker-file patch routines (re-run safe):
   - `tool message formatting` (`.patch_tool_format_applied` marker),
   - `network-error anti-silent-completion` (`.patch_network_error_applied`),
   - `collapse-reasoning` scrubber plugin: syncs
     `.opencode/plugins/collapse-reasoning.ts` (or generates a fallback) to
     `~/.config/opencode/plugins/` and registers
     `./plugins/collapse-reasoning.ts` in `~/.config/opencode/config.json`.
6. `chmod +x` on binaries and itself; `touch .autopatch_verified`.

---

## 2. `GET /health` — Liveness Probe (No Auth, Any Method)

`SYSTEM_MAP` routes `/health`, `/api/hello`, and `/hello` to
`handleHealthCheck()` with **no auth check and no method check** — any HTTP
method works, but use `GET`.

```bash
curl -sk https://localhost:7766/health | python3 -m json.tool
curl -sk https://localhost:7766/api/hello | python3 -m json.tool
```

Exact success contract (`src/index.ts:176-194`):

- HTTP `200` with JSON body containing `"status": "healthy"`.
- Full shape:
  `{"status":"healthy","uptime":<seconds>,"timestamp":<ISO-8601>,`
  `"h2_outbound":<pool session stats>,"circuit_breakers":<per-provider stats>}`.
- `scripts/gateway/start.sh` and `scripts/gateway/status.sh` both grep for `"status":"healthy"`.

Troubleshooting matrix:

| Symptom | Meaning | Action |
|---|---|---|
| Connection refused | Gateway not running | `bash scripts/gateway/start.sh` |
| Body lacks `"status":"healthy"` | Process up but unhealthy path | `tmux attach -t literouter`, inspect `logs/gateway.log` |
| `status.sh` says RUNNING but health `⚠️` | Port bound, handler stalled | `bash scripts/gateway/restart.sh` |

`scripts/diagnose/doctor.ts:pingLocalServer` (`:133-169`) reads host/port from
`config/location.json`, tries the protocol implied by `tls_enabled` first, with a
1500 ms timeout, and records only a `WARN` ("Gateway is not currently running
(FYI only)") when the gateway is down — it never fails the run on this check.

---

## 3. `POST /reset` — Hard Reset (Auth-Gated) & Hot-Reload Scope

### 3.1 Exact semantics (`src/index.ts:81-129`; dispatch at `:442-444`)

`/reset` is routed directly to `handleHardReset()` (`src/index.ts:442-444`) with **strict authentication gating**. Callers must provide either `Authorization: Bearer <LITEROUTER_AUTH_KEY>` or a valid `lr-` directive token in the `Authorization` header. Requests lacking valid credentials are rejected immediately with HTTP `401 Unauthorized`:

```bash
curl -s -X POST http://10.32.34.172:7766/reset \
  -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>" | python3 -m json.tool
```

What a reset clears, in source order:

1. `initProviderRegistry()` + `initStrategyRegistry()` + `traceWriter.init()` — registry reload.
2. `globalCooldownManager.clearAll()` — all key cooldowns.
3. `globalKeyPool.reset()` (all providers) + `initializeKeyPools()` —
   re-reads key pools from the environment (picks up `.env.local` edits).
4. `clearCircuitBreakerRegistry()` + `resetCircuitBreakers()` — per-provider breakers.
5. `clearPacerRegistry()` + `traceBuffer.clear()` — pacing queues/timers and trace buffer.
6. `resetHttp2Pool()` — outbound H2 sessions (subsequent requests re-ALPN).
7. `resetProvidersRegistryCache()` — nulls the `config/providers.json` cache
   so the next request re-reads the file from disk (§3.2).
8. `loadAndCacheNativeChains()` + `resetNativeFlashTierIndex()` — native
   chain config and flash-tier rotation cursor.
9. `Bun.gc(true)` — synchronous heap and JIT code compaction (Bun v1.4.2+).

On any thrown registry error the previous config is kept and HTTP `500`
`{"status":"error","message":...}` is returned (`src/index.ts:119-128`).

Exact success contract: HTTP `200`
`{"status":"ok","message":"Hard reset successful. Cooldowns, circuit breakers,`
`pacers, and H2 pools reloaded.","timestamp":<ISO-8601>}`.

### 3.2 Hot-reload scope — `config/providers.json` headers included

`initProviderRegistry()` caches the parsed `config/providers.json` in memory;
`resetProvidersRegistryCache()` (`src/handlers/openai_compat.ts:77-79`) calls
`initProviderRegistry()` to re-read the file. Therefore **editing
`config/providers.json` on disk followed by authenticated `POST /reset`
hot-reloads without a restart**, including:

- `base_url`, per-completion `endpoints` paths (`{model}` templated via `resolveUpstreamEndpoint`, `src/config/providers.ts:126-156`),
- `auth_header` (`"Bearer"` vs `"x-api-key"`),
- per-provider `headers` (e.g. OpenRouter `HTTP-Referer`, `X-Title`,
  `User-Agent` fan-out verified live in `config/providers.json`).

There is no `getProvidersRegistry()` export in this codebase; the registry entry
point is `getProviderConfig()` in `src/config/providers.ts`.

Operator recipe:

```bash
# 1. Edit config/providers.json (headers, base_url, endpoints ...)
# 2. Validate JSON parses before resetting:
python3 -c "import json; json.load(open('config/providers.json')); print('providers.json OK')"
# 3. Hot-reload without restart (authenticated):
curl -s -X POST http://10.32.34.172:7766/reset \
  -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"
# 4. Confirm healthy:
curl -s http://10.32.34.172:7766/health | python3 -m json.tool
```

Same rule for key rotation: edit `.env.local` first, then authenticated `POST /reset`
(step 2 above re-runs `initializeKeyPools()`). What `POST /reset` can **not**
do: rebind port/host or reload TLS certs — those are governed by `config/location.json`
and require `bash scripts/gateway/restart.sh` (§1.4).

### 3.3 Auth-gated variant — `POST /admin/pool/reset`

`/admin/pool/reset` is dispatched to `handleAdminPoolReset()` (`src/index.ts:131-174`,
routed at `:438-440`), which applies the same credential check as `handleHardReset()`
(either `Authorization: Bearer <LITEROUTER_AUTH_KEY>` or any valid `lr-` directive
token). Invalid credentials return HTTP `401`
`{"error":{"message":"Unauthorized admin access","type":"authentication_error"}}`.

```bash
# Full hard reset (identical to POST /reset):
curl -s -X POST http://10.32.34.172:7766/admin/pool/reset \
  -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"

# Single-provider pool reset via query param (cooldowns + timers for one pool):
curl -s -X POST "http://10.32.34.172:7766/admin/pool/reset?provider=nv" \
  -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"

# Single-provider pool reset via JSON body (POST or PUT only):
curl -sk -X POST https://localhost:7766/admin/pool/reset \
  -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"provider":"or"}'
```

Provider codes: `gg` Google, `nv` NVIDIA, `or` OpenRouter, `zn` Zen,
`gc` GCP. Success shape for a scoped reset:
`{"status":"ok","message":"Reset pool for provider '<code>'. Cooldowns and`
`timers cleared.","provider":"<code>","timestamp":...}`. Omitting `provider`
falls through to the full `handleHardReset()`.

---

## 4. Diagnostics — `scripts/diagnose/doctor.ts` & `scripts/diagnose/doctor_zn.ts`

`doctor.ts` is **strictly informational**: it never gates gateway boot and
never mutates state. Full probe mechanics live in
`.opencode/skills/literouter/doctor.md`; this section is the ops quick
reference with exact-as-source targets.

```bash
bun run scripts/diagnose/doctor.ts            # full run: files + ping + all pools
bun run scripts/diagnose/doctor.ts zn         # targeted probes (also: gg nv or gc)
bun run scripts/diagnose/doctor.ts zen        # long-form aliases: google gemini nvidia nim openrouter gcp gemma
bun run scripts/diagnose/doctor.ts provider=nv
```

Run structure (`scripts/diagnose/doctor.ts:runDoctor`, `:391-548`):

1. **Files (1/2):** `.env`, `.env.local` optional; `config/providers.json`,
   `config/fusion.json`, and `config/models.json` all marked `required` by the doctor and
   JSON-parse checked (`scripts/diagnose/doctor.ts:423-431`). `config/models.json` is legacy advertisement-only for `/v1/models` (re-read per discovery request); it never gates serving — doctor output is advisory-only and never blocks boot.
2. **Key pools:** `loadKeyPools()` over merged `.env` + `.env.local` +
   `process.env`; flags `changeme`/`todo`/short placeholder keys as `WARN`.
3. **Ping:** `GET /health` on the protocol implied by `config/location.json`'s `tls_enabled`, then the other; 1500 ms timeout, WARN-only when down.
4. **Probes (2/2):** sequential per pool, **1000 ms delay between keys**
   (`probePoolSequential`, `:362-382`; per-key timeouts 10 s Google/OpenRouter/NVIDIA/GCP, 20 s Zen).

Exact probe targets (verified against `scripts/diagnose/doctor.ts:171-360`):

| Pool | URL | Model / payload |
|---|---|---|
| `gg` Google | `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=<key>` (key in query, no auth header) | `{contents:[{parts:[{text:"ping"}]}], generationConfig:{maxOutputTokens:10}}` |
| `nv` NVIDIA | `POST https://integrate.api.nvidia.com/v1/chat/completions`, `Authorization: Bearer <key>` | `nvidia/nemotron-3-super-120b-a12b`, `ping`, `max_tokens: 10` |
| `or` OpenRouter | `POST https://openrouter.ai/api/v1/chat/completions`, Bearer + `HTTP-Referer`/`X-Title`/`User-Agent` (env-overridable, defaults `https://opencode.ai` / `OpenCode` / `OpenCode/1.0.0`) | `openrouter/free:nitro`, `ping`, `max_tokens: 10` |
| `zn` Zen | `POST https://opencode.ai/zen/v1/chat/completions` via `probeZenKeyWithFreshSession` (§5) | `big-pickle`, `ping`, Zen core probe `tools`, `tool_choice: auto`, `stream: true` |
| `gc` GCP | `POST https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, `Authorization: Bearer` + `x-goog-api-key: <key>` | `gemma-4-31b-it`, `ping`, `max_tokens: 10` |

Status mapping (all probes): `200` → `PASS`; `401`/`403` → `FAIL` (replace
key); `429`, other 4xx/5xx, timeouts, connection errors → `WARN` (key stays
in pool). Zero keys in a pool → `⏭️ Skipped`, never a failure.

### 4.2 Unified 5-Stage Model Certification Harness — `eval/code.ts`

The dedicated evaluation harness in `eval/` certifies models end-to-end across an industrial 5-stage pipeline, supporting both Chat Completions (`POST /v1/chat/completions`) and OpenAI Responses API (`POST /v1/responses`):

```bash
bun run eval/code.ts <model> <provider> <directive_key> [options]
# Positional order is enforced by validateStrictEvalArgs (eval/validate_cli.ts:404-604);
# omitting <provider> + <directive_key> throws "Missing required argument #2: <provider>".
# The streamlined 2-positional form bun run eval/code.ts <model> lr-or-oo-rs-no is also accepted
# (provider is inferred from the lr-<prov>-… key).
#
# Options (eval/code.ts:51-68 --help):
#   --wire <chat|rs>            (auto-detected when omitted)
#   --directive <key>           default lr-or-oa-ch-no (chat) / lr-zn-oo-rs-no (responses)
#   --url <url>, --stage <1-5>, --continue, --runs <n> (default 2),
#   --cooldown <ms> (2000), --timeout <ms> (120000),
#   --reasoning-transcript / --no-reasoning-transcript
```

**Modular Stage Architecture (`eval/stages/` & `eval/stages_rs/`):**
1. **Stage 1: Wire Protocol & Context Hydration** (`stage1_wire.ts`)
   - 1.1 OpenAI tool calling primitives without XML leaks (`<tool_call>`, `<invoke>`).
   - 1.2 Claude Code 12k+ token context hydration test on `/v1/messages`.
   - 1.3 **Parallel Tool Calling**: Multi-file reads (`a.ts`, `b.ts`, `c.ts`) emitted simultaneously in 1 turn.
2. **Stage 2: Pydantic AI 2.0 Strict Types & Noise Resilience** (`stage2_pydantic.ts`)
   - 2.1 Complex nested schemas (enums, typed integer lists, boundary constraints).
   - 2.2 Self-correction retry loop (simulating Pydantic `ModelRetry` feedback).
   - 2.3 **Massive Compiler Noise Resilience**: Isolates root cause from 4,000-character test traceback wall.
3. **Stage 3: Dynamic State & Agentic Loop Durability** (`stage3_agentic.ts`)
   - 3.1 Multi-turn tool execution (`read_file` ➔ observation ingestion ➔ error recovery).
   - 3.2 Error injection (`EACCES: permission denied`) with graceful acknowledgment.
   - 3.3 TTFT and streaming latency evaluation.
4. **Stage 4: Surgical Coding & Patch Fidelity** (`stage4_patch.ts`)
   - 4.1 Exact string replacement (`edit_file` / `old_str`) with strict indentation verification (6 leading spaces).
   - 4.2 **Ambiguous Duplicate String Disambiguation**: Includes unique surrounding scope context to prevent duplicate-match crashes.
5. **Stage 5: Security & Indirect Prompt Injection** (`stage5_security.ts`)
   - 5.1 Ingests untrusted file content containing malicious shell commands (`rm -rf` / exfiltration).
   - Asserts zero unauthorized shell execution and safe threat neutralization.

**Helpful flags:**
- `--stage <n>`: Run ONLY a specific stage (1, 2, 3, 4, or 5).
- `--continue`: Diagnostic mode (runs all 5 stages without aborting on early failures).
- `--runs <n>`: Number of benchmark runs (default: 2).
- `--directive <key>`: Directive key (default: `lr-or-oa-ch-no` for Chat, `lr-zn-oo-rs-no` for Responses).
- `--reasoning-transcript` / `--no-reasoning-transcript`: Capture per-stage `reasoning_content` transcripts (default-ON, `ts`-nuance key) vs scrub thinking.

### 4.2.1 Web Vision-Language Model Evaluation Harness — `eval/web.ts`

The dedicated evaluation harness in `eval/` specifically tailored for front-end website generation and Vision-Language models (e.g. `inclusionai/ling-3.0-flash-vl:free`, GPT-4o, Sonnet). Like `code.ts`, it calls `validateStrictEvalArgs` (`eval/web.ts:476`), so a bare model name alone throws:

```bash
bun run eval/web.ts <model> <provider> <directive_key> [options]
# Options (eval/web.ts:139-150 --help): --directive <key> (default lr-or-oa-ch-no),
#   --url <url>, --image <uri_or_path>, --stage <1-5>, --continue, --runs <n> (default 2),
#   --cooldown <ms> (2000), --timeout <ms> (180000), --max-tokens <n> (8192),
#   --reasoning <high|medium|none>
# NOTE: eval/web.ts has NO --reasoning-transcript flag (zero occurrences of "transcript");
#       that flag exists only on eval/code.ts and eval/eval.ts.
```

### 4.2.2 Master Evaluation Orchestrator — `eval/eval.ts`

Runs the complete gauntlet (speed, coding/agentic, and web UI) across the
**3-wire matrix** (Chat → Responses → Messages), classifies the model's
architectural role (Orchestrator, General Coder, or Explorer), and writes a
**Consolidated Multi-Wire** Markdown report to `eval/reports/`:

```bash
bun run eval/eval.ts <model> <provider> <directive_key> [options]
# Or the streamlined form (provider inferred from the lr-<prov>-… key):
bun run eval/eval.ts <model> lr-or-oo-rs-no [options]
#
# Options (eval/eval.ts:1761-1775 --help):
#   --all-wires               3-wire matrix (DEFAULT — parseCliArgs sets allWires = true)
#   --wire <chat|rs|ms>       collapses the run to a single wire
#   --suites speed,code,web   (default: speed,code,web)
#   --url <url> (default http://literouter.lan:7766), --stage <1-5>,
#   --reasoning <none|medium|high>, --runs <n> (default 2), --continue,
#   --reasoning-transcript / --no-reasoning-transcript,
#   --image <path_or_url>, --skip-report, -h/--help
```

Report shape: `generateConsolidatedMarkdownReport` (`eval/eval.ts:1350-1354`)
emits `# 🏛️ Consolidated Multi-Wire Evaluation Report: \`<model>\`` with a
per-wire results matrix, **not** a single executive summary. Pass
`--wire <x>` to force a single-wire run, or `--skip-report` to suppress the file.
Passing a `<file.txt>` of `<model>, <key>` lines (or no args at all, which
defaults to `eval/reports/test-models.txt`) runs the same matrix in batch.

> Reasoning-transcript appendix (default-ON): code-suite stages run on the `ts`-nuance key to preserve upstream `reasoning_content`, captured per stage and rendered as an unscored collapsible transcript appendix in the markdown report card.

**5 Specialized Frontend Evaluation Stages (`eval/stages_web/`):**
1. **Stage 1: DOM Structure & Layout Fidelity** (`stage1_structure.ts`):
   - Verifies structural semantic landmarks (`<header>`, `<nav>`, `<main>`, `<aside>`, `<footer>`).
   - Checks modern layout primitives (`grid`, `grid-cols-*`, `flex`, `flex-col`, `items-center`).
   - Asserts proper 3-column dashboard card layouts and penalizes broken `position: absolute` overlap hacks.
2. **Stage 2: Mobile & Desktop Responsiveness** (`stage2_responsive.ts`):
   - Inspects Tailwind responsive breakpoint modifiers (`sm:`, `md:`, `lg:`, `xl:`).
   - Verifies mobile stack degradation (`grid-cols-1 md:grid-cols-3` or `flex-col md:flex-row`).
   - Detects and prevents rigid fixed widths (`w-[1400px]`, `w-[1200px]`), enforcing fluid containers (`w-full`, `max-w-*`).
3. **Stage 3: Interactivity & State Logic** (`stage3_state.ts`):
   - Verifies real React hook state declarations (`useState`, `useReducer`).
   - Audits controlled input bindings (`value` + `onChange`).
   - Enforces real form submit handlers (`e.preventDefault()`), rejecting empty no-ops (`() => {}`).
   - Detects state-driven conditional UI toggles (modals, loading spinners, alerts).
4. **Stage 4: Code Hygiene & Anti-Hallucination** (`stage4_hygiene.ts`):
   - Rejects lazy placeholder anti-patterns (`<!-- insert icon here -->`, `TODO`, `...`, `<div>Chart goes here</div>`).
   - Detects hallucinated third-party package imports outside standard React, Lucide, Heroicons, and Tailwind.
   - Audits dangerous code patterns (unmitigated `dangerouslySetInnerHTML`, script injection).
5. **Stage 5: Semantic HTML & Accessibility (a11y)** (`stage5_a11y.ts`):
   - Flags `<div onClick>` and `<span onClick>` lacking button semantics.
   - Enforces alt tags on `<img>` elements.
   - Checks form inputs for `<label>` or `aria-label`/`aria-labelledby`.
   - Audits modal dialogs for `role="dialog"` and `aria-modal="true"`.

**Helpful flags:**
- `--image <uri_or_path>`: Pass custom mockup image URL or data URI (defaults to internal SaaS Dashboard SVG).
- `--stage <n>`: Run ONLY stage n (1 to 5).
- `--continue`: Diagnostic mode (runs all stages without aborting early).
- `--directive <key>`: Gateway directive key (default: `lr-or-oa-ch-no`).
- `--reasoning <high|medium|none>`: Reasoning effort override. There is no `--reasoning-transcript` on `eval/web.ts`.

### 4.3 Universal Model Capability Probe — `scripts/probe/probe_model.ts`

Validates any new model for **OpenCode 2 streaming tool-calling**, **Claude Code CLI (`/v1/messages`)**, and **Pydantic AI structured outputs** before onboarding.

```bash
bun run scripts/probe/probe_model.ts <model_name> [--directive <directive_key>] [--url <gateway_url>]
```

**Probing Suite:**
1. **OpenCode 2 (Streaming Multi-Turn Tools)**:
   - Evaluates multi-tool discrimination across 4 tools (`read_file`, `write_file`, `execute_command`, `grep_search`).
   - Evaluates streaming SSE chunks for native `delta.tool_calls` vs XML leaks (`<tool_call>`, `<invoke>`).
   - Checks TTFT and total duration (stall / buffer hang detection).
   - Verifies clean `finish_reason: "tool_calls"`.
   - Tests Turn 2 multi-turn tool observation (`role: "tool"`) acceptance and response synthesis.
   - Tests Turn 3 error injection (`EACCES: permission denied`) to verify resilient recovery.
2. **Claude Code CLI & Anthropic Messages (`/v1/messages`)**:
   - Tests `/v1/messages` with Anthropic directive `lr-or-cl-ms-no`.
   - Injects realistic Claude Code XML system prompts (`<context>CLAUDE.md...</context>`).
   - Verifies native Anthropic `tool_use` JSON blocks and tool execution.
3. **Pydantic AI (Structured JSON Readiness)**:
   - Native: Probes `response_format: {"type": "json_object"}` against complex nested schemas with enums and typed integers (HTTP 200 vs 400 rejection).
   - Prompted: Probes markdown fence wrapping and validates downstream extraction (`_strip_json_fences`).

### 4.4 Model Speed & Throughput Benchmark — `eval/speed.ts` (legacy alias: `scripts/probe/bench_speed.ts`)

Measures TTFT (Time To First Token), total duration, token counts, and generation speed (tokens/sec) across models on a standard coding task (LRU cache). Runs are **sequential** (`eval/speed.ts:296-307` — a plain `for` loop over models × runs, no concurrency), so a large model list is slow by design.

```bash
bun run eval/speed.ts [model] [--models "model1,model2"] [--runs 2] [--directive <key>] [--url <url>]
# Or via the backward-compatibility forwarding stub (scripts/probe/bench_speed.ts:15-19):
bun run scripts/probe/bench_speed.ts [model] [--models "model1,model2"] [--runs 2] [--directive <key>]
# Note: unlike code.ts/web.ts/eval.ts, eval/speed.ts does NOT call validateStrictEvalArgs —
# a bare --models list works; --directive defaults to lr-or-oa-ch-no.
```

---

## 5. Zen Probing — `scripts/diagnose/doctor_zn.ts` Session Contract

Zen free-tier (`big-pickle`) rejects requests without identity + session
headers. `doctor.ts:505` delegates all Zen probing to
`probeZenKeyWithFreshSession()`, which calls `buildZenHeaders()` per key and so
mints one crypto-random canonical session ID (`ses_` + 8 hex + `8ffe` + 14
base-62) **per key**, then sends these headers
(`scripts/diagnose/doctor_zn.ts:36-42`, verified against `src/engine/zen.ts:125-135`):

- `Authorization: Bearer <key>`, `Content-Type: application/json`, `Accept: */*`,
- `HTTP-Referer` / `Referer`: `https://opencode.ai`, `X-Title`: `OpenCode`,
  `User-Agent`: the `zen.headers` registry value from `config/providers.json`
  (`opencode/1.18.30 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.2`), with
  `buildZenHeaders()` falling back to that same string when the registry is empty
  (`src/engine/zen.ts:120-123`),
- Session headers (same fresh ID): `session-id`, `x-session-id`, `x-opencode-session`,
  plus `x-opencode-request: msg_<session tail>`.

There is **no** `x-client-version` / `x-client-name` / `opencode-session-id` /
`opencode-session` / `x-opencode-session-id` header on this path.

Minimal runnable equivalent (copy-paste; Zen only — no gateway involved):

```bash
SES="ses_$(head -c 4 /dev/urandom | xxd -p)8ffe$(head -c 12 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 14)"
curl -sk -m 20 -X POST https://opencode.ai/zen/v1/chat/completions \
  -H "Authorization: Bearer <ZEN_KEY>" \
  -H "Content-Type: application/json" -H "Accept: */*" \
  -H "HTTP-Referer: https://opencode.ai" -H "Referer: https://opencode.ai" \
  -H "X-Title: OpenCode" -H "User-Agent: opencode/1.18.30 ai-sdk/provider-utils/4.0.23 runtime/bun/1.4.2" \
  -H "session-id: $SES" -H "x-session-id: $SES" \
  -H "x-opencode-session: $SES" \
  -H "x-opencode-request: msg_${SES#ses_}" \
  -d '{"model":"big-pickle","messages":[{"role":"user","content":"ping"}],"tool_choice":"auto","stream":true,"stream_options":{"include_usage":true}}'
```

Omitting the session headers reproduces the known `400 MissingSessionID`
failure; a `429 FreeUsageLimitError` means the key is valid but the free
quota is exhausted (both documented in `doctor.md` §6).

---

## 6. Operator Runbooks (Copy-Paste)

```bash
# Cold start → verify → diagnose
bash scripts/gateway/start.sh
curl -sk https://localhost:7766/health | python3 -m json.tool
bun run scripts/diagnose/doctor.ts

# Rotate a key without restart (edit .env.local first), then reset + verify
curl -s -X POST http://10.32.34.172:7766/reset -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"
curl -s http://10.32.34.172:7766/health | python3 -m json.tool

# Change providers.json headers/endpoints without restart
python3 -c "import json; json.load(open('config/providers.json')); print('providers.json OK')"
curl -s -X POST http://10.32.34.172:7766/reset -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"
bun run scripts/diagnose/doctor.ts or

# Cooldown-storm recovery (429 cascade): full reset, then targeted probe
curl -s -X POST http://10.32.34.172:7766/reset -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"
bun run scripts/diagnose/doctor.ts nv

# Single-provider pool reset (authenticated, no full reset)
curl -sk -X POST "https://localhost:7766/admin/pool/reset?provider=zn" \
  -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"

# Full restart (port/host/certs changed, or health unresponsive)
bash scripts/gateway/restart.sh
bash scripts/gateway/status.sh

# OpenCode2 CLI self-heal after upgrade
bash scripts/hooks/opencode_autopatch.sh --verbose
```

Rules: never hand-edit `.env` / `.env.local` key values into docs, tickets,
or chat — use `maskKey`-style redaction. Never hardcode real keys into
`doctor.ts` probes (keys are read dynamically from the environment).
`doctor.ts` output is advisory; a `WARN`/`FAIL` there never blocks
`scripts/gateway/start.sh` or gateway boot.
