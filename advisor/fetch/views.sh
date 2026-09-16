#!/usr/bin/env bash
# advisor/fetch/views.sh — stealthy-fetch wrapper for clean HTML -> agent views
# Usage: stealthy-fetch --ai-targeted -s selectors <url>
# Output: temp file; cleaned up after read.

set -euo pipefail

# PROFILE support via $ADVISOR_PROFILE
PROFILE="${ADVISOR_PROFILE:-$HOME/.advisor_tools/profile}"
mkdir -p "$PROFILE"
export ADVISOR_PROFILE="$PROFILE"

SELECTORS=""
TARGETED=0
URL=""

while [[ $# -gt 0 ]]; do
  case $1 in
    --ai-targeted) TARGETED=1; shift ;;
    -s) SELECTORS="$2"; shift 2 ;;
    *) URL="$1"; shift ;;
  esac
done

TMPFILE=$(mktemp /tmp/advisor_views.XXXXXX)

if command -v scrapling >/dev/null 2>&1; then
  # Note: no secrets/cookies on CLI; selectors passed via CLI only.
  scrapling extract stealthy-fetch "$URL" "$TMPFILE.md" --ai-targeted ${SELECTORS:+-s "$SELECTORS"}
  echo "$TMPFILE.md"
  trap 'rm -f "$TMPFILE" "$TMPFILE.md"' EXIT
else
  # Stub fallback
  echo "Fetching $URL with selectors: $SELECTORS (ai-targeted=$TARGETED)" > "$TMPFILE"
  echo "<!-- cleaned view -->" >> "$TMPFILE"
  echo "$TMPFILE"
  trap 'rm -f "$TMPFILE"' EXIT
fi
