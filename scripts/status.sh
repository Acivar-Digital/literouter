#!/bin/bash
cd "$(dirname "$0")/.."

PID_FILE=".literouter.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "LiteRouter is not running (no PID file)"
    exit 0
fi

PID=$(cat "$PID_FILE")

if kill -0 "$PID" 2>/dev/null; then
    echo "LiteRouter is running (PID: $PID)"
    echo "  → http://localhost:7766/health"
else
    echo "LiteRouter is not running (stale PID file: $PID)"
    rm -f "$PID_FILE"
fi
