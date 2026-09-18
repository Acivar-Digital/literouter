#!/usr/bin/env bash
set -euo pipefail

PROFILE_DIR="$HOME/.advisor_tools/profile"
mkdir -p "$PROFILE_DIR"
chmod 700 "$PROFILE_DIR"

TARGET_URL="https://m365.cloud.microsoft/chat"

BROWSER_BIN=""
CANDIDATES=(
    "google-chrome"
    "chromium"
    "chromium-browser"
    "chrome"
    "/usr/bin/google-chrome"
    "/opt/google/chrome/chrome"
    "/snap/bin/chromium"
)

for candidate in "${CANDIDATES[@]}"; do
    if command -v "$candidate" >/dev/null 2>&1; then
        BROWSER_BIN="$(command -v "$candidate")"
        break
    elif [[ -x "$candidate" ]]; then
        BROWSER_BIN="$candidate"
        break
    fi
done

if [[ -z "$BROWSER_BIN" ]]; then
    echo "Error: No supported browser found. Install Google Chrome or Chromium to proceed." >&2
    exit 1
fi

CMD=("$BROWSER_BIN" --user-data-dir="$PROFILE_DIR" --no-first-run --new-window --disable-default-apps "$TARGET_URL")

PRINT_ONLY=0
for arg in "$@"; do
    if [[ "$arg" == "--print-only" ]]; then
        PRINT_ONLY=1
        break
    fi
done

if [[ "$PRINT_ONLY" -eq 1 ]]; then
    echo "${CMD[@]}"
    exit 0
fi

"${CMD[@]}" >/dev/null 2>&1 &
PID=$!
echo "Launching Copilot (PID: $PID)"
disown
