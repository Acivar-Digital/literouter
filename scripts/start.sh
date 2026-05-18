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
uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 &
PID=$!
echo "$PID" > "$PID_FILE"

sleep 2

if kill -0 "$PID" 2>/dev/null; then
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  LiteRouter running (PID: $PID)"
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
