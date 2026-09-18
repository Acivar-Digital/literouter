#!/usr/bin/env bash
set -euo pipefail

# advisor/auth/m365_login.sh
# MVP authentication helper for Microsoft 365 / Outlook.
#
# Constraints & Guarantees:
# - Sessions persisted strictly outside repository in $HOME/.advisor_tools/profile.
# - Zero tokens, cookies, or secrets echoed or stored in repository.
# - Zero modifications to .env or .env.local files.
# - Email / realm is masked; full URL with unmasked login_hint is never logged.

PROFILE_DIR="$HOME/.advisor_tools/profile"
mkdir -p "$PROFILE_DIR"
chmod 700 "$PROFILE_DIR"
chmod 700 "$(dirname "$PROFILE_DIR")" 2>/dev/null || true

PRINT_ONLY=0
REALM=""

for arg in "$@"; do
  case "$arg" in
    --help|-h)
      echo "Usage: $0 [--print-only] [--help] [REALM]"
      echo "  --print-only  Print login command and diagnostic info without launching browser"
      echo "  --help        Show this help message"
      exit 0
      ;;
    --print-only)
      PRINT_ONLY=1
      ;;
    *)
      if [[ -z "$REALM" ]]; then
        REALM="$arg"
      fi
      ;;
  esac
done

mask_identifier() {
  local val="$1"
  if [[ -z "$val" ]]; then
    echo "[none]"
    return
  fi
  if [[ "$val" =~ ^([^@]+)@(.+)$ ]]; then
    local user="${BASH_REMATCH[1]}"
    local domain="${BASH_REMATCH[2]}"
    local len=${#user}
    if (( len <= 2 )); then
      echo "${user:0:1}***@${domain}"
    else
      echo "${user:0:1}***${user: -1}@${domain}"
    fi
  else
    local len=${#val}
    if (( len <= 2 )); then
      echo "***"
    else
      echo "${val:0:1}***${val: -1}"
    fi
  fi
}

TARGET_URL="https://outlook.office.com/mail/"

echo "[advisor/auth] Profile directory initialized: $PROFILE_DIR"
echo "[advisor/auth] Target endpoint: $TARGET_URL"
echo "[advisor/auth] NOTE: Endpoint will redirect to login.microsoftonline.com (expected authentication flow)."
echo "[advisor/auth] Account realm: $(mask_identifier "$REALM")"

# Detect browser binary in order: google-chrome, chromium, chromium-browser, chrome
BROWSER_BIN=""
for candidate in google-chrome chromium chromium-browser chrome; do
  if command -v "$candidate" &>/dev/null; then
    BROWSER_BIN="$candidate"
    break
  fi
done

if [[ -z "$BROWSER_BIN" ]]; then
  for candidate in /usr/bin/google-chrome /opt/google/chrome/chrome /snap/bin/chromium; do
    if [[ -x "$candidate" ]]; then
      BROWSER_BIN="$candidate"
      break
    fi
  done
fi

if [[ -z "$BROWSER_BIN" ]]; then
  echo ""
  echo "[advisor/auth] WARNING: No compatible Chromium-based browser found (checked: google-chrome, chromium, chromium-browser, chrome)."
  echo "[advisor/auth] Install hint: Please install Google Chrome or Chromium (e.g., 'sudo apt-get install chromium-browser' or google-chrome-stable)."
  BROWSER_BIN="<browser>"
fi

# Detect running Chrome/Chromium instances and warn about session reuse
if pgrep -a chrome &>/dev/null; then
  echo ""
  echo "[advisor/auth] WARNING: Existing Chrome process detected (pgrep -a chrome)."
  echo "[advisor/auth] Bare launch reuses session ('Opening in existing browser session')."
  echo "[advisor/auth] An isolated directory needs a fresh process. Options:"
  echo "  1) Close all running Chrome instances completely (e.g., pkill -f chrome), OR"
  echo "  2) Run with isolated --user-data-dir and flags: --no-first-run --new-window --disable-default-apps"
fi

if command -v scrapling &>/dev/null; then
  echo ""
  echo "[advisor/auth] Scrapling binary detected."
  echo "[advisor/auth] Exact stealthy-fetch command:"
  echo "  scrapling stealthy-fetch \"$TARGET_URL\" --user-data-dir=\"$PROFILE_DIR\""
  echo ""
  echo "[advisor/auth] Manual browser login command:"
  echo "  $BROWSER_BIN --user-data-dir=\"$PROFILE_DIR\" --no-first-run --new-window --disable-default-apps \"$TARGET_URL\""
else
  echo ""
  echo "[advisor/auth] Scrapling binary not found. Falling back to manual browser login."
  echo "[advisor/auth] Manual browser login command:"
  echo "  $BROWSER_BIN --user-data-dir=\"$PROFILE_DIR\" --no-first-run --new-window --disable-default-apps \"$TARGET_URL\""
fi

if [[ "$PRINT_ONLY" -eq 0 ]]; then
  if [[ "$BROWSER_BIN" != "<browser>" && -n "$BROWSER_BIN" ]]; then
    CMD=("$BROWSER_BIN" --user-data-dir="$PROFILE_DIR" --no-first-run --new-window --disable-default-apps "$TARGET_URL")
    echo ""
    echo "[advisor/auth] Launching: $BROWSER_BIN --user-data-dir=... --new-window ..."
    "${CMD[@]}" >/dev/null 2>&1 & disown
    echo "[advisor/auth] Launched PID $! — login in new window, then close it, then re-run with --print-only to verify profile."
  else
    echo ""
    echo "[advisor/auth] Cannot auto-launch: valid browser binary not found."
  fi
fi
