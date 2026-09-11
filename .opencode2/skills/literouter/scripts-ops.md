# LiteRouter Scripts & Ops: Lifecycle, Health, Reset, Diagnostics

> **Canonical Location:** `.opencode2/skills/literouter/scripts-ops.md`
> **Reference Sources:** `scripts/start.sh`, `scripts/status.sh`, `scripts/stop.sh`,
> `scripts/restart.sh`, `scripts/opencode2_autopatch.sh`, `scripts/doctor.ts`,
> `scripts/doctor_zn.ts`, `src/index.ts` (`handleHealthCheck`, `handleHardReset`,
> `handleAdminPoolReset`, `SYSTEM_MAP`), `src/handlers/openai_compat.ts`
> (`resetProvidersRegistryCache`, `getProvidersRegistry`).
> Companion doc: `.opencode2/skills/literouter/doctor.md` (deep dive on probes).

Every command below is copy-paste runnable against `https://localhost:7766`.
(`-k` is required because the gateway serves a local mkcert self-signed cert.
If `certs/localhost.pem` is absent the gateway falls back to plain HTTP on the
same port — replace `https://` with `http://` and drop `-k` in that case.)

---

## 1. Gateway Lifecycle Scripts (`scripts/`)

All lifecycle scripts `cd` to the repo root, source `.env` then `.env.local`
(if present), and resolve:

- `PORT="${LITEROUTER_PORT:-7766}"`, `HOST="${LITEROUTER_HOST:-0.0.0.0}"`
- `PROTOCOL="http"`, upgraded to `"https"` when **both**
  `certs/localhost.pem` and `certs/localhost-key.pem` exist.
- Tmux session name is always `literouter`; PID file is always `.literouter.pid`.

### 1.1 `scripts/start.sh` — start (idempotent)

```bash
bash scripts/start.sh
```

What it does, in order (verified against source):

1. If `tmux has-session -t literouter` succeeds, prints "already running" and
   exits `0` (does **not** start a second instance).
2. `mkdir -p logs`; prunes `logs/gateway.log` via `scripts/prune-logs.sh`.
3. Launches Bun detached:
   `bun run src/index.ts 2>&1 | tee -a logs/gateway.log` inside the tmux session.
4. Polls `GET ${PROTOCOL}://localhost:${PORT}/health` up to 15 times at 0.5 s
   intervals, succeeding when the body contains `"status":"healthy"`.
5. Records `pgrep -f "bun run src/index.ts"` output into `.literouter.pid`.
6. On success prints the endpoint banner; on timeout dumps the last 20 tmux
   pane lines, runs `scripts/stop.sh`, and exits `1`.

```bash
tmux attach -t literouter   # tail live gateway logs
```

### 1.2 `scripts/status.sh` — status (exit-coded)

