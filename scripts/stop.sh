#!/bin/bash
cd "$(dirname "$0")/.."

PID_FILE=".literouter.pid"

if tmux has-session -t literouter 2>/dev/null; then
    echo "Stopping LiteRouter in tmux session 'literouter'..."
    tmux send-keys -t literouter C-c
    # Wait up to 5 seconds for graceful exit
    for i in 1 2 3 4 5; do
        if ! tmux has-session -t literouter 2>/dev/null; then
            break
        fi
        sleep 1
    done
    tmux kill-session -t literouter 2>/dev/null
fi

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if kill -0 "$PID" 2>/dev/null; then
        echo "Stopping LiteRouter process (PID: $PID)..."
        kill "$PID" 2>/dev/null
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
    fi
    rm -f "$PID_FILE"
fi

# Flush Valkey to ensure clean state
echo "Flushing Valkey..."
uv run python -c "import dotenv, os, redis; dotenv.load_dotenv(); r = redis.Redis(host=os.getenv('REDIS_HOST', '127.0.0.1'), port=int(os.getenv('REDIS_PORT', 6379)), password=os.getenv('REDIS_PASSWORD') or None); r.flushall(); print('Valkey flushed!')"

echo "LiteRouter stopped."

