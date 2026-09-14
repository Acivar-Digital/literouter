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

TMUX_SESSION="literouter"
PID_FILE=".literouter.pid"

echo "🛑 Stopping LiteRouter Gateway..."

# 1. Stop the tmux session gracefully
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "   • Sending SIGINT (Ctrl-C) to tmux session '$TMUX_SESSION'..."
    tmux send-keys -t "$TMUX_SESSION" C-c 2>/dev/null || true
    sleep 1
    if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
        echo "   • Terminating tmux session '$TMUX_SESSION'..."
        tmux kill-session -t "$TMUX_SESSION" 2>/dev/null || true
    fi
fi

# 2. Terminate PID if still running
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "   • Sending SIGTERM to process PID $PID..."
        kill "$PID" 2>/dev/null || true
        sleep 1
        if kill -0 "$PID" 2>/dev/null; then
            echo "   • Force-killing (SIGKILL) process PID $PID..."
            kill -9 "$PID" 2>/dev/null || true
        fi
    fi
    rm -f "$PID_FILE"
fi

# 3. Best-effort kill of any orphan Bun servers on port
set +e
PORT="7766"
if [ -f "$LOCATION_FILE" ]; then
    PORT=$(jq -r '.port // 7766' "$LOCATION_FILE" 2>/dev/null || echo "7766")
elif [ -f .env ]; then
    set -a
    source .env 2>/dev/null
    set +a
    PORT="${LITEROUTER_PORT:-7766}"
fi
set -e

ORPHAN_PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
if [ -n "$ORPHAN_PIDS" ]; then
    echo "   • Releasing port $PORT held by PIDs: $ORPHAN_PIDS..."
    echo "$ORPHAN_PIDS" | xargs -r kill -9 2>/dev/null || true
fi

echo "✅ LiteRouter stopped successfully."
