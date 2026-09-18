# 10 Keepalive

Reference documentation for the Microsoft 365 / Outlook session keepalive daemon script (`advisor/session_keepalive.sh`).

## a. Inputs & Dependencies

- **Source Entrypoint**: `advisor/session_keepalive.sh` (POSIX bash with `set -euo pipefail`, `advisor/session_keepalive.sh:1-2`).
- **CLI Options**:
  - `--check`: Run headless session keepalive check against Outlook (default action, `advisor/session_keepalive.sh:23,137,147-148`).
  - `--cron-install`: Print scheduled cron and systemd timer templates without making changes (`advisor/session_keepalive.sh:24,143-145`).
  - `--help` / `-h`: Display command usage and descriptions (`advisor/session_keepalive.sh:25,140-142`).
- **Environment & Storage**:
  - `PROFILE`: Chromium user profile path, defaults to `$HOME/.advisor_tools/profile` (`advisor/session_keepalive.sh:13`).
  - `TARGET_URL`: Target endpoint set to `https://outlook.office.com/mail/` (`advisor/session_keepalive.sh:14`).
- **System Binaries**: Browser discovery across `google-chrome`, `chromium`, `chromium-browser`, `chrome`, and absolute `/usr/bin`, `/opt`, `/snap` paths (`advisor/session_keepalive.sh:58-77`); utility commands `pgrep`, `timeout`, `wc`, `grep`, and `du`.
- **Security & Cookie Safety Guarantees**:
  - Zero secrets or tokens echoed, persisted, or leaked (`advisor/session_keepalive.sh:8`).
  - Never touches, reads, or modifies `.env` or `.env.*` files (`advisor/session_keepalive.sh:9`).
  - **Never-Delete Cookies**: Session cookies and credentials in `$PROFILE` are strictly protected and never cleared (`advisor/session_keepalive.sh:10`). Temporary files are restricted to `/tmp/ka.*` and purged on each run (`advisor/session_keepalive.sh:99-102,131`).

## b. Transformation

1. **Lock Collision Check**:
   - Inspects running processes with `pgrep -f "$PROFILE"` (excluding current bash shell PID, `advisor/session_keepalive.sh:83`).
   - If an existing process holds the profile lock, safely skips by echoing `BUSY skip` and exits 0 (`advisor/session_keepalive.sh:84-87`).
2. **Browser Discovery**:
   - Searches candidate binaries. If none are found, outputs `FAIL size=0` and exits 1 (`advisor/session_keepalive.sh:89-95`).
3. **Headless Keepalive Navigation**:
   - Cleans prior scratch files (`/tmp/ka.html`, `/tmp/ka.log`, `advisor/session_keepalive.sh:101`).
   - Executes `timeout 25 "$browser_bin" --headless --disable-gpu --no-sandbox --user-data-dir="$PROFILE" --dump-dom "$TARGET_URL"` (`advisor/session_keepalive.sh:104-109`).
4. **DOM Inspection & Status Determination**:
   - `WALL`: HTML matches `ConvergedSignIn|Sign in to your account` -> interactive login wall encountered (`advisor/session_keepalive.sh:119-121`).
   - `OK`: HTML matches `Inbox|Outlook|Mail` -> session remains active and authenticated (`advisor/session_keepalive.sh:122-124`).
   - `FAIL`: Unmatched DOM content, empty dump, or navigation timeout (`advisor/session_keepalive.sh:125-128`).
5. **Cleanup & Profiling**:
   - Purges ephemeral `/tmp/ka.*` files while keeping all `$PROFILE` storage intact (`advisor/session_keepalive.sh:131`).
   - Outputs disk consumption with `du -sh "$PROFILE"` (`advisor/session_keepalive.sh:132`).

## c. Outputs & Dependencies

- **Console Output & Exit Codes**:
  - `OK size=<bytes>` (exit code `0`): Session alive and healthy (`advisor/session_keepalive.sh:122-124,130,134`).
  - `WALL size=<bytes>` (exit code `2`): Session expired, redirected to login wall (`advisor/session_keepalive.sh:119-121,130,134`).
  - `FAIL size=<bytes>` (exit code `1`): Missing browser, bad response, or fetch failure (`advisor/session_keepalive.sh:92-94,126-128,130,134`).
  - `BUSY skip` (exit code `0`): Concurrent browser process detected holding profile (`advisor/session_keepalive.sh:85-86`).
- **Cron Scheduling**:
  - Cron line emitted by `--cron-install` (`advisor/session_keepalive.sh:31-32`):
    ```cron
    */30 * * * * /home/yapilwsl/arthityap/literouter/advisor/session_keepalive.sh --check >> $HOME/.advisor_tools/keepalive.log 2>&1
    ```
  - Systemd timer and service unit definitions running every 30 minutes (`advisor/session_keepalive.sh:35-54`).
- **Downstream Consumers**:
  - Keeps Chromium session cookies warmed and refreshed so upstream fetchers (`advisor/fetch/copilot_view.ts`, `advisor/fetch/views.sh`) run without manual re-authentication.
