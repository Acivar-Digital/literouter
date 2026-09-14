# 📋 OpenCode Execution Plan: VPS LiteRouter Replacement — Serve 10.32.34.243:7766

- Status: **AGREED DESIGN & ENRICHED PLAN**, pending CONFIRMED + `/discuss-mode-exit`. No deployment executed yet.
- Tracking: bead `literouter-532o` (canonical source of truth; this document is the operational snapshot).
- Supervisor Audit Disposition: All blockers from the initial audit have been resolved by explicit user decisions (pinned commit `a6b1974`, pre-deployment `/reset` auth gating, strict fail-loud 3-field `location.json`, zero touches to `.env.local`, 600-permission backup custody, and a 15-minute hard rollback threshold).

---

## 1. 🔍 Context, Tooling & AST Strategy
*Map out the codebase before writing a single line of code.*

- **Target Files & Locations:**
  - `src/index.ts`:
    - Bind location: `h2Server.listen(port, env.LITEROUTER_HOST)` (~line 667) and `Bun.serve({ hostname: env.LITEROUTER_HOST, port, ... })` (~line 681).
    - Hard reset auth patch: `handleHardReset()` (~line 81) and route mapping `"/reset": handleHardReset` (~line 196) must be protected using `extractDirectiveToken(req)` and `LITEROUTER_AUTH_KEY` check (mirroring `handleAdminPoolReset` at ~line 117).
  - `src/config/env.ts` & `src/config/schema.ts`:
    - Environment validation: `LITEROUTER_HOST` defaults to `"0.0.0.0"`. When exported by startup scripts from `location.json`, this is strictly bound to `"10.32.34.243"`.
  - `config/location.json` (NEW):
    - Exactly 3 fields: `host`, `port`, `tls_enabled`. Zero excess keys.
  - `scripts/start.sh`, `scripts/status.sh`, `scripts/restart.sh`, `scripts/stop.sh`:
    - Refactored to read serving parameters directly from `config/location.json` using `jq -e`.
    - Health probe targets `${PROTOCOL}://${HOST}:${PORT}/health` instead of `localhost` or certificate-sniffed assumptions.
  - VPS Filesystem (`vps466a`):
    - Backup target: `~/backups/literouter-v1-$(date +%F_%H%M%S).zip` (`chmod 600`).
    - Staging / live directory: `~/services/literouter`.
    - Local keys: `~/services/literouter/.env` (strip serving vars, keep provider keys).
    - Write-protected keys: `~/services/literouter/.env.local` (**ABSOLUTE MANDATE: NEVER TOUCH, EDIT, OR SANITIZE**; daemon environment exports from `location.json` will override any stale serving variables at runtime).
    - Client configuration: `~/.config/opencode/config.json` (two stale `http://localhost:7766` baseURL entries to repoint).
- **Exploration & Quality Tools:**
  - Semantic inspection: `read`, `grep`, `glob`, `subagent`. Raw bash exploration (`grep`, `cat`, `sed`, `find`) is forbidden.
  - Typecheck & Quality Gates: `bun run typecheck` (`tsc --noEmit`), AST validation via `node node_modules/clean_ts/dist/cli.js validate <file>`.
  - Diagnostics: `bun run scripts/doctor.ts`.
- **AST Pre-Check & Structural Invariants:**
  - `src/index.ts`: Inspect AST nodes around route dispatch (`ROUTE_MAP`) and `handleHardReset`. Protect `/reset` by wrapping with auth validation without breaking `/health` (which must remain auth-free).
  - `scripts/*.sh`: Shell syntax and logic validation. Ensure `jq -e` validation aborts with exit code 1 and prints an unmistakable error message if `config/location.json` is missing or malformed before touching any running processes.
  - `config/location.json`: Strictly validated with explicit types: `host` (string), `port` (number), `tls_enabled` (boolean).

---

## 2. 🎯 Scope & Key Decisions to Lock (`bd`)
*Foundational decisions locked into memory via bead `literouter-532o`.*

