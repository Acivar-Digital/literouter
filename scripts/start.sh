#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

TMUX_SESSION="literouter"
PID_FILE=".literouter.pid"

# Load config and API key pools if present
set +e
if [ -f .env ]; then
    set -a
    # shellcheck disable=SC1091
    source .env 2>/dev/null
    set +a
fi
if [ -f .env.local ]; then
    set -a
    # shellcheck disable=SC1091
    source .env.local 2>/dev/null
    set +a
fi
set -e

PORT="${LITEROUTER_PORT:-7766}"
HOST="${LITEROUTER_HOST:-0.0.0.0}"
PROTOCOL="http"

if [ -f "certs/localhost.pem" ] && [ -f "certs/localhost-key.pem" ]; then
    PROTOCOL="https"
fi

# Check if already running via tmux
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "⚠️ LiteRouter is already running in tmux session '$TMUX_SESSION'."
    echo "Check status with: bash scripts/status.sh"
    echo "Attach with:       tmux attach -t $TMUX_SESSION"
    exit 0
fi

# Ensure logs directory exists
mkdir -p logs

# Prune gateway log to last 30 days (safe no-op when fresh)
if [ -f logs/gateway.log ]; then bash scripts/prune-logs.sh || true; fi

echo "🚀 Starting LiteRouter v3.1 (Bun) on ${HOST}:${PORT} (${PROTOCOL})..."

# Launch Bun process in detached tmux session
tmux new-session -d -s "$TMUX_SESSION"
tmux send-keys -t "$TMUX_SESSION" "cd $(pwd)" C-m
tmux send-keys -t "$TMUX_SESSION" "export LITEROUTER_PORT=$PORT LITEROUTER_HOST=$HOST && bun run src/index.ts 2>&1 | tee -a logs/gateway.log" C-m

# Wait for server ready with health polling
MAX_RETRIES=15
READY=0
for i in $(seq 1 $MAX_RETRIES); do
    sleep 0.5
    HEALTH_OUTPUT=$(curl -sk -m 1 "${PROTOCOL}://localhost:${PORT}/health" 2>/dev/null || true)
    if echo "$HEALTH_OUTPUT" | grep -q '"status":"healthy"'; then
        READY=1
        break
    fi
done

# Capture PID from tmux session or pgrep
BUN_PID=$(pgrep -f "bun run src/index.ts" | head -n 1 || true)
if [ -n "$BUN_PID" ]; then
    echo "$BUN_PID" > "$PID_FILE"
fi

if [ "$READY" -eq 1 ]; then
    LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
    echo ""
    echo "╔══════════════════════════════════════════════════════════════════════╗"
    echo "║  🟢 LiteRouter Gateway Active (v3.1 Bun Runtime)                     ║"
    echo "║                                                                      ║"
    echo "║  Local Endpoint:   ${PROTOCOL}://localhost:${PORT}                            ║"
    if [ -n "$LAN_IP" ]; then
        printf "║  LAN Endpoint:     ${PROTOCOL}://%-43s ║\n" "${LAN_IP}:${PORT}"
    fi
    printf "║  Health Probe:     ${PROTOCOL}://localhost:%-38s ║\n" "${PORT}/health"
    printf "║  Process PID:      %-49s ║\n" "${BUN_PID:-tmux-managed}"
    printf "║  Tmux Session:     %-49s ║\n" "$TMUX_SESSION"
    echo "╚══════════════════════════════════════════════════════════════════════╝"
    echo "Attach to live logs: tmux attach -t $TMUX_SESSION"
else
    echo "❌ Error: Gateway failed to respond on ${PROTOCOL}://localhost:${PORT}/health within timeout."
    if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
        echo "--- Recent tmux output ---"
        tmux capture-pane -pt "$TMUX_SESSION" | tail -n 20 || true
        echo "--------------------------"
    fi
    bash scripts/stop.sh >/dev/null 2>&1 || true
    exit 1
fi
