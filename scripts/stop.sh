#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

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
if [ -f .env ]; then
    set -a
    source .env 2>/dev/null
    set +a
fi
set -e
PORT="${LITEROUTER_PORT:-7766}"
ORPHAN_PIDS=$(lsof -ti ":$PORT" 2>/dev/null || true)
if [ -n "$ORPHAN_PIDS" ]; then
    echo "   • Releasing port $PORT held by PIDs: $ORPHAN_PIDS..."
    echo "$ORPHAN_PIDS" | xargs -r kill -9 2>/dev/null || true
fi

echo "✅ LiteRouter stopped successfully."
