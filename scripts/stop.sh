#!/bin/bash
set -o pipefail
cd "$(dirname "$0")/.."
source scripts/lib/flush_valkey.sh

TMUX_SESSION="literouter"

PID_FILE=".literouter.pid"
TS_PID_FILE=".literouter-ts.pid"
FUSION_PID_FILE=".literouter-fusion.pid"

echo "🛑 Stopping LiteRouter proxies..."

# Stop the single consolidated tmux session (all three panes)
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "   - Sending Ctrl-C to all panes in tmux session '$TMUX_SESSION'..."
    tmux send-keys -t "$TMUX_SESSION" C-c
    sleep 1
    tmux kill-session -t "$TMUX_SESSION" 2>/dev/null
fi

# Transition cleanup: kill legacy separate TS session if it still exists
if tmux has-session -t literouter-ts 2>/dev/null; then
    echo "   - Stopping legacy TypeScript session 'literouter-ts'..."
    tmux send-keys -t literouter-ts C-c
    sleep 1
    tmux kill-session -t literouter-ts 2>/dev/null
fi

# Clean up PID files (best-effort kill of any stragglers)
for f in "$PID_FILE" "$TS_PID_FILE" "$FUSION_PID_FILE"; do
    if [ -f "$f" ]; then
        PID=$(cat "$f")
        [ -n "$PID" ] && kill "$PID" 2>/dev/null
        rm -f "$f"
    fi
done

# Flush Valkey once at shutdown
flush_valkey

# Clean up log folder to keep context window lean for the LLM
echo "🗑️ Cleaning logs directory..."
rm -f logs/*.log logs/*.db logs/*.pid 2>/dev/null || true

echo "✅ Shutdown and cleanup complete."
