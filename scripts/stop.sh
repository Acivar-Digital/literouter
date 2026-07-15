#!/bin/bash
set -o pipefail
cd "$(dirname "$0")/.."
source scripts/lib/flush_valkey.sh

TMUX_SESSION="literouter"
PID_FILE=".literouter.pid"

echo "🛑 Stopping LiteRouter..."

# Stop the tmux session
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "   - Sending Ctrl-C to tmux session '$TMUX_SESSION'..."
    tmux send-keys -t "$TMUX_SESSION" C-c
    sleep 1
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null
fi

# Clean up PID file (best-effort kill of any stragglers)
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    [ -n "$PID" ] && kill "$PID" 2>/dev/null
    rm -f "$PID_FILE"
fi

# Flush Valkey once at shutdown
flush_valkey

# Clean up log folder
echo "🗑️ Cleaning logs directory..."
rm -f logs/*.log logs/*.db logs/*.pid 2>/dev/null || true

echo "✅ Shutdown and cleanup complete."
