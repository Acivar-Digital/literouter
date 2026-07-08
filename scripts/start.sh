#!/bin/bash
cd "$(dirname "$0")/.."

TS_PID_FILE=".literouter-ts.pid"

# Check if already running
if tmux has-session -t literouter-ts 2>/dev/null; then
    echo "ERROR: LiteRouter (TS) is already running in a tmux session."
    exit 0
fi

# Ensure logs folder exists
mkdir -p logs

# Flush Valkey once at start
echo "🧹 Flushing Valkey/Redis state..."
uv run python -c "import dotenv, os, redis; dotenv.load_dotenv(); r = redis.Redis(host=os.getenv('REDIS_HOST', '127.0.0.1'), port=int(os.getenv('REDIS_PORT', 6379)), password=os.getenv('REDIS_PASSWORD') or None); r.flushall(); print('Valkey flushed!')"

# Start TypeScript LiteRouter (Port 7767) in tmux session 'literouter-ts'
echo "🥟 Starting LiteRouter on port 7767 inside tmux session 'literouter-ts'..."
tmux new-session -d -s literouter-ts
tmux send-keys -t literouter-ts "cd /home/yapilwsl/arthityap/literouter" C-m
tmux send-keys -t literouter-ts "bun run ts-src/src/index.ts" C-m

sleep 2

# Retrieve and write PID
TS_PID=$(pgrep -f "bun run ts-src/src/index.ts" | head -n 1)
if [ -z "$TS_PID" ]; then
    TS_PID=$(tmux list-panes -t literouter-ts -F "#{pane_active_pid}" 2>/dev/null)
fi
echo "$TS_PID" > "$TS_PID_FILE"

# Verify running status
TS_OK=0
if [ -n "$TS_PID" ] && kill -0 "$TS_PID" 2>/dev/null; then
    TS_OK=1
fi

if [ $TS_OK -eq 1 ]; then
    LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  LiteRouter Coordinated Gateways Running"
    echo "║"
    echo "║  TypeScript proxy:  http://localhost:7767 (PID: $TS_PID)"
    if [ -n "$LAN_IP" ]; then
        echo "║  Network:         http://${LAN_IP}:7767"
    fi
    echo "╚══════════════════════════════════════════════════════════════╝"
else
    echo "ERROR: LiteRouter failed to start."
    bash scripts/stop.sh
    exit 1
fi
