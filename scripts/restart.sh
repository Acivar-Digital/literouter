#!/usr/bin/env bash
export PATH="$HOME/.bun/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:$PATH"
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DEFAULT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd -P)"
LOCATION_FILE="$DEFAULT_ROOT/config/location.json"

ROOT_DIR="$DEFAULT_ROOT"
if [ -f "$LOCATION_FILE" ]; then
    PARENT_DIR=$(jq -r '.parent_dir // empty' "$LOCATION_FILE" 2>/dev/null || true)
    WORKING_FOLDER=$(jq -r '.working_folder // empty' "$LOCATION_FILE" 2>/dev/null || true)
    if [ -n "$PARENT_DIR" ] && [ -n "$WORKING_FOLDER" ]; then
        if [[ "$PARENT_DIR" = /* ]]; then
            FULL_PARENT="$PARENT_DIR"
        else
            FULL_PARENT="$HOME/$PARENT_DIR"
        fi
        ROOT_DIR="$FULL_PARENT/$WORKING_FOLDER"
    else
        STORED_PATH=$(jq -r '.path // empty' "$LOCATION_FILE" 2>/dev/null || true)
        if [ -n "$STORED_PATH" ] && [ -d "$STORED_PATH" ]; then
            ROOT_DIR="$STORED_PATH"
        fi
    fi
fi
cd "$ROOT_DIR"

echo "🔄 Restarting LiteRouter..."
bash "$ROOT_DIR/scripts/stop.sh"
sleep 1
bash "$ROOT_DIR/scripts/start.sh"