```bash
bash scripts/status.sh
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

### 1.3 `scripts/stop.sh` — stop (SIGINT → SIGTERM → SIGKILL)

```bash
bash scripts/stop.sh
```

What it does, in order (verified against source):

1. `tmux send-keys -t literouter C-c`, wait 1 s, then `tmux kill-session`
   if still present.
2. `kill <PID from .literouter.pid>`, wait 1 s, then `kill -9 <PID>` if
   still alive; removes `.literouter.pid`.
3. Best-effort `lsof -ti ":${PORT}" | xargs -r kill -9` to release orphans.

### 1.4 `scripts/restart.sh` — restart (stop → start)

```bash
bash scripts/restart.sh
```

Source is exactly `stop → sleep 1 → start`. Required when `.env` /
`.env.local` port/host values change — `POST /reset` cannot rebind the
listener (see §3.3).

### 1.5 `scripts/opencode2_autopatch.sh` — OpenCode2 CLI self-heal (idempotent)

```bash
bash scripts/opencode2_autopatch.sh
bash scripts/opencode2_autopatch.sh --verbose   # or -v
```

What it does (verified against source):

1. Resolves `@opencode-ai/cli` via `$OPENCODE_CLI_DIR`, then the active
   `node` prefix (`<prefix>/lib/node_modules/@opencode-ai/cli`), then NVM
   (`${NVM_DIR:-$HOME/.nvm}/versions/node/v*/lib/node_modules/@opencode-ai/cli`).
   Exits `0` silently when no installation is found (skip, not failure).
2. Dummy-binary detection: missing file, `postinstall script was not run`
   marker, or size `< 1024` bytes. Recovers from `bin/opencode2.exe` or the
   platform package (`node_modules/@opencode-ai/cli-*/bin/opencode2`).
3. Fast path (`< 5 ms`): exits `0` when `.autopatch_verified` stamp is newer
   than both the binary and this script.
4. One-time `.bak` backup of `bin/opencode2` before any mutation.
5. Three marker-file patch routines (re-run safe):
   - `tool message formatting` (`.patch_tool_format_applied` marker),
   - `network-error anti-silent-completion` (`.patch_network_error_applied`),
   - `collapse-reasoning` scrubber plugin: syncs
     `.opencode2/plugins/collapse-reasoning.ts` (or generates a fallback) to
     `~/.config/opencode2/plugins/` and registers
     `./plugins/collapse-reasoning.ts` in `~/.config/opencode2/config.json`.
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

Exact success contract (`src/index.ts:126-144`):

- HTTP `200` with JSON body containing `"status": "healthy"`.
- Full shape:
  `{"status":"healthy","uptime":<seconds>,"timestamp":<ISO-8601>,`
  `"h2_outbound":<pool session stats>,"circuit_breakers":<per-provider stats>}`.
- `start.sh` greps for `"status":"healthy"`; `status.sh` greps for the same.

Troubleshooting matrix:

| Symptom | Meaning | Action |
|---|---|---|
| Connection refused | Gateway not running | `bash scripts/start.sh` |
| Body lacks `"status":"healthy"` | Process up but unhealthy path | `tmux attach -t literouter`, inspect `logs/gateway.log` |
| `status.sh` says RUNNING but health `⚠️` | Port bound, handler stalled | `bash scripts/restart.sh` |

`scripts/doctor.ts:pingLocalServer` tries `https` then `http` with a 1500 ms
timeout and records only a `WARN` ("FYI only") when the gateway is down —
it never fails the run on this check.

---

## 3. `POST /reset` — Hard Reset (No Auth, Any Method) & Hot-Reload Scope

### 3.1 Exact semantics (`src/index.ts:61-79`, `SYSTEM_MAP`)

`SYSTEM_MAP` routes `/reset` to `handleHardReset()` with **no auth check and
no method check**. `GET /reset` works identically to `POST /reset`, but the
canonical operator form is `POST`:

```bash
curl -sk -X POST https://localhost:7766/reset | python3 -m json.tool
```

What a reset clears, in source order:

1. `globalCooldownManager.clearAll()` — all key cooldowns.
2. `globalKeyPool.reset()` (all providers) + `initializeKeyPools()` —
   re-reads key pools from the environment (picks up `.env.local` edits).
3. `clearCircuitBreakerRegistry()` — breaker open/half-open state + stats.
4. `clearPacerRegistry()` — per-provider pacing queues/timers.
5. `resetHttp2Pool()` — outbound H2 sessions (subsequent requests re-ALPN).
6. `resetProvidersRegistryCache()` — nulls the `config/providers.json` cache
   so the next request re-reads the file from disk (§3.2).
7. `loadAndCacheNativeChains()` + `resetNativeFlashTierIndex()` — native
   chain config and flash-tier rotation cursor.

Exact success contract: HTTP `200`
`{"status":"ok","message":"Hard reset successful. Cooldowns, circuit breakers,`
`pacers, and H2 pools reloaded.","timestamp":<ISO-8601>}`.

### 3.2 Hot-reload scope — `config/providers.json` headers included

`getProvidersRegistry()` (`src/handlers/openai_compat.ts:75-89`) caches the
parsed `config/providers.json` in memory; `resetProvidersRegistryCache()`
sets the cache to `null`. Therefore **editing `config/providers.json` on disk
followed by `POST /reset` hot-reloads without a restart**, including:

- `base_url`, per-completion `endpoints` paths (`{model}` templated),
- `auth_header` (`"Bearer"` vs `"x-api-key"`),
- per-provider `headers` (e.g. OpenRouter `HTTP-Referer`, `X-Title`,
  `User-Agent` fan-out verified live in `config/providers.json:7-11`).

Operator recipe:

```bash
# 1. Edit config/providers.json (headers, base_url, endpoints ...)
# 2. Validate JSON parses before resetting:
python3 -c "import json; json.load(open('config/providers.json')); print('providers.json OK')"
# 3. Hot-reload without restart:
curl -sk -X POST https://localhost:7766/reset
# 4. Confirm healthy:
curl -sk https://localhost:7766/health | python3 -m json.tool
```

Same rule for key rotation: edit `.env.local` first, then `POST /reset`
(step 2 above re-runs `initializeKeyPools()`). What `POST /reset` can **not**
do: rebind port/host, reload TLS certs, or re-`source` `.env` — those need
`bash scripts/restart.sh` (§1.4).

### 3.3 Auth-gated variant — `POST /admin/pool/reset`

Unlike `/reset`, `/admin/pool/reset` **requires auth**: either
`Authorization: Bearer <LITEROUTER_AUTH_KEY>` or any valid `lr-` directive
token (`src/index.ts:81-124`). Invalid credentials return HTTP `401`
`{"error":{"message":"Unauthorized admin access",...}}`.

```bash
# Full hard reset (same effect as POST /reset, but authenticated):
curl -sk -X POST https://localhost:7766/admin/pool/reset \
  -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"

# Single-provider pool reset via query param (cooldowns + timers for one pool):
curl -sk -X POST "https://localhost:7766/admin/pool/reset?provider=nv" \
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

## 4. Diagnostics — `scripts/doctor.ts` & `scripts/doctor_zn.ts`

`doctor.ts` is **strictly informational**: it never gates gateway boot and
never mutates state. Full probe mechanics live in
`.opencode2/skills/literouter/doctor.md`; this section is the ops quick
reference with exact-as-source targets.

```bash
bun run scripts/doctor.ts            # full run: files + ping + all pools
bun run scripts/doctor.ts zn         # targeted probes (also: gg nv or gc)
bun run scripts/doctor.ts zen        # long-form aliases: google gemini nvidia nim openrouter gcp gemma
bun run scripts/doctor.ts provider=nv
```

Run structure (`scripts/doctor.ts:runDoctor`):

1. **Files (1/2):** `.env`, `.env.local` optional; `config/providers.json`,
   `config/fusion.json` required + JSON-parse check. `config/models.json` is legacy advertisement-only for `/v1/models` (re-read per discovery request; absent → 3-item hardcoded fallback) — it never gates serving (`scripts/doctor.ts:380` still probes the file, but doctor output is advisory-only and never blocks boot).
2. **Key pools:** `loadKeyPools()` over merged `.env` + `.env.local` +
   `process.env`; flags `changeme`/`todo`/short placeholder keys as `WARN`.
3. **Ping:** `https` then `http` `GET /health` (WARN-only when down).
4. **Probes (2/2):** sequential per pool, **1000 ms delay between keys**
   (`probePoolSequential`, timeouts 10–20 s per key).

Exact probe targets (verified against `scripts/doctor.ts:157-346`):

| Pool | URL | Model / payload |
|---|---|---|
| `gg` Google | `https://generativelanguage.googleapis.com/v1beta/models/gemma-4-31b-it:generateContent?key=<key>` (key in query, no auth header) | `{contents:[{parts:[{text:"ping"}]}], generationConfig:{maxOutputTokens:10}}` |
| `nv` NVIDIA | `POST https://integrate.api.nvidia.com/v1/chat/completions`, `Authorization: Bearer <key>` | `nvidia/nemotron-3-super-120b-a12b`, `ping`, `max_tokens: 10` |
| `or` OpenRouter | `POST https://openrouter.ai/api/v1/chat/completions`, Bearer + `HTTP-Referer`/`X-Title`/`User-Agent` (env-overridable, defaults `https://opencode.ai` / `OpenCode` / `OpenCode/1.0.0`) | `openrouter/free:nitro`, `ping`, `max_tokens: 10` |
| `zn` Zen | `POST https://opencode.ai/zen/v1/chat/completions` via `probeZenKeyWithFreshSession` (§5) | `big-pickle`, `ping`, `max_tokens: 10` |
| `gc` GCP | `POST https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`, `Authorization: Bearer` + `x-goog-api-key: <key>` | `gemma-4-31b-it`, `ping`, `max_tokens: 10` |

Status mapping (all probes): `200` → `PASS`; `401`/`403` → `FAIL` (replace
key); `429`, other 4xx/5xx, timeouts, connection errors → `WARN` (key stays
in pool). Zero keys in a pool → `⏭️ Skipped`, never a failure.

### 4.2 Unified 5-Stage Model Certification Harness — `eval/code.ts`

The dedicated evaluation harness in `eval/` certifies models end-to-end across an industrial 5-stage pipeline, supporting both Chat Completions (`POST /v1/chat/completions`) and OpenAI Responses API (`POST /v1/responses`):

```bash
bun run eval/code.ts <model_name> [options]
# Options: --wire <chat|rs>, --directive <key>, --stage <1-5>, --continue
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

### 4.2.1 Web Vision-Language Model Evaluation Harness — `eval/web.ts`

The dedicated evaluation harness in `eval/` specifically tailored for front-end website generation and Vision-Language models (e.g. `inclusionai/ling-3.0-flash-vl:free`, GPT-4o, Sonnet):

```bash
bun run eval/web.ts [model_name] [options]
```

### 4.2.2 Master Evaluation Orchestrator — `eval/eval.ts`

Runs the complete gauntlet (speed, coding/agentic, and web UI) in one pass, classifies the model's architectural role (Orchestrator, General Coder, or Explorer), and produces an executive Markdown report card in `eval/reports/`:

```bash
bun run eval/eval.ts <model_name> [options]
# Options: --suites speed,code,web, --reasoning <none|medium|high>, --stage <1-5>
```

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

### 4.3 Universal Model Capability Probe — `scripts/probe_model.ts`

Validates any new model for **OpenCode 2 streaming tool-calling**, **Claude Code CLI (`/v1/messages`)**, and **Pydantic AI structured outputs** before onboarding.

```bash
bun run scripts/probe_model.ts <model_name> [--directive <directive_key>] [--url <gateway_url>]
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

### 4.4 Model Speed & Throughput Benchmark — `eval/speed.ts` (legacy alias: `scripts/bench_speed.ts`)

Measures TTFT (Time To First Token), total duration, token counts, and generation speed (tokens/sec) across models on a standard coding task (LRU cache).

```bash
bun run eval/speed.ts [--models "model1,model2"] [--runs 2] [--directive <directive_key>]
# Or via backward-compatibility stub:
bun run scripts/bench_speed.ts [--models "model1,model2"] [--runs 2] [--directive <directive_key>]
```

---

## 5. Zen Probing — `scripts/doctor_zn.ts` Session Contract

Zen free-tier (`big-pickle`) rejects requests without a full identity +
session fan-out. `doctor.ts` delegates all Zen probing to
`probeZenKeyWithFreshSession()`, which mints one crypto-random
`ses_` + 26 base-62 session ID **per key** and sends these headers
(`buildZenSessionHeaders`, verified against `scripts/doctor_zn.ts:23-43`):

- `Authorization: Bearer <key>`, `Content-Type: application/json`,
- `HTTP-Referer` / `Referer` (default `https://opencode.ai`, override
  `LITEROUTER_HTTP_REFERER`), `X-Title` (default `OpenCode`, override
  `LITEROUTER_X_TITLE`), `User-Agent` (default `OpenCode/1.18.29`, override
  `LITEROUTER_USER_AGENT`),
- Session fan-out (all six carry the same fresh ID): `session-id`,
  `x-session-id`, `x-opencode-session`, `x-opencode-session-id`,
  `opencode-session-id`, `opencode-session`,
- `x-client-version` (parsed from the `User-Agent` suffix, default `1.18.29`),
  `x-client-name: opencode`.

Minimal runnable equivalent (copy-paste; Zen only — no gateway involved):

```bash
SES="ses_$(head -c 19 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 26)"
curl -sk -m 20 -X POST https://opencode.ai/zen/v1/chat/completions \
  -H "Authorization: Bearer <ZEN_KEY>" \
  -H "Content-Type: application/json" \
  -H "HTTP-Referer: https://opencode.ai" -H "Referer: https://opencode.ai" \
  -H "X-Title: OpenCode" -H "User-Agent: OpenCode/1.18.29" \
  -H "session-id: $SES" -H "x-session-id: $SES" \
  -H "x-opencode-session: $SES" -H "x-opencode-session-id: $SES" \
  -H "opencode-session-id: $SES" -H "opencode-session: $SES" \
  -H "x-client-version: 1.18.29" -H "x-client-name: opencode" \
  -d '{"model":"big-pickle","messages":[{"role":"user","content":"ping"}],"max_tokens":10}'
```

Omitting the session headers reproduces the known `400 MissingSessionID`
failure; a `429 FreeUsageLimitError` means the key is valid but the free
quota is exhausted (both documented in `doctor.md` §6).

---

## 6. Operator Runbooks (Copy-Paste)

```bash
# Cold start → verify → diagnose
bash scripts/start.sh
curl -sk https://localhost:7766/health | python3 -m json.tool
bun run scripts/doctor.ts

# Rotate a key without restart (edit .env.local first), then reset + verify
curl -sk -X POST https://localhost:7766/reset
curl -sk https://localhost:7766/health | python3 -m json.tool

# Change providers.json headers/endpoints without restart
python3 -c "import json; json.load(open('config/providers.json')); print('providers.json OK')"
curl -sk -X POST https://localhost:7766/reset
bun run scripts/doctor.ts or

# Cooldown-storm recovery (429 cascade): full reset, then targeted probe
curl -sk -X POST https://localhost:7766/reset
bun run scripts/doctor.ts nv

# Single-provider pool reset (authenticated, no full reset)
curl -sk -X POST "https://localhost:7766/admin/pool/reset?provider=zn" \
  -H "Authorization: Bearer <LITEROUTER_AUTH_KEY>"

# Full restart (port/host/certs changed, or health unresponsive)
bash scripts/restart.sh
bash scripts/status.sh

# OpenCode2 CLI self-heal after upgrade
bash scripts/opencode2_autopatch.sh --verbose
```

Rules: never hand-edit `.env` / `.env.local` key values into docs, tickets,
or chat — use `maskKey`-style redaction. Never hardcode real keys into
`doctor.ts` probes (keys are read dynamically from the environment).
`doctor.ts` output is advisory; a `WARN`/`FAIL` there never blocks
`scripts/start.sh` or gateway boot.
