# Start Process: What Happens When You Run `start.sh`

## Overview

`scripts/start.sh` is the single entry point for launching the LiteRouter daemon. It performs stale PID cleanup, upstream API key validation, daemon launch, and a post-boot health check.

## Step-by-Step Breakdown

### 1. Set Working Directory (line 2)

```bash
cd "$(dirname "$0")/.."
```

Moves from `scripts/` up to the repo root so all subsequent paths resolve correctly.

---

### 2. Stale PID Check (lines 7–17)

- Checks if `.literouter.pid` exists from a previous run.
- If it does, reads the stored PID and tests whether that process is still alive with `kill -0`.
- **If alive**: prints `"LiteRouter is already running (PID: ...)"` and exits 0 — prevents accidental double-booting.
- **If dead**: removes the stale PID file and continues to the next step.

---

### 3. Pre-flight: Doctor API Key Validation (lines 21–36)

Runs `uv run python -m src.doctor` which probes every configured API key against the upstream `/chat/completions` endpoint.

**Doctor exit codes:**
| Exit Code | Meaning | start.sh Behavior |
|-----------|---------|-------------------|
| 0 | All keys valid | Continues to launch |
| Non-zero | One or more keys failed (revoked/401) | **Refuses to boot** (unless `--force` is passed) |

**Bypass flags:**
- `--skip-doctor` — skips the entire pre-flight check.
- `--force` — proceeds despite doctor failures (prints a WARN).

Doctor output is tee'd to `/tmp/literouter_doctor.log` for later inspection.

---

### 4. Launch Uvicorn Daemon (lines 39–45)

```bash
nohup uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 > logs/literouter.log 2>&1 &
```

- Starts LiteRouter as a background process bound to `0.0.0.0:7766`.
- All stdout/stderr is redirected to `logs/literouter.log`.
- The new PID is written to `.literouter.pid`.
- `disown` is called (if available) so the process survives parent shell exit.

---

### 5. Health Check & Banner (lines 48–69)

- Waits 2 seconds for the process to initialize.
- Checks if the process is still alive with `kill -0`.
- **If alive**: prints a banner with:
  - PID
  - Local URL: `http://localhost:7766`
  - LAN IP (if available)
  - Health endpoint: `http://localhost:7766/health`
  - Chat endpoint: `http://localhost:7766/v1/chat/completions`
  - Models endpoint: `http://localhost:7766/v1/models`
- **If dead**: prints `"ERROR: LiteRouter failed to start"`, removes the PID file, and exits 1.

---

## Summary Flow

```
start.sh
  │
  ├─ 1. cd to repo root
  ├─ 2. Check stale PID → exit if already running
  ├─ 3. Run doctor.py → exit if keys invalid (unless --force)
  ├─ 4. nohup uvicorn src.main:app on :7766
  ├─ 5. sleep 2 → health check
  │       ├─ alive  → print banner with endpoints
  │       └─ dead   → print error, clean up, exit 1
  └─ done
```

## Usage

```bash
# Normal start (with doctor validation)
bash scripts/start.sh

# Skip doctor check
bash scripts/start.sh --skip-doctor

# Force start even if doctor reports failures (NOT recommended)
bash scripts/start.sh --force
```
