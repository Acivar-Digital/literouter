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

echo "🚀 Starting LiteRouter v4.0 (Bun) on ${HOST}:${PORT} (${PROTOCOL})..."

# Launch Bun process in detached tmux session with explicit working directory
tmux new-session -d -s "$TMUX_SESSION" -c "$ROOT_DIR"
tmux send-keys -t "$TMUX_SESSION" "cd \"$ROOT_DIR\"" C-m
tmux send-keys -t "$TMUX_SESSION" "export PATH=\"$HOME/.bun/bin:/home/linuxbrew/.linuxbrew/bin:/usr/local/bin:\$PATH\"" C-m
tmux send-keys -t "$TMUX_SESSION" "export LITEROUTER_HOST=\"$HOST\" LITEROUTER_PORT=\"$PORT\" LITEROUTER_TLS_ENABLED=\"$TLS_ENABLED\" && bun run src/index.ts 2>&1 | tee -a logs/gateway.log" C-m

# Wait for server ready with health polling
MAX_RETRIES=15
READY=0
for i in $(seq 1 $MAX_RETRIES); do
    sleep 0.5
    HEALTH_OUTPUT=$(curl -sk -m 1 "${PROTOCOL}://${HOST}:${PORT}/health" 2>/dev/null || true)
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

    format_box_line() {
        local label="$1"
        local value="$2"
        local line
        line=$(printf "  %-18s %s" "$label" "$value")
        local len=${#line}
        local pad=$(( 70 - len ))
        printf "║%s%*s║\n" "$line" "$pad" ""
    }

    echo ""
    echo "╔══════════════════════════════════════════════════════════════════════╗"
    title="  🟢 LiteRouter Gateway Active (v4.0 Bun Runtime)"
    t_len=${#title}
    # 🟢 is 1 char in bash string length but takes 2 terminal display columns
    t_pad=$(( 70 - 1 - t_len ))
    printf "║%s%*s║\n" "$title" "$t_pad" ""
    printf "║%*s║\n" 70 ""
    format_box_line "Endpoint:" "${PROTOCOL}://${HOST}:${PORT}"
    if [ -n "$LAN_IP" ] && [ "$HOST" != "$LAN_IP" ]; then
        format_box_line "LAN Endpoint:" "${PROTOCOL}://${LAN_IP}:${PORT}"
    fi
    format_box_line "Health Probe:" "${PROTOCOL}://${HOST}:${PORT}/health"
    format_box_line "Process PID:" "${BUN_PID:-tmux-managed}"
    format_box_line "Tmux Session:" "$TMUX_SESSION"
    echo "╚══════════════════════════════════════════════════════════════════════╝"
    echo "Attach to live logs: tmux attach -t $TMUX_SESSION"
else
    echo "❌ Error: Gateway failed to respond on ${PROTOCOL}://${HOST}:${PORT}/health within timeout."
    if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
        echo "--- Recent tmux output ---"
        tmux capture-pane -pt "$TMUX_SESSION" | tail -n 20 || true
        echo "--------------------------"
    fi
    bash scripts/stop.sh >/dev/null 2>&1 || true
    exit 1
fi
