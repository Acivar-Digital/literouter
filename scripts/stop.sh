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

# Flush Valkey to ensure clean state
echo "Flushing Valkey..."
uv run python -c "import dotenv, os, redis; dotenv.load_dotenv(); r = redis.Redis(host=os.getenv('REDIS_HOST', '127.0.0.1'), port=int(os.getenv('REDIS_PORT', 6379)), password=os.getenv('REDIS_PASSWORD') or None); r.flushall(); print('Valkey flushed!')"

rm -f "$PID_FILE"
echo "LiteRouter stopped."

