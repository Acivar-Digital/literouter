# 02 Copilot launcher

Reference documentation for the Microsoft Copilot browser launcher script (`advisor/copilot.sh`).

## a. Inputs-required dependencies (bins, env vars, profile dir)

- **Source Entrypoint**: `advisor/copilot.sh` (POSIX Bash with `set -euo pipefail`, `advisor/copilot.sh:1-2`).
- **Environment Variables**:
  - `HOME`: Evaluated to resolve profile directory path (`advisor/copilot.sh:4`).
  - *No `.env*` or secret inputs*: The launcher operates without reading any `.env*` files or API secrets.
- **Profile Directory**:
  - `PROFILE_DIR="$HOME/.advisor_tools/profile"` (`advisor/copilot.sh:4`).
  - Provisioned with `mkdir -p "$PROFILE_DIR"` (`advisor/copilot.sh:5`).
  - Secured with user-only permissions `chmod 700 "$PROFILE_DIR"` (`advisor/copilot.sh:6`).
- **Target URL**:
  - `TARGET_URL="https://m365.cloud.microsoft/chat"` (`advisor/copilot.sh:8`).
- **Binary Candidates**:
  - Probes system executables in priority order (`advisor/copilot.sh:11-19`):
    1. `google-chrome`
    2. `chromium`
    3. `chromium-browser`
    4. `chrome`
    5. `/usr/bin/google-chrome`
    6. `/opt/google/chrome/chrome`
    7. `/snap/bin/chromium`
  - Resolved dynamically using `command -v "$candidate"` (`advisor/copilot.sh:22-24`) or direct executable check `[[ -x "$candidate" ]]` (`advisor/copilot.sh:25-28`).
  - Fails fast with exit code `1` and error message on stderr if no supported binary is found (`advisor/copilot.sh:31-34`).

## b. Transformation (flags, launch flow)

- **Browser Flags Configuration**:
  - Assembles `CMD` array (`advisor/copilot.sh:36`):
    - `"$BROWSER_BIN"`: Resolved Chrome/Chromium executable.
    - `--user-data-dir="$PROFILE_DIR"`: Isolates browser profile, cache, and session cookies inside `~/.advisor_tools/profile`.
    - `--no-first-run`: Skips initial onboarding wizard and sign-in prompts.
    - `--new-window`: Launches target destination in a standalone browser window.
    - `--disable-default-apps`: Disables installation and launch of bundled default web applications.
    - `"$TARGET_URL"`: Directly navigates to the M365 Copilot chat interface.
- **Launch Flow**:
  1. **CLI Argument Parsing**:
     - Scans `$@` for `--print-only` flag (`advisor/copilot.sh:38-44`).
  2. **Dry-Run Mode (`--print-only`)**:
     - When `PRINT_ONLY=1`, prints full assembled command array `echo "${CMD[@]}"` to stdout and terminates with `exit 0` (`advisor/copilot.sh:46-49`).
  3. **Detached Background Execution**:
     - Executes `"${CMD[@]}" >/dev/null 2>&1 &` to redirect stdout/stderr and spawn in background (`advisor/copilot.sh:51`).
     - Captures spawned background PID with `PID=$!` (`advisor/copilot.sh:52`).
     - Logs `Launching Copilot (PID: $PID)` to stdout (`advisor/copilot.sh:53`).
     - Invokes `disown` to detach browser process from parent shell session (`advisor/copilot.sh:54`).

## c. Outputs-dependencies (what it produces, who consumes)

- **Produced Outputs**:
  - **Browser Process**: Detached background Chromium/Chrome process (`PID=$!`, `advisor/copilot.sh:51-54`).
  - **Console Output**:
    - Print-only mode: Assembled executable invocation command string (`advisor/copilot.sh:47`).
    - Standard run: Informational message `Launching Copilot (PID: <PID>)` (`advisor/copilot.sh:53`).
  - **File System State**:
    - Dedicated user profile store at `$HOME/.advisor_tools/profile` with `700` permissions (`advisor/copilot.sh:4-6`).
    - Browser profile caches, cookies, and active Microsoft 365 Copilot authentication session tokens.
- **Downstream Consumers**:
  - **Interactive Operator**: Accesses M365 Copilot chat interface (`https://m365.cloud.microsoft/chat`) in an isolated browser window.
  - **Advisor Capture Subsystem**: `advisor/auth/capture.ts` (and `advisor/auth/m365_login.sh`) which inspects or leverages the authenticated profile directory.
  - **Advisor Fetch Modules**: View extractors (`advisor/fetch/copilot_view.ts`, `advisor/fetch/views.sh`, `advisor/fetch/views.py`) relying on the authenticated session and profile state.
