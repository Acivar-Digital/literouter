#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

TMUX_SESSION="literouter"
PID_FILE=".literouter.pid"

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
PROTOCOL="http"
if [ -f "certs/localhost.pem" ] && [ -f "certs/localhost-key.pem" ]; then
    PROTOCOL="https"
fi

PID=""
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || true)
fi

TMUX_RUNNING=0
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    TMUX_RUNNING=1
fi

HEALTH_RES=$(curl -sk -m 2 "${PROTOCOL}://localhost:${PORT}/health" 2>/dev/null || true)

if [ "$TMUX_RUNNING" -eq 1 ] || { [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; }; then
    echo "🟢 LiteRouter is RUNNING"
    echo "  • Tmux Session: $TMUX_SESSION (active: $TMUX_RUNNING)"
    echo "  • Process PID:  ${PID:-unknown}"
    echo "  • Port:         $PORT ($PROTOCOL)"
    if echo "$HEALTH_RES" | grep -q '"status":"healthy"'; then
        echo "  • Health Check: OK ($HEALTH_RES)"
    else
        echo "  • Health Check: ⚠️ Unresponsive or Non-200 ($HEALTH_RES)"
    fi
    echo "  • Attach logs:  tmux attach -t $TMUX_SESSION"
    exit 0
else
    echo "🔴 LiteRouter is NOT running"
    if [ -f "$PID_FILE" ]; then
        echo "  • Removing stale PID file: $PID_FILE"
        rm -f "$PID_FILE"
    fi
    exit 1
fi
