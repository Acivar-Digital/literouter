#!/usr/bin/env bash
set -euo pipefail

# advisor/session_keepalive.sh
# Session keepalive job for Microsoft 365 / Outlook.
#
# Constraints & Guarantees:
# - Zero secrets, tokens, or PII echoed or stored.
# - Never touch or modify .env or .env.* files.
# - Never delete Cookies or session data in $PROFILE.
# - Checks isolated process presence before running to avoid lock collisions.

PROFILE="${PROFILE:-$HOME/.advisor_tools/profile}"
TARGET_URL="https://outlook.office.com/mail/"

show_help() {
  cat << 'EOF'
Usage: session_keepalive.sh [OPTIONS]

Advisor session keepalive helper for Microsoft 365 / Outlook.

Options:
  --check          Run headless session keepalive check against Outlook (default)
  --cron-install   Print crontab line and systemd timer snippet (echo only)
  --help           Show this help message
EOF
}

show_cron_install() {
  cat << 'EOF'
# Crontab line:
*/30 * * * * /home/yapilwsl/arthityap/literouter/advisor/session_keepalive.sh --check >> $HOME/.advisor_tools/keepalive.log 2>&1

# Systemd timer snippet (echo only, does NOT install):
# 1. Service unit (~/.config/systemd/user/advisor-keepalive.service):
[Unit]
Description=Advisor Outlook Session Keepalive Service

[Service]
Type=oneshot
ExecStart=/home/yapilwsl/arthityap/literouter/advisor/session_keepalive.sh --check

# 2. Timer unit (~/.config/systemd/user/advisor-keepalive.timer):
[Unit]
Description=Run Advisor Outlook Session Keepalive every 30m

[Timer]
OnBootSec=5min
OnUnitActiveSec=30min
Persistent=true

[Install]
WantedBy=timers.target
EOF
}

find_browser() {
  local candidates=(
    "google-chrome"
    "chromium"
    "chromium-browser"
    "chrome"
    "/usr/bin/google-chrome"
    "/opt/google/chrome/chrome"
    "/snap/bin/chromium"
  )

  for candidate in "${candidates[@]}"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    elif [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

run_check() {
  # If isolated PID using $PROFILE exists, skip without killing
  local isolated_pid
  isolated_pid=$(pgrep -f "$PROFILE" 2>/dev/null | grep -v -E "^($$|$BASHPID)$" | head -n 1 || true)
  if [[ -n "$isolated_pid" ]]; then
    echo "BUSY skip"
    exit 0
  fi

  local browser_bin
  browser_bin=$(find_browser || true)
  if [[ -z "$browser_bin" ]]; then
    echo "FAIL size=0"
    du -sh "$PROFILE" 2>/dev/null | head -n 1 || true
    exit 1
  fi

  mkdir -p "$PROFILE"

  local tmp_html="/tmp/ka.html"
  local tmp_log="/tmp/ka.log"
  rm -f "$tmp_html" "$tmp_log" /tmp/ka.* 2>/dev/null || true

  # Run headless dump-dom with timeout 25
  timeout 25 "$browser_bin" \
    --headless \
    --disable-gpu \
    --no-sandbox \
    --user-data-dir="$PROFILE" \
    --dump-dom "$TARGET_URL" > "$tmp_html" 2> "$tmp_log" || true

  local size=0
  if [[ -f "$tmp_html" ]]; then
    size=$(wc -c < "$tmp_html" 2>/dev/null | tr -d '[:space:]' || echo 0)
  fi

  local status="FAIL"
  local exit_code=1

  if [[ -f "$tmp_html" ]] && grep -qiE "ConvergedSignIn|Sign in to your account" "$tmp_html" 2>/dev/null; then
    status="WALL"
    exit_code=2
  elif [[ -f "$tmp_html" ]] && grep -qiE "Inbox|Outlook|Mail" "$tmp_html" 2>/dev/null; then
    status="OK"
    exit_code=0
  else
    status="FAIL"
    exit_code=1
  fi

  echo "${status} size=${size}"
  rm -f "$tmp_html" "$tmp_log" /tmp/ka.* 2>/dev/null || true
  du -sh "$PROFILE" 2>/dev/null | head -n 1 || true

  exit "$exit_code"
}

ACTION="check"
if [[ $# -gt 0 ]]; then
  case "$1" in
    --help|-h)
      ACTION="help"
      ;;
    --cron-install)
      ACTION="cron-install"
      ;;
    --check)
      ACTION="check"
      ;;
    *)
      echo "Unknown argument: $1" >&2
      show_help >&2
      exit 1
      ;;
  esac
fi

case "$ACTION" in
  help)
    show_help
    exit 0
    ;;
  cron-install)
    show_cron_install
    exit 0
    ;;
  check)
    run_check
    ;;
esac
