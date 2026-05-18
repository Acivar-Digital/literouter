#!/bin/bash
cd "$(dirname "$0")/.."

PID_FILE=".literouter.pid"

# Kill existing tracked process
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if kill -0 "$OLD_PID" 2>/dev/null; then
        echo "Stopping LiteRouter (PID: $OLD_PID)..."
        kill "$OLD_PID" 2>/dev/null

        for i in 1 2 3 4 5; do
            if ! kill -0 "$OLD_PID" 2>/dev/null; then
                break
            fi
            sleep 1
        done

        if kill -0 "$OLD_PID" 2>/dev/null; then
            echo "Force killing (PID: $OLD_PID)..."
            kill -9 "$OLD_PID" 2>/dev/null
            sleep 1
        fi
        echo "Stopped."
    else
        echo "Process (PID: $OLD_PID) already dead, cleaning up."
    fi
    rm -f "$PID_FILE"
else
    echo "No PID file found. Starting fresh..."
fi

# Start new instance
echo "Starting LiteRouter..."
uv run uvicorn src.main:app --host 0.0.0.0 --port 7766 &
PID=$!
echo "$PID" > "$PID_FILE"

sleep 3

if kill -0 "$PID" 2>/dev/null; then
    # Get the LAN IP for network access
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
