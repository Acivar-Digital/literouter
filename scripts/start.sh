#!/bin/bash
cd "$(dirname "$0")/.."

PID_FILE=".literouter.pid"

# Check if already running
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "LiteRouter is already running (PID: $OLD_PID)"
        echo "  → http://localhost:7766"
        exit 0
    else
        echo "Cleaning up stale PID file (PID: $OLD_PID)"
        rm -f "$PID_FILE"
    fi
fi

echo "Starting LiteRouter..."
nohup uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 > logs/literouter.log 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"
disown

sleep 2

if kill -0 "$PID" 2>/dev/null; then
    LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  LiteRouter running (PID: $PID)"
    echo "║"
    echo "║  Local:   http://localhost:7766"
    if [ -n "$LAN_IP" ]; then
        echo "║  Network: http://${LAN_IP}:7766"
    fi
    echo "║"
    echo "║  Health:  http://localhost:7766/health"
    echo "║  Chat:    http://localhost:7766/v1/chat/completions"
    echo "║  Models:  http://localhost:7766/v1/models"
    echo "╚══════════════════════════════════════════════════════════════╝"
else
    echo "ERROR: LiteRouter failed to start"
    rm -f "$PID_FILE"
    exit 1
fi
