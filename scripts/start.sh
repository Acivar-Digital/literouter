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

# Flush Valkey to ensure clean start
echo "Flushing Valkey..."
uv run python -c "import dotenv, os, redis; dotenv.load_dotenv(); r = redis.Redis(host=os.getenv('REDIS_HOST', '127.0.0.1'), port=int(os.getenv('REDIS_PORT', 6379)), password=os.getenv('REDIS_PASSWORD') or None); r.flushall(); print('Valkey flushed!')"


nohup .venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 7766 > logs/literouter.log 2>&1 &
PID=$!
echo "$PID" > "$PID_FILE"
# Check if disown is available (dash/sh doesn't have it, bash does)
if [ -n "$BASH_VERSION" ] || type disown >/dev/null 2>&1; then
    disown "$PID" 2>/dev/null || true
fi


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
