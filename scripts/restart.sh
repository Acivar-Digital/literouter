#!/usr/bin/env bash
export PATH="$HOME/.bun/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:$PATH"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
LOCATION_FILE="$DEFAULT_ROOT/config/location.json"

ROOT_DIR="$DEFAULT_ROOT"
if [ -f "$LOCATION_FILE" ]; then
    STORED_PATH=$(jq -r '.path // empty' "$LOCATION_FILE" 2>/dev/null || true)
    if [ -n "$STORED_PATH" ] && [ -d "$STORED_PATH" ]; then
        ROOT_DIR="$STORED_PATH"
    fi
fi
cd "$ROOT_DIR"

echo "🔄 Restarting LiteRouter..."
bash "$ROOT_DIR/scripts/stop.sh"
sleep 1
bash "$ROOT_DIR/scripts/start.sh"
