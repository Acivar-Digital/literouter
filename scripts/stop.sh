#!/bin/bash
set -o pipefail
cd "$(dirname "$0")/.."
source scripts/lib/flush_valkey.sh

PID_FILE=".literouter.pid"
TS_PID_FILE=".literouter-ts.pid"

echo "🛑 Stopping LiteRouter proxies..."

# 1. Stop Python proxy in tmux session
if tmux has-session -t literouter 2>/dev/null; then
    echo "   - Stopping Python LiteRouter in tmux session..."
    tmux send-keys -t literouter C-c
    sleep 1
    tmux kill-session -t literouter 2>/dev/null
fi

# 2. Stop TypeScript proxy in tmux session
if tmux has-session -t literouter-ts 2>/dev/null; then
    echo "   - Stopping TypeScript LiteRouter in tmux session..."
    tmux send-keys -t literouter-ts C-c
    sleep 1
    tmux kill-session -t literouter-ts 2>/dev/null
fi

# Clean up PID files
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    kill "$PID" 2>/dev/null
    rm -f "$PID_FILE"
fi
if [ -f "$TS_PID_FILE" ]; then
    TS_PID=$(cat "$TS_PID_FILE")
    kill "$TS_PID" 2>/dev/null
    rm -f "$TS_PID_FILE"
fi

# Flush Valkey once at shutdown
flush_valkey

# Clean up log folder to keep context window lean for the LLM
echo "🗑️ Cleaning logs directory..."
rm -f logs/*.log logs/*.db logs/*.pid 2>/dev/null || true

echo "✅ Shutdown and cleanup complete."