- **Objective:** Deploy pinned commit `a6b1974` (with `/reset` auth-gate fix and config-driven probe scripts) to `vps466a:~/services/literouter`, serving plain HTTP exclusively on ZeroTier interface `10.32.34.243:7766`.
- **Architecture Decisions:**
  1. **Strict 3-Field `location.json`**:
     ```json
     {
       "host": "10.32.34.243",
       "port": 7766,
       "tls_enabled": false
     }
     ```
     `install_dir` is completely dropped. Scripts execute within their own working directory.
  2. **Fail-Loud Script Invariant**: If `config/location.json` is missing, unreadable, or invalid JSON, `start.sh` and `status.sh` must refuse to boot, output a prominent corrective instruction to stderr, and exit with code 1. They must never fall back to silent defaults or run `stop.sh`.
  3. **Probe Logic Synchronization**: `start.sh` and `status.sh` read `host`, `port`, and `tls_enabled` from `location.json`. The probe URL is dynamically constructed as `http://10.32.34.243:7766/health`. `restart.sh` functions reliably without tripping false-positive kill commands.
  4. **Key Stewardship & `.env.local` Protection**:
     - `.env.local` on the VPS is treated as sacred. It will **never** be opened, edited, or deleted.
     - Legacy `.env` has obsolete serving parameters (`LITEROUTER_HOST`, `LITEROUTER_PORT`) stripped so keys remain isolated.
     - `LITEROUTER_AUTH_KEY` is preserved byte-verbatim. Client tokens require zero rotation.
     - Provider pools (NVIDIA×6, OpenRouter×5, ZEN×7, GOOGLE×5) are ported. If `doctor.ts` marks the two suspect 39-char GOOGLE keys invalid, a 3-pool fallback (`nv`, `or`, `zn`) is pre-approved.
  5. **Pre-Deployment `/reset` Auth-Gate**: Before deploying to the VPS, `src/index.ts` must be patched and verified so that `GET/POST /reset` requires a valid `Authorization: Bearer <LITEROUTER_AUTH_KEY>` or valid directive token, eliminating the network-level reset vulnerability.
  6. **Client Endpoint Realignment**: Update `~/.config/opencode/config.json` on the VPS, repointing lines 17 and 584 from `http://localhost:7766` to `http://10.32.34.243:7766`.
  7. **Operational Posture & Observability**:
     - Supervision remains standard detached `tmux` session `literouter`.
     - Log viewing is performed via `ssh vps466a` followed by `tmux attach -t literouter` or `tail -f logs/gateway.log`. No web-based `/log.html` endpoint.
     - Automated non-interactive PATH injection is omitted; manual interactive SSH shell natively resolves `/home/linuxbrew/.linuxbrew/bin/tmux` and `~/.bun/bin/bun`.
     - Log and trace pruning executes at gateway start/restart via `scripts/prune-logs.sh` (30-day retention). Manual 3 AM recovery posture is accepted.
  8. **Backup Custody**: The zip archive `~/backups/literouter-v1-*.zip` is created on the VPS filesystem with permissions set to `chmod 600`, retaining live keys and certificates securely until manually pruned by the operator.
  9. **Bun Runtime Alignment**: VPS currently runs Bun 1.3.13. Upgrading VPS Bun to 1.4.2 is designated as a dedicated post-plan topic to be discussed and executed after the migration plan is finalized.
- **Context Lock-in:**
  - 🛑 *Action:* Execute `bd` to update `literouter-532o` with these 9 locked decisions.

---

## 3. 🛡️ Pre-Mortem & Threat Model
*Identify failures before they happen.*

- **Input & Environment Edge Cases:**
  - *Missing/Corrupted `config/location.json`*: `jq -e` validation catches missing keys or malformed syntax. Script aborts immediately with: `[ERROR] config/location.json missing or invalid. Required: host (str), port (int), tls_enabled (bool). Aborting.` Old running process remains untouched.
  - *ZeroTier Interface Flap*: If `10.32.34.243` is unassigned or down, `Bun.serve` throws `EADDRNOTAVAIL`. Startup script catches the non-zero health probe, prints the last 20 lines of tmux output, and halts cleanly.
  - *Port Collision on 7766*: Staged cutover stops the old tmux session first, validates port release with `ss -tlnp`, and only proceeds when port 7766 is clear.
  - *Pre-Deploy `/reset` Vulnerability*: Unauthenticated callers on ZeroTier could clear global key cooldowns and circuit breakers. Gating `/reset` with `LITEROUTER_AUTH_KEY` before deployment neutralizes this threat.
  - *Disk Saturation from Traces*: `logs/traces.db` and `gateway.log` can grow large over months. Disk capacity on `/dev/mapper/ubuntu--vg-ubuntu--lv` has 789 GB available (12% utilization). Pruning runs on restart. Risk is minimal.
