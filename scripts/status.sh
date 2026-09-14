#!/usr/bin/env bash
export PATH="$HOME/.bun/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:$PATH"
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd -P)"
cd "$ROOT_DIR"

LOCATION_FILE="config/location.json"
if [ ! -f "$LOCATION_FILE" ]; then
    echo "❌ [FATAL] $LOCATION_FILE is missing. LiteRouter requires host, port, and tls_enabled to be defined in $LOCATION_FILE." >&2
    exit 1
fi
if ! jq -e '.host != null and .port != null and .tls_enabled != null' "$LOCATION_FILE" >/dev/null 2>&1; then
    echo "❌ [FATAL] $LOCATION_FILE is malformed. Required schema: { \"host\": \"...\", \"port\": 1234, \"tls_enabled\": true/false }" >&2
    exit 1
fi

HOST=$(jq -r '.host' "$LOCATION_FILE")
PORT=$(jq -r '.port' "$LOCATION_FILE")
TLS_ENABLED=$(jq -r '.tls_enabled' "$LOCATION_FILE")
PROTOCOL="http"
if [ "$TLS_ENABLED" = "true" ]; then PROTOCOL="https"; fi

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

PID=""
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE" 2>/dev/null || true)
fi

TMUX_RUNNING=0
if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    TMUX_RUNNING=1
fi

HEALTH_RES=$(curl -sk -m 2 "${PROTOCOL}://${HOST}:${PORT}/health" 2>/dev/null || true)

if [ "$TMUX_RUNNING" -eq 1 ] || { [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; }; then
    echo "🟢 LiteRouter is RUNNING"
    echo "  • Tmux Session: $TMUX_SESSION (active: $TMUX_RUNNING)"
    echo "  • Process PID:  ${PID:-unknown}"
    echo "  • Host:         $HOST"
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
