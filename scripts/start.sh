#!/bin/bash
set -o pipefail
cd "$(dirname "$0")/.."
source scripts/lib/flush_valkey.sh

PID_FILE=".literouter.pid"
TS_PID_FILE=".literouter-ts.pid"

# Check if already running (either Python or TS)
if tmux has-session -t literouter 2>/dev/null || tmux has-session -t literouter-ts 2>/dev/null; then
    echo "ERROR: LiteRouter (Python or TS) is already running in a tmux session."
    exit 0
fi

# Ensure logs folder exists
mkdir -p logs

# Flush Valkey once at start
flush_valkey

# Gate 2: Live key validation before boot
uv run python src/doctor.py
if [ $? -ne 0 ]; then
    echo "ERROR: Gate 2 validation failed. Fix keys before starting."
    exit 1
fi

# 1. Start Python LiteRouter (Port 7766) in tmux session 'literouter'
echo "🐍 Starting Python LiteRouter on port 7766 inside tmux session 'literouter'..."
tmux new-session -d -s literouter
tmux send-keys -t literouter "cd /home/yapilwsl/arthityap/literouter" C-m
tmux send-keys -t literouter "uv run uvicorn src.main:app --host 0.0.0.0 --port 7766" C-m

# 2. Start TypeScript LiteRouter (Port 7767) in tmux session 'literouter-ts'
echo "🥟 Starting TypeScript LiteRouter on port 7767 inside tmux session 'literouter-ts'..."
tmux new-session -d -s literouter-ts
tmux send-keys -t literouter-ts "cd /home/yapilwsl/arthityap/literouter" C-m
tmux send-keys -t literouter-ts "bun run ts-src/src/index.ts" C-m

sleep 2

# Retrieve and write PIDs
PY_PID=$(pgrep -f "uvicorn src.main:app" | head -n 1)
if [ -z "$PY_PID" ]; then
    PY_PID=$(tmux list-panes -t literouter -F "#{pane_active_pid}" 2>/dev/null)
fi
echo "$PY_PID" > "$PID_FILE"

TS_PID=$(pgrep -f "bun run ts-src/src/index.ts" | head -n 1)
if [ -z "$TS_PID" ]; then
    TS_PID=$(tmux list-panes -t literouter-ts -F "#{pane_active_pid}" 2>/dev/null)
fi
echo "$TS_PID" > "$TS_PID_FILE"

# Verify both are running
PY_OK=0
TS_OK=0
if [ -n "$PY_PID" ] && kill -0 "$PY_PID" 2>/dev/null; then
    PY_OK=1
fi
if [ -n "$TS_PID" ] && kill -0 "$TS_PID" 2>/dev/null; then
    TS_OK=1
fi

if [ $PY_OK -eq 1 ] && [ $TS_OK -eq 1 ]; then
    LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  LiteRouter Coordinated Gateways Running"
    echo "║"
    echo "║  Python proxy:    http://localhost:7766 (PID: $PY_PID)"
    echo "║  TypeScript proxy:  http://localhost:7767 (PID: $TS_PID)"
    if [ -n "$LAN_IP" ]; then
        echo "║  Network:         http://${LAN_IP}:7766 / 7767"
    fi
    echo "╚══════════════════════════════════════════════════════════════╝"
else
    echo "ERROR: One or both gateways failed to start."
    echo "  Python OK: $PY_OK, TS OK: $TS_OK"
    bash scripts/stop.sh
    exit 1
fi