- **UX & Operator Feedback Loop:**
  - Clear, loud failure messaging in `start.sh` with exact HTTP status codes and terminal box formatting.
  - No silent fallbacks. Zero ambiguous defaults.
- **Concurrency & State Transition:**
  - In-flight requests during the cutover flip: Bun process receives `SIGINT` via tmux, triggering `src/lifecycle/shutdown.ts` drain cycle (default 60s timeout) before `SIGKILL`.
  - State files: `.literouter.pid` atomically updated on successful health check.

---

## 4. 🛠️ Step-by-Step Implementation
*Atomic execution steps. Every phase requires concrete validation.*

- [ ] **Phase 1: Local Code Hardening (Auth-Gate `/reset` & Script Refactor)**
  - **Action:**
    1. Check out clean commit `a6b1974`.
    2. Edit `src/index.ts` to require `LITEROUTER_AUTH_KEY` or directive bearer token on `handleHardReset` (return 401 if invalid). Ensure `/health` remains completely unauthenticated.
    3. Create `config/location.json` with `{ "host": "10.32.34.243", "port": 7766, "tls_enabled": false }`.
    4. Refactor `scripts/start.sh` and `scripts/status.sh` to parse `config/location.json` with `jq -e`. Fail loudly if invalid. Construct health probe URL using JSON values.
  - **Validation:**
    - Run `bun run typecheck` (zero errors).
    - Run `bun run test` (suite passes).
    - Verify with test probe that `curl http://localhost:7766/reset` returns 401, while `curl -H "Authorization: Bearer <AUTH_KEY>" http://localhost:7766/reset` succeeds.
  - 🛑 **Context Lock:** Execute `bd` to record completion of local hardening and commit/patch state.

- [ ] **Phase 2: VPS Pre-Flight Custody & Backup**
  - **Action:**
    1. SSH to `vps466a`.
    2. Ensure `~/backups` directory exists.
    3. Run `zip -r ~/backups/literouter-v1-$(date +%F_%H%M%S).zip ~/services/literouter`.
    4. Enforce strict permissions: `chmod 600 ~/backups/literouter-v1-*.zip`.
    5. Record active gateway PID, tmux session status, and open listening sockets (`ss -tlnp | grep 7766`).
  - **Validation:**
    - Verify zip archive integrity (`unzip -t`) and file permissions (`-rw-------`).
  - 🛑 **Context Lock:** Execute `bd` to record backup archive path and baseline process metadata.

- [ ] **Phase 3: Staged Deployment & Configuration Provisioning**
  - **Action:**
    1. Rsync hardened code tree from WSL to `vps466a:~/services/literouter-stage` (EXCLUDING `.env*`, `certs/`, `logs/`, `node_modules/`).
    2. On VPS in `~/services/literouter-stage`, run `bun install --frozen-lockfile` (or `bun install`).
    3. Copy live `.env` and `.env.local` from `~/services/literouter/` to `~/services/literouter-stage/`.
    4. In `~/services/literouter-stage/.env`, strip legacy `LITEROUTER_HOST` and `LITEROUTER_PORT` entries. Do **NOT** touch `.env.local`.
    5. Confirm `config/location.json` is in place with `10.32.34.243:7766` and `tls_enabled: false`.
  - **Validation:**
    - In `~/services/literouter-stage`, run `bun run typecheck` and `bun run scripts/doctor.ts`.
    - Confirm provider key pool counts and health status while the old gateway continues serving live traffic.
  - 🛑 **Context Lock:** Execute `bd` to record staging validation results and doctor output.

