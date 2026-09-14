# LiteRouter Tmux Hygiene — Clear Rubbish From the Pane

> **Canonical Location:** `.opencode2/skills/literouter/tmux-hygiene.md`
> **Reference Sources:** `scripts/start.sh:81-105`, `scripts/stop.sh`, `scripts/restart.sh`, `src/ui/banner.ts`, `src/index.ts:50-58`, `src/handlers/google_native.ts:93-108`
> **Lazy-load:** Load this file ONLY when the user asks about tmux rubbish, `getcwd` noise, pane echo, blank fill, or quiet boot. Do not load it for routing, keys, or streaming tasks.

---

## 1. What "rubbish" means (3 kinds)

| Kind | Looks like | Source | Fix |
|---|---|---|---|
| **Shell-init noise** | `shell-init: error retrieving current directory: getcwd: cannot access parent directories` / `chdir: error retrieving ...` | Stale tmux server cwd points at a deleted dir (e.g. VPS `literouter-old (deleted)`). Every new window inherits the dead cwd. | `start.sh` handles it (see §3). Manual `cd A && cd B` from the dead cwd reprints it — don't do that. |
| **Typed-command echo** | The 3 boot commands reprinted at pane top (`export PATH=...`, `cd "..." && cd "..."`, `export LITEROUTER_* && bun run ...`) | Old `start.sh` used `tmux send-keys` to type into the pane. | Fixed in `524a539`: `tmux new-session -c "$ROOT_DIR"` with an initial command. Pane starts directly with gateway output. |
| **Boot log lines** | `[BOOT] Provider registry loaded` / `Loaded native_chains: ...` | `src/index.ts:54` + `src/handlers/google_native.ts:100` | Removed in `ea01ee0`. Pane starts at the `====` banner. `FATAL` lines stay. |

Trailing blank rows below the banner are empty terminal rows, not code output (`src/ui/banner.ts` prints one block only).

---

## 2. Clear rubbish now (safe, no restart)

History-only wipe — gateway keeps running, no input sent to `bun`:

```bash
# Local (WSL)
tmux clear-history -t literouter
tmux capture-pane -pt literouter | head -n 12   # verify: starts with ==== / BOOT

# VPS (tmux lives under linuxbrew, not on default PATH)
ssh vps466a 'export PATH="/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:$PATH"; tmux clear-history -t literouter'
```

Display-only refresh (does not wipe scrollback):

```bash
tmux send-keys -t literouter C-l
```

Verify clean (expect `0`):

```bash
tmux capture-pane -pt literouter -S -200 | grep -c "getcwd\|chdir\|shell-init\|export PATH\|Provider registry loaded\|Loaded native_chains" || echo 0
curl -s -m 5 http://10.32.34.172:7766/health   # local
curl -s -m 5 http://10.32.34.243:7766/health   # VPS
```

⛔ Never `send-keys` anything else into a running gateway pane — typing into foreground `bun` stdin disturbs serving.

---

## 3. How `start.sh` keeps the pane quiet (current behavior)

`scripts/start.sh:81-105` (commits `524a539` / `60e2827` / `a73928e` / `329cf65`):

1. `tmux new-session -d -s literouter -c "$ROOT_DIR"` with a single initial command — no `send-keys`, so no typed-command echo.
2. Subshell runs `bash --noprofile --norc -c 'cd / && cd "$ROOT_DIR" && printf "\033[2J\033[H" && ... exec bun run src/index.ts ...'` — survives a stale daemon cwd, clears early warnings.
3. Post-boot, after the health poll succeeds, runs `tmux clear-history -t literouter` so any `shell-init/getcwd` lines from the old tmux server never stay in scrollback.
4. Bind authority stays `config/location.json` — no `LITEROUTER_HOST/PORT/TLS` exports in the boot path.

Normal restart stays quiet automatically:

```bash
bash scripts/restart.sh   # stop → start → health poll → clear-history
bash scripts/status.sh    # expect: RUNNING + Health OK
```

---

## 4. Stale tmux server (VPS `getcwd` keeps coming back)

Root cause seen Sep-14: VPS tmux server `PID 19756` (started Aug-16) holds cwd `literouter-old (deleted)` (`readlink /proc/<pid>/cwd`). Every new `literouter` window inherits it, so the login shell prints `shell-init: getcwd` before anything else. `clear-history` wipes it, but the next manual boot reprints it.

Check:

```bash
ssh vps466a 'for p in $(pgrep -x tmux); do echo -n "TMUX $p cwd: "; readlink /proc/$p/cwd; done'
ls -l /proc/*/cwd 2>/dev/null | grep -i deleted
```

Durable fix needs a maintenance window — restarting the tmux server kills every session on it (`bazi-infra`, `baziRAG`, `baziforecast`, `literouter`, `mcpmart`). Until then: always boot via `bash scripts/restart.sh`, never manual double-`cd` from the dead cwd, and never reboot the host to "fix tmux" (kills all sessions + this agent session).

---

## 5. Don't confuse pane rubbish with real failures

| Symptom | Rubbish or real? | Action |
|---|---|---|
| `shell-init/getcwd/chdir` at pane top, gateway `healthy` | Rubbish | `tmux clear-history -t literouter` |
| Typed `export`/`cd` echo at pane top, gateway `healthy` | Rubbish (old `start.sh`) | Pull `524a539+`, `restart.sh` |
| `error: Module not found "src/index.ts"` + health timeout | **Real** — command ran in broken cwd | Pull `60e2827+`, `restart.sh` |
| `Gateway failed to respond ... /health within timeout` | **Real** — `bun` died on boot | Check `tmux capture-pane`, `logs/gateway.log`, `ss -tlnp \| grep 7766` |
