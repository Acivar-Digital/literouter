#!/bin/bash
cd "$(dirname "$0")/.."

PID_FILE=".literouter.pid"

if [ ! -f "$PID_FILE" ]; then
    echo "LiteRouter is not running (no PID file)"
    exit 0
fi

PID=$(cat "$PID_FILE")

if ! kill -0 "$PID" 2>/dev/null; then
    echo "Process (PID: $PID) already dead, cleaning up."
    rm -f "$PID_FILE"
    exit 0
fi

echo "Stopping LiteRouter (PID: $PID)..."
kill "$PID" 2>/dev/null

# Wait up to 5 seconds
for i in 1 2 3 4 5; do
    if ! kill -0 "$PID" 2>/dev/null; then
        break
    fi
    sleep 1
done

if kill -0 "$PID" 2>/dev/null; then
    echo "Force killing (PID: $PID)..."
    kill -9 "$PID" 2>/dev/null
    sleep 1
fi

rm -f "$PID_FILE"
echo "LiteRouter stopped."
