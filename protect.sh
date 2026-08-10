#!/usr/bin/env bash
# ==============================================================================
# protect.sh — Write-Protect .env.local against Automated Agent / LLM Edits
# ==============================================================================
# Usage:
#   ./protect.sh          # Lock .env.local (root-owned, read-only for users)
#   ./protect.sh lock     # Lock .env.local
#   ./protect.sh unlock   # Unlock .env.local (restore ownership to current user)
#   ./protect.sh status   # Show current protection status
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_FILE="${SCRIPT_DIR}/.env.local"
CURRENT_USER="${SUDO_USER:-$(id -un)}"

if [ ! -f "${TARGET_FILE}" ]; then
  echo "❌ Error: ${TARGET_FILE} does not exist."
  exit 1
fi

ACTION="${1:-lock}"

case "${ACTION}" in
  lock)
    echo "🔒 Locking ${TARGET_FILE} with sudo..."
    sudo chown root:root "${TARGET_FILE}"
    sudo chmod 644 "${TARGET_FILE}"
    echo "✅ Protected: .env.local is now owned by root (read-only for normal users / LLMs)."
    echo "   LiteRouter can still read keys, but agents cannot modify the file."
    ;;

  unlock)
    echo "🔓 Unlocking ${TARGET_FILE} with sudo..."
    sudo chown "${CURRENT_USER}:${CURRENT_USER}" "${TARGET_FILE}"
    sudo chmod 600 "${TARGET_FILE}"
    echo "✅ Unlocked: .env.local ownership restored to ${CURRENT_USER}."
    ;;

  status)
    echo "📋 Status for ${TARGET_FILE}:"
    ls -l "${TARGET_FILE}"
    ;;

  *)
    echo "Usage: $0 [lock|unlock|status]"
    exit 1
    ;;
esac
