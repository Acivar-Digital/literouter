#!/bin/bash
set -o pipefail
cd "$(dirname "$0")/.."
source scripts/lib/flush_valkey.sh

TMUX_SESSION="literouter"

PID_FILE=".literouter.pid"
TS_PID_FILE=".literouter-ts.pid"
FUSION_PID_FILE=".literouter-fusion.pid"

# Check if already running
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "ERROR: LiteRouter is already running in tmux session '$TMUX_SESSION'."
    exit 0
fi

# Ensure logs folder exists
mkdir -p logs

# Flush Valkey once at start
flush_valkey

# Start all three services as panes inside a single tmux session.
echo "🐍 Starting Python LiteRouter on port 7766 (pane 0)..."
tmux new-session -d -s "$TMUX_SESSION"
tmux send-keys -t "$TMUX_SESSION" "cd /home/yapilwsl/arthityap/literouter" C-m
tmux send-keys -t "$TMUX_SESSION" "uv run uvicorn src.main:app --host 0.0.0.0 --port 7766" C-m

echo "🔀 Starting Fusion Sidecar on port 7768 (pane 1)..."
tmux split-window -t "$TMUX_SESSION" -v
tmux send-keys -t "$TMUX_SESSION" "cd /home/yapilwsl/arthityap/literouter" C-m
tmux send-keys -t "$TMUX_SESSION" "uv run uvicorn fusion:app --host 0.0.0.0 --port 7768" C-m

echo "🥟 Starting TypeScript LiteRouter on port 7767 (pane 2)..."
tmux split-window -t "$TMUX_SESSION" -v
tmux send-keys -t "$TMUX_SESSION" "cd /home/yapilwsl/arthityap/literouter" C-m
tmux send-keys -t "$TMUX_SESSION" "bun run ts-src/src/index.ts" C-m

# Lay out the three panes evenly (stacked vertically)
tmux select-layout -t "$TMUX_SESSION" even-vertical

sleep 2

# Retrieve and write PIDs
PY_PID=$(pgrep -f "uvicorn src.main:app" | head -n 1)
FUSION_PID=$(pgrep -f "uvicorn fusion:app" | head -n 1)
TS_PID=$(pgrep -f "bun run ts-src/src/index.ts" | head -n 1)
echo "${PY_PID:-}" > "$PID_FILE"
echo "${FUSION_PID:-}" > "$FUSION_PID_FILE"
echo "${TS_PID:-}" > "$TS_PID_FILE"

# Verify all three are running
PY_OK=0
FUSION_OK=0
TS_OK=0
[ -n "$PY_PID" ] && kill -0 "$PY_PID" 2>/dev/null && PY_OK=1
[ -n "$FUSION_PID" ] && kill -0 "$FUSION_PID" 2>/dev/null && FUSION_OK=1
[ -n "$TS_PID" ] && kill -0 "$TS_PID" 2>/dev/null && TS_OK=1

if [ $PY_OK -eq 1 ] && [ $FUSION_OK -eq 1 ] && [ $TS_OK -eq 1 ]; then
    LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  LiteRouter Coordinated Gateways Running (tmux: $TMUX_SESSION)"
    echo "║"
    echo "║  Python proxy:     http://localhost:7766 (PID: $PY_PID)   [pane 0]"
    echo "║  Fusion sidecar:    http://localhost:7768 (PID: $FUSION_PID) [pane 1]"
    echo "║  TypeScript proxy:  http://localhost:7767 (PID: $TS_PID)   [pane 2]"
    if [ -n "$LAN_IP" ]; then
        echo "║  Network:          http://${LAN_IP}:7766 / 7767 / 7768"
    fi
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo "Attach with: tmux attach -t $TMUX_SESSION   (Ctrl-B + arrow to switch panes)"
else
    echo "ERROR: One or more gateways failed to start."
    echo "  Python OK: $PY_OK, Fusion OK: $FUSION_OK, TS OK: $TS_OK"
    bash scripts/stop.sh
    exit 1
fi
