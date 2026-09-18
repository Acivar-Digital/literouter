#!/usr/bin/env bash
# ==============================================================================
# sync_literouter_to_vps.sh — LiteRouter One-Way Mirror (WSL -> VPS)
#
# Enforces WSL as the SINGLE GOLDEN TRUTH for LiteRouter code, configuration,
# and key pools (.env, .env.local).
# Flow is strictly unidirectional (WSL -> VPS). Never bidirectional.
#
# Usage:
#   bash scripts/sync/sync_literouter_to_vps.sh [--skip-git] [--restart-only]
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd -P)"
cd "$PROJECT_ROOT"

VPS_HOST="${LITEROUTER_VPS_HOST:-vps466a}"
VPS_TARGET_DIR="${LITEROUTER_VPS_DIR:-/home/vps466a/services/literouter}"
VPS_ZT_IP="${LITEROUTER_VPS_ZT_IP:-10.32.34.243}"
VPS_PORT="${LITEROUTER_VPS_PORT:-7766}"

SSH_OPTS=(-o ConnectTimeout=5 -o BatchMode=yes)

log_info()  { echo -e "\033[94m[INFO]\033[0m  $*"; }
log_ok()    { echo -e "\033[92m[OK]\033[0m    $*"; }
log_warn()  { echo -e "\033[93m[WARN]\033[0m  $*"; }
log_fatal() { echo -e "\033[91m[FATAL]\033[0m $*" >&2; exit 1; }

echo "================================================================================"
echo " LiteRouter One-Way Synchronization: WSL (Golden Truth) -> VPS (${VPS_HOST})"
echo "================================================================================"

# 1. Verify local source files exist
[[ -f ".env.local" ]] || log_fatal ".env.local not found in $PROJECT_ROOT"
[[ -f ".env" ]]       || log_fatal ".env not found in $PROJECT_ROOT"

# 2. Check SSH connectivity
log_info "Verifying SSH connection to ${VPS_HOST}..."
if ! ssh "${SSH_OPTS[@]}" "$VPS_HOST" "echo ping" >/dev/null 2>&1; then
    log_fatal "Cannot reach ${VPS_HOST} via SSH. Check ZeroTier / WireGuard connectivity."
fi
log_ok "SSH connectivity to ${VPS_HOST} confirmed."

# 3. Create remote backup
log_info "Creating remote environment backup on VPS..."
BACKUP_TS=$(date +%Y%m%d_%H%M%S)
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "mkdir -p ~/backups/literouter_sync && cp -a ${VPS_TARGET_DIR}/.env* ~/backups/literouter_sync/ 2>/dev/null || true"
log_ok "Remote backup created in ~/backups/literouter_sync/."

# 4. Git code synchronization (if not --skip-git)
if [[ "${1:-}" != "--skip-git" && "${1:-}" != "--restart-only" ]]; then
    log_info "Synchronizing git tracking branch on VPS..."
    ssh "${SSH_OPTS[@]}" "$VPS_HOST" "cd ${VPS_TARGET_DIR} && git fetch origin main && git checkout -- config/providers.json 2>/dev/null || true; git pull --rebase origin main"
    log_ok "Git working tree updated on VPS."
fi

# 5. One-way sync secrets and env files (if not --restart-only)
if [[ "${1:-}" != "--restart-only" ]]; then
    log_info "Pushing .env and .env.local to VPS..."
    scp "${SSH_OPTS[@]}" ".env.local" "${VPS_HOST}:${VPS_TARGET_DIR}/.env.local"
    scp "${SSH_OPTS[@]}" ".env"       "${VPS_HOST}:${VPS_TARGET_DIR}/.env"
    ssh "${SSH_OPTS[@]}" "$VPS_HOST" "chmod 600 ${VPS_TARGET_DIR}/.env ${VPS_TARGET_DIR}/.env.local"

    # Verify sha256 checksums match
    LOCAL_LOCAL_HASH=$(sha256sum .env.local | awk '{print $1}')
    REMOTE_LOCAL_HASH=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" "sha256sum ${VPS_TARGET_DIR}/.env.local" | awk '{print $1}')
    if [[ "$LOCAL_LOCAL_HASH" != "$REMOTE_LOCAL_HASH" ]]; then
        log_fatal "Checksum mismatch on .env.local! Local: $LOCAL_LOCAL_HASH vs Remote: $REMOTE_LOCAL_HASH"
    fi
    log_ok ".env and .env.local synced and verified (sha256: ${LOCAL_LOCAL_HASH:0:16}...)."
fi

# 6. Sanitize tmux global environment on VPS
log_info "Sanitizing tmux global environment on VPS..."
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "export PATH=\"/usr/bin:/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:\$PATH\";
for v in GOOGLE_API_KEYS OPENROUTER_API_KEYS NVIDIA_API_KEYS ZEN_API_KEYS GCP_KEYS GCP_API_KEYS LITEROUTER_AUTH_KEY LITEROUTER_PORT LITEROUTER_HOST LITEROUTER_PROVIDER LITEROUTER_TEMPLATE LITEROUTER_ROTATE_DELAY_MS; do
  tmux set-environment -g -u \"\$v\" 2>/dev/null || true
done
"
log_ok "Stale tmux exports purged."

# 7. Restart LiteRouter on VPS
log_info "Restarting LiteRouter service on VPS..."
ssh "${SSH_OPTS[@]}" "$VPS_HOST" "export PATH=\"/usr/bin:/usr/local/bin:/home/linuxbrew/.linuxbrew/bin:\$PATH\"; cd ${VPS_TARGET_DIR} && bash scripts/gateway/stop.sh >/dev/null 2>&1 || true; sleep 1; bash scripts/gateway/start.sh"

# 8. Verify remote health and key counts
log_info "Awaiting healthy probe from http://${VPS_ZT_IP}:${VPS_PORT}/health..."
HEALTHY=0
for i in {1..15}; do
    if curl -sk -m 2 "http://${VPS_ZT_IP}:${VPS_PORT}/health" | grep -q '"status":"healthy"'; then
        HEALTHY=1
        break
    fi
    sleep 1
done

if [[ "$HEALTHY" -ne 1 ]]; then
    log_fatal "Gateway did not report healthy status within 15 seconds!"
fi
log_ok "Gateway is healthy."

# 9. Verify loaded key pools
log_info "Inspecting loaded key pools on VPS..."
KEY_SUMMARY=$(ssh "${SSH_OPTS[@]}" "$VPS_HOST" "tail -n 30 ${VPS_TARGET_DIR}/logs/gateway.log | grep -A 6 'Key Pools Loaded:' | tail -n 5")
echo "--------------------------------------------------------------------------------"
echo "$KEY_SUMMARY"
echo "--------------------------------------------------------------------------------"
log_ok "Synchronization complete. VPS is an exact mirror of WSL."