- [ ] **Phase 4: Atomic Cutover & Script Execution**
  - **Action:**
    1. Stop running old gateway via existing tmux session or `bash ~/services/literouter/scripts/stop.sh`.
    2. Verify port 7766 is fully released (`ss -tlnp | grep 7766` returns empty).
    3. Atomically swap directories:
       ```bash
       mv ~/services/literouter ~/services/literouter-old-live
       mv ~/services/literouter-stage ~/services/literouter
       ```
    4. From `~/services/literouter`, execute `bash scripts/start.sh`.
  - **Validation:**
    - `start.sh` reads `config/location.json`, reports healthy status on `http://10.32.34.243:7766/health`.
    - Run `bash scripts/status.sh` and verify `🟢 LiteRouter is RUNNING` with PID and correct host/port.
  - 🛑 **Context Lock:** Execute `bd` to record successful directory swap and initial service boot.

- [ ] **Phase 5: Client Repointing & Comprehensive Go-Live Gate**
  - **Action:**
    1. In `~/.config/opencode/config.json`, update the two LiteRouter endpoints (lines 17 and 584) to `http://10.32.34.243:7766/v1` and `http://10.32.34.243:7766/v1beta`.
    2. Execute the full Go-Live Verification Suite within the 15-minute window:
       - **Gate 1**: `GET http://10.32.34.243:7766/health` returns `{"status":"healthy"}` (HTTP 200).
       - **Gate 2**: `POST http://10.32.34.243:7766/reset` without auth returns HTTP 401 Unauthorized.
       - **Gate 3**: `POST http://10.32.34.243:7766/reset` with Bearer auth returns HTTP 200 OK.
       - **Gate 4**: Live inference probe via OpenRouter (`or`), NVIDIA (`nv`), ZEN (`zn`), and Google (`gg` if keys valid).
       - **Gate 5**: VPS OpenCode client test invocation to confirm local consumer functionality.
  - **Validation:**
    - All 5 gates pass with exit code 0 and valid LLM completions.
    - If any gate fails and cannot be resolved within 15 minutes, abort immediately and execute Phase 6 (Rollback).
  - 🛑 **Context Lock:** Execute `bd` to record Go-Live verification evidence and promote task status.

- [ ] **Phase 6: Cleanup & Post-Cutover Housekeeping**
  - **Action:**
    1. Remove temporary swap directory `~/services/literouter-old-live`.
    2. Confirm live log streaming is operational: `tmux attach -t literouter` (verify, then detach with `Ctrl-B D`).
  - 🛑 **Context Lock:** Execute `bd close literouter-532o --reason "Completed"`, run `bd dolt push`, and push git commits to remote.

---

## 5. 🔄 The OpenCode Test & Resolution Protocol
*Strict instructions for handling any unexpected failures during execution.*

- **Initial Validation:** Run unit tests and typecheck locally before file transfer. Execute `doctor.ts` on staged tree prior to cutover.
- **Failure Protocol:** If a test or probe fails, **NEVER** fall into a blind `edit > retry > repeat` loop.
- **AST & Subagent Escalation:**
  1. Halt all modifications immediately.
  2. Spawn an `explore` or `general` subagent to analyze AST representations and pinpoint structural root causes.
  3. Formulate a verified patch, validate locally via AST/typecheck, and deploy deliberately.

---

## 6. 🚀 Deployment, Testing & Rollback Strategy
*Deployment bounds, hard limits, and deterministic recovery.*

- **Pre-Flight Conditions:**
  - Pinned commit `a6b1974` + explicit patch only.
  - Backup archive verified in `~/backups/` with permissions `600`.
  - Zero modifications to VPS `.env.local`.
  - ZeroTier interface verified active on `10.32.34.243`.
- **Hard Rollback Protocol (15-Minute Timeout):**
  - If Phase 5 verification is not completely green within 15 minutes of the directory swap:
    1. Execute `bash ~/services/literouter/scripts/stop.sh`.
    2. Restore original live directory:
       ```bash
       rm -rf ~/services/literouter
       mv ~/services/literouter-old-live ~/services/literouter || unzip -o ~/backups/literouter-v1-*.zip -d ~/services/literouter
       ```
    3. Revert `~/.config/opencode/config.json` client URLs back to `http://localhost:7766`.
    4. Start the old gateway: `bash ~/services/literouter/scripts/start.sh`.
    5. Verify old gateway responds on `https://localhost:7766/health`.
    6. Log incident post-mortem to bead `literouter-532o` before any subsequent attempts.
- 🛑 **Final Context Lock:** Execute `bd` to lock final deployment state, record verification metrics, and commit task closure.
