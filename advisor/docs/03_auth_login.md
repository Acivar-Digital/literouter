# 03 Auth login

Reference documentation for the Microsoft 365 / Outlook authentication bootstrap script (`advisor/auth/m365_login.sh`).

## a. Inputs & Dependencies

- **Source Entrypoint**: `advisor/auth/m365_login.sh` (POSIX bash with `set -euo pipefail`, `advisor/auth/m365_login.sh:1-2`).
- **CLI Arguments**:
  - `--print-only`: Display launch commands and diagnostics without spawning a browser (`advisor/auth/m365_login.sh:29-31`).
  - `--help` / `-h`: Usage documentation (`advisor/auth/m365_login.sh:23-28`).
  - `REALM` (optional positional): Account email or tenant identifier for login hint masking (`advisor/auth/m365_login.sh:32-36`).
- **Environment & System Dependencies**:
  - **Browser Binaries**: Looked up via `command -v` in candidate order (`google-chrome`, `chromium`, `chromium-browser`, `chrome`, `advisor/auth/m365_login.sh:74-79`).
  - **Fallback Binary Paths**: Checks filesystem paths (`/usr/bin/google-chrome`, `/opt/google/chrome/chrome`, `/snap/bin/chromium`, `advisor/auth/m365_login.sh:81-88`).
  - **Optional Scraping Helper**: Detects `scrapling` in `$PATH` for stealth fetching (`advisor/auth/m365_login.sh:107-111`).
  - **Process Utilities**: Uses `pgrep` to detect running Chrome instances (`advisor/auth/m365_login.sh:98`).
- **Security & Secret Constraints**: Zero `.env*` file modifications; zero secrets, tokens, or cookies logged or tracked in Git (`advisor/auth/m365_login.sh:8-11`).

## b. Transformation

1. **Profile Storage Provisioning**:
   - Initializes directory `$HOME/.advisor_tools/profile` outside repository (`advisor/auth/m365_login.sh:13-14`).
   - Enforces restrictive user permissions (`chmod 700`, `advisor/auth/m365_login.sh:15-16`).
2. **Identifier Redaction**:
   - `mask_identifier()` redacts `REALM` strings (e.g., `u***r@domain.com` or `a***z`), avoiding logging plain identities (`advisor/auth/m365_login.sh:40-63,70`).
3. **Endpoint Resolution**:
   - Targets generic service URL `TARGET_URL="https://outlook.office.com/mail/"` (`advisor/auth/m365_login.sh:65`), which routes through Microsoft's generic identity provider `login.microsoftonline.com` (`advisor/auth/m365_login.sh:69`).
4. **Browser Runtime Discovery**:
   - Sequentially probes candidates; if all miss, falls back to `<browser>` sentinel with installation advice (`advisor/auth/m365_login.sh:90-95`).
   - Flags active Chrome processes via `pgrep -a chrome` to prevent single-instance profile collision (`advisor/auth/m365_login.sh:98-105`).
5. **Execution Branching**:
   - If `scrapling` is present, outputs the recommended `scrapling stealthy-fetch` command string (`advisor/auth/m365_login.sh:107-112`).
   - Always prepares manual invocation: `$BROWSER_BIN --user-data-dir="$PROFILE_DIR" --no-first-run --new-window --disable-default-apps "$TARGET_URL"` (`advisor/auth/m365_login.sh:114,119`).
   - When `PRINT_ONLY=0` and browser binary exists, spawns detached background process with `& disown` (`advisor/auth/m365_login.sh:122-128`).

## c. Outputs & Dependencies

- **Artifacts**:
  - Populated Chromium user profile directory at `$HOME/.advisor_tools/profile/` containing authenticated browser cookies, storage, and session state (`advisor/auth/m365_login.sh:13,124`).
- **Console Feedback**:
  - Diagnostic logs containing directory location, generic endpoint URL, masked realm, and background process PID (`advisor/auth/m365_login.sh:67-70,128`).
- **Downstream Consumers**:
  - Session capture tools (`advisor/auth/capture.ts`, `04_auth_capture.md`).
  - View fetch routines relying on persistent user profile state (`advisor/fetch/copilot_view.ts`, `advisor/fetch/views.sh`).
