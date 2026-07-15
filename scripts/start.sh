#!/bin/bash
set -o pipefail
cd "$(dirname "$0")/.."
source scripts/lib/flush_valkey.sh

TMUX_SESSION="literouter"
PID_FILE=".literouter.pid"

# Read port from .env, default to 7766
set -a; source .env 2>/dev/null; set +a
PORT="${LITEROUTER_PORT:-7766}"

# Check if already running
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "ERROR: LiteRouter is already running in tmux session '$TMUX_SESSION'."
    exit 0
fi

# Ensure logs folder exists
mkdir -p logs

# Flush Valkey once at start
flush_valkey

# Start the single Bun process in tmux
echo "🥟 Starting LiteRouter (Bun) on port $PORT..."
tmux new-session -d -s "$TMUX_SESSION"
tmux send-keys -t "$TMUX_SESSION" "cd $(pwd)" C-m
tmux send-keys -t "$TMUX_SESSION" "export LITEROUTER_PORT=$PORT && bun run src/index.ts" C-m

sleep 2

# Retrieve and write PID
BUN_PID=$(pgrep -f "bun run src/index.ts" | head -n 1)
echo "${BUN_PID:-}" > "$PID_FILE"

# Verify it is running
if [ -n "$BUN_PID" ] && kill -0 "$BUN_PID" 2>/dev/null; then
    LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  LiteRouter Gateway Running (tmux: $TMUX_SESSION)"
    echo "║"
    echo "║  Bun proxy:        http://localhost:$PORT (PID: $BUN_PID)"
    if [ -n "$LAN_IP" ]; then
        echo "║  Network:          http://${LAN_IP}:$PORT"
    fi
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo "Attach with: tmux attach -t $TMUX_SESSION"
else
    echo "ERROR: Gateway failed to start."
    bash scripts/stop.sh
    exit 1
fi
